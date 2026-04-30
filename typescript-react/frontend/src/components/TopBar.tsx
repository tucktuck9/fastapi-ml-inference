import type { JSX } from 'react';
import type { View } from '../types';

interface TopBarProps {
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  onSearch: (query: string) => void;
  currentView: View;
  onNavClick: (view: View) => void;
}

// ------------------------------------------ //
//             COMPONENT                      //
// ------------------------------------------ //

export default function TopBar({ searchValue, onSearchValueChange, onSearch, currentView, onNavClick }: TopBarProps): JSX.Element {
  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onSearch(searchValue);
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="logo">Movie Vibes</div>
        <form role="search" className="topsearch" onSubmit={handleSubmit}>
          <span className="search-icon">🔍</span>
          <input
            type="search"
            placeholder="Search a movie title..."
            autoComplete="off"
            value={searchValue}
            onChange={e => onSearchValueChange(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>
        <button
          type="button"
          className={`top-nav-link${currentView === 'search' ? ' active' : ''}`}
          onClick={() => onNavClick('search')}
          aria-current={currentView === 'search' ? 'page' : undefined}
        >
          Home
        </button>
        <button
          type="button"
          className={`top-nav-link${currentView === 'library' ? ' active' : ''}`}
          onClick={() => onNavClick('library')}
          aria-current={currentView === 'library' ? 'page' : undefined}
        >
          Watchlist
        </button>
      </div>
    </header>
  );
}
