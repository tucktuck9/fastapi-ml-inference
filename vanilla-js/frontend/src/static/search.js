// ------------------------------------------ //
//             SEARCH & DETAIL VIEW           //
// ------------------------------------------ //

/**
 * Execute a movie search and render the results.
 *
 * Flow:
 * 1. Reads title from input and switches to search view.
 * 2. Fetches movie details from backend.
 * 3. Renders movie details and kicks off reviews fetch.
 * 4. Handles loading and error states.
 *
 * @returns {Promise<void>}
 */
async function search() {
  const title = document.getElementById('title').value.trim();
  if (!title) return;
  switchView('search-view');

  const $result = document.getElementById('result');
  const $error = document.getElementById('error');
  const $emptyState = document.getElementById('empty-state');
  const $loading = document.getElementById('loading');

  $result.style.display = 'none';
  $error.style.display = 'none';
  $emptyState.style.display = 'none';
  $loading.style.display = 'block';

  try {
    const data = await searchMovie(title);
    currentMovie = data;
    renderMovie(data);
    $result.style.display = 'block';
    if (data.tmdb_id) loadReviewsSummary(data.tmdb_id);
  } catch (e) {
    $error.textContent = e.message;
    $error.style.display = 'block';
  } finally {
    $loading.style.display = 'none';
  }
}

/**
 * Render the movie details into the DOM.
 * @param {Object} data - The movie data object.
 */
function renderMovie(data) {
  document.getElementById('movie-title').textContent = data.title + (data.year ? ` (${data.year})` : '');
  const metaParts = [];
  if (data.year) metaParts.push(`<span>${escapeHtml(data.year)}</span>`);
  if (data.runtime_min) metaParts.push(`<span>${formatRuntime(data.runtime_min)}</span>`);
  if (data.genres && data.genres[0]) metaParts.push(`<span>${escapeHtml(data.genres[0])}</span>`);
  document.getElementById('movie-meta').innerHTML = metaParts.join('<span class="dot">·</span>');

  document.getElementById('poster').src = data.poster || '';
  document.getElementById('mini-poster').src = data.poster || '';
  const $backdrop = document.getElementById('hero-backdrop');
  $backdrop.style.backgroundImage = data.poster ? `url(${data.poster})` : 'none';

  document.getElementById('tagline').textContent = data.tagline || '';
  document.getElementById('plot').textContent = data.overview || '';

  document.getElementById('genres').innerHTML = (data.genres || []).map(g =>
    `<span class="chip">${escapeHtml(g)}<span class="chip-arrow">›</span></span>`
  ).join('');

  const $ratingBlock = document.getElementById('rating-block');
  const rating = data.ratings && parseTmdbRating(data.ratings.tmdb);
  if (rating) {
    document.getElementById('rating-score').textContent = rating.score;
    document.getElementById('rating-denom').textContent = rating.votes ? `/10 · ${rating.votes}` : '/10';
    $ratingBlock.style.display = 'inline-flex';
  } else {
    $ratingBlock.style.display = 'none';
  }

  refreshSaveButton();
}

/**
 * Update the save button state based on the watchlist cache.
 */
function refreshSaveButton() {
  const $btn = document.getElementById('save-button');
  const $meta = document.getElementById('save-meta');
  if (!currentMovie) return;
  const isSaved = savedMoviesCache.some(m => m.tmdb_id === currentMovie.tmdb_id);
  $btn.disabled = false;
  if (isSaved) {
    $btn.classList.add('saved');
    $btn.querySelector('.cta-icon').textContent = '✓';
    $btn.querySelector('.cta-label').textContent = 'In Watchlist';
    $meta.textContent = 'Tap to remove';
    $btn.onclick = removeCurrent;
  } else {
    $btn.classList.remove('saved');
    $btn.querySelector('.cta-icon').textContent = '+';
    $btn.querySelector('.cta-label').textContent = 'Add to Watchlist';
    $meta.textContent = '';
    $btn.onclick = saveCurrent;
  }
}

/**
 * Save the current movie to the user's watchlist.
 *
 * Flow:
 * 1. Disables the save button.
 * 2. Calls the backend API to save the movie.
 * 3. Optimistically updates the local cache and UI.
 * 4. Shows success or error toast.
 *
 * @returns {Promise<void>}
 */
async function saveCurrent() {
  if (!currentMovie) return;
  const $btn = document.getElementById('save-button');
  $btn.disabled = true;

  try {
    const saved = await saveMovie({
      tmdb_id: currentMovie.tmdb_id,
      title: currentMovie.title,
      year: currentMovie.year || null,
      runtime_min: currentMovie.runtime_min || null,
      poster_url: currentMovie.poster || null,
      tagline: currentMovie.tagline || null,
      overview: currentMovie.overview || null,
      genres: currentMovie.genres || null,
      tmdb_rating: (currentMovie.ratings && currentMovie.ratings.tmdb) || null,
      emotions: currentMovie.reviewer_overall || [],
    });
    if (!savedMoviesCache.some(m => m.tmdb_id === saved.tmdb_id)) {
      savedMoviesCache.unshift(saved);
    }
    refreshSaveButton();
    showToast('Added to Watchlist');
  } catch (e) {
    showToast('Save failed: ' + e.message);
    $btn.disabled = false;
  }
}

/**
 * Remove the current movie from the user's watchlist.
 * @returns {Promise<void>}
 */
async function removeCurrent() {
  if (!currentMovie) return;
  await removeMovie(currentMovie.tmdb_id, true);
  showToast('Removed from Watchlist');
}
