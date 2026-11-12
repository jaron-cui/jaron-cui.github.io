# Porting Python code to the TypeScript port

The TypeScript port mirrors the Python file for file and line by line, so that each TypeScript file
can be read side by side with its original. This guide covers keeping it in sync (porting **changes**
to already-ported Python) and extending it (porting **new implementations**), and how to verify
both against PyTorch/JAX with golden data.

## Where things live

| Python | TypeScript |
|---|---|
| `libs/circuits/` | `src/circuits/` |
| `libs/utils/` | `src/utils/` |
| `libs/composer/` | `src/composer/` |
| `libs3/tonic/tonic/torch/models/` | `src/tonic/torch/models.ts` |
| `projects/rodent/models/ncap.py`, `experimental.py` | `src/models/ncap.ts`, `experimental.ts` |
| `projects/rodent/envs/` | `src/envs/` |
| `hydra.utils.instantiate` + `_target_` paths | `src/hydra.ts` + `src/registry.ts` |
| `torch`, `jax.numpy`, `gymnasium.spaces`, `mujoco`/`mjx` | stand-ins: `src/torch/`, `src/jax/numpy.ts`, `src/gymnasium.ts`, `src/mujoco/` |

Each ported file's header lists what is **not** ported (e.g. training-only code). TypeScript-only
code (no Python original): `src/envs/tasks/interactive_locomotion.ts`, `src/app/`, `app/`.

## Porting a change to already-ported Python

1. **Is it config-only?** New Hydra settings for existing classes (e.g. different weight overrides,
   segment lists, controller gains) need no code changes: re-export the job
   ([exporting.md](exporting.md)) and it runs.
2. **Find the counterpart** via the table above (same relative path, same class/function names), and
   apply the same edit, following the [translation conventions](#translation-conventions). Keep
   statement order and arithmetic grouping identical: float32 results depend on them.
3. **Is the changed code ported at all?** If the TypeScript file's header lists it as not ported
   (e.g. rewards, training-only initializers), nothing is needed unless the app now depends on it.
4. **Re-generate golden data and run the parity tests** that cover the change (see
   [Parity tests](#parity-tests)). Structure checks (parameter names, state-dict keys, layer reprs)
   flag architecture-level drift; value checks flag numerical drift.
5. **Search for stand-in gaps.** If the new Python uses a `torch`/`jnp`/MuJoCo feature the stand-ins
   lack, the TypeScript fails loudly (missing method or a `NotImplementedError`); add it to the
   stand-in with the original library's semantics (see [Extending the stand-ins](#extending-the-stand-ins)).

Typical examples:

| Python change | TypeScript change |
|---|---|
| New argument on an existing class (e.g. a new option in `PatternFormationNetwork`) | Add it to the TS constructor's keyword object with the same name and default, and port its use. |
| New/renamed module attribute (e.g. a new `torch.nn.Parameter`) | Same attribute name in TS: `state_dict()` keys must match the checkpoint. |
| New RG circuit wiring in `experimental.py` | Same `synapse(...)` calls in `experimental.ts`. |
| New body observation in `rat.py` | Port the getter and `observation`/`observation_space` changes; if it reads a new MuJoCo field, see [MuJoCo access](#mujoco-access). |
| New transform behavior in `composer/transforms.py` | Port it in `src/composer/transforms.ts`; if its spaces depend on run-time state, see [Spaces are cached](#spaces-are-cached). |

## Porting a new implementation

When a config uses a class or function that has no TypeScript port, loading fails with
`No TypeScript implementation registered for _target_ '<python.path>'`.

1. **Translate** the class/function into the mirrored TypeScript file (create it if needed), line by
   line per the conventions. Port only what runs at inference/simulation time; list anything left out
   in the file header.
2. **Register** it in `src/registry.ts` under its exact Python `_target_` path: classes with
   `cls(MyClass)`, functions (including `_partial_` targets) directly. Targets whose effects are
   baked into the checkpoint (initializers, constraints) are registered as explicit no-ops in
   `TRAINING_ONLY`, never silently skipped.
3. **Match the module structure** for PyTorch modules: assigning a `Parameter`/`Buffer`/`Module` to
   `this.x` registers it like `torch.nn.Module.__setattr__`, so use the same attribute names and
   assignment order as Python; the state-dict key checks in the tests will catch mismatches.
4. **Write a golden-data script and test** (see [Parity tests](#parity-tests)): a
   `python/<thing>_trace.py` that builds the real Python object from a checkpoint and records inputs,
   outputs, and structure (parameter names, reprs), and a `test/<thing>_trace.test.ts` that rebuilds it
   from the same config with `instantiate(..., REGISTRY)` and compares. Add it to `npm test`.

### New bodies or arenas

Build-time `MjSpec` construction (loading XML, adding actuators/sensors, setting contact modes,
attaching to the task) stays in Python. TypeScript only needs:
- **the compiled model**, which `python/export_env.py` already exports from the composed task;
- **spec mirrors** for every file an entity loads with `MjSpec.from_file`: `export_env.py` currently
  exports the `Rat` body's spec (keyed by `RAT_XML`); add other bodies there;
- **the run-time methods**: `initialize`, `action`/`action_space`, `observation`/`observation_space`,
  getters/setters, and reset helpers. Element lookups (`mj_spec.joint(name)`, `.actuators`, ...) work
  on the mirror; mutations of spec elements are build-time and are left out.

### MuJoCo access

`state.mjx_data.bind(state.mjx_model, elements).<field>` is implemented in `src/mujoco/mjx.ts`
(`Binding.compute_ranges`) for: joint `qpos`/`qvel`, tendon `length`/`velocity`, actuator
`force`/`ctrl` (and model `ctrlrange`), sensor `sensordata`, and body `xpos`/`xquat`/`xfrc_applied`.
For another field, add its index-range rule there (and to `DataArrays` if it is a new data array).
Reads return float32 tensors (MJX is float32); writes go into the single mutable WASM `MjData`.

## Parity tests

Golden data is produced from a real training job by the `python/*_trace.py` scripts and written to
`data/` (git-ignored); the TypeScript tests compare against it (`npm test`):

| Covers | Golden data | Test |
|---|---|---|
| `circuits`, RG circuit (`experimental.ts`), `init_rg_rat6` | `rg_trace.py` | `rg_trace.test.ts` |
| `utils/torch/block`, pattern formation, afferent feedback | `block_trace.py` | `block_trace.test.ts` |
| Whole actor (rectifier, BC, RG observer, ...) on synthetic observations | `actor_trace.py` | `actor_trace.test.ts` |
| Whole actor on a saved rollout (real observations and states) | `rollout_trace.py` | `rollout_trace.test.ts` |
| Body observation and controller/action pipelines, composer transforms, MuJoCo bindings | `env_trace.py` | `env_trace.test.ts` |
| Swapping parameters (app's parameter library) | (uses `data/app/1_4_flxext`) | `parameters.test.ts` |
| Closed loop with MuJoCo WASM physics (does it walk?) | (uses an export) | `closed_loop.ts` |

```bash
JOB=$OUTPUT_ROOT/7_prod/1_4_flxext/<run>/<job>; CK=$JOB/checkpoint; PY=$UV_PROJECT_ENVIRONMENT/bin/python
$PY python/export.py "$CK" data/1_4_flxext && $PY python/export_env.py "$CK" data/1_4_flxext
$PY python/rg_trace.py "$CK" data/rg_trace.json
$PY python/block_trace.py "$CK" data/block_trace.json
$PY python/actor_trace.py "$CK" data/actor_trace.json
$PY python/rollout_trace.py "$JOB" data/rollout_trace.json
$PY python/env_trace.py "$JOB" data/env_trace.json
npm run typecheck && npm test
```

Expect maximum errors around 1e-7 (a few float32 ulps; the tests use 1e-5). Oscillator noise is set
to 0 in golden data, since random streams can't match. A large error at a specific step usually
means an operation-order or semantics difference; the tests report the worst key (and the RG and
actor tests the first diverging step).

## Numerics and semantics pitfalls

These caused real bugs during the port:

- **Operation order.** Keep the Python grouping: `a * b / c` is `a.mul(b).div(c)`, not
  `a.mul(b.div(c))`. Python-float arithmetic (e.g. `(y2 - y1)` on constants) is float64; use the
  scalar-aware `torch.add/sub/mul/div`, which keep `number op number` as a `number`.
- **XLA boolean products.** JAX code `(mask) * expr` behaves like `where(mask, expr, 0)` (XLA
  simplifies it), so an `inf`/`NaN` in the masked-out branch does not propagate. The port uses
  `jnp.where` there (`composer/math.ts`); IEEE `0 * inf = NaN` gave wrong tactile observations.
- **Sorted containers.** `torch.nn.ParameterDict` and `gymnasium.spaces.Dict` sort the keys of a plain
  `dict` but not of an `OrderedDict`; the stand-ins replicate this with `collections.Dict` vs
  `OrderedDict`. Plain JS objects reorder integer-like keys, so they are never used as dicts.
- **Truthiness.** Python's empty containers are falsy; use `bool(x)` (`utils/builtins.ts`).
- **Python-only constructs** (lambdas, `functools.partial` activations) live in code, not config;
  they are hand-ported, not instantiated.

### Spaces are cached

Under `jax.jit`, Python computes observation/action spaces and validates values once, at trace
time. The port caches each entity's spaces after `entity_initialize`, validates once per entity, and
skips trailing stateless transforms in the discarded per-substep observations
(`src/composer/core.ts`). This assumes spaces only depend on state set during `initialize`, which
holds for every ported transform. A new transform whose spaces change at run time must invalidate
the cache (or the assumption must be revisited).

## Extending the stand-ins

`src/torch/`, `src/jax/numpy.ts`, `src/gymnasium.ts`, and `src/mujoco/` implement only what the
ported code uses, with the original libraries' semantics (float32 results, PyTorch type promotion,
broadcasting, `ParameterDict` ordering, etc.). When adding an operation, follow the original
library's documented behavior, including edge cases (NaN handling, scalar promotion), and keep
Python's names (`torch.clamp`, `jnp.where`, ...). After stand-in changes, run the full `npm test`:
every parity test exercises them.

## Translation conventions

- **Names are kept from Python**, including snake_case (`active_bound_zero`, `observation_segments`),
  so files diff cleanly against their originals. Comments and docstrings are carried over.
- **Keyword arguments** become a trailing object: `f(x, *, base=2)` -> `f(x, {base = 2} = {})`, and
  `Cls(a=1, **kwargs)` -> `new Cls({a = 1, ...kwargs})`. `functools.partial(f, k=v)` ->
  `functools.partial(f, {k: v})` (`src/utils/functools.ts`).
- **Operators**: tensor-first operations are methods (`a + b` -> `a.add(b)`, `a > 0` -> `a.gt(0)`,
  `a & b` -> `a.and(b)`, `~a` -> `a.not()`); scalar-first ones use `torch.add/sub/mul/div`
  (`1 - z` -> `torch.sub(1, z)`). Evaluation order and grouping follow the Python exactly, since
  float32 rounding depends on it.
- **In-place assignment** `x[:] = y` -> `x.set_(y)`. `None` -> `null`. `x @ y` -> `x.matmul(y)`.
- **Dicts**: Python `dict`/`OrderedDict` -> `collections.Dict`/`OrderedDict` (also used for tensor
  dicts and for untargeted mappings in Hydra configs). `d[k]` -> `d.getitem(k)` (throws `KeyError`),
  `d[k] = v` -> `d.setitem(k, v)`, `k in d` -> `d.has(k)`, `d.get(k, default)` is unchanged, and
  iteration yields keys. Constructors also accept plain objects (coerced with `collections.dict`).
  Plain objects are not used as dicts, since they reorder integer-like keys.
- **Truthiness**: where Python relies on empty containers being falsy (`if mapping:`), use
  `bool(x)` from `utils/builtins.ts`; JavaScript objects and arrays are always truthy.
- **Modules**: assigning a `Parameter`, `Buffer`, or `Module` to `this.x` registers it, like
  `torch.nn.Module.__setattr__`, so `state_dict()` keys match PyTorch. `ModuleDict` item access
  `self[name]` is property access `this[name]`. Calling a module `m(x)` -> `m.forward(x)`.
- **Ordering**: like PyTorch and gymnasium, `torch.nn.ParameterDict` and `gymnasium.spaces.Dict`
  sort the keys of a plain `Dict` but keep the order of an `OrderedDict` (or list of pairs).
- **Numerics**: float32 results are rounded to float32 on every operation; Python-float arithmetic
  stays float64. Random streams cannot match PyTorch's; parity tests set noise to 0.
- **JAX code** (composer, envs) uses `src/jax/numpy.ts` as `jnp` on the same tensors;
  `x.at[i].set(v)` -> `jnp.at(x, i).set(v)`, `x[idx]` -> `jnp.take(x, idx)`. Local states keep
  `state.replace(...)`/`state.local.set(index, value)`. Build-time `MjSpec` edits are not ported:
  Python exports the compiled model (`python/export_env.py`), and `mj.MjSpec` is a read-only mirror.
