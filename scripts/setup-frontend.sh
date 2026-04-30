#!/usr/bin/env bash
#
# scaffold-frontend.sh
# --------------------
# One-time scaffold for a Vite + React + TypeScript frontend with every
# direct dependency pinned to an exact version. Run this once, commit
# the resulting frontend/ directory. Contributors never run this script —
# they run `docker-compose up` (or `npm ci && npm run dev`).
#
# Designed to be reusable across projects. Override the project name with
# the PROJECT_NAME env var; everything else is generic Vite + React + TS.
#
# Usage:
#     # From the repo root (default — scaffolds into typescript-react/frontend/):
#     ./scripts/scaffold-frontend.sh
#
#     # With a custom package name (defaults to "frontend"):
#     PROJECT_NAME=fastapi-ml-inference-frontend ./scripts/scaffold-frontend.sh
#
#     # With a custom target directory (defaults to typescript-react/frontend):
#     TARGET_DIR=vue/frontend ./scripts/scaffold-frontend.sh
#
#     # With debug tracing:
#     DEBUG=1 ./scripts/scaffold-frontend.sh
#
# Requirements:
#   - Node 24+ (current LTS as of April 2026; v20 reached EOL on 2026-04-30)
#   - npm 11+
#   - jq 1.7+ (1.8.1 recommended)
#
# Composes with: setup-project.sh (creates the variant dirs first), and
# dev-setup.sh (runs on every fresh clone to wire .env files + npm ci).

set -euo pipefail
[ "${DEBUG:-}" = "1" ] && set -x

# ---------- Configuration ----------

# Where the Vite scaffold gets created, relative to the repo root.
# Default is typescript-react/frontend/ to match the project's variant layout.
# Override with TARGET_DIR=... when adding a new variant (vue/, htmx/, etc.).
readonly TARGET_DIR="${TARGET_DIR:-typescript-react/frontend}"
readonly PARENT_DIR="$(dirname "$TARGET_DIR")"
readonly PROJECT_DIR="$(basename "$TARGET_DIR")"
readonly PACKAGE_NAME="${PROJECT_NAME:-frontend}"
readonly PACKAGE_VERSION="0.1.0"
readonly NODE_MIN="24.0.0"   # Current Node LTS (Krypton). v20 reached EOL 2026-04-30.
readonly NPM_MIN="11.0.0"    # npm 11.x is bundled with Node 24 LTS.

# Project-specific dev dependencies (added on top of the Vite template defaults).
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

