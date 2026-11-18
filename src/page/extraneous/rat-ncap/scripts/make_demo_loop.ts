/**
 * Records the cached loop the homepage demo plays until a visitor touches a control (so the page
 * does not start MuJoCo on every visit): a stretch of steady walking at the demo's default speed,
 * with each control step's body poses and rhythm-generation activity.
 *
 * The loop is cut where the rat's posture and circuit state best repeat. Playback stitches the
 * copies end to end with a rigid move in the ground plane (`wrap`), so the rat keeps walking.
 *
 * Rerun whenever the model, body, or parameters change (the checkpoint in public/rat-ncap):
 *   npm run demo-loop
 * Usage: tsx make_demo_loop.ts [checkpoint dir] [speed m/s]
 */
import fs from 'node:fs';
import path from 'node:path';
import loadMujoco from '@mujoco/mujoco';
import { Rat } from '../app/rat';
import { RG_SOURCES, RG_UNITS } from '../app/protocol';
import { quaternionFromRows } from '../app/slenderRenderer';

const dir = process.argv[2] ?? 'public/rat-ncap/generic12';
const speed = Number(process.argv[3] ?? 0.4);
const PARAMS = 'params/params_2500';  // As the live demo starts with (worker.ts).
const WARMUP = 200;  // Steps (6 s) to settle into a steady gait.
const RECORD = 260;  // Steps to search for a loop in.
const MIN_LOOP = 60;  // Shortest loop (steps).

const sim = await Rat.load(async name => new Uint8Array(fs.readFileSync(path.join(dir, name))), await loadMujoco(), PARAMS);
sim.target_vx = speed;
sim.reset();
for (let i = 0; i < WARMUP; i++) sim.step();
if (sim.terminated) throw new Error('The rat fell over while warming up; try another speed.');

const geoms = sim.geoms();
const nbody = geoms.body_names.length;
const ROOT = 1;  // The torso, the first body under the world.
const names = RG_UNITS.filter(u => u !== 'bc').map(u => RG_SOURCES[u]);
// Geom poses are kept too: the renderer builds its rig from geoms and bodies at the same moment.
type Pose = Float32Array | Float64Array;
type Frame = { pos: Pose; rows: Pose; activity: number[]; geoms: { xpos: Pose; xmat: Pose } };
const frames: Frame[] = [];
for (let i = 0; i < RECORD; i++) {
  sim.step();
  if (sim.terminated) throw new Error(`The rat fell over at recorded step ${i}.`);
  const body = sim.body_poses();
  frames.push({ pos: body.xpos, rows: body.xmat, activity: [...sim.rhythm_outputs(names), sim.target_vx], geoms: sim.geom_poses() });
}

const heading = (f: Frame) => Math.atan2(f.rows[9 * ROOT + 3], f.rows[9 * ROOT]);
// The pose relative to the root, seen from the rat's own heading, and the circuit state.
function signature(f: Frame): number[] {
  const h = heading(f);
  const [c, s] = [Math.cos(-h), Math.sin(-h)];
  const out: number[] = [];
  for (let b = 1; b < nbody; b++) {
    const dx = f.pos[3 * b] - f.pos[3 * ROOT];
    const dy = f.pos[3 * b + 1] - f.pos[3 * ROOT + 1];
    out.push(1000 * (c * dx - s * dy), 1000 * (s * dx + c * dy), 1000 * f.pos[3 * b + 2]);
  }
  return out.concat(f.activity.map(v => 40 * v));
}
const signatures = frames.map(signature);
const distance = (a: number[], b: number[]) => Math.sqrt(a.reduce((sum, v, i) => sum + (v - b[i]) ** 2, 0) / a.length);
let best = { start: 0, end: MIN_LOOP, score: Infinity };
for (let start = 0; start < RECORD - MIN_LOOP; start++) {
  for (let end = start + MIN_LOOP; end < RECORD; end++) {
    const score = distance(signatures[start], signatures[end]);
    if (score < best.score) best = { start, end, score };
  }
}
const loop = frames.slice(best.start, best.end);
const first = frames[best.start];
const next = frames[best.end];
// The move that takes the first frame's root to the frame after the loop: rotate, then shift.
const turn = heading(next) - heading(first);
const [c, s] = [Math.cos(turn), Math.sin(turn)];
const wrap = {
  turn,
  dx: next.pos[3 * ROOT] - (c * first.pos[3 * ROOT] - s * first.pos[3 * ROOT + 1]),
  dy: next.pos[3 * ROOT + 1] - (s * first.pos[3 * ROOT] + c * first.pos[3 * ROOT + 1]),
};

const pack = (values: number[]) => Buffer.from(new Float32Array(values).buffer).toString('base64');
const poses: number[] = [];
for (const f of loop) {
  for (let b = 0; b < nbody; b++) {
    poses.push(f.pos[3 * b], f.pos[3 * b + 1], f.pos[3 * b + 2], ...quaternionFromRows(f.rows, 9 * b));
  }
}
const out = {
  about: 'Cached homepage demo loop; regenerate with `npm run demo-loop` when the model, body, or parameters change.',
  speed,
  steps: loop.length,
  nbody,
  units: RG_UNITS,
  wrap,
  geoms,
  // The geoms' world poses at the loop's first step (for building the rig).
  geomPose: { xpos: pack(Array.from(first.geoms.xpos)), xmat: pack(Array.from(first.geoms.xmat)) },
  // Per step: every body's position (m) and rotation quaternion (w, x, y, z).
  poses: pack(poses),
  // Per step: RG_UNITS' activity.
  activity: pack(loop.flatMap(f => f.activity)),
};
const file = path.join(dir, 'demo-loop.json');
fs.writeFileSync(file, JSON.stringify(out));
console.log(`Loop of ${loop.length} steps (${(loop.length * 0.03).toFixed(2)} s) from recorded step ${best.start}; seam mismatch ${best.score.toFixed(2)}; wrap turn ${(turn * 180 / Math.PI).toFixed(1)} deg, shift ${(1000 * Math.hypot(wrap.dx, wrap.dy)).toFixed(0)} mm; ${(fs.statSync(file).size / 1024).toFixed(0)} KB written to ${file}`);
