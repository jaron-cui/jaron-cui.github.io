# notespec spec (draft)

A score editor that works on notes directly, the way a MIDI editor does, rather than on sheet-music
notation. Editing conventions follow Blender. Sound is computed from the notes in `sound.ts`; a
waveform editor for building instruments from component functions comes later.

Items marked **Open** are not decided yet. "Rulings made while building" at the end lists choices the code
had to make that the user hasn't reviewed yet.

## Defaults and page

- Route `/#/notespec`, full-screen, in Slender's visual style for now.
- A new score has one global section (4/4, C major, 120 BPM, treble clef) and one empty track.

## Data model

### Note

`{ id, pitch, start, duration, tie, spelling? }`

- **pitch**: semitones, MIDI numbering (60 = C4), fractional allowed. It is a parameter passed to
  sound generation, which is free to interpret it; it is not tied to a frequency.
- **start**, **duration**: time relative to the start of the section that owns the note (see
  Sections). Stored as whole-number ticks; typed and displayed in the section's beats, where a beat
  is the time signature's lower number (an eighth in 6/8). A typed offset for a selection spanning
  sections uses the beat of the earliest time signature in the selection.
- **Attachment point**: the point of a note that decides which section it belongs to. Fixed to the
  note's start for now.
- Velocity and other dynamics are left out for now (see Later).

### Ties

Ctrl+J ties sequences of touching notes in the selection; Alt+J unties. Sound generation works per
tie (a tied sequence sounds as one event).

- Stored as an explicit link on each note, `tie: nextNoteId | null`, since in chords touching
  alone can't say which note leads into which.
- A tie is valid only while its two notes touch. A move that separates them clears it, including
  moving one of their sections. Tied notes may belong to different sections.
- Notes of different pitch can be tied; this is how legato is written.
- Ctrl+J pairs notes across each meeting point by pitch order (lowest to lowest); notes left over
  stay untied.
- Splitting a note (S) gives two separate, untied notes.

### Sections

Sections are clips: a section owns its notes, with note times relative to the section's start, so
moving a section moves its notes.

- Two levels:
  - **Global sections**: one sequence shared by the whole score. They have the tempo, key, time
    signature and clef.
  - **Track sections**: a track subdivides a global section further. A track section can override
    the key, time signature and clef, but not the tempo. It belongs to the global section its start is
    in (the same attachment rule as notes), and follows that global section when it moves.
- A split never splits a note. A note stays with the section its attachment point was in.
- A note dragged outside every section stays with its section and moves with it, but is drawn red
  until it is moved into a section or its section is extended to cover it. A track section outside
  every global section is treated the same way.
- Sections moved onto each other overlap, shaded translucent red, until they are moved apart. Moves
  are not blocked by neighbors, so a section can be carried past others.

### Key

A tonic selector plus a scale selector: major, minor, and the modes (Dorian, Phrygian, Lydian,
Mixolydian, Locrian).

### Tracks and folders

Tracks hold sections. The outliner is a tree of folders and tracks; folders nest, and anything can
be dragged in and out of folders.

- Per row: hide, mute, solo, each independent. Hide is visual only.
- A folder's hide, mute and solo apply to everything in it.
- Solo: if anything is soloed, only soloed items sound.

## Modes

- **Object mode**: clicking a note selects its track. Section lines can be selected and edited only
  here; notes cannot be selected.
- **Edit mode** (Tab): only the active track's notes can be selected and edited; other visible
  tracks are drawn faded. Clicking places a note on the active track. Section lines cannot be
  selected.

Because notes and section lines are never selectable in the same mode, S can mean "split" for both.

## Layout

- Tracks are stacked lanes, each with its own pitch range. Ranges are configurable; the defaults
  follow standard staff ranges. A lane always shows its whole range, so plain scroll moves through
  the stack of lanes and Shift+scroll moves through time.
- The vertical axis is laid out like a staff rather than a piano roll: gridlines at staff line and
  space positions, spaced by the section's clef. A note off the key's scale sits on its staff
  position with a sharp or flat drawn before it. This is a mix of traditional notation and a MIDI
  editor, chosen for readability and vertical compactness.
- Whether a note is drawn as a sharp or a flat is cosmetic: it comes from the note's pitch and the
  key, unless the note carries a `spelling: 'sharp' | 'flat'` tag. Sharp and flat buttons on the
  control bar set the tag on the selected notes. An untagged note off the key's scale is spelled
  the way the key signature goes: sharps in sharp keys, flats in flat keys, sharps in C major and
  A minor. Notes on the scale are spelled by the scale.
- Clefs: treble, bass, alto, tenor. A lane's height covers the staffs of every clef among its
  sections, plus configurable margins above and below (in semitones).
- Fractional pitches are drawn like accidentals: on the level of their base note, with a tilde
  before the sharp or flat symbol. Nothing creates them yet; the drawing code just handles them.
- A clef change may change a lane's height.
- The global section line runs across the top of the score and stays pinned to the top edge when
  scrolling down.
- Each track's section line is drawn at the top of its lane.

## Grids

Two button groups, on by default:

