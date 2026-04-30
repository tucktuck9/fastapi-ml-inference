"""Static file server and HTML injector for the frontend service."""

import json

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from config import BACKEND_URL

# ------------------------------------------ #
#             APP INITIALIZATION             #
# ------------------------------------------ #

app = FastAPI(title="fastapi-ml-inference-frontend")
app.mount("/static", StaticFiles(directory="static"), name="static")

# ------------------------------------------ #
#             HELPERS                        #
# ------------------------------------------ #


def _env() -> dict[str, str]:
    """Return environment variables to be injected into the frontend."""
    return {
        "BACKEND_URL": BACKEND_URL,
    }


def _inject(filename: str) -> HTMLResponse:
    """
    Read an HTML file and inject environment variables.

    Flow:
    1. Reads the specified HTML file.
    2. Replaces the __ENV_JSON__ placeholder with the environment JSON.
    3. Returns the modified HTML response.
    """
    with open(filename) as f:
        html = f.read().replace("__ENV_JSON__", json.dumps(_env()))
    return HTMLResponse(html)


# ------------------------------------------ #
#             ROUTE HANDLERS                 #
# ------------------------------------------ #


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    """Serve the main index.html file."""
    return _inject("index.html")


@app.get("/benchmark", response_class=HTMLResponse)
def benchmark() -> HTMLResponse:
    """Serve the benchmark.html file."""
    return _inject("benchmark.html")
