"""Runtime configuration sourced from environment + .env file.

All settings carry a `SCORECAST_` prefix so they sit cleanly alongside the
Node app's own env vars without collision.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_data_root() -> Path:
    # ml/scorecast_ml/config.py → ml/data/
    return Path(__file__).resolve().parent.parent / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="SCORECAST_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # HTTP writer auth. Username must satisfy the Node API's
    # registerSchema regex (^[A-Za-z0-9_]+$) — no hyphens allowed.
    ml_username: str = Field(default="ml_pipeline")
    ml_password: str = Field(default="")
    api_base_url: str = Field(default="http://localhost:3000")

    # DB reader
    db_url: str = Field(default="")

    # Optional
    log_format: Literal["pretty", "json", ""] = Field(default="")
    data_root: str = Field(default="")

    def resolved_data_root(self) -> Path:
        if self.data_root:
            return Path(self.data_root).expanduser().resolve()
        return _default_data_root()

    def raw_dir(self) -> Path:
        d = self.resolved_data_root() / "raw"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def elo_dir(self) -> Path:
        d = self.resolved_data_root() / "elo"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def models_dir(self) -> Path:
        d = self.resolved_data_root() / "models"
        d.mkdir(parents=True, exist_ok=True)
        return d


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