- **Pitch lock**: key (the scale of the section's key) / chromatic / none.
- **Time snap**: whole to 1/32. In triplet mode, a second group with the triplet divisions.

Holding Ctrl does not disable snapping.

## Placing notes and note length

- A click in edit mode places a note of the current placement length.
- Placement lengths are whole to 1/32. D turns on dotted mode and T turns on triplet mode. They
  are exclusive: turning one on turns the other off. Pressing the same key again goes back to
  normal lengths.
- Alt+scroll steps the placement length. With notes selected, it changes the selected notes'
  durations instead.

## Shortcuts

| Key | Action |
| --- | --- |
| Tab | Toggle edit mode |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo |
| Left click, Shift+click | Select, extend selection |
| A / Alt+A | Select all / none |
| B | Box select |
| G | Move selected notes in time. Mouse, or type an offset in beats. Click or Enter confirms; right-click or Esc cancels. |
| G then Z | Move in pitch instead; Z again returns to time. Typed offsets are chromatic semitones and ignore the pitch lock. |
| Up / Down | Move selected notes one semitone (chromatic regardless of the lock) |
| S | Edit mode: split selected notes at the timeline cursor. Object mode: split the selected section lines (global, or the selected tracks') at the timeline cursor |
| Ctrl+J / Alt+J | Tie touching notes in the selection / untie |
| D / T | Toggle dotted / triplet placement |
| Ctrl+S / Shift+Ctrl+S / Ctrl+O | Save / save as / open (the session also autosaves locally, as in Slender) |
| X / Delete | Delete |
| Shift+D | Duplicate |
| Ctrl+C / Ctrl+V | Copy / paste |
| Space | Play / pause |
| Ctrl+scroll | Zoom time |
| Alt+scroll | Change placement length, or the selected notes' durations |

Clicking the ruler, or blank space in a track or section, places the timeline cursor.

## Section handles

Sections are drawn as horizontal lines used as compact handles. A thick black line across the top
of the score is the global sections. A split leaves a small gap with a short vertical bar on each
side (`-----| |-----`). In object mode, selecting a segment and pressing G moves that section.

## Sound (`sound.ts`)

- Takes a whole track's notes, so that later instruments can keep state across notes (for example,
  bowing).
- For now: loops over the notes, hands each tie to a per-tie function that makes a sine wave with a
  short fade in and out.
- A tie's waveform may extend past its notes' boundaries.
- Computes samples itself (no Web Audio oscillators); output is played through Web Audio.

## Code structure

- The piano roll is drawn on a canvas. Its interaction code is a small component library: general
  pointer and keyboard handling (hit testing, hover, drag, capture), with specific components
  (notes, section handles, ruler, cursor) built on it, and modal operators (G, B) as their own
  state machines.
- The outliner and toolbars are React.
- Undo history and typed numeric input are copied from Slender (`history.ts`, `typedInput.ts`),
  so notespec doesn't depend on Slender's folder. The outliner is new, built for folders.

## Later

- Waveform editor: instruments built from sine, sawtooth or arbitrary functions.
- Dynamics: curves like animation curves, for example a Bezier crescendo across a section, per-note
  curves, possibly generalized to other attributes such as pitch bend.

## Rulings made while building

Choices the code needed that this spec didn't settle. Each stands until reviewed.

### Model (`score.ts`, `editing.ts`, `music.ts`, `lengths.ts`)

- Tempo is in quarter notes per minute, whatever the time signature.
- A new score's global section is 32 bars long.
- A note whose letter the key signature alters, but which is natural, is drawn with a natural sign
  (♮). Sharp and flat symbols alone can't show it.
- A note placed outside every section of its track joins the nearest section, and is drawn red.
- Splitting a global section also splits each track section that spans the split point, so every
  track's part after it moves with the new global section.
- Time snapping counts the grid from the start of the track section at that point.
- G with snapping on moves by whole grid steps, so notes off the grid stay off it by the same amount.
- Alt+scroll on a note whose length isn't standard moves it to the next standard length in that
  direction.
- Untying (Alt+J) clears the ties out of and into the selected notes.
- Copy keeps ties between copied notes; paste puts the copy at the timeline cursor on the active
  track.

### First screen (`Notespec.tsx`, `draw.ts`, `layout.ts`, `operators.ts`)

- The score area is drawn like paper: light background, black staff lines, and the global section
  line in thick black as described. Toolbars and panels keep Slender's dark style.
- A click places the note on the staff step under the pointer. With the key lock it is that step's
  scale tone (the letter as the key signature alters it); with chromatic it is the natural, and the
  arrow keys reach sharps and flats. "None" is shown but disabled until fractional pitches exist.
- A placed note starts at the grid line at or before the click.
- Selecting (clicks, A, Alt+A, B) and switching modes or the active track don't add undo steps.
- In edit mode, a click on blank space in another track's lane, or on the ruler, places the cursor;
  in object mode a click on blank space also clears the section selection.
- B adds the notes in the box to the selection; Shift held when the drag starts removes them.
- Starting settings: snap 1/8, placement length 1/4, key lock.
- Notes above or below their staff get ledger lines.
- Bar numbers count through the whole score, in the order global sections start.
- S in object mode: with any global section selected, the global line splits at the cursor; with a
  track's section selected, that track's section at the cursor splits.
- Notes move only with G and the arrow keys, not by dragging.
- **Open:** how a section's length is changed (needed to bring a stray note back inside without
  moving it).
