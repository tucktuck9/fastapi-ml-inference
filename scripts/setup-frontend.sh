#!/usr/bin/env bash
#
# setup-frontend.sh
# Scaffolds Vite + React + TypeScript frontend with pinned dependencies.
#
# Usage: ./scripts/setup-frontend.sh
# Override package name: PROJECT_NAME=fastapi-ml-inference-frontend ./scripts/setup-frontend.sh
# Override target dir: TARGET_DIR=vue/frontend ./scripts/setup-frontend.sh
#
# Requirements: Node 24+, npm 11+, jq 1.7+

set -euo pipefail
[ "${DEBUG:-}" = "1" ] && set -x

# ---------- Configuration ----------

readonly TARGET_DIR="${TARGET_DIR:-typescript-react/frontend}"
readonly PARENT_DIR="$(dirname "$TARGET_DIR")"
readonly PROJECT_DIR="$(basename "$TARGET_DIR")"
readonly PACKAGE_NAME="${PROJECT_NAME:-frontend}"
readonly PACKAGE_VERSION="0.1.0"
readonly NODE_MIN="24.0.0"
readonly NPM_MIN="11.0.0"

readonly EXTRA_DEV_DEPS=(
  vitest
  jsdom
  @testing-library/react
  @testing-library/dom
  prettier
  @types/node
)

# ---------- Helpers ----------

log()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m \xe2\x9c\x93\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m xx\033[0m %s\n' "$*" >&2; exit 1; }

assert_no_caret_in_package_json() {
  local offenders
  offenders="$(
    jq -r '
      [(.dependencies // {}) + (.devDependencies // {}) + (.peerDependencies // {}) + (.optionalDependencies // {})]
      | .[] | to_entries[] | select(.value | test("^[\\^~]")) | .key + ": " + .value
    ' package.json
  )"
  if [ -n "$offenders" ]; then
    die "package.json contains caret/tilde versions:\n$offenders"
  fi
}

assert_no_caret_in_lockfile_root() {
  local offenders
  offenders="$(
    jq -r '
      [.packages[""].dependencies // {}, .packages[""].devDependencies // {}]
      | add // {} | to_entries[] | select(.value | test("^[\\^~]")) | .key + ": " + .value
    ' package-lock.json
  )"
  if [ -n "$offenders" ]; then
    die "package-lock.json root contains caret/tilde versions:\n$offenders"
  fi
}

# ---------- Preflight ----------

log "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm  >/dev/null 2>&1 || die "npm is not installed"
command -v jq   >/dev/null 2>&1 || die "jq is not installed"

NODE_VERSION="$(node --version | sed 's/^v//')"
if [ "$(printf '%s\n%s' "$NODE_MIN" "$NODE_VERSION" | sort -V | head -1)" != "$NODE_MIN" ]; then
  die "Node $NODE_MIN+ required; found $NODE_VERSION"
fi

NPM_VERSION="$(npm --version)"
if [ "$(printf '%s\n%s' "$NPM_MIN" "$NPM_VERSION" | sort -V | head -1)" != "$NPM_MIN" ]; then
  die "npm $NPM_MIN+ required; found $NPM_VERSION"
fi

if [ ! -d "$PARENT_DIR" ]; then
  die "$PARENT_DIR/ does not exist. Run from repo root."
fi

if [ -e "$TARGET_DIR/package.json" ]; then
  die "$TARGET_DIR/ already contains a project."
fi

ok "Node $NODE_VERSION, npm $NPM_VERSION, jq $(jq --version | sed 's/jq-//')"
ok "Target: ./$TARGET_DIR/"

# ---------- Step 1: Scaffold ----------

log "Scaffolding Vite template into $TARGET_DIR/"

STASH="$(mktemp -d)"
if [ -d "$TARGET_DIR" ]; then
  shopt -s dotglob nullglob
  for f in "$TARGET_DIR"/*; do
    name="$(basename "$f")"
    if [ "$name" = "src" ]; then
      rm -rf "$f"
      continue
    fi
    mv "$f" "$STASH/"
  done
  shopt -u dotglob nullglob
  rmdir "$TARGET_DIR"
fi

(cd "$PARENT_DIR" && npx --yes create-vite@latest "$PROJECT_DIR" --template react-ts --no-install --no-git < /dev/null)
cd "$TARGET_DIR"

shopt -s dotglob nullglob
for f in "$STASH"/*; do
  name="$(basename "$f")"
  mv -f "$f" "./$name"
done
shopt -u dotglob nullglob
rm -rf "$STASH"

rm -rf public
rm -f README.md
rm -rf src/assets

cat > src/App.tsx <<'EOF'
import './App.css';

function App() {
  return <h1>Replace me with your App.tsx</h1>;
}

export default App;
EOF

: > src/App.css

ok "Vite template scaffolded"

# ---------- Step 2: .npmrc ----------

log "Writing .npmrc"
cat > .npmrc <<'EOF'
save-exact=true
save-prefix=
engine-strict=true
EOF
ok ".npmrc written"

# ---------- Step 3: Pin dependencies ----------

log "Flattening carets/tildes"

cat > .scaffold-pin.cjs <<EOF
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  if (!pkg[section]) continue;
  for (const dep of Object.keys(pkg[section])) {
    pkg[section][dep] = pkg[section][dep].replace(/^[\^~]/, '');
  }
}
pkg.name = '${PACKAGE_NAME}';
pkg.version = '${PACKAGE_VERSION}';
pkg.private = true;
pkg.engines = pkg.engines || {};
pkg.engines.node = '>=${NODE_MIN}';
pkg.engines.npm = '>=${NPM_MIN}';
pkg.scripts = pkg.scripts || {};
pkg.scripts.test = 'vitest run';
pkg.scripts.format = 'prettier --write src';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
EOF

node .scaffold-pin.cjs
rm -f .scaffold-pin.cjs

assert_no_caret_in_package_json
ok "package.json exact pinned"

# ---------- Step 4: Resolve lockfile ----------

log "Re-resolving with exact pins"
rm -rf node_modules package-lock.json
npm install

assert_no_caret_in_lockfile_root
ok "package-lock.json root clean"

# ---------- Step 5: Dev dependencies ----------

log "Installing extra dev dependencies"
npm install -D "${EXTRA_DEV_DEPS[@]}"

assert_no_caret_in_package_json
assert_no_caret_in_lockfile_root
ok "Extra dev deps installed"

# ---------- Step 6: vitest config ----------

log "Writing vitest.config.ts"
cat > vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
EOF
ok "vitest.config.ts written"

# ---------- Step 7: Smoke check ----------

log "Running smoke check"
npx vite build >/dev/null
ok "vite build succeeded"
rm -rf dist

npx vitest run --passWithNoTests >/dev/null 2>&1 && ok "vitest dry-run succeeded" || warn "vitest issues found"

# ---------- Summary ----------

printf '\n\033[1;32mScaffold complete.\033[0m\n\nNext manual steps:\n  1. cd %s/\n  2. Copy migrated source over scaffolded src/\n  3. Replace index.html\n  4. Fill in .env.example\n  5. Add README.md\n  6. Recreate public/\n  7. git add . && git status\n' "$TARGET_DIR"
