# Slender handoff

Read this first when resuming. [README.md](README.md) has the design decisions, file map, and full controls.

The owner knows Blender well and wants its keybinds and behavior matched. When a request is ambiguous, do what Blender does. They often send requests while work is in progress, and earlier ones can be superseded, as when "fly" turned out to mean walk navigation.

## State at handoff

- **The owner committed up to `Slender v2`.** Everything since, from the IK work on, is uncommitted, alongside unrelated uncommitted deck work (`src/page/extraneous/decision-making-presentation/`, `Ncap.tsx`, `package.json`, and part of `src/App.tsx`). Keep them separate when committing, and commit only when asked.
- **The site moved from Create React App to Vite** (React 19, TypeScript 7, Vitest), on 2026-11-08. Type-check passes and all 334 unit tests pass, with Slender's own tests unchanged under Vitest.
- Run with `npm start` (Vite, port 3000), then open `/#/slender`. The rendering demo is at `/#/slender/demo`.
- **Ellipsoids** were added on 2026-11-08 for the rat demo at `/#/rat2` (`src/page/extraneous/rat-ncap/app/slenderRenderer.ts`), which rigs a MuJoCo rat on Slender bones.

## Done

- **Rendering:** perspective camera, flat shapes turned in 3D, meshes as a silhouette with an opaque fill and a border, per-object depth sorting. World is z up.
- **Editing:** object and edit modes, vertex/line/face select, right click and box select, G/R/S with X/Y/Z axis lock, O proportional editing with wheel radius, Shift+D, F, X and Del.
- **Undo and redo** over whole-document snapshots.
- **Animation:** keys on vertices and object transforms, animation pane with scrubbing, key dragging, easing, and playback.
- **Panes:** outliner (folders, visibility, drag in and out, rename, no manual ordering by request), N panel, object pane (parent, constraints, render settings), world tab (sky color), draggable borders.
- **Relations:** parenting with Ctrl+P and Ctrl+Shift+P; Copy Location, Copy Rotation, Look At, and Child Of constraints with animatable influence; a keyable Parented toggle on Child Of; hover plus I and Alt+I on properties, with key colors on fields; Alt+G, Alt+R, Alt+S clear.
- **Rigging:** armatures, bones with extrude, duplicate, delete, and parenting in edit mode; pose mode with keying; bone constraints; inverse kinematics with pole, chain length, and Shift+I; parenting objects to bones; vertex groups; Armature Deform and automatic weights; weight painting with mix, subtract, and smooth.
- **Modeling additions:** Ctrl+J join; P separate by selection or loose parts; Mirror modifier with axes, merge, clipping, and apply.
- **Ellipsoids:** Shift+A, Ellipsoid. Radii along local x, y, z and a length that sweeps it along local z, so length 0 is an ellipsoid and equal radii make a capsule. Drawn from its exact perspective outline, in closed form: an ellipse from the projected quadric, or for a swept one, two end ellipses joined by their outer tangents, found by solving for the tangent planes where the ellipsoid is two unit spheres (`sweptOutline` in `project.ts`). `drawItems` fills runs of same-coloured opaque shapes as one path. It has no vertices; `renderedMesh` gives a low-poly stand-in, so picking, box select, and occlusion work unchanged. No edit, pose, or weight mode, no modifiers or vertex groups, not joinable. Radii and length are in the object pane and are not keyable.
- **Rotation modes:** Euler or quaternion per object or bone, chosen in the N panel.
- **Viewing:** orbit, pan, zoom, camera objects, camera view, Shift+F walk with Shift to speed up and Space to zoom to a surface.
- **Top bar:** mode and select mode button groups, camera view, proportional editing, Overlays, X-Ray. SVG icons in `icons.tsx`, hover colors in `slender.css`.

## Next

Nothing is queued. All the owner's requests so far are done. Ask what comes next.

## Shared code and the homepage demo (2026-11-08)

- The renderer (scene model, matrix, geometry, projection, canvas drawing, SVG export) moved to `src/lib/vrender/`, and file open/save to `src/lib/psave/`. `storage.ts` keeps Slender's sessions and recent files and calls psave for files.
- `animation.ts` has a new ease, `'bounce'`: an elastic ease-out that overshoots the next key and rings down into it (`elastic()`). The editor plays it; no editor UI sets it yet.
- `SlenderDemo.tsx` is the homepage demo: `cube.slender` in a viewport that swings round with a drag (with fling), the picked property's value curve with draggable keys and selectable segments (Linear / Eased / Bounce), an editor bar, play/pause, a two-box playback range, and an outliner of animated properties. Edits are not saved; a reload restores the cube.

## Saving

The file is the real copy. The owner sometimes closes without saving on purpose to revert, so nothing may restore unsaved work into a new tab on its own. A refresh restores everything, including undo, from an autosave tied to the tab. Closing the tab leaves that autosave for the manual Recover Last Session command only. `projectFile.ts` is the format and `storage.ts` is IndexedDB, tab tracking, and file access. Files hold the view and panel layout but never undo history.


