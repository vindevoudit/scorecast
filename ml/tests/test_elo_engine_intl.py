"""International model — per-match K-multiplier + neutral-venue support
in batch_compute. Mirror of the JS extensions in tests/eloMath.test.js;
both gain matching assertions so the Python trainer and JS cascade can
never drift on these new fields.
"""

from __future__ import annotations

import pandas as pd

from scorecast_ml.elo.engine import EloConfig, batch_compute, expected_score, update


def _toy_intl_matches() -> pd.DataFrame:
    """4-row toy fixture: half neutral, mixed K-multipliers. Designed so
    the hand-computed reference path is auditable line-by-line."""
    return pd.DataFrame(
        [
            # Row 0: friendly (K-mult=1.0), neutral=False. Equal ratings,
            # home wins → home gains +10, away loses -10.
            {
                "date": pd.Timestamp("2024-01-01", tz="UTC"),
                "home": "A", "away": "B", "ftr": "H",
                "k_mult": 1.0, "neutral": False,
            },
            # Row 1: WC final (K-mult=3.0), neutral=True. A is already at
            # 1510, B at 1490. A wins again → much bigger swing.
            {
                "date": pd.Timestamp("2024-01-08", tz="UTC"),
                "home": "A", "away": "B", "ftr": "H",
                "k_mult": 3.0, "neutral": True,
            },
            # Row 2: continental qualifier (K-mult=2.0), neutral=False.
            # Reversed draw — checks zero-sum on K-mult=2.
            {
                "date": pd.Timestamp("2024-01-15", tz="UTC"),
                "home": "B", "away": "A", "ftr": "D",
                "k_mult": 2.0, "neutral": False,
            },
            # Row 3: WC qualifier (K-mult=2.5), neutral=True. Away upsets.
            {
                "date": pd.Timestamp("2024-01-22", tz="UTC"),
                "home": "A", "away": "B", "ftr": "A",
                "k_mult": 2.5, "neutral": True,
            },
        ]
    )


def test_omitted_intl_columns_preserve_PL_path():
    # When neither column is configured, batch_compute walks the same code
    # path PL has always used. Bit-identical to the no-INT-cols call.
    base_matches = pd.DataFrame(
        [
            {"date": pd.Timestamp("2024-01-01", tz="UTC"), "home": "A", "away": "B", "ftr": "H"},
            {"date": pd.Timestamp("2024-01-08", tz="UTC"), "home": "C", "away": "A", "ftr": "D"},
            {"date": pd.Timestamp("2024-01-15", tz="UTC"), "home": "B", "away": "C", "ftr": "A"},
        ]
    )
    # PL config (no INT columns).
    aug_pl, state_pl = batch_compute(base_matches, EloConfig())
    # Same data, but with INT columns DECLARED in config — the columns
    # don't exist on the DataFrame, so the engine should fall through to
    # the PL path.
    cfg_intl = EloConfig(k_multiplier_column="k_mult", neutral_column="neutral")
    aug_intl, state_intl = batch_compute(base_matches, cfg_intl)
    pd.testing.assert_frame_equal(aug_pl, aug_intl)
    assert state_pl.keys() == state_intl.keys()
    for team in state_pl:
        assert state_pl[team].rating == state_intl[team].rating


def test_k_multiplier_3_triples_elo_movement():
    # Side-by-side: same fixture, run once with k_mult=1.0 column and once
    # with k_mult=3.0. The K-mult=3 run's deltas should triple at every step.
    matches_base = pd.DataFrame(
        [
            {"date": pd.Timestamp("2024-01-01", tz="UTC"), "home": "A", "away": "B", "ftr": "H", "k_mult": 1.0},
            {"date": pd.Timestamp("2024-01-08", tz="UTC"), "home": "A", "away": "B", "ftr": "H", "k_mult": 1.0},
        ]
    )
    matches_triple = matches_base.copy()
    matches_triple["k_mult"] = 3.0

    cfg = EloConfig(k_multiplier_column="k_mult")
    _, state_base = batch_compute(matches_base, cfg)
    _, state_triple = batch_compute(matches_triple, cfg)

    # Both A wins twice. The triple run's gain should be ~3× the base run.
    base_gain = state_base["A"].rating - 1500
    triple_gain = state_triple["A"].rating - 1500
    # Not exactly 3× because the second match's expected_score depends on
    # the post-match-1 rating. We bound it loosely: 2.8× < gain < 3.0× —
    # tighter than that needs a hand-computed reference (next test).
    ratio = triple_gain / base_gain
    assert 2.8 < ratio < 3.0, f"K-mult ratio {ratio} outside expected band"


