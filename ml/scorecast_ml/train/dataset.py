"""Time-based train/val/test split for football match data.

NEVER random — random k-fold gives flattering log-loss that's pure leakage
because the model implicitly sees the future of any partially-seen season.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class Split:
    X_train: pd.DataFrame
    y_train: pd.Series
    X_val: pd.DataFrame
    y_val: pd.Series
    X_test: pd.DataFrame
    y_test: pd.Series
    train_through: pd.Timestamp
    val_through: pd.Timestamp

    def summary(self) -> dict[str, int | str]:
        return {
            "train_rows": len(self.X_train),
            "val_rows": len(self.X_val),
            "test_rows": len(self.X_test),
            "train_through": str(self.train_through.date()),
            "val_through": str(self.val_through.date()),
        }


def time_based_split(
    X: pd.DataFrame,
    y: pd.Series,
    dates: pd.Series,
    *,
    train_through: pd.Timestamp,
    val_through: pd.Timestamp,
    train_from: pd.Timestamp | None = None,
) -> Split:
    """Slice (X, y) by `dates` into three buckets:
      train:  train_from < dates <= train_through  (train_from defaults to -inf)
      val:    train_through < dates <= val_through
      test:   dates > val_through

    `dates` MUST be a pd.Series aligned positionally with X.index/y.index.

    `train_from` is useful for windowed-backtest experiments where you want
    to train on (say) only the most recent 5 seasons before the val cutoff
    rather than every season available.
    """
    if len(X) != len(y) or len(X) != len(dates):
        raise ValueError(
            f"X/y/dates length mismatch: {len(X)}/{len(y)}/{len(dates)}"
        )

    dates_utc = pd.to_datetime(dates, utc=True)
    if train_from is not None:
        train_mask = (dates_utc > train_from) & (dates_utc <= train_through)
    else:
        train_mask = dates_utc <= train_through
    val_mask = (dates_utc > train_through) & (dates_utc <= val_through)
    test_mask = dates_utc > val_through

    return Split(
        X_train=X.loc[train_mask].reset_index(drop=True),
        y_train=y.loc[train_mask].reset_index(drop=True),
        X_val=X.loc[val_mask].reset_index(drop=True),
        y_val=y.loc[val_mask].reset_index(drop=True),
        X_test=X.loc[test_mask].reset_index(drop=True),
        y_test=y.loc[test_mask].reset_index(drop=True),
        train_through=train_through,
        val_through=val_through,
    )


def split_by_season_boundary(
    X: pd.DataFrame,
    y: pd.Series,
    dates: pd.Series,
    *,
    train_last_season: str,
    val_season: str,
    test_season: str,
    train_from_season: str | None = None,
) -> Split:
    """Convenience wrapper that takes season codes ('1819' etc.) instead
    of timestamps. Season boundary is treated as June 30 — common European
    football calendar convention.

    If `train_from_season` is provided, train is constrained to the window
    [train_from_season ... train_last_season] inclusive — useful for
    fixed-size training-window backtests.
    """
    from scorecast_ml.ingest.seasons import season_code_to_year

    train_through = pd.Timestamp(
        f"{season_code_to_year(train_last_season) + 1:04d}-06-30", tz="UTC"
    )
    val_through = pd.Timestamp(
        f"{season_code_to_year(val_season) + 1:04d}-06-30", tz="UTC"
    )
    train_from: pd.Timestamp | None = None
    if train_from_season is not None:
        train_from = pd.Timestamp(
            f"{season_code_to_year(train_from_season):04d}-06-30", tz="UTC"
        )
    # test_season is implicit (everything after val_through)
    _ = test_season  # documented but unused — kept for caller clarity
    return time_based_split(
        X, y, dates,
        train_through=train_through,
        val_through=val_through,
        train_from=train_from,
    )
