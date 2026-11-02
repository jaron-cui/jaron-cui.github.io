import { AnimatedVertex, keyState } from './keyframes';
import { Rotation, Vec3 } from './model';
import { KEY_STATE_COLORS, NumberField } from './NumberField';

const AXES = ['x', 'y', 'z'] as const;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export type TransformField = 'position' | 'rotation' | 'scale';
export type TransformAxis = 'w' | 'x' | 'y' | 'z';
type ChangeAxis = (axis: 'x' | 'y' | 'z', value: number, dragging?: boolean) => void;

// An object's or bone's own transform, or the median of selected vertices.
type TransformSection = {
  id: string;
  name: string;
  // The same three as keyed, which say how each field is colored.
  animated: { position: AnimatedVertex; rotation: AnimatedVertex; scale: AnimatedVertex };
  position: Vec3;
  rotation: Rotation;
  scale: Vec3;
  onChange: (field: TransformField, axis: TransformAxis, value: number, dragging?: boolean) => void;
  onRotationMode: (quaternion: boolean) => void;
};
type VerticesSection = { name: string; count: number; median: Vec3; animated: AnimatedVertex[]; onChange: ChangeAxis };

type TransformPanelProps = {
  vertices?: VerticesSection;
  transform?: TransformSection;
  message?: string;
  time: number;
  cursor: Vec3;
  onCursorChange: ChangeAxis;
  onDragEnd: () => void;
};

const panelStyle = {
  position: 'absolute' as const,
  top: 8,
  right: 8,
  width: 190,
  maxHeight: 'calc(100% - 16px)',
  overflowY: 'auto' as const,
  boxSizing: 'border-box' as const,
  padding: '8px 10px',
  background: 'rgba(28, 31, 39, 0.94)',
  border: '1px solid #3a3f4d',
  borderRadius: 4,
};

const LOCATION_DRAG = 1;
const ROTATION_DRAG = 1;
const QUATERNION_DRAG = 0.005;
const SCALE_DRAG = 0.01;

function field(title: string, axis: string, value: number, dragStep: number, onCommit: (value: number, dragging?: boolean) => void, onDragEnd: () => void, background?: string) {
  return (
    <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
      <span style={{ width: 12, textTransform: 'uppercase', opacity: 0.8 }}>{axis}</span>
      <NumberField label={`${title} ${axis.toUpperCase()}`} value={value} dragStep={dragStep} onCommit={onCommit} onDragEnd={onDragEnd} style={background ? { background } : undefined} />
    </div>
  );
}

// keyed names what hovering here and pressing I keys, with the time to color its fields for.
type Keyed = { property: object; sources: AnimatedVertex[]; time: number };

function fieldColor({ sources, time }: Keyed, axis: 'w' | 'x' | 'y' | 'z') {
  return KEY_STATE_COLORS[keyState(sources.map(source => source[axis]), time)];
}

function vectorRows(title: string, value: Vec3, dragStep: number, onChange: ChangeAxis, onDragEnd: () => void, keyed?: Keyed) {
  return (
    <div key={title} data-key-property={keyed && JSON.stringify(keyed.property)} style={{ marginBottom: 8 }}>
      <div style={{ opacity: 0.7, marginBottom: 2 }}>{title}</div>
      {AXES.map(axis => field(title, axis, value[axis], dragStep, (next, dragging) => onChange(axis, next, dragging), onDragEnd, keyed && fieldColor(keyed, axis)))}
    </div>
  );
}

const Heading = ({ children }: { children: string }) => <div style={{ fontWeight: 600, marginBottom: 6 }}>{children}</div>;

function rotationRows({ id, animated, rotation, onChange, onRotationMode }: TransformSection, onDragEnd: () => void, time: number) {
  const isQuaternion = rotation.w !== undefined;
  const keyed: Keyed = { property: { kind: 'transform', id, part: 1 }, sources: [animated.rotation], time };
  return (
    <div data-key-property={JSON.stringify(keyed.property)} style={{ marginBottom: 8 }}>
      <div style={{ opacity: 0.7, marginBottom: 2 }}>Rotation</div>
      <div className='slender-segments' role='group' aria-label='Rotation mode' data-testid='rotation-mode' style={{ marginBottom: 4 }}>
        {[false, true].map(quaternion => (
          <button
            key={String(quaternion)}
            aria-pressed={isQuaternion === quaternion}
            onMouseDown={event => event.preventDefault()}
            onClick={() => onRotationMode(quaternion)}
          >
            {quaternion ? 'Quaternion' : 'Euler'}
          </button>
        ))}
      </div>
      {isQuaternion
        ? (['w', ...AXES] as const).map(axis => field('Quaternion', axis, rotation[axis]!, QUATERNION_DRAG, (next, dragging) => onChange('rotation', axis, next, dragging), onDragEnd, fieldColor(keyed, axis)))
        : AXES.map(axis => field('Rotation', axis, rotation[axis] * DEGREES_PER_RADIAN, ROTATION_DRAG, (next, dragging) => onChange('rotation', axis, next / DEGREES_PER_RADIAN, dragging), onDragEnd, fieldColor(keyed, axis)))}
    </div>
  );
}

// The N panel: exact values for what is selected, and always for the scene cursor.
export const TransformPanel = ({ vertices, transform, message, time, cursor, onCursorChange, onDragEnd }: TransformPanelProps) => (
  <div data-testid='n-panel' style={panelStyle}>
    {message && <div style={{ opacity: 0.7, marginBottom: 8 }}>{message}</div>}
    {vertices && (
      <>
        <Heading>{vertices.name}</Heading>
        {vectorRows(vertices.count === 1 ? 'Vertex' : `Median of ${vertices.count} vertices`, vertices.median, LOCATION_DRAG, vertices.onChange, onDragEnd, { property: { kind: 'vertices' }, sources: vertices.animated, time })}
        <div style={{ opacity: 0.6, fontSize: 12, marginBottom: 8 }}>Relative to the object's origin.</div>
      </>
    )}
    {transform && (
      <>
        <Heading>{transform.name}</Heading>
        {vectorRows('Location', transform.position, LOCATION_DRAG, (axis, value, dragging) => transform.onChange('position', axis, value, dragging), onDragEnd, { property: { kind: 'transform', id: transform.id, part: 0 }, sources: [transform.animated.position], time })}
        {rotationRows(transform, onDragEnd, time)}
        {vectorRows('Scale', transform.scale, SCALE_DRAG, (axis, value, dragging) => transform.onChange('scale', axis, value, dragging), onDragEnd, { property: { kind: 'transform', id: transform.id, part: 2 }, sources: [transform.animated.scale], time })}
      </>
    )}
    <Heading>View</Heading>
    {vectorRows('3D Cursor', cursor, LOCATION_DRAG, onCursorChange, onDragEnd)}
  </div>
);
