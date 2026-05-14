# ── Stage 1: Build ── #
FROM python:3.11-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*
RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt

# ── Stage 2: Runtime ── #
FROM python:3.11-slim AS runtime
WORKDIR /app
COPY --from=builder /venv /venv
ENV PATH="/venv/bin:$PATH"
COPY src/ ./

ENV PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000
CMD ["sh", "-c", "exec gunicorn main:app -w ${WEB_CONCURRENCY:-$(nproc)} -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:${PORT}"]
