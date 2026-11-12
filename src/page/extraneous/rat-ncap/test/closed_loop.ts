/**
 * Headless closed-loop check of the interactive simulation (actor + env on MuJoCo WASM): the rat
 * should track each commanded speed without falling, comparably to the training rollout, and
 * survive mid-episode command changes.
 *
 * Usage: tsx test/closed_loop.ts [data/1_4_flxext]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Simulation } from '../src/app/simulation';

const dir = process.argv[2] ?? 'data/1_4_flxext';
const sim = await Simulation.load(async name => new Uint8Array(fs.readFileSync(path.join(dir, name))));
const qvel_x = () => (sim.state.mjx_data.raw.qvel as Float64Array)[0];

// Reference: mean root x-velocity over steps 100-200 in the saved training rollout (10 specimens).
const REFERENCE: Record<string, number> = { '0.0': 0.000, '0.2': 0.193, '0.4': 0.382, '0.6': 0.445, '0.8': 0.676, '1.0': 1.035 };

console.log('Fixed commands (200 steps = 6 s each, from reset):');
let total_ms = 0, total_steps = 0;
for (const target of [0.0, 0.2, 0.4, 0.6, 0.8, 1.0]) {
  sim.set_target_vx(target);
  sim.reset();
  const vx: number[] = [];
  const start = performance.now();
  for (let t = 0; t < 200; t++) {
    sim.step();
    vx.push(qvel_x());
  }
  total_ms += performance.now() - start;
  total_steps += 200;
  const mean = vx.slice(100).reduce((a, b) => a + b, 0) / 100;
  const key = target.toFixed(1);
  console.log(
    `  target ${key} m/s: mean vx (steps 100-200) ${mean.toFixed(3)} (training rollout ${REFERENCE[key].toFixed(3)}), ` +
    `terminated ${sim.terminated}`,
  );
}
console.log(`  ${(total_ms / total_steps).toFixed(2)} ms per 30 ms control step (actor + 30 physics substeps)`);

console.log('Changing commands (one episode, 1200 steps = 36 s):');
sim.set_target_vx(0.0);
sim.reset();
const schedule = [0.0, 0.6, 1.0, 0.2, 0.8, 0.0];
for (const [i, target] of schedule.entries()) {
  sim.set_target_vx(target);
  const vx: number[] = [];
  for (let t = 0; t < 200; t++) {
    sim.step();
    vx.push(qvel_x());
  }
  const mean = vx.slice(100).reduce((a, b) => a + b, 0) / 100;
  console.log(`  segment ${i} (t=${(i * 6).toString().padStart(2)}-${(i + 1) * 6} s): target ${target.toFixed(1)} -> mean vx ${mean.toFixed(3)}, terminated ${sim.terminated}`);
}
