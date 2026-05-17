"""Football-Data.co.uk season-code helpers.

A "season code" is the 4-char string they use in URLs: "1819" = 2018/19,
"2324" = 2023/24, "9899" = 1998/99. Year rollover at 99/00 (i.e. 99/00 →
"9900", then 00/01 → "0001") is rare but handled.
"""

from __future__ import annotations


def year_to_season_code(year_start: int) -> str:
    """2018 → '1819'.

    Football-Data.co.uk uses the LAST TWO digits of each calendar year. So
    2018/19 → '18' + '19' = '1819'. 1999/00 → '9900'.
    """
    if not (1900 <= year_start <= 2099):
        raise ValueError(f"year_start {year_start} outside supported range 1900-2099")
    return f"{year_start % 100:02d}{(year_start + 1) % 100:02d}"


def season_code_to_year(season_code: str) -> int:
    """'1819' → 2018. Assumes 2-digit years 00-49 map to 21st century,
    50-99 map to 20th century — same heuristic Football-Data.co.uk uses.
    """
    if not (len(season_code) == 4 and season_code.isdigit()):
        raise ValueError(f"season_code {season_code!r} must be 4 digits")
    yy = int(season_code[:2])
    return 2000 + yy if yy < 50 else 1900 + yy


def parse_season_range(range_str: str) -> list[str]:
    """'1819-2324' → ['1819','1920','2021','2122','2223','2324'].

    Accepts a single season too: '2324' → ['2324'].
    """
    range_str = range_str.strip()
    if "-" not in range_str:
        # Single season
        _ = season_code_to_year(range_str)
        return [range_str]
    start_code, end_code = range_str.split("-", 1)
    start_year = season_code_to_year(start_code)
    end_year = season_code_to_year(end_code)
    if end_year < start_year:
        raise ValueError(f"range {range_str!r}: end season precedes start")
    return [year_to_season_code(y) for y in range(start_year, end_year + 1)]
