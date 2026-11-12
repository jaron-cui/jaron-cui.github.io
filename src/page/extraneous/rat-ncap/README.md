# NCAP TypeScript port

An inference-only TypeScript port of the NCAP actor (`model.actor`) and the run-time parts of its
training environment, written as a close, line-by-line translation of the Python so that each file
can be read side by side with its original. Architectures are instantiated at run time from a
checkpoint's exported Hydra configs by a mini-Hydra (`src/hydra.ts`), weights come from the exported
`state_dict`, and physics runs on the official MuJoCo WASM build. The interactive app (`app/`) runs a
trained rat entirely in the browser, with sliders for speed and playback rate and a library of
parameters to swap mid-run.

## Guides

- [Running the app](docs/app.md): launching (including from VSCode on the HPC), controls, troubleshooting.
- [Loading trained runs](docs/exporting.md): exporting a job/epoch (`python/export_job.py`), converting
  checkpoints and configs, compatibility.
- [Porting Python code](docs/porting.md): porting changes and new implementations, translation
  conventions, parity tests, pitfalls.
- [PLAN.md](PLAN.md): status, measurements, next steps, and gotchas.

## Quick start

```bash
cd ~/ncap-quadruped-dev && source projects/rodent/.env/initialize.sh && cd web
npm install

# Export a training job (architecture, body, parameters) for the app.
JOB=$OUTPUT_ROOT/7_prod/1_4_flxext/<run>/<job>   # The directory containing `checkpoint/`.
CUDA_VISIBLE_DEVICES= JAX_PLATFORMS=cpu $UV_PROJECT_ENVIRONMENT/bin/python python/export_job.py "$JOB" --name 1_4_flxext

npm run dev   # Then open http://localhost:5173 (VSCode forwards the port).
```

Using the port from code:

```ts
const model = instantiate(agent_config.model, REGISTRY) as ActorOnly<QuadrupedModularActor>;
model.initialize(space_from_json(observation_space), space_from_json(action_space));
model.load_state_dict(state_dict_from_json(state_dict));
model.actor.reset(null);                          // At the start of every episode.
const action = model.actor.forward(observation);  // Every control step (30 ms).
```

or, with the environment, `src/app/simulation.ts` (`Simulation.load`, `set_target_vx`, `step`,
`reset`, `load_parameters`).

## Layout

| Path | Contents |
|---|---|
| `src/circuits/`, `src/utils/`, `src/composer/`, `src/tonic/`, `src/models/`, `src/envs/` | Ports of `libs/circuits`, `libs/utils`, `libs/composer`, `libs3/tonic`, `projects/rodent/models`, `projects/rodent/envs` (see [porting.md](docs/porting.md#where-things-live)) |
| `src/torch/`, `src/jax/numpy.ts`, `src/gymnasium.ts`, `src/mujoco/` | Stand-ins for `torch`, `jax.numpy`, `gymnasium.spaces`, `mujoco`/`mjx` (MuJoCo WASM) |
| `src/hydra.ts`, `src/registry.ts` | Mini-Hydra and its `_target_` registry |
| `src/io.ts` | Loaders for exported JSON |
| `src/envs/tasks/interactive_locomotion.ts`, `src/app/simulation.ts` | Interactive task and actor + env runtime (TypeScript-only) |
| `app/` | React + three.js app; simulation in a Web Worker |
| `python/` | Export and golden-data scripts (rodent `uv` env) |
| `test/` | Parity tests against PyTorch/JAX golden data, closed-loop check |
| `bench/` | Inference benchmark and PyTorch baseline |
| `docs/` | Guides |
| `data/` | Exports and golden data (git-ignored); `data/app/` is served by the app |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` / `build` / `preview` | App dev server / static build to `dist/` / serve the build |
| `npm run typecheck` | Type-check the library, tests, and app |
| `npm test` | All parity tests (needs golden data; see [porting.md](docs/porting.md#parity-tests)) |
| `npm run test:parameters` | Parameter swapping on `data/app/1_4_flxext` |
| `npm run check:closed-loop` | Headless walking check with MuJoCo WASM |
| `npm run bench` | Actor inference benchmark |

## Homepage demo loop

The site's homepage demo (`RatDemo.tsx`) plays a cached loop of walking and circuit activity until
a visitor touches a control, and only then starts MuJoCo. The loop lives at
`public/rat-ncap/1_4_flxext/demo-loop.json` (site root) and is made from the checkpoint by:

```sh
npm run demo-loop        # from the site root; runs scripts/make_demo_loop.ts
```

**Rerun it whenever the model, body, or parameters change** (a new checkpoint in `public/rat-ncap/`),
or the cached loop will show the old rat and circuit until someone touches a control.

