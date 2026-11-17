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

## Marked edges (2026-11-12)

- Ctrl+E in edit mode opens the Edge menu: Mark or Clear Freestyle Edge, on lines with both ends selected (triangle diagonals included, since faces are triangles; pick lines in line select mode to avoid them). Marked lines draw over the fill wherever the mesh's own faces don't hide them, so creases and contours show inside a silhouette.
- The renderer side is `marked` on `MeshNode` and `marks` on `MeshItem` in `src/lib/vrender`, and SVG export draws them too. Visibility samples each edge 24 times against the mesh's triangles, so very large meshes with many marks will cost more; nothing is measured.
- Unverified: marks through a Mirror modifier and through Apply were only unit tested, not looked at.

## N-sided faces and curved lines (2026-11-12)

- Faces are any loop (`Face = number[]` in vrender). F makes one face; extrusion makes quad walls; subdividing a face with more than three sides takes the new vertices into its loop (triangles still split as before). The status bar counts faces.
- Lines can be quadratic, cubic, or SVG elliptical arcs (`curves.ts`), set from Ctrl+E. They're the groundwork for SVG import.
- Unverified: curves through the Mirror modifier and Apply were unit tested only. A mirrored mesh with curves rebuilds its tessellation and triangles every frame (the mirror makes new arrays each time); fine for small meshes, unmeasured for large ones.

## SVG import (2026-11-12)

- File, Import SVG… (object mode). Each shape becomes an object in a stack, so the drawing keeps SVG's painting order from any angle; see README. Checked in the browser with a test drawing: rounded rect, even-odd and nonzero holes, cubic heart, rotated scaled ellipse with stroke, stroked polyline, skipped text.
- Not handled: text, images, `<use>`, CSS classes and `<style>`, gradients (gray), opacity, markers, clip paths. The bridge into a hole shows as a line in edit mode's wire.

## Rendering speed (2026-11-12)

Phone-like benchmark: a 390 × 520 CSS-pixel canvas at device pixel ratio 3, CPU throttled 4× in headless Edge (software canvas), median `renderScene` time per frame:

| Scene | Before | After outline loops |
|---|---|---|
| Default cube | 4 ms | 1 ms |
| ball.slender | 16 ms | 5 ms |
| Imported SVG test drawing | 22 ms | 6 ms |
| 4,000-triangle sphere | 360–450 ms | 6 ms |
| gear-slip-ring (1,300 marks) | 180 ms | 63 ms |

What's left is mostly rasterizing thick border strokes and marks; join and cap styles made no difference, and halving the pixel ratio saves about a third. The benchmark harness lived in a temporary `src/zz-bench.ts` and isn't kept.

## Outline switch (2026-11-12)

- Object pane, Outline: off fills the object without stroking its silhouette; marked edges and loose lines still draw. Missing means on, so older files are unchanged. vrender: `outline` on `MeshNode` and `MeshItem`, honored by `render.ts` and SVG export.
- Pieces with their outline off get a one-device-pixel stroke in their fill color, which closes the anti-aliased seam where two pieces meet. It costs about 13 ms a frame on the phone-like benchmark for the gear demo's 150 pieces.

## Marked edges on many small meshes (2026-11-12)

- Splitting the gear demo into pieces raised marked-edge visibility from 2 to 10 ms a frame in Node. Three changes in `visibleMarks` (`project.ts`) brought it back down, and they help one-piece meshes too:
  - The triangle grid is about one cell per triangle, up to 24 across. A fixed 24 × 24 grid over a small mesh counted every triangle into dozens of cells.
  - Each vertex's visibility is found once per frame, since marked edges often meet end to end, as a curve's pieces do.
  - The finest sampling step is at least six flattening tolerances, about 1.5 device pixels in the viewport, not just 1/150 of the mesh's size.

## Gear demo in pieces (2026-11-12)

- `gear-slip-ring.slender` is now one object per tooth: each pinion, ring and the carrier is an empty on its axis that carries the motion, with its pieces as children, their outlines off. Ring sections are cut radially in the root lands, a tooth up and a tooth down on rings A and B (12-sided profile) and one tooth with a flat back on the base and top rings (8-sided). A pinion's pieces are a tooth with its slice of the hub, cut from the axle to the middle of each land. The carrier band is 16 sections; 8 let a pinion tooth sort over the band in an oblique view.
- Every piece is closed, cut faces included but unmarked: an open end let the piece's own hidden marked lines show through it when it drew after its neighbor.
- Colors: the drive path is at full color (input pinion red, rings A and B and the signal pinions purple, output pinion blue); the base and its ring are light red, the top segment and its ring light blue, the carrier light purple, the reference pinions light gray.
- Edges are arcs only where they bow at least 1 unit from straight (`MIN_BOW`): the carrier rims and the outer rings' backs. Tooth tips and lands stay straight; as arcs they looked the same and doubled the marked lines.
- Tried and dropped: the carrier band as two halves that stay still. Each half sorts at its own center, about 95 units out, so a signal pinion at 120 always sorts in front of the near half, though the band passes in front of its lower teeth.
- Still a painter's-algorithm limit: the band sits only 20–40 units outside the signal pinions' axles, and a pinion piece pointing down toward a tilted camera is about 15 units nearer than its axle. No error showed in four checked views, but other angles may show one.
- Phone-like benchmark, same harness and machine load: the earlier one-piece file 101 ms, the pieces 121 ms without the seam stroke, 134 ms with it. The file is 595 KB, 157 objects, 2,700 marks.

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
