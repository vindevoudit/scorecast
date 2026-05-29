"""International football ingest — parser for the martj42
"International football results 1872-present" dataset (Kaggle).

Input files (committed under `international_match_archive/`):
  - results.csv      : one row per match (date, home_team, away_team,
                       home_score, away_score, tournament, city, country,
                       neutral)
  - former_names.csv : historical → modern team renames with date windows
                       (current, former, start_date, end_date)
  - goalscorers.csv  : NOT used here (event-level data; this module is
                       match-level only)

Output columns (the Elo engine + trainer contract):
  date     : datetime64[ns, UTC]
  home     : str  (modern canonical country name; former-name aliases collapsed)
  away     : str
  ftr      : str  (H/D/A derived from home_score vs away_score)
  fthg     : Int64 (kept for parity with PL ingest; not used in 2-feature model)
  ftag     : Int64
  tournament : str
  neutral  : bool
  k_mult   : float  (FIFA-style tier weight — see `derive_k_multiplier`)
  league   : str   ("INT" — fixed)
  season   : str   (calendar year as 4-digit string — no real "season"
                    concept in international football, but cli.py's
                    season-presence detection needs the column to exist)

The FIFA-style K-multiplier table mirrors the JS seeder's table in
`seeders/20260528000003-seed-teams-from-intl-elo-history.js`. Both files
cite each other so a change here MUST land alongside the JS table edit.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd

from scorecast_ml.logging import get_logger

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# K-multiplier tier table. FIFA-style: world cup finals > continental
# finals + WC qualifiers > continental qualifiers + Nations League > friendlies.
# Captured by exact tournament-name match against the values observed in the
# real martj42 dataset (49k+ rows, sampled 2026-05-28). Unrecognized
# tournaments fall through to 1.0 — the same weight as friendlies. The
# `test_intl_ingest.py::test_kmult_covers_observed_tournaments` test
# audits the top-N most frequent tournaments against this table so a new
# major competition (e.g. a future continental rebrand) doesn't silently
# get weighted as a friendly.
# ---------------------------------------------------------------------------

_KMULT_TABLE: dict[str, float] = {
    # Tier 1 (×3.0) — the World Cup finals tournament itself.
    "FIFA World Cup": 3.0,
    # Tier 2 (×2.5) — WC qualifiers + continental finals.
    "FIFA World Cup qualification": 2.5,
    "UEFA Euro": 2.5,
    "Copa América": 2.5,
    "African Cup of Nations": 2.5,
    "AFC Asian Cup": 2.5,
    "Gold Cup": 2.5,                # CONCACAF top continental tournament
    "CONCACAF Championship": 2.5,   # Gold Cup predecessor
    "Oceania Nations Cup": 2.5,     # OFC top continental tournament
    # Tier 3 (×2.0) — continental qualifiers + Nations League formats.
    "UEFA Euro qualification": 2.0,
    "African Cup of Nations qualification": 2.0,
    "AFC Asian Cup qualification": 2.0,
    "Gold Cup qualification": 2.0,
    "CONCACAF Championship qualification": 2.0,
    "UEFA Nations League": 2.0,
    "CONCACAF Nations League": 2.0,
    # Tier 4 (×1.5) — global tier-2 competitions + Olympics.
    "Confederations Cup": 1.5,
    "FIFA Confederations Cup": 1.5,
    # Tier 5 (×1.0) — friendlies + everything not explicitly mapped above.
    "Friendly": 1.0,
}


def derive_k_multiplier(tournament: str) -> float:
    """Map a tournament name to its FIFA-style K-factor multiplier.

    Exact-match lookup against `_KMULT_TABLE`; unrecognized names fall
    through to 1.0 (treated as friendly-tier). For "Olympic*" tournaments
    we also accept the `Olympics` substring case to handle minor naming
    variation in the dataset.
    """
    if tournament in _KMULT_TABLE:
        return _KMULT_TABLE[tournament]
    # Olympics variants — single-trick prefix match to cover "Olympic Games",
    # "Summer Olympics", etc. without explicit per-variant entries.
    if "Olympic" in tournament:
        return 1.5
    return 1.0


# ---------------------------------------------------------------------------
# Former-names → modern canonical rewriter. Date-bounded: a match played
# while a team carried a historical name (USSR, Czechoslovakia, etc.) gets
# rewritten to that name's MODERN equivalent so Elo accumulates against
# the right team identity.
#
# Czechoslovakia is the one tricky case: the dataset's former_names.csv
# maps "Czechoslovakia" → "Bohemia" (1903-1919) and various other names,
# but does NOT split Czechoslovakia itself into Czech Republic / Slovakia
# (the split happened post-1993). We carry that limitation: matches
# played under the name "Czechoslovakia" stay "Czechoslovakia" in the
# output. Elo accumulated under "Czechoslovakia" then transfers to
# neither successor — slight drift but bounded; the dataset includes
# the modern successor names directly for post-1993 matches.
# ---------------------------------------------------------------------------


def _load_former_names_table(path: Path) -> list[tuple[str, str, pd.Timestamp, pd.Timestamp]]:
    """Read former_names.csv into a list of (current, former, start, end) tuples.

    Dates are returned as tz-aware UTC pd.Timestamps so they can be
    compared directly against the match date column.
    """
    rows: list[tuple[str, str, pd.Timestamp, pd.Timestamp]] = []
    with open(path, "r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            current = (r.get("current") or "").strip()
            former = (r.get("former") or "").strip()
            start_s = (r.get("start_date") or "").strip()
            end_s = (r.get("end_date") or "").strip()
            if not (current and former and start_s and end_s):
                continue
            try:
                start = pd.Timestamp(start_s, tz="UTC")
                end = pd.Timestamp(end_s, tz="UTC")
            except (ValueError, TypeError):
                continue
            rows.append((current, former, start, end))
    return rows


def apply_former_names(df: pd.DataFrame, former_names_path: Path) -> pd.DataFrame:
    """Rewrite historical team names to their modern canonical form.

    Date-windowed: a rename only applies to matches whose `date` falls
    inside the [start_date, end_date] window for the former name. So a
    1972 match listed under "Upper Volta" becomes "Burkina Faso", but a
    2024 match listed under "Russia" stays "Russia" (the USSR window
    closed in 1991).

    Returns a copy; doesn't mutate the input.
    """
    if "date" not in df.columns or "home" not in df.columns or "away" not in df.columns:
        raise ValueError("apply_former_names requires date/home/away columns")
    table = _load_former_names_table(former_names_path)
    if not table:
        log.warning("former_names_empty", path=str(former_names_path))
        return df.copy()

    out = df.copy()
    home_rewrites = 0
    away_rewrites = 0
    for current, former, start, end in table:
        in_window = (out["date"] >= start) & (out["date"] <= end)
        home_mask = in_window & (out["home"] == former)
        away_mask = in_window & (out["away"] == former)
        if home_mask.any():
            home_rewrites += int(home_mask.sum())
            out.loc[home_mask, "home"] = current
        if away_mask.any():
            away_rewrites += int(away_mask.sum())
            out.loc[away_mask, "away"] = current

    log.info(
        "former_names_applied",
        rules=len(table),
        home_rewrites=home_rewrites,
        away_rewrites=away_rewrites,
    )
    return out


# ---------------------------------------------------------------------------
# Top-level parser.
# ---------------------------------------------------------------------------

_REQUIRED_COLUMNS = (
    "date",
    "home_team",
    "away_team",
    "home_score",
    "away_score",
    "tournament",
    "neutral",
)


def _derive_ftr(home_score: int, away_score: int) -> str:
    if home_score > away_score:
        return "H"
    if home_score < away_score:
        return "A"
    return "D"


def parse_intl_csv(results_path: Path, former_names_path: Path) -> pd.DataFrame:
    """Read the international match archive into the Elo-engine contract.

    Drops rows with missing scores (future fixtures, postponed matches) and
    rows where home == away. Applies former-name rewrites BEFORE returning
    so the canonical name is stable for downstream reconciliation.

    Does NOT canonicalize against `reconcile/teams.json` — that's the
    trainer's job (loud-fail on unknowns is structurally a trainer-side
    concern, mirroring the PL path).
    """
    # Read defensively with stdlib csv — same pattern as football_data_uk.parse_csv
    # — so a rare ragged row doesn't kill the load.
    with open(results_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError(f"{results_path}: empty CSV")
        ncols = len(header)
        rows: list[list[str]] = []
        for raw_row in reader:
            if not raw_row:
                continue
            if len(raw_row) > ncols:
                raw_row = raw_row[:ncols]
            elif len(raw_row) < ncols:
                raw_row = raw_row + [""] * (ncols - len(raw_row))
            rows.append(raw_row)

    raw = pd.DataFrame(rows, columns=header)
    missing = [c for c in _REQUIRED_COLUMNS if c not in raw.columns]
    if missing:
        raise ValueError(
            f"{results_path}: missing required columns {missing}. "
            f"Got: {list(raw.columns)}"
        )

    df = raw[list(_REQUIRED_COLUMNS)].copy()

    # Dates are ISO YYYY-MM-DD (martj42 standard). Coerce + drop unparseable.
    df["date"] = pd.to_datetime(df["date"], format="%Y-%m-%d", errors="coerce")
    df = df.dropna(subset=["date"])
    df["date"] = df["date"].dt.tz_localize("UTC")

    # Scores: future fixtures have 'NA' literal strings → coerce to NaN
    # and drop. This is the layer that captures the dataset's "future
    # WC fixtures" rows we observed in the verification ladder.
    df["home_score"] = pd.to_numeric(df["home_score"], errors="coerce")
    df["away_score"] = pd.to_numeric(df["away_score"], errors="coerce")
    df = df.dropna(subset=["home_score", "away_score"])
    df["home_score"] = df["home_score"].astype(int)
    df["away_score"] = df["away_score"].astype(int)

    df["home"] = df["home_team"].astype(str).str.strip()
    df["away"] = df["away_team"].astype(str).str.strip()
    df = df[df["home"] != ""]
    df = df[df["away"] != ""]
    df = df[df["home"] != df["away"]]  # drop self-vs-self anomalies

    df["tournament"] = df["tournament"].astype(str).str.strip()

    # Boolean coercion: martj42 uses literal "TRUE"/"FALSE" strings.
    df["neutral"] = (
        df["neutral"]
        .astype(str)
        .str.strip()
        .str.upper()
        .map({"TRUE": True, "FALSE": False})
    )
    # Anything else (blank, garbage) treated as non-neutral — defensive default.
    df["neutral"] = df["neutral"].fillna(False).astype(bool)

    # Derive FTR + k_mult.
    df["ftr"] = df.apply(
        lambda r: _derive_ftr(int(r["home_score"]), int(r["away_score"])), axis=1
    )
    df["k_mult"] = df["tournament"].map(derive_k_multiplier).astype(float)

    # PL-parity columns.
    df["fthg"] = df["home_score"].astype("Int64")
    df["ftag"] = df["away_score"].astype("Int64")
    df["league"] = "INT"
    df["season"] = df["date"].dt.year.astype(str)

    # Sort chronologically — required by batch_compute.
    df = df.sort_values("date").reset_index(drop=True)

    # Apply former-name rewrites AFTER everything else is settled.
    df = apply_former_names(df, former_names_path)

    out = df[
        [
            "date",
            "home",
            "away",
            "ftr",
            "fthg",
            "ftag",
            "tournament",
            "neutral",
            "k_mult",
            "league",
            "season",
        ]
    ].reset_index(drop=True)

    log.info(
        "intl_ingest_loaded",
        rows=len(out),
        date_min=str(out["date"].min().date()),
        date_max=str(out["date"].max().date()),
        unique_teams=int(pd.concat([out["home"], out["away"]]).nunique()),
        unique_tournaments=int(out["tournament"].nunique()),
    )
    return out
