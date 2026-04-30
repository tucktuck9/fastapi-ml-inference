// ------------------------------------------ //
//             UTILITIES                      //
// ------------------------------------------ //

/**
 * Escape HTML characters to prevent XSS.
 * @param {string} s - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

/**
 * Escape a string for use in an HTML attribute.
 * @param {string} s - The string to escape.
 * @returns {string} The escaped string.
 */
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

// ------------------------------------------ //
//             FORMATTING HELPERS             //
// ------------------------------------------ //

/**
 * Get the corresponding emoji for an emotion label.
 * @param {string} label - The emotion label.
 * @returns {string} The corresponding emoji.
 */
function emojiFor(label) {
  if (!label) return '🎭';
  return EMOTION_EMOJI[label.toLowerCase()] || '🎭';
}

/**
 * Format runtime in minutes to hours and minutes.
 * @param {number} min - Runtime in minutes.
 * @returns {string} Formatted runtime string.
 */
function formatRuntime(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h ? h + 'h ' : ''}${m}m`;
}

/**
 * Get the top N emotions from a ranked list.
 * @param {Array<Object>} arr - The ranked list of emotions.
 * @param {number} [n=3] - The number of top emotions to return.
 * @returns {Array<Object>} The top N emotions.
 */
function topEmotions(arr, n = 3) {
  return (arr || []).slice().sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, n);
}

/**
 * Render an HTML pill for a single emotion.
 * @param {Object} e - The emotion object.
 * @param {number} i - The rank index.
 * @returns {string} The HTML string for the pill.
 */
function renderReactionPill(e, i) {
  return `<span class="reaction rank-${i}">
      <span class="reaction-emoji">${emojiFor(e.label)}</span>
      <span style="text-transform:capitalize;">${escapeHtml(e.label)}</span>
      <span class="reaction-score">${(e.score * 100).toFixed(0)}%</span>
    </span>`;
}

/**
 * Parse a TMDB rating string into score and votes.
 * @param {string} str - The TMDB rating string.
 * @returns {Object|null} The parsed score and votes.
 */
function parseTmdbRating(str) {
  const m = String(str || '').match(/^([\d.]+)\/10(?:\s*\((.+)\))?/);
  return m ? { score: m[1], votes: m[2] || null } : null;
}
