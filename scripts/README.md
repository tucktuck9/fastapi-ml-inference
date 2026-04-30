# Scripts

One-time setup scripts for scaffolding the repo. Contributors don't run these — they run `docker-compose up`. These are for the project owner (or anyone adding a new variant) to bootstrap the directory tree and the React frontend with reproducible, exact-pinned dependencies.

## Requirements

- Node 24+ (current LTS; v20 reached EOL 2026-04-30)
- npm 11+
- jq 1.7+

## Why these exist

- **Reproducibility.** ML projects are sensitive to dependency drift — a silent minor-version bump in a tokenizer or numerical library can change model outputs. These scripts pin every direct dependency to an exact version.
- **Consistent structure.** Every service gets the same layout and the same set of files, so Docker commands, contributor, and developer onboarding work identically across variants.
- **Idempotency.** Running a script twice is safe — existing files are skipped, not overwritten.

## Project structure

Each service directory (`backend/`, `library/`, `frontend/`) gets:

- `src/` — Docker's `COPY src/ ./src/` works the same across all services.
- `.env.example` — documents which variables the service expects, without leaking secrets.
- `.dockerignore` — keeps the build context small. In ML projects this matters: model weights, `__pycache__/`, `.venv/`, `node_modules/`, and stray notebooks can balloon an image from MBs to GBs. The scaffolder writes a Python-flavored `.dockerignore` for `backend/` and `library/`, and a Node-flavored one for `frontend/`.

## Setup

### 1. Create project scaffolding

Creates the variant tree (`vanilla-js/`, `typescript-react/`) and the service skeletons inside each (`backend/`, `library/`, `frontend/`). Drops `.env.example` and `.dockerignore` files appropriate to each service's runtime (Python or Node).

From the project root, run the setup script:

```bash
./scripts/setup-project.sh
```

### 2. Create React scaffolding

Scaffold the Vite + React + TypeScript frontend into `typescript-react/frontend/` with every direct dependency pinned to an exact version. Adds project-specific dev deps (Vitest, Testing Library, Prettier) and runs a `vite build` smoke check before exiting.

From the project root, run the setup script:

```bash
# PROJECT_NAME sets the package name in package.json
PROJECT_NAME=fastapi-ml-inference-frontend ./scripts/setup-frontend.sh
```