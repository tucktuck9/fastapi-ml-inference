import { useState, useEffect, useCallback, useRef } from 'react';
import type { JSX } from 'react';
import { searchMovie, fetchReviewsSummary } from '../utils/api';
import { errorMessage } from '../utils/errors';
import { buildMetaParts, parseTmdbRating } from '../utils/display';
import EmotionPill from '../components/EmotionPill';
import ReviewCard from '../components/ReviewCard';
import ReviewSkeleton from '../components/ReviewSkeleton';
import type { Movie, SavedMovie, Emotion, ReviewsSummary } from '../types';

// ------------------------------------------ //
//             SEARCH VIEW COMPONENT          //
// ------------------------------------------ //

interface SearchViewProps {
  pendingSearch: { query: string; id: number } | null;
  currentMovie: Movie | null;
  savedMovies: SavedMovie[];
  onMovieLoad: (movie: Movie | null) => void;
  onSave: (movie: Movie, emotions: Emotion[]) => Promise<void>;
  onRemove: (tmdbId: number) => Promise<void>;
  onOpenAllReviews: (movie: Movie) => void;
  onNavigateLibrary: () => void;
  showToast: (message: string) => void;
}

/**
 * Search view component.
 *
 * Flow:
 * 1. Listens for pending search updates.
 * 2. Fetches movie details and reviews summary.
 * 3. Renders movie details and review cards.
 */
