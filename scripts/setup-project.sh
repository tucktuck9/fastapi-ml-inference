#!/usr/bin/env bash
#
# setup-project.sh
# Creates directory tree (vanilla-js/, typescript-react/)
# with backend/, library/, frontend/ subdirectories,
# .dockerignore, and .env.example files.
#
# Usage: ./scripts/setup-project.sh
# Debug: DEBUG=1 ./scripts/setup-project.sh

set -euo pipefail
[ "${DEBUG:-}" = "1" ] && set -x

# ---------- Configuration ----------

readonly VARIANTS=(vanilla-js typescript-react)
readonly SERVICES=(backend library frontend)

# ---------- Helpers ----------

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m \xe2\x9c\x93\033[0m %s\n' "$*"; }
skip() { printf '\033[1;90m -\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m xx\033[0m %s\n' "$*" >&2; exit 1; }

write_if_missing() {
  local target="$1"
  if [ -e "$target" ]; then
    skip "$target (already exists)"
    cat > /dev/null
  else
    cat > "$target"
    ok "$target"
  fi
}

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

read -r -d '' PYTHON_DOCKERIGNORE <<'EOF' || true
__pycache__
*.pyc
*.pyo
venv
.venv
.env
.env.*
!.env.example
.DS_Store
.vscode
.idea
*.swp
.git
.gitignore
.coverage
.coverage.*
.cache
.pytest_cache
htmlcov
*.log
README.md
*.md
EOF

read -r -d '' TS_FRONTEND_DOCKERIGNORE <<'EOF' || true
node_modules
dist
dist-ssr
.env
.env.*
!.env.example
.DS_Store
.vscode
.idea
*.swp
.git
.gitignore
*.log
npm-debug.log*
yarn-debug.log*
.npm
.cache
.eslintcache
.vite
coverage
README.md
*.md
EOF

VANILLA_FRONTEND_DOCKERIGNORE="$PYTHON_DOCKERIGNORE"

# ---------- Preflight ----------

log "Checking prerequisites"

if [ ! -w "." ]; then
  die "Cannot write to current directory ($(pwd))"
fi

if [ -d "../scripts" ] && [ ! -d "scripts" ]; then
  die "Run this from the repo root."
fi

ok "Running from $(pwd)"

# ---------- Scaffold ----------

for variant in "${VARIANTS[@]}"; do
  log "Scaffolding ${variant}/"

  ensure_dir "$variant"

  for service in "${SERVICES[@]}"; do
    ensure_dir "$variant/$service"
    ensure_dir "$variant/$service/src"

    : > /tmp/setup-project-empty
    write_if_missing "$variant/$service/.env.example" < /tmp/setup-project-empty

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

printf '\n\033[1;32mProject scaffold complete.\033[0m\n\nTree (variant/service/<file>):\n  vanilla-js/{backend,library,frontend}/src/\n  vanilla-js/{backend,library,frontend}/.env.example\n  vanilla-js/{backend,library,frontend}/.dockerignore\n  typescript-react/{backend,library,frontend}/src/\n  typescript-react/{backend,library,frontend}/.env.example\n  typescript-react/{backend,library,frontend}/.dockerignore\n\nNext steps:\n  1. PROJECT_NAME=fastapi-ml-inference-frontend ./scripts/setup-frontend.sh\n  2. Populate backend/ and library/ in each variant\n  3. Fill in .env.example files with the keys each service needs\n  4. Add docker-compose.yml at the repo root\n'
