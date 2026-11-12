# Running the interactive app

The app runs the trained rat in your browser: the actor and MuJoCo (WASM) step in a Web Worker, and
three.js renders the rat. Everything runs **client-side**; the server only serves static files (the
page, the MuJoCo WASM binary, and an exported checkpoint), so it can run on any machine you can reach,
including an HPC login node.

## Launch

### On the HPC, from VSCode (Remote-SSH)

In a VSCode terminal on the HPC:

```bash
cd ~/ncap-quadruped-dev && source projects/rodent/.env/initialize.sh && cd web
npm install        # Once (and after pulling dependency changes).
npm run dev        # Vite dev server on 127.0.0.1:5173, with hot reload while editing.
```

VSCode detects the port and forwards it to your machine (a notification offers **Open in Browser**;
otherwise open the **Ports** panel and add `5173`). Open <http://localhost:5173> in your local browser
(Chrome recommended).

- Start the server in a terminal on the machine VSCode is connected to, not inside an `srun` on a
  different node: VSCode can only forward ports of the host its server runs on. The server is
  lightweight, so a login node is fine. If it runs inside a Slurm job, it stops when the job ends
  (a page that is already loaded keeps running; reloading needs the server).
- Production build instead of the dev server: `npm run build && npm run preview` (port 4173).

### Anywhere else

`npm run build` writes a self-contained static site to `web/dist/` (about 20 MB, plus 2.4 MB of
parameter presets). Serve it with any static file server, e.g. on your laptop:

```bash
python3 -m http.server -d dist 8000   # Then open http://localhost:8000
```

Opening `dist/index.html` directly as a file does not work (browsers block Web Workers and WASM
loading from `file://`).

## Choosing a checkpoint

The app opens exported checkpoints from `web/data/app/<name>/` (see [exporting.md](exporting.md)):
`http://localhost:5173/?checkpoint=/<name>`. The default is `/1_4_flxext`.

## Controls

| Control | Effect |
|---|---|
| **Target speed** slider, arrow keys | Commanded forward speed. 0-1 m/s as trained (fixed speeds 0, 0.2, ..., 1.0); tick the checkbox to allow up to 1.5 m/s (extrapolation). Takes effect on the next 30 ms control step. |
| **Playback speed** slider, `[` / `]` | Simulated time per wall time, from 0.05x (slow motion) to 2x. Physics and the policy are unchanged; rendering interpolates between frames, so slow motion stays smooth. |
| **Reset**, `R` | Returns the rat to its initial pose and resets the actor's state (rhythm generator etc.), keeping the target speed. |
| **Pause**, `Space` | Pauses/resumes the simulation. |
| **Parameters** list | Click an entry to swap the actor's parameters mid-run (no reset): the export's own parameters, saved epochs (presets), or uploads. |
| **Upload...** | Adds parameter files (`state_dict.json`, e.g. from `python/pt_to_json.py`) and loads the last one immediately. Files must match the checkpoint's architecture (same keys and shapes); incompatible files are rejected with a message and leave the running model unchanged. Uploads last for the browser session. |
| Mouse | Drag to orbit, scroll to zoom. The camera follows the rat. |

The panel shows the speed along the rat's heading (the policy has no heading control, so the rat
gradually turns; speed along world x would be misleading), the commanded speed, whether the rat fell
(roll/pitch over 45 degrees or trunk contact; press Reset), simulated time, compute time per 30 ms
step, and the real-time factor.

## What to expect

- **Policy limits.** The policy was trained on 6 s episodes at fixed speeds from reset. Mid-episode
  speed changes, runs much longer than 6 s, and speeds above 1 m/s are untested by training: expect
  the occasional stumble or fall (then Reset).
- **Performance.** Each 30 ms control step costs roughly 20-25 ms of compute (actor ~2.5 ms, physics
  ~3.5 ms, environment code the rest). If your machine can't keep up, the simulation runs slower than
  requested instead of breaking: the real-time factor shows this (it turns red).
- **Rendering.** The rat is drawn from its MuJoCo collision/visual primitives (capsules, ellipsoids,
  boxes), not its textured skin.

## Troubleshooting

- **Port 5173 not forwarded / blank page:** check VSCode's **Ports** panel; make sure `npm run dev`
  is running in a terminal on the host VSCode is connected to.
- **"Failed to fetch .../model.mjb: 404":** the checkpoint isn't exported under `web/data/app/`
  (see [exporting.md](exporting.md)), or the `?checkpoint=` name is wrong.
- **"MuJoCo version mismatch":** the checkpoint was exported with a different MuJoCo version than
  the app's `@mujoco/mujoco` package; see [exporting.md](exporting.md#mujoco-version).
- **Errors in the panel at startup:** the browser console (F12) has the full stack trace from the
  worker.
