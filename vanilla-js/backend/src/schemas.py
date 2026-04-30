"""Request and response shapes for the backend API.

Keeping schemas in a dedicated module lets the route handlers stay lean and
makes the OpenAPI schema self-documenting without any annotations inside main.py.
"""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from config import MAX_INPUT_CHARS

# ------------------------------------------ #
#             SHARED PRIMITIVES              #
# ------------------------------------------ #


class EmotionScore(BaseModel):
    """A single labelled emotion with its confidence score."""

    label: str
    score: float = Field(..., ge=0.0, le=1.0)


# ------------------------------------------ #
#           LIBRARY PROXY                    #
# ------------------------------------------ #


class SaveMovieRequest(BaseModel):
    """Payload for saving a movie to the watchlist."""

    tmdb_id: int = Field(..., gt=0)
    title: str = Field(..., min_length=1, max_length=500)
    year: str | None = Field(None, max_length=4)
    runtime_min: int | None = None
    poster_url: str | None = Field(None, max_length=500)
    tagline: str | None = Field(None, max_length=500)
    overview: str | None = None
    genres: list[str] | None = None
    tmdb_rating: str | None = Field(None, max_length=64)
    emotions: list[EmotionScore] | None = None


class SavedMovieResponse(BaseModel):
    """A movie that has been saved to the watchlist."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    tmdb_id: int
    title: str
    year: str | None
    runtime_min: int | None
    poster_url: str | None
    tagline: str | None
    overview: str | None
    genres: list[str] | None
    tmdb_rating: str | None
    emotions: list[dict[str, Any]] | None
    saved_at: datetime


# ------------------------------------------ #
#              INFERENCE                     #
# ------------------------------------------ #


class PredictRequest(BaseModel):
    """Text to classify."""

    text: str = Field(..., min_length=1, max_length=MAX_INPUT_CHARS)


class PredictionResult(BaseModel):
    """Raw output from the model manager for a single text input."""

    task: str
    prediction: list[EmotionScore]
    inference_ms: float


class PredictResponse(BaseModel):
    """Response for POST /predict."""

    status: str
    model_id: str
    latency_ms: float
    result: PredictionResult
    cache_hit: bool = False


# ------------------------------------------ #
#                 HEALTH                     #
# ------------------------------------------ #


class HealthResponse(BaseModel):
    """Response for GET /health."""

    status: str
    service_alive: bool
    model_ready: bool
    model_loaded: bool
    cache_connected: bool


class ReadyResponse(BaseModel):
    """Response for GET /ready."""

    status: str
    model_id: str
    model_loaded: bool
    model_ready: bool


# ------------------------------------------ #
#                  ADMIN                     #
# ------------------------------------------ #


class ModelStatus(BaseModel):
    """Snapshot of the model manager's internal state."""

    model_id: str
    hf_home: str
    loaded: bool
    ready: bool
    loading: bool
    loaded_at: float | None
    last_used_at: float | None
    idle_unload_seconds: float


class GateStatus(BaseModel):
    """Snapshot of the inference gate's current occupancy."""

    concurrency_limit: int
    inflight: int
    queue_timeout_ms: int


class AdminStatusResponse(ModelStatus):
    """Response for GET /admin/status (ModelStatus + eager_load flag + gate state)."""

    eager_load: bool
    inference_gate: GateStatus | None = None


class AdminLoadResponse(BaseModel):
    """Response for POST /admin/load."""

    status: str
    loaded_now: bool
    state: ModelStatus


class AdminUnloadResponse(BaseModel):
    """Response for POST /admin/unload."""

    status: str
    unloaded: bool
    state: ModelStatus


# ------------------------------------------ #
#                  MOVIES                    #
# ------------------------------------------ #


class MovieRatings(BaseModel):
    """Aggregated rating strings keyed by source."""

    tmdb: str


class MovieResponse(BaseModel):
    """Response for GET /movie."""

    tmdb_id: int
    title: str | None
    year: str
    runtime_min: int | None
    genres: list[str]
    tagline: str | None
    overview: str
    poster: str | None
    ratings: MovieRatings


# ------------------------------------------ #
#                  REVIEWS                   #
# ------------------------------------------ #


class ReviewWithEmotions(BaseModel):
    """A single TMDB review annotated with top emotion scores."""

    id: str | None
    author: str
    content: str
    created_at: str | None
    url: str | None
    rating: float | None
    emotions: list[EmotionScore] = Field(default_factory=list)


class ReviewSummaryResponse(BaseModel):
    """Response for GET /movies/{tmdb_id}/reviews/summary."""

    reviews: list[ReviewWithEmotions]
    overall: list[EmotionScore]
    total_results: int
    total_pages: int
    has_more: bool
    inference_ms: float


class ReviewsPageResponse(BaseModel):
    """Response for GET /movies/{tmdb_id}/reviews."""

    reviews: list[ReviewWithEmotions]
    page: int
    total_pages: int
    total_results: int
    has_more: bool
    inference_ms: float
