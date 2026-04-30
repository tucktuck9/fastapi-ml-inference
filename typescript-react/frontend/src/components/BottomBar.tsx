import type { JSX } from 'react';
import type { View } from '../types';

interface BottomBarProps {
  currentView: View;
  onNavClick: (view: View) => void;
}

// ------------------------------------------ //
//             COMPONENT                      //
// ------------------------------------------ //

export default function BottomBar({ currentView, onNavClick }: BottomBarProps): JSX.Element {
  return (
    <nav className="bottombar" aria-label="Primary">
      <div className="bottombar-inner">
        <button
          type="button"
          className={`bb-link${currentView === 'search' ? ' active' : ''}`}
          onClick={() => onNavClick('search')}
          aria-current={currentView === 'search' ? 'page' : undefined}
        >
          <span className="bb-icon">🏠</span>Home
        </button>
        <button
          type="button"
          className={`bb-link${currentView === 'library' ? ' active' : ''}`}
          onClick={() => onNavClick('library')}
          aria-current={currentView === 'library' ? 'page' : undefined}
        >
          <span className="bb-icon">📑</span>Watchlist
        </button>
      </div>
    </nav>
  );
}
