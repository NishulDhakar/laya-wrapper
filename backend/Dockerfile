# laya-hub backend. Build from the repo root:  docker build -f backend/Dockerfile .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/models

# curl: container healthcheck and scripts/smoke_test.sh
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only torch first, so `laya` does not pull the multi-GB CUDA build from PyPI.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install torch --index-url ${TORCH_INDEX_URL}

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY scripts/smoke_test.sh ./scripts/smoke_test.sh

# Non-root user. /models (HF cache) and /data (SQLite) are volumes; creating them here with the
# right owner means fresh named volumes inherit that ownership.
RUN useradd --create-home --uid 1000 app \
    && mkdir -p /models /data \
    && chown -R app:app /models /data /app
USER app

EXPOSE 8080

# ONE worker: every worker would load its own copy of the model.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
