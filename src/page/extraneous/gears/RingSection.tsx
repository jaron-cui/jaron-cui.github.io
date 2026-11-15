// Ring gears: an internal gear with its pinion in mesh inside it.
import { useMemo } from 'react';
import {
  BASE, Caption, CenterMark, Circle, DiameterDim, DimensionTable, ExportButton, FieldGroup, GeneratorSection, Grid, LinearDim, MATE_FILL,
  NumberField, PITCH, Part, ScaleBar, Sheet, SiteButton, Sym, fitView, fmt, polar, toScreen, turnUp, usePersistent,
} from './drawing';
import type { DimensionRow, Size } from './drawing';
import { svgFile } from './profile';
import { DEFAULT_RING, MIN_TEETH_DIFFERENCE, ringMesh, ringSvg } from './ring';
import type { RingMesh, RingPair } from './ring';
import { ToothFormFields } from './SpurSection';

export default function RingSection() {
  const [pair, set, reset] = usePersistent<RingPair>('gears-ring', DEFAULT_RING);
  const mesh = useMemo(() => ringMesh(pair), [pair]);
  const notes: string[] = [];
  if (pair.ringTeeth - pair.pinionTeeth < MIN_TEETH_DIFFERENCE) {
    notes.push(`With fewer than about ${MIN_TEETH_DIFFERENCE} teeth between ring and pinion, standard teeth start to foul at the tips.`);
  }
  if (mesh.ring.pointedSpaces) notes.push("The ring's tooth spaces come to a point. Reduce the dedendum.");
  if (mesh.pinion.pointed) notes.push("The pinion's teeth come to a point. Reduce the addendum.");
  return (
    <GeneratorSection id='ring' title='Ring gear' notes={notes}
      blurb={<>An internal gear with a pinion inside it, turning the same way. Each tooth space of the ring is shaped like the tooth of an external gear with the same teeth, so the ring is generated as that gear's complement.</>}
      fields={<>
        <FieldGroup title='Ring'/>
        <NumberField label='Ring teeth' value={pair.ringTeeth} min={8} max={1000} integer onChange={v => set({ ringTeeth: v })}/>
        <NumberField label='Rim (outside the roots)' unit='mm' value={pair.rim} min={0.5} max={1000} onChange={v => set({ rim: v })}/>
        <FieldGroup title='Pinion'/>
        <NumberField label='Pinion teeth' value={pair.pinionTeeth} min={4} max={Math.max(4, pair.ringTeeth - 1)} integer onChange={v => set({ pinionTeeth: v })}/>
        <NumberField label='Pinion bore' unit='mm' value={pair.pinionBore} min={0} max={10000} onChange={v => set({ pinionBore: v })}/>
        <FieldGroup title='Teeth'/>
        <ToothFormFields gear={pair} set={set}/>
      </>}
      actions={<>
        <ExportButton label='Ring SVG' name={`ring-${pair.ringTeeth}t-m${pair.module}.svg`} svg={() => ringSvg(mesh.ring)}/>
        <ExportButton label='Pinion SVG' name={`pinion-${pair.pinionTeeth}t-m${pair.module}.svg`} svg={() => svgFile(mesh.pinion)}/>
        <SiteButton onClick={reset}>Reset</SiteButton>
      </>}>
      <Caption>Ring and pinion in mesh</Caption>
      <Sheet height={520}>{size => <MeshView mesh={mesh} pair={pair} size={size}/>}</Sheet>
      <DimensionTable rows={ringRows(mesh, pair)}/>
    </GeneratorSection>
  );
}

function MeshView({ mesh, pair, size }: { mesh: RingMesh; pair: RingPair; size: Size }) {
  const { ring, pinion, centerDistance: a } = mesh;
  const pinionCenter = { x: 0, y: a };
  // A ring space and a pinion tooth both face up, where they mesh.
  const ringOutline = useMemo(() => turnUp(ring.outline), [ring]);
  const pinionOutline = useMemo(() => turnUp(pinion.outline).map(p => ({ x: p.x, y: p.y + a })), [pinion, a]);
  const rim = useMemo(() => Array.from({ length: 180 }, (_, i) => polar(ring.outer, (i / 180) * 2 * Math.PI)), [ring.outer]);
  const R = ring.outer;
  const ROW = 30;
  const view = fitView(size, { left: -R, right: R, bottom: -R, top: R }, { left: 30, right: 30, top: 18 + 2 * ROW, bottom: 30 });
  const c = toScreen(view, { x: 0, y: 0 });
  const topY = toScreen(view, { x: 0, y: R }).y;
  const boreShown = pair.pinionBore > 0 && pair.pinionBore / 2 < pinion.circles.root;
  return (
    <>
      <Grid view={view}/>
      <Part view={view} loops={[rim, ringOutline]}/>
      <Part view={view} loops={[pinionOutline]} fill={MATE_FILL} holes={boreShown ? [{ center: pinionCenter, r: pair.pinionBore / 2 }] : []}/>
      <Circle view={view} r={ring.pitch} color={PITCH} dash='10 3 2 3'/>
      <Circle view={view} r={ring.base} color={BASE} dash='2 3'/>
      <Circle view={view} center={pinionCenter} r={pinion.circles.pitch} color={PITCH} dash='10 3 2 3'/>
      <CenterMark view={view} reach={R + 2}/>
      <CenterMark view={view} center={pinionCenter} reach={pinion.circles.tip + 2}/>
      {/* Outside the ring: its root and outside diameters. Inside, below the center where the pinion
          isn't: its pitch and tip diameters. */}
      <DiameterDim view={view} r={ring.root} y={topY - 16} name='Root Ø'/>
      <DiameterDim view={view} r={ring.outer} y={topY - 16 - ROW} name='Outside Ø'/>
      <DiameterDim view={view} r={ring.pitch} y={c.y + 0.45 * ring.tip * view.z} name='Pitch Ø'/>
      <DiameterDim view={view} r={ring.tip} y={c.y + 0.45 * ring.tip * view.z + ROW} name='Tip Ø'/>
      <LinearDim view={view} a={{ x: 0, y: 0 }} b={pinionCenter} offset={Math.min(60, 0.5 * ring.tip * view.z)} label={<Sym name='a' value={fmt(a)}/>}/>
      <ScaleBar view={view}/>
    </>
  );
}

function ringRows(mesh: RingMesh, pair: RingPair): DimensionRow[] {
  const { ring, pinion, centerDistance, ratio } = mesh;
  const m = pair.module;
  return [
    { symbol: <>d</>, name: 'Ring pitch diameter', value: fmt(2 * ring.pitch), formula: <>m N<sub>r</sub></> },
    { symbol: <>d<sub>a</sub></>, name: 'Ring tip diameter (inside)', value: fmt(2 * ring.tip), formula: <>m (N<sub>r</sub> − 2h<sub>a</sub>)</> },
    { symbol: <>d<sub>f</sub></>, name: 'Ring root diameter', value: fmt(2 * ring.root), formula: <>m (N<sub>r</sub> + 2h<sub>f</sub>)</> },
    { symbol: <>D</>, name: 'Ring outside diameter', value: fmt(2 * ring.outer), formula: <>d<sub>f</sub> + 2 × rim</> },
    { symbol: <>p</>, name: 'Circular pitch', value: fmt(Math.PI * m), formula: <>π m</> },
    { symbol: <>s</>, name: 'Ring tooth thickness on the pitch circle', value: fmt((Math.PI * m) / 2 - pair.backlash), formula: <>π m / 2 − j</> },
    { symbol: <>d<sub>p</sub></>, name: 'Pinion pitch diameter', value: fmt(2 * pinion.circles.pitch), formula: <>m N<sub>p</sub></> },
    { symbol: <>d<sub>ap</sub></>, name: 'Pinion tip diameter', value: fmt(2 * pinion.circles.tip), formula: <>m (N<sub>p</sub> + 2h<sub>a</sub>)</> },
    { symbol: <>a</>, name: 'Center distance', value: fmt(centerDistance), formula: <>m (N<sub>r</sub> − N<sub>p</sub>) / 2</> },
    { symbol: <>i</>, name: 'Ratio (pinion turns per ring turn)', value: fmt(ratio), formula: <>N<sub>r</sub> / N<sub>p</sub>, same direction</> },
  ];
}
