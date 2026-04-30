import { useState, useEffect, useMemo } from 'react';
import type { JSX } from 'react';
import { emojiFor } from '../utils/display';
import { errorMessage } from '../utils/errors';
import { buildMetaParts, parseTmdbRating, topEmotions } from '../utils/display';
import type { SavedMovie } from '../types';

// ------------------------------------------ //
//             LIBRARY VIEW COMPONENT         //
// ------------------------------------------ //

interface LibraryViewProps {
  savedMovies: SavedMovie[];
  onRemove: (tmdbId: number) => Promise<void>;
  onViewDetails: (title: string) => void;
  onRefresh: () => void;
  showToast: (message: string) => void;
}

/**
 * Library view component.
 *
 * Flow:
 * 1. Fetches saved movies on mount.
 * 2. Filters movies by text and emotion.
 * 3. Renders the watchlist items.
 */
export default function LibraryView({ savedMovies, onRemove, onViewDetails, onRefresh, showToast }: LibraryViewProps): JSX.Element {
  const [filterText, setFilterText] = useState('');
  const [emotionFilter, setEmotionFilter] = useState('all');

  useEffect(() => { onRefresh(); }, [onRefresh]);

  // Derive emotion chips from the top-3 emotions present across all saved
  // movies, sorted by how many movies share each emotion. Only emotions that
  // actually appear in the watchlist get a chip.
  const emotionChips = useMemo(() => {
    const counts: Record<string, number> = {};
    savedMovies.forEach(m => {
      topEmotions(m.emotions, 3).forEach(e => {
        if (e?.label) {
          const key = e.label.toLowerCase();
          counts[key] = (counts[key] ?? 0) + 1;
        }
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
  }, [savedMovies]);

  // Reset to "all" if the active filter no longer exists in the watchlist.
  useEffect(() => {
    if (emotionFilter !== 'all' && !emotionChips.includes(emotionFilter)) {
      setEmotionFilter('all');
    }
  }, [emotionChips, emotionFilter]);

  const visibleMovies = useMemo(() => {
    let result = savedMovies;
    if (filterText) {
      result = result.filter(m => (m.title ?? '').toLowerCase().includes(filterText.toLowerCase()));
    }
    if (emotionFilter !== 'all') {
      result = result.filter(m =>
        topEmotions(m.emotions, 3).some(e => e?.label?.toLowerCase() === emotionFilter)
      );
    }
    return result;
  }, [savedMovies, filterText, emotionFilter]);

  /**
   * Handle removing a movie from the watchlist.
   * @param tmdbId - The TMDB ID of the movie.
   */
  async function handleRemove(tmdbId: number): Promise<void> {
    try {
      await onRemove(tmdbId);
      showToast('Removed from Watchlist');
    } catch (e) {
      showToast('Remove failed: ' + errorMessage(e));
    }
  }

  return (
    <main className="view" data-theme="light">
      <div className="container">
        <div className="wl-header">
          <h1 className="wl-title">Watchlist</h1>
          <p className="wl-subtitle">
            Movies you&apos;ve saved, with the emotion snapshot captured at the moment of save.
          </p>
        </div>

        <div className="wl-search">
          <span className="wl-search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search this page"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />
        </div>

        <div className="wl-filters">
          <button
            className={`wl-filter-chip${emotionFilter === 'all' ? ' active' : ''}`}
            onClick={() => setEmotionFilter('all')}
          >
            All<span className="caret">▾</span>
          </button>
          {emotionChips.map(key => (
            <button
              key={key}
              className={`wl-filter-chip${emotionFilter === key ? ' active' : ''}`}
              onClick={() => setEmotionFilter(key)}
            >
              {key.charAt(0).toUpperCase() + key.slice(1)}<span className="caret">▾</span>
            </button>
          ))}
        </div>

        <div className="wl-meta-bar">
          <div className="wl-count">
            <div>
              <strong>{visibleMovies.length} {visibleMovies.length === 1 ? 'Title' : 'Titles'}</strong>
            </div>
            <div className="sortline">Sorted by Date Added</div>
          </div>
        </div>

        <div className="wl-list">
          {savedMovies.length === 0 ? (
            <div className="wl-empty">
              <div className="wl-empty-icon">📌</div>
              <div>Your Watchlist is empty.</div>
              <div className="wl-empty-hint">
                Search for a movie and tap <strong>Add to Watchlist</strong> to start.
              </div>
            </div>
          ) : visibleMovies.length === 0 ? (
            <div className="wl-empty">No matches.</div>
          ) : (
            visibleMovies.map(m => (
              <WatchlistItem
                key={m.tmdb_id}
                movie={m}
                onRemove={() => void handleRemove(m.tmdb_id)}
                onViewDetails={() => onViewDetails(m.title)}
              />
            ))
          )}
        </div>
      </div>
    </main>
  );
}

// ------------------------------------------ //
//             WATCHLIST ITEM COMPONENT       //
// ------------------------------------------ //

interface WatchlistItemProps {
  movie: SavedMovie;
  onRemove: () => void;
  onViewDetails: () => void;
}

/**
 * A single watchlist item row.
 */
function WatchlistItem({ movie: m, onRemove, onViewDetails }: WatchlistItemProps): JSX.Element {
  const top = topEmotions(m.emotions, 3);
  const ratingScore = parseTmdbRating(m.tmdb_rating)?.score ?? null;
  const metaPieces = buildMetaParts(m);

  return (
    <div className="wl-item">
      <div className="wl-poster-wrap">
        <img className="wl-poster" src={m.poster_url ?? ''} alt="" loading="lazy" />
        <div className="wl-bookmark">✓</div>
      </div>
      <div className="wl-body">
        <div className="wl-name">{m.title}</div>
        <div className="wl-line">{metaPieces.join(' · ')}</div>
        {ratingScore && (
          <div className="wl-rating">
            <span className="star">★</span>
            <span className="score">{ratingScore}</span>
          </div>
        )}
        <div className="wl-emotion-row">
          {top.map(e => (
            <span key={e.label} className="wl-emotion">
              <span className="em-emoji">{emojiFor(e.label)}</span>
              <span className="wl-emotion-label">{e.label}</span>
              <span className="wl-emotion-score">{(e.score * 100).toFixed(0)}%</span>
            </span>
          ))}
        </div>
        <button type="button" className="wl-cta" onClick={onViewDetails}>View details ›</button>
      </div>
      <div className="wl-actions">
        <button className="wl-menu" title="Remove from watchlist" aria-label="Remove from watchlist" onClick={onRemove}>×</button>
      </div>
    </div>
  );
}
