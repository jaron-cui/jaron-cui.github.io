/** Messages between the UI (main thread) and the simulation worker. */

export type ToWorker =
  | { type: 'init', checkpoint: string }
  | { type: 'set_target_vx', value: number }
  | { type: 'reset' }
  | { type: 'pause', value: boolean }
  /** Reset as soon as the rat falls over (terminates), instead of leaving it lying there. */
  | { type: 'set_auto_reset', value: boolean }
  /** Playback rate: simulated time per wall time (e.g. 0.1 = slow motion, 1 = real time). */
  | { type: 'set_rate', value: number }
  /** Swap in actor parameters (a `state_dict.json`), from a URL (preset) or file contents (upload). */
  | { type: 'load_parameters', id: string, url?: string, text?: string };

/** Static geometry for rendering (MuJoCo model fields), sent once. */
export interface Geoms {
  type: number[];  // mjtGeom per geom.
  size: number[];  // [ngeom * 3]
  rgba: number[];  // [ngeom * 4], material color if the geom has a material.
  group: number[];
  geom_bodyid: number[];
  /** Body tree, for renderers that rig the rat with bones (body 0 is the world). */
  body_parentid: number[];
  body_names: string[];
  /** Geom names ('' where unnamed). */
  geom_names?: string[];
}

export interface Stats {
  time: number;  // Simulated time since reset (s).
  target_vx: number;  // Commanded forward speed (m/s).
  speed: number;  // Forward speed along the rat's heading (m/s).
  heading: number;  // Yaw (rad).
  terminated: boolean;  // Fell over (roll/pitch > 45 deg or trunk contact) since reset.
  step_ms: number;  // Mean compute time per 30 ms control step (ms).
  realtime_factor: number;  // Simulated time / wall time over the last second.
  rate: number;  // Requested playback rate (realtime_factor falls short if compute can't keep up).
}

/**
 * Rhythm-generation activity: the units' outputs after each control step since the last frame,
 * [steps * units.length] in the order of `RG_UNITS`; `step` is the index (since reset) of the last.
 */
export interface Activity { values: Float32Array, steps: number, step: number }

/**
 * The rhythm-generation units sent with each frame, named as in the circuit diagram
 * (`graphed/ncap-circuit.graphed`); `bc` is the commanded speed. RG_SOURCES gives each one's name
 * in the circuit model.
 */
export const RG_UNITS: string[] = [];
export const RG_SOURCES: Record<string, string> = {};
for (const s of ['L', 'R']) {
  for (const limb of ['F' + s, 'H' + s]) {
    RG_SOURCES['flx_' + limb] = 'flx_' + limb;
    RG_SOURCES['ext_' + limb] = 'ext_' + limb;
    RG_SOURCES['cV3f_' + limb] = 'cross_v3f_' + limb;
    RG_SOURCES['cV0d_' + limb] = 'cross_v0d_' + limb;
    RG_SOURCES['cV3e_' + limb] = 'cross_v3e_' + limb;
  }
  RG_SOURCES['dV0d_F' + s] = 'diagd_v0d_F' + s;
  RG_SOURCES['dV0v_F' + s] = 'diagd_v0v_F' + s;
  RG_SOURCES['dIn2_F' + s] = 'diagd_in2_F' + s;
  RG_SOURCES['aV3a_H' + s] = 'diaga_v3a_H' + s;
  RG_SOURCES['freq_' + s] = 'freq_' + s;
  RG_SOURCES['sync_' + s] = 'sync_' + s;
}
RG_UNITS.push(...Object.keys(RG_SOURCES), 'bc');

export type FromWorker =
  | { type: 'ready', geoms: Geoms }
  /** `snap`: show this frame immediately instead of interpolating to it (e.g. after a reset). */
  | { type: 'frame', xpos: Float32Array, xmat: Float32Array, body_xpos: Float32Array, body_xmat: Float32Array, position: number[], stats: Stats, snap: boolean, activity: Activity }
  | { type: 'parameters', id: string, ok: true }
  | { type: 'parameters', id: string, ok: false, message: string }
  | { type: 'error', message: string };

/** What the app needs from a renderer: static geometry once, then a pose per simulation frame. */
export interface SceneRenderer {
  set_geoms(geoms: Geoms): void;
  /** Geom positions [ngeom*3], row-major rotations [ngeom*9], the rat's position (for the camera). */
  update(xpos: Float32Array, xmat: Float32Array, position: number[], snap?: boolean, body?: { xpos: Float32Array, xmat: Float32Array }): void;
  dispose(): void;
}
