/**
 * Simulation worker: runs the actor and MuJoCo (WASM) in real time, off the main thread, and posts
 * a frame (geom poses + stats) after each batch of control steps.
 */

import { Simulation } from '../src/app/simulation';
import { RG_SOURCES, RG_UNITS } from './protocol';
import type { FromWorker, ToWorker } from './protocol';
import { readGeoms } from './geoms';

const CONTROL_DT = 0.03;  // (s) Matches the trained env timestep.
const MAX_STEPS_PER_TICK = 4;  // Catch up at most this many steps per tick (then fall behind).

let sim: Simulation | null = null;
let paused = false;
let auto_reset = false;  // Reset the moment the rat falls over.
let rate = 1;  // Playback rate: simulated time per wall time.
let wall_start = 0;  // (ms) Wall time corresponding to sim time 0 of the current run.
let sim_steps = 0;  // Control steps since `wall_start`.
const step_ms: number[] = [];
// Rhythm-generation outputs after each control step not yet sent, and the steps since reset.
let activity: number[] = [];
let activity_steps = 0;
let step_index = 0;
const rg_names = RG_UNITS.filter(u => u !== 'bc').map(u => RG_SOURCES[u]);

function record_activity() {
  if (sim === null) return;
  activity.push(...sim.rhythm_outputs(rg_names), sim.target_vx);
  activity_steps++;
}
const rtf_window: [number, number][] = [];  // (wall ms, sim steps) samples over the last second.

const post = (message: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(message, transfer);

/** Wall time (ms) per control step at the current playback rate. */
const step_wall_ms = () => (CONTROL_DT * 1000) / rate;

function restart_clock() {
  wall_start = performance.now();
  sim_steps = 0;
  rtf_window.length = 0;
}

/** Re-anchors the clock so the current step count is on schedule (after pauses or rate changes). */
function reanchor_clock() {
  wall_start = performance.now() - sim_steps * step_wall_ms();
  rtf_window.length = 0;
}


function frame(snap: boolean = false) {
  if (sim === null) return;
  const { xpos, xmat } = sim.geom_poses();
  const now = performance.now();
  rtf_window.push([now, sim_steps]);
  while (rtf_window.length > 1 && now - rtf_window[0][0] > 1000) rtf_window.shift();
  const [t0, s0] = rtf_window[0];
  const realtime_factor = now > t0 ? ((sim_steps - s0) * CONTROL_DT * 1000) / (now - t0) : 1;
  const xpos32 = Float32Array.from(xpos);
  const xmat32 = Float32Array.from(xmat);
  const body = sim.body_poses();
  const body_xpos = Float32Array.from(body.xpos);
  const body_xmat = Float32Array.from(body.xmat);
  const values = Float32Array.from(activity);
  const sent = { values, steps: activity_steps, step: step_index };
  activity = [];
  activity_steps = 0;
  post({
    type: 'frame',
    xpos: xpos32,
    xmat: xmat32,
    body_xpos,
    body_xmat,
    position: sim.position,
    stats: {
      time: sim.time,
      target_vx: sim.target_vx,
      speed: sim.speed,
      heading: sim.heading,
      terminated: sim.terminated,
      step_ms: step_ms.length ? step_ms.reduce((a, b) => a + b, 0) / step_ms.length : 0,
      realtime_factor,
      rate,
    },
    snap,
    activity: sent,
  }, [xpos32.buffer, xmat32.buffer, body_xpos.buffer, body_xmat.buffer, values.buffer]);
}

function reset() {
  if (sim === null) return;
  sim.reset();
  activity = [];
  activity_steps = 0;
  step_index = 0;
  record_activity();
  restart_clock();
  frame(true);
}

function tick() {
  if (sim !== null && !paused) {
    // Run the control steps that are due in wall time, up to a cap (slow machines run in slow motion).
    const due = Math.floor((performance.now() - wall_start) / step_wall_ms()) - sim_steps;
    const steps = Math.min(due, MAX_STEPS_PER_TICK);
    let fell = false;
    for (let i = 0; i < steps; i++) {
      const start = performance.now();
      sim.step();
      step_ms.push(performance.now() - start);
      step_index++;
      record_activity();
      if (step_ms.length > 30) step_ms.shift();
      sim_steps++;
      if (auto_reset && sim.terminated) {
        fell = true;
        break;
      }
    }
    if (fell) {
      // Start again at once (the reset sends its own frame).
      reset();
    } else {
      if (due > MAX_STEPS_PER_TICK) {
        // Too far behind: drop the backlog rather than spiralling.
        reanchor_clock();
      }
      if (steps > 0) frame();
    }
  }
  setTimeout(tick, 4);
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init': {
        const base = `${message.checkpoint.replace(/\/$/, '')}/`;
        sim = await Simulation.load(async name => {
          const response = await fetch(base + name);
          if (!response.ok) throw new Error(`Failed to fetch ${base + name}: ${response.status}`);
          return new Uint8Array(await response.arrayBuffer());
        });
        post({ type: 'ready', geoms: readGeoms() });
        step_index = 0;
        record_activity();
        restart_clock();
        frame(true);
        tick();
        break;
      }
      case 'set_target_vx':
        sim?.set_target_vx(message.value);
        break;
      case 'reset':
        reset();
        break;
      case 'set_auto_reset':
        auto_reset = message.value;
        break;
      case 'load_parameters': {
        try {
          if (sim === null) throw new Error('The simulation is not loaded yet.');
          let text = message.text;
          if (text === undefined) {
            const response = await fetch(message.url!);
            if (!response.ok) throw new Error(`Failed to fetch ${message.url}: ${response.status}`);
            text = await response.text();
          }
          sim.load_parameters(JSON.parse(text));
          post({ type: 'parameters', id: message.id, ok: true });
        } catch (error) {
          post({ type: 'parameters', id: message.id, ok: false, message: error instanceof Error ? error.message : String(error) });
        }
        break;
      }
      case 'pause':
        paused = message.value;
        if (!paused) reanchor_clock();
        break;
      case 'set_rate':
        rate = Math.max(0.01, message.value);
        reanchor_clock();
        break;
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) });
  }
};
