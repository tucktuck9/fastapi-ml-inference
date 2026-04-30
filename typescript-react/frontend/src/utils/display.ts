// ------------------------------------------ //
//             DISPLAY HELPERS                //
// ------------------------------------------ //

import type { Emotion, Movie, SavedMovie } from '../types';

const EMOTION_EMOJI: Record<string, string> = {
  joy: '😄', love: '❤️', optimism: '🌅', anticipation: '🤩',
  surprise: '😮', trust: '🤝',
  anger: '😠', disgust: '🤢', fear: '😨', sadness: '😢', pessimism: '😟',
  amusement: '😂', excitement: '🔥', confusion: '🤔', curiosity: '🧐',
  realization: '💡', neutral: '😐',
};

/**
 * Get the corresponding emoji for an emotion label.
 * @param label - The emotion label.
 * @returns The corresponding emoji, or a fallback.
 */
export function emojiFor(label: string | undefined): string {
  if (!label) return '🎭';
  return EMOTION_EMOJI[label.toLowerCase()] ?? '🎭';
}

/**
 * Format runtime in minutes to hours and minutes.
 * @param min - Runtime in minutes.
 * @returns Formatted runtime string.
 */
export function formatRuntime(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h ? h + 'h ' : ''}${m}m`;
}

/**
 * Build an array of meta parts (year, runtime, genre) for display.
 * @param movie - The movie object.
 * @returns An array of formatted meta strings.
 */
export function buildMetaParts(movie: Movie | SavedMovie): string[] {
  const parts: string[] = [];
  if (movie.year) parts.push(String(movie.year));
  if (movie.runtime_min) parts.push(formatRuntime(movie.runtime_min));
  const genres = movie.genres;
  if (genres?.[0]) parts.push(genres[0]);
  return parts;
}

/**
 * Parse a TMDB rating string into score and votes.
 * @param str - The TMDB rating string, e.g. "7.5/10 (2300)".
 * @returns The parsed score and votes, or null if unparseable.
 */
export function parseTmdbRating(str: string | null | undefined): { score: string; votes: string | null } | null {
  const m = String(str ?? '').match(/^([\d.]+)\/10(?:\s*\((.+)\))?/);
  return m ? { score: m[1], votes: m[2] ?? null } : null;
}

/**
 * Get the top N emotions from a ranked list.
 * @param arr - The ranked list of emotions.
 * @param n - The number of top emotions to return.
 * @returns The top N emotions sorted by score descending.
 */
export function topEmotions(arr: Emotion[] | null | undefined, n = 3): Emotion[] {
  return (arr ?? []).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, n);
}
