"""Module-level httpx.AsyncClient instances with shared lifecycle.

A new AsyncClient per request opens a fresh TCP+TLS connection (and re-resolves
DNS) for every upstream call, costing 50–150 ms of handshake on each cache miss.
Holding clients at module scope and reusing them across requests amortizes the
handshake to once per process and lets httpx's connection pool keep keepalive
sockets warm.

Two clients are exposed:

- `tmdb_client` — outbound HTTPS to api.themoviedb.org. Default timeout 10 s.
- `library_client` — internal HTTP to the private library service over Render's
  private network. Timeout is configurable via LIBRARY_TIMEOUT_SECONDS.

Both are initialized in the FastAPI lifespan handler at startup and closed at
shutdown. Calling get_*_client() before init or after close raises RuntimeError
rather than silently creating an unmanaged client.
"""

import httpx

from config import (
    HTTPX_MAX_CONNECTIONS,
    HTTPX_MAX_KEEPALIVE,
    LIBRARY_TIMEOUT_SECONDS,
    TMDB_TIMEOUT_SECONDS,
)

_tmdb_client: httpx.AsyncClient | None = None
_library_client: httpx.AsyncClient | None = None


# ------------------------------------------ #
#             LIFECYCLE                      #
# ------------------------------------------ #


async def init_clients() -> None:
    """Create module-level AsyncClient instances at app startup."""
    global _tmdb_client, _library_client
    limits = httpx.Limits(
        max_keepalive_connections=HTTPX_MAX_KEEPALIVE,
        max_connections=HTTPX_MAX_CONNECTIONS,
    )
    _tmdb_client = httpx.AsyncClient(
        timeout=TMDB_TIMEOUT_SECONDS,
        limits=limits,
        base_url="https://api.themoviedb.org",
    )
    _library_client = httpx.AsyncClient(
        timeout=LIBRARY_TIMEOUT_SECONDS,
        limits=limits,
    )


async def close_clients() -> None:
    """Close module-level AsyncClient instances at app shutdown."""
    global _tmdb_client, _library_client
    if _tmdb_client is not None:
        await _tmdb_client.aclose()
        _tmdb_client = None
    if _library_client is not None:
        await _library_client.aclose()
        _library_client = None


# ------------------------------------------ #
#             ACCESSORS                      #
# ------------------------------------------ #


def get_tmdb_client() -> httpx.AsyncClient:
    """Return the shared TMDB client, raising if uninitialized."""
    if _tmdb_client is None:
        raise RuntimeError("TMDB client not initialized; call init_clients() in lifespan")
    return _tmdb_client


def get_library_client() -> httpx.AsyncClient:
    """Return the shared library-service client, raising if uninitialized."""
    if _library_client is None:
        raise RuntimeError("Library client not initialized; call init_clients() in lifespan")
    return _library_client
