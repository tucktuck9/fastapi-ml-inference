// ------------------------------------------ //
//             CONFIG & STATE                 //
// ------------------------------------------ //

const API_BASE = window.ENV.BACKEND_URL;

// ------------------------------------------ //
//             UI HELPERS                     //
// ------------------------------------------ //

/**
 * Set a key-value pair in the UI.
 * @param {string} id - The DOM element ID.
 * @param {any} value - The value to display.
 * @param {string} [klass] - Optional CSS class to apply.
 */
function setKV(id, value, klass) {
  const $el = document.getElementById(id);
  if (!$el) return;
  $el.textContent = (value === null || value === undefined || value === '') ? '—' : String(value);
  $el.classList.remove('placeholder', 'ok', 'warn');
  if (klass) $el.classList.add(klass);
  else if (value === null || value === undefined || value === '') $el.classList.add('placeholder');
}

/**
 * Append a log message to the output console.
 * @param {string} label - The log label.
 * @param {Object} payload - The JSON payload to stringify.
 * @param {number} [ms] - Optional latency in milliseconds.
 */
function appendLog(label, payload, ms) {
  const $out = document.getElementById('output');
  const stamp = new Date().toLocaleTimeString();
  const ms_str = (ms !== undefined) ? `  (${ms} ms)` : '';
  const block =
    `> [${stamp}] ${label}${ms_str}\n` +
    JSON.stringify(payload, null, 2) + '\n\n';
  if ($out.querySelector('.empty')) $out.textContent = '';
  $out.textContent = block + $out.textContent;
}

// ------------------------------------------ //
//             API ACTIONS                    //
// ------------------------------------------ //

/**
 * Refresh the model status from the backend.
 * 
 * Flow:
 * 1. Fetches status from the admin endpoint.
 * 2. Updates the key-value display elements.
 * 3. Updates the summary header.
 * 
 * @returns {Promise<void>}
 */
async function refreshStatus() {
  try {
    // Bypass browser cache for fresh data (does not affect backend Redis cache)
    const resp = await fetch(API_BASE + '/admin/status', { cache: 'no-store' });
    const data = await resp.json();
    setKV('kv-model-id', data.model_id);
    setKV('kv-loaded', data.loaded, data.loaded ? 'ok' : 'warn');
    setKV('kv-ready', data.ready, data.ready ? 'ok' : 'warn');
    setKV('kv-eager', data.eager_load);
    setKV('kv-idle', data.idle_unload_seconds);
    setKV('kv-last', data.last_used_at);
    setKV('kv-hfhome', data.hf_home);

    document.getElementById('sum-model').textContent = data.model_id || '—';
    document.getElementById('sum-state').textContent = data.ready ? 'ready' : (data.loaded ? 'loaded' : 'unloaded');
  } catch (err) {
    document.getElementById('sum-state').textContent = 'unreachable';
  }
}

// ------------------------------------------ //
//             LATENCY HELPERS               //
// ------------------------------------------ //

/**
 * Compute the Nth percentile from a pre-sorted array of numbers.
 * @param {number[]} sorted - Ascending-sorted values.
 * @param {number} p - Percentile (0–100).
 * @returns {number}
 */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

/**
 * Fire one /predict request and return a timing record.
 * @param {string} text
 * @returns {Promise<{wall_ms: number, server_ms: number, inference_ms: number, cache_hit: boolean}>}
 */
