# Compiled-graph runtime

Runs the graphs that `artifact-playground`'s `python/compile_job.py` captures from a training job:
the JAX environment (XLA-optimized HLO) and the PyTorch actor (`torch.export`). Graphs compile to
JavaScript and WebAssembly in the browser at load; physics runs on MuJoCo WASM (`physics.ts`).

These files are copied unchanged from the playground's `ts/` (drop of 2026-11-13, by the agent
"figs"), including three type-only fixes for strict TypeScript 7 that were made here and folded back
into the playground's copy, so the two match.

Change them there and copy them again rather than editing here. Their imports carry `.ts`
extensions (`allowImportingTsExtensions` in the site's tsconfig) and take only types from
`@mujoco/mujoco`.

| File | Contents |
|---|---|
| `graph.ts` | Graph loading, sessions (`set`/`step`/`get`), the reference interpreter |
| `codegen.ts`, `wasm_backend.ts` | Compiling a graph to straight-line JavaScript and WebAssembly |
| `jax_ops.ts`, `torch_ops.ts` | Op implementations for the JAX and ATen dialects |
| `ndarray.ts` | Typed-array tensors |
| `physics.ts` | The `mujoco_physics` primitive on MuJoCo WASM |
| `demo_rat.ts` | The whole loop for a demo-only bundle (`compile_demo.py`): precomputed resets, built-in parameters |

The bundles it runs live in `public/rat-ncap/<model>/` (`env/`, `actor/`, `params/`) and, for the
homepage, `public/rat-ncap/<model>-demo/` (`env/`, `actor/`); see `../app/rat.ts` and
`../app/demoSim.ts` for how the site uses them.
