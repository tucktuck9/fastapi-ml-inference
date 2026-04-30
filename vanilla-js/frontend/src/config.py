"""Environment configuration and defaults for the frontend service."""

import os

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
