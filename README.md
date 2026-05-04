# FastAPI ML Inference

*Run any open-source text-classification model from Hugging Face as another service in Render, with sub-200 ms steady-state latency and a one-click deploy. A flat monthly instance bill instead of per-token metering, no GPU, and no separate ML platform just for the model.*

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/tucktuck9/fastapi-ml-inference)

## Live demo

- 🎭 [Movie Vibes UI](https://fastapi-ml-inference-frontend-3xhq.onrender.com/) 
- 📊 [Inference Benchmark UI](https://fastapi-ml-inference-frontend-3xhq.onrender.com/benchmark) 
- 🎬 [Movie Vibes API docs](https://fastapi-ml-inference-backend-namw.onrender.com/docs)

## What you'll build

A movie discovery app that scores the emotional tone of movie reviews using an open-source text-classification model. The stack is made up of:
- a public **frontend** web service with the "Movie Vibes" demo and inference benchmark UIs
- a public **backend** web service to run CPU emotion inference and serve /docs
- a 10 GB **persistent disk** to cache model weights across redeploys
- a private movie **library** service to manage movie watchlists
- a **key-value** store to cache movie review emotion predictions
- a **Postgres** database to store movie watchlists

> [!NOTE]
> Out-of-domain inputs can produce emotions that don't match a movie's actual tone. In production, fine-tune the model on your text corpus.

## Features

- ⚡ **Warm web service startup** — Eager model loading and model warmup pay PyTorch's first-inference overhead during startup, so the first user request lands warm.
- 💾 **Persistent model cache** — `HF_HOME=/model_cache` keeps model weights on a [persistent disk](https://render.com/docs/disks), so cold starts read "locally" instead of downloading.
- 🚦 **Model-aware readiness** — A [health check](https://render.com/docs/health-checks) pointed at `/ready` only passes after the model is loaded, preventing traffic from hitting cold-starting instances.
- 🧵 **CPU-safe concurrency** — An `asyncio` semaphore limits in-flight inference so burst traffic queues predictably instead of overloading CPUs.
- ⚙️ **Quantized CPU inference** — Dynamic INT8 quantization reduces RAM usage and CPU work per prediction, helping the model run on a smaller [web service](https://render.com/docs/web-services).
- 🗄️ **Inference cache** — Repeated predictions skip the model and return from the [key-value](https://render.com/docs/key-value) store in milliseconds.

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

4. **Optional:** Swap the default model for any other text-classification model on the [Hugging Face Hub](https://huggingface.co/models?pipeline_tag=text-classification):

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

> 🎉 **One click, one stack.** The Blueprint provisioned 5 services, a
> 10 GB persistent disk, managed Redis, and managed Postgres — wired
> by `fromService` and `fromDatabase`, no secrets copy-pasted. Future
> redeploys skip the model download entirely and reach the first
> prediction in ~1.6s.

### 3. Access your services

Your URLs appear in the Render Dashboard once the deploy is green:

1. 🎭 **Movie Vibes UI**: `https://<your-frontend-name>.onrender.com` 
   The main application: search movies, read reviews, and see ML emotion classification in action.

2. 📊 **Inference Benchmark UI**: `https://<your-frontend-name>.onrender.com/benchmark`  
   The performance dashboard: test raw inference latency, run burst load tests, and manage the model lifecycle.

3. 🎬 **Backend API Docs**: `https://<your-backend-name>.onrender.com/docs`  
   The interactive Swagger UI: explore the backend endpoints, test the `/predict` API directly, and view schemas.

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