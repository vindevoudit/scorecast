# syntax=docker/dockerfile:1.7
#
# scorecast-ml — Python ML pipeline runtime image.
#
# Three-stage build:
#   1. base     — python:3.14-slim + system libs (libgomp for xgboost) + pip deps
#   2. train    — runs `python -m scorecast_ml train` against the committed CSV
#                 corpus and writes the model bundle. Bakes a fully reproducible,
#                 deterministic (seed=42) model into the image.
#   3. runtime  — minimal non-root layer carrying code + CSVs + freshly-trained
#                 model. ENTRYPOINT runs predict-and-write against the live API.
#
# Build context is `ml/` (not repo root) — keeps the context small and the
# COPY paths intuitive.
#
#   docker build -t scorecast-ml -f ml/Dockerfile ml/

# ============================================================================
# Stage 1 — base: deps installed once, shared by train + runtime
# ============================================================================
FROM python:3.14-slim AS base
WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# libgomp1 is required by xgboost's pre-built wheel (OpenMP runtime). tini
# reaps zombies and forwards signals cleanly to the Python process.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 \
      tini \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ============================================================================
# Stage 2 — train: produce the model artifact from the committed CSV corpus
# ============================================================================
FROM base AS train

COPY scorecast_ml ./scorecast_ml
COPY data/raw ./data/raw

# Production split: 15-season train (2009/10 -> 2023/24) + 1-season val
# (2024/25) + 25/26 OOS test via DB walk-forward (handled at runtime, not
# here). Test-season 2526 is intentional — if the CSV isn't present (it
# isn't in the committed corpus), train just skips test metrics gracefully.
# Isotonic calibration is on by default; --no-calibration would disable it.
RUN python -m scorecast_ml train \
      --league PL \
      --train-from-season 0910 \
      --train-last-season 2324 \
      --val-season 2425 \
      --test-season 2526

# ============================================================================
# Stage 3 — runtime: non-root, minimal surface, CMD = predict-and-write
# ============================================================================
FROM base AS runtime

# Non-root user. uid 1001 matches the Node app's app user for consistency
# across the two images in the same Container Apps environment.
RUN groupadd -g 1001 -r app && useradd -u 1001 -r -g app -s /bin/false app

# Code + CSV corpus (used to rebuild Elo + form at predict time, alongside
# the live DB completed games) + freshly-trained model from stage 2.
COPY scorecast_ml ./scorecast_ml
COPY scripts ./scripts
COPY data/raw ./data/raw
COPY --from=train /app/data/models ./data/models

RUN chown -R app:app /app
USER app

# tini forwards SIGTERM cleanly so Container Apps can drain the replica on
# completion / cancellation without zombie processes.
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command: predict probabilities for the next 7 days of PL fixtures
# and write them through /api/admin/games/:id. Container Apps Job overrides
# this command per-execution if needed (e.g. ad-hoc --overwrite-existing
# rewrites).
CMD ["python", "-m", "scorecast_ml", "predict-and-write", "--league", "PL", "--horizon-days", "7"]
