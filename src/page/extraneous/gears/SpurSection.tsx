// Spur gears: one gear, drawn whole with its diameters and as a single tooth with the dimensions
// that shape it.
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Col, Row } from 'react-bootstrap';
import {
  ArcDim, AngleMark, BASE, Caption, CenterMark, Circle, CircleName, DIM, DiameterDim, DimLine, DimText, DimensionTable, ExportButton,
  GeneratorSection, Grid, Line, MUTED, NumberField, PITCH, Part, ScaleBar, Sheet, SiteButton, Sym, fitView, fmt, polar, toScreen, turnUp, usePersistent,
} from './drawing';
import type { DimensionRow, Size } from './drawing';
import { DEFAULT_GEAR, halfThicknessAt, maxRootFillet, pitchThickness, rad, spurProfile, svgFile } from './profile';
import type { SpurGear, SpurProfile, Vec2 } from './profile';

export default function SpurSection() {
  const [gear, set, reset] = usePersistent<SpurGear>('gears-spur', DEFAULT_GEAR);
  const profile = useMemo(() => spurProfile(gear), [gear]);
  const outline = useMemo(() => turnUp(profile.outline), [profile]);
  const { circles } = profile;
  const notes: string[] = [];
  if (profile.pointed) {
    notes.push('Pointed: the flanks meet below the tip circle, so the tip is cut there. Reduce profile shift or addendum.');
  }
  if (gear.rootFillet > maxRootFillet(gear) + 1e-9) {
    notes.push(`The root fillet is limited to ${fmt(maxRootFillet(gear))} × m, the most that fits.`);
  }
  if (gear.bore / 2 >= circles.root) {
    notes.push('The bore is wider than the root circle, so it is left out.');
  }
  return (
    <GeneratorSection id='spur' title='Spur gear' notes={notes}
      blurb={<>Each tooth is generated the way a hob cuts it, by rolling a rack cutter around the pitch circle, so the flanks are involutes and small gears undercut as they do when cut.</>}
      fields={<SpurFields gear={gear} set={set}/>}
      actions={<>
        <ExportButton label='Export SVG' name={`spur-${gear.teeth}t-m${gear.module}.svg`} svg={() => svgFile(profile)}/>
        <SiteButton onClick={reset}>Reset</SiteButton>
      </>}>
      <Row>
        <Col xl={7} style={{ marginBottom: 16 }}>
          <Caption>Gear</Caption>
          <Sheet>{size => <GearView profile={profile} outline={outline} size={size}/>}</Sheet>
        </Col>
        <Col xl={5} style={{ marginBottom: 16 }}>
          <Caption>Tooth</Caption>
          <Sheet>{size => <ToothView profile={profile} outline={outline} size={size}/>}</Sheet>
        </Col>
      </Row>
      <DimensionTable rows={spurRows(profile)}/>
    </GeneratorSection>
  );
}

// The fields every involute generator shares, for one gear's tooth form.
type ToothForm = Pick<SpurGear, 'module' | 'pressureAngle' | 'addendum' | 'dedendum' | 'rootFillet' | 'backlash'>;

export function ToothFormFields({ gear, set }: { gear: ToothForm; set: (patch: Partial<ToothForm>) => void }) {
  return (
    <>
      <NumberField label='Module (m)' unit='mm' value={gear.module} min={0.1} max={50} onChange={v => set({ module: v })}/>
      <NumberField label='Pressure angle (α)' unit='°' value={gear.pressureAngle} min={10} max={35} onChange={v => set({ pressureAngle: v })}/>
      <NumberField label={<>Addendum (h<sub>a</sub>)</>} unit='× m' value={gear.addendum} min={0.2} max={2} onChange={v => set({ addendum: v })}/>
      <NumberField label={<>Dedendum (h<sub>f</sub>)</>} unit='× m' value={gear.dedendum} min={0.5} max={2.5} onChange={v => set({ dedendum: v })}/>
      <NumberField label='Root fillet (ρ)' unit='× m' value={gear.rootFillet} min={0} max={1} onChange={v => set({ rootFillet: v })}/>
      <NumberField label='Backlash (j)' unit='mm' value={gear.backlash} min={0} max={5} onChange={v => set({ backlash: v })}/>
    </>
  );
}

function SpurFields({ gear, set }: { gear: SpurGear; set: (patch: Partial<SpurGear>) => void }) {
  return (
    <>
      <NumberField label='Teeth (N)' value={gear.teeth} min={4} max={400} integer onChange={v => set({ teeth: v })}/>
      <NumberField label='Profile shift (x)' unit='× m' value={gear.profileShift} min={-1} max={1.5} onChange={v => set({ profileShift: v })}/>
      <ToothFormFields gear={gear} set={set}/>
      <NumberField label='Bore' unit='mm' value={gear.bore} min={0} max={10000} onChange={v => set({ bore: v })}/>
    </>
  );
}

