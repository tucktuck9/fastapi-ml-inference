"""FastAPI application for ML inference and TMDB movie analysis.

This module serves as the primary entry point for the backend service. It exposes
endpoints for model health, inference, and movie review sentiment analysis.
"""

import asyncio
import hashlib
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import cache
import http_clients
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from http_clients import get_tmdb_client
from inference_gate import InferenceBusy, gate_status, inference_gate
from library_proxy import router as library_router
from model_manager import ModelManager
from review_analysis import aggregate_emotions, classify_reviews_chunked, format_review

from config import (
    EAGER_LOAD,
    FRONTEND_URL,
    HF_HOME,
    IDLE_UNLOAD_SECONDS,
    MAX_INPUT_CHARS,
    MODEL_ID,
    MODEL_REVISION,
    REVIEWS_PAGE_SIZE,
    SUMMARY_REVIEW_LIMIT,
    TMDB_API_KEY,
    TOP_EMOTIONS,
)
from schemas import (
    AdminLoadResponse,
    AdminStatusResponse,
    AdminUnloadResponse,
    EmotionScore,
    HealthResponse,
    MovieRatings,
    MovieResponse,
    PredictionResult,
    PredictRequest,
    PredictResponse,
    ReadyResponse,
    ReviewsPageResponse,
    ReviewSummaryResponse,
    ReviewWithEmotions,
)

manager = ModelManager(
    model_id=MODEL_ID,
    model_revision=MODEL_REVISION,
    hf_home=HF_HOME,
    idle_unload_seconds=IDLE_UNLOAD_SECONDS,
)

cleanup_task = None


