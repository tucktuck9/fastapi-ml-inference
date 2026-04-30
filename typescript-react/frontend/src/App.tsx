/**
 * App.tsx — root component managing global state and view routing.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { JSX } from 'react';
import './App.css';
import TopBar from './components/TopBar';
import BottomBar from './components/BottomBar';
import Toast from './components/Toast';
import SearchView from './views/Search';
import LibraryView from './views/Library';
import AllReviewsView from './views/AllReviews';
import BenchmarkPage from './views/Benchmark';
import { fetchSavedMovies, saveMovie, deleteMovie } from './utils/api';
import type { Movie, SavedMovie, Emotion, View } from './types';

/** @returns The initial view based on the current URL path. */
function _initialView(): View {
  return window.location.pathname === '/benchmark' ? 'benchmark' : 'search';
}

// ------------------------------------------ //
//             MAIN APP COMPONENT             //
// ------------------------------------------ //

/**
 * Main application component.
 *
 * Flow:
 * 1. Manages global state (current view, search input, saved movies).
 * 2. Syncs CSS theme based on the active view.
 * 3. Pre-warms the watchlist cache on mount.
 * 4. Renders the appropriate view components based on state.
 */
export default function App(): JSX.Element {
  const [view, setView] = useState<View>(_initialView);
  const [searchInput, setSearchInput] = useState('');
  const [pendingSearch, setPendingSearch] = useState<{ query: string; id: number } | null>(null);
  const [currentMovie, setCurrentMovie] = useState<Movie | null>(null);
  const [savedMovies, setSavedMovies] = useState<SavedMovie[]>([]);
  const [allReviewsCtx, setAllReviewsCtx] = useState<{ tmdbId: number; title: string } | null>(null);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.body.setAttribute('data-view', view);
  }, [view]);

  /**
   * Show a temporary toast message.
   * @param message - The message to display.
   */
  const showToast = useCallback((message: string): void => {
    setToast({ message, visible: true });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(
      () => setToast(t => ({ ...t, visible: false })),
      2200,
    );
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  /**
   * Navigate to a specific view.
   * @param viewName - The name of the view to navigate to.
   */
  const navigateTo = useCallback((viewName: View): void => {
    setView(viewName);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  /**
   * Handle a new movie search.
   * @param query - The search query.
   */
  const handleSearch = useCallback((query: string): void => {
    if (!query.trim()) return;
    setSearchInput(query.trim());
    setView('search');
    setPendingSearch({ query: query.trim(), id: Date.now() });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  /**
   * Open the all-reviews view for a movie.
   * @param movie - The movie object.
   */
  const handleOpenAllReviews = useCallback((movie: Movie): void => {
    setAllReviewsCtx({
      tmdbId: movie.tmdb_id,
      title: movie.title + (movie.year ? ` (${movie.year})` : ''),
    });
    navigateTo('reviews');
  }, [navigateTo]);

  /**
   * Load saved movies from the backend.
   */
  const loadSavedMovies = useCallback(async (): Promise<void> => {
    try {
      setSavedMovies(await fetchSavedMovies());
    } catch { /* silent — library is non-critical */ }
  }, []);

  /**
   * Save a movie to the watchlist.
   * @param movie - The movie object.
   * @param reviewerOverall - The overall emotions array.
   */
  const handleSave = useCallback(async (movie: Movie, reviewerOverall: Emotion[]): Promise<void> => {
    const saved = await saveMovie({
      tmdb_id: movie.tmdb_id,
      title: movie.title,
      year: movie.year ?? null,
      runtime_min: movie.runtime_min ?? null,
      poster_url: movie.poster ?? null,
      tagline: movie.tagline ?? null,
      overview: movie.overview ?? null,
      genres: movie.genres ?? null,
      tmdb_rating: movie.ratings?.tmdb ?? null,
      emotions: reviewerOverall,
    });
    setSavedMovies(prev =>
      prev.some(m => m.tmdb_id === saved.tmdb_id) ? prev : [saved, ...prev]
    );
    showToast('Added to Watchlist');
  }, [showToast]);

  /**
   * Remove a movie from the watchlist.
   * @param tmdbId - The TMDB ID of the movie to remove.
   */
  const handleRemove = useCallback(async (tmdbId: number): Promise<void> => {
    await deleteMovie(tmdbId);
    setSavedMovies(prev => prev.filter(m => m.tmdb_id !== tmdbId));
  }, []);

  useEffect(() => { void loadSavedMovies(); }, [loadSavedMovies]);

  if (view === 'benchmark') {
    return <BenchmarkPage onBack={() => navigateTo('search')} />;
  }

  return (
    <>
      <TopBar
        currentView={view}
        searchValue={searchInput}
        onSearchValueChange={setSearchInput}
        onSearch={handleSearch}
        onNavClick={navigateTo}
      />

      {view === 'search' && (
        <SearchView
          pendingSearch={pendingSearch}
          currentMovie={currentMovie}
          savedMovies={savedMovies}
          onMovieLoad={setCurrentMovie}
          onSave={handleSave}
          onRemove={handleRemove}
          onOpenAllReviews={handleOpenAllReviews}
          onNavigateLibrary={() => navigateTo('library')}
          showToast={showToast}
        />
      )}

      {view === 'library' && (
        <LibraryView
          savedMovies={savedMovies}
          onRemove={handleRemove}
          onViewDetails={handleSearch}
          onRefresh={loadSavedMovies}
          showToast={showToast}
        />
      )}

      {view === 'reviews' && allReviewsCtx && (
        <AllReviewsView
          tmdbId={allReviewsCtx.tmdbId}
          title={allReviewsCtx.title}
          onBack={() => navigateTo('search')}
        />
      )}

      <BottomBar currentView={view} onNavClick={navigateTo} />
      <Toast message={toast.message} visible={toast.visible} />

      {/* TMDB Attribution */}
      <footer className="tmdb-attribution">
        <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">
          <img
            src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
            alt="TMDB logo"
            className="tmdb-logo"
          />
        </a>
        <p className="tmdb-notice">
          This demo uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </footer>
    </>
  );
}
