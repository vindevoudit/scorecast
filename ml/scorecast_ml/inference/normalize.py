"""3-class (P_home, P_draw, P_away) → 2-class (home_out, away_out).

Per the plan §3, draw mass is redistributed proportionally to the
home/away weights:

    home_out = P_h + (P_h / (P_h + P_a)) · P_d
    away_out = P_a + (P_a / (P_h + P_a)) · P_d

which algebraically simplifies to:

    home_out = P_h / (P_h + P_a)
    away_out = P_a / (P_h + P_a)

so the sum is exactly 1.0 by construction. We use the redistribute form
because it makes the intent clearer at the call site.

The DB column is DECIMAL(3,2). Round to 2 decimals AND re-balance so the
rounded pair still sums to 1.00 — otherwise ~5% of writes will fail the
backend's `sum-to-1 ± 0.01` validator.

Also: avoid emitting (0.50, 0.50) exactly. That's the "untouched by anyone"
sentinel from services/LeagueService.upsertFixture; emitting it would
confuse the skip-existing logic on the next run.
"""

from __future__ import annotations

from dataclasses import dataclass


_EPS = 1e-9
_SENTINEL = (0.50, 0.50)


@dataclass(frozen=True)
class Pair:
    home: float
    away: float

    def as_tuple(self) -> tuple[float, float]:
        return (self.home, self.away)


def redistribute_draw_to_two_way(p_h: float, p_d: float, p_a: float) -> Pair:
    """Apply the redistribution formula. No rounding."""
    denom = p_h + p_a
    if denom <= _EPS:
        # Pathological: model thinks the draw is ~100% likely. Fall back
        # to 0.5/0.5 — caller will sentinel-nudge.
        return Pair(home=0.5, away=0.5)
    home = p_h + (p_h / denom) * p_d
    away = p_a + (p_a / denom) * p_d
    return Pair(home=home, away=away)


def round_and_rebalance(pair: Pair, *, decimals: int = 2) -> Pair:
    """Round both sides to `decimals` and re-balance so they sum to
    exactly 1.0 to that precision (no validator-tripping `1.01`).

    Strategy: round the LARGER side first, set the smaller = 1.00 - larger.
    The larger side is what the model is most confident about — keeping its
    rounded value avoids loss of meaningful precision.
    """
    if pair.home >= pair.away:
        larger = round(pair.home, decimals)
        smaller = round(1.0 - larger, decimals)
        return Pair(home=larger, away=smaller)
    else:
        larger = round(pair.away, decimals)
        smaller = round(1.0 - larger, decimals)
        return Pair(home=smaller, away=larger)


def nudge_off_sentinel(pair: Pair, *, raw_pair: Pair | None = None) -> Pair:
    """If the rounded pair lands on (0.50, 0.50), push it off by 0.01.

    Direction taken from the raw (pre-rounding) pair when available;
    otherwise defaults to home-favored (matches the typical home edge in
    football and matches what an admin would intuit from a coin-flip
    match in a home venue).
    """
    if pair.as_tuple() != _SENTINEL:
        return pair
    nudge_home = True
    if raw_pair is not None:
        nudge_home = raw_pair.home >= raw_pair.away
    if nudge_home:
        return Pair(home=0.51, away=0.49)
    return Pair(home=0.49, away=0.51)


def to_two_way(p_h: float, p_d: float, p_a: float) -> Pair:
    """End-to-end: redistribute → round → rebalance → sentinel-nudge."""
    if not (-_EPS <= p_h <= 1 + _EPS and -_EPS <= p_d <= 1 + _EPS and -_EPS <= p_a <= 1 + _EPS):
        raise ValueError(f"Probabilities out of [0, 1]: ({p_h}, {p_d}, {p_a})")
    total = p_h + p_d + p_a
    # Tolerate up to 5% drift (e.g. from a calibrator that doesn't exactly
    # sum to 1) and silently re-normalize. Anything wilder is a broken
    # model output — raise so we don't silently write nonsense.
    if abs(total - 1.0) > 0.05:
        raise ValueError(
            f"Probabilities don't sum to ~1.0: {total:.4f} = {p_h}+{p_d}+{p_a}"
        )
    if abs(total - 1.0) > 1e-6:
        p_h, p_d, p_a = p_h / total, p_d / total, p_a / total

    raw = redistribute_draw_to_two_way(p_h, p_d, p_a)
    rounded = round_and_rebalance(raw, decimals=2)
    final = nudge_off_sentinel(rounded, raw_pair=raw)
    return final
