"""HTTP writer that pushes probability updates through PUT /api/admin/games/:id.

Auth flow mirrors tests/e2e/helpers/api.js apiLogin:
  1. POST /api/login → response sets sc_access (HttpOnly), sc_refresh, sc_csrf
  2. Extract sc_csrf cookie value
  3. For each PUT: send the X-CSRF-Token header; httpx.Client carries cookies
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from scorecast_ml.config import get_settings
from scorecast_ml.logging import get_logger

log = get_logger(__name__)

_LOGIN_PATH = "/api/login"
_GAME_PATH_FMT = "/api/admin/games/{game_id}"

# Post-migration "untouched by anyone" sentinel: a fresh game has
# homeProbability=0.5, drawProbability=0 (the migration default), and
# awayProbability=0.5. Skip writing over a non-sentinel trio unless the
# caller passes overwrite_existing=True.
_SENTINEL_TRIPLE = (0.50, 0.00, 0.50)
_SENTINEL_TOL = 0.001


def _is_sentinel(
    home_p: float | None, draw_p: float | None, away_p: float | None
) -> bool:
    if home_p is None or away_p is None:
        return True
    draw_val = 0.0 if draw_p is None else float(draw_p)
    return (
        abs(float(home_p) - _SENTINEL_TRIPLE[0]) < _SENTINEL_TOL
        and abs(draw_val - _SENTINEL_TRIPLE[1]) < _SENTINEL_TOL
        and abs(float(away_p) - _SENTINEL_TRIPLE[2]) < _SENTINEL_TOL
    )


@dataclass
class WriteResult:
    written: int = 0
    skipped: int = 0
    failed: int = 0
    failures: list[tuple[str, int, str]] = field(default_factory=list)
    skipped_ids: list[str] = field(default_factory=list)


def _login(client: httpx.Client) -> str:
    settings = get_settings()
    if not settings.ml_password:
        raise RuntimeError(
            "SCORECAST_ML_PASSWORD is empty. Provision the ml_pipeline "
            "admin user in the running app and stash the password in "
            "ml/.env (SCORECAST_ML_PASSWORD=...). NOTE: username uses an "
            "underscore — the API's username regex rejects hyphens."
        )
    log.info("writer_login_start", user=settings.ml_username, url=settings.api_base_url)
    r = client.post(
        _LOGIN_PATH,
        json={"username": settings.ml_username, "password": settings.ml_password},
    )
    if r.status_code != 200:
        raise RuntimeError(
            f"login failed ({r.status_code}): {r.text[:200]}. Check creds + "
            "that the user has role='admin'."
        )
    csrf = client.cookies.get("sc_csrf")
    if not csrf:
        raise RuntimeError("login succeeded but no sc_csrf cookie returned")
    log.info("writer_login_ok")
    return csrf


def write_probabilities(
    rows: list[dict],
    *,
    overwrite_existing: bool = False,
    dry_run: bool = False,
) -> WriteResult:
    """Push probability updates for the provided rows.

    Each row dict must contain:
      - id: game UUID (str)
      - home_out, draw_out, away_out: floats (sum to 1.00 after rounding)
      - homeProbability, drawProbability, awayProbability: current DB values
        used for the sentinel check

    Login happens ONCE per call regardless of row count — `/api/login`
    is rate-limited, so don't loop.
    """
    result = WriteResult()
    if not rows:
        log.info("writer_no_rows")
        return result

    if dry_run:
        for row in rows:
            current_h = row.get("homeProbability")
            current_d = row.get("drawProbability")
            current_a = row.get("awayProbability")
            if not overwrite_existing and not _is_sentinel(current_h, current_d, current_a):
                result.skipped += 1
                result.skipped_ids.append(str(row["id"]))
                continue
            log.info(
                "writer_dry_run",
                game_id=row["id"],
                home_out=row["home_out"],
                draw_out=row["draw_out"],
                away_out=row["away_out"],
            )
            result.written += 1
        return result

    settings = get_settings()
    with httpx.Client(base_url=settings.api_base_url, timeout=15.0) as client:
        csrf = _login(client)
        headers = {"X-CSRF-Token": csrf}

        for row in rows:
            game_id = str(row["id"])
            current_h = row.get("homeProbability")
            current_d = row.get("drawProbability")
            current_a = row.get("awayProbability")
            if not overwrite_existing and not _is_sentinel(current_h, current_d, current_a):
                result.skipped += 1
                result.skipped_ids.append(game_id)
                continue

            payload = {
                "homeProbability": float(row["home_out"]),
                "drawProbability": float(row["draw_out"]),
                "awayProbability": float(row["away_out"]),
            }
            try:
                r = client.put(
                    _GAME_PATH_FMT.format(game_id=game_id),
                    json=payload,
                    headers=headers,
                )
            except httpx.HTTPError as exc:
                result.failed += 1
                result.failures.append((game_id, 0, str(exc)))
                log.error("writer_http_error", game_id=game_id, err=str(exc))
                continue
            if r.status_code != 200:
                result.failed += 1
                snippet = r.text[:200].replace("\n", " ")
                result.failures.append((game_id, r.status_code, snippet))
                log.error(
                    "writer_status_error",
                    game_id=game_id,
                    status=r.status_code,
                    body=snippet,
                )
                continue
            result.written += 1
            log.info(
                "writer_wrote",
                game_id=game_id,
                home_out=payload["homeProbability"],
                draw_out=payload["drawProbability"],
                away_out=payload["awayProbability"],
            )

    log.info(
        "writer_summary",
        written=result.written,
        skipped=result.skipped,
        failed=result.failed,
    )
    return result
