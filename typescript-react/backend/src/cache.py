"""Thin Redis wrapper with graceful degradation.

Every function handles the case where Redis is unavailable — the app works
without caching, just slower. This keeps Redis truly optional: if REDIS_URL
isn't set or the server goes down, the app continues serving requests.

Cache key scheme: emotions:{CACHE_VERSION}:{review_id}
Bump CACHE_VERSION to invalidate all cached emotion scores after a model swap.
"""

import json
import logging
from typing import Any

import redis.asyncio as aioredis

from config import CACHE_VERSION, EMOTIONS_CACHE_TTL, REDIS_URL

logger = logging.getLogger(__name__)

_client: aioredis.Redis | None = None


# ------------------------------------------ #
#             LIFECYCLE                      #
# ------------------------------------------ #


async def init_redis() -> None:
    """Initialize the Redis connection if REDIS_URL is configured."""
    global _client
    if REDIS_URL:
        _client = aioredis.from_url(REDIS_URL, decode_responses=True)
        logger.info("[cache] connected to Redis")
    else:
        logger.info("[cache] REDIS_URL not set — caching disabled")


async def close_redis() -> None:
    """Close the Redis connection gracefully."""
    if _client:
        await _client.aclose()


# ------------------------------------------ #
#             LOW-LEVEL HELPERS              #
# ------------------------------------------ #


async def cache_get(key: str) -> Any | None:
    """Read a cached value. Returns None if Redis is unavailable or key missing."""
    if not _client:
        return None
    try:
        raw = await _client.get(key)
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.warning("[cache] read failed key=%s: %s", key, exc)
        return None


async def cache_set(key: str, data: Any, ttl: int = EMOTIONS_CACHE_TTL) -> None:
    """Write a value to cache with TTL. Fails silently."""
    if not _client:
        return
    try:
        await _client.setex(key, ttl, json.dumps(data))
    except Exception as exc:
        logger.warning("[cache] write failed key=%s: %s", key, exc)


# ------------------------------------------ #
#             EMOTIONS CACHE                 #
# ------------------------------------------ #


def _emotions_key(review_id: str) -> str:
    """Return the versioned cache key for a review's emotion scores."""
    return f"emotions:{CACHE_VERSION}:{review_id}"


async def get_emotions(review_id: str) -> list[dict] | None:
    """Return cached emotion scores for a review, or None on miss."""
    return await cache_get(_emotions_key(review_id))


async def set_emotions(review_id: str, emotions: list[dict]) -> None:
    """Cache emotion scores for a review."""
    await cache_set(_emotions_key(review_id), emotions)


# ------------------------------------------ #
#             HEALTH                         #
# ------------------------------------------ #


async def check_health() -> bool:
    """Return True if Redis is reachable, False if unavailable or unconfigured."""
    if not _client:
        return False
    try:
        return bool(await _client.ping())
    except Exception:
        return False
