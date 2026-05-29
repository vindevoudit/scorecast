"""International ingest — schema, K-mult tier mapping, former-names
date-windowed rewrite, real-dataset coverage audit.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
import pytest

from scorecast_ml.ingest.international import (
    _KMULT_TABLE,
    apply_former_names,
    derive_k_multiplier,
    parse_intl_csv,
)

# Repository root, so we can hit the real committed dataset for the
# coverage-audit test. Tests adjacent to ml/scorecast_ml live at
# c:\Users\vinde\OneDrive\Desktop\ScoreCast\ml\tests\, so 2 levels up
# is the project root.
REPO_ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_DIR = REPO_ROOT / "international_match_archive"
REAL_RESULTS = ARCHIVE_DIR / "results.csv"
REAL_FORMER_NAMES = ARCHIVE_DIR / "former_names.csv"


# ---------------------------------------------------------------------------
# K-mult tier table
# ---------------------------------------------------------------------------


def test_derive_k_multiplier_known_tiers():
    # Spot-check each tier so a casual reader can audit the mapping at a glance.
    assert derive_k_multiplier("FIFA World Cup") == 3.0
    assert derive_k_multiplier("FIFA World Cup qualification") == 2.5
    assert derive_k_multiplier("UEFA Euro") == 2.5
    assert derive_k_multiplier("Copa América") == 2.5
    assert derive_k_multiplier("African Cup of Nations") == 2.5
    assert derive_k_multiplier("AFC Asian Cup") == 2.5
    assert derive_k_multiplier("Gold Cup") == 2.5
    assert derive_k_multiplier("UEFA Euro qualification") == 2.0
    assert derive_k_multiplier("UEFA Nations League") == 2.0
    assert derive_k_multiplier("Confederations Cup") == 1.5
    assert derive_k_multiplier("Olympic Games") == 1.5  # prefix-match branch
    assert derive_k_multiplier("Friendly") == 1.0


def test_derive_k_multiplier_unknown_defaults_to_friendly():
    assert derive_k_multiplier("Some Local Invitational That Nobody Watches") == 1.0
    assert derive_k_multiplier("") == 1.0


@pytest.mark.skipif(not REAL_RESULTS.exists(), reason="real dataset not present")
def test_kmult_covers_observed_major_tournaments():
    """Coverage audit against the real dataset.

    Top-15 tournaments by row count MUST be explicitly mapped in the
    K-mult table — no silent default-to-1.0 misclassifications for major
    competitions. Lower-volume regional cups can fall through to 1.0
    (acceptable — they're closer to friendly-tier in stakes).
    """
    counts: dict[str, int] = {}
    with open(REAL_RESULTS, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            t = (row.get("tournament") or "").strip()
            if t:
                counts[t] = counts.get(t, 0) + 1

    top = sorted(counts.items(), key=lambda kv: -kv[1])[:15]
    # Every top-15 tournament should appear in the table OR get caught by the
    # Olympics prefix-match branch. We accept fall-through to 1.0 only for
    # the regional sub-confederation cups that are documented out-of-tier
    # (CECAFA / Merdeka / British Home Championship / etc. — they're
    # historically friendly-equivalent).
    documented_friendly_tier = {
        "CECAFA Cup",
        "CFU Caribbean Cup qualification",
        "Merdeka Tournament",
        "British Home Championship",
    }
    for tournament, count in top:
        in_table = tournament in _KMULT_TABLE
        is_olympics = "Olympic" in tournament
        is_documented_friendly = tournament in documented_friendly_tier
        assert in_table or is_olympics or is_documented_friendly, (
            f"top tournament {tournament!r} ({count} rows) is not in the K-mult "
            f"table and not in the documented friendly-tier fall-through list. "
            f"Either add it to _KMULT_TABLE or extend the documented_friendly_tier "
            f"set in this test."
        )


# ---------------------------------------------------------------------------
# Former-names date-windowed rewrites
# ---------------------------------------------------------------------------


def _write_former_names(tmp_path: Path, rows: list[dict[str, str]]) -> Path:
    p = tmp_path / "former_names.csv"
    with open(p, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["current", "former", "start_date", "end_date"])
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
    return p


def test_apply_former_names_in_window_rewrites(tmp_path: Path):
    df = pd.DataFrame(
        [
            # Inside the USSR window — should be rewritten to Russia.
            {"date": pd.Timestamp("1980-06-01", tz="UTC"), "home": "Soviet Union", "away": "Brazil"},
            # AFTER the USSR window closes — stays as Russia.
            {"date": pd.Timestamp("1995-06-01", tz="UTC"), "home": "Russia", "away": "Brazil"},
        ]
    )
    former = _write_former_names(
        tmp_path,
        [{"current": "Russia", "former": "Soviet Union", "start_date": "1924-11-16", "end_date": "1991-11-13"}],
    )
    out = apply_former_names(df, former)
    assert list(out["home"]) == ["Russia", "Russia"]


def test_apply_former_names_outside_window_does_not_rewrite(tmp_path: Path):
    df = pd.DataFrame(
        [
            # Match BEFORE the window opens — should NOT be rewritten.
            {"date": pd.Timestamp("1920-06-01", tz="UTC"), "home": "Soviet Union", "away": "Brazil"},
        ]
    )
    former = _write_former_names(
        tmp_path,
        [{"current": "Russia", "former": "Soviet Union", "start_date": "1924-11-16", "end_date": "1991-11-13"}],
    )
    out = apply_former_names(df, former)
    # Pre-window matches keep the original name.
    assert list(out["home"]) == ["Soviet Union"]


def test_apply_former_names_rewrites_both_home_and_away(tmp_path: Path):
    df = pd.DataFrame(
        [
            {"date": pd.Timestamp("1980-06-01", tz="UTC"), "home": "Brazil", "away": "Soviet Union"},
        ]
    )
    former = _write_former_names(
        tmp_path,
        [{"current": "Russia", "former": "Soviet Union", "start_date": "1924-11-16", "end_date": "1991-11-13"}],
    )
    out = apply_former_names(df, former)
    assert out.iloc[0]["home"] == "Brazil"
    assert out.iloc[0]["away"] == "Russia"


# ---------------------------------------------------------------------------
# Full parse_intl_csv against synthetic + real fixtures
# ---------------------------------------------------------------------------


def _write_results(tmp_path: Path, rows: list[dict[str, str]]) -> Path:
    p = tmp_path / "results.csv"
    cols = ["date", "home_team", "away_team", "home_score", "away_score", "tournament", "city", "country", "neutral"]
    with open(p, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=cols)
        writer.writeheader()
        for r in rows:
            writer.writerow(r)
    return p


def test_parse_intl_csv_minimal_happy_path(tmp_path: Path):
    results = _write_results(
        tmp_path,
        [
            {"date": "2018-07-15", "home_team": "France", "away_team": "Croatia",
             "home_score": "4", "away_score": "2", "tournament": "FIFA World Cup",
             "city": "Moscow", "country": "Russia", "neutral": "TRUE"},
            {"date": "2024-03-22", "home_team": "Argentina", "away_team": "Brazil",
             "home_score": "1", "away_score": "1", "tournament": "Friendly",
             "city": "Buenos Aires", "country": "Argentina", "neutral": "FALSE"},
        ],
    )
    former = _write_former_names(tmp_path, [])

    out = parse_intl_csv(results, former)
    assert len(out) == 2
    # Schema columns present.
    for col in ("date", "home", "away", "ftr", "fthg", "ftag", "tournament", "neutral", "k_mult", "league", "season"):
        assert col in out.columns, f"missing column {col}"
    # K-mult derived correctly.
    assert out.iloc[0]["k_mult"] == 3.0
    assert out.iloc[1]["k_mult"] == 1.0
    # FTR derived correctly.
    assert out.iloc[0]["ftr"] == "H"
    assert out.iloc[1]["ftr"] == "D"
    # Neutral boolean parsed correctly.
    assert out.iloc[0]["neutral"] is True or out.iloc[0]["neutral"] == True  # numpy bool
    assert out.iloc[1]["neutral"] is False or out.iloc[1]["neutral"] == False
    # League stamped.
    assert (out["league"] == "INT").all()
    # Season is calendar year as string.
    assert out.iloc[0]["season"] == "2018"


def test_parse_intl_csv_drops_future_fixtures_with_NA_scores(tmp_path: Path):
    # Future WC fixtures in the real dataset have literal 'NA' score
    # strings. The ingest must drop them silently so the trainer doesn't
    # see ghost data.
    results = _write_results(
        tmp_path,
        [
            {"date": "2018-07-15", "home_team": "France", "away_team": "Croatia",
             "home_score": "4", "away_score": "2", "tournament": "FIFA World Cup",
             "city": "Moscow", "country": "Russia", "neutral": "TRUE"},
            # Future fixture — NA scores
            {"date": "2026-06-27", "home_team": "Croatia", "away_team": "Ghana",
             "home_score": "NA", "away_score": "NA", "tournament": "FIFA World Cup",
             "city": "Philadelphia", "country": "United States", "neutral": "TRUE"},
        ],
    )
    former = _write_former_names(tmp_path, [])
    out = parse_intl_csv(results, former)
    assert len(out) == 1
    assert out.iloc[0]["date"].year == 2018


def test_parse_intl_csv_applies_former_names_inline(tmp_path: Path):
    # USSR match should arrive in the output as "Russia" (former-names
    # rewrite is applied inside parse_intl_csv, not as a separate step).
    results = _write_results(
        tmp_path,
        [
            {"date": "1980-06-01", "home_team": "Soviet Union", "away_team": "Brazil",
             "home_score": "1", "away_score": "2", "tournament": "Friendly",
             "city": "Moscow", "country": "Russia", "neutral": "FALSE"},
        ],
    )
    former = _write_former_names(
        tmp_path,
        [{"current": "Russia", "former": "Soviet Union",
          "start_date": "1924-11-16", "end_date": "1991-11-13"}],
    )
    out = parse_intl_csv(results, former)
    assert out.iloc[0]["home"] == "Russia"


def test_parse_intl_csv_chronological_order(tmp_path: Path):
    results = _write_results(
        tmp_path,
        [
            # Deliberately out-of-order on disk.
            {"date": "2024-03-22", "home_team": "Argentina", "away_team": "Brazil",
             "home_score": "1", "away_score": "1", "tournament": "Friendly",
             "city": "Buenos Aires", "country": "Argentina", "neutral": "FALSE"},
            {"date": "2018-07-15", "home_team": "France", "away_team": "Croatia",
             "home_score": "4", "away_score": "2", "tournament": "FIFA World Cup",
             "city": "Moscow", "country": "Russia", "neutral": "TRUE"},
        ],
    )
    former = _write_former_names(tmp_path, [])
    out = parse_intl_csv(results, former)
    # batch_compute requires chronological order — verify it's sorted.
    assert out.iloc[0]["date"] < out.iloc[1]["date"]


def test_parse_intl_csv_drops_self_vs_self_rows(tmp_path: Path):
    # Should never happen in practice, but guard against it.
    results = _write_results(
        tmp_path,
        [
            {"date": "2018-07-15", "home_team": "France", "away_team": "France",
             "home_score": "0", "away_score": "0", "tournament": "Friendly",
             "city": "Paris", "country": "France", "neutral": "FALSE"},
            {"date": "2018-07-22", "home_team": "Germany", "away_team": "Italy",
             "home_score": "1", "away_score": "0", "tournament": "Friendly",
             "city": "Berlin", "country": "Germany", "neutral": "FALSE"},
        ],
    )
    former = _write_former_names(tmp_path, [])
    out = parse_intl_csv(results, former)
    assert len(out) == 1
    assert out.iloc[0]["home"] == "Germany"


@pytest.mark.skipif(not REAL_RESULTS.exists(), reason="real dataset not present")
def test_parse_intl_csv_loads_real_dataset_without_errors():
    """Real-dataset smoke test. Loads the committed CSVs end-to-end and
    sanity-checks the row count + date range. Catches schema drift in
    a future Kaggle redrop."""
    out = parse_intl_csv(REAL_RESULTS, REAL_FORMER_NAMES)
    # Dataset has ~47-49k rows; future fixtures (NA scores) are dropped.
    assert 40000 < len(out) < 50000, f"unexpected row count: {len(out)}"
    # Date range: 1872 (first England-Scotland match) to present.
    assert out["date"].min().year <= 1880
    assert out["date"].max().year >= 2024
    # K-mult value distribution sanity: WC (3.0), continental finals (2.5),
    # qualifiers (2.0), friendlies (1.0) should all be present.
    kmult_values = set(out["k_mult"].unique())
    assert 1.0 in kmult_values
    assert 2.0 in kmult_values
    assert 2.5 in kmult_values
    assert 3.0 in kmult_values
    # Neutral column should be boolean, mix of True/False.
    assert out["neutral"].dtype == bool
    assert out["neutral"].any()
    assert (~out["neutral"]).any()
