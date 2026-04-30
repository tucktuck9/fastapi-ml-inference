#!/usr/bin/env bash
#
# setup.sh
# ------------
# Onboarding script for developers running this sample project. Run once
# after cloning, add your environment variables, then `docker-compose up --build`.
#
# What it does:
#   1. Walks each variant (vanilla-js/, typescript-react/) and copies
#      .env.example -> .env for every service (backend, library, frontend).
#      One filename across all services keeps the convention consistent
#      and matches the defaults of every tool involved: python-dotenv,
#      pydantic-settings, Compose's env_file:, and Vite. .env must be
#      gitignored so local values never get committed.
#   2. Runs `npm ci` in typescript-react/frontend/ so the IDE has type
#      resolution immediately (no red squigglies on first open).
#
# Existing .env files are never overwritten.
#
# Usage:
#     ./scripts/setup.sh
#
#     # With debug tracing:
#     DEBUG=1 ./scripts/setup.sh

set -euo pipefail
[ "${DEBUG:-}" = "1" ] && set -x

# ---------- Configuration ----------

# Variants to walk. Add new ones here when setup-project.sh grows.
readonly VARIANTS=(vanilla-js typescript-react)

# Services within each variant that get an .env from .env.example.
readonly SERVICES=(backend library frontend)

# Path to the Vite frontend that needs `npm ci` for IDE support.
# (The vanilla-js frontend has no package.json, so it's skipped.)
readonly NODE_FRONTEND_DIR="typescript-react/frontend"

# ---------- Helpers ----------

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m \xe2\x9c\x93\033[0m %s\n' "$*"; }
skip() { printf '\033[1;33m \xe2\x86\xb7\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m xx\033[0m %s\n' "$*" >&2; exit 1; }

# Copy src -> dst if dst doesn't already exist. Reports either way.
copy_if_missing() {
  local src="$1" dst="$2"
  if [ ! -f "$src" ]; then
    return 0
  fi
  if [ -f "$dst" ]; then
    skip "$dst already exists, leaving it alone"
  else
    cp "$src" "$dst"
    ok "$dst"
  fi
}

# ---------- Preflight ----------

log "Checking repo root"

# We expect at least one variant directory to exist. If none do, the
# developer is probably running from the wrong directory, or the repo
# was cloned incompletely.
found_any_variant=0
for variant in "${VARIANTS[@]}"; do
  if [ -d "$variant" ]; then
    found_any_variant=1
    break
  fi
done
if [ "$found_any_variant" -eq 0 ]; then
  die "No variant directories found (expected one of: ${VARIANTS[*]}). Run this script from the repo root."
fi

ok "Repo root looks good"

# ---------- Step 1: .env files for every service and project root ----------

# Root-level .env.example -> .env
copy_if_missing ".env.example" ".env"

# Service-level .env.example files for each service in each variant.
for variant in "${VARIANTS[@]}"; do
  if [ ! -d "$variant" ]; then
    skip "$variant/ doesn't exist, skipping"
    continue
  fi
  for service in "${SERVICES[@]}"; do
    copy_if_missing "$variant/$service/.env.example" "$variant/$service/.env"
  done
done

# ---------- Step 2: npm ci for IDE support ----------

log "Step 2/2: Installing frontend dependencies for TypeScript IDE support"

if [ ! -d "$NODE_FRONTEND_DIR" ]; then
  skip "$NODE_FRONTEND_DIR/ doesn't exist, skipping npm ci"
elif [ ! -f "$NODE_FRONTEND_DIR/package.json" ]; then
  skip "$NODE_FRONTEND_DIR/package.json missing, skipping npm ci"
elif [ ! -f "$NODE_FRONTEND_DIR/package-lock.json" ]; then
  warn "$NODE_FRONTEND_DIR/package-lock.json missing. Skipping npm ci. (If you cloned the repo and this file is missing, the upstream commit is incomplete — file an issue.)"
else
  command -v npm >/dev/null 2>&1 || die "npm is not installed but $NODE_FRONTEND_DIR/ needs it"
  (cd "$NODE_FRONTEND_DIR" && npm ci --silent)
  ok "$NODE_FRONTEND_DIR/node_modules ready"
fi

# ---------- Summary ----------

# Use `printf` (not `cat <<EOF`) so the ANSI escape \033 is interpreted as
# a real ESC byte. `cat` would print the literal characters \033[1;32m.
printf '\n\033[1;32mDev setup complete.\033[0m\n\nNext steps:\n  1. Open the .env files and fill in any real keys (e.g., TMDB_API_KEY in backend/.env)\n  2. Start the stack: docker-compose up\n'