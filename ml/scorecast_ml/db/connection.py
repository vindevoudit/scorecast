"""psycopg connection factory. Read-only pool intended (the pipeline only
SELECTs from Postgres; writes go through the HTTP API for audit + validation).
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import psycopg

from scorecast_ml.config import get_settings


def _normalize_url(raw: str) -> str:
    """The Node app stores postgres:// URLs; psycopg prefers postgresql://.
    Both work in modern psycopg but normalize for clarity."""
    if raw.startswith("postgres://"):
        return "postgresql://" + raw[len("postgres://"):]
    return raw


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    settings = get_settings()
    if not settings.db_url:
        raise RuntimeError(
            "SCORECAST_DB_URL is empty. Set it in ml/.env or the environment. "
            "Same URL the Node app uses (e.g. "
            "postgres://scorecast:scorecast@localhost:5432/scorecast)."
        )
    conn = psycopg.connect(_normalize_url(settings.db_url), autocommit=True)
    try:
        yield conn
    finally:
        conn.close()
