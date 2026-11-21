// Properties of the selected section (object mode) and of the active track. A global section has
// tempo, key, time signature and clef; a track section follows its global section's key, time
// signature and clef unless one is overridden. A track has the margins of its lane.
import type { ReactNode } from 'react';
import { CLEFS, Clef, Key, Scale, SCALES, tonicName } from './music';
import { globalById, Score, SectionAttributes, sectionAttributes, TimeSignature } from './score';
import { SectionRef } from './state';

export type PropertiesProps = {
  score: Score;
  section: SectionRef | null;
  activeTrack: string;
  onGlobal: (id: string, changes: Partial<SectionAttributes & { tempo: number }>) => void;
  onOverride: (track: string, id: string, overrides: Partial<SectionAttributes>) => void;
  onMargins: (track: string, margins: { above: number; below: number }) => void;
};

const UNITS = [1, 2, 4, 8, 16, 32];
const FIELD = { background: '#232731', color: 'inherit', border: '1px solid #3a3f4d', borderRadius: 3, padding: '1px 4px' };

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px' }}>
    <span style={{ width: 64, opacity: 0.65 }}>{label}</span>
    <span style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>{children}</span>
  </label>
);

// A whole number field that reports only valid values.
const NumberField = ({ label, value, min, max, onChange, disabled }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; disabled?: boolean }) => (
  <input
    type='number'
    aria-label={label}
    value={value}
    min={min}
    max={max}
    disabled={disabled}
    onChange={event => {
      const next = Math.round(Number(event.target.value));
      if (Number.isFinite(next) && next >= min && next <= max) {
        onChange(next);
      }
    }}
    style={{ ...FIELD, width: 56 }}
  />
);

const KeyFields = ({ value, onChange, disabled }: { value: Key; onChange: (key: Key) => void; disabled?: boolean }) => (
  <>
    <select aria-label='Key tonic' value={value.tonic} disabled={disabled} onChange={event => onChange({ ...value, tonic: Number(event.target.value) })} style={FIELD}>
      {Array.from({ length: 12 }, (_, tonic) => <option key={tonic} value={tonic}>{tonicName(tonic)}</option>)}
    </select>
    <select aria-label='Key scale' value={value.scale} disabled={disabled} onChange={event => onChange({ ...value, scale: event.target.value as Scale })} style={FIELD}>
      {SCALES.map(scale => <option key={scale} value={scale}>{scale}</option>)}
    </select>
  </>
);

const TimeFields = ({ value, onChange, disabled }: { value: TimeSignature; onChange: (time: TimeSignature) => void; disabled?: boolean }) => (
  <>
    <NumberField label='Beats per bar' value={value.beats} min={1} max={32} disabled={disabled} onChange={beats => onChange({ ...value, beats })} />
    <span>/</span>
    <select aria-label='Beat unit' value={value.unit} disabled={disabled} onChange={event => onChange({ ...value, unit: Number(event.target.value) })} style={FIELD}>
      {UNITS.map(unit => <option key={unit} value={unit}>{unit}</option>)}
    </select>
  </>
);

const ClefField = ({ value, onChange, disabled }: { value: Clef; onChange: (clef: Clef) => void; disabled?: boolean }) => (
  <select aria-label='Clef' value={value} disabled={disabled} onChange={event => onChange(event.target.value as Clef)} style={FIELD}>
    {CLEFS.map(clef => <option key={clef} value={clef}>{clef}</option>)}
  </select>
);

const Heading = ({ children }: { children: ReactNode }) => (
  <div style={{ padding: '6px 10px 2px', opacity: 0.7, borderTop: '1px solid #2a2e39' }}>{children}</div>
);

export const Properties = ({ score, section, activeTrack, onGlobal, onOverride, onMargins }: PropertiesProps) => {
  const track = score.tracks[activeTrack];
  const global = section?.kind === 'global' ? globalById(score, section.id) : undefined;
  const trackSection = section?.kind === 'track' ? score.tracks[section.track]?.sections.find(other => other.id === section.id) : undefined;

  return (
    <div aria-label='Properties' style={{ paddingBottom: 8 }}>
      {global && (
        <>
          <Heading>Global section</Heading>
          <Row label='Tempo'>
            <NumberField label='Tempo' value={global.tempo} min={1} max={999} onChange={tempo => onGlobal(global.id, { tempo })} />
            <span style={{ opacity: 0.65 }}>quarters/min</span>
          </Row>
          <Row label='Key'><KeyFields value={global.key} onChange={key => onGlobal(global.id, { key })} /></Row>
          <Row label='Time'><TimeFields value={global.time} onChange={time => onGlobal(global.id, { time })} /></Row>
          <Row label='Clef'><ClefField value={global.clef} onChange={clef => onGlobal(global.id, { clef })} /></Row>
        </>
      )}
      {section?.kind === 'track' && trackSection && (() => {
        const shown = sectionAttributes(score, trackSection);
        const inherited = globalById(score, trackSection.global) ?? shown;
        const override = <K extends keyof SectionAttributes>(field: K) => (
          <input
            type='checkbox'
            aria-label={`Override ${field}`}
            title='Override the global section'
            checked={trackSection.overrides[field] !== undefined}
            onChange={event => {
              const { [field]: _, ...rest } = trackSection.overrides;
              onOverride(section.track, trackSection.id, event.target.checked ? { ...rest, [field]: inherited[field] } : rest);
            }}
          />
        );
        const set = (changes: Partial<SectionAttributes>) => onOverride(section.track, trackSection.id, { ...trackSection.overrides, ...changes });
        return (
          <>
            <Heading>Track section</Heading>
            <Row label='Key'>{override('key')}<KeyFields value={shown.key} disabled={!trackSection.overrides.key} onChange={key => set({ key })} /></Row>
            <Row label='Time'>{override('time')}<TimeFields value={shown.time} disabled={!trackSection.overrides.time} onChange={time => set({ time })} /></Row>
            <Row label='Clef'>{override('clef')}<ClefField value={shown.clef} disabled={!trackSection.overrides.clef} onChange={clef => set({ clef })} /></Row>
          </>
        );
      })()}
      {track && (
        <>
          <Heading>Track: {track.name}</Heading>
          <Row label='Above'>
            <NumberField label='Margin above' value={track.margins.above} min={0} max={48} onChange={above => onMargins(track.id, { ...track.margins, above })} />
            <span style={{ opacity: 0.65 }}>semitones</span>
          </Row>
          <Row label='Below'>
            <NumberField label='Margin below' value={track.margins.below} min={0} max={48} onChange={below => onMargins(track.id, { ...track.margins, below })} />
            <span style={{ opacity: 0.65 }}>semitones</span>
          </Row>
        </>
      )}
    </div>
  );
};