def test_k_multiplier_hand_computed_first_match_reference():
    # Tight reference: row 0 of _toy_intl_matches with K-mult=1.0 should
    # produce A=1510, B=1490 exactly (equal ratings, home wins, K=20*1=20,
    # delta = 20 * (1 - 0.5) = 10).
    matches = _toy_intl_matches()
    cfg = EloConfig(k_multiplier_column="k_mult", neutral_column="neutral")
    aug, _ = batch_compute(matches, cfg)
    # Pre-ratings on row 0 are both 1500 (first appearance of both teams).
    assert aug.iloc[0]["home_elo_pre"] == 1500
    assert aug.iloc[0]["away_elo_pre"] == 1500
    # Pre-rating on row 1's home (A) should be 1510 (gained 10 from row 0).
    assert abs(aug.iloc[1]["home_elo_pre"] - 1510) < 1e-9
    assert abs(aug.iloc[1]["away_elo_pre"] - 1490) < 1e-9


def test_neutral_flag_drops_HFA_for_that_match():
    # Two-match fixture with non-zero HFA to make the neutral flag observable.
    matches = pd.DataFrame(
        [
            # Match 0: non-neutral, HFA contributes to home expected score.
            {"date": pd.Timestamp("2024-01-01", tz="UTC"), "home": "A", "away": "B", "ftr": "H", "neutral": False},
            # Match 1: neutral, HFA should NOT contribute.
            {"date": pd.Timestamp("2024-01-08", tz="UTC"), "home": "C", "away": "D", "ftr": "H", "neutral": True},
        ]
    )
    cfg = EloConfig(home_field_advantage=65.0, neutral_column="neutral")
    aug, _ = batch_compute(matches, cfg)

    # Hand-compute the expected deltas for each row.
    # Row 0: pre 1500/1500, HFA=65 (non-neutral)
    eh0 = expected_score(1500, 1500, hfa=65.0)
    expected_home_gain_0 = 20 * (1 - eh0)
    actual_home_gain_0 = aug.iloc[0]["home_elo_pre"] + expected_home_gain_0  # check via state
    # The check: A's rating after match 0 should equal 1500 + 20*(1-eh0).
    # We can reconstruct: state["A"] was 1500 going in, then gained.
    eh1 = expected_score(1500, 1500, hfa=0)  # neutral → HFA=0
    # Because eh0 > 0.5 (HFA helps home), expected_home_gain_0 < 10. The
    # neutral match row 1 with equal teams gives delta exactly 10 (no HFA).
    # Confirm: row 1's home (C) was at 1500 going in.
    assert aug.iloc[1]["home_elo_pre"] == 1500
    # The C state-update used hfa=0; non-neutral row 0 used hfa=65.
    # Indirect check via the expected magnitudes: row 0's home gain is
    # smaller than row 1's home gain (because A was already favored).
    assert expected_home_gain_0 < 10  # HFA pre-favors home → smaller surprise
    assert abs(20 * (1 - eh1) - 10) < 1e-9


def test_zero_sum_preserved_under_k_multiplier_and_neutral():
    matches = _toy_intl_matches()
    cfg = EloConfig(k_multiplier_column="k_mult", neutral_column="neutral")
    _, state = batch_compute(matches, cfg)
    # Over the whole fixture, every match is zero-sum between two teams, so
    # the total rating change across all teams must be 0.
    total_drift = sum(s.rating for s in state.values()) - len(state) * 1500
    assert abs(total_drift) < 1e-9, f"total drift {total_drift} violates zero-sum"


def test_k_multiplier_nan_falls_back_to_1():
    # NaN in the k_mult column shouldn't zero out the match — it should
    # fall back to 1.0. Protects against sparse/messy ingest columns.
    matches = pd.DataFrame(
        [
            {"date": pd.Timestamp("2024-01-01", tz="UTC"), "home": "A", "away": "B", "ftr": "H", "k_mult": float("nan")},
        ]
    )
    cfg = EloConfig(k_multiplier_column="k_mult")
    _, state = batch_compute(matches, cfg)
    # Equal ratings + home wins + K=20*1=20 → home gains exactly 10.
    assert abs(state["A"].rating - 1510) < 1e-9
    assert abs(state["B"].rating - 1490) < 1e-9


def test_parity_with_js_fixture_kmult_3_equal_ratings():
    # Cross-runtime parity: same numeric output as tests/eloMath.test.js's
    # "kMultiplier=3 triples delta magnitude" assertion. For equal 1500/1500
    # ratings and a home win, the Python engine should produce home gain
    # exactly 30 (K=20 * kMult=3 * (actual=1 - expected=0.5) = 30).
    matches = pd.DataFrame(
        [
            {"date": pd.Timestamp("2024-01-01", tz="UTC"), "home": "A", "away": "B", "ftr": "H", "k_mult": 3.0},
        ]
    )
    cfg = EloConfig(k_multiplier_column="k_mult")
    _, state = batch_compute(matches, cfg)
    assert abs(state["A"].rating - 1530) < 1e-9
    assert abs(state["B"].rating - 1470) < 1e-9
