import { ReactNode } from 'react';
import { CONSTRAINT_LABELS, ConstraintKind, isSwitchedOn } from './constraints';
import { Constraint } from './constraints';
import { EditorDocument, SceneObject, validParentBones, validParents } from './document';
import { keyState, valueAt } from './keyframes';
import { Rgb } from '../../../lib/vrender/model';
import { KEY_STATE_COLORS, NumberField } from './NumberField';

export function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (value: number) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

const CONSTRAINT_KINDS = Object.keys(CONSTRAINT_LABELS) as ConstraintKind[];
const DEGREES_PER_RADIAN = 180 / Math.PI;
export const fieldStyle = { width: '100%', minWidth: 0 };

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section style={{ padding: '6px 10px', borderBottom: '1px solid #2a2e39' }}>
    <div style={{ opacity: 0.7, marginBottom: 4 }}>{title}</div>
    {children}
  </section>
);

export const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <label style={{ display: 'grid', gridTemplateColumns: '64px 1fr', alignItems: 'center', gap: 6, marginBottom: 4 }}>
    <span>{label}</span>
    {children}
  </label>
);

// Everything a constraint can follow, except the thing it is on.
function constraintTargets(document: EditorDocument, except: string): { id: string; label: string }[] {
  return [
    ...document.objects.filter(other => other.id !== except).map(({ id, name }) => ({ id, label: name })),
    ...document.objects.flatMap(armature => (armature.bones ?? [])
      .filter(bone => bone.id !== except)
      .map(bone => ({ id: bone.id, label: `${armature.name}: ${bone.name}` }))),
  ];
}

export type ConstraintHandlers = {
  onAdd: (kind: ConstraintKind) => void;
  onSetTarget: (constraintId: string, target: string | null) => void;
  onSetInfluence: (constraintId: string, influence: number) => void;
  onRemove: (constraintId: string) => void;
  // Child Of.
  onSetInverse: (constraintId: string) => void;
  onClearInverse: (constraintId: string) => void;
  onSetOn: (constraintId: string, on: boolean) => void;
  // Inverse Kinematics.
  onChange: (constraintId: string, change: Partial<Constraint>, dragging?: boolean) => void;
};