## Not requested yet, but missing

- Keying fill, border, focal length, and sky.
- Proportional editing in object mode, and falloff shapes other than smooth. Blender has both.
- Bone roll, and Alt+S shrink/fatten in edit mode. Alt+S does nothing in edit mode today.
- Posing while weight painting. Blender allows it; here, switch to the armature to pose.
- A cancelled extrude is undone, which leaves it on the redo stack.

## Not verified

- **Rigging a real character.** `slender-rigging-check.cjs` built a leg in the browser and its screenshots showed the foot on target and the knee at the pole, but no mesh has been skinned to an IK leg by hand, and playing back through Parented keys is covered by unit tests only.
- **Ctrl+J in a real browser.** It calls `preventDefault`, but the test driver's keys do not reach browser shortcuts, so whether Chrome's downloads page stays away is unconfirmed, as with Ctrl+P.
- **Ctrl+P and Ctrl+Shift+P against a real browser.** The test driver's keys do not reach browser shortcuts, so the code that calls `preventDefault` has not been shown to stop the print dialog in a real window. The page cannot catch Ctrl+Tab at all, which is why Shift+Tab exists.
- **Weight painting by hand.** Strokes were driven by script, so how radius and strength feel is untested. Weights live on vertices, so a brush that reaches no vertex does nothing, which is easy to hit on a low-poly mesh like the default cube.
- **The native file pickers and permission prompts.** The check replaces the pickers with ones returning real handles from the browser's private file system, so real file writes, reads, and Open Recent ran, but no native dialog or permission prompt has. Firefox and Safari have no file picker API, so they fall back to upload and download, which has not been run.
- **A real crash.** Recovery was tested by closing a tab. Autosave runs each second, so a crash can lose the last second.
- **Autosave cost on large scenes.** Each write clones the undo history. No measurements exist.
- **Export output in a viewer.** The SVG text is unit tested and the commands ran without failing, but no exported file has been opened, and Export Video has not been run.
- **Numeric drag and curve editing by hand.** Scripted drags worked, but how the speeds feel is untested.
- **Pointer lock during walk.** Headless Edge never granted the lock, so looking around was tested only through the unlocked fallback. Esc ending a locked walk relies on `pointerlockchange` and has never run. Check this first in a real browser, since it is what the owner asked for.
- **Performance on large meshes.** With X-Ray off, edit mode tests each vertex and wire against every face on every redraw. No measurements exist beyond the demo's roughly 50 fps with software rendering.
- **Native color pickers and dropdown clicks.** Their values were set by script in tests, not by hand. The sky, fill, parent, and constraint results of those values were checked.
- **Scaling vertices along an axis keeping their center.** A unit test covers it. The browser check meant to confirm it reads a field that does not exist with 7 vertices selected, so it prints `undefined`.
- **Visual review.** Only some screenshots were looked at. Face and line select highlights, the walk crosshair, and the camera gizmo under z up were checked by counts and pixel changes, not by eye.

## Checking work

- `npx tsc --noEmit -p .`
- `npx vitest run src/page/extraneous/slender`
- `scripts/slender-browser-check.cjs` drives the real editor with mouse and keyboard over the DevTools protocol. To run it:
  1. Start the app on port 3457: `npx vite --port 3457`
  2. Start Edge: `msedge --headless=new --disable-gpu --remote-debugging-port=9337 --window-size=1200,900 --user-data-dir=<temp folder> about:blank`
  3. Run `node scripts/slender-browser-check.cjs`. It prints results to read through rather than pass or fail, and writes screenshots next to itself, so move them out of the repo or delete them.
- **Older check scripts need repair.** `slender-browser-check.cjs` and `slender-rig-check.cjs` did not run to the end after keys stopped being written automatically and the pane changed: one hung, then neither got through in fresh browsers. `slender-todo-check.cjs` and `slender-rigging-check.cjs` are current.
- `scripts/slender-browser-check.cjs` predates rigging. `scripts/slender-rig-check.cjs` covers the parent and clear keys, armatures, posing, and painting, and runs the same way.
- `scripts/slender-todo-check.cjs <screenshot folder>` covers extrude, selection display, local axes, the cursor, selection rules, numeric drag, frames, timeline zoom and pan, curves, subdivide, and export.
- `scripts/slender-rigging-check.cjs <screenshot folder>` covers the N panel, the cursor staying out of undo, rotation modes, join and separate, the mirror, an IK leg with a pole, an object on a bone, Child Of, and S on handles. Look at its screenshots: bones are not readable from the page.
- `scripts/slender-save-check.cjs` covers saving, refresh, close, recovery, and refusing bad files. It opens its own tabs, so give it a fresh `--user-data-dir`.
- If every click seems to do nothing in the browser check, look for a compile error: the error overlay swallows clicks. Vite shows compile errors in an overlay too.
- Two results in that script always look wrong and are not bugs: `showing restores: false`, because hiding a folder also deselects its contents, and `was locked: null`, the pointer lock gap above.
