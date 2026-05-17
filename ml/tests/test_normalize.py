"""Draw-redistribution invariants. The single most load-bearing math in
the pipeline — every probability written to the DB flows through to_two_way.
"""

from __future__ import annotations

import pytest

from scorecast_ml.inference.normalize import (
    Pair,
    Triple,
    nudge_off_sentinel,
    nudge_off_triple_sentinel,
    redistribute_draw_to_two_way,
    round_and_rebalance,
    round_and_rebalance_triple,
    to_three_way,
    to_two_way,
)


def test_redistribute_matches_simple_normalize():
    # Proof in plan §3: the redistribution formula is algebraically
    # identical to home / (home + away). Verify numerically.
    cases = [
        (0.45, 0.30, 0.25),
        (0.60, 0.20, 0.20),
        (0.10, 0.50, 0.40),
        (0.33, 0.34, 0.33),
    ]
    for p_h, p_d, p_a in cases:
        pair = redistribute_draw_to_two_way(p_h, p_d, p_a)
        denom = p_h + p_a
        assert abs(pair.home - p_h / denom) < 1e-12
        assert abs(pair.away - p_a / denom) < 1e-12
        assert abs(pair.home + pair.away - 1.0) < 1e-12


def test_redistribute_handles_certain_draw():
    # Pathological: model predicts ~100% draw. We fall back to 0.5/0.5.
    pair = redistribute_draw_to_two_way(0.0, 1.0, 0.0)
    assert pair.home == 0.5
    assert pair.away == 0.5


def test_round_and_rebalance_sum_invariant_grid():
    # Sweep a grid; every rounded pair must sum to exactly 1.0.
    for x in range(1, 100):
        raw = Pair(home=x / 100, away=1 - x / 100)
        rounded = round_and_rebalance(raw, decimals=2)
        assert abs(rounded.home + rounded.away - 1.0) < 1e-9, raw


def test_round_and_rebalance_keeps_larger_side_pristine():
    # The larger side (model's confident pick) keeps its rounded value;
    # the smaller side absorbs the rounding residual.
    raw = Pair(home=0.673, away=0.327)
    rounded = round_and_rebalance(raw, decimals=2)
    assert rounded.home == 0.67
    assert rounded.away == 0.33


def test_nudge_off_sentinel_pushes_home_when_raw_favors_home():
    # Rounded pair lands on the sentinel; raw favored home → nudge home up.
    rounded = Pair(home=0.50, away=0.50)
    raw = Pair(home=0.504, away=0.496)
    nudged = nudge_off_sentinel(rounded, raw_pair=raw)
    assert nudged.home == 0.51
    assert nudged.away == 0.49


def test_nudge_off_sentinel_pushes_away_when_raw_favors_away():
    rounded = Pair(home=0.50, away=0.50)
    raw = Pair(home=0.496, away=0.504)
    nudged = nudge_off_sentinel(rounded, raw_pair=raw)
    assert nudged.home == 0.49
    assert nudged.away == 0.51


def test_nudge_off_sentinel_no_op_when_not_sentinel():
    rounded = Pair(home=0.51, away=0.49)
    assert nudge_off_sentinel(rounded) == rounded


def test_to_two_way_end_to_end_sum_invariant():
    # Sweep a 3-class grid; every emitted (home_out, away_out) sums to 1.0
    # AND is not the (0.50, 0.50) sentinel.
    for h_pct in range(5, 96, 5):
        for d_pct in range(0, 96 - h_pct, 5):
            a_pct = 100 - h_pct - d_pct
            if a_pct < 5:
                continue
            pair = to_two_way(h_pct / 100, d_pct / 100, a_pct / 100)
            assert abs(pair.home + pair.away - 1.0) < 1e-9
            assert (pair.home, pair.away) != (0.50, 0.50)


def test_to_two_way_rejects_individual_out_of_range():
    with pytest.raises(ValueError):
        to_two_way(1.5, 0.0, 0.0)  # P_h > 1
    with pytest.raises(ValueError):
        to_two_way(-0.01, 0.5, 0.51)