async function singlePredict(text) {
  const t0 = performance.now();
  const resp = await fetch(API_BASE + '/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const data = await resp.json();
  const wall_ms = Math.round(performance.now() - t0);
  return {
    wall_ms,
    server_ms: data.latency_ms ?? 0,
    inference_ms: data.result?.inference_ms ?? 0,
    cache_hit: data.cache_hit ?? false,
    data,
  };
}

// ------------------------------------------ //
//             BURST RUNNER                  //
// ------------------------------------------ //

/**
 * Fire N concurrent /predict requests and display latency statistics.
 *
 * Flow:
 * 1. Fires all N requests simultaneously via Promise.all.
 * 2. Computes p50/p95/p99 wall-clock latency across all results.
 * 3. Computes throughput as N / elapsed_seconds.
 * 4. Renders the breakdown for the median request.
 *
 * @param {number} n - Number of concurrent requests.
 * @returns {Promise<void>}
 */
async function runBurst(n) {
  const text = document.getElementById('text').value;
  const t0 = performance.now();
  const results = await Promise.all(Array.from({ length: n }, () => singlePredict(text)));
  const elapsed_ms = performance.now() - t0;

  // Percentile stats on wall-clock
  const walls = results.map(r => r.wall_ms).sort((a, b) => a - b);
  const p50 = percentile(walls, 50);
  const p95 = percentile(walls, 95);
  const p99 = percentile(walls, 99);
  const rps = (n / (elapsed_ms / 1000)).toFixed(1);
  const hits = results.filter(r => r.cache_hit).length;

  // Median request breakdown
  const median = results.find(r => r.wall_ms === p50) ?? results[Math.floor(results.length / 2)];
  const net_ms = Math.max(0, median.wall_ms - median.server_ms);
  const overhead_ms = Math.max(0, median.server_ms - median.inference_ms);
  const total = median.wall_ms;

  // Update burst panel
  const panel = document.getElementById('burst-panel');
  panel.classList.add('visible');
  document.getElementById('burst-label').textContent = `${n} concurrent requests`;
  document.getElementById('bp-p50').textContent = p50 + ' ms';
  document.getElementById('bp-p95').textContent = p95 + ' ms';
  document.getElementById('bp-p99').textContent = p99 + ' ms';
  document.getElementById('bp-min').textContent = walls[0] + ' ms';
  document.getElementById('bp-max').textContent = walls[walls.length - 1] + ' ms';
  document.getElementById('bp-rps').textContent = rps;
  document.getElementById('bp-total').textContent = Math.round(elapsed_ms) + ' ms';
  document.getElementById('bp-cache').textContent = `${hits} / ${n}`;
  document.getElementById('bp-hitrate').textContent = ((hits / n) * 100).toFixed(0) + '%';

  // Breakdown bars — cache hits have no model forward pass; show Redis lookup instead.
  const totalRow = `<div class="breakdown-row" style="border-top:1px solid var(--border-strong);margin-top:4px;padding-top:6px;">
    <span class="br-label" style="color:var(--text)">Total</span>
    <span class="br-val" style="color:var(--text)">${total} ms</span>
    <div></div><div></div>
  </div>`;

  let breakdownHtml;
  if (median.cache_hit) {
    breakdownHtml = `<div class="breakdown-row">
      <span class="br-label">Network + Redis (no inference)</span>
      <span class="br-val">${total} ms</span>
      <div class="br-bar-wrap"><div class="br-bar model" style="width:100%"></div></div>
      <span class="br-pct">100%</span>
    </div>` + totalRow;
  } else {
    const rows = [
      { label: 'Model forward pass',  ms: Math.round(median.inference_ms), cls: 'model' },
      { label: 'Server overhead',     ms: Math.round(overhead_ms),          cls: '' },
      { label: 'Network (round-trip)',ms: Math.round(net_ms),               cls: '' },
    ];
    breakdownHtml = rows.map(r => {
      const pct = total > 0 ? Math.min(100, Math.round((r.ms / total) * 100)) : 0;
      return `<div class="breakdown-row">
        <span class="br-label">${r.label}</span>
        <span class="br-val">${r.ms} ms</span>
        <div class="br-bar-wrap"><div class="br-bar ${r.cls}" style="width:${pct}%"></div></div>
        <span class="br-pct">${pct}%</span>
      </div>`;
    }).join('') + totalRow;
  }
  document.getElementById('bp-breakdown').innerHTML = breakdownHtml;

  appendLog(`POST /predict ×${n} (burst)`, { p50, p95, p99, rps: +rps, cache_hits: hits }, Math.round(elapsed_ms));
  await refreshStatus();
}

// ------------------------------------------ //
//             SINGLE PREDICT                //
// ------------------------------------------ //

/**
 * Send a single prediction request to the backend.
 *
 * Flow:
 * 1. Reads text input.
 * 2. Sends POST request to /predict.
 * 3. Displays wall-clock latency, cache hit, and latency breakdown.
 * 4. Refreshes model status.
 *
 * @returns {Promise<void>}
 */
async function predict() {
  const text = document.getElementById('text').value;
  const { wall_ms, data, cache_hit } = await singlePredict(text);
  const label = cache_hit ? 'POST /predict [CACHE HIT]' : 'POST /predict';
  document.getElementById('sum-latency').textContent = wall_ms + ' ms' + (cache_hit ? ' ⚡ cached' : '');
  appendLog(label, data, wall_ms);
  await refreshStatus();
}

/**
 * Force load the model into memory.
 * @returns {Promise<void>}
 */
async function loadModel() {
  const resp = await fetch(API_BASE + '/admin/load', { method: 'POST' });
  const data = await resp.json();
  appendLog('POST /admin/load', data);
  await refreshStatus();
}

/**
 * Force unload the model from memory.
 * @returns {Promise<void>}
 */
async function unloadModel() {
  const resp = await fetch(API_BASE + '/admin/unload', { method: 'POST' });
  const data = await resp.json();
  appendLog('POST /admin/unload', data);
  await refreshStatus();
}

// ------------------------------------------ //
//             INITIALIZATION                 //
// ------------------------------------------ //

refreshStatus();
