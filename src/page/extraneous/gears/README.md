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
| `bevel.ts`, `BevelSection.tsx` | Straight bevel pairs |
| `rack.ts`, `RackSection.tsx` | Racks with their pinions |
| `ring.ts`, `RingSection.tsx` | Ring (internal) gears with their pinions |

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

## Bevel gears

- **The cones are exact.** Pitch angles come from tan δ₁ = sin Σ / (N₂/N₁ + cos Σ), and both gears
  share the cone distance R = d₁ / (2 sin δ₁). The tip and root cones run to the apex, so the small
  end is the large end scaled by (R − b) / R.
- **The tooth form is Tredgold's approximation.** The back cone, unrolled, is a spur gear of N / cos δ
  teeth (not a whole number, which is fine: only one tooth's flank is used). The large end's tooth is
  that virtual gear's tooth, generated as above.
- **The view along the axis wraps the virtual tooth back onto the cone:** a distance along the back
  cone projects onto the axis plane by cos δ, and the virtual pitch angle scales by 1 / cos δ.
- **The blank is a simple one:** a back face a quarter of the face width behind the large end, then
  straight to the bore. The section view puts dimensions on each gear's mirrored half, which is free of
  the mesh.
- **Face width is warned past R / 3,** the usual limit.
- **Export is the view along the axis** (the large and small ends' outlines and the bore), which suits
  a drawing more than a cut; a printable bevel gear needs the 3D export to come.

## Rack and pinion

- **The rack is the basic rack itself:** straight flanks at the pressure angle, a circular pitch
  apart, p/2 − j thick on the pitch line, with a fillet of ρ·m in each root (clamped to what fits the
  space's floor).
- **A tooth space sits at x = 0, under the pinion's tooth 0.** The rack ends mid-space, half a space
  past its first and last teeth.
- **The pinion is a spur gear from `profile.ts`.** Its axis sits m·N/2 + x·m above the pitch line, and
  one turn moves the rack π·m·N. The drawing dimensions the heights you build to: pitch line to axis,
  and rack back to axis.

## Ring gears

- **A ring's tooth space is an external gear's tooth.** So the ring is generated as the complement of
  an external gear with the same teeth: its addendum is the ring's dedendum (reaching out), its
  dedendum is the ring's addendum (reaching in), its backlash is negative (its teeth are the ring's
  spaces, widened by j), and it has no root fillet (that would round the ring's tooth tips).
- **The pinion sits m (N_r − N_p) / 2 from the ring's center** and turns the same way, N_r / N_p times
  per ring turn.
- **Fewer than about 12 teeth' difference is warned about,** where standard 20° teeth start to foul at
  the tips. That's a rule of thumb, not a computed interference check.

## Not yet

- Tip shortening for shifted pairs, to restore clearance at the reduced center distance.
- Helical gears; profile shift for racks' pinions is supported, but not for ring pairs or bevels.
- DXF and STL export. They need only the outlines the generators already produce, plus extrusion
  (and, for bevels, the taper) for STL.
- A Slender addon: a generator object type that calls these generators.
