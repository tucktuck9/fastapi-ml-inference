/**
 * BenchmarkPage: interactive tool for testing inference latency and model lifecycle.
 *
 * Calls /predict, /admin/status, /admin/load, and /admin/unload on the backend
 * and renders live results without any server round-trips beyond those API calls.
 */

import { useState, useEffect, useCallback } from 'react';
import type { JSX } from 'react';
import { fetchModelStatus, runPredict, runPredictTimed, loadModel, unloadModel } from '../utils/api';
import type { ModelStatus, PredictTimed } from '../utils/api';
import './Benchmark.css';

const INITIAL_TEXT = 'I love how simple this deployment feels.';

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

interface BurstResult {
  n: number;
  p50: number; p95: number; p99: number;
  min: number; max: number;
  rps: string;
  totalMs: number;
  cacheHits: number;
  median: PredictTimed;
}

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

interface BurstPanelProps { result: BurstResult; }

/** Renders p50/p95/p99 stats, throughput, cache hit rate, and a latency breakdown bar chart. */
function BurstPanel({ result }: BurstPanelProps): JSX.Element {
  const { n, p50, p95, p99, min, max, rps, totalMs, cacheHits, median } = result;
  const net_ms      = Math.max(0, median.wall_ms - median.server_ms);
  const overhead_ms = Math.max(0, median.server_ms - median.inference_ms);
  const total       = median.wall_ms;

  const breakdownRows = median.cache_hit
    ? [{ label: 'Network + Redis (no inference)', ms: total,                          model: true  }]
    : [
        { label: 'Model forward pass',   ms: Math.round(median.inference_ms), model: true  },
        { label: 'Server overhead',      ms: Math.round(overhead_ms),         model: false },
        { label: 'Network (round-trip)', ms: Math.round(net_ms),              model: false },
      ];

  return (
    <div className="bm-burst-panel">
      <h2 className="bm-panel-h2">Burst Results — {n} concurrent requests</h2>
      <div className="bm-burst-grid">

        <div>
          <div className="bm-section-label">Wall-clock latency</div>
          {([['p50', p50], ['p95', p95], ['p99', p99], ['min', min], ['max', max]] as const).map(([k, v]) => (
            <div key={k} className="bm-stat-row">
              <span className="bm-stat-k">{k}</span>
              <span className="bm-stat-v">{v} ms</span>
            </div>
          ))}
        </div>

        <div>
          <div className="bm-section-label">Throughput</div>
          <div className="bm-stat-row"><span className="bm-stat-k">requests/sec</span><span className="bm-stat-v">{rps}</span></div>
          <div className="bm-stat-row"><span className="bm-stat-k">total time</span><span className="bm-stat-v">{totalMs} ms</span></div>
          <div className="bm-section-label bm-section-label--mt">Cache</div>
          <div className="bm-stat-row"><span className="bm-stat-k">hits / total</span><span className="bm-stat-v bm-stat-v--hit">{cacheHits} / {n}</span></div>
          <div className="bm-stat-row"><span className="bm-stat-k">hit rate</span><span className="bm-stat-v bm-stat-v--hit">{((cacheHits / n) * 100).toFixed(0)}%</span></div>
        </div>

        <div>
          <div className="bm-section-label">Latency breakdown — median request</div>
          {breakdownRows.map(({ label, ms, model }) => {
            const pct = total > 0 ? Math.min(100, Math.round((ms / total) * 100)) : 0;
            return (
              <div key={label} className="bm-breakdown-row">
                <span className="bm-br-label">{label}</span>
                <span className="bm-br-val">{ms} ms</span>
                <div className="bm-br-bar-wrap">
                  <div className={`bm-br-bar${model ? ' bm-br-bar--model' : ''}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="bm-br-pct">{pct}%</span>
              </div>
            );
          })}
          <div className="bm-breakdown-row bm-breakdown-row--total">
            <span className="bm-br-label bm-br-label--total">Total</span>
            <span className="bm-br-val bm-br-val--total">{total} ms</span>
            <div /><div />
          </div>
        </div>

      </div>
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
  const [sumModel, setSumModel]     = useState('—');
  const [sumState, setSumState]     = useState('unknown');
  const [sumLatency, setSumLatency] = useState('— ms');
  const [kvStatus, setKvStatus]     = useState<ModelStatus>({});
  const [running, setRunning]       = useState(false);
  const [burstRunning, setBurstRunning] = useState(false);
  const [burstResult, setBurstResult]   = useState<BurstResult | null>(null);

  // ------------------------------------------ //
  //             API ACTIONS                    //
  // ------------------------------------------ //

  const _appendLog = useCallback((label: string, payload: unknown, ms?: number): void => {
    const stamp = new Date().toLocaleTimeString();
    const msStr = ms !== undefined ? `  (${ms} ms)` : '';
    const entry = `> [${stamp}] ${label}${msStr}\n${JSON.stringify(payload, null, 2)}`;
    setLogEntries(prev => [entry, ...prev]);
  }, []);

  const refreshStatus = useCallback(async (): Promise<void> => {
    const data = await fetchModelStatus();
    if (!data) { setSumState('unreachable'); return; }
    setKvStatus(data);
    setSumModel(data.model_id ?? '—');
    setSumState(data.ready ? 'ready' : (data.loaded ? 'loaded' : 'unloaded'));
  }, []);

  const predict = useCallback(async (): Promise<void> => {
    setRunning(true);
    try {
      const { data, ms } = await runPredict(text);
      setSumLatency(ms + ' ms');
      _appendLog('POST /predict', data, ms);
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
      const median = results.find(r => r.wall_ms === p50) ?? results[Math.floor(results.length / 2)];

      setBurstResult({ n, p50, p95, p99, min: walls[0], max: walls[walls.length - 1], rps, totalMs: Math.round(elapsed), cacheHits: hits, median });
      _appendLog(`POST /predict ×${n} (burst)`, { p50, p95, p99, rps: +rps, cache_hits: hits }, Math.round(elapsed));
      await refreshStatus();
    } finally {
      setBurstRunning(false);
    }
  }, [text, _appendLog, refreshStatus]);

  const _loadModel = useCallback(async (): Promise<void> => {
    const data = await loadModel();
    _appendLog('POST /admin/load', data);
    await refreshStatus();
  }, [_appendLog, refreshStatus]);

  const _unloadModel = useCallback(async (): Promise<void> => {
    const data = await unloadModel();
    _appendLog('POST /admin/unload', data);
    await refreshStatus();
  }, [_appendLog, refreshStatus]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const busy = running || burstRunning;

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
        <button type="button" className="bm-back" onClick={onBack}>← Back to app</button>
      </div>

      <div className="bm-run-row">
        <button type="button" className="bm-btn primary" onClick={() => void predict()} disabled={busy}>
          ▶&nbsp; Run Inference
        </button>
        <div className="bm-run-summary">
          <span className="bm-val">{sumModel}</span>
          <span className="bm-arrow"> → </span>
          <span className="bm-val">{sumState}</span>
          <span className="bm-arrow"> → </span>
          <span className="bm-val">{sumLatency}</span>
        </div>
        <div className="bm-burst-controls">
          <span className="bm-burst-lbl">Burst:</span>
          {BURST_SIZES.map(n => (
            <button type="button" key={n} className="bm-btn" onClick={() => void runBurst(n)} disabled={busy}>
              {n}&times;
            </button>
          ))}
        </div>
      </div>

      <div className="bm-grid">

        <div className="bm-panel">
          <h2 className="bm-panel-h2">Event Log</h2>

          <div className="bm-section-label">Input</div>
          <textarea
            className="bm-textarea"
            value={text}
            onChange={e => setText(e.target.value)}
          />
          <div className="bm-controls">
            <button type="button" className="bm-btn" onClick={() => void _loadModel()}>Load Model</button>
            <button type="button" className="bm-btn" onClick={() => void _unloadModel()}>Unload Model</button>
            <button type="button" className="bm-btn" onClick={() => void refreshStatus()}>Refresh Status</button>
          </div>

          <div className="bm-section-label bm-response-label">Response</div>
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

          <div className="bm-section-label">Model</div>
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

      {burstResult !== null && <BurstPanel result={burstResult} />}

    </div>
  );
}
