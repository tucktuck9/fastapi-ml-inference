// ------------------------------------------ //
//             REVIEWS UI                     //
// ------------------------------------------ //

/**
 * Render loading skeletons for reviews.
 * @param {HTMLElement} container - The container element to render into.
 * @param {number} n - The number of skeletons to render.
 */
function renderReviewSkeletons(container, n) {
  container.innerHTML = Array.from({ length: n }, () => `
    <div class="review-skeleton">
      <div class="skeleton sk-line sk-author"></div>
      <div class="skeleton sk-line sk-text-1"></div>
      <div class="skeleton sk-line sk-text-2"></div>
      <div class="skeleton sk-line sk-chips"></div>
    </div>
  `).join('');
}

/**
 * Render a single review card.
 * @param {Object} rv - The review data object.
 * @returns {string} The HTML string for the review card.
 */
function renderReviewCard(rv) {
  const chips = (rv.emotions || []).map(renderReactionPill).join('');
  const ratingHtml = (rv.rating !== null && rv.rating !== undefined)
    ? `<span class="review-rating"><span class="star">★</span>${escapeHtml(String(rv.rating))}/10</span>`
    : '';
  return `
    <article class="review-card">
      <div class="review-head">
        <span class="review-author">${escapeHtml(rv.author || 'Anonymous')}</span>
        ${ratingHtml}
      </div>
      <div class="review-content">${escapeHtml(rv.content || '')}</div>
      <div class="reactions">${chips}</div>
    </article>
  `;
}

/**
 * Render the overall emotion chips for a movie.
 * @param {HTMLElement} target - The target element to render into.
 * @param {Array<Object>} overall - The overall emotions array.
 */
function renderOverallChips(target, overall) {
  if (!overall || overall.length === 0) {
    target.parentElement.style.display = 'none';
    return;
  }
  target.parentElement.style.display = 'flex';
  target.innerHTML = overall.map(renderReactionPill).join('');
}

/**
 * Load and render the reviews summary for a movie.
 *
 * Flow:
 * 1. Shows loading skeletons.
 * 2. Fetches reviews summary from the backend.
 * 3. Renders overall chips and individual review cards.
 * 4. Caches overall emotions for watchlist saves.
 *
 * @param {number} tmdbId - The TMDB ID of the movie.
 * @returns {Promise<void>}
 */
async function loadReviewsSummary(tmdbId) {
  const $section = document.getElementById('reviews-section');
  const $list = document.getElementById('reviews-list');
  const $overallChips = document.getElementById('reviews-overall-chips');
  const $viewAll = document.getElementById('reviews-view-all');
  const $meta = document.getElementById('reviews-count-meta');

  $section.style.display = 'block';
  $meta.textContent = '';
  $viewAll.style.display = 'none';
  document.getElementById('reviews-overall').style.display = 'none';
  renderReviewSkeletons($list, 3);

  try {
    const data = await fetchReviewsSummary(tmdbId);

    if (!data.reviews || data.reviews.length === 0) {
      $list.innerHTML = `<div class="review-empty">No reviews on TMDB for this movie yet.</div>`;
      return;
    }

    renderOverallChips($overallChips, data.overall);
    $list.innerHTML = data.reviews.map(renderReviewCard).join('');
    $meta.textContent = `${data.reviews.length} of ${data.total_results} · ${data.inference_ms} ms`;
    if (data.has_more) $viewAll.style.display = 'inline-flex';
    if (currentMovie && currentMovie.tmdb_id === tmdbId) {
      currentMovie.reviewer_overall = data.overall || [];
    }
  } catch (e) {
    $list.innerHTML = `<div class="review-empty">Failed to load reviews: ${escapeHtml(e.message)}</div>`;
  }
}

/**
 * Open the all-reviews view for the current movie.
 */
function openAllReviews() {
  if (!currentMovie) return;
  allReviewsState = {
    tmdbId: currentMovie.tmdb_id,
    title: currentMovie.title + (currentMovie.year ? ` (${currentMovie.year})` : ''),
    page: 0,
    totalPages: 0,
    totalResults: 0,
  };
  document.getElementById('all-reviews-title').textContent = `Reviews — ${allReviewsState.title}`;
  document.getElementById('all-reviews-sub').textContent = '';
  document.getElementById('all-reviews-list').innerHTML = '';
  document.getElementById('all-reviews-load-more').style.display = 'none';
  switchView('reviews-view');
  loadMoreReviews();
}

/**
 * Navigate back to the detail view from the all-reviews view.
 */
function backToDetail() {
  switchView('search-view');
}

/**
 * Load and render the next page of reviews.
 *
 * Flow:
 * 1. Appends loading skeletons.
 * 2. Fetches the next page of reviews from the backend.
 * 3. Appends new review cards to the list.
 * 4. Updates pagination state and load more button.
 *
 * @returns {Promise<void>}
 */
async function loadMoreReviews() {
  const $list = document.getElementById('all-reviews-list');
  const $moreBtn = document.getElementById('all-reviews-load-more');
  const $sub = document.getElementById('all-reviews-sub');

  const nextPage = (allReviewsState.page || 0) + 1;

  const $skelWrap = document.createElement('div');
  $skelWrap.className = 'reviews-batch-skeleton';
  $list.appendChild($skelWrap);
  renderReviewSkeletons($skelWrap, 4);
  $moreBtn.disabled = true;
  $moreBtn.textContent = 'Loading…';

  try {
    const data = await fetchReviewsPage(allReviewsState.tmdbId, nextPage);

    $skelWrap.remove();

    if (nextPage === 1 && (!data.reviews || data.reviews.length === 0)) {
      $list.innerHTML = `<div class="review-empty">No reviews on TMDB for this movie yet.</div>`;
      $moreBtn.style.display = 'none';
      return;
    }

    const html = (data.reviews || []).map(renderReviewCard).join('');
    $list.insertAdjacentHTML('beforeend', html);

    allReviewsState.page = data.page;
    allReviewsState.totalPages = data.total_pages;
    allReviewsState.totalResults = data.total_results;

    $sub.textContent = `${$list.querySelectorAll('.review-card').length} of ${data.total_results} reviews shown · each scored by the model on load`;

    if (data.has_more) {
      $moreBtn.style.display = 'block';
      $moreBtn.disabled = false;
      $moreBtn.textContent = 'Load more reviews';
    } else {
      $moreBtn.style.display = 'none';
    }
  } catch (e) {
    $skelWrap.remove();
    $moreBtn.disabled = false;
    $moreBtn.textContent = 'Load more reviews';
    $list.insertAdjacentHTML('beforeend',
      `<div class="review-empty">Failed to load reviews: ${escapeHtml(e.message)}</div>`);
  }
}
