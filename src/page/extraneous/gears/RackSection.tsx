// Rack and pinion: the rack with its pinion in mesh above it, dimensioned for building: tooth
// pitch and heights, the flank angle, and how high the pinion's axis sits.
import { useMemo } from 'react';
import {
  AngleMark, Caption, CenterMark, Circle, DimensionTable, ExportButton, FieldGroup, GeneratorSection, Grid, Line, LinearDim, MATE_FILL, MUTED,
  NumberField, PITCH, Part, ScaleBar, Sheet, SiteButton, Sym, fitView, fmt, toScreen, usePersistent,
} from './drawing';
import type { DimensionRow, Size } from './drawing';
import { pitchThickness, svgFile } from './profile';
import type { Vec2 } from './profile';
import { DEFAULT_RACK, maxRackFillet, pinionOf, rackMesh, rackSvg } from './rack';
import type { RackMesh, RackPair } from './rack';
import { ToothFormFields } from './SpurSection';

export default function RackSection() {
  const [pair, set, reset] = usePersistent<RackPair>('gears-rack', DEFAULT_RACK);
  const mesh = useMemo(() => rackMesh(pair), [pair]);
  const notes: string[] = [];
  if (mesh.rack.tipLand <= 0) notes.push("The rack's teeth come to a point below their tips. Reduce the addendum.");
  if (mesh.pinion.pointed) notes.push("The pinion's teeth come to a point. Reduce its profile shift or the addendum.");
  if (pair.rootFillet > maxRackFillet(pair) + 1e-9) notes.push(`The rack's root fillet is limited to ${fmt(maxRackFillet(pair))} × m, the most that fits.`);
  return (
    <GeneratorSection id='rack' title='Rack and pinion' notes={notes}
      blurb={<>A straight rack, which is the basic rack itself, and a spur pinion rolling on its pitch line. One turn of the pinion moves the rack π m N.</>}
      fields={<>
        <FieldGroup title='Rack'/>
        <NumberField label='Rack teeth' value={pair.rackTeeth} min={1} max={500} integer onChange={v => set({ rackTeeth: v })}/>
        <NumberField label='Back height (below roots)' unit='mm' value={pair.backHeight} min={0} max={1000} onChange={v => set({ backHeight: v })}/>
        <FieldGroup title='Pinion'/>
        <NumberField label='Pinion teeth (N)' value={pair.pinionTeeth} min={4} max={400} integer onChange={v => set({ pinionTeeth: v })}/>
        <NumberField label='Profile shift (x)' unit='× m' value={pair.pinionShift} min={-1} max={1.5} onChange={v => set({ pinionShift: v })}/>
        <NumberField label='Pinion bore' unit='mm' value={pair.pinionBore} min={0} max={10000} onChange={v => set({ pinionBore: v })}/>
        <FieldGroup title='Teeth'/>
        <ToothFormFields gear={pair} set={set}/>
      </>}
      actions={<>
        <ExportButton label='Rack SVG' name={`rack-${pair.rackTeeth}t-m${pair.module}.svg`} svg={() => rackSvg(mesh.rack)}/>
        <ExportButton label='Pinion SVG' name={`pinion-${pair.pinionTeeth}t-m${pair.module}.svg`} svg={() => svgFile(mesh.pinion)}/>
        <SiteButton onClick={reset}>Reset</SiteButton>
      </>}>
      <Caption>Rack and pinion in mesh (green: the pitch line and pitch circle)</Caption>
      <Sheet>{size => <MeshView mesh={mesh} pair={pair} size={size}/>}</Sheet>
      <DimensionTable rows={rackRows(mesh, pair)}/>
    </GeneratorSection>
  );
}

function MeshView({ mesh, pair, size }: { mesh: RackMesh; pair: RackPair; size: Size }) {
  const { rack, pinion, axisHeight } = mesh;
  const center = { x: 0, y: axisHeight };
  // Pinion tooth 0 points down, into the rack's space at x = 0.
  const pinionOutline = useMemo(() => pinion.outline.map(p => ({ x: p.y + center.x, y: -p.x + center.y })), [pinion, axisHeight]);
  const ra = pinion.circles.tip;
  const left = Math.min(...rack.outline.map(p => p.x));
  const right = Math.max(...rack.outline.map(p => p.x), ra);
  const view = fitView(size, { left: Math.min(left, -ra), right, bottom: rack.back, top: axisHeight + ra }, { left: 110, right: 130, top: 24, bottom: 34 });
  const S = (p: Vec2) => toScreen(view, p);
  const boreShown = pair.pinionBore > 0 && pair.pinionBore / 2 < pinion.circles.root;

  // The pressure angle on the right flank of the last tooth, where it crosses the pitch line.
  const a = (pair.pressureAngle * Math.PI) / 180;
  const last = rack.teeth[rack.teeth.length - 1];
  const halfTooth = rack.pitch / 4 - pair.backlash / 2;
  const flankPoint = S({ x: last + halfTooth, y: 0 });
  const up = { x: 0, y: -1 };
  const flankUp = { x: -Math.sin(a), y: -Math.cos(a) };
  const n = rack.teeth.length;

  return (
    <>
      <Grid view={view}/>
      <Part view={view} loops={[rack.outline]}/>
      <Part view={view} loops={[pinionOutline]} fill={MATE_FILL} holes={boreShown ? [{ center, r: pair.pinionBore / 2 }] : []}/>
      <Line a={S({ x: left - 4, y: 0 })} b={S({ x: Math.max(...rack.outline.map(p => p.x)) + 4, y: 0 })} color={PITCH} width={0.8} dash='10 3 2 3'/>
      <Circle view={view} center={center} r={pinion.circles.pitch} color={PITCH} dash='10 3 2 3'/>
      <CenterMark view={view} center={center} reach={ra + 2}/>
      {/* Circular pitch, between the first two teeth's centers, above the tips. */}
      {n >= 2 && (
        <LinearDim view={view} a={{ x: rack.teeth[0], y: rack.tip }} b={{ x: rack.teeth[1], y: rack.tip }} offset={22} label={<Sym name='p' value={fmt(rack.pitch)}/>}/>
      )}
      {/* Tooth heights at the rack's left end. */}
      <LinearDim view={view} a={{ x: left, y: rack.root }} b={{ x: left, y: 0 }} offset={16} label={<Sym name='h' sub='f' value={fmt(-rack.root)}/>}/>
      <LinearDim view={view} a={{ x: left, y: 0 }} b={{ x: left, y: rack.tip }} offset={16} label={<Sym name='h' sub='a' value={fmt(rack.tip)}/>}/>
      <LinearDim view={view} a={{ x: left, y: rack.back }} b={{ x: left, y: 0 }} offset={64} label={<Sym name='H' value={fmt(-rack.back)}/>}/>
      {/* The flank angle against the vertical. */}
      <Line a={flankPoint} b={{ x: flankPoint.x, y: flankPoint.y - 40 }} width={0.8}/>
      <AngleMark at={flankPoint} from={up} to={flankUp} radius={30} label={<Sym name='α' value={`${fmt(pair.pressureAngle)}°`}/>}/>
      {/* How high the pinion sits: above the pitch line, and above the rack's back. */}
      <LinearDim view={view} a={{ x: Math.max(right, ra), y: 0 }} b={{ x: Math.max(right, ra), y: axisHeight }} offset={-20} label={<Sym name='a' value={fmt(axisHeight)}/>}/>
      <LinearDim view={view} a={{ x: Math.max(right, ra), y: rack.back }} b={{ x: Math.max(right, ra), y: axisHeight }} offset={-76} label={<Sym name='A' value={fmt(axisHeight - rack.back)}/>}/>
      <ScaleBar view={view}/>
      <text x={8} y={16} fontSize={11} fill={MUTED}>{`${pair.rackTeeth} rack teeth, ${pair.pinionTeeth}-tooth pinion`}</text>
    </>
  );
}

function rackRows(mesh: RackMesh, pair: RackPair): DimensionRow[] {
  const { rack, pinion, axisHeight, travelPerTurn } = mesh;
  return [
    { symbol: <>p</>, name: 'Circular pitch (tooth to tooth)', value: fmt(rack.pitch), formula: <>π m</> },
    { symbol: <>s</>, name: 'Rack tooth thickness on the pitch line', value: fmt(rack.pitch / 2 - pair.backlash), formula: <>π m / 2 − j</> },
    { symbol: <>h<sub>a</sub></>, name: 'Rack addendum', value: fmt(rack.tip), formula: <>h<sub>a</sub> m</> },
    { symbol: <>h<sub>f</sub></>, name: 'Rack dedendum', value: fmt(-rack.root), formula: <>h<sub>f</sub> m</> },
    { symbol: <>α</>, name: 'Flank angle from vertical', value: `${fmt(pair.pressureAngle)}°`, formula: <>the pressure angle</> },
    { symbol: <>H</>, name: 'Rack back to pitch line', value: fmt(-rack.back), formula: <>back height + h<sub>f</sub> m</> },
    { symbol: <>L</>, name: 'Rack length', value: fmt(rack.length), formula: <>rack teeth × p</> },
    { symbol: <>d</>, name: 'Pinion pitch diameter', value: fmt(2 * pinion.circles.pitch), formula: <>m N</> },
    { symbol: <>d<sub>a</sub></>, name: 'Pinion tip diameter', value: fmt(2 * pinion.circles.tip), formula: <>m (N + 2h<sub>a</sub> + 2x)</> },
    { symbol: <>s<sub>p</sub></>, name: 'Pinion tooth thickness on the pitch circle', value: fmt(pitchThickness(pinionOf(pair))), formula: <>m (π/2 + 2x tan α) − j</> },
    { symbol: <>a</>, name: 'Pitch line to pinion axis', value: fmt(axisHeight), formula: <>m N / 2 + x m</> },
    { symbol: <>A</>, name: 'Rack back to pinion axis', value: fmt(axisHeight - rack.back), formula: <>H + a</> },
    { symbol: <>v</>, name: 'Rack travel per pinion turn', value: fmt(travelPerTurn), formula: <>π m N</> },
  ];
}
