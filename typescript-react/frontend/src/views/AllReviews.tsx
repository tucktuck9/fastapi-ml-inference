import { useState, useEffect, useCallback } from 'react';
import type { JSX } from 'react';
import { fetchReviewsPage } from '../utils/api';
import { errorMessage } from '../utils/errors';
import ReviewCard from '../components/ReviewCard';
import ReviewSkeleton from '../components/ReviewSkeleton';
import type { Review } from '../types';

// ------------------------------------------ //
//             ALL REVIEWS VIEW COMPONENT     //
// ------------------------------------------ //

interface AllReviewsViewProps {
  tmdbId: number;
  title: string;
  onBack: () => void;
}

/**
 * All reviews view component.
 *
 * Flow:
 * 1. Loads the first page of reviews on mount.
 * 2. Provides pagination to load more reviews.
 * 3. Renders the reviews list.
 */
export default function AllReviewsView({ tmdbId, title, onBack }: AllReviewsViewProps): JSX.Element {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [page, setPage] = useState(0);
  const [totalResults, setTotalResults] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  /**
   * Load a specific page of reviews.
   * @param pageNum - The page number to load.
   */
  const loadPage = useCallback(async (pageNum: number, signal?: AbortSignal): Promise<void> => {
    setLoading(true);
    try {
      const data = await fetchReviewsPage(tmdbId, pageNum, signal);

      if (pageNum === 1 && (!data.reviews || data.reviews.length === 0)) {
        setLoadError('No reviews on TMDB for this movie yet.');
        return;
      }

      setReviews(prev => [...prev, ...(data.reviews ?? [])]);
      setPage(data.page);
      setTotalResults(data.total_results);
      setHasMore(data.has_more);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setLoadError('Failed to load reviews: ' + errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [tmdbId]);

  useEffect(() => {
    const ctrl = new AbortController();
    setReviews([]);
    setPage(0);
    setTotalResults(0);
    setHasMore(false);
    setLoadError('');
    void loadPage(1, ctrl.signal);
    return () => ctrl.abort();
  }, [tmdbId, loadPage]);

  const shownCount = reviews.length;

  return (
    <main className="view" data-theme="dark">
      <div className="container">
        <div className="all-reviews-header">
          <button className="all-reviews-back" onClick={onBack}>‹ Back to movie</button>
          <h1 className="all-reviews-title">Reviews — {title}</h1>
          {totalResults > 0 && (
            <p className="all-reviews-sub">
              {shownCount} of {totalResults} reviews shown · each scored by the model on load
            </p>
          )}
        </div>

        <div>
          {reviews.map((rv, i) => <ReviewCard key={rv.id ?? i} review={rv} />)}
          {loading && [0, 1, 2, 3].map(i => <ReviewSkeleton key={`skel-${i}`} />)}
          {loadError && <div className="review-empty">{loadError}</div>}
        </div>

        {hasMore && !loading && (
          <button
            className="load-more-btn"
            onClick={() => void loadPage(page + 1)}
          >
            Load more reviews
          </button>
        )}
      </div>
    </main>
  );
}