// The constraints of an object or a bone.
export const ConstraintList = ({ document, owner, isBone, time, constraints, handlers }: {
  document: EditorDocument; owner: string; isBone?: boolean; time: number; constraints: Constraint[]; handlers: ConstraintHandlers;
}) => {
  const targets = constraintTargets(document, owner);
  return (
    <>
      {constraints.map(constraint => (
        <div key={constraint.id} data-testid='constraint' style={{ border: '1px solid #2f3440', borderRadius: 3, padding: 6, marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{CONSTRAINT_LABELS[constraint.kind]}</span>
            <button aria-label={`Remove ${CONSTRAINT_LABELS[constraint.kind]}`} onClick={() => handlers.onRemove(constraint.id)}>×</button>
          </div>
          <Row label='Target'>
            <select
              aria-label='Constraint target'
              value={constraint.target ?? ''}
              onChange={event => handlers.onSetTarget(constraint.id, event.target.value || null)}
              style={fieldStyle}
            >
              <option value=''>None</option>
              {targets.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Row>
          <div
            data-testid='influence-property'
            data-key-property={JSON.stringify({ kind: 'influence', id: owner, constraintId: constraint.id })}
            style={{ background: KEY_STATE_COLORS[keyState([constraint.influence], time)], borderRadius: 3, padding: '2px 2px 0' }}
          >
            {constraint.kind === 'childOf' ? (
              <Row label='Parented'>
                <input
                  type='checkbox'
                  aria-label='Parented'
                  checked={isSwitchedOn(constraint, time)}
                  onChange={event => handlers.onSetOn(constraint.id, event.target.checked)}
                />
              </Row>
            ) : (
              <Row label='Influence'>
                <input
                  type='range'
                  aria-label='Constraint influence'
                  min={0}
                  max={1}
                  step={0.01}
                  value={valueAt(constraint.influence, time)}
                  onChange={event => handlers.onSetInfluence(constraint.id, Number(event.target.value))}
                  style={fieldStyle}
                />
              </Row>
            )}
          </div>
          {constraint.kind === 'childOf' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
              <button disabled={!constraint.target} onClick={() => handlers.onSetInverse(constraint.id)}>Set Inverse</button>
              <button disabled={!constraint.inverse} onClick={() => handlers.onClearInverse(constraint.id)}>Clear Inverse</button>
            </div>
          )}
          {constraint.kind === 'ik' && (
            <div style={{ marginTop: 4 }}>
              <Row label='Pole'>
                <select
                  aria-label='Pole target'
                  value={constraint.pole ?? ''}
                  onChange={event => handlers.onChange(constraint.id, { pole: event.target.value || null })}
                  style={fieldStyle}
                >
                  <option value=''>None</option>
                  {targets.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Row>
              <Row label='Pole angle'>
                <NumberField label='Pole angle' value={(constraint.poleAngle ?? 0) * DEGREES_PER_RADIAN} dragStep={1} onCommit={(degrees, dragging) => handlers.onChange(constraint.id, { poleAngle: degrees / DEGREES_PER_RADIAN }, dragging)} />
              </Row>
              <Row label='Chain'>
                <NumberField label='Chain length' value={constraint.chainLength ?? 0} dragStep={0.1} onCommit={(length, dragging) => handlers.onChange(constraint.id, { chainLength: Math.max(0, Math.round(length)) }, dragging)} />
              </Row>
            </div>
          )}
        </div>
      ))}
      <select
        aria-label='Add constraint'
        value=''
        onChange={event => {
          if (event.target.value) {
            handlers.onAdd(event.target.value as ConstraintKind);
          }
        }}
        style={fieldStyle}
      >
        <option value=''>Add constraint…</option>
        {CONSTRAINT_KINDS.filter(kind => isBone || kind !== 'ik').map(kind => <option key={kind} value={kind}>{CONSTRAINT_LABELS[kind]}</option>)}
      </select>
    </>
  );
};

type ObjectPaneProps = {
  document: EditorDocument;
  object: SceneObject | null;
  time: number;
  onEndStep: () => void;
  onChangeStyle: (field: string, change: (object: SceneObject) => SceneObject) => void;
  onSetParent: (parent: string | null) => void;
  constraintHandlers: ConstraintHandlers;
  // Sections that depend on the kind of object: bones, vertex groups, the brush.
  rig: ReactNode;
};

// The active object's relations, constraints, and render settings.
export const ObjectPane = ({
  document, object, time, onEndStep, onChangeStyle, onSetParent, constraintHandlers, rig,
}: ObjectPaneProps) => {
  if (!object) {
    return (
      <div data-testid='object-pane' style={{ height: '100%', background: '#1c1f27', padding: '6px 10px', opacity: 0.7 }}>
        No active object.
      </div>
    );
  }

  const { id, name, camera, bones, fill, border, parent, constraints } = object;

  return (
    <div data-testid='object-pane' onPointerDown={onEndStep} style={{ height: '100%', overflowY: 'auto', background: '#1c1f27' }}>
      <div style={{ padding: '6px 10px', fontWeight: 600, borderBottom: '1px solid #2a2e39' }}>{name}</div>

      <Section title='Relations'>
        <Row label='Parent'>
          <select aria-label='Parent' value={parent ?? ''} onChange={event => onSetParent(event.target.value || null)} style={fieldStyle}>
            <option value=''>None</option>
            {validParents(document, object).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}
            {validParentBones(document, object).map(({ armature, bone }) => <option key={bone.id} value={bone.id}>{armature.name}: {bone.name}</option>)}
          </select>
        </Row>
      </Section>

      <Section title='Constraints'>
        <ConstraintList document={document} owner={id} time={time} constraints={constraints} handlers={constraintHandlers} />
      </Section>

      {rig}

      {object.ellipsoid && (
        <Section title='Ellipsoid'>
          {(['x', 'y', 'z'] as const).map(axis => (
            <Row key={axis} label={`Radius ${axis.toUpperCase()}`}>
              <NumberField
                label={`Radius ${axis.toUpperCase()}`}
                value={object.ellipsoid!.radii[axis]}
                dragStep={1}
                onCommit={value => onChangeStyle(`ellipsoid-${axis}`, current => ({
                  ...current,
                  ellipsoid: { ...current.ellipsoid!, radii: { ...current.ellipsoid!.radii, [axis]: Math.max(0.01, value) } },
                }))}
              />
            </Row>
          ))}
          <Row label='Length'>
            <NumberField
              label='Length'
              value={object.ellipsoid.length}
              dragStep={1}
              onCommit={value => onChangeStyle('ellipsoid-length', current => ({ ...current, ellipsoid: { ...current.ellipsoid!, length: Math.max(0, value) } }))}
            />
          </Row>
          <div style={{ opacity: 0.6 }}>Swept along local Z by the length each way. Equal radii make a capsule.</div>
        </Section>
      )}

      {bones ? null : camera ? (
        <Section title='Lens'>
          <Row label='Focal'>
            <input
              type='range'
              aria-label='Focal length'
              min={200}
              max={3000}
              step={10}
              value={camera.focalLength}
              onChange={event => {
                const focalLength = Number(event.target.value);
                onChangeStyle('focal-length', current => ({ ...current, camera: { focalLength } }));
              }}
              style={fieldStyle}
            />
          </Row>
          <div style={{ opacity: 0.6, textAlign: 'right' }}>{camera.focalLength}</div>
        </Section>
      ) : (
        <Section title='Render'>
          <Row label='Fill'>
            <input
              type='color'
              aria-label='Fill color'
              value={rgbToHex(fill)}
              onChange={event => {
                const next = hexToRgb(event.target.value);
                onChangeStyle('fill', current => ({ ...current, fill: next }));
              }}
            />
          </Row>
          <Row label='Border'>
            <input
              type='color'
              aria-label='Border color'
              value={rgbToHex(border.color)}
              onChange={event => {
                const color = hexToRgb(event.target.value);
                onChangeStyle('border-color', current => ({ ...current, border: { ...current.border, color } }));
              }}
            />
          </Row>
          <Row label={`Width ${border.width}`}>
            <input
              type='range'
              aria-label='Border thickness'
              min={0}
              max={40}
              step={1}
              value={border.width}
              onChange={event => {
                const width = Number(event.target.value);
                onChangeStyle('border-width', current => ({ ...current, border: { ...current.border, width } }));
              }}
              style={fieldStyle}
            />
          </Row>
        </Section>
      )}
    </div>
  );
};
