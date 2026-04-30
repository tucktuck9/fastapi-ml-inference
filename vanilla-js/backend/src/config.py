"""Environment configuration and defaults for the backend service."""

import os


def _service_url(value: str) -> str:
    """Ensure the value is a full URL with a scheme."""
    value = value.strip().rstrip("/")
    if value.startswith(("http://", "https://")):
        return value
    return f"http://{value}"


# Application Settings
FRONTEND_URL = os.getenv("FRONTEND_URL", "*")
MAX_INPUT_CHARS = int(os.getenv("MAX_INPUT_CHARS", "1000"))
TOP_EMOTIONS = int(os.getenv("TOP_EMOTIONS", "3"))
SUMMARY_REVIEW_LIMIT = int(os.getenv("SUMMARY_REVIEW_LIMIT", "5"))
REVIEWS_PAGE_SIZE = int(os.getenv("REVIEWS_PAGE_SIZE", "20"))

# Model & HuggingFace
MODEL_ID = os.getenv("MODEL_ID", "tabularisai/multilingual-emotion-classification")
MODEL_REVISION = os.getenv("MODEL_REVISION", "24895f06e3f50c532aa29c400e6708b57db1c16d")
HF_HOME = os.getenv("HF_HOME", "/model_cache")
EAGER_LOAD = os.getenv("EAGER_LOAD", "true").lower() == "true"
IDLE_UNLOAD_SECONDS = int(os.getenv("IDLE_UNLOAD_SECONDS", "0"))
QUANTIZE_MODEL = os.getenv("QUANTIZE_MODEL", "true").lower() == "true"
WARMUP_TEXT = os.getenv("WARMUP_TEXT", "This movie was absolutely fantastic.")

# PyTorch
TORCH_NUM_THREADS = int(os.getenv("TORCH_NUM_THREADS", "2"))
TORCH_INTEROP_THREADS = int(os.getenv("TORCH_INTEROP_THREADS", "1"))
INFERENCE_CONCURRENCY = int(os.getenv("INFERENCE_CONCURRENCY", str(TORCH_NUM_THREADS)))
INFERENCE_QUEUE_TIMEOUT_MS = int(os.getenv("INFERENCE_QUEUE_TIMEOUT_MS", "0"))

# External Services
TMDB_API_KEY = os.getenv("TMDB_API_KEY", "")
REDIS_URL = os.getenv("REDIS_URL")
LIBRARY_URL = _service_url(os.getenv("LIBRARY_URL", "http://localhost:8001"))

# Review Analysis
REVIEW_CHUNK_CHARS = int(os.getenv("REVIEW_CHUNK_CHARS", "400"))
REVIEW_CHUNK_HARD_MAX = int(os.getenv("REVIEW_CHUNK_HARD_MAX", "600"))
REVIEW_MAX_CHUNKS = int(os.getenv("REVIEW_MAX_CHUNKS", "8"))

# Cache Settings
CACHE_VERSION = os.getenv("CACHE_VERSION", "v1")
EMOTIONS_CACHE_TTL = int(os.getenv("EMOTIONS_CACHE_TTL", "604800"))

# HTTP Clients
LIBRARY_TIMEOUT_SECONDS = float(os.getenv("LIBRARY_TIMEOUT_SECONDS", "5.0"))
TMDB_TIMEOUT_SECONDS = float(os.getenv("TMDB_TIMEOUT_SECONDS", "10.0"))
HTTPX_MAX_KEEPALIVE = int(os.getenv("HTTPX_MAX_KEEPALIVE", "20"))
HTTPX_MAX_CONNECTIONS = int(os.getenv("HTTPX_MAX_CONNECTIONS", "100"))
