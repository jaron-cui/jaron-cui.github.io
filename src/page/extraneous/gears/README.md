# Gears page

Gear generators at `/#/gears`, a regular site page with one section per kind of gear. Each section
turns standard parameters into an exact profile and shows it as a static drawing on a 10 mm grid,
dimensioned. A table relates every dimension to the parameters, and each part exports as SVG in
millimeters. The generators themselves are in `src/lib/gears`; its README covers how each one works.

| File | Contents |
|---|---|
| `GearTool.tsx` | The page: its intro, links to the sections, and the sections in order |
| `drawing.tsx` | Shared by the sections: layout, fields, drawing sheets, grid, dimension lines and labels, the dimension table |
| `SpurSection.tsx` | A spur gear, whole with its diameters and as one tooth with addendum, dedendum, thickness, pitch, pressure angle, and fillet |
| `BevelSection.tsx` | A bevel pair, as a section through both axes and as either gear seen along its axis |
| `RackSection.tsx` | A rack with its pinion in mesh, with the heights to build to |
| `RingSection.tsx` | A ring gear with its pinion inside |

## Conventions

- **Drawings are static and fit their sheets.** They draw in pixels, so text and arrows keep their
  size, and label only symbols and values; the table below gives the formulas.
- **Drawings turn the gear so the tooth they dimension points up.** Generators put tooth 0 on +x.
- **Dimensions go where there's free space:** diameters above and below a gear, a bevel pair's on each
  gear's mirrored half (away from the mesh), a ring's inner diameters below its center (away from the
  pinion).
- **Undercut isn't warned about; it shows in the drawing.** Warnings are for what would fail: pointed
  teeth, fillets or bores that don't fit, too little tooth difference in a ring pair, and bevel face
  widths past R / 3.
- **The page looks like the rest of the site:** Cambria text, the standard page margins, MUI fields
  and buttons, a Bootstrap grid and table, and the navigation bar. Each section remembers its fields
  in localStorage.
- **Bevel export is the view along the axis** (the large and small ends' outlines and the bore), which
  suits a drawing more than a cut; a printable bevel gear needs the 3D export to come.

## Not yet

- A Slender addon: a generator object type that calls `src/lib/gears`.
