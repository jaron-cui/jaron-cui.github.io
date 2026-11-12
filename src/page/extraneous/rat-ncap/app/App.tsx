import { useCallback, useEffect, useRef, useState } from 'react';
import { type ParameterEntry, Parameters } from './Parameters';
import type { FromWorker, SceneRenderer, Stats, ToWorker } from './protocol';
import './styles.css';

// Exported checkpoint directory, served from the site's `public/rat-ncap/`.
const CHECKPOINT = `${import.meta.env.BASE_URL}rat-ncap/1_4_flxext`;
const TRAINED_MAX = 1.0;  // (m/s) Trained target speeds were 0, 0.2, ..., 1.0.
const EXTENDED_MAX = 1.5;
// Playback rates (simulated time per wall time) selectable with the slider.
const RATES = [0.05, 0.1, 0.2, 0.25, 0.5, 0.75, 1, 1.5, 2];
const DEFAULT_RATE_INDEX = RATES.indexOf(1);

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error', message: string };

let next_id = 0;
const new_id = () => `p${next_id++}`;

/** The export's own parameters (loaded at startup) and its epoch presets (`params/index.json`). */
async function initial_entries(): Promise<ParameterEntry[]> {
  const fetch_json = async (path: string) => {
    const response = await fetch(`${CHECKPOINT}/${path}`);
    return response.ok ? response.json() : null;
  };
  const [manifest, index] = await Promise.all([
    fetch_json('manifest.json').catch(() => null),
    fetch_json('params/index.json').catch(() => null),
  ]);
  const exported: ParameterEntry = {
    id: 'export',
    name: manifest?.epoch !== undefined ? `exported (epoch ${manifest.epoch})` : 'exported',
    source: 'export',
    url: `${CHECKPOINT}/state_dict.json`,
    status: 'idle',
  };
  const presets: ParameterEntry[] = (index ?? []).map((p: { name: string, file: string }) => ({
    id: new_id(),
    name: p.name,
    source: 'preset',
    url: `${CHECKPOINT}/${p.file}`,
    status: 'idle',
  }));
  return [exported, ...presets];
}

