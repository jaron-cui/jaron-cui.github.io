/**
 * Tests swapping actor parameters mid-run (`Simulation.load_parameters`, used by the app's parameter
 * library): presets load and change behavior, and incompatible files are rejected atomically.
 *
 * Usage: tsx test/parameters.test.ts [data/app/1_4_flxext]
 */
import fs from 'node:fs';
import path from 'node:path';
import { Simulation } from '../src/app/simulation';
import { check, exit } from './util';

const dir = process.argv[2] ?? 'data/app/1_4_flxext';
const read_json = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
const sim = await Simulation.load(async name => new Uint8Array(fs.readFileSync(path.join(dir, name))));
const snapshot = () => [...sim.model.state_dict()].map(([k, v]) => `${k}:${v.tolist().join(',')}`).join('|');

/** Mean speed along the heading over `steps` control steps. */
function run(steps: number): number {
  let total = 0;
  for (let t = 0; t < steps; t++) {
    sim.step();
    total += sim.speed;
  }
  return total / steps;
}

sim.set_target_vx(0.8);
sim.reset();
const trained = run(150);
check('trained (exported) parameters walk at 0.8 m/s', trained > 0.5, `mean speed ${trained.toFixed(2)} m/s`);

// Swap to the untrained initialization mid-run, then back.
const index: { epoch: string, file: string }[] = read_json('params/index.json');
const epoch0 = index.find(p => p.epoch === '0')!;
sim.load_parameters(read_json(epoch0.file));
const untrained = run(150);
check('swapping to epoch 0 mid-run changes behavior', Math.abs(untrained - trained) > 0.1, `mean speed ${untrained.toFixed(2)} m/s`);
sim.load_parameters(read_json('state_dict.json'));
sim.reset();
const restored = run(150);
check('swapping back to the exported parameters restores the gait', Math.abs(restored - trained) < 0.15, `mean speed ${restored.toFixed(2)} m/s`);

// Incompatible files are rejected without changing the model.
const before = snapshot();
const truncated = read_json('state_dict.json');
delete truncated[Object.keys(truncated)[0]];
const reshaped = read_json('state_dict.json');
const key = Object.keys(reshaped).find(k => reshaped[k].data.length > 1)!;
reshaped[key] = { ...reshaped[key], shape: [reshaped[key].data.length - 1], data: reshaped[key].data.slice(1) };
for (const [label, json] of [['missing key', truncated], ['wrong shape', reshaped], ['not a state dict', read_json('agent_config.json')]] as const) {
  let error = '';
  try { sim.load_parameters(json); } catch (e) { error = (e as Error).message; }
  check(`rejects ${label}`, /do not match this model's architecture|Not a parameters file/.test(error), error.slice(0, 120));
}
check('rejected files leave the model unchanged', snapshot() === before);

exit();