export function spurRows(profile: SpurProfile): DimensionRow[] {
  const { gear, circles } = profile;
  const m = gear.module;
  return [
    { symbol: <>d</>, name: 'Pitch diameter', value: fmt(2 * circles.pitch), formula: <>m · N</> },
    { symbol: <>d<sub>a</sub></>, name: 'Tip diameter', value: fmt(2 * circles.tip), formula: profile.pointed ? <>where the flanks meet (pointed)</> : <>m (N + 2h<sub>a</sub> + 2x)</> },
    { symbol: <>d<sub>f</sub></>, name: 'Root diameter', value: fmt(2 * circles.root), formula: <>m (N − 2h<sub>f</sub> + 2x)</> },
    { symbol: <>d<sub>b</sub></>, name: 'Base diameter', value: fmt(2 * circles.base), formula: <>m · N · cos α</> },
    { symbol: <>h<sub>a</sub></>, name: 'Addendum', value: fmt((gear.addendum + gear.profileShift) * m), formula: <>(h<sub>a</sub> + x) m</> },
    { symbol: <>h<sub>f</sub></>, name: 'Dedendum', value: fmt((gear.dedendum - gear.profileShift) * m), formula: <>(h<sub>f</sub> − x) m</> },
    { symbol: <>h</>, name: 'Whole depth', value: fmt(circles.tip - circles.root), formula: <>h<sub>a</sub> + h<sub>f</sub></> },
    { symbol: <>p</>, name: 'Circular pitch', value: fmt(Math.PI * m), formula: <>π m</> },
    { symbol: <>s</>, name: 'Tooth thickness on the pitch circle', value: fmt(pitchThickness(gear)), formula: <>m (π/2 + 2x tan α) − j</> },
    { symbol: <>α</>, name: 'Pressure angle', value: `${fmt(gear.pressureAngle)}°`, formula: <>between the flank's normal and the pitch circle's tangent</> },
    { symbol: <>ρ</>, name: 'Cutter tip radius (root fillet)', value: fmt(profile.fillet), formula: <>ρ m, at most what fits</> },
  ];
}

// The whole gear, with its diameters dimensioned above and below it.
function GearView({ profile, outline, size }: { profile: SpurProfile; outline: Vec2[]; size: Size }) {
  const { circles, gear } = profile;
  const boreShown = gear.bore > 0 && gear.bore / 2 < circles.root;
  const ROW = 30;
  const below = boreShown ? 3 : 2;
  const t = circles.tip;
  const view = fitView(size, { left: -t, right: t, bottom: -t, top: t }, { left: 24, right: 24, top: 18 + 2 * ROW, bottom: 28 + below * ROW });
  const topY = toScreen(view, { x: 0, y: t }).y;
  const bottomY = toScreen(view, { x: 0, y: -t }).y;
  return (
    <>
      <Grid view={view}/>
      <Part view={view} loops={[outline]} holes={boreShown ? [{ center: { x: 0, y: 0 }, r: gear.bore / 2 }] : []}/>
      <Circle view={view} r={circles.pitch} color={PITCH} dash='10 3 2 3'/>
      <Circle view={view} r={circles.base} color={BASE} dash='2 3'/>
      <CenterMark view={view} reach={t + 2}/>
      <DiameterDim view={view} r={circles.pitch} y={topY - 16} name='Pitch Ø'/>
      <DiameterDim view={view} r={circles.tip} y={topY - 16 - ROW} name='Tip Ø'/>
      <DiameterDim view={view} r={circles.root} y={bottomY + 16} name='Root Ø'/>
      <DiameterDim view={view} r={circles.base} y={bottomY + 16 + ROW} name='Base Ø'/>
      {boreShown && <DiameterDim view={view} r={gear.bore / 2} y={bottomY + 16 + 2 * ROW} name='Bore Ø'/>}
      <ScaleBar view={view}/>
    </>
  );
}