export function App({ createRenderer, title = 'NCAP rat' }: {
  /** Draws the scene into `container` from the worker's geom poses (three.js or Slender). */
  createRenderer: (container: HTMLElement) => SceneRenderer;
  title?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const worker = useRef<Worker | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [stats, setStats] = useState<Stats | null>(null);
  const [target, setTarget] = useState(0.0);
  const [extended, setExtended] = useState(false);
  const [paused, setPaused] = useState(false);
  const [rateIndex, setRateIndex] = useState(DEFAULT_RATE_INDEX);
  const [entries, setEntries] = useState<ParameterEntry[]>([]);
  const [active, setActive] = useState<string | null>('export');

  const update_entry = useCallback((id: string, changes: Partial<ParameterEntry>) => {
    setEntries(list => list.map(e => e.id === id ? { ...e, ...changes } : e));
  }, []);

  const send = useCallback((message: ToWorker) => worker.current?.postMessage(message), []);

  useEffect(() => {
    const renderer = createRenderer(container.current!);
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case 'ready':
          renderer.set_geoms(message.geoms);
          setStatus({ kind: 'ready' });
          break;
        case 'frame':
          renderer.update(message.xpos, message.xmat, message.position, message.snap, { xpos: message.body_xpos, xmat: message.body_xmat });
          setStats(message.stats);
          break;
        case 'parameters':
          if (message.ok) {
            update_entry(message.id, { status: 'idle', error: undefined });
            setActive(message.id);
          } else {
            update_entry(message.id, { status: 'error', error: message.message });
          }
          break;
        case 'error':
          setStatus({ kind: 'error', message: message.message });
          break;
      }
    };
    w.onerror = event => setStatus({ kind: 'error', message: event.message || 'Worker failed to load.' });
    w.postMessage({ type: 'init', checkpoint: CHECKPOINT } satisfies ToWorker);
    initial_entries().then(list => setEntries(uploads => [...list, ...uploads.filter(e => e.source === 'upload')]));
    return () => {
      w.terminate();
      renderer.dispose();
    };
  }, []);

  const changeTarget = useCallback((value: number) => {
    setTarget(value);
    send({ type: 'set_target_vx', value });
  }, [send]);

  const reset = useCallback(() => send({ type: 'reset' }), [send]);

  const changeRate = useCallback((index: number) => {
    const i = Math.max(0, Math.min(RATES.length - 1, index));
    setRateIndex(i);
    send({ type: 'set_rate', value: RATES[i] });
  }, [send]);

  const selectParameters = useCallback((entry: ParameterEntry) => {
    update_entry(entry.id, { status: 'loading', error: undefined });
    send({ type: 'load_parameters', id: entry.id, url: entry.url, text: entry.text });
  }, [send, update_entry]);

  const uploadParameters = useCallback(async (files: File[]) => {
    const uploads: ParameterEntry[] = await Promise.all(files.map(async file => ({
      id: new_id(),
      name: file.name.replace(/\.json$/, ''),
      source: 'upload' as const,
      text: await file.text(),
      status: 'idle' as const,
    })));
    setEntries(list => [...list, ...uploads]);
    // Load the (last) uploaded file immediately.
    if (uploads.length) selectParameters(uploads.at(-1)!);
  }, [selectParameters]);

  const removeParameters = useCallback((entry: ParameterEntry) => {
    setEntries(list => list.filter(e => e.id !== entry.id));
  }, []);

  const togglePause = useCallback(() => {
    setPaused(p => {
      send({ type: 'pause', value: !p });
      return !p;
    });
  }, [send]);

  // Keyboard: arrows change speed, R resets, space pauses.
  useEffect(() => {
    const max = extended ? EXTENDED_MAX : TRAINED_MAX;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement && event.target.type === 'range') return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') changeTarget(Math.min(max, +(target + 0.1).toFixed(2)));
      else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') changeTarget(Math.max(0, +(target - 0.1).toFixed(2)));
      else if (event.key === 'r' || event.key === 'R') reset();
      else if (event.key === '[') changeRate(rateIndex - 1);
      else if (event.key === ']') changeRate(rateIndex + 1);
      else if (event.key === ' ') { event.preventDefault(); togglePause(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, extended, rateIndex, changeTarget, reset, togglePause, changeRate]);

  const max = extended ? EXTENDED_MAX : TRAINED_MAX;

  return (
    <div className="rat-app">
      <div className="viewport" ref={container} />
      <aside className="panel">
        <h1>{title}</h1>
        <p className="subtitle">Trained actor <code>{CHECKPOINT.split('/').at(-1)}</code> in MuJoCo (WASM)</p>

        <label className="slider">
          <span>Target speed <strong>{target.toFixed(2)} m/s</strong></span>
          <input
            type="range"
            min={0}
            max={max}
            step={0.05}
            value={target}
            disabled={status.kind !== 'ready'}
            onChange={event => changeTarget(Number(event.target.value))}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={extended}
            onChange={event => {
              setExtended(event.target.checked);
              if (!event.target.checked && target > TRAINED_MAX) changeTarget(TRAINED_MAX);
            }}
          />
          Allow speeds beyond training (up to {EXTENDED_MAX} m/s)
        </label>

        <label className="slider">
          <span>
            Playback speed <strong>{RATES[rateIndex]}×</strong>
            {RATES[rateIndex] < 1 ? ' (slow motion)' : RATES[rateIndex] > 1 ? ' (fast)' : ' (real time)'}
          </span>
          <input
            type="range"
            min={0}
            max={RATES.length - 1}
            step={1}
            value={rateIndex}
            disabled={status.kind !== 'ready'}
            onChange={event => changeRate(Number(event.target.value))}
          />
        </label>

        <div className="buttons">
          <button onClick={reset} disabled={status.kind !== 'ready'}>Reset (R)</button>
          <button onClick={togglePause} disabled={status.kind !== 'ready'}>{paused ? 'Resume' : 'Pause'} (Space)</button>
        </div>

        {status.kind === 'loading' && <p className="status">Loading model and MuJoCo…</p>}
        {status.kind === 'error' && <pre className="status error">{status.message}</pre>}
        {stats && (
          <dl className="stats">
            <dt>Status</dt>
            <dd className={stats.terminated ? 'bad' : 'good'}>{stats.terminated ? 'Fell over — press Reset' : 'OK'}</dd>
            <dt>Speed (along heading)</dt>
            <dd>{stats.speed.toFixed(2)} m/s</dd>
            <dt>Commanded</dt>
            <dd>{stats.target_vx.toFixed(2)} m/s</dd>
            <dt>Heading</dt>
            <dd>{(stats.heading * 180 / Math.PI).toFixed(0)}°</dd>
            <dt>Sim time</dt>
            <dd>{stats.time.toFixed(1)} s{stats.time > 6 ? ' (beyond 6 s training episodes)' : ''}</dd>
            <dt>Compute / step</dt>
            <dd>{stats.step_ms.toFixed(1)} ms of 30 ms</dd>
            <dt>Real-time factor</dt>
            <dd className={stats.realtime_factor < 0.95 * stats.rate ? 'bad' : ''}>
              {stats.realtime_factor.toFixed(2)}×{stats.rate !== 1 ? ` (set ${stats.rate}×)` : ''}
            </dd>
          </dl>
        )}
        <Parameters
          entries={entries}
          active={active}
          disabled={status.kind !== 'ready'}
          onSelect={selectParameters}
          onUpload={uploadParameters}
          onRemove={removeParameters}
        />
        <p className="hint">Drag to orbit, scroll to zoom. Arrow keys change target speed; [ and ] change playback speed.</p>
      </aside>
    </div>
  );
}
