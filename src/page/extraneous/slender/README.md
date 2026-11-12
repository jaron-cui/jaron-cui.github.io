# Slender

A Blender-like animation tool for vector graphics. Editor: `/#/slender`. Rendering demo: `/#/slender/demo`. Current status is in [NOTES.md](NOTES.md).

## Pipeline

```
AnimatedScene --evaluateScene(time)--> Scene --projectScene(camera)--> DrawItem[] --renderScene--> pixels
```

The editor keeps its own document and produces a `Scene` from it each frame:

```
EditorDocument --worldMatrices(time)--> matrices --toScene--> Scene
```

| File | Role |
| --- | --- |
| `model.ts` | A scene at one instant: plain data, no animation. |
| `animation.ts` | Tracks, easing, and `evaluateScene`. |
| `geometry.ts`, `primitives.ts` | Rect and ellipse to paths; starter meshes, and the ellipsoid's picking stand-in. |
| `matrix.ts`, `project.ts` | 3D transforms, perspective, near clipping, curve flattening, exact ellipsoid outlines, depth sorting. |
| `render.ts` | Draws projected items with Canvas 2D. |
| `document.ts` | The editor's document: objects, folders, parents, world matrices, picking, occlusion. |
| `projectFile.ts`, `storage.ts` | The saved file format; IndexedDB autosave, tab tracking, and file access. |
| `typedInput.ts` | Numbers typed during G, R, and S. |
| `constraints.ts`, `ik.ts` | What each constraint does to a world matrix; solving IK chains. |
| `armature.ts`, `rigging.ts` | Bone math, skinning, and automatic weights; operations on bones, parents, and vertex groups. |
| `armatureMirror.ts` | Pairing bones across x, and mirroring joint edits and poses. |
| `modifiers.ts`, `joining.ts` | The mirror modifier; joining, separating, and applying a mirror. |
| `snapping.ts`, `exporting.ts`, `timelineView.ts` | Shift+S actions; SVG output; the animation pane's view. |
| `editing.ts`, `keyframes.ts`, `history.ts` | Pure operations on meshes and keyframes; undo. |
| `Editor.tsx`, `overlay.ts` | The editor and its viewport aids. |
| `CurvesEditor.tsx`, `NumberField.tsx`, `Outliner.tsx`, `ObjectPane.tsx`, `RigPanes.tsx`, `TransformPanel.tsx`, `Timeline.tsx`, `PaneDivider.tsx` | Panes. |
| `icons.tsx`, `slender.css` | Icons and hover styles. |
| `demo.ts`, `Slender.tsx` | Test scene and viewer. |

## Controls

| Input | Action |
| --- | --- |
| Ctrl+S, Ctrl+Shift+S, Ctrl+O | Save, Save As, Open. The File menu also has New, Open Recent, and Recover Last Session |
| Tab | Object or edit mode |
| Shift+Tab | Pose mode on an armature, weight paint on a mesh. Stands in for Ctrl+Tab, which browsers keep |
| 1 / 2 / 3 | Vertex / line / face select, in edit mode |
| Shift+A | Create menu |
| Right click | Select (Shift adds or removes) |
| Left click | Place the scene cursor on the surface under the pointer, or at its current depth |
| Shift+S | Snap menu: selection to cursor, active, or grid; cursor to selected, active, origin, or grid |
| A / Alt+A | Select all / deselect all |
| B, then left drag | Box select, adding to the selection |
| G / R / S | Move / rotate / scale; left click or Enter confirms, Esc or right click cancels |
| X / Y / Z during G, R, or S | Lock to a global axis; the same key again goes local, and once more releases it |
| Numbers during G, R, or S | Type a distance, degrees, or a factor in place of the pointer, applied live: `-` flips the sign, Backspace erases, and Tab goes between X, Y, and Z in a free move |
| O | Proportional editing in edit mode: nearby vertices follow with a smooth falloff; the wheel sets the radius during G, R, or S |
| Alt+O | Proportional editing reaches connected vertices only, measured along the mesh |
| Alt+G / Alt+R / Alt+S | Clear location / rotation / scale of selected objects, or of selected bones in pose mode |
| Ctrl+P | Set Parent To menu: children selected first, parent last. With an armature active, also Armature Deform, With Automatic Weights, and Bone, including from pose mode. On bones in edit mode: Connected or Keep Offset |
| Ctrl+J | Join the selected meshes into the active one |
| P | Separate menu in edit mode: Selection or By Loose Parts |
| Shift+I | In pose mode, add inverse kinematics to the active bone, reaching for the other selected bone |
| Ctrl+Shift+P | Parent without inverse: the child moves to the parent |
| E | Extrude in edit mode: faces lift along their normal, lines grow walls, vertices grow lines, joints grow bones |
| W | Specials menu in edit mode: Subdivide |
| Shift+D | Duplicate the selection and start moving it |
| F | 2 vertices: line. 3 or more: face |
| X, or Del | Delete what is selected in the pane under the pointer |
| I | Key the property under the pointer, or remove its key if it is on one. Elsewhere, key the selection at the current time, for the properties turned on beside the key button |
| Alt+I | Remove the key here from the property under the pointer |
| Space | Play or pause |
| Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y | Undo, redo |
| N | Exact values panel: selected vertices, the object or bone's location, rotation, and scale, and the 3D cursor |
| Alt+Z | X-Ray |
| Numpad 0 | Look through a camera |
| Middle drag / Shift+middle drag / wheel | Orbit / pan / zoom |
| Shift+F | Walk: the mouse looks, WASD move, Q/E down and up, Shift faster, Space zooms to the surface at the center, wheel sets speed, left click keeps, Esc or right click goes back |

