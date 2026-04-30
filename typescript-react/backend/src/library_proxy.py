"""Private service proxy for the library (saved-movies) service.

The library runs as a Render private service (pserv) — it has no public URL
and is only reachable from the backend over Render's internal network.
The browser calls /library/* on the backend; the backend proxies each
request through, forwarding only the X-User-Id header.

This keeps a single public surface area for CORS, auth, and rate limiting,
and lets the library service focus on being a thin database layer.

On Render:  LIBRARY_URL is injected via fromService → property: hostport.
Locally:    docker-compose overrides LIBRARY_URL to http://library:8001.
"""

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from http_clients import get_library_client

from config import LIBRARY_URL
from schemas import SavedMovieResponse, SaveMovieRequest

_LIBRARY_FORWARDED_HEADERS = ("X-User-Id", "x-user-id")
router = APIRouter(tags=["library"])


# ------------------------------------------ #
#             PROXY LOGIC                    #
# ------------------------------------------ #


def _forward_headers(request: Request) -> dict[str, str]:
    """Extract and forward specific headers from the incoming request."""
    headers: dict[str, str] = {}
    for name in _LIBRARY_FORWARDED_HEADERS:
        value = request.headers.get(name)
        if value is not None:
            headers["X-User-Id"] = value
            break
    return headers


async def _proxy(
    method: str,
    path: str,
    request: Request,
    *,
    json_body: dict | None = None,
) -> Response:
    """
    Proxy an HTTP request to the internal library service.

    Flow:
    1. Constructs upstream URL and extracts headers.
    2. Makes async HTTP request via the shared library AsyncClient.
    3. Handles connection errors gracefully.
    4. Returns upstream response verbatim.
    """
    url = f"{LIBRARY_URL}{path}"
    headers = _forward_headers(request)
    client = get_library_client()
    try:
        upstream = await client.request(method, url, headers=headers, json=json_body)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Library service unavailable: {exc}") from exc

    media_type = upstream.headers.get("content-type")
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        media_type=media_type,
    )


# ------------------------------------------ #
#             ROUTE HANDLERS                 #
# ------------------------------------------ #


@router.post("/library/movies", response_model=SavedMovieResponse, status_code=201)
async def library_save(payload: SaveMovieRequest, request: Request) -> Response:
    """Save a movie to the current user's watchlist."""
    return await _proxy("POST", "/library/movies", request, json_body=payload.model_dump())


@router.get("/library/movies", response_model=list[SavedMovieResponse])
async def library_list(request: Request) -> Response:
    """List all movies in the current user's watchlist."""
    return await _proxy("GET", "/library/movies", request)


@router.delete("/library/movies/{tmdb_id}", status_code=204)
async def library_delete(tmdb_id: int, request: Request) -> Response:
    """Remove a movie from the current user's watchlist."""
    return await _proxy("DELETE", f"/library/movies/{tmdb_id}", request)
