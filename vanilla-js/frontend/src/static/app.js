// ------------------------------------------ //
//             CONSTANTS & STATE              //
// ------------------------------------------ //

const EMOTION_EMOJI = {
  joy: '😄', love: '❤️', optimism: '🌅', anticipation: '🤩',
  surprise: '😮', trust: '🤝',
  anger: '😠', disgust: '🤢', fear: '😨', sadness: '😢', pessimism: '😟',
  amusement: '😂', excitement: '🔥', confusion: '🤔', curiosity: '🧐',
  realization: '💡', neutral: '😐',
};

let currentMovie = null;
let savedMoviesCache = [];
let emotionFilter = 'all';
let allReviewsState = { tmdbId: null, title: null, page: 0, totalPages: 0, totalResults: 0 };

// ------------------------------------------ //
//             NAVIGATION                     //
// ------------------------------------------ //

/**
 * Switch the active view in the application.
 * @param {string} viewId - The ID of the view to activate.
 */
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.top-nav-link, .bb-link').forEach(t => t.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
  document.querySelectorAll(`[data-view="${viewId}"]`).forEach(t => t.classList.add('active'));
  if (viewId === 'library-view') loadLibrary();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ------------------------------------------ //
//             UI HELPERS                     //
// ------------------------------------------ //

/**
 * Show a temporary toast message.
 * @param {string} msg - The message to display.
 */
function showToast(msg) {
  const $el = document.getElementById('toast');
  $el.textContent = msg;
  $el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => $el.classList.remove('show'), 2200);
}

// ------------------------------------------ //
//             INIT                           //
// ------------------------------------------ //

document.getElementById('title').addEventListener('keydown', e => {
  if (e.key === 'Enter') search();
});

loadLibrary().catch(() => {});