To make a held object follow a palm, parent it to the hand bone: select the object, then the armature, go to pose mode, pick the bone, and press Ctrl+P, then Bone. It attaches at the bone's tail and keeps its place.

To hold it only for part of the animation, give it a Child Of constraint on the bone instead. Key its Parented toggle off at the start, then on or off at each frame it is picked up or let go: hover the toggle and press I. Nothing jumps at those frames, and no other keys are needed.

With the pointer over a property in the N panel or a constraint, I keys that property, or removes the key if it is on one, and Alt+I only removes. Its fields show yellow on a key, green with keys elsewhere, and orange for a change not keyed yet, which the next frame change discards.

For a leg, make a control bone that is not a child of the leg and move it to the ankle, then a second one in front of the knee. Select the control, then the shin, and press Shift+I. Choose the second control as Pole in the constraint, and the knee points at it. Chain says how many bones bend, 2 by default, with 0 meaning all the way up.

In the animation pane, left click or drag anywhere below the controls to move the time cursor, even outside the start and end frames. Right click selects keys, and in Curves handles too, with Shift adding. With the pointer over the pane, A and Alt+A select and deselect all, G moves, S stretches key timing about the current frame, X or Del deletes, and in Curves R turns handles about their keys, while G moves a handle and S lengthens it, when no key is selected with it. Left click confirms and Esc or right click cancels. In Curves, deleting or moving a key touches that one property's curve alone. The wheel zooms at the cursor and middle drag pans. Play loops between the start and end frames. Keys and Curves switch views, and in Curves a channel's name solos it.

An armature's Mirror X makes each joint edit in edit mode happen on the other side too, across the armature's own x, including extruding and deleting. Pose X does the same for G, R, S, the N panel, I, and clearing in pose mode, and is separate so that a walk cycle can be asymmetric. Bones pair by .L and .R names, or else by lying exactly on each other's reflection, and the pane counts the pairs. Joints on a center bone stay on the plane. Symmetrize makes the other side of the selected bones match, creating what is missing and flipping constraint targets.

The Median and Cursor buttons in the toolbar choose what R and S turn and scale about. The Loc, Rot, and Scale buttons beside the key button choose what I keys, per axis. Vertices key only by the Loc axes.

Numeric fields drag left or right to change, Shift finer, Ctrl in rounder steps, and Esc or right click puts them back. A click types in them. In object mode the All row covers every object and Selected covers selected objects; in edit mode they cover the active mesh's vertices.

An armature's Shift+A adds a bone, and G, R, S, Shift+D, and X work on its joints and bones in edit mode. In weight paint, left drag paints the active group, Ctrl subtracts, Shift smooths, F sets the brush radius, and right clicking a bone picks its group.

In the outliner, click selects, Ctrl or Shift click toggles, double click renames, and dragging moves items in and out of folders.

## Decisions