// One tooth, magnified, pointing up. The space to its left carries the addendum and dedendum; the
// space to its right carries the pressure angle and the root fillet.
export function ToothView({ profile, outline, size }: { profile: SpurProfile; outline: Vec2[]; size: Size }) {
  const { circles, gear, flank } = profile;
  const m = gear.module;
  const step = (2 * Math.PI) / gear.teeth;
  const up = Math.PI / 2;
  const depth = circles.tip - circles.root;
  const halfWidth = Math.min(circles.tip * 0.98, 1.2 * circles.pitch * step);
  const view = fitView(size, {
    left: -halfWidth, right: halfWidth,
    bottom: Math.min(circles.root - 0.3 * depth, Math.sqrt(Math.max(0, circles.root ** 2 - halfWidth ** 2))),
    top: circles.tip,
  }, { left: 16, right: 16, top: 72, bottom: 36 });
  const S = (p: Vec2) => toScreen(view, p);
  const items: ReactNode[] = [];

  // Addendum and dedendum, along the center line of the space left of the tooth.
  const space = up + step / 2;
  const at = (r: number) => S(polar(r, space));
  const [root, pitch, tip] = [at(circles.root), at(circles.pitch), at(circles.tip)];
  items.push(
    <Line key='space' a={at(circles.root - 0.1 * depth)} b={at(circles.tip + 0.15 * depth)} dash='10 3 2 3' width={0.6}/>,
    <DimLine key='ded' a={root} b={pitch}/>,
    <DimLine key='add' a={pitch} b={tip}/>,
    <DimText key='addT' x={(pitch.x + tip.x) / 2 - 8} y={(pitch.y + tip.y) / 2 + 4} anchor='end' name='h' sub='a' value={fmt((gear.addendum + gear.profileShift) * m)}/>,
    <DimText key='dedT' x={(root.x + pitch.x) / 2 - 8} y={(root.y + pitch.y) / 2 + 4} anchor='end' name='h' sub='f' value={fmt((gear.dedendum - gear.profileShift) * m)}/>,
  );

  // Tooth thickness: the arc across the tooth on the pitch circle, labeled inside the tooth.
  const worldArc = (r: number, from: number, to: number) => Array.from({ length: 33 }, (_, i) => S(polar(r, from + ((to - from) * i) / 32)));
  const half = halfThicknessAt(flank, circles.pitch);
  const sLabel = S({ x: 0, y: circles.pitch });
  items.push(
    <ArcDim key='s' points={worldArc(circles.pitch, up - half, up + half)}/>,
    <DimText key='sT' x={sLabel.x} y={sLabel.y + 17} name='s' value={fmt(pitchThickness(gear))}/>,
  );

  // Circular pitch: tooth center to tooth center, on an arc above the tips.
  const pr = circles.tip + 34 / view.z;
  const pitchArc = worldArc(pr, up, up + step);
  items.push(
    <Line key='pe1' a={S(polar(circles.tip + 4 / view.z, up))} b={S(polar(pr + 6 / view.z, up))} width={0.6}/>,
    <Line key='pe2' a={S(polar(circles.tip + 4 / view.z, up + step))} b={S(polar(pr + 6 / view.z, up + step))} width={0.6}/>,
    <ArcDim key='p' points={pitchArc}/>,
    <DimText key='pT' x={pitchArc[16].x} y={pitchArc[16].y - 8} name='p' value={fmt(Math.PI * m)}/>,
  );

  // Pressure angle at the pitch point P on the tooth's right flank. The flank's normal there touches
  // the base circle at T, and the angle between it and the pitch circle's tangent is α. Both lines
  // run through P, and the angle is marked on the side facing the empty space.
  const a = rad(gear.pressureAngle);
  const thetaP = up - half;
  const [sp, st] = [S(polar(circles.pitch, thetaP)), S(polar(circles.base, thetaP + a))];
  const len = Math.hypot(sp.x - st.x, sp.y - st.y) || 1;
  const out = { x: (sp.x - st.x) / len, y: (sp.y - st.y) / len };
  const along = { x: Math.sin(thetaP), y: Math.cos(thetaP) };
  items.push(
    <Line key='loa' a={st} b={{ x: sp.x + out.x * 52, y: sp.y + out.y * 52 }} width={0.8}/>,
    <Line key='tan' a={{ x: sp.x - along.x * 24, y: sp.y - along.y * 24 }} b={{ x: sp.x + along.x * 52, y: sp.y + along.y * 52 }} width={0.8}/>,
    <circle key='T' cx={st.x} cy={st.y} r={2.5} fill={BASE}/>,
    <circle key='P' cx={sp.x} cy={sp.y} r={2.5} fill={DIM}/>,
    <AngleMark key='alpha' at={sp} from={along} to={out} radius={30} label={<Sym name='α' value={`${fmt(gear.pressureAngle)}°`}/>}/>,
  );

  // Root fillet: a leader from the fillet on the far side of the right space.
  const fr = circles.root + Math.min(profile.fillet * 0.5, depth * 0.12);
  const fp = S(polar(fr, up - step + halfThicknessAt(flank, fr)));
  const lp = { x: fp.x + 26, y: fp.y + 30 };
  items.push(
    <Line key='fl' a={fp} b={lp} width={0.8}/>,
    <circle key='fd' cx={fp.x} cy={fp.y} r={2} fill={DIM}/>,
    <DimText key='fT' x={lp.x + 3} y={lp.y + 12} anchor='start' name='ρ' value={fmt(profile.fillet)}/>,
  );

  return (
    <>
      <Grid view={view}/>
      <Part view={view} loops={[outline]}/>
      <Circle view={view} r={circles.tip} color='#aaaaaa' dash='1 3'/>
      <Circle view={view} r={circles.root} color='#aaaaaa' dash='1 3'/>
      <Circle view={view} r={circles.pitch} color={PITCH} dash='10 3 2 3'/>
      <Circle view={view} r={circles.base} color={BASE} dash='2 3'/>
      <CircleName view={view} r={circles.tip} name='tip' color={MUTED}/>
      <CircleName view={view} r={circles.pitch} name='pitch' color={PITCH}/>
      <CircleName view={view} r={circles.base} name='base' color={BASE}/>
      <CircleName view={view} r={circles.root} name='root' color={MUTED}/>
      {items}
      <ScaleBar view={view}/>
    </>
  );
}
