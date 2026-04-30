"""Environment configuration and defaults for the library service."""

import os

FRONTEND_URL = os.getenv("FRONTEND_URL", "*")
DATABASE_URL = os.environ["DATABASE_URL"]
