# ── Stage 1: Build ── #
FROM python:3.11-slim AS builder
WORKDIR /app
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
    PORT=3000

EXPOSE 3000
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
