/**
 * types.ts — shared domain types used across the frontend.
 *
 * Keep these aligned with the backend's Pydantic schemas.
 */

// ------------------------------------------ //
//             NAVIGATION                     //
// ------------------------------------------ //

export type View = 'search' | 'library' | 'reviews' | 'benchmark';

// ------------------------------------------ //
//             DOMAIN MODELS                  //
// ------------------------------------------ //

export interface Emotion {
  label: string;
  score: number;
}

export interface Review {
  id?: string;
  author?: string;
  rating?: number | null;
  content?: string;
  emotions?: Emotion[];
}

/** Movie returned by the backend /movie search endpoint. */
export interface Movie {
  tmdb_id: number;
  title: string;
  year?: string | number;
  runtime_min?: number;
  poster?: string;
  tagline?: string;
  overview?: string;
  genres?: string[];
  ratings?: { tmdb?: string };
}

/** Movie record stored in the library (different shape from Movie). */
export interface SavedMovie {
  tmdb_id: number;
  title: string;
  year?: string | number | null;
  runtime_min?: number | null;
  poster_url?: string | null;
  tagline?: string | null;
  overview?: string | null;
  genres?: string[] | null;
  tmdb_rating?: string | null;
  emotions?: Emotion[];
}

/** Payload sent to POST /library/movies. */
export interface SaveMoviePayload {
  tmdb_id: number;
  title: string;
  year?: string | number | null;
  runtime_min?: number | null;
  poster_url?: string | null;
  tagline?: string | null;
  overview?: string | null;
  genres?: string[] | null;
  tmdb_rating?: string | null;
  emotions?: Emotion[];
}

// ------------------------------------------ //
//             API RESPONSE SHAPES            //
// ------------------------------------------ //

/** Response from GET /movies/:id/reviews/summary */
export interface ReviewsSummary {
  reviews?: Review[];
  overall?: Emotion[];
  total_results?: number;
  has_more?: boolean;
  inference_ms?: number;
  error?: string;
}

/** Response from GET /movies/:id/reviews?page=N */
export interface ReviewsPage {
  reviews: Review[];
  page: number;
  total_results: number;
  has_more: boolean;
}
