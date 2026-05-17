"""Evaluation metrics. Multi-class log-loss is primary (the loss the model
is trained on); Brier is secondary; accuracy is tertiary (intuitive but
wrong North Star — a 1% accuracy gain at the cost of worse calibration
directly costs ScoreCast users payout).
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import accuracy_score, log_loss


def multiclass_log_loss(y_true: np.ndarray, y_proba: np.ndarray) -> float:
    """y_true: (n,) int in {0, 1, 2}; y_proba: (n, 3) row-stochastic."""
    return float(log_loss(y_true, y_proba, labels=[0, 1, 2]))


def multiclass_brier(y_true: np.ndarray, y_proba: np.ndarray) -> float:
    """3-class Brier: mean squared error against the one-hot target."""
    n = len(y_true)
    one_hot = np.zeros_like(y_proba)
    one_hot[np.arange(n), y_true.astype(int)] = 1.0
    return float(np.mean(np.sum((y_proba - one_hot) ** 2, axis=1)))


def argmax_accuracy(y_true: np.ndarray, y_proba: np.ndarray) -> float:
    return float(accuracy_score(y_true, y_proba.argmax(axis=1)))


def evaluate(y_true: np.ndarray, y_proba: np.ndarray, *, label: str = "") -> dict:
    """Returns a metrics dict suitable for jamming straight into the
    model bundle's `metrics` field."""
    return {
        "label": label,
        "n": int(len(y_true)),
        "mlogloss": multiclass_log_loss(y_true, y_proba),
        "brier": multiclass_brier(y_true, y_proba),
        "accuracy": argmax_accuracy(y_true, y_proba),
        "class_share": {
            "home_win": float(np.mean(y_true == 0)),
            "draw": float(np.mean(y_true == 1)),
            "away_win": float(np.mean(y_true == 2)),
        },
    }


def majority_class_baseline(y_true: np.ndarray) -> dict:
    """Trivial baseline: predict the marginal class distribution every time."""
    n = len(y_true)
    marginal = np.array([np.mean(y_true == c) for c in (0, 1, 2)])
    proba = np.tile(marginal, (n, 1))
    return evaluate(y_true, proba, label="baseline_marginal")
