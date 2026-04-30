"""Movie library service: persists per-user saved movies in PostgreSQL.

Auth: an opaque user identifier is read from the X-User-Id header. The
frontend generates a UUID, persists it in localStorage, and sends it on every
request. This keeps the data model honestly user-scoped while leaving real
authentication for a follow-up change. The header is required; missing or
empty values are rejected.
"""

import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Path
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import FRONTEND_URL
from db import get_session, init_schema
from models import SavedMovie
from schemas import HealthResponse, ReadyResponse, SavedMovieResponse, SaveMovieRequest

USER_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


# ------------------------------------------ #
#             LIFECYCLE & STARTUP            #
# ------------------------------------------ #


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Initialize the database schema on startup."""
    await init_schema()
    yield


app = FastAPI(
    title="Movie Vibes — Library API",
    description=(
        "Private Postgres-backed watchlist service. Stores saved movies per user "
        "and exposes a thin REST interface consumed by the backend proxy.\n\n"
        "**OpenAPI schema:** [`/openapi.json`](/openapi.json)  \n"
        "**Interactive docs:** [`/docs`](/docs) (Swagger UI) · [`/redoc`](/redoc) (ReDoc)"
    ),
    version="1.0.0",
    openapi_tags=[
        {"name": "library", "description": "Watchlist save / list / delete operations."},
        {"name": "health", "description": "Liveness and readiness probes."},
    ],
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_headers=["Content-Type", "X-User-Id"],
    allow_methods=["GET", "POST", "DELETE"],
)


# ------------------------------------------ #
#             AUTH HELPERS                   #
# ------------------------------------------ #


def _require_user_id(x_user_id: str | None = Header(default=None, alias="X-User-Id")) -> str:
    """Validate and return the X-User-Id header."""
    if not x_user_id or not USER_ID_RE.match(x_user_id):
        raise HTTPException(status_code=400, detail="Missing or malformed X-User-Id header")
    return x_user_id


# ------------------------------------------ #
#             HEALTH & READINESS             #
# ------------------------------------------ #


@app.get("/health", tags=["health"])
async def health() -> HealthResponse:
    """Return the overall health status of the service."""
    return HealthResponse(status="ok")


@app.get("/ready", tags=["health"])
async def ready(session: AsyncSession = Depends(get_session)) -> ReadyResponse:
    """Check database connectivity for readiness."""
    try:
        await session.execute(select(1))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Database not ready: {exc}") from exc
    return ReadyResponse(status="ready")


# ------------------------------------------ #
#             LIBRARY CRUD                   #
# ------------------------------------------ #


@app.post("/library/movies", tags=["library"], status_code=201)
async def save_movie(
    payload: SaveMovieRequest,
    user_id: str = Depends(_require_user_id),
    session: AsyncSession = Depends(get_session),
) -> SavedMovieResponse:
    """
    Save a movie to the user's library.

    Flow:
    1. Attempts to insert the movie record.
    2. Catches integrity errors if the movie is already saved.
    3. Returns the existing record on conflict, or the new record on success.
    """
    movie = SavedMovie(user_id=user_id, **payload.model_dump())
    session.add(movie)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(
            select(SavedMovie).where(
                SavedMovie.user_id == user_id,
                SavedMovie.tmdb_id == payload.tmdb_id,
            )
        )
        if existing is None:
            raise HTTPException(status_code=500, detail="Save conflict could not be resolved")
        return SavedMovieResponse.model_validate(existing)

    await session.refresh(movie)
    return SavedMovieResponse.model_validate(movie)


@app.get("/library/movies", tags=["library"])
async def list_movies(
    user_id: str = Depends(_require_user_id),
    session: AsyncSession = Depends(get_session),
) -> list[SavedMovieResponse]:
    """List all saved movies for the authenticated user."""
    rows = await session.scalars(
        select(SavedMovie).where(SavedMovie.user_id == user_id).order_by(SavedMovie.saved_at.desc())
    )
    return [SavedMovieResponse.model_validate(row) for row in rows]


@app.delete("/library/movies/{tmdb_id}", tags=["library"], status_code=204)
async def delete_movie(
    tmdb_id: int = Path(..., gt=0),
    user_id: str = Depends(_require_user_id),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Remove a movie from the user's library by TMDB ID."""
    result = await session.execute(
        delete(SavedMovie).where(
            SavedMovie.user_id == user_id,
            SavedMovie.tmdb_id == tmdb_id,
        )
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Movie not in library")
    return None
