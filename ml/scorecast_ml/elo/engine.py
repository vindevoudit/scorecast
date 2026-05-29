"""Vanilla Elo + home-field advantage. Phase 1 keeps it deliberately simple
(no MOV multiplier, no inter-season decay, no cross-league pool) to validate
the pipeline shape. Phase 2 layers those on.

Conventions:
- `expected_score(r_home, r_away, hfa)` returns the home team's expected
  win probability in [0, 1]. The home boost is folded inside this fn so
  it never travels with the team to away games (the canonical Elo bug).
- `update(r, expected, actual, k)` returns the new rating.
- `batch_compute(matches, config)` walks the chronologically-sorted match
  DataFrame, recording each team's PRE-match rating into new columns
  (home_elo_pre, away_elo_pre) and producing a final snapshot dict
  team → (rating, matches_played, last_match_date).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import pandas as pd

from scorecast_ml.logging import get_logger

log = get_logger(__name__)

PromotedStrategy = Literal["initial", "min_rating"]


@dataclass(frozen=True)
class EloConfig:
    initial_rating: float = 1500.0
    k_factor: float = 20.0
    # HFA is added to home rating inside expected_score. Empirically a
    # no-op for the XGBoost classifier (trees absorb the constant shift
    # in elo_diff; the model learns home advantage from the home_*/away_*
    # feature pairs directly). Defaulted to 0 after the HFA ablation
    # confirmed indistinguishable test-set metrics — see ml/compare_hfa.py.
    # The structural home-vs-away convention carries all the signal.
    home_field_advantage: float = 0.0
    # How to rate a team the FIRST TIME it appears.
    #   "initial":    always use `initial_rating` (vanilla Elo).
    #   "min_rating": use min(current ratings) once past the first season.
    #                 Captures the empirical reality that promoted teams
    #                 underperform the bottom of the league they joined.
    promoted_team_strategy: PromotedStrategy = "min_rating"
    # International model support. Both default-off so PL training stays
    # bit-identical. Mirror of lib/ml/eloMath.js's `eloDelta(..., opts)`
    # signature so the Python trainer and JS cascade apply identical math.
    #
    # `k_multiplier_column`: optional DataFrame column name whose row value
    # multiplies `k_factor` per match (e.g. 3.0 for WC finals, 1.0 for
    # friendlies). Absent column or NaN → 1.0 fallback.
    #
    # `neutral_column`: optional DataFrame column name whose truthy row
    # value forces HFA=0 for that match's expected_score calculation —
    # used for WC and other neutral-pitch fixtures.
    k_multiplier_column: str | None = None
    neutral_column: str | None = None


def expected_score(r_home: float, r_away: float, hfa: float = 65.0) -> float:
    """Home team's expected win probability under the standard Elo logistic.

    `hfa` is added to the home rating ONLY for this calculation — never
    persisted on the rating itself. Setting hfa=0 gives the classic
    neutral-venue Elo.
    """
    return 1.0 / (1.0 + 10 ** ((r_away - (r_home + hfa)) / 400.0))


def update(rating: float, expected: float, actual: float, k: float) -> float:
    """Standard Elo update: r' = r + K * (actual - expected).

    `actual` is 1.0 for win, 0.5 for draw, 0.0 for loss.
    """
    return rating + k * (actual - expected)


def actual_score_from_ftr(ftr: str) -> tuple[float, float]:
    """FTR (H/D/A) → (home_actual, away_actual) pair, both in {0, 0.5, 1}."""
    if ftr == "H":
        return 1.0, 0.0
    if ftr == "A":
        return 0.0, 1.0
    if ftr == "D":
        return 0.5, 0.5
    raise ValueError(f"FTR must be H/D/A, got {ftr!r}")


@dataclass
class TeamState:
    rating: float
    matches_played: int = 0
    last_match_date: pd.Timestamp | None = None


def batch_compute(
    matches: pd.DataFrame, config: EloConfig | None = None
) -> tuple[pd.DataFrame, dict[str, TeamState]]:
    """Walk matches in chronological order, recording pre-match ratings.

    Input columns required: date, home, away, ftr.
    Output: (augmented_matches, snapshot)
      - augmented_matches has two added columns: home_elo_pre, away_elo_pre.
        These are the ratings BEFORE the match was applied — what a
        feature engineer would have at prediction time.
      - snapshot is team_name → TeamState (final ratings, ready to use for
        inference on tomorrow's fixtures).

    Determinism guarantee: same input + same config → same output. Tests
    in tests/test_elo_engine.py lock this in.
    """
    cfg = config or EloConfig()
    if not matches["date"].is_monotonic_increasing:
        matches = matches.sort_values("date").reset_index(drop=True)
    else:
        matches = matches.reset_index(drop=True)

    state: dict[str, TeamState] = {}
    home_pre: list[float] = []
    away_pre: list[float] = []
    seasons_seen: set[str] = set()
    has_season_col = "season" in matches.columns
    # International model carriers — looked up per-row when set.
    k_mult_col = cfg.k_multiplier_column if cfg.k_multiplier_column in matches.columns else None
    neutral_col = cfg.neutral_column if cfg.neutral_column in matches.columns else None

    for row in matches.itertuples(index=False):
        # Track season boundary so the promoted-team strategy knows whether
        # we're still in the first season (everyone defaults to
        # initial_rating) or past it (new teams enter at min(current)).
        if has_season_col:
            seasons_seen.add(row.season)
        past_first_season = len(seasons_seen) > 1

        # Snapshot the min rating BEFORE initializing any new teams in this
        # match — otherwise a brand-new home team would influence the away
        # team's starting rating.
        starting_rating = cfg.initial_rating
        if (
            past_first_season
            and cfg.promoted_team_strategy == "min_rating"
            and state
        ):
            starting_rating = min(s.rating for s in state.values())

        if row.home not in state:
            state[row.home] = TeamState(rating=starting_rating)
        if row.away not in state:
            state[row.away] = TeamState(rating=starting_rating)

        h = state[row.home]
        a = state[row.away]
        home_pre.append(h.rating)
        away_pre.append(a.rating)

        # Per-match effective HFA + K-factor. Defaults (no INT columns) collapse
        # to (cfg.home_field_advantage, cfg.k_factor) — bit-identical to the
        # pre-international-model path. NaN/None k_mult also falls back to 1.0
        # so a sparsely-populated column doesn't silently zero out a match.
        if neutral_col is not None:
            raw_neutral = getattr(row, neutral_col)
            effective_hfa = 0.0 if bool(raw_neutral) else cfg.home_field_advantage
        else:
            effective_hfa = cfg.home_field_advantage
        if k_mult_col is not None:
            raw_k = getattr(row, k_mult_col)
            try:
                k_mult = float(raw_k) if raw_k is not None and pd.notna(raw_k) else 1.0
            except (TypeError, ValueError):
                k_mult = 1.0
        else:
            k_mult = 1.0
        effective_k = cfg.k_factor * k_mult

        # Apply the match to both teams.
        eh = expected_score(h.rating, a.rating, effective_hfa)
        ea = 1.0 - eh
        actual_h, actual_a = actual_score_from_ftr(row.ftr)
        h.rating = update(h.rating, eh, actual_h, effective_k)
        a.rating = update(a.rating, ea, actual_a, effective_k)
        h.matches_played += 1
        a.matches_played += 1
        h.last_match_date = row.date
        a.last_match_date = row.date

    augmented = matches.copy()
    augmented["home_elo_pre"] = home_pre
    augmented["away_elo_pre"] = away_pre

    log.info(
        "elo_batch_complete",
        matches=len(matches),
        teams=len(state),
        top_team=max(state.items(), key=lambda kv: kv[1].rating)[0] if state else None,
    )
    return augmented, state