# Assert no caret/tilde version ranges remain in the top-level deps of
# package.json. Reads from current directory.
assert_no_caret_in_package_json() {
  local offenders
  offenders="$(
    jq -r '
      [(.dependencies // {}) + (.devDependencies // {}) + (.peerDependencies // {}) + (.optionalDependencies // {})]
      | .[] | to_entries[] | select(.value | test("^[\\^~]")) | .key + ": " + .value
    ' package.json
  )"
  if [ -n "$offenders" ]; then
    die "package.json still contains caret/tilde versions:\n$offenders"
  fi
}

# Assert no caret/tilde version ranges remain in the *top-level project*
# dependency declarations of package-lock.json. (Transitive packages may
# legitimately have carets — those are dependency metadata, not floating
# resolution.)
assert_no_caret_in_lockfile_root() {
  local offenders
  offenders="$(
    jq -r '
      [.packages[""].dependencies // {}, .packages[""].devDependencies // {}]
      | add // {} | to_entries[] | select(.value | test("^[\\^~]")) | .key + ": " + .value
    ' package-lock.json
  )"
  if [ -n "$offenders" ]; then
    die "package-lock.json root still contains caret/tilde versions:\n$offenders"
  fi
}

# ---------- Preflight ----------

log "Checking prerequisites"

command -v node >/dev/null 2>&1 || die "node is not installed"
command -v npm  >/dev/null 2>&1 || die "npm is not installed"
command -v jq   >/dev/null 2>&1 || die "jq is not installed (used for verification)"

NODE_VERSION="$(node --version | sed 's/^v//')"
if [ "$(printf '%s\n%s' "$NODE_MIN" "$NODE_VERSION" | sort -V | head -1)" != "$NODE_MIN" ]; then
  die "Node $NODE_MIN+ required; found $NODE_VERSION (Node 20 reached EOL 2026-04-30; please upgrade to v24 LTS)"
fi

NPM_VERSION="$(npm --version)"
if [ "$(printf '%s\n%s' "$NPM_MIN" "$NPM_VERSION" | sort -V | head -1)" != "$NPM_MIN" ]; then
  die "npm $NPM_MIN+ required; found $NPM_VERSION (run: npm install -g npm@latest)"
fi

# Refuse to run from inside the typescript-react variant — must be repo root.
# Detected by absence of the parent directory we'd be scaffolding into.
if [ ! -d "$PARENT_DIR" ]; then
  die "$PARENT_DIR/ does not exist. Run from the repo root, after ./scripts/setup-project.sh has created the variant directories."
fi

# The target frontend/ must not already contain a project (idempotency-by-refusal:
# we don't try to merge into an existing scaffold; user deletes it explicitly).
if [ -e "$TARGET_DIR/package.json" ]; then
  die "$TARGET_DIR/ already contains a scaffolded project (package.json present). Delete it first if you want to re-scaffold."
fi

ok "Node $NODE_VERSION, npm $NPM_VERSION, jq $(jq --version | sed 's/jq-//')"
ok "Will scaffold into ./$TARGET_DIR/"

# ---------- Step 1: Scaffold ----------

log "Step 1/7: Scaffolding Vite + React + TypeScript template into $TARGET_DIR/"

# `npm create vite@latest` refuses to scaffold into a non-empty directory, but
# setup-project.sh leaves a few files in place: .dockerignore, .env.example,
# and an empty src/ for cross-service consistency. Stash those, scaffold,
# then restore — except for src/, which Vite populates with App.tsx etc.
# Restoring an empty src/ over Vite's would delete the scaffold output.
STASH="$(mktemp -d)"
if [ -d "$TARGET_DIR" ]; then
  shopt -s dotglob nullglob
  for f in "$TARGET_DIR"/*; do
    name="$(basename "$f")"
    # Skip src/ — Vite owns this directory in the typescript-react variant.
    # The empty src/ from setup-project.sh is just a placeholder.
    if [ "$name" = "src" ]; then
      rm -rf "$f"
      continue
    fi
    mv "$f" "$STASH/"
  done
  shopt -u dotglob nullglob
  rmdir "$TARGET_DIR"
fi

# Call `create-vite` directly via `npx` instead of `npm create vite@latest`.
#
# Why: recent create-vite versions added an interactive prompt — "Install with
# npm and start now?" — that defaults to Yes and starts the dev server, which
# blocks the script forever. The documented escape hatches `--no-install` and
# `--no-git` are passed through reliably by `npx` but are silently dropped by
# `npm create` on npm 11+ (the `--` separator stops being honored consistently).
# Calling `npx create-vite` puts us in direct control of argv.
#
# Belt-and-suspenders: redirect stdin from /dev/null so that even if a future
# version adds a new prompt that ignores both flags, it sees EOF instead of
# hanging on a TTY read. The default answer for create-vite prompts is the safe
# one (don't install, don't start server) when stdin is closed.
(cd "$PARENT_DIR" && npx --yes create-vite@latest "$PROJECT_DIR" --template react-ts --no-install --no-git < /dev/null)
cd "$TARGET_DIR"

# Restore stashed files (e.g., .dockerignore, .env.example from setup-project).
# If a template file collides with a stashed file, the stashed one wins —
# setup-project is the source of truth for service-level config.
shopt -s dotglob nullglob
for f in "$STASH"/*; do
  name="$(basename "$f")"
  mv -f "$f" "./$name"
done
shopt -u dotglob nullglob
rm -rf "$STASH"

# Remove template-supplied boilerplate the project doesn't use:
#   - public/        (no favicons yet; index.html will own its own asset refs)
#   - README.md      (Vite boilerplate; project ships its own README)
#   - src/assets/    (hero.png, react.svg, vite.svg — project supplies its own)
rm -rf public
rm -f README.md
rm -rf src/assets

# Replace App.tsx and App.css with minimal placeholders. The stock App.tsx
# imports the assets we just deleted, so leaving it would break Step 7's
# `vite build` smoke check. Users overwrite App.tsx with their migrated
# source in the manual step that follows; App.css is theirs to populate.
cat > src/App.tsx <<'EOF'
import './App.css';

function App() {
  return <h1>Replace me with your App.tsx</h1>;
}

export default App;
EOF

: > src/App.css

ok "Vite template scaffolded into $PROJECT_DIR/ (public/, README.md, src/assets/ removed; App.tsx + App.css reset to placeholders)"

# ---------- Step 2: .npmrc ----------

log "Step 2/7: Writing .npmrc to enforce exact pins on future installs"
cat > .npmrc <<'EOF'
# Pin every direct dependency to an exact version on install.
save-exact=true
save-prefix=
engine-strict=true
EOF
ok ".npmrc written"

# ---------- Step 3: Flatten existing carets/tildes ----------

log "Step 3/7: Flattening carets/tildes from template-supplied versions"

# Use a separate Node script file rather than -e to avoid shell-quoting issues.
# The script is deleted at the end of the step.
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

# Verify package.json is clean before we proceed.
assert_no_caret_in_package_json
ok "package.json flattened (no caret/tilde ranges in top-level deps)"

# ---------- Step 4: Clean re-resolve ----------

log "Step 4/7: Wiping node_modules + package-lock.json and re-resolving with exact pins"
rm -rf node_modules package-lock.json
npm install

# Verify the lockfile root has no carets either.
assert_no_caret_in_lockfile_root
ok "package-lock.json root is clean (transitive ^ ranges in nested packages are expected and fine)"

# ---------- Step 5: Add project-specific dev deps ----------

log "Step 5/7: Installing project-specific dev dependencies"
npm install -D "${EXTRA_DEV_DEPS[@]}"

# Verify again — npm install -D is the most likely place for caret regression
# if .npmrc is somehow not honored.
assert_no_caret_in_package_json
assert_no_caret_in_lockfile_root
ok "Extra dev deps installed and pinned exactly"

# ---------- Step 6: vitest config ----------

log "Step 6/7: Writing vitest.config.ts (jsdom env, explicit imports)"
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

log "Step 7/7: Smoke check (vite build on bare scaffold)"
# The Vite template ships with a working App.tsx, so vite build should succeed
# even before your migrated source is copied in. If this fails, something is
# genuinely wrong with the install.
npx vite build >/dev/null
ok "vite build succeeded"
rm -rf dist

# Vitest will report 'no test files found' on a bare scaffold; that's expected.
npx vitest run --passWithNoTests >/dev/null 2>&1 && ok "vitest dry-run succeeded" || warn "vitest reported issues"

# ---------- Cleanup ----------

# node_modules is gitignored, so no need to delete it.
# Keeping it in place means the editor has type resolution immediately after
# running this script (no manual `npm ci` required, no red squiggly lines).

# ---------- Summary ----------

# Use `printf` (not `cat <<EOF`) so the ANSI escape \033 is interpreted as
# a real ESC byte. `cat` would print the literal characters \033[1;32m.
printf '\n\033[1;32mScaffold complete.\033[0m\n\nNext manual steps:\n  1. cd %s/\n  2. Copy your migrated source over the scaffolded src/ (App.tsx, etc.)\n  3. Replace index.html with your version\n  4. Fill in .env.example with the keys your frontend needs (e.g., VITE_BACKEND_URL)\n  5. Add README.md\n  6. (Optional) Recreate public/ when you have real favicons + og-image\n  7. git add . && git status\n\nContributors run: docker-compose up   (or:  npm ci && npm run dev)\n' "$TARGET_DIR"