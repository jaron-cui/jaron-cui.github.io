# Plan

Goal: run inference of `model.actor` from `projects/rodent/train/configs/1_prod/1_4_flxext.yaml`
(critic excluded) in TypeScript, as a readable translation of the Python, with variants built at
runtime from exported Hydra configs.

Reference checkpoint: `$OUTPUT_ROOT/7_prod/1_4_flxext/2026-0924-161102-figure-placeholder-localaf:furry-rabbits/18455968_1:model.pattern_formation.select_weight_id_override=local_af,seed=2/checkpoint`.

## Approach

1. `python/export.py` writes the checkpoint's resolved `agent_config`, `state_dict`, and
   observation/action spaces to JSON.
2. `hydra.instantiate(config.model, REGISTRY)` builds the TypeScript model; `initialize(obs_space,
   act_space)` runs the same construction logic as Python (weight-ID resolution etc.);
   `load_state_dict` loads the weights. Matching `state_dict()` keys double as a structure check.
3. Each module is verified against a PyTorch golden trace with noise disabled.

## Status

- [x] **M1: `circuits` + RG.** `torch` shim, `circuits` (Signal, Basic, Adaptor, Oscillator,
  Connector, Simulator, Group), `DelayBuffer`, `ParameterManager`, glob helpers, `GlobDict`,
  `RhythmGenerationCircuit2`, `init_rg_rat6`, mini-Hydra. Parity (`npm run test:rg`): 33/33
  parameter names and 131/131 state-dict keys match; 2400 steps x 92 fields, 98.3% bit-exact,
  max error 4.8e-7, no phase-switch divergence.
- [x] **M2: block layers + PF/AF.** `utils/torch/block.py` (`BlockScaleShift`, `BlockLinear`,
  `SparseBlockLinear`, weight-ID parsing, shared-weight creation, label collation, reprs),
  `BodyPlan`, `DictModule`, `PatternFormationNetwork`, `AfferentFeedbackNetwork`, plus
  `gymnasium.spaces`/`cxg.Box` stand-ins and Python `dict` semantics (`collections.Dict`).
  `block_initializer`/`models.constrain` are registered as explicit training-only no-ops. Parity
  (`npm run test:block`, inputs captured from the real actor's `initialize`): all four layer reprs
  (resolved weight-ID grids) match exactly; AF 48/48 and PF 47/47 parameter names and state-dict
  keys match; over 64 random samples, AF sensor 100% bit-exact, AF reset max error 1.5e-8, PF
  actions max error 2.4e-7.
- [x] **M3: actor.** `ncap_es`, `QuadrupedModularActor`, `ObservationRectifier`,
  `BrainstemCommandNetwork` (+ tonic `ActorOnly`/`DeterministicPolicyHead`, `init_bc_fixed`,
  `init_zeros`), `RhythmGenerationCircuitObserver`, `Constrainer`; shim `Linear`, `Sequential`,
  `ModuleDict`, `ParameterList`, PyTorch-style `_load_from_state_dict`. The `Constrainer` is a
  no-op at inference and consumes/ignores its 108 checkpoint keys (36 `params` aliasing other
  parameters, 36 `mins`, 36 `maxes`), so `load_state_dict` stays strict for everything else.
  Parity (`npm run test:actor`): 130/130 parameter names and 228/228 state-dict keys match
  (excluding the constrainer); 6 episodes x 200 steps (one per training speed) on synthetic
  random-walk observations: actions max error 3.6e-7 (83.9% bit-exact), RG outputs max error
  2.4e-7, no divergence.
- [x] **M4: real-rollout parity.** `python/rollout_trace.py` reads a training job's saved test
  rollout (`<job>/rollout/{params,buffers,steps,actions}/<epoch>`: per-env parameters, the full
  actor state `h[t]` every step, observations, and the actions taken), takes the architecture from
  the checkpoint config, and replays one specimen's 6 environments (one per speed) with noise off.
  Parity (`npm run test:rollout`): 130/130 parameter names and 196/196 buffer names match the
  rollout; `reset()` reproduces the recorded `h[0]` bit-exactly; replay from `h[0]` over real
  observations max error 4.2e-7; one step from every recorded `h[t]` max error 2.4e-7. Against the
  actions actually recorded (with noise), TypeScript matches exactly as well as PyTorch (57.7%
  bit-exact; mean error ~3e-4, max 0.46 where noise shifted a phase switch).
- [x] **M5: environment + interactive app.** Run-time port of the env from the checkpoint's
  `env_config.yaml`: `composer` (`core`, `mjx_env` single-env, `transforms`: Clip/Rescale/Reduce/
  Override/PD/SpringMuscle, `math`), `envs` (`Rat`, `Floor`), `jax.numpy`/`mujoco`/`mjx` stand-ins on
  MuJoCo WASM 3.12.0 (same version as training). Build-time spec edits stay in Python:
  `python/export_env.py` exports the compiled model (`.mjb`) and spec mirrors. New TS-only task
  `InteractiveLocomotion` (keeps body/arena/`target_vx` observation/reset pose/termination; drops
  subtasks, rewards, warmup, zero-gain harness), with `set_target_vx` for a slider.
  Parity (`npm run test:env`, 6 envs x 200 recorded states, no physics): observations max error
  6e-8; one substep of `entity_action` (controllers) vs Python max error 1.2e-7; spring-muscle
  parameters match. Closed loop (`npm run check:closed-loop`, WASM physics, from reset): mean vx at
  0/0.2/0.4/0.6/0.8/1.0 m/s = 0.00/0.17/0.23/0.48/0.67/1.03 vs training rollout
  0.00/0.19/0.38/0.45/0.68/1.04, no falls; survives 36 s of command changes.
  App (`app/`, `npm run dev`): React + three.js, simulation in a Web Worker, slider/reset/pause.
  Step cost (Node, loaded node): ~23 ms per 30 ms step (physics ~13%, rest is env-layer shim
  overhead); load ~0.25 s.
- [x] **M5b: workflow + app features.** `python/export_job.py` (job + epoch -> everything the app
  needs, plus all saved epochs as parameter presets and a manifest), `pt_to_json.py`,
  `yaml_to_json.py`. App: parameter library (export's own parameters, epoch presets, uploads;
  click to swap mid-run, validated atomically against the architecture; ~120 kB per file),
  playback-speed slider (0.05x-2x) with interpolated rendering. `npm run test:parameters`: swapping
  to epoch 0 mid-run stops the gait (0.68 -> 0.01 m/s), swapping back restores it, incompatible
  files are rejected without changing the model. Guides in `docs/` (app, exporting, porting).
- [ ] **M6: next.**
  - Verify in real browsers (only built/served and loaded over HTTP in Node here; headless Chromium
    lacks system libraries on the HPC). Watch the real-time factor.
  - Speed: the env layer runs the shim's tiny-array ops 30x per step; options are a faster shim
    path for small arrays or hand-fusing the controller transforms.
  - Physics gap: one-step MJX-vs-WASM comparison from recorded states (restore `h[t]`/data, step,
    compare to `s[t+1]`); likely explains 0.4 m/s tracking 0.23 vs 0.38.
  - Rendering: the rat's skin (`rat1.1.skn`, ~15k vertices on bones) instead of primitives.
  - Heading: the policy has no heading feedback, so the rat's yaw drifts (e.g. 120 deg after a few
    seconds of walking); the app reports speed along heading. A steering command would need
    training changes.
- [ ] **M7: hardening.** Reject unknown constructor kwargs in non-`Node` classes (TypeScript objects
  silently drop them, unlike Python's `TypeError`).
- [ ] **Upstream: `PatternFormationNetwork` split (2026-10-13).** In
  `projects/rodent/models/ncap.py`, `PatternFormationNetwork` was replaced by
  `LinearPatternFormationNetwork` (1-layer: select only) and `SynergyPatternFormationNetwork`
  (2-layer: select -> synergy). No shared base class. The synergy class then got named synergies:
  `synergies` (name -> {action prefix: weight ID}), `segment_synergies` (synergy segment -> names,
  repeats allowed), and no `synergy_weight_id_override`; the select output is split per index
  (`{segment}/{i}` keys) before the synergy layer, and synergy weights are now one column per
  synergy, so state-dict keys changed. Then, in all three PF/AF classes, `observation_segments`,
  `observation_segments_override`, and the `observation_prefixes` list were replaced by an
  `observation_prefixes` mapping (segment -> prefixes), with keys still enumerated prefix-first.
  `BrainstemCommandNetwork`/`BrainstemCommandSignal.initialize(observation_space)` now return a
  command space and `forward` returns a dict (`{'speed': [1]}`; `command_size` -> `commands`); the
  actor writes `speed` to all four RG signals and passes it to the PF as `speed_bc` (sagittal
  segment `bc`, group `BCs`). Separately, `libs/utils/torch/block.py` reprs changed:
  `BlockLinear` puts output keys first and BIAS second, `SparseBlockLinear` renders one
  `BlockLinear`-style grid per block (stacked, blank-line separated), and `format_block_table(*tables)`
  shares column widths across stacked tables. Port to `src/utils/torch/block.ts` so the repr checks
  in `test/block_trace.test.ts` pass again. Still to port: split the TS class in `src/models/ncap.ts`, update `src/registry.ts`,
  `test/block_trace.test.ts`, `docs/porting.md`, and `python/block_trace.py` (which patches
  `models.PatternFormationNetwork.initialize` and type-annotates with it). Older exported configs
  still name `models.PatternFormationNetwork`; re-export them or map that name to the synergy class.

## Gotchas

- **Noise.** `init_rg_rat6` hard-codes Oscillator `noise=0.02` (`torch.randn`). Parity tests set it
  to 0; production uses the shim's own seeded generator (same distribution, different stream).
- **Float32 parity.** `Oscillator.step` branches on thresholds and an exact `a == active_bound`, so
  operation order and float32 rounding must match Python; keep translations literal.
- **Glob semantics.** `GlobDict`/`select_by_glob_range` use raw `fnmatch` (so `[<-]` is a character
  class), while `in_glob_range` first expands `[a-b]`/`{x,y}` ranges. Both are ported as-is.
- **Key order.** `BrainstemCommandNetwork.forward` concatenates in observation-dict order, and
  `ObservationRectifier` inserts new keys; keep insertion order identical to Python. JS objects put
  integer-like keys first, so use `Map`s for ordered dicts.
- **Sorted containers.** PyTorch's `ParameterDict` and gymnasium's `Dict` sort the keys of a plain
  `dict` (but not an `OrderedDict`); this is why checkpoint `weights.*` keys are alphabetical.
  The stand-ins replicate it, keyed on `collections.Dict` vs `OrderedDict`.
- **Non-finite values.** The state dict holds `±inf` (`Constrainer` bounds); `export.py` writes
  non-finite floats as `'inf'`/`'-inf'`/`'nan'` strings, decoded by `io.ts`.
- **Matmul precision.** The shim accumulates dot products in float64 and rounds once, while PyTorch
  uses float32 BLAS; expect differences of a few ulps after each linear layer.
- **Rollout vs checkpoint parameters.** A job's saved test rollout at epoch X does not use the
  checkpoint's epoch-X parameters exactly (max difference ~0.07), so rollout tests load the
  rollout's own parameters rather than the checkpoint's.
- **Signals survive resets.** As in Python, `Simulator.reset` only resets `Unit`s; plain input
  `Signal`s (`aff_*`, `freq_*`, `sync_*`) keep their last values. This is harmless because the actor
  writes them before the circuit reads them, but it means state comparisons right after `reset()`
  must be made on a fresh actor.
- **XLA bool products.** JAX code like `(x < x2) * expr` behaves as `where(x < x2, expr, 0)` under
  XLA (no `0 * inf = NaN`); the port uses `jnp.where` (see `composer/math.ts`). Found via tactile
  observations, where a degenerate rescale branch is `inf`.
- **Traced-once work.** Python recomputes spaces and validates actions/observations on every call,
  but under `jax.jit` only at trace time. The port caches spaces after `entity_initialize`,
  validates once per entity, and skips trailing stateless transforms in the discarded per-substep
  observations; results are identical (checked by the parity tests).
- **Policy limits.** Trained on 6 s episodes at fixed speeds 0-1 m/s from reset; mid-episode speed
  changes, long runs, and speeds > 1 are untested by training (the app allows them, with notes).
- **Python-only constructs** live in code, not config (e.g. the `ext2_*` lambda activation and
  `functools.partial` activations in the RG), so they are hand-ported, not instantiated.
- **Config bug (outside `web/`).** `1_prod/1_4_flxext.yaml` defaults reference `/7_prod/0_base`,
  but the directory is `1_prod`.
