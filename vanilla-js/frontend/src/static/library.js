// ------------------------------------------ //
//             WATCHLIST VIEW                 //
// ------------------------------------------ //

/**
 * Load and render the user's watchlist library.
 *
 * Flow:
 * 1. Shows loading state.
 * 2. Fetches library from backend.
 * 3. Renders the library and refreshes save button.
 *
 * @returns {Promise<void>}
 */
async function loadLibrary() {
  const $list = document.getElementById('library-list');
  $list.innerHTML = '<div class="wl-empty"><div class="wl-empty-icon">⏳</div><div>Loading...</div></div>';
  try {
    savedMoviesCache = await fetchLibrary();
    renderEmotionFilterChips();
    renderLibrary();
    refreshSaveButton();
  } catch (e) {
    $list.innerHTML =
      `<div class="wl-empty"><div class="wl-empty-icon">⚠️</div><div>Failed to load: ${escapeHtml(e.message)}</div></div>`;
  }
}

/**
 * Rebuild the emotion filter chips from the top emotions present in the
 * current watchlist. Chips are sorted by how many movies share that top
 * emotion, so the most common mood floats to the front. The "All" chip is
 * always first and is defined statically in the HTML.
 */
function renderEmotionFilterChips() {
  const counts = {};
  savedMoviesCache.forEach(m => {
    topEmotions(m.emotions, 3).forEach(e => {
      if (e && e.label) {
        const key = e.label.toLowerCase();
        counts[key] = (counts[key] || 0) + 1;
      }
    });
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const $container = document.getElementById('wl-filters');
  const allChip = $container.querySelector('[data-filter="all"]');
  $container.innerHTML = '';
  $container.appendChild(allChip);

  sorted.forEach(([label]) => {
    const btn = document.createElement('button');
    btn.className = 'wl-filter-chip';
    btn.dataset.filter = label;
    btn.onclick = () => setEmotionFilter(label);
    btn.innerHTML = `${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}<span class="caret">▾</span>`;
    $container.appendChild(btn);
  });

  // Re-apply active state in case the current filter is still valid.
  $container.querySelectorAll('.wl-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === emotionFilter);
  });

  // Reset to "all" if the previously active emotion no longer appears.
  if (emotionFilter !== 'all' && !counts[emotionFilter]) {
    setEmotionFilter('all');
  }
}

/**
 * Set the active emotion filter for the watchlist.
 * @param {string} label - The emotion label to filter by.
 */
function setEmotionFilter(label) {
  emotionFilter = label;
  document.querySelectorAll('.wl-filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === label);
  });
  renderLibrary();
}

/**
 * Render the watchlist library into the DOM.
 */
function renderLibrary() {
  const $list = document.getElementById('library-list');
  const $countEl = document.getElementById('wl-count');
  const $inlineCountEl = document.getElementById('wl-count-inline');
  const filterText = (document.getElementById('wl-filter').value || '').toLowerCase().trim();

  let movies = savedMoviesCache;
  if (filterText) {
    movies = movies.filter(m => (m.title || '').toLowerCase().includes(filterText));
  }
  if (emotionFilter !== 'all') {
    movies = movies.filter(m =>
      topEmotions(m.emotions, 3).some(e => e && e.label && e.label.toLowerCase() === emotionFilter)
    );
  }

  $countEl.textContent = `${movies.length} ${movies.length === 1 ? 'Title' : 'Titles'}`;
  if ($inlineCountEl) {
    $inlineCountEl.textContent = savedMoviesCache.length
      ? `${savedMoviesCache.length} saved`
      : 'View all';
  }

  if (savedMoviesCache.length === 0) {
    $list.innerHTML = `
      <div class="wl-empty">
        <div class="wl-empty-icon">📌</div>
        <div>Your Watchlist is empty.</div>
        <div style="font-size:0.85rem; margin-top:8px;">
          Search for a movie and tap <strong>Add to Watchlist</strong> to start.
        </div>
      </div>`;
    return;
  }
  if (movies.length === 0) {
    $list.innerHTML = `<div class="wl-empty">No matches.</div>`;
    return;
  }

  $list.innerHTML = movies.map(m => {
    const top = topEmotions(m.emotions, 3);
    const ratingScore = m.tmdb_rating ? (parseTmdbRating(m.tmdb_rating) || {}).score : null;

    const metaPieces = [];
    if (m.year) metaPieces.push(escapeHtml(m.year));
    if (m.runtime_min) metaPieces.push(formatRuntime(m.runtime_min));
    if (m.genres && m.genres[0]) metaPieces.push(escapeHtml(m.genres[0]));

    return `
      <div class="wl-item">
        <div class="wl-poster-wrap">
          <img class="wl-poster" src="${escapeAttr(m.poster_url)}" alt="" loading="lazy" />
          <div class="wl-bookmark">✓</div>
        </div>
        <div class="wl-body">
          <div class="wl-name">${escapeHtml(m.title)}</div>
          <div class="wl-line">${metaPieces.join(' · ')}</div>
          ${ratingScore ? `
            <div class="wl-rating">
              <span class="star">★</span>
              <span class="score">${escapeHtml(ratingScore)}</span>
            </div>` : ''}
          <div class="wl-emotion-row">
            ${top.map(e => `
              <span class="wl-emotion">
                <span class="em-emoji">${emojiFor(e.label)}</span>
                <span style="text-transform:capitalize;">${escapeHtml(e.label)}</span>
                <span style="color:var(--text-faint);">${(e.score * 100).toFixed(0)}%</span>
              </span>
            `).join('')}
          </div>
          <div class="wl-cta" onclick="reanalyze(${JSON.stringify(m.title).replace(/"/g, '&quot;')})">View details ›</div>
        </div>
        <div class="wl-actions">
          <button class="wl-menu" title="Remove" onclick="removeMovie(${m.tmdb_id})">×</button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Re-search and view details for a specific movie title.
 * @param {string} title - The movie title.
 */
function reanalyze(title) {
  document.getElementById('title').value = title;
  switchView('search-view');
  search();
}

/**
 * Remove a movie from the watchlist by TMDB ID.
 *
 * Flow:
 * 1. Calls backend API to delete the movie.
 * 2. Updates local cache and re-renders library.
 * 3. Shows success or error toast.
 *
 * @param {number} tmdbId - The TMDB ID to remove.
 * @param {boolean} [silent=false] - Whether to suppress the success toast.
 * @returns {Promise<void>}
 */
async function removeMovie(tmdbId, silent) {
  try {
    await deleteMovie(tmdbId);
    savedMoviesCache = savedMoviesCache.filter(m => m.tmdb_id !== tmdbId);
    renderEmotionFilterChips();
    renderLibrary();
    refreshSaveButton();
    if (!silent) showToast('Removed from Watchlist');
  } catch (e) {
    showToast('Remove failed: ' + e.message);
  }
}
