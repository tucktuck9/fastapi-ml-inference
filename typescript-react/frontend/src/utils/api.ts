// ------------------------------------------ //
//             CONFIG & STATE                 //
// ------------------------------------------ //

import type { Movie, SavedMovie, SaveMoviePayload, ReviewsSummary, ReviewsPage } from '../types';

/**
 * Backend URL is replaced at build time by Vite from `VITE_BACKEND_URL`.
 * Falls back to localhost for `npm run dev` without a `.env` file.
 * See `.env.example` for the expected value in production.
 */
const BACKEND_URL: string = (
  import.meta.env.VITE_BACKEND_URL ||
  'http://localhost:8000'
).replace(/\/$/, '');

// ------------------------------------------ //
//             USER IDENTITY                  //
// ------------------------------------------ //

function _initUserId(): string {
  let id = localStorage.getItem('library_user_id');
  if (!id) {
    id = crypto.randomUUID?.() ??
         ('u-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('library_user_id', id);
  }
  return id;
}

const USER_ID: string = _initUserId();

// ------------------------------------------ //
//             MOVIE API                      //
// ------------------------------------------ //

/**
 * Search for a movie by title.
 * @param title - The movie title to search for.
 * @returns The movie details.
 */
export async function searchMovie(title: string): Promise<Movie> {
  const resp = await fetch(BACKEND_URL + '/movie?title=' + encodeURIComponent(title));
  const data = await resp.json() as Movie & { detail?: string };
  if (!resp.ok) throw new Error(data.detail ?? 'Unknown error');
  return data;
}

/**
 * Fetch the reviews summary for a movie.
 * @param tmdbId - The TMDB ID of the movie.
 * @param signal - Optional AbortSignal to cancel the request.
 * @returns The summary of reviews and overall emotions.
 */
export async function fetchReviewsSummary(tmdbId: number, signal?: AbortSignal): Promise<ReviewsSummary> {
  const resp = await fetch(`${BACKEND_URL}/movies/${tmdbId}/reviews/summary`, { signal });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json() as Promise<ReviewsSummary>;
}

/**
 * Fetch a specific page of reviews for a movie.
 * @param tmdbId - The TMDB ID of the movie.
 * @param page - The page number to fetch.
 * @param signal - Optional AbortSignal to cancel the request.
 * @returns The paginated reviews.
 */
export async function fetchReviewsPage(tmdbId: number, page: number, signal?: AbortSignal): Promise<ReviewsPage> {
  const resp = await fetch(`${BACKEND_URL}/movies/${tmdbId}/reviews?page=${page}`, { signal });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json() as Promise<ReviewsPage>;
}

// ------------------------------------------ //
//             LIBRARY API                    //
// ------------------------------------------ //

/**
 * Fetch the user's saved movies library.
 * @returns The list of saved movies.
 */
export async function fetchSavedMovies(): Promise<SavedMovie[]> {
  const resp = await fetch(BACKEND_URL + '/library/movies', {
    headers: { 'X-User-Id': USER_ID },
  });
  if (!resp.ok) return [];
  return resp.json() as Promise<SavedMovie[]>;
}

/**
 * Save a movie to the user's library.
 * @param payload - The movie data to save.
 * @returns The saved movie record.
 */
export async function saveMovie(payload: SaveMoviePayload): Promise<SavedMovie> {
  const resp = await fetch(BACKEND_URL + '/library/movies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': USER_ID },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? ('HTTP ' + resp.status));
  }
  return resp.json() as Promise<SavedMovie>;
}

/**
 * Delete a movie from the user's library.
 * @param tmdbId - The TMDB ID of the movie to delete.
 */
export async function deleteMovie(tmdbId: number): Promise<void> {
  const resp = await fetch(BACKEND_URL + '/library/movies/' + tmdbId, {
    method: 'DELETE',
    headers: { 'X-User-Id': USER_ID },
  });
  if (!resp.ok && resp.status !== 204) {
    const err = await resp.json().catch(() => ({})) as { detail?: string };
    throw new Error(err.detail ?? ('HTTP ' + resp.status));
  }
}

// ------------------------------------------ //
//             ADMIN API                      //
// ------------------------------------------ //

export interface ModelStatus {
  model_id?: string;
  loaded?: boolean;
  ready?: boolean;
  eager_load?: boolean;
  idle_unload_seconds?: number;
  last_used_at?: string;
  hf_home?: string;
}

/**
 * Fetch the current model status from the backend.
 * @returns The model status object, or null if unreachable.
 */
export async function fetchModelStatus(): Promise<ModelStatus | null> {
  try {
    const resp = await fetch(BACKEND_URL + '/admin/status');
    return resp.json() as Promise<ModelStatus>;
  } catch {
    return null;
  }
}

/**
 * Run a single emotion inference prediction.
 * @param text - The text to classify.
 * @returns The raw JSON prediction result and elapsed milliseconds.
 */
export async function runPredict(text: string): Promise<{ data: unknown; ms: number }> {
  const t0 = performance.now();
  const resp = await fetch(BACKEND_URL + '/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data: unknown = await resp.json();
  return { data, ms: Math.round(performance.now() - t0) };
}

/** Shape of a /predict response, narrowed to the timing fields used by burst analysis. */
interface PredictResponse {
  cache_hit?: boolean;
  latency_ms?: number;
  result?: { inference_ms?: number; [key: string]: unknown };
}

/** Timing record returned by runPredictTimed, used by the burst runner. */
export interface PredictTimed {
  wall_ms: number;
  server_ms: number;
  inference_ms: number;
  cache_hit: boolean;
  data: PredictResponse;
}

/**
 * Run a single /predict request and return a full timing record.
 * Used by the burst runner to compute percentile latency statistics.
 * @param text - The text to classify.
 */
export async function runPredictTimed(text: string): Promise<PredictTimed> {
  const t0 = performance.now();
  const resp = await fetch(BACKEND_URL + '/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await resp.json() as PredictResponse;
  const wall_ms = Math.round(performance.now() - t0);
  return {
    wall_ms,
    server_ms: data.latency_ms ?? 0,
    inference_ms: data.result?.inference_ms ?? 0,
    cache_hit: data.cache_hit ?? false,
    data,
  };
}

/**
 * Load the model into memory.
 * @returns The raw JSON response.
 */
export async function loadModel(): Promise<unknown> {
  const resp = await fetch(BACKEND_URL + '/admin/load', { method: 'POST' });
  return resp.json();
}

/**
 * Unload the model from memory.
 * @returns The raw JSON response.
 */
export async function unloadModel(): Promise<unknown> {
  const resp = await fetch(BACKEND_URL + '/admin/unload', { method: 'POST' });
  return resp.json();
}
