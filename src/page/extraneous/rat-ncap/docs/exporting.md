# Loading trained runs

Training jobs are exported by Python scripts (run in the rodent `uv` environment) into JSON files and
a compiled MuJoCo model, which the TypeScript side (and the app) loads. Set up the environment first:

```bash
cd ~/ncap-quadruped-dev && source projects/rodent/.env/initialize.sh && cd web
PY=$UV_PROJECT_ENVIRONMENT/bin/python
```

On CPU-only nodes, JAX prints CUDA plugin errors when the scripts import the environment code; they
are harmless (prefix commands with `CUDA_VISIBLE_DEVICES= JAX_PLATFORMS=cpu` to quiet them).

## All-in-one: `export_job.py`

Given a training **job directory** (the one containing `checkpoint/`, e.g.
`$OUTPUT_ROOT/7_prod/1_4_flxext/<run>/<job>`) and an epoch:

```bash
$PY python/export_job.py "$JOB" --epoch 1800        # or --epoch last (default)
```

This writes `web/data/app/<name>/`, which the app serves at `?checkpoint=/<name>`:

| File | Contents | Size |
|---|---|---|
| `agent_config.json` | Agent Hydra config (architecture), interpolations resolved | 8 kB |
| `state_dict.json` | Trained parameters at `--epoch` | 120 kB |
| `observation_space.json`, `action_space.json` | Spaces the model is initialized with | 7 kB |
| `env_config.json` | Environment Hydra config (body, arena, controllers, timesteps) | 5 kB |
| `model.mjb` | Compiled MuJoCo model (all build-time spec edits baked in) | 9.5 MB |
| `specs.json` | Read-only mirrors of the spec elements run-time code looks up | 15 kB |
| `params/<epoch>.json`, `params/index.json` | Parameters of other saved epochs: presets in the app's parameter list | 120 kB each |
| `manifest.json` | Source job, epoch, MuJoCo version, export time | <1 kB |

Options:
- `--name NAME`: export name (default derived from the run and job, e.g.
  `furry-rabbits_18455968_1_elast`).
- `--out-dir DIR`: write elsewhere (e.g. for tests).
- `--params-epochs all|none|100,500,last`: which epochs to include as presets (default `all`).

The script lists the available epochs if the requested one doesn't exist.

## Individual conversions

| Script | Converts |
|---|---|
| `python/pt_to_json.py <checkpoint.pt> <out.json>` | A checkpoint `.pt` (model state dict) into a parameters JSON: `{key: {shape, dtype, data}}`, with non-finite floats as `'inf'`/`'-inf'`/`'nan'` (strict JSON has no Infinity). This is the format the app's **Upload...** accepts. |
| `python/yaml_to_json.py <config.yaml> <out.json>` | A YAML config (e.g. `agent_config.yaml`, `env_config.yaml`) into JSON, resolving interpolations. |
| `python/export.py <checkpoint_dir> <out_dir> [--epoch]` | The actor files (`agent_config.json`, `state_dict.json`, spaces). |
| `python/export_env.py <checkpoint_dir> <out_dir>` | The environment files (`env_config.json`, `model.mjb`, `specs.json`). |

`export_job.py` calls `export.py` and `export_env.py` (as functions) and adds the presets and
manifest.

## Swapping parameters without re-exporting

Parameters of the **same architecture** (same agent config: identical state dict keys and shapes)
can be swapped into a running app: export them with `pt_to_json.py` and use **Upload...**, or include
them as presets with `export_job.py --params-epochs`. This covers other epochs and other seeds of the
same config. A different architecture (e.g. a different pattern-formation config) needs its own
export with `export_job.py`.

## Compatibility

An export only runs if every Hydra `_target_` in its configs has a TypeScript port registered in
`src/registry.ts`; otherwise loading fails with "No TypeScript implementation registered for
_target_ '...'". Currently ported: the `ncap_es` actor family used by `1_prod/1_4_flxext` (NCAP
pattern formation, afferent feedback, brainstem command, `RhythmGenerationCircuit2` with
`init_rg_rat6`, observation rectifier) and the `Rat` body on a `Floor` arena with spring-muscle
controllers. To add something, see [porting.md](porting.md).

To check an export headlessly (does the rat walk at each commanded speed?):

```bash
npx tsx test/closed_loop.ts data/app/<name>
```

### MuJoCo version

`model.mjb` is specific to the MuJoCo version that wrote it, so the app's `@mujoco/mujoco` npm
package must match the training environment's `mujoco` version (currently 3.12.0; the app checks this
at load time). If training moves to a new MuJoCo version, install the matching package
(`npm install --save-exact @mujoco/mujoco@<version>`) and re-export.
