# fastapi-ml-inference

*Run any open-source text-classification model from Hugging Face as another service in Render, with sub-200 ms steady-state latency and a one-click deploy. A flat monthly instance bill instead of per-token metering, no GPU, and no separate ML platform just for the model.*

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tucktuck9/fastapi-ml-inference)

## Live demo

- 🎭 [Movie Vibes UI](https://render-ml-inference-frontend.onrender.com) 
- 📊 [Inference Benchmark UI](https://render-ml-inference-frontend.onrender.com/benchmark) 
- 🎬 [Movie Vibes API docs](https://render-ml-inference-backend.onrender.com/docs)

## What you'll build

A movie discovery app powered by an open-source emotion model. The stack is made up of:
- a public **backend** web service that loads the emotion model into memory
- a 10 GB **persistent disk** so model weights survive redeploys without re-downloading
- a public **frontend** web service that serves the "Movie Vibes" and inference benchmarking UIs
- a **private movie library** service that owns all database access
- a managed **Redis** instance that caches emotion scores
- a managed **Postgres** database instance 

> [!NOTE]
> Out-of-domain inputs occasionally surface emotions that don't match a movie's actual tone. In production, you'd fine-tune the model on your text corpus.

## Features

- ⚡ **Quantized CPU inference** — INT8 dynamic quantization roughly halves RAM with negligible accuracy loss, fitting the model on a Pro plan without a GPU.
- 💾 **Persistent model cache** — a Render [Persistent Disk](https://render.com/docs/disks) mounted at `/model_cache` (with `HF_HOME` set to that path) caches the model weights so they survive redeploys. The model downloads from Hugging Face once on first deploy; every redeploy after that loads it straight from disk and reaches the first prediction in ~1.6s.
- 🔒 **Private service pattern** — a Render [Private Service](https://render.com/docs/private-services) (`type: pserv`) gives the library service no public URL — all database traffic stays inside Render's private network.
- 🚦 **Model-ready traffic gating** — a Render [health check](https://render.com/docs/health-checks) path (`/ready`) blocks traffic until the model is fully loaded into memory.
- 🗄️ **Redis emotion cache** — emotion scores are cached in a managed [Key Value](https://render.com/docs/key-value) instance keyed by `review_id` with a 7-day TTL. Cache hits skip the forward pass entirely. Redis is optional: if `REDIS_URL` is unset, inference runs uncached and the app is otherwise unchanged.
- 🔗 **Infrastructure as Code** — Render's [Blueprint spec](https://render.com/docs/blueprint-spec) `fromService`, `fromDatabase`, and the new Redis `connectionString` inject every inter-service URL at deploy time, so no secrets are copy-pasted between dashboards.

## Project structure

This project ships two interchangeable frontends — pick one and use it throughout. Backend (API), Library, Redis, and Postgres are identical across both; only the frontend differs.

```
    fastapi-ml-inference/
    ├── vanilla-js/         # vanilla HTML + JS frontend (served by FastAPI)
    │   ├── backend/
    │   ├── library/
    │   ├── frontend/
    │   └── render.yaml
    ├── typescript-react/   # Vite + TypeScript-React frontend
    │   ├── backend/
    │   ├── library/
    │   ├── frontend/
    │   └── render.yaml
    └── scripts/
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            FRONTEND                                 │
│                  Search · Watchlist · Analyze                       │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       BACKEND (FastAPI)                             │
│              BFF · TMDB proxy · Inference orchestrator              │
│                                                                     │
│              ┌─────────────────────────────────┐                    │
│              │  Emotion model                  │                    │
│              │  PyTorch · in-process           │                    │
│              └─────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────┘
        │           │           │           │           │
        ▼           ▼           ▼           ▼           ▼
┌────────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ Persistent │ │  Redis  │ │Library  │ │  TMDB   │ │  HF Hub │
│    disk    │ │  cache  │ │ (pserv) │ │ext. API │ │(1st run)│
│ HF weights │ │emotions │ │FastAPI  │ │         │ │         │
└────────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
                                │
                                ▼
                      ┌──────────────────┐
                      │  Postgres (RDB)  │
                      │   user_movies    │
                      └──────────────────┘
```

## Before you begin

Complete the following tasks before you get started. Both [The Movie Database (TMDB)](https://www.themoviedb.org/about) API key and the [Hugging Face](https://huggingface.co/) token are free.

- [Create a Render account](https://dashboard.render.com/register)
- [Get a TMDB API key](https://www.themoviedb.org/settings/api)
- [Get a Hugging Face token](https://huggingface.co/settings/tokens) (read-only)

## Quickstart

The fastest local path is Docker Compose, which mirrors the multi-service Render topology on your local machine.

1. Clone the repo.

   ```bash
   git clone https://github.com/tucktuck9/fastapi-ml-inference.git
   cd fastapi-ml-inference
   ```

2. Generate per-service `.env` files from the examples.

   ```bash
   ./setup.sh
   ```

3. Open the `.env` file at the project root and add your API keys:

   ```bash
   # Required — https://www.themoviedb.org/settings/api
   TMDB_API_KEY=your_tmdb_api_key_here

   # Recommended — anonymous downloads are rate-limited without this
   # Required if you swap MODEL_ID for a gated model
   # https://huggingface.co/settings/tokens
   HF_TOKEN=your_readonly_hf_token_here
   ```

4. **Optional:** Swap the default model for any other text-classification model on the [Hugging Face Hub](https://huggingface.co/spaces?sort=likes&search=text+classification):

   ```bash
   MODEL_ID=the-hf-org/the-model
   MODEL_REVISION=commit-sha-for-reproducibility
   ```

5. Start every service. Pick a frontend variant — Backend (API), Library, Redis, and Postgres are identical across both.

    ```bash
    # Run TypeScript + React frontend
    docker-compose -f typescript-react/docker-compose.yml up --build

    # Run Vanilla JS + HTML frontend
    docker-compose -f vanilla-js/docker-compose.yml up --build
    ```

This starts:
- The **PostgreSQL 16** service on port `5432`
- The **Redis 7** service (private — no host port; reachable at `redis://redis:6379` over the Docker network)
- The movie **Library** service (private — no host port; reachable from the API at `http://library:8001` over the Docker network)
- The **Backend** (API) service on port `8000` (with Redis caching enabled automatically)
- The **Frontend** service on port `3000`

Visit [http://localhost:3000](http://localhost:3000) to run emotion inference against the open-source model, or [http://localhost:3000/benchmark](http://localhost:3000/benchmark) to measure inference latency.

## Deploy

### 1. (Optional) Use a different model

To use a different text-classification model on Hugging Face, set the following values in the [`typescript-react/render.yaml`](./typescript-react/render.yaml) or [`vanilla-js/render.yaml`](./vanilla-js/render.yaml) for the backend service (`fastapi-ml-inference-backend`):

```yaml
envVars:
- key: MODEL_ID
  value: your-org/your-model
- key: MODEL_REVISION
  value: 123456EXAMPLE
```

### 2. Deploy to Render

Add your nearest [`region`](https://render.com/docs/regions) to the [`typescript-react/render.yaml`](./typescript-react/render.yaml) or [`vanilla-js/render.yaml`](./vanilla-js/render.yaml). Click the **Deploy to Render** button at the top of this page. You'll need to:

1. Enter a blueprint name
2. For **Blueprint Path**, enter either `vanilla-js/render.yaml` or `typescript-react/render.yaml`
3. Enter your `TMDB_API_KEY` and `HF_TOKEN`
4. Click **Deploy Blueprint**
5. Wait for all services to deploy: Redis, Postgres, Library, Backend (API), and Frontend

### 3. Access your services

Your URLs appear in the Render Dashboard once the deploy is green:

- 🎭 **Movie Vibes UI**: `https://<your-frontend-name>.onrender.com`
- 📊 **Inference Benchmark UI**: `https://<your-frontend-name>.onrender.com/benchmark`
- 🎬 **Movie Vibes API docs**: `https://<your-backend-name>.onrender.com/docs`

> 🎉 **One click, one stack.** The Blueprint provisioned 5 services, a
> 10 GB persistent disk, managed Redis, and managed Postgres — wired
> by `fromService` and `fromDatabase`, no secrets copy-pasted. Future
> redeploys skip the model download entirely and reach the first
> prediction in ~1.6s.

## Usage

All requests go to the **API** service (`http://localhost:8000` locally, your `*.onrender.com` URL in production).

### Interactive API docs

Once the stack is running, the API is fully documented and explorable in your browser:

| | Local | Render |
|---|---|---|
| **Swagger UI** | [localhost:8000/docs](http://localhost:8000/docs) | `https://<your-api>.onrender.com/docs` |
| **ReDoc** | [localhost:8000/redoc](http://localhost:8000/redoc) | `https://<your-api>.onrender.com/redoc` |
| **OpenAPI JSON** | [localhost:8000/openapi.json](http://localhost:8000/openapi.json) | `https://<your-api>.onrender.com/openapi.json` |

The schema covers all endpoints with full request and response shapes. Use Swagger UI to try APIs from your browser.