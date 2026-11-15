// Straight bevel gear pairs: an axial section of the pair through both axes, and either gear seen
// along its axis.
import { useMemo, useState } from 'react';
import { Col, Row } from 'react-bootstrap';
import {
  AngleMark, Caption, CenterMark, Circle, DiameterDim, DimensionTable, ExportButton, FieldGroup, GeneratorSection, Grid, Line, LinearDim, MATE_FILL,
  MUTED, NumberField, PITCH, Part, ScaleBar, Sheet, SiteButton, Sym, boxOf, fitView, fmt, toScreen, turnUp, usePersistent,
} from './drawing';
import type { DimensionRow, Size } from './drawing';
import { DEFAULT_BEVEL, bevelFrontSvg, bevelGeometry, largeEndThickness } from '../../../lib/gears/bevel';
import type { AxialPoint, BevelGear, BevelGeometry, BevelPair } from '../../../lib/gears/bevel';
import type { Vec2 } from '../../../lib/gears/spur';
import { ToothFormFields } from './SpurSection';

const NAMES = ['Pinion', 'Gear'] as const;
const deg = (radians: number) => `${fmt((radians * 180) / Math.PI)}°`;

export default function BevelSection() {
  const [pair, set, reset] = usePersistent<BevelPair>('gears-bevel', DEFAULT_BEVEL);
  const [shown, setShown] = useState<0 | 1>(0);
  const geometry = useMemo(() => bevelGeometry(pair), [pair]);
  const notes: string[] = [];
  if (pair.faceWidth > geometry.coneDistance / 3) {
    notes.push(`Face width is usually at most a third of the cone distance (${fmt(geometry.coneDistance / 3)} mm here); wider teeth get too thin at the small end.`);
  }
  geometry.gears.forEach((gear, i) => {
    if (gear.virtual.pointed) notes.push(`The ${NAMES[i].toLowerCase()}'s teeth come to a point. Reduce the addendum.`);
  });
  const setTeeth = (i: 0 | 1, v: number) => set({ teeth: (i === 0 ? [v, pair.teeth[1]] : [pair.teeth[0], v]) as [number, number] });
  const setBore = (i: 0 | 1, v: number) => set({ bores: (i === 0 ? [v, pair.bores[1]] : [pair.bores[0], v]) as [number, number] });
  return (
    <GeneratorSection id='bevel' title='Bevel gears' notes={notes}
      blurb={<>A straight bevel pair on intersecting shafts. The cones are exact; each tooth's large end is the involute tooth of a virtual spur gear with N / cos δ teeth on the back cone (Tredgold's approximation), tapering toward the apex.</>}
      fields={<>
        <FieldGroup title='Pair'/>
        <NumberField label='Pinion teeth' value={pair.teeth[0]} min={5} max={200} integer onChange={v => setTeeth(0, v)}/>
        <NumberField label='Gear teeth' value={pair.teeth[1]} min={5} max={400} integer onChange={v => setTeeth(1, v)}/>
        <NumberField label='Shaft angle (Σ)' unit='°' value={pair.shaftAngle} min={20} max={160} onChange={v => set({ shaftAngle: v })}/>
        <NumberField label='Face width (b)' unit='mm' value={pair.faceWidth} min={0.5} max={1000} onChange={v => set({ faceWidth: v })}/>
        <FieldGroup title='Teeth, at the large end'/>
        <ToothFormFields gear={pair} set={set}/>
        <FieldGroup title='Bores'/>
        <NumberField label='Pinion bore' unit='mm' value={pair.bores[0]} min={0} max={10000} onChange={v => setBore(0, v)}/>
        <NumberField label='Gear bore' unit='mm' value={pair.bores[1]} min={0} max={10000} onChange={v => setBore(1, v)}/>
      </>}
      actions={<>
        {geometry.gears.map((gear, i) => (
          <ExportButton key={i} label={`${NAMES[i]} SVG`} name={`bevel-${NAMES[i].toLowerCase()}-${gear.teeth}t-m${pair.module}.svg`} svg={() => bevelFrontSvg(gear, pair.bores[i])}/>
        ))}
        <SiteButton onClick={reset}>Reset</SiteButton>
      </>}>
      <Row>
        <Col xl={7} style={{ marginBottom: 16 }}>
          <Caption>Section through both axes</Caption>
          <Sheet>{size => <SectionView geometry={geometry} size={size}/>}</Sheet>
        </Col>
        <Col xl={5} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <Caption>Along the axis:</Caption>
            {NAMES.map((name, i) => (
              <a key={name} href='#/gears' onClick={e => { e.preventDefault(); setShown(i as 0 | 1); }}
                style={{ fontSize: 14, fontWeight: shown === i ? 700 : 400, color: shown === i ? undefined : MUTED }}>
                {name.toLowerCase()}
              </a>
            ))}
          </div>
          <Sheet>{size => <FrontView gear={geometry.gears[shown]} bore={pair.bores[shown]} size={size}/>}</Sheet>
        </Col>
      </Row>
      <DimensionTable rows={bevelRows(geometry)}/>
    </GeneratorSection>
  );
}

// Each gear's axial frame in the drawing: the apex at the origin, the pinion's axis to the right, the
// gear's axis Σ counterclockwise from it, and `side` pointing from each axis toward the shared pitch
// line.
function frames(geometry: BevelGeometry) {
  const s = (geometry.pair.shaftAngle * Math.PI) / 180;
  return [
    { axis: { x: 1, y: 0 }, side: { x: 0, y: 1 } },
    { axis: { x: Math.cos(s), y: Math.sin(s) }, side: { x: Math.sin(s), y: -Math.cos(s) } },
  ];
}

const place = (frame: { axis: Vec2; side: Vec2 }, p: AxialPoint, mirror: 1 | -1): Vec2 => ({
  x: p.axial * frame.axis.x + mirror * p.radius * frame.side.x,
  y: p.axial * frame.axis.y + mirror * p.radius * frame.side.y,
});

function SectionView({ geometry, size }: { geometry: BevelGeometry; size: Size }) {
  const [f1, f2] = frames(geometry);
  const R = geometry.coneDistance;
  const parts = geometry.gears.map((gear, i) => {
    const frame = i === 0 ? f1 : f2;
    return {
      gear, frame,
      meshing: gear.section.blank.map(p => place(frame, p, 1)),
      mirrored: gear.section.blank.map(p => place(frame, p, -1)),
    };
  });
  const all = parts.flatMap(p => [...p.meshing, ...p.mirrored]).concat([{ x: 0, y: 0 }]);
  const box = boxOf(all);
  const view = fitView(size, box, { left: 70, right: 100, top: 50, bottom: 40 });
  const S = (p: Vec2) => toScreen(view, p);
  const o = S({ x: 0, y: 0 });
  const unit = (v: Vec2) => {
    const l = Math.hypot(v.x, v.y) || 1;
    return { x: v.x / l, y: v.y / l };
  };
  const screenDir = (v: Vec2) => unit({ x: v.x, y: -v.y });

  return (
    <>
      <Grid view={view}/>
      {parts.map(({ meshing, mirrored }, i) => (
        <Part key={i} view={view} loops={[meshing, mirrored]} fill={i === 0 ? undefined : MATE_FILL}/>
      ))}
      {parts.map(({ gear, frame }, i) => {
        const reach = Math.max(...gear.section.blank.map(p => p.axial)) + 4;
        const items = [];
        // The axis, through the apex.
        const axisEnd = S({ x: frame.axis.x * reach, y: frame.axis.y * reach });
        const axisStart = S({ x: -frame.axis.x * 6, y: -frame.axis.y * 6 });
        items.push(<Line key='axis' a={axisStart} b={axisEnd} color={MUTED} width={0.8} dash='10 3 2 3'/>);
        // Pitch cone lines (both halves) and the root cone line separating teeth from the body.
        for (const mirror of [1, -1] as const) {
          const pitchEnd = place(frame, { axial: (R + 3) * Math.cos(gear.pitchAngle), radius: (R + 3) * Math.sin(gear.pitchAngle) }, mirror);
          items.push(<Line key={`p${mirror}`} a={o} b={S(pitchEnd)} color={PITCH} width={0.8} dash='10 3 2 3'/>);
          const [, , backRoot, innerRoot] = gear.section.tooth;
          items.push(<Line key={`r${mirror}`} a={S(place(frame, innerRoot, mirror))} b={S(place(frame, backRoot, mirror))} color='#999999' width={0.6}/>);
        }
        // Dimensions go on the mirrored half, which has free space around it.
        const back = (s: number) => place(frame, { axial: s * Math.cos(gear.pitchAngle), radius: s * Math.sin(gear.pitchAngle) }, -1);
        const pitchDir = screenDir({ x: back(1).x, y: back(1).y });
        const axisDir = screenDir(frame.axis);
        const b = Math.min(geometry.pair.faceWidth, R * 0.9);
        // Offsets are to the left of a → b; pick the side away from the gear's own axis.
        const away = i === 0 ? 1 : -1;
        items.push(
          <AngleMark key='delta' at={o} from={axisDir} to={pitchDir} radius={42 + i * 16} label={<Sym name='δ' sub={String(i + 1)} value={deg(gear.pitchAngle)}/>}/>,
          <LinearDim key='b' view={view} a={back(R - b)} b={back(R)} offset={away * -(gear.addendumAngle * R * view.z + 22)} label={<Sym name='b' value={fmt(b)}/>}/>,
        );
        if (i === 0) {
          items.push(<LinearDim key='R' view={view} a={{ x: 0, y: 0 }} b={back(R)} offset={-(gear.addendumAngle * R * view.z + 52)} label={<Sym name='R' value={fmt(R)}/>}/>);
        }
        // Outside diameter across the large-end tips, beside the back face.
        const [, backTip] = gear.section.tooth;
        const tipA = place(frame, backTip, 1);
        const tipB = place(frame, backTip, -1);
        const backFace = Math.max(...gear.section.blank.map(p => p.axial));
        const behind = (backFace - backTip.axial) * view.z + 26;
        items.push(<LinearDim key='da' view={view} a={i === 0 ? tipA : tipB} b={i === 0 ? tipB : tipA} offset={behind} label={<Sym name='d' sub={`a${i + 1}`} value={fmt(gear.tipDiameter)}/>}/>);
        return <g key={i}>{items}</g>;
      })}
      {/* The shaft angle, in the free quadrant opposite the mesh. */}
      <AngleMark at={o} from={screenDir({ x: -f1.axis.x, y: -f1.axis.y })} to={screenDir({ x: -f2.axis.x, y: -f2.axis.y })} radius={26}
        label={<Sym name='Σ' value={`${fmt(geometry.pair.shaftAngle)}°`}/>}/>
      <circle cx={o.x} cy={o.y} r={2.5} fill={PITCH}/>
      <ScaleBar view={view}/>
    </>
  );
}

function FrontView({ gear, bore, size }: { gear: BevelGear; bore: number; size: Size }) {
  const outer = useMemo(() => turnUp(gear.front.outer), [gear]);
  const inner = useMemo(() => turnUp(gear.front.inner), [gear]);
  const ra = gear.tipDiameter / 2;
  const ROW = 30;
  const boreShown = bore > 0 && bore < gear.rootDiameter * 0.9;
  const view = fitView(size, { left: -ra, right: ra, bottom: -ra, top: ra }, { left: 24, right: 24, top: 18 + 2 * ROW, bottom: 28 + (boreShown ? ROW : 0) + 10 });
  const topY = toScreen(view, { x: 0, y: ra }).y;
  const bottomY = toScreen(view, { x: 0, y: -ra }).y;
  return (
    <>
      <Grid view={view}/>
      <Part view={view} loops={[outer]} holes={boreShown ? [{ center: { x: 0, y: 0 }, r: bore / 2 }] : []}/>
      <path d={inner.map((p, i) => {
        const s = toScreen(view, p);
        return `${i ? 'L' : 'M'}${s.x.toFixed(2)} ${s.y.toFixed(2)}`;
      }).join('') + 'Z'} fill='none' stroke='#555555' strokeWidth={0.8}/>
      <Circle view={view} r={gear.pitchDiameter / 2} color={PITCH} dash='10 3 2 3'/>
      <CenterMark view={view} reach={ra + 2}/>
      <DiameterDim view={view} r={gear.pitchDiameter / 2} y={topY - 16} name='Pitch Ø'/>
      <DiameterDim view={view} r={ra} y={topY - 16 - ROW} name='Outside Ø'/>
      {boreShown && <DiameterDim view={view} r={bore / 2} y={bottomY + 16} name='Bore Ø'/>}
      <ScaleBar view={view}/>
    </>
  );
}

function bevelRows(g: BevelGeometry): DimensionRow[] {
  const { pair, coneDistance: R, gears } = g;
  const m = pair.module;
  const b = Math.min(pair.faceWidth, R * 0.9);
  const rows: DimensionRow[] = [
    { symbol: <>Σ</>, name: 'Shaft angle', value: `${fmt(pair.shaftAngle)}°`, formula: <>δ<sub>1</sub> + δ<sub>2</sub></> },
    { symbol: <>R</>, name: 'Cone distance (apex to large end)', value: fmt(R), formula: <>d<sub>1</sub> / (2 sin δ<sub>1</sub>)</> },
    { symbol: <>b</>, name: 'Face width', value: fmt(b), formula: <>given; usually ≤ R / 3</> },
    { symbol: <>m<sub>i</sub></>, name: 'Module at the small end', value: fmt((m * (R - b)) / R), formula: <>m (R − b) / R</> },
    { symbol: <>s</>, name: 'Tooth thickness at the large end', value: fmt(largeEndThickness(gears[0])), formula: <>π m / 2 − j</> },
    { symbol: <>θ<sub>a</sub></>, name: 'Addendum angle', value: deg(gears[0].addendumAngle), formula: <>atan(h<sub>a</sub> m / R)</> },
    { symbol: <>θ<sub>f</sub></>, name: 'Dedendum angle', value: deg(gears[0].dedendumAngle), formula: <>atan(h<sub>f</sub> m / R)</> },
  ];
  gears.forEach((gear, i) => {
    const n = i + 1;
    const name = NAMES[i];
    rows.push(
      { symbol: <>δ<sub>{n}</sub></>, name: `${name} pitch angle`, value: deg(gear.pitchAngle), formula: i === 0 ? <>atan(sin Σ / (N<sub>2</sub>/N<sub>1</sub> + cos Σ))</> : <>Σ − δ<sub>1</sub></> },
      { symbol: <>d<sub>{n}</sub></>, name: `${name} pitch diameter`, value: fmt(gear.pitchDiameter), formula: <>m N<sub>{n}</sub></> },
      { symbol: <>d<sub>a{n}</sub></>, name: `${name} outside diameter`, value: fmt(gear.tipDiameter), formula: <>d<sub>{n}</sub> + 2 h<sub>a</sub> m cos δ<sub>{n}</sub></> },
      { symbol: <>N<sub>v{n}</sub></>, name: `${name} virtual teeth (back cone)`, value: fmt(gear.virtualTeeth), formula: <>N<sub>{n}</sub> / cos δ<sub>{n}</sub></> },
    );
  });
  return rows;
}
