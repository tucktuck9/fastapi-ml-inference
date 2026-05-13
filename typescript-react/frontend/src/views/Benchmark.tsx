/**
 * BenchmarkPage: interactive tool for testing inference latency and model lifecycle.
 *
 * Calls /predict, /admin/status, /admin/load, and /admin/unload on the backend
 * and renders live results without any server round-trips beyond those API calls.
 */

import { useState, useEffect, useCallback } from 'react';
import type { JSX } from 'react';
import { fetchModelStatus, runPredict, runPredictTimed, loadModel, unloadModel } from '../utils/api';
import type { ModelStatus } from '../utils/api';
import './Benchmark.css';

const INITIAL_TEXT = 'This was the best movie of all time.';

const BURST_SIZES = [5, 10, 20] as const;

// ------------------------------------------ //
//             HELPERS                        //
// ------------------------------------------ //

/** Compute the Nth percentile from a pre-sorted array of numbers. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ------------------------------------------ //
//             TYPES                          //
// ------------------------------------------ //

// ------------------------------------------ //
//             SUB-COMPONENTS                 //
// ------------------------------------------ //

interface KvRowProps {
  label: string;
  value: string | number | boolean | null | undefined;
  status?: 'ok' | 'warn';
}

/** A single key-value row inside a status card. */
function KvRow({ label, value, status }: KvRowProps): JSX.Element {
  const isEmpty = value === null || value === undefined || value === '';
  const cls = ['bm-kv-v', isEmpty ? 'placeholder' : status].filter(Boolean).join(' ');
  return (
    <div className="bm-kv-row">
      <span className="bm-kv-k">{label}:</span>
      <span className={cls}>{isEmpty ? '—' : String(value)}</span>
    </div>
  );
}

// ------------------------------------------ //
//             BENCHMARK PAGE                 //
// ------------------------------------------ //

interface BenchmarkPageProps {
  onBack: () => void;
}

/**
 * Full-page benchmark view.
 *
 * Flow:
 * 1. On mount, fetches current model status from the backend.
 * 2. Exposes buttons to run inference, fire N concurrent burst requests, load/unload the model,
 *    and refresh status.
 * 3. Appends each API response to a running log panel.
 * 4. Mirrors the status panel KV cards in real time.
 * 5. After a burst, renders p50/p95/p99 latency, throughput, cache stats, and a breakdown bar chart.
 */