def test_to_two_way_rejects_wildly_off_sum():
    with pytest.raises(ValueError):
        to_two_way(0.5, 0.5, 0.5)  # sums to 1.5 — broken model output


def test_to_two_way_silently_renormalizes_small_drift():
    # 1% drift (sklearn calibrator might do this) → silent renorm + write.
    pair = to_two_way(0.50, 0.30, 0.21)  # sums to 1.01
    assert abs(pair.home + pair.away - 1.0) < 1e-9


def test_to_two_way_clean_5050_input_avoids_sentinel():
    # If the model says (0.33, 0.34, 0.33), redistribute → (0.5, 0.5),
    # which would hit the sentinel — must be nudged.
    pair = to_two_way(0.33, 0.34, 0.33)
    assert (pair.home, pair.away) != (0.50, 0.50)
    # Either (0.49, 0.51) or (0.51, 0.49); doesn't matter which here.
    assert {pair.home, pair.away} == {0.49, 0.51}


def test_to_two_way_strong_favorite_routes_correctly():
    # Model strongly favors home: (0.7, 0.2, 0.1).
    # Expected normalize → (0.7/0.8, 0.1/0.8) = (0.875, 0.125)
    # Rounded → (0.88, 0.12).
    pair = to_two_way(0.70, 0.20, 0.10)
    assert pair.home == 0.88
    assert pair.away == 0.12


# ---------------------------------------------------------------------------
# 3-class (draw-scoring) tests
# ---------------------------------------------------------------------------


def test_to_three_way_sum_invariant_grid():
    # Sweep the (P_h, P_d, P_a) simplex on a 5% grid; every rounded trio
    # must sum to exactly 1.0 at DECIMAL(3,2) precision.
    for h_pct in range(5, 91, 5):
        for d_pct in range(0, 96 - h_pct, 5):
            a_pct = 100 - h_pct - d_pct
            if a_pct < 5:
                continue
            triple = to_three_way(h_pct / 100, d_pct / 100, a_pct / 100)
            total = round(triple.home + triple.draw + triple.away, 2)
            assert total == 1.0, (h_pct, d_pct, a_pct, triple)


def test_to_three_way_nudges_off_post_migration_sentinel():
    # (0.5, 0.0, 0.5) is the new "untouched by anyone" sentinel — the
    # post-migration default for fresh games. to_three_way must nudge
    # off it so the next run's skip-existing logic doesn't treat
    # ML-written rows as untouched.
    triple = to_three_way(0.50, 0.00, 0.50)
    assert triple.as_tuple() != (0.50, 0.00, 0.50)
    assert triple.draw == 0.00
    # Tied home/away nudges home-favored (>= comparison).
    assert (triple.home, triple.away) == (0.51, 0.49)


def test_to_three_way_preserves_largest_after_rounding():
    # The class with the highest raw probability should still be the
    # largest after rounding + rebalance. Pick a wide-but-rounding-prone
    # input.
    triple = to_three_way(0.333, 0.334, 0.333)
    largest_raw = "draw"  # 0.334 is the max
    values = {"home": triple.home, "draw": triple.draw, "away": triple.away}
    assert max(values, key=values.get) == largest_raw


def test_round_and_rebalance_triple_absorbs_error_into_largest():
    # Raw rounds to 0.33 / 0.33 / 0.33 → sum 0.99 (short 0.01). Largest
    # (here: draw, 0.334) absorbs the 0.01 → (0.33, 0.34, 0.33).
    raw = Triple(home=0.333, draw=0.334, away=0.333)
    rounded = round_and_rebalance_triple(raw, decimals=2)
    assert (rounded.home, rounded.draw, rounded.away) == (0.33, 0.34, 0.33)


def test_nudge_off_triple_sentinel_no_op_when_not_sentinel():
    # Trio that isn't the sentinel passes through unchanged.
    triple = Triple(home=0.51, draw=0.00, away=0.49)
    assert nudge_off_triple_sentinel(triple) == triple
