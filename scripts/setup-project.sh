#!/usr/bin/env bash
#
# setup-project.sh
# ----------------
# One-time scaffold for the fastapi-ml-inference project skeleton.
# Creates the two-variant directory tree (vanilla-js/ and typescript-react/),
# each with backend/, library/, frontend/ subdirectories, plus appropriate
# .dockerignore and empty .env.example files.
#
# Run once at the repo root, commit the result. Contributors don't run this —
# they run ./scripts/dev-setup.sh and then docker-compose up.
#
# What this script does NOT do:
#   - Scaffold the React/Vite frontend (run ./scripts/scaffold-frontend.sh
#     from inside typescript-react/ for that)
#   - Populate Python source (you write that)
#   - Touch existing files (idempotent: skips anything already present)
#
# Usage:
#     # From the repo root (e.g., fastapi-ml-inference/):
#     ./scripts/setup-project.sh
#
#     # With debug tracing:
#     DEBUG=1 ./scripts/setup-project.sh

set -euo pipefail
[ "${DEBUG:-}" = "1" ] && set -x

# ---------- Configuration ----------

# Frontend variants. Add more here (e.g., "vue", "htmx") as the matrix grows.
readonly VARIANTS=(vanilla-js typescript-react)

# Services present in every variant.
readonly SERVICES=(backend library frontend)

# ---------- Helpers ----------

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m \xe2\x9c\x93\033[0m %s\n' "$*"; }
skip() { printf '\033[1;90m -\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m xx\033[0m %s\n' "$*" >&2; exit 1; }

# Create a file only if it doesn't already exist. Pipe content via stdin.
# Usage: echo "content" | write_if_missing path/to/file
write_if_missing() {
  local target="$1"
  if [ -e "$target" ]; then
    skip "$target (already exists)"
    cat > /dev/null  # drain stdin
  else
    cat > "$target"
    ok "$target"
  fi
}

# Ensure a directory exists. Idempotent.
ensure_dir() {
  local target="$1"
  if [ -d "$target" ]; then
    skip "$target/ (already exists)"
  else
    mkdir -p "$target"
    ok "$target/"
  fi
}

# ---------- .dockerignore content ----------

# Python services (backend, library): identical in both variants.
read -r -d '' PYTHON_DOCKERIGNORE <<'EOF' || true
# Python bytecode + cache
__pycache__
*.pyc
*.pyo

# Virtual environments
venv
.venv

# Local env files (secrets stay on host)
.env
.env.*
!.env.example

# Editor / OS noise
.DS_Store
.vscode
.idea
*.swp

# VCS
.git
.gitignore

# Test + coverage artifacts
.coverage
.coverage.*
.cache
.pytest_cache
htmlcov

# Logs
*.log

# Docs / repo metadata
README.md
*.md
EOF

# TypeScript-React frontend: Node-flavored.
read -r -d '' TS_FRONTEND_DOCKERIGNORE <<'EOF' || true
# Dependencies (reinstalled inside image via npm ci)
node_modules

# Build output (regenerated inside image)
dist
dist-ssr

# Local env (secrets stay on host)
.env
.env.*
!.env.example

# Editor / OS noise
.DS_Store
.vscode
.idea
*.swp

# VCS
.git
.gitignore

# Logs and caches
*.log
npm-debug.log*
yarn-debug.log*
.npm
.cache
.eslintcache
.vite

# Test artifacts
coverage

# Docs / repo metadata
README.md
*.md
EOF

# Vanilla-JS frontend: still served by FastAPI runtime, so it's Python-shaped
# at the container level. Use the Python ignore.
VANILLA_FRONTEND_DOCKERIGNORE="$PYTHON_DOCKERIGNORE"

# ---------- Preflight ----------

log "Checking prerequisites"

# This script writes nothing to npm/node, so we don't need them. Just confirm
# we can write to the current directory.
if [ ! -w "." ]; then
  die "Cannot write to current directory ($(pwd))"
fi

# Refuse to run from inside one of the variant dirs (most likely user error).
if [ -d "../scripts" ] && [ ! -d "scripts" ]; then
  die "Run this from the repo root (e.g., fastapi-ml-inference/), not from a subdirectory."
fi

ok "Running from $(pwd)"

# ---------- Scaffold ----------

for variant in "${VARIANTS[@]}"; do
  log "Scaffolding ${variant}/"

  ensure_dir "$variant"

  for service in "${SERVICES[@]}"; do
    ensure_dir "$variant/$service"

    # Empty src/ in every service. Source layout is identical across
    # backend/library/frontend so Dockerfiles can share `COPY ./src /app/src`
    # patterns and so contributors find code in the same place every time.
    # For typescript-react/frontend, scaffold-frontend.sh will populate this
    # later with the Vite scaffold (it skips stashing src/ for that reason).
    ensure_dir "$variant/$service/src"

    # Empty .env.example in every service.
    : > /tmp/setup-project-empty
    write_if_missing "$variant/$service/.env.example" < /tmp/setup-project-empty

    # .dockerignore — varies by service + variant.
    case "$service" in
      backend|library)
        printf '%s\n' "$PYTHON_DOCKERIGNORE" \
          | write_if_missing "$variant/$service/.dockerignore"
        ;;
      frontend)
        if [ "$variant" = "typescript-react" ]; then
          printf '%s\n' "$TS_FRONTEND_DOCKERIGNORE" \
            | write_if_missing "$variant/$service/.dockerignore"
        else
          printf '%s\n' "$VANILLA_FRONTEND_DOCKERIGNORE" \
            | write_if_missing "$variant/$service/.dockerignore"
        fi
        ;;
    esac
  done
done

rm -f /tmp/setup-project-empty

# ---------- Summary ----------

# Use `printf` (not `cat <<EOF`) so the ANSI escape \033 is interpreted as
# a real ESC byte. `cat` would print the literal characters \033[1;32m.
printf '\n\033[1;32mProject scaffold complete.\033[0m\n\nTree (variant/service/<file>):\n  vanilla-js/{backend,library,frontend}/src/\n  vanilla-js/{backend,library,frontend}/.env.example\n  vanilla-js/{backend,library,frontend}/.dockerignore\n  typescript-react/{backend,library,frontend}/src/\n  typescript-react/{backend,library,frontend}/.env.example\n  typescript-react/{backend,library,frontend}/.dockerignore\n\nNext steps:\n  1. PROJECT_NAME=fastapi-ml-inference-frontend ./scripts/scaffold-frontend.sh\n  2. Populate backend/ and library/ in each variant\n  3. Fill in .env.example files with the keys each service needs\n  4. Add docker-compose.yml at the repo root\n  5. Contributors then run: ./scripts/dev-setup.sh && docker-compose up\n'