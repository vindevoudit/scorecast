"""Football-Data.co.uk CSV downloader + parser.

URL pattern: https://www.football-data.co.uk/mmz4281/{season}/{code}.csv
where `season` is a 4-char code (see ingest/seasons.py) and `code` is the
FDCO league code (E0 = Premier League, D1 = Bundesliga, etc.).

We persist downloads under {data_root}/raw/{league}_{season}.csv keyed by
ScoreCast's own league code (PL/BSA/etc.), NOT the FDCO code — so future
provider swaps don't move the cache around.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import pandas as pd
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from scorecast_ml.config import get_settings
from scorecast_ml.logging import get_logger

log = get_logger(__name__)

BASE_URL = "https://www.football-data.co.uk/mmz4281"

# ScoreCast league code (matches `leagues.sourceLeagueId` for football-data.org
# rows) → Football-Data.co.uk league code. Add new entries here as Phase 2+
# brings more leagues into scope. BSA + CL deliberately absent — Phase 2 work.
LEAGUE_CODE_MAP: dict[str, str] = {
    "PL": "E0",   # Premier League
    "PD": "SP1",  # La Liga
    "BL1": "D1",  # Bundesliga
    "SA": "I1",   # Serie A
    "FL1": "F1",  # Ligue 1
}


def fdco_code_for(league: str) -> str:
    code = LEAGUE_CODE_MAP.get(league)
    if not code:
        raise ValueError(
            f"League {league!r} is not mapped to a Football-Data.co.uk code. "
            f"Known leagues: {sorted(LEAGUE_CODE_MAP)}. Add to LEAGUE_CODE_MAP "
            "in ingest/football_data_uk.py if FDCO covers it."
        )
    return code


def csv_cache_path(league: str, season_code: str) -> Path:
    return get_settings().raw_dir() / f"{league}_{season_code}.csv"


@retry(
    retry=retry_if_exception_type((httpx.TransportError, httpx.HTTPStatusError)),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=2, max=15),
    reraise=True,
)
def _http_get_bytes(url: str) -> bytes:
    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.content


def download_season(league: str, season_code: str, *, force: bool = False) -> Path:
    """Fetch one (league, season) CSV. Idempotent — re-runs hit cache.

    Returns the path to the cached CSV. Raises httpx.HTTPStatusError if
    the upstream returns non-2xx after retries.
    """
    dest = csv_cache_path(league, season_code)
    if dest.exists() and not force:
        log.info("ingest_cache_hit", league=league, season=season_code, path=str(dest))
        return dest

    fdco = fdco_code_for(league)
    url = f"{BASE_URL}/{season_code}/{fdco}.csv"
    log.info("ingest_download", league=league, season=season_code, url=url)
    body = _http_get_bytes(url)
    dest.write_bytes(body)
    sha = hashlib.sha256(body).hexdigest()[:12]
    log.info(
        "ingest_downloaded",
        league=league,
        season=season_code,
        path=str(dest),
        bytes=len(body),
        sha=sha,
    )
    return dest


# Columns we keep. Football-Data.co.uk publishes ~60 columns including a
# huge zoo of betting-market odds — we strip to the result-only minimum
# for Phase 1. Phase 4 might bring odds back as a calibration baseline.
_KEEP_COLUMNS = ["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG", "FTR"]


def parse_csv(path: Path, *, league: str, season_code: str) -> pd.DataFrame:
    """Read one cached CSV → normalized DataFrame.

    Output columns: date (datetime64[ns, UTC]), home (str), away (str),
    fthg (int), ftag (int), ftr (str: H/D/A), league (str), season (str).

    Some CSVs have stray trailing-comma columns and trailing whitespace on
    team names — both handled.
    """
    # Some FDCO CSVs (e.g. 0304/0405) have rows with EXTRA trailing
    # columns mid-season — odds providers got added. Both pandas C and
    # python engines DROP those rows ("expected N, saw M"), losing ~45
    # matches/season. Read with stdlib csv so we can truncate each row
    # to the header width and keep every match.
    import csv

    with open(path, "r", encoding="latin-1", newline="") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            raise ValueError(f"{path}: empty CSV")
        ncols = len(header)
        rows: list[list[str]] = []
        for raw_row in reader:
            if not raw_row:
                continue
            # Truncate over-long rows; pad short ones with empty strings.
            if len(raw_row) > ncols:
                raw_row = raw_row[:ncols]
            elif len(raw_row) < ncols:
                raw_row = raw_row + [""] * (ncols - len(raw_row))
            rows.append(raw_row)

    raw = pd.DataFrame(rows, columns=header)
    missing = [c for c in _KEEP_COLUMNS if c not in raw.columns]
    if missing:
        raise ValueError(
            f"{path}: missing required columns {missing}. Got: {list(raw.columns)[:20]}..."
        )
    df = raw[_KEEP_COLUMNS].copy()

    # Date column: format flipped between DD/MM/YY (older seasons) and
    # DD/MM/YYYY (newer). Try the strict format first (cheap), fall back
    # to dayfirst inference for the historical ragged ones.
    parsed = pd.to_datetime(df["Date"], format="%d/%m/%Y", errors="coerce")
    if parsed.isna().any():
        fallback = pd.to_datetime(df["Date"], format="%d/%m/%y", errors="coerce")
        parsed = parsed.fillna(fallback)
    if parsed.isna().any():
        # Last resort: let pandas guess. Silences the dayfirst warning for
        # the modern CSVs where it isn't needed.
        leftover = pd.to_datetime(df["Date"], dayfirst=True, errors="coerce")
        parsed = parsed.fillna(leftover)
    df["date"] = parsed
    df = df.dropna(subset=["date"])
    # CSV dates are local match dates without timezone. Treat as UTC for
    # consistency with the DB's UTC kickoff column; the actual time-of-day
    # is missing from these CSVs anyway (only date matters for daily-rest
    # calculations).
    df["date"] = df["date"].dt.tz_localize("UTC")

    df["home"] = df["HomeTeam"].astype(str).str.strip()
    df["away"] = df["AwayTeam"].astype(str).str.strip()
    df["fthg"] = pd.to_numeric(df["FTHG"], errors="coerce").astype("Int64")
    df["ftag"] = pd.to_numeric(df["FTAG"], errors="coerce").astype("Int64")
    df["ftr"] = df["FTR"].astype(str).str.strip().str.upper()
    df["league"] = league
    df["season"] = season_code

    # Drop rows missing core data (typically empty trailing rows).
    df = df.dropna(subset=["home", "away", "fthg", "ftag"])
    df = df[df["ftr"].isin(["H", "D", "A"])]
    df = df.sort_values("date").reset_index(drop=True)

    return df[
        ["date", "home", "away", "fthg", "ftag", "ftr", "league", "season"]
    ]


def load_seasons(
    league: str,
    season_codes: list[str],
    *,
    force_redownload: bool = False,
) -> pd.DataFrame:
    """Download (if needed) + parse + concat multiple seasons.

    Returns a single chronologically-sorted DataFrame.
    """
    frames: list[pd.DataFrame] = []
    for season in season_codes:
        path = download_season(league, season, force=force_redownload)
        frames.append(parse_csv(path, league=league, season_code=season))
    if not frames:
        return pd.DataFrame(
            columns=["date", "home", "away", "fthg", "ftag", "ftr", "league", "season"]
        )
    out = pd.concat(frames, ignore_index=True).sort_values("date").reset_index(drop=True)
    log.info(
        "ingest_loaded",
        league=league,
        seasons=season_codes,
        rows=len(out),
        date_min=str(out["date"].min().date()),
        date_max=str(out["date"].max().date()),
    )
    return out
