"""structlog wiring. Pretty in TTYs, JSON otherwise — mirrors the Node
side's pino / pino-pretty split so log queries are uniform across services.
"""

from __future__ import annotations

import logging
import sys

import structlog

from scorecast_ml.config import get_settings

_configured = False


def configure_logging() -> None:
    global _configured
    if _configured:
        return

    settings = get_settings()
    fmt = settings.log_format or ("pretty" if sys.stderr.isatty() else "json")

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", key="time"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if fmt == "pretty":
        renderer = structlog.dev.ConsoleRenderer(colors=True)
    else:
        # Match Node's pino field names: level / time / msg.
        renderer = structlog.processors.JSONRenderer()

    structlog.configure(
        processors=shared_processors + [renderer],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )
    _configured = True


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    configure_logging()
    return structlog.get_logger(name) if name else structlog.get_logger()