export default function BenchmarkPage({ onBack }: BenchmarkPageProps): JSX.Element {
  const [text, setText]             = useState(INITIAL_TEXT);
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [sumState, setSumState]     = useState('Unknown');
  const [sumLatency, setSumLatency] = useState('— ms');
  const [kvStatus, setKvStatus]     = useState<ModelStatus>({});
  const [running, setRunning]       = useState(false);
  const [burstRunning, setBurstRunning] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  // ------------------------------------------ //
  //             API ACTIONS                    //
  // ------------------------------------------ //

  const _appendLog = useCallback((label: string, payload: unknown, ms?: number): void => {
    const stamp = new Date().toLocaleTimeString();
    const msStr = ms !== undefined ? `  (${ms} ms)` : '';
    const entry = `> [${stamp}] ${label}${msStr}\n${JSON.stringify(payload, null, 2)}`;
    setLogEntries(prev => [entry, ...prev]);
  }, []);

  const refreshStatus = useCallback(async (): Promise<ModelStatus | null> => {
    const data = await fetchModelStatus();
    if (!data) { setSumState('Unreachable'); return null; }
    setKvStatus(data);
    setSumState(data.ready ? 'Ready' : (data.loaded ? 'Loaded' : 'Unloaded'));
    return data;
  }, []);

  const manualRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      const data = await refreshStatus();
      if (data) {
        _appendLog('GET /admin/status', data);
      }
    } finally {
      setRefreshing(false);
    }
  }, [refreshStatus, _appendLog]);

  const predict = useCallback(async (): Promise<void> => {
    setRunning(true);
    try {
      const { data, ms, cache_hit } = await runPredict(text);
      
      const server_ms = (data as any).latency_ms ?? 0;
      const inference_ms = (data as any).result?.inference_ms ?? 0;
      const net_ms = Math.max(0, ms - server_ms);
      const overhead_ms = Math.max(0, server_ms - inference_ms);
      
      const breakdown = cache_hit 
        ? { network_and_redis_ms: ms }
        : {
            model_forward_pass_ms: Math.round(inference_ms),
            server_overhead_ms: Math.round(overhead_ms),
            network_round_trip_ms: Math.round(net_ms)
          };
          
      const payloadToLog = { ...(data as any), breakdown };

      const label = cache_hit ? 'POST /predict [CACHE HIT]' : 'POST /predict';
      setSumLatency(ms + ' ms' + (cache_hit ? ' ⚡ cached' : ''));
      _appendLog(label, payloadToLog, ms);
      await refreshStatus();
    } finally {
      setRunning(false);
    }
  }, [text, _appendLog, refreshStatus]);

  const runBurst = useCallback(async (n: number): Promise<void> => {
    setBurstRunning(true);
    try {
      const t0      = performance.now();
      const results = await Promise.all(Array.from({ length: n }, () => runPredictTimed(text)));
      const elapsed = performance.now() - t0;

      const walls = results.map(r => r.wall_ms).sort((a, b) => a - b);
      const p50   = percentile(walls, 50);
      const p95   = percentile(walls, 95);
      const p99   = percentile(walls, 99);
      const rps   = (n / (elapsed / 1000)).toFixed(1);
      const hits  = results.filter(r => r.cache_hit).length;

      _appendLog(`POST /predict ×${n} (burst)`, { p50, p95, p99, rps: +rps, cache_hits: hits }, Math.round(elapsed));
      await refreshStatus();
    } finally {
      setBurstRunning(false);
    }
  }, [text, _appendLog, refreshStatus]);

  const _loadModel = useCallback(async (): Promise<void> => {
    setSumState('Loading');
    setSumLatency('— ms');
    const data = await loadModel();
    _appendLog('POST /admin/load', data);
    await refreshStatus();
  }, [_appendLog, refreshStatus]);

  const _unloadModel = useCallback(async (): Promise<void> => {
    setSumState('Unloading');
    setSumLatency('— ms');
    const data = await unloadModel();
    _appendLog('POST /admin/unload', data);
    await refreshStatus();
  }, [_appendLog, refreshStatus]);

  useEffect(() => {
    void refreshStatus();
    
    // Poll every 3 seconds if unreachable (e.g. backend is still starting up)
    const interval = setInterval(() => {
      setSumState(current => {
        if (current === 'Unreachable') {
          void refreshStatus();
        }
        return current;
      });
    }, 3000);
    
    return () => clearInterval(interval);
  }, [refreshStatus]);

  const busy = running || burstRunning || refreshing;

  // ------------------------------------------ //
  //             RENDER                         //
  // ------------------------------------------ //

  return (
    <div className="bm-wrap">

      <div className="bm-header">
        <div className="bm-title-block">
          <h1 className="bm-h1">Inference Benchmark</h1>
          <p className="bm-subtitle">
            Test raw <strong>/predict</strong> response times and validate model readiness on the{' '}
            <strong>Render persistent disk</strong>. Cold loads pull from Hugging Face; warm loads
            hit the cached snapshot.
          </p>
        </div>
        <button type="button" className="bm-back" onClick={onBack}>&larr; Back to app</button>
      </div>

      <div className="bm-input-section">
        <div className="bm-section-label" style={{ marginTop: 0 }}>Test Input</div>
        <textarea
          className="bm-textarea"
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <div className="bm-run-row" style={{ marginTop: '14px' }}>
          <button type="button" className="bm-btn primary" onClick={() => void predict()} disabled={busy}>
            &#9654;&nbsp; Run Inference
          </button>
          <div className="bm-run-summary">
            <span className="bm-val">Status: <span className={`bm-status-dot ${sumState.toLowerCase()}`} />{sumState}</span>
            <span className="bm-arrow"> | </span>
            <span className="bm-val">Latency: {sumLatency}</span>
          </div>
          <div className="bm-burst-controls">
            <span className="bm-burst-lbl">Concurrent Requests:</span>
            {BURST_SIZES.map(n => (
              <button type="button" key={n} className="bm-btn" onClick={() => void runBurst(n)} disabled={busy}>
                {n}&times;
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bm-grid">

        <div className="bm-panel">
          <h2 className="bm-panel-h2">Event Log</h2>
          <div className="bm-log">
            {logEntries.length === 0
              ? <span className="bm-empty">&gt; Waiting for first request...</span>
              // key={i} safe: log entries are prepended, list rebuilds in place on each update.
              : logEntries.map((entry, i) => <pre key={i} className="bm-log-entry">{entry}</pre>)
            }
          </div>
        </div>

        <div className="bm-panel">
          <h2 className="bm-panel-h2">Status Preview</h2>

          <div className="bm-controls" style={{ marginTop: 0, marginBottom: '24px' }}>
            {sumState === 'Unloaded' || sumState === 'Unreachable' || sumState === 'Unknown' || sumState === 'Loading' ? (
              <button type="button" className="bm-btn" onClick={() => void _loadModel()} disabled={busy || sumState === 'Loading'}>
                {sumState === 'Loading' ? 'Loading...' : 'Load Model'}
              </button>
            ) : (
              <button type="button" className="bm-btn" onClick={() => void _unloadModel()} disabled={busy || sumState === 'Unloading'}>
                {sumState === 'Unloading' ? 'Unloading...' : 'Unload Model'}
              </button>
            )}
            <button type="button" className="bm-btn" onClick={() => void manualRefresh()} disabled={busy}>
              {refreshing ? 'Refreshing...' : 'Refresh Status'}
            </button>
          </div>

          <div className="bm-section-label" style={{ marginTop: 0 }}>Model</div>
          <div className="bm-status-grid">
            <div className="bm-kv-card">
              <div className="bm-kv-title">Identity</div>
              <KvRow label="model_id" value={kvStatus.model_id} />
              <KvRow label="loaded"   value={kvStatus.loaded  != null ? String(kvStatus.loaded)  : null} status={kvStatus.loaded  ? 'ok' : 'warn'} />
              <KvRow label="ready"    value={kvStatus.ready   != null ? String(kvStatus.ready)   : null} status={kvStatus.ready   ? 'ok' : 'warn'} />
            </div>
            <div className="bm-kv-card">
              <div className="bm-kv-title">Lifecycle</div>
              <KvRow label="eager_load"    value={kvStatus.eager_load    != null ? String(kvStatus.eager_load) : null} />
              <KvRow label="idle_unload_s" value={kvStatus.idle_unload_seconds} />
              <KvRow label="last_used_at"  value={kvStatus.last_used_at} />
            </div>
          </div>

          <div className="bm-section-label">Persistent Disk</div>
          <div className="bm-status-grid">
            <div className="bm-kv-card bm-kv-card--full">
              <div className="bm-kv-title">Cache</div>
              <KvRow label="hf_home" value={kvStatus.hf_home} />
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}