- **The document is plain data, and a frame is a pure function of it and time.** Scrubbing, playback, and export all use the same call.
- **World axes are x right, y forward, z up, as in Blender.** A camera looks along its local +y with +z up. Only `viewMatrix` turns this into image axes.
- **Every document change makes a new document.** Undo is a list of past documents, selection included. The view, time, and panel layout are not undoable.
- **World placement has one source, `worldMatrices`:** own transform, inside the parent, then constraints in order. Everything else reads from it. Bones can build on this.
- **Bones are nodes in `worldMatrices`, alongside objects.** Parenting and constraints therefore work on bones with the same code, and anything can parent to or target a bone. A bone's transform is its pose, relative to rest.
- **An armature's joints are its vertices and its bones are its edges.** Edit mode's selection, G, R, S, box select, and undo are the mesh code. Connected bones share a vertex, so they stay joined.
- **Skinning is linear blending, in world space.** A vertex follows the bones whose names match its groups, divided by total weight. Vertices with no weight stay put, as in Blender.
- **The object being edited shows undeformed vertices,** because those are what editing changes. Everything else reads `displayVertices`, or `renderedMesh` where modifiers count.
- **A rotation is a quaternion if it has a w, and otherwise Euler angles,** in the same slot, so everything that carries a rotation around works on both. Switching converts every key. Quaternion channels blend separately and normalize, as in Blender. New bones are quaternions and new objects are Euler, also as in Blender.
- **IK solves whole chains with FABRIK, then swings them to the pole,** from the pose as a starting point, so a frame stays a pure function of the document and time. Each bone turns as little as it can, keeping its twist. Unlike Blender, pole angle 0 points the knee directly at the pole.
- **A keyed Child Of is a switch, and works out from its keys where to hold,** so nothing jumps and only the toggle needs keying, any number of times. Turning on follows the target from that moment, and turning off stays where following led. In Blender this takes Set Inverse and keyed visual transforms by hand. The cost is a look at the target at each past switch, which `worldMatrices` caches per document.
- **The scene cursor is not in the document.** It is saved in the file with the view, but moving it is no undo step and marks nothing unsaved.
- **The mirror's generated half is not editable, and draws and picks as part of the mesh.** It runs before the armature, and reflecting across x swaps groups named .L and .R, so a mirrored half bends with the other side's bones.
- **Bones draw over surfaces,** since a rig sits inside what it moves, and so win picking in object mode.
- **The file is the real copy.** A refresh restores unsaved work and undo from an autosave tied to the tab. A closed tab reverts to the file, and its autosave comes back only through Recover Last Session.
- **Vertices are stored relative to their object.** Editing happens in world space and converts back, so global axes mean what they say inside a moved, rotated, or parented object.
- **Selection is always vertices.** Choosing a line or face selects its vertices; G, R, S, and F work the same in every select mode. Delete follows the select mode.
- **Editing something animated writes no key,** as in Blender with auto keying off. The edit is held on the track as `held` until the frame changes, and I keys it. Constant values just change. Undoing back past a frame change can bring a held edit back, but only at its own frame.
- **Each coordinate has its own keys and may be constant** while others are animated.
- **Parenting keeps an unanimated object where it is in the world.** Animated objects keep their keys and move with the new parent.
- **Objects scale along their own axes.** A locked global axis applies to the object axis that lines up with it best, so a rotated object is never sheared. Vertices scale along true global axes.
- **X-Ray off respects occlusion.** With it off, the edit overlay, picking, and box select leave out what surfaces hide. Object mode's selection wires always show through.
- **Canvas 2D is the renderer for now.** `project.ts` reduces everything to flat outlines, so only `render.ts` knows about Canvas.
- **Curves are flattened per frame** to within a quarter device pixel, since a projected cubic is no longer a cubic.
- **A mesh draws as a single silhouette.** All projected triangles, wound the same way, form one path, stroked at twice the border width and then filled opaquely on top. Lines inside the outline are not drawn.
- **Only numbers animate, unless wrapped in `Fixed`.** Anchor counts cannot change over time. Face and edge indices are `Fixed`.
- **Tracks live inline on the property they animate,** so no string paths can dangle. Reusing one animation on several objects will need a later addition.
- **Key times are stored in seconds, and the pane works in whole frames.** Changing the frame rate rescales key times so keys stay on their frames, as in Blender.
- **Bezier handles are offsets from their keys in seconds and value.** Unlike a normalized ease, this can bend a segment whose two keys have equal values.
- **Hidden objects stay selected but out of reach.** Actions go through `selectedVisible`.

## Known limits

- Each shape or mesh sorts as one item by average depth, so a flat shape passing through a mesh appears wholly in front or behind. Fixing this means moving to the GPU.
- Faces are stored as triangles, so quads show their diagonal, and face select takes one triangle at a time.
- F orders vertices by their angle on screen around their center, which suits convex outlines viewed from the front.
- Walking a camera object drops any roll it had.
- Partial constraint influence blends matrices directly, which is approximate for rotations.
- A bone is in one IK chain. Where chains overlap, the first takes the shared bones and the next stops short of them, rather than averaging as Blender does. There are no joint limits or per-bone stiffness, and no tip rotation option: use Copy Rotation on a foot bone for that.
- Moving a bone inside an IK chain only changes the solver's starting point, as in Blender. Move the target instead.
- Armature mirroring is across x only. A copy from Shift+D does not mirror as it moves: use Symmetrize afterward. Proportional editing mirrors only the selected joints, and renaming a bone does not rename its other side.
- The mirror always reflects across the object's own origin. Blender's Mirror Object option is not here.
- Joining bakes the other objects' places at the current frame, so their object animation does not carry over. Separated parts copy the object's transform and constraints.
- Converting a rotation with spins of more than half a turn between keys loses the spins, since only the keys' rotations carry over. Converting also resets bezier handles to a plain ease.
- Automatic weights use distance to each bone, not Blender's bone heat, so weights can jump across a gap between limbs that sit close together.
- Bones have no roll setting; each bone's rest frame keeps +z as near to up as it can.
- Linear blending collapses volume at sharp bends, which Blender's Preserve Volume option would address.
- Because faces are triangles and selection is vertices, selecting three lines of a triangle also selects its face, and a quad extrudes or selects as two triangles. Extrude and subdivide show the diagonals.
- Bezier handles move independently. Blender's aligned and automatic handle types are not here.
- In the Keys view a key stands for every property at that time, so moving or deleting there affects them all. Curves is where to work on one.
- Keys and handles have no box select yet. Shift+right click and A are the ways to select several.
- Exports use the viewport's size. There is no resolution setting yet.
- Set Parent To has no separate Keep Transform item, because plain Object already keeps the child's place in the world.

## Not yet decided

- Group opacity, which needs offscreen compositing.
- Morphing between paths with different anchor counts.
- Color interpolation. Channels currently blend directly in sRGB.
