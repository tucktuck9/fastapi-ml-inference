"""Request and response shapes for the library service."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

# ------------------------------------------ #
#             HEALTH                         #
# ------------------------------------------ #


class HealthResponse(BaseModel):
    """Response for GET /health."""

    status: str


class ReadyResponse(BaseModel):
    """Response for GET /ready."""

    status: str


# ------------------------------------------ #
#             LIBRARY                        #
# ------------------------------------------ #


class EmotionScore(BaseModel):
    """A single labelled emotion with its confidence score."""

    label: str
    score: float


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
    # Movie metadata
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
