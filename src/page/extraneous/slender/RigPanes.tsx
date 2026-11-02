import { Bone } from './armature';
import { EditorDocument, SceneObject } from './document';
import { NumberField } from './NumberField';
import { Modifier, MirrorAxis } from './modifiers';
import { ConstraintHandlers, ConstraintList, fieldStyle, Row, Section } from './ObjectPane';

export type Brush = { weight: number; radius: number; strength: number };

type BonePaneProps = {
  document: EditorDocument;
  armature: SceneObject;
  bone: Bone;
  time: number;
  // A bone's place in the hierarchy belongs to edit mode, as its rest position does.
  canChangeParent: boolean;
  onRename: (name: string) => void;
  onSetParent: (parent: string | null) => void;
  constraintHandlers: ConstraintHandlers;
};

export const BonePane = ({ document, armature, bone, time, canChangeParent, onRename, onSetParent, constraintHandlers }: BonePaneProps) => (
  <Section title='Bone'>
    <Row label='Name'>
      <input
        key={`${bone.id}:${bone.name}`}
        type='text'
        aria-label='Bone name'
        defaultValue={bone.name}
        onBlur={event => onRename(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
        style={fieldStyle}
      />
    </Row>
    <Row label='Parent'>
      <select
        aria-label='Bone parent'
        disabled={!canChangeParent}
        value={bone.parent ?? ''}
        onChange={event => onSetParent(event.target.value || null)}
        style={fieldStyle}
      >
        <option value=''>None</option>
        {armature.bones!.filter(other => other.id !== bone.id).map(other => <option key={other.id} value={other.id}>{other.name}</option>)}
      </select>
    </Row>
    <div style={{ opacity: 0.7, margin: '6px 0 4px' }}>Bone constraints</div>
    <ConstraintList document={document} owner={bone.id} isBone time={time} constraints={bone.constraints} handlers={constraintHandlers} />
  </Section>
);

type ArmaturePaneProps = {
  armature: SceneObject;
  pairs: number;
  canSymmetrize: boolean;
  onChange: (change: Pick<SceneObject, 'mirrorEdit' | 'mirrorPose'>) => void;
  onSymmetrize: () => void;
};

export const ArmaturePane = ({ armature, pairs, canSymmetrize, onChange, onSymmetrize }: ArmaturePaneProps) => (
  <Section title='Armature'>
    <Row label='Mirror X'>
      <input type='checkbox' aria-label='Mirror edits across X' checked={Boolean(armature.mirrorEdit)} onChange={event => onChange({ mirrorEdit: event.target.checked })} />
    </Row>
    <Row label='Pose X'>
      <input type='checkbox' aria-label='Mirror poses across X' checked={Boolean(armature.mirrorPose)} onChange={event => onChange({ mirrorPose: event.target.checked })} />
    </Row>
    <div data-testid='mirror-pairs' style={{ opacity: 0.7, marginBottom: 4 }}>{pairs === 1 ? '1 mirrored pair' : `${pairs} mirrored pairs`}</div>
    <button disabled={!canSymmetrize} onClick={onSymmetrize}>Symmetrize</button>
  </Section>
);

export type ModifierHandlers = {
  onAddMirror: () => void;
  onChange: (id: string, change: Partial<Modifier>, dragging?: boolean) => void;
  onApply: (id: string) => void;
  onRemove: (id: string) => void;
};

export const ModifiersPane = ({ modifiers, handlers }: { modifiers: Modifier[]; handlers: ModifierHandlers }) => (
  <Section title='Modifiers'>
    {modifiers.map(modifier => (
      <div key={modifier.id} data-testid='modifier' style={{ border: '1px solid #2f3440', borderRadius: 3, padding: 6, marginBottom: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span>Mirror</span>
          <span style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => handlers.onApply(modifier.id)}>Apply</button>
            <button aria-label='Remove Mirror' onClick={() => handlers.onRemove(modifier.id)}>×</button>
          </span>
        </div>
        <Row label='Axis'>
          <div className='slender-segments' role='group' aria-label='Mirror axis'>
            {(['x', 'y', 'z'] as MirrorAxis[]).map(axis => (
              <button
                key={axis}
                aria-pressed={modifier.axes[axis]}
                onMouseDown={event => event.preventDefault()}
                onClick={() => handlers.onChange(modifier.id, { axes: { ...modifier.axes, [axis]: !modifier.axes[axis] } })}
              >
                {axis.toUpperCase()}
              </button>
            ))}
          </div>
        </Row>
        <Row label='Merge'>
          <input type='checkbox' aria-label='Merge at the mirror' checked={modifier.merge} onChange={event => handlers.onChange(modifier.id, { merge: event.target.checked })} />
        </Row>
        <Row label='Distance'>
          <NumberField label='Merge distance' value={modifier.threshold} dragStep={0.1} onCommit={(threshold, dragging) => handlers.onChange(modifier.id, { threshold: Math.max(0, threshold) }, dragging)} />
        </Row>
        <Row label='Clipping'>
          <input type='checkbox' aria-label='Clip at the mirror' checked={modifier.clipping} onChange={event => handlers.onChange(modifier.id, { clipping: event.target.checked })} />
        </Row>
      </div>
    ))}
    <button aria-label='Add Mirror modifier' onClick={handlers.onAddMirror}>+ Mirror</button>
  </Section>
);

type VertexGroupsPaneProps = {
  document: EditorDocument;
  mesh: SceneObject;
  weight: number;
  onSetDeformer: (armature: string | null) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onActivate: (id: string) => void;
  onWeightChange: (weight: number) => void;
  onAssign: () => void;
  onUnassign: () => void;
  onSelectMembers: (selected: boolean) => void;
};

// A mesh's armature and vertex groups. Assigning and selecting work on vertices, so they appear in edit mode.
export const VertexGroupsPane = ({
  document, mesh, weight, onSetDeformer, onAdd, onRemove, onRename, onActivate, onWeightChange, onAssign, onUnassign, onSelectMembers,
}: VertexGroupsPaneProps) => {
  const armatures = document.objects.filter(object => object.bones);
  return (
    <Section title='Vertex groups'>
      <Row label='Armature'>
        <select aria-label='Armature' value={mesh.deformer ?? ''} onChange={event => onSetDeformer(event.target.value || null)} style={fieldStyle}>
          <option value=''>None</option>
          {armatures.map(armature => <option key={armature.id} value={armature.id}>{armature.name}</option>)}
        </select>
      </Row>
      {mesh.vertexGroups.map(group => (
        <div
          key={group.id}
          data-testid='vertex-group'
          className='slender-row'
          aria-selected={mesh.activeGroup === group.id}
          onPointerDown={() => onActivate(group.id)}
          style={{ display: 'flex', gap: 4, alignItems: 'center', padding: 2, background: mesh.activeGroup === group.id ? '#3a4560' : undefined }}
        >
          <input
            key={`${group.id}:${group.name}`}
            type='text'
            aria-label={`Name of group ${group.name}`}
            defaultValue={group.name}
            onBlur={event => onRename(group.id, event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            style={{ ...fieldStyle, flex: 1 }}
          />
          <button aria-label={`Remove group ${group.name}`} onClick={() => onRemove(group.id)}>×</button>
        </div>
      ))}
      <button aria-label='Add vertex group' onClick={onAdd} style={{ marginTop: 4 }}>+ Group</button>
      {document.mode === 'edit' && mesh.activeGroup && (
        <div style={{ marginTop: 6 }}>
          <Row label={`Weight ${weight.toFixed(2)}`}>
            <input type='range' aria-label='Assign weight' min={0} max={1} step={0.01} value={weight} onChange={event => onWeightChange(Number(event.target.value))} style={fieldStyle} />
          </Row>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <button onClick={onAssign}>Assign</button>
            <button onClick={onUnassign}>Remove</button>
            <button onClick={() => onSelectMembers(true)}>Select</button>
            <button onClick={() => onSelectMembers(false)}>Deselect</button>
          </div>
        </div>
      )}
    </Section>
  );
};

export const BrushPane = ({ brush, onChange }: { brush: Brush; onChange: (brush: Brush) => void }) => (
  <Section title='Brush'>
    <Row label={`Weight ${brush.weight.toFixed(2)}`}>
      <input type='range' aria-label='Brush weight' min={0} max={1} step={0.01} value={brush.weight} onChange={event => onChange({ ...brush, weight: Number(event.target.value) })} style={fieldStyle} />
    </Row>
    <Row label={`Radius ${Math.round(brush.radius)}`}>
      <input type='range' aria-label='Brush radius' min={2} max={300} step={1} value={brush.radius} onChange={event => onChange({ ...brush, radius: Number(event.target.value) })} style={fieldStyle} />
    </Row>
    <Row label={`Strength ${brush.strength.toFixed(2)}`}>
      <input type='range' aria-label='Brush strength' min={0} max={1} step={0.01} value={brush.strength} onChange={event => onChange({ ...brush, strength: Number(event.target.value) })} style={fieldStyle} />
    </Row>
  </Section>
);
