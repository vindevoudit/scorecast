"""Read-only SELECTs against ScoreCast's Postgres.

Column names use camelCase quoted because that's how Sequelize created
them (and how the Node side queries them). Quote them in SQL literals.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import psycopg
from psycopg.rows import dict_row


def fetch_league_by_code(conn: psycopg.Connection, *, code: str) -> dict | None:
    """Look up a league row by football-data.org `sourceLeagueId` (e.g. 'PL')."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            'SELECT id, name, "sourceProvider", "sourceLeagueId", active '
            'FROM leagues WHERE "sourceLeagueId" = %s LIMIT 1',
            (code,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def fetch_upcoming_for_league(
    conn: psycopg.Connection,
    *,
    league_id: str,
    horizon_days: int = 7,
) -> list[dict]:
    """Upcoming scheduled games inside a (today, today + horizon_days)
    window. `date` is the kickoff column; `status='scheduled'` ensures
    we never write probabilities for in-progress/finished/postponed rows.
    """
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=horizon_days)
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            'SELECT id, "homeTeam", "awayTeam", "date", "leagueId", "seasonId", '
            '       "sourceId", "homeProbability", "drawProbability", "awayProbability", status '
            'FROM games '
            'WHERE "leagueId" = %s AND status = %s AND "date" > %s AND "date" < %s '
            'ORDER BY "date" ASC',
            (league_id, "scheduled", now, horizon),
        )
        return [dict(r) for r in cur.fetchall()]


def fetch_completed_for_league(conn: psycopg.Connection, *, league_id: str) -> list[dict]:
    """Completed games (with scores) for a league, sorted by date asc.

    Used by inference to extend the training-CSV history with current-
    season completed matches so rolling-form features stay current.
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(
            'SELECT id, "homeTeam", "awayTeam", "date", "homeScore", "awayScore", result '
            'FROM games '
            'WHERE "leagueId" = %s AND status = %s '
            '  AND "homeScore" IS NOT NULL AND "awayScore" IS NOT NULL '
            'ORDER BY "date" ASC',
            (league_id, "finished"),
        )
        return [dict(r) for r in cur.fetchall()]
