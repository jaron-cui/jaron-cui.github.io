import { Bone } from './armature';
import { EditorDocument, SceneObject } from './document';
import { ConstraintHandlers, ConstraintList, fieldStyle, Row, Section } from './ObjectPane';

export type Brush = { weight: number; radius: number; strength: number };

type BonePaneProps = {
  document: EditorDocument;
  armature: SceneObject;
  bone: Bone;
  // A bone's place in the hierarchy belongs to edit mode, as its rest position does.
  canChangeParent: boolean;
  onRename: (name: string) => void;
  onSetParent: (parent: string | null) => void;
  constraintHandlers: ConstraintHandlers;
};

export const BonePane = ({ document, armature, bone, canChangeParent, onRename, onSetParent, constraintHandlers }: BonePaneProps) => (
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
    <ConstraintList document={document} owner={bone.id} constraints={bone.constraints} handlers={constraintHandlers} />
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
