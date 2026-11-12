/**
 * Parity test of the Rhythm Generation (RG) circuit against a PyTorch golden trace written by
 * `python/rg_trace.py`. Drives the RG exactly as the trace did and compares every unit's state.
 *
 * Usage: tsx test/rg_trace.test.ts [data/rg_trace.json]
 */
import fs from 'node:fs';
import * as torch from '../src/torch';
import * as cc from '../src/circuits';
import { instantiate } from '../src/hydra';
import { REGISTRY } from '../src/registry';
import { TensorJson, state_dict_from_json } from '../src/io';
import { RhythmGenerationCircuit2 } from '../src/models/experimental';

const TOLERANCE = 1e-5;
const LIMBS = ['FL', 'FR', 'HL', 'HR'] as const;

interface Trace {
  timestep: number;
  rhythm_generation_config: unknown;
  overrides: { oscillator_noise: number };
  state_dict: Record<string, TensorJson>;
  parameter_names: string[];
  episodes: number;
  steps: number;
  inputs: { aff: number[], commands: number[] }[];
  trace: Record<string, number[]>;
  outputs: Record<string, number[][]>;
}

const path = process.argv[2] ?? 'data/rg_trace.json';
const golden: Trace = JSON.parse(fs.readFileSync(path, 'utf-8'));
let failures = 0;

function check(label: string, ok: boolean, detail: string = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
}

// Build the RG from its Hydra config, exactly as `QuadrupedModularActor` does.
const rg = instantiate(golden.rhythm_generation_config, REGISTRY) as RhythmGenerationCircuit2;
const sim = new cc.Simulator({ timestep: golden.timestep });
sim.rhythm_generation = rg;

// Structure: parameter names and state dict keys/shapes must match PyTorch's.
const names = [...rg.named_parameters()].map(([name]) => name);
check('named_parameters() matches', names.join() === golden.parameter_names.join(),
  `${names.length} vs ${golden.parameter_names.length}`);
const own = [...rg.state_dict()].map(([k, v]) => `${k}[${v.shape}]`);
const theirs = Object.entries(golden.state_dict).map(([k, v]) => `${k}[${v.shape}]`);
check('state_dict() keys/shapes match', own.join() === theirs.join(), `${own.length} vs ${theirs.length}`);
rg.load_state_dict(state_dict_from_json(golden.state_dict));

for (const unit of rg.modules()) {
  if (unit instanceof cc.Oscillator) unit.noise = golden.overrides.oscillator_noise;
}
sim.init();

// Run and compare.
const fields = Object.keys(golden.trace);
const stats = new Map(fields.map(f => [f, { max_error: 0, first_divergence: -1, exact: 0 }]));
const output_stats = { max_error: 0, first_divergence: -1 };
let step = 0;
for (let episode = 0; episode < golden.episodes; episode++) {
  sim.reset(null);
  rg.reset(null);
  for (let t = 0; t < golden.steps; t++, step++) {
    const { aff, commands } = golden.inputs[step];
    LIMBS.forEach((limb, i) => {
      (rg[`aff_flx_${limb}`] as cc.Signal).value.set_(aff[2 * i]);
      (rg[`aff_ext_${limb}`] as cc.Signal).value.set_(aff[2 * i + 1]);
    });
    rg.freq_L.value.set_(commands[0]);
    rg.sync_L.value.set_(commands[1]);
    rg.freq_R.value.set_(commands[2]);
    rg.sync_R.value.set_(commands[3]);
    sim.step();
    const output = rg.get_output();

    for (const field of fields) {
      const [unit, attr] = field.split('.');
      const actual = ((rg[unit] as Record<string, torch.Tensor>)[attr]).item();
      const expected = golden.trace[field][step];
      const error = Math.abs(actual - expected);
      const s = stats.get(field)!;
      if (error === 0) s.exact++;
      s.max_error = Math.max(s.max_error, error);
      if (error > TOLERANCE && s.first_divergence < 0) s.first_divergence = step;
    }
    for (const limb of LIMBS) {
      const actual = output.getitem(limb).tolist();
      const expected = golden.outputs[limb][step];
      for (let i = 0; i < expected.length; i++) {
        const error = Math.abs(actual[i] - expected[i]);
        output_stats.max_error = Math.max(output_stats.max_error, error);
        if (error > TOLERANCE && output_stats.first_divergence < 0) output_stats.first_divergence = step;
      }
    }
  }
}

const total = golden.episodes * golden.steps;
const worst = [...stats].sort((a, b) => b[1].max_error - a[1].max_error).slice(0, 5);
const exact = [...stats.values()].reduce((sum, s) => sum + s.exact, 0);
console.log(`\n${total} steps x ${fields.length} fields: ${(100 * exact / (total * fields.length)).toFixed(3)}% bit-exact`);
console.log('Worst fields:');
for (const [field, s] of worst) {
  console.log(`  ${field.padEnd(20)} max_error=${s.max_error.toExponential(2)} first_divergence=${s.first_divergence}`);
}
for (const [field, s] of stats) {
  if (s.max_error > TOLERANCE) {
    check(`trace ${field}`, false, `max_error=${s.max_error.toExponential(2)}, first divergence at step ${s.first_divergence}`);
  }
}
check('all traced fields within tolerance', [...stats.values()].every(s => s.max_error <= TOLERANCE),
  `tolerance=${TOLERANCE}`);
check('get_output() within tolerance', output_stats.max_error <= TOLERANCE,
  `max_error=${output_stats.max_error.toExponential(2)}, first divergence at step ${output_stats.first_divergence}`);

process.exit(failures ? 1 : 0);
