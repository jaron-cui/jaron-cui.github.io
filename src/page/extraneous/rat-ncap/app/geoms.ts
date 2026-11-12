/** The rat's static geometry for renderers, read from the loaded MuJoCo model. */
import * as mj from '../src/mujoco';
import type { Geoms } from './protocol';

export function readGeoms(): Geoms {
  const m = mj.assets().model;
  const n = m.ngeom;
  const rgba: number[] = [];
  for (let i = 0; i < n; i++) {
    const mat = m.geom_matid[i];
    const source = mat >= 0 ? m.mat_rgba : m.geom_rgba;
    const offset = 4 * (mat >= 0 ? mat : i);
    for (let k = 0; k < 4; k++) rgba.push(source[offset + k]);
  }
  return {
    type: Array.from(m.geom_type as ArrayLike<number>),
    size: Array.from(m.geom_size as ArrayLike<number>),
    rgba,
    group: Array.from(m.geom_group as ArrayLike<number>),
    geom_bodyid: Array.from(m.geom_bodyid as ArrayLike<number>),
    body_parentid: Array.from(m.body_parentid as ArrayLike<number>),
    body_names: Array.from({ length: m.nbody }, (_, i) => mj.mujoco().mj_id2name(m, mj.mjtObj.mjOBJ_BODY, i) ?? `body${i}`),
    geom_names: Array.from({ length: n }, (_, i) => mj.mujoco().mj_id2name(m, mj.mjtObj.mjOBJ_GEOM, i) ?? ''),
  };
}
