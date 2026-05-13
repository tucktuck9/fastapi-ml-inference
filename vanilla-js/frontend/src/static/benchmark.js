// ------------------------------------------ //
//             CONFIG & STATE                 //
// ------------------------------------------ //

const API_BASE = window.ENV.BACKEND_URL;

let currentState = 'Unknown';
let isBusy = false;

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

function updateStatusUI(state) {
  document.getElementById('sum-state').textContent = state;
  document.getElementById('sum-dot').className = 'status-dot ' + state.toLowerCase();
  
  const toggleBtn = document.getElementById('btn-toggle-model');
  if (toggleBtn) {
    if (state === 'Loading' || state === 'Unloading' || isBusy) {
      toggleBtn.disabled = true;
      toggleBtn.textContent = state === 'Loading' ? 'Loading...' : (state === 'Unloading' ? 'Unloading...' : toggleBtn.textContent);
    } else {
      toggleBtn.disabled = false;
      if (state === 'Unloaded' || state === 'Unreachable' || state === 'Unknown') {
        toggleBtn.textContent = 'Load Model';
        toggleBtn.onclick = loadModel;
      } else {
        toggleBtn.textContent = 'Unload Model';
        toggleBtn.onclick = unloadModel;
      }
    }
  }
  
  const refreshBtn = document.getElementById('btn-refresh');
  if (refreshBtn) refreshBtn.disabled = isBusy;
  
  const predictBtn = document.getElementById('btn-predict');
  if (predictBtn) predictBtn.disabled = isBusy;
  
  const burstBtns = document.querySelectorAll('.btn-burst');
  burstBtns.forEach(btn => btn.disabled = isBusy);
}

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

    currentState = data.ready ? 'Ready' : (data.loaded ? 'Loaded' : 'Unloaded');
    updateStatusUI(currentState);
    return data;
  } catch (err) {
    console.error("Error fetching status:", err);
    currentState = 'Unreachable';
    updateStatusUI(currentState);
    return null;
  }
}

/**
 * Manually refresh the model status from the backend and log the result.
 */
async function manualRefresh() {
  const btn = document.getElementById('btn-refresh');
  if (btn) btn.textContent = 'Refreshing...';
  isBusy = true;
  updateStatusUI(currentState);
  
  const data = await refreshStatus();
  if (data) {
    appendLog('GET /admin/status', data);
  }
  
  isBusy = false;
  updateStatusUI(currentState);
  if (btn) btn.textContent = 'Refresh Status';
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
  
  const server_ms = data.latency_ms ?? 0;
  const inference_ms = data.result?.inference_ms ?? 0;
  const net_ms = Math.max(0, wall_ms - server_ms);
  const overhead_ms = Math.max(0, server_ms - inference_ms);
  
  if (data.cache_hit) {
    data.breakdown = { network_and_redis_ms: wall_ms };
  } else {
    data.breakdown = {
      model_forward_pass_ms: Math.round(inference_ms),
      server_overhead_ms: Math.round(overhead_ms),
      network_round_trip_ms: Math.round(net_ms)
    };
  }

  return {
    wall_ms,
    server_ms,
    inference_ms,
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
  isBusy = true;
  updateStatusUI(currentState);
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

  appendLog(`POST /predict ×${n} (burst)`, { p50, p95, p99, rps: +rps, cache_hits: hits }, Math.round(elapsed_ms));
  isBusy = false;
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
  isBusy = true;
  updateStatusUI(currentState);
  const text = document.getElementById('text').value;
  const { wall_ms, data, cache_hit } = await singlePredict(text);
  const label = cache_hit ? 'POST /predict [CACHE HIT]' : 'POST /predict';
  document.getElementById('sum-latency').textContent = wall_ms + ' ms' + (cache_hit ? ' ⚡ cached' : '');
  appendLog(label, data, wall_ms);
  isBusy = false;
  await refreshStatus();
}

/**
 * Force load the model into memory.
 * @returns {Promise<void>}
 */
async function loadModel() {
  currentState = 'Loading';
  updateStatusUI(currentState);
  document.getElementById('sum-latency').textContent = '— ms';

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
  currentState = 'Unloading';
  updateStatusUI(currentState);
  document.getElementById('sum-latency').textContent = '— ms';

  const resp = await fetch(API_BASE + '/admin/unload', { method: 'POST' });
  const data = await resp.json();
  appendLog('POST /admin/unload', data);
  await refreshStatus();
}

// ------------------------------------------ //
//             INITIALIZATION                 //
// ------------------------------------------ //

async function init() {
  await refreshStatus();
  
  // Poll every 3 seconds if unreachable (e.g. backend is still starting up)
  setInterval(async () => {
    if (currentState === 'Unreachable' && !isBusy) {
      await refreshStatus();
    }
  }, 3000);
}

init();