export default function SearchView({
  pendingSearch,
  currentMovie,
  savedMovies,
  onMovieLoad,
  onSave,
  onRemove,
  onOpenAllReviews,
  onNavigateLibrary,
  showToast,
}: SearchViewProps): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reviewsData, setReviewsData] = useState<ReviewsSummary | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [reviewerOverall, setReviewerOverall] = useState<Emotion[]>([]);
  const [saveInFlight, setSaveInFlight] = useState(false);
  const reviewsAbortRef = useRef<AbortController | null>(null);

  const isSaved = savedMovies.some(m => m.tmdb_id === currentMovie?.tmdb_id);

  /**
   * Load the reviews summary for a movie.
   * @param tmdbId - The TMDB ID of the movie.
   */
  const loadReviewsSummary = useCallback(async (tmdbId: number, signal: AbortSignal): Promise<void> => {
    setReviewsLoading(true);
    try {
      const data = await fetchReviewsSummary(tmdbId, signal);
      setReviewsData(data);
      setReviewerOverall(data.overall ?? []);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setReviewsData({ error: errorMessage(e) });
    } finally {
      setReviewsLoading(false);
    }
  }, []);

  /**
   * Perform a movie search.
   * @param query - The search query.
   */
  const performSearch = useCallback(async (query: string): Promise<void> => {
    reviewsAbortRef.current?.abort();
    const ctrl = new AbortController();
    reviewsAbortRef.current = ctrl;

    setLoading(true);
    setError('');
    setReviewsData(null);
    setReviewerOverall([]);
    onMovieLoad(null);

    try {
      const data = await searchMovie(query);
      onMovieLoad(data);
      if (data.tmdb_id) void loadReviewsSummary(data.tmdb_id, ctrl.signal);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [onMovieLoad, loadReviewsSummary]);

  useEffect(() => {
    if (!pendingSearch) return;
    void performSearch(pendingSearch.query);
  }, [pendingSearch, performSearch]);

  /** Handle saving the current movie to the watchlist. */
  async function handleSave(): Promise<void> {
    if (!currentMovie) return;
    setSaveInFlight(true);
    try {
      await onSave(currentMovie, reviewerOverall);
    } catch (e) {
      showToast('Save failed: ' + errorMessage(e));
    } finally {
      setSaveInFlight(false);
    }
  }

  /** Handle removing the current movie from the watchlist. */
  async function handleRemoveCurrent(): Promise<void> {
    if (!currentMovie) return;
    setSaveInFlight(true);
    try {
      await onRemove(currentMovie.tmdb_id);
      showToast('Removed from Watchlist');
    } catch (e) {
      showToast('Remove failed: ' + errorMessage(e));
    } finally {
      setSaveInFlight(false);
    }
  }

  const parsed = currentMovie ? parseTmdbRating(currentMovie.ratings?.tmdb) : null;
  const rating = parsed ? { score: parsed.score, denom: parsed.votes ? `/10 · ${parsed.votes}` : '/10' } : null;
  const metaParts = currentMovie ? buildMetaParts(currentMovie) : [];
  const showEmpty = !loading && !error && !currentMovie;

  return (
    <main className="view" data-theme="dark">
      <div className="container">

        {loading && (
          <div className="loading">Fetching movie and running inference…</div>
        )}
        {error && <div className="error">{error}</div>}

        {showEmpty && (
          <div className="loading search-empty-msg">
            <div className="search-empty-icon">🎬</div>
            <div>Search for a movie to see how reviewers felt about it.</div>
            <div className="search-empty-hint">
              Try: <em>Inception</em>, <em>Parasite</em>, <em>Hereditary</em>…
            </div>
          </div>
        )}

        {currentMovie && (
          <>
            <div className="detail-header">
              <h1 className="detail-title">
                {currentMovie.title}{currentMovie.year ? ` (${currentMovie.year})` : ''}
              </h1>
              <div className="detail-meta">
                {metaParts.map((part, i) => (
                  <span key={`${part}-${i}`}>
                    {i > 0 && <span className="dot">·</span>}
                    {part}
                  </span>
                ))}
              </div>
            </div>

            <div className="hero">
              <div className="hero-poster">
                <img src={currentMovie.poster ?? ''} alt="Movie poster" loading="lazy" />
              </div>
              <div
                className="hero-backdrop"
                style={{ backgroundImage: currentMovie.poster ? `url(${currentMovie.poster})` : 'none' }}
              >
                <div className="hero-content">
                  <div className="hero-tagline">{currentMovie.tagline ?? ''}</div>
                </div>
              </div>
            </div>

            <div className="chip-row">
              {(currentMovie.genres ?? []).map(g => (
                <span key={g} className="chip">
                  {g}<span className="chip-arrow">›</span>
                </span>
              ))}
            </div>

            {rating && (
            <div className="rating-block-wrap">
              <span className="rating-block">
                <span className="star">★</span>
                <span className="score">{rating.score}</span>
                <span className="denom">{rating.denom}</span>
              </span>
            </div>
            )}

            <div className="plot-card">
              <div className="mini-poster">
                <img src={currentMovie.poster ?? ''} alt="" loading="lazy" />
              </div>
              <p>{currentMovie.overview ?? ''}</p>
            </div>

            <button
              className={`cta-watchlist${isSaved ? ' saved' : ''}`}
              disabled={saveInFlight}
              onClick={isSaved ? handleRemoveCurrent : handleSave}
            >
              <span className="cta-icon">{isSaved ? '✓' : '+'}</span>
              <span className="cta-label">{isSaved ? 'In Watchlist' : 'Add to Watchlist'}</span>
              <span className="cta-meta">{isSaved ? 'Tap to remove' : ''}</span>
            </button>

            <ReviewsSection
              reviewsData={reviewsData}
              loading={reviewsLoading}
              onViewAll={() => onOpenAllReviews(currentMovie)}
            />

            <button
              type="button"
              className="section-row"
              onClick={onNavigateLibrary}
            >
              <span className="section-title">Your Watchlist</span>
              <span className="section-meta">
                <span>{savedMovies.length > 0 ? `${savedMovies.length} saved` : 'View all'}</span>
                <span className="section-meta-arrow">›</span>
              </span>
            </button>
          </>
        )}
      </div>
    </main>
  );
}

// ------------------------------------------ //
//             REVIEWS SECTION COMPONENT      //
// ------------------------------------------ //

interface ReviewsSectionProps {
  reviewsData: ReviewsSummary | null;
  loading: boolean;
  onViewAll: () => void;
}

/**
 * Reviews section component.
 * @returns The rendered ReviewsSection component, or null if nothing to show.
 */
function ReviewsSection({ reviewsData, loading, onViewAll }: ReviewsSectionProps): JSX.Element | null {
  if (!loading && !reviewsData) return null;

  const overall = reviewsData?.overall ?? [];

  return (
    <section className="reviews-section">
      <h3>
        <span>💬 What reviewers felt</span>
        {reviewsData && !reviewsData.error && (
          <span className="section-meta">
            {reviewsData.reviews?.length} of {reviewsData.total_results} · {reviewsData.inference_ms} ms
          </span>
        )}
      </h3>
      <p className="inference-line inference-line-mt">
        Emotions reflect how critics <em>felt writing</em> the review — not the film&apos;s tone.
      </p>

      {overall.length > 0 && (
        <div className="reviews-overall">
          <span className="overall-label">Overall mood:</span>
          <div className="reactions">
            {overall.map((e, i) => (
              <EmotionPill key={e.label} emotion={e} rank={i} />
            ))}
          </div>
        </div>
      )}

      <div>
        {loading && [0, 1, 2].map(i => <ReviewSkeleton key={`skel-${i}`} />)}
        {reviewsData?.error && (
          <div className="review-empty">Failed to load reviews: {reviewsData.error}</div>
        )}
        {reviewsData?.reviews?.length === 0 && (
          <div className="review-empty">No reviews on TMDB for this movie yet.</div>
        )}
        {(reviewsData?.reviews ?? []).map((rv, i) => (
          <ReviewCard key={rv.id ?? i} review={rv} />
        ))}
      </div>

      {reviewsData?.has_more && (
        <button className="reviews-view-all" onClick={onViewAll}>
          View all reviews ›
        </button>
      )}
    </section>
  );
}
