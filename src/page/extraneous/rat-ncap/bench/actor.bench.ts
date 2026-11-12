/**
 * Benchmarks actor inference time per control step, on the real observations of a saved rollout.
 *
 * The model is built the production way: from `python/export.py`'s files (config, state dict,
 * spaces). Each environment's observation sequence is replayed after `actor.reset(null)`, for
 * `--repeats` passes, after `--warmup` untimed passes. Also reports a per-module breakdown.
 *
 * Usage: tsx bench/actor.bench.ts [--export data/1_4_flxext] [--rollout data/rollout_trace.json]
 *          [--warmup 2] [--repeats 10]
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import * as torch from '../src/torch';
import * as collections from '../src/utils/collections';
import { instantiate } from '../src/hydra';
import { REGISTRY } from '../src/registry';
import { space_from_json, state_dict_from_json, tensors_from_json } from '../src/io';
import * as ncap from '../src/models/ncap';
import * as ttm from '../src/tonic/torch/models';

const { values: args } = parseArgs({
  options: {
    export: { type: 'string', default: 'data/1_4_flxext' },
    rollout: { type: 'string', default: 'data/rollout_trace.json' },
    warmup: { type: 'string', default: '2' },
    repeats: { type: 'string', default: '10' },
  },
});
const read = (path: string) => JSON.parse(fs.readFileSync(path, 'utf-8'));

// Build the model as production code would.
const config = read(`${args.export}/agent_config.json`);
const model = instantiate(config.model, REGISTRY) as ttm.ActorOnly<ncap.QuadrupedModularActor>;
model.initialize(
  space_from_json(read(`${args.export}/observation_space.json`)),
  space_from_json(read(`${args.export}/action_space.json`)),
);
model.load_state_dict(state_dict_from_json(read(`${args.export}/state_dict.json`)));
const actor = model.actor;

// Real observation sequences, converted to tensors up front so only inference is timed.
const rollout = read(args.rollout as string);
const episodes: collections.Dict<torch.Tensor>[][] = rollout.envs.map(
  (env: { observations: Record<string, number[]>[] }) => env.observations.map(o => tensors_from_json(o)),
);
const steps_per_pass = episodes.reduce((n, e) => n + e.length, 0);

// Per-module timing by wrapping each submodule's `forward` (and the simulator's `step`).
const module_time = new Map<string, number>();
function instrument(name: string, target: { [k: string]: any }, method: string) {
  const original = target[method].bind(target);
  target[method] = (...xs: unknown[]) => {
    const start = performance.now();
    const out = original(...xs);
    module_time.set(name, (module_time.get(name) ?? 0) + performance.now() - start);
    return out;
  };
}

function run_pass(times: number[] | null) {
  for (const episode of episodes) {
    actor.reset(null);
    for (const observation of episode) {
      const start = performance.now();
      actor.forward(observation);
      times?.push(performance.now() - start);
    }
  }
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
function summarize(label: string, times: number[]) {
  const sorted = [...times].sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(
    `${label}: mean ${mean.toFixed(3)} ms, median ${percentile(sorted, 0.5).toFixed(3)} ms, ` +
    `p5 ${percentile(sorted, 0.05).toFixed(3)} ms, p95 ${percentile(sorted, 0.95).toFixed(3)} ms, ` +
    `max ${sorted.at(-1)!.toFixed(3)} ms over ${times.length} steps`,
  );
  return { mean, median: percentile(sorted, 0.5) };
}

console.log(`Node ${process.version}; ${episodes.length} episodes x ${steps_per_pass / episodes.length} steps per pass`);
for (let i = 0; i < Number(args.warmup); i++) run_pass(null);

// 1. Uninstrumented per-step timing.
const times: number[] = [];
for (let i = 0; i < Number(args.repeats); i++) run_pass(times);
const { median } = summarize('actor.forward', times);
console.log(`  -> ${(1000 / median).toFixed(0)} steps/s; ${(100 * median / 30).toFixed(1)}% of the 30 ms control period`);

// 2. Per-module breakdown (instrumentation adds a little overhead).
instrument('observation_rectifier', actor.observation_rectifier!, 'forward');
instrument('afferent_feedback', actor.afferent_feedback, 'forward');
instrument('brainstem_command', actor.brainstem_command!, 'forward');
instrument('sim.step (rhythm generation)', actor.sim!, 'step');
instrument('pattern_formation', actor.pattern_formation, 'forward');
const instrumented: number[] = [];
for (let i = 0; i < Number(args.repeats); i++) run_pass(instrumented);
const total = instrumented.reduce((a, b) => a + b, 0);
console.log('Per-module share of instrumented step time:');
for (const [name, ms] of [...module_time].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(30)} ${(ms / instrumented.length).toFixed(3)} ms  ${(100 * ms / total).toFixed(1)}%`);
}
const accounted = [...module_time.values()].reduce((a, b) => a + b, 0);
console.log(`  ${'other (RG observer, glue)'.padEnd(30)} ${((total - accounted) / instrumented.length).toFixed(3)} ms  ${(100 * (total - accounted) / total).toFixed(1)}%`);
