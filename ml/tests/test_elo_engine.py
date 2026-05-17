"""Elo engine: determinism, known-fixture sanity, expected_score math."""

from __future__ import annotations

import pandas as pd
import pytest

from scorecast_ml.elo.engine import (
    EloConfig,
    actual_score_from_ftr,
    batch_compute,
    expected_score,
    update,
)


def test_expected_score_symmetric_at_equal_ratings():
    # Equal teams with no HFA → 50/50
    assert abs(expected_score(1500, 1500, hfa=0) - 0.5) < 1e-12


def test_expected_score_home_advantage_pushes_home():
    eq = expected_score(1500, 1500, hfa=0)
    hfa = expected_score(1500, 1500, hfa=65)
    assert hfa > eq
    # 65 Elo HFA is roughly equivalent to a ~60/40 home edge for equal teams
    assert 0.55 < hfa < 0.65


def test_expected_score_strong_team_dominates():
    # +400 rating → ~91% expected score
    assert expected_score(1900, 1500, hfa=0) > 0.9


def test_expected_score_sums_to_one_per_match():
    # The home + away expected scores must always sum to 1.0.
    for rh, ra, hfa in [(1500, 1500, 0), (1700, 1400, 65), (1400, 1700, 65)]:
        h = expected_score(rh, ra, hfa)
        a = expected_score(ra, rh, -hfa)  # away from away's POV: HFA flips sign
        assert abs((h + a) - 1.0) < 1e-12, (rh, ra, hfa, h, a)


def test_update_zero_sum_invariant():
    # When two teams play each other, the rating gained by one equals the
    # rating lost by the other.
    rh, ra = 1500.0, 1500.0
    eh = expected_score(rh, ra, hfa=0)
    ea = 1 - eh
    new_h = update(rh, eh, 1.0, 20)  # home wins
    new_a = update(ra, ea, 0.0, 20)
    assert abs((new_h - rh) + (new_a - ra)) < 1e-9


def test_actual_score_from_ftr_known_values():
    assert actual_score_from_ftr("H") == (1.0, 0.0)
    assert actual_score_from_ftr("A") == (0.0, 1.0)
    assert actual_score_from_ftr("D") == (0.5, 0.5)
    with pytest.raises(ValueError):
        actual_score_from_ftr("X")


def _toy_matches() -> pd.DataFrame:
    """5-match toy dataset, chronological."""
    return pd.DataFrame(
        [
            {"date": pd.Timestamp("2024-01-01", tz="UTC"), "home": "A", "away": "B", "ftr": "H", "fthg": 2, "ftag": 0},
            {"date": pd.Timestamp("2024-01-08", tz="UTC"), "home": "C", "away": "A", "ftr": "D", "fthg": 1, "ftag": 1},
            {"date": pd.Timestamp("2024-01-15", tz="UTC"), "home": "B", "away": "C", "ftr": "A", "fthg": 0, "ftag": 1},
            {"date": pd.Timestamp("2024-01-22", tz="UTC"), "home": "A", "away": "C", "ftr": "H", "fthg": 3, "ftag": 2},
            {"date": pd.Timestamp("2024-01-29", tz="UTC"), "home": "B", "away": "A", "ftr": "A", "fthg": 0, "ftag": 2},
        ]
    )


def test_batch_compute_deterministic():
    matches = _toy_matches()
    aug1, state1 = batch_compute(matches, EloConfig())
    aug2, state2 = batch_compute(matches, EloConfig())
    assert state1.keys() == state2.keys()
    for team in state1:
        assert state1[team].rating == state2[team].rating
        assert state1[team].matches_played == state2[team].matches_played
    pd.testing.assert_frame_equal(aug1, aug2)


def test_batch_compute_winner_outranks_loser():
    matches = _toy_matches()
    _, state = batch_compute(matches, EloConfig())
    # A is unbeaten (2W + 1D); B lost twice.
    assert state["A"].rating > state["B"].rating
    # All teams played at least one match.
    assert all(s.matches_played >= 2 for s in state.values())


def test_batch_compute_first_match_pre_ratings_are_initial():
    matches = _toy_matches()
    aug, _ = batch_compute(matches, EloConfig(initial_rating=1500))
    # First match: both teams are at 1500 going in.
    first = aug.iloc[0]
    assert first["home_elo_pre"] == 1500
    assert first["away_elo_pre"] == 1500


def test_batch_compute_pre_ratings_lag_post_ratings():
    matches = _toy_matches()
    aug, _ = batch_compute(matches, EloConfig())
    # Team A plays match 0 (vs B, home win) then match 1 (vs C, draw).
    # Its pre-rating for match 1 should NOT be 1500 anymore — it rose
    # after the match-0 win.
    a_match1 = aug[(aug["away"] == "A") & (aug["home"] == "C")].iloc[0]
    assert a_match1["away_elo_pre"] > 1500


