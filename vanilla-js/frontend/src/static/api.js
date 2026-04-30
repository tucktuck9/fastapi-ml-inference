// ------------------------------------------ //
//             CONFIG & STATE                 //
// ------------------------------------------ //

const BACKEND_URL = (window.ENV.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
const LIBRARY_URL = BACKEND_URL;

// ------------------------------------------ //
//             AUTH HELPERS                   //
// ------------------------------------------ //

/**
 * Initialize or retrieve the browser-scoped user identity.
 * @returns {string} The UUID for the current browser session.
 */
function _initUserId() {
  let id = localStorage.getItem('library_user_id');
  if (!id) {
    id = (crypto.randomUUID?.()) ||
         ('u-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    localStorage.setItem('library_user_id', id);
  }
  return id;
}

const USER_ID = _initUserId();

// ------------------------------------------ //
//             MOVIE API                      //
// ------------------------------------------ //

/**
 * Search for a movie by title.
 * @param {string} title - The movie title to search for.
 * @returns {Promise<Object>} The movie details.
 */
async function searchMovie(title) {
  const resp = await fetch(BACKEND_URL + '/movie?title=' + encodeURIComponent(title));
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.detail || 'Unknown error');
  return data;
}

/**
 * Fetch the reviews summary for a movie.
 * @param {number} tmdbId - The TMDB ID of the movie.
 * @returns {Promise<Object>} The summary of reviews and overall emotions.
 */
async function fetchReviewsSummary(tmdbId) {
  const resp = await fetch(`${BACKEND_URL}/movies/${tmdbId}/reviews/summary`);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

/**
 * Fetch a specific page of reviews for a movie.
 * @param {number} tmdbId - The TMDB ID of the movie.
 * @param {number} page - The page number to fetch.
 * @returns {Promise<Object>} The paginated reviews.
 */
async function fetchReviewsPage(tmdbId, page) {
  const resp = await fetch(`${BACKEND_URL}/movies/${tmdbId}/reviews?page=${page}`);
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return resp.json();
}

// ------------------------------------------ //
//             LIBRARY API                    //
// ------------------------------------------ //

/**
 * Fetch the user's saved movies library.
 * @returns {Promise<Array<Object>>} The list of saved movies.
 */
async function fetchLibrary() {
  const resp = await fetch(LIBRARY_URL + '/library/movies', {
    headers: { 'X-User-Id': USER_ID },
    cache: 'no-store', // Bypass browser cache for fresh data (does not affect backend Redis cache)
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || ('HTTP ' + resp.status));
  }
  return resp.json();
}

/**
 * Save a movie to the user's library.
 * @param {Object} payload - The movie data to save.
 * @returns {Promise<Object>} The saved movie record.
 */
async function saveMovie(payload) {
  const resp = await fetch(LIBRARY_URL + '/library/movies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Id': USER_ID },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || ('HTTP ' + resp.status));
  }
  return resp.json();
}

/**
 * Delete a movie from the user's library.
 * @param {number} tmdbId - The TMDB ID of the movie to delete.
 * @returns {Promise<void>}
 */
async function deleteMovie(tmdbId) {
  const resp = await fetch(LIBRARY_URL + '/library/movies/' + tmdbId, {
    method: 'DELETE',
    headers: { 'X-User-Id': USER_ID },
  });
  if (!resp.ok && resp.status !== 204) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || ('HTTP ' + resp.status));
  }
}