# ------------------------------------------ #
#             LIFECYCLE & STARTUP            #
# ------------------------------------------ #


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Manage the application lifecycle, including eager model loading and background tasks.

    Flow:
    1. Eagerly loads model in a background thread if EAGER_LOAD is true.
    2. Starts the idle cleanup loop background task.
    3. Yields control to the FastAPI application.
    4. Cancels the cleanup task and unloads the model on shutdown.
    """
    global cleanup_task
    await cache.init_redis()
    await http_clients.init_clients()
    if EAGER_LOAD:
        try:
            await asyncio.to_thread(manager.load_model)
        except Exception as exc:
            print(f"[startup] eager model load failed: {exc}")
    cleanup_task = asyncio.create_task(_idle_cleanup_loop())
    try:
        yield
    finally:
        if cleanup_task:
            cleanup_task.cancel()
            try:
                await cleanup_task
            except asyncio.CancelledError:
                pass
        await asyncio.to_thread(manager.unload_model)
        await http_clients.close_clients()
        await cache.close_redis()


app = FastAPI(
    title="Movie Vibes — ML Inference API",
    description=(
        "CPU emotion inference on Hugging Face models with a persistent disk cache. "
        "Classifies movie review text into emotion scores, proxies TMDB metadata, "
        "and manages a per-user watchlist via a private Postgres-backed library service.\n\n"
        "**OpenAPI schema:** [`/openapi.json`](/openapi.json)  \n"
        "**Interactive docs:** [`/docs`](/docs) (Swagger UI) · [`/redoc`](/redoc) (ReDoc)"
    ),
    version="1.0.0",
    openapi_tags=[
        {"name": "inference", "description": "Emotion classification endpoints."},
        {"name": "movies", "description": "TMDB movie lookup and review analysis."},
        {"name": "library", "description": "Per-user watchlist (proxied to the library service)."},
        {"name": "admin", "description": "Model lifecycle management."},
        {"name": "health", "description": "Liveness and readiness probes."},
    ],
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

app.include_router(library_router)


# ------------------------------------------ #
#             BACKGROUND TASKS               #
# ------------------------------------------ #


async def _idle_cleanup_loop() -> None:
    """
    Background task to periodically check and unload the model if idle.

    Flow:
    1. Sleeps for 15 seconds.
    2. Calls manager.maybe_unload_if_idle in a background thread.
    3. Repeats indefinitely.
    """
    while True:
        await asyncio.sleep(15)
        await asyncio.to_thread(manager.maybe_unload_if_idle)


# ------------------------------------------ #
#             HEALTH & READINESS             #
# ------------------------------------------ #


@app.get("/health", tags=["health"])
async def health() -> HealthResponse:
    """Return the overall health status of the service."""
    return HealthResponse(
        status="ok",
        service_alive=True,
        model_ready=manager.is_ready(),
        model_loaded=manager.is_loaded(),
        cache_connected=await cache.check_health(),
    )


@app.get("/ready", tags=["health"])
def ready() -> ReadyResponse:
    """Return the readiness status of the model."""
    if not manager.is_ready():
        raise HTTPException(status_code=503, detail="Model not ready")
    return ReadyResponse(
        status="ready",
        model_id=manager.model_id,
        model_loaded=manager.is_loaded(),
        model_ready=manager.is_ready(),
    )


# ------------------------------------------ #
#                  ADMIN                     #
# ------------------------------------------ #


@app.get("/admin/status", tags=["admin"])
def admin_status() -> AdminStatusResponse:
    """Return detailed status information about the model manager."""
    return AdminStatusResponse(
        **manager.status().model_dump(),
        eager_load=EAGER_LOAD,
        inference_gate=gate_status(),
    )


@app.post("/admin/load", tags=["admin"])
def admin_load() -> AdminLoadResponse:
    """Force the model to load into memory."""
    loaded_now = manager.load_model()
    return AdminLoadResponse(
        status="ok",
        loaded_now=loaded_now,
        state=manager.status(),
    )


@app.post("/admin/unload", tags=["admin"])
def admin_unload() -> AdminUnloadResponse:
    """Force the model to unload from memory."""
    unloaded = manager.unload_model()
    return AdminUnloadResponse(
        status="ok",
        unloaded=unloaded,
        state=manager.status(),
    )


# ------------------------------------------ #
#                INFERENCE                   #
# ------------------------------------------ #


@app.post("/predict", tags=["inference"])
async def predict(payload: PredictRequest) -> PredictResponse:
    """
    Classify the provided text into emotional categories.

    Flow:
    1. Validates text length and content.
    2. Checks Redis cache by SHA-256 hash of the input text (1-hour TTL).
    3. On cache miss: acquires the inference gate, runs the forward pass in a
       thread pool worker, writes the result to cache.
    4. Returns 503 with Retry-After if the gate is full beyond the wait budget.
    """
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text must not be empty")
    if len(text) > MAX_INPUT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Input exceeds MAX_INPUT_CHARS={MAX_INPUT_CHARS}",
        )

    text_hash = hashlib.sha256(text.encode()).hexdigest()
    cached = await cache.cache_get(f"predict:v1:{text_hash}")
    if cached:
        return PredictResponse(**cached, cache_hit=True)

    try:
        start = time.perf_counter()
        async with inference_gate():
            raw = await asyncio.to_thread(manager.predict, text)
        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        response = PredictResponse(
            status="ok",
            model_id=manager.model_id,
            latency_ms=latency_ms,
            result=PredictionResult.model_validate(raw),
            cache_hit=False,
        )
        await cache.cache_set(
            f"predict:v1:{text_hash}",
            response.model_dump(exclude={"cache_hit"}),
            ttl=3600,
        )
        return response
    except InferenceBusy as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
            headers={"Retry-After": "1"},
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc


# ------------------------------------------ #
#          MOVIE EMOTION ANALYSIS            #
# ------------------------------------------ #


@app.get("/movie", tags=["movies"], response_model=MovieResponse)
async def movie(title: str = Query(..., min_length=1, max_length=200)) -> dict:
    """
    Fetch movie details from TMDB by title.

    Flow:
    1. Searches TMDB for the movie title.
    2. Fetches detailed movie information using the first result's ID.
    3. Formats and returns movie metadata (poster, genres, ratings, etc.).
    """
    if not TMDB_API_KEY:
        raise HTTPException(status_code=503, detail="TMDB_API_KEY is not configured")

    client = get_tmdb_client()
    try:
        search_resp = await client.get(
            "/3/search/movie",
            params={"query": title, "api_key": TMDB_API_KEY, "language": "en-US", "page": 1},
        )
        search_resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TMDB search request failed: {exc}") from exc

    results = search_resp.json().get("results", [])
    if not results:
        raise HTTPException(status_code=404, detail="Movie not found on TMDB")

    movie_id = results[0]["id"]

    try:
        detail_resp = await client.get(
            f"/3/movie/{movie_id}",
            params={"api_key": TMDB_API_KEY, "language": "en-US"},
        )
        detail_resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TMDB detail request failed: {exc}") from exc

    data = detail_resp.json()
    poster_path = data.get("poster_path")

    return MovieResponse(
        tmdb_id=movie_id,
        title=data.get("title"),
        year=(data.get("release_date") or "")[:4],
        runtime_min=data.get("runtime"),
        genres=[g["name"] for g in data.get("genres", [])],
        tagline=data.get("tagline"),
        overview=data.get("overview", ""),
        poster=f"https://image.tmdb.org/t/p/w342{poster_path}" if poster_path else None,
        ratings=MovieRatings(
            tmdb=f"{round(data.get('vote_average', 0), 1)}/10 ({data.get('vote_count', 0):,} votes)"
        ),
    )


# ------------------------------------------ #
#     MOVIE REVIEWS & EMOTION ANALYSIS       #
# ------------------------------------------ #


async def _partition_by_cache(
    reviews: list[dict],
) -> tuple[dict[int, list[dict]], list[dict]]:
    """Split reviews into cache hits (by original index) and misses."""
    hits: dict[int, list[dict]] = {}
    misses: list[dict] = []
    for idx, review in enumerate(reviews):
        review_id = review.get("id")
        hit = await cache.get_emotions(str(review_id)) if review_id else None
        if hit is not None:
            hits[idx] = hit
        else:
            misses.append(review)
    return hits, misses


async def _infer_and_cache(
    reviews: list[dict],
) -> tuple[list[list[dict]], float]:
    """
    Run a single batched forward pass and write results to cache.

    classify_reviews_chunked is CPU-bound and blocks for ~100–200 ms. It runs
    inside the inference gate so it can't starve concurrent /predict callers,
    and it runs in a thread pool worker via asyncio.to_thread so the ASGI
    event loop stays free.
    """
    async with inference_gate():
        preds, inference_ms = await asyncio.to_thread(
            classify_reviews_chunked, reviews, manager.predict_batch
        )
    for review, pred in zip(reviews, preds):
        if review_id := review.get("id"):
            await cache.set_emotions(str(review_id), pred)
    return preds, inference_ms


def _merge_results(
    hits: dict[int, list[dict]],
    new_preds: list[list[dict]],
    total: int,
) -> list[list[dict]]:
    """Reassemble results in original review order from cache hits and new predictions."""
    new_iter = iter(new_preds)
    return [hits[i] if i in hits else next(new_iter) for i in range(total)]


async def _classify_with_cache(
    reviews: list[dict],
) -> tuple[list[list[dict]], float]:
    """
    Run emotion classification with per-review Redis cache.

    Flow:
    1. Partition reviews into cache hits and misses.
    2. Run inference only on misses (single batched forward pass).
    3. Write new predictions to cache.
    4. Merge hits and new predictions in original order.
    """
    hits, misses = await _partition_by_cache(reviews)
    if not misses:
        return _merge_results(hits, [], len(reviews)), 0.0
    new_preds, inference_ms = await _infer_and_cache(misses)
    return _merge_results(hits, new_preds, len(reviews)), inference_ms


async def _fetch_tmdb_reviews(movie_id: int, page: int = 1) -> dict:
    """
    Fetch movie reviews from TMDB for a given movie ID and page.

    Flow:
    1. Checks for TMDB API key.
    2. Makes async HTTP GET request to TMDB reviews endpoint.
    3. Returns JSON response.
    """
    if not TMDB_API_KEY:
        raise HTTPException(status_code=503, detail="TMDB_API_KEY is not configured")

    client = get_tmdb_client()
    try:
        resp = await client.get(
            f"/3/movie/{movie_id}/reviews",
            params={"api_key": TMDB_API_KEY, "language": "en-US", "page": page},
        )
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"TMDB reviews request failed: {exc}") from exc

    return resp.json()


@app.get("/movies/{tmdb_id}/reviews/summary", tags=["movies"])
async def reviews_summary(tmdb_id: int) -> ReviewSummaryResponse:
    """
    Detail-page hero: top 5 most recent reviews + aggregate mood.

    Flow:
    1. Fetches first page of reviews from TMDB.
    2. Formats and limits to SUMMARY_REVIEW_LIMIT.
    3. Runs batched chunked classification on all reviews.
    4. Aggregates emotions and returns top results.
    """
    payload = await _fetch_tmdb_reviews(tmdb_id, page=1)
    raw = (payload.get("results") or [])[:SUMMARY_REVIEW_LIMIT]
    total_results = int(payload.get("total_results") or 0)
    total_pages = int(payload.get("total_pages") or 0)

    if not raw:
        return ReviewSummaryResponse(
            reviews=[],
            overall=[],
            total_results=total_results,
            total_pages=total_pages,
            has_more=False,
            inference_ms=0.0,
        )

    reviews = [format_review(r) for r in raw]
    per_review_preds, inference_ms = await _classify_with_cache(reviews)
    per_review_top = [ranked[:TOP_EMOTIONS] for ranked in per_review_preds]
    overall_top = aggregate_emotions(per_review_preds)[:TOP_EMOTIONS]

    return ReviewSummaryResponse(
        reviews=[
            ReviewWithEmotions(**review, emotions=top)
            for review, top in zip(reviews, per_review_top)
        ],
        overall=[EmotionScore(**e) for e in overall_top],
        total_results=total_results,
        total_pages=total_pages,
        has_more=total_results > len(reviews),
        inference_ms=inference_ms,
    )


@app.get("/movies/{tmdb_id}/reviews", tags=["movies"])
async def reviews_paginated(
    tmdb_id: int,
    page: int = Query(1, ge=1, le=500),
) -> ReviewsPageResponse:
    """
    All-reviews page: TMDB pagination passthrough, 20 reviews per page.

    Flow:
    1. Fetches requested page of reviews from TMDB.
    2. Formats and limits to REVIEWS_PAGE_SIZE.
    3. Runs batched chunked classification on all reviews.
    4. Returns paginated reviews with top emotions.
    """
    payload = await _fetch_tmdb_reviews(tmdb_id, page=page)
    raw = (payload.get("results") or [])[:REVIEWS_PAGE_SIZE]
    total_results = int(payload.get("total_results") or 0)
    total_pages = int(payload.get("total_pages") or 0)

    if not raw:
        return ReviewsPageResponse(
            reviews=[],
            page=page,
            total_pages=total_pages,
            total_results=total_results,
            has_more=False,
            inference_ms=0.0,
        )

    reviews = [format_review(r) for r in raw]
    per_review_preds, inference_ms = await _classify_with_cache(reviews)
    per_review_top = [ranked[:TOP_EMOTIONS] for ranked in per_review_preds]

    return ReviewsPageResponse(
        reviews=[
            ReviewWithEmotions(**review, emotions=top)
            for review, top in zip(reviews, per_review_top)
        ],
        page=page,
        total_pages=total_pages,
        total_results=total_results,
        has_more=page < total_pages,
        inference_ms=inference_ms,
    )
