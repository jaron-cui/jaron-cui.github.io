# Gears

Gear generators at `/#/gears`, a regular site page with one section per kind of gear. Each section
turns standard parameters into an exact profile and shows it as a static drawing on a 10 mm grid,
dimensioned. A table relates every dimension to the parameters, and each part exports as SVG in
millimeters. The generators are meant first for animation and eventually for 3D-printable parts, so
the geometry is exact rather than approximate.

| File | Contents |
|---|---|
| `GearTool.tsx` | The page: its intro, links to the sections, and the sections in order |
| `drawing.tsx` | Shared by the sections: layout, fields, drawing sheets, grid, dimension lines and labels, the dimension table |
| `profile.ts`, `SpurSection.tsx` | Spur gears: the generator (also used by every other section) and its section |

Each generator has a `.test.ts` that checks it against textbook values.

## Conventions

- **Units are millimeters.** Angles are radians in code; fields marked ° are degrees.
- **Tooth 0 is centered on +x, and outlines run counterclockwise.** Drawings turn the gear so the
  tooth they dimension points up.
- **Drawings are static and fit their sheets.** They draw in pixels, so text and arrows keep their
  size, and label only symbols and values; the table below gives the formulas.
- **The page looks like the rest of the site:** Cambria text, the standard page margins, MUI fields
  and buttons, a Bootstrap grid and table, and the navigation bar. Each section remembers its fields
  in localStorage.

## Spur gears

- **The tooth is generated, not drawn.** A rack cutter (straight flanks at the pressure angle,
  rounded tips) rolls along the pitch circle, and the tooth is what it leaves. For each cutter point,
  the gear angle where it cuts is where its normal passes through the pitch point. This gives a true
  involute flank, the trochoid root fillet, and undercut on small gears, all from one rule.
- **The cut is the farthest the cutter reached at each radius.** The flank is stored as half
  thickness (an angle) against radius, so undercut, where the fillet's path crosses the involute,
  resolves itself by taking the maximum.
- **Profile shift moves the cutter out by x·m; backlash widens the cutter by the backlash,** which
  thins the tooth on the pitch circle by that much.
- **Undercut isn't warned about; it shows in the drawing.** `profile.ts` still reports it by the
  textbook test, x < ha − N·sin²α / 2. A tip whose flanks meet below the tip circle is cut off there
  and flagged as pointed.
- **`meshOf` spaces a pair (not shown on the page yet) using the working pressure angle,** solved from
  inv αw = inv α + 2 tan α (x₁ + x₂)/(N₁ + N₂), so shifted pairs sit backlash-free apart.

## Not yet

- Tip shortening for shifted pairs, to restore clearance at the reduced center distance.
- Helical gears; profile shift for racks' pinions is supported, but not for ring pairs or bevels.
- DXF and STL export. They need only the outlines the generators already produce, plus extrusion
  (and, for bevels, the taper) for STL.
- A Slender addon: a generator object type that calls these generators.