def _multi_season_matches() -> pd.DataFrame:
    """Two seasons. Season 1 has teams A,B,C. Season 2 introduces team D
    after A,B,C have differentiated their ratings."""
    return pd.DataFrame(
        [
            # --- Season s1: ABC play each other, A dominates, C tanks ---
            {"date": pd.Timestamp("2023-08-01", tz="UTC"), "home": "A", "away": "B", "ftr": "H", "fthg": 3, "ftag": 0, "season": "s1"},
            {"date": pd.Timestamp("2023-08-08", tz="UTC"), "home": "B", "away": "C", "ftr": "H", "fthg": 2, "ftag": 0, "season": "s1"},
            {"date": pd.Timestamp("2023-08-15", tz="UTC"), "home": "A", "away": "C", "ftr": "H", "fthg": 4, "ftag": 0, "season": "s1"},
            {"date": pd.Timestamp("2023-08-22", tz="UTC"), "home": "C", "away": "A", "ftr": "A", "fthg": 0, "ftag": 3, "season": "s1"},
            # --- Season s2: D appears for the first time ---
            {"date": pd.Timestamp("2024-08-10", tz="UTC"), "home": "D", "away": "A", "ftr": "A", "fthg": 0, "ftag": 2, "season": "s2"},
            {"date": pd.Timestamp("2024-08-17", tz="UTC"), "home": "B", "away": "D", "ftr": "H", "fthg": 1, "ftag": 0, "season": "s2"},
        ]
    )


def test_promoted_team_starts_at_min_rating_after_first_season():
    matches = _multi_season_matches()
    cfg = EloConfig(promoted_team_strategy="min_rating")
    aug, state = batch_compute(matches, cfg)

    # By end of season 1, C has lost twice and drawn nothing — it has the
    # lowest rating among A/B/C. D appears in season 2; its pre-match
    # rating (for the first match it plays — D vs A) should equal C's
    # rating going into that match, i.e. min(A_rating, B_rating, C_rating)
    # as of season 2's start.
    d_first_match = aug[aug["home"] == "D"].iloc[0]
    # The min rating going into season 2 is C's (the worst performer).
    # Reconstruct C's rating at end of season 1 by running a fresh Elo on
    # just season 1.
    s1 = matches[matches["season"] == "s1"]
    _, s1_state = batch_compute(s1, cfg)
    c_end_of_s1 = s1_state["C"].rating
    a_end_of_s1 = s1_state["A"].rating
    b_end_of_s1 = s1_state["B"].rating
    expected_d_start = min(a_end_of_s1, b_end_of_s1, c_end_of_s1)
    assert d_first_match["home_elo_pre"] == expected_d_start
    # And D's start should clearly be below initial_rating (since the
    # league has shaken out into a hierarchy).
    assert state["D"].matches_played == 2


def test_first_season_new_teams_all_start_at_initial_rating():
    # Vanilla expectation: every team in the first season starts at 1500
    # regardless of strategy, because there's no "current league" to peg
    # the min off of yet.
    matches = _multi_season_matches()
    cfg = EloConfig(promoted_team_strategy="min_rating")
    aug, _ = batch_compute(matches, cfg)
    first_match = aug.iloc[0]
    assert first_match["home_elo_pre"] == cfg.initial_rating
    assert first_match["away_elo_pre"] == cfg.initial_rating


def test_initial_strategy_keeps_vanilla_behavior():
    # Opt back into the old "everyone starts at 1500" behavior.
    matches = _multi_season_matches()
    cfg = EloConfig(promoted_team_strategy="initial")
    aug, _ = batch_compute(matches, cfg)
    # D's first appearance should be at initial_rating, NOT min of others.
    d_first_match = aug[aug["home"] == "D"].iloc[0]
    assert d_first_match["home_elo_pre"] == cfg.initial_rating


def test_promoted_strategy_no_op_without_season_column():
    # Backward-compat: data without a `season` column behaves as
    # vanilla Elo (initial rating for every new team). The first toy
    # dataset has no `season` column.
    matches = _toy_matches()
    cfg = EloConfig(promoted_team_strategy="min_rating")
    aug, _ = batch_compute(matches, cfg)
    # Every new-team-first-appearance row should show initial_rating
    seen: set[str] = set()
    for row in aug.itertuples(index=False):
        if row.home not in seen:
            assert row.home_elo_pre == cfg.initial_rating
            seen.add(row.home)
        if row.away not in seen:
            assert row.away_elo_pre == cfg.initial_rating
            seen.add(row.away)
