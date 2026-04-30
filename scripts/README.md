# Scripts

Repository configuration and scaffolding scripts. These establish reproducible environments with exact-pinned dependencies across variants.

## Requirements

- Node 24+
- npm 11+
- jq 1.7+

## Motivation

- **Reproducibility:** Machine learning dependencies are sensitive to drift. A silent minor-version bump in `transformers`, `torch`, or `numpy` can break compatibility or change model outputs. These scripts enforce exact version pinning to prevent silent failures across environments.
- **Structural Consistency:** Each project variant (`vanilla-js`, `typescript-react`) shares an identical directory layout, ensuring Docker configurations and deployment steps remain standardized.
- **Container Optimization:** Bootstraps `.dockerignore` files to keep the build context small. In ML projects, stray model weights, notebooks, or virtual environments can easily balloon container images from megabytes to gigabytes.
- **Idempotency:** Scaffold operations are safe to run repeatedly. Existing files are preserved rather than overwritten.

## Usage

### 1. Initialize Project Skeleton

Creates the dual-variant structure (`vanilla-js/`, `typescript-react/`) with isolated `backend/`, `library/`, and `frontend/` service directories. Populates initial `.dockerignore` and `.env.example` files based on the service runtime.

```bash
./scripts/setup-project.sh
```

### 2. Scaffold React Frontend

Bootstraps a Vite + React + TypeScript application into `typescript-react/frontend/` with locked dependencies. 

```bash
PROJECT_NAME=fastapi-ml-inference-frontend ./scripts/setup-frontend.sh
```
