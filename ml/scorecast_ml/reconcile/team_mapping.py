"""Team-name reconciliation between Football-Data.co.uk's CSV vocabulary
and the football-data.org / ScoreCast-DB canonical names.

Resolution order:
1. Exact match in the per-league `aliases` dict (committed in teams.json).
2. Exact match against the set of known canonical names (catches CSVs
   that already use the DB form).
3. rapidfuzz fallback — score >= 92 auto-uses with a WARN log + writes the
   guess to `_proposed.json` for operator review. Score in [75, 92) errors
   loudly. Score < 75 errors with a "likely a new team" hint.

The loud-error paths are the design — silently auto-matching at low fuzzy
scores is exactly how naive pipelines drift over preseasons.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from rapidfuzz import fuzz, process

from scorecast_ml.logging import get_logger

log = get_logger(__name__)

_HERE = Path(__file__).resolve().parent
_TEAMS_FILE = _HERE / "teams.json"
_PROPOSED_FILE = _HERE / "_proposed.json"

# Fuzzy-match thresholds (rapidfuzz WRatio, 0-100).
_AUTO_MATCH_THRESHOLD = 92
_ERROR_THRESHOLD = 75


@dataclass(frozen=True)
class ReconcileResult:
    canonical: dict[str, str]      # raw_name → canonical_name (full coverage of input)
    auto_matched: list[tuple[str, str, float]]  # (raw, canonical, score) — needs operator review
    # Unknown teams never make it here — they raise.


class UnknownTeamError(ValueError):
    """Raised when a CSV team name has no manual mapping AND no high-enough
    fuzzy candidate. Halt the pipeline — silent mismatch is worse than a
    failed run."""


def _load_teams_file() -> dict:
    if not _TEAMS_FILE.exists():
        raise FileNotFoundError(
            f"teams.json missing at {_TEAMS_FILE}. The Phase 1 bootstrap "
            "should have created it; restore from git."
        )
    with _TEAMS_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def _league_block(league: str) -> dict:
    blob = _load_teams_file()
    if league not in blob:
        raise KeyError(
            f"League {league!r} has no entry in teams.json. Add one and "
            "populate the `aliases` map."
        )
    return blob[league]


def aliases_for(league: str) -> dict[str, str]:
    return _league_block(league)["aliases"]


def canonical_set(league: str) -> set[str]:
    return set(aliases_for(league).values())


def _append_proposed(league: str, raw: str, canonical: str, score: float) -> None:
    """Persist auto-matched guesses for operator review. The next manual
    pass should promote these into `teams.json` and delete the proposed
    entry. The file is gitignored noise that survives runs."""
    existing: dict = {}
    if _PROPOSED_FILE.exists():
        try:
            with _PROPOSED_FILE.open(encoding="utf-8") as f:
                existing = json.load(f)
        except json.JSONDecodeError:
            existing = {}
    existing.setdefault(league, {})[raw] = {"canonical": canonical, "score": score}
    with _PROPOSED_FILE.open("w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, sort_keys=True)


def canonicalize(raw_name: str, league: str) -> tuple[str, float | None]:
    """raw_name → (canonical_name, fuzzy_score_or_None).

    fuzzy_score is None when matched exactly. Raises UnknownTeamError if
    no acceptable match is found.
    """
    aliases = aliases_for(league)
    canonicals = list(canonical_set(league))

    # 1. Exact alias hit.
    if raw_name in aliases:
        return aliases[raw_name], None

    # 2. Exact canonical hit (CSV already in DB form — rare but free).
    if raw_name in canonicals:
        return raw_name, None

    # 3. Fuzzy.
    best = process.extractOne(raw_name, canonicals, scorer=fuzz.WRatio)
    if best is None:
        raise UnknownTeamError(
            f"League {league}: no canonical names available for fuzzy match "
            f"against {raw_name!r}."
        )
    canonical, score, _ = best

    if score >= _AUTO_MATCH_THRESHOLD:
        log.warning(
            "reconcile_auto_match",
            league=league,
            raw=raw_name,
            canonical=canonical,
            score=round(score, 1),
            hint="Review _proposed.json and promote to teams.json.",
        )
        _append_proposed(league, raw_name, canonical, round(score, 1))
        return canonical, score

    if score >= _ERROR_THRESHOLD:
        raise UnknownTeamError(
            f"League {league}: ambiguous fuzzy match for {raw_name!r}. "
            f"Best candidate {canonical!r} scored {score:.1f} (< {_AUTO_MATCH_THRESHOLD}). "
            "Add a manual alias to teams.json."
        )

    raise UnknownTeamError(
        f"League {league}: no plausible match for {raw_name!r} (best "
        f"score {score:.1f} < {_ERROR_THRESHOLD}). Likely a newly promoted "
        "team — check the DB for its canonical name then add to teams.json."
    )


def reconcile_dataframe(df: pd.DataFrame, *, league: str) -> tuple[pd.DataFrame, ReconcileResult]:
    """Apply canonicalize() to home + away columns. Raises on any unknown.

    Returns (mutated_copy, ReconcileResult). The result captures
    auto-matched pairs so the CLI can surface them at the end of a run.
    """
    work = df.copy()
    unique_names = set(work["home"].astype(str).unique()) | set(work["away"].astype(str).unique())

    canonical_map: dict[str, str] = {}
    auto: list[tuple[str, str, float]] = []
    for name in sorted(unique_names):
        canon, score = canonicalize(name, league)
        canonical_map[name] = canon
        if score is not None:
            auto.append((name, canon, score))

    work["home"] = work["home"].map(canonical_map)
    work["away"] = work["away"].map(canonical_map)
    return work, ReconcileResult(canonical=canonical_map, auto_matched=auto)


def unique_teams_in_dataframe(df: pd.DataFrame) -> list[str]:
    """Convenience for CLI dry-run output."""
    return sorted(set(df["home"].astype(str).unique()) | set(df["away"].astype(str).unique()))
