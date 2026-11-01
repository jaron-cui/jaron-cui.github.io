import { Vec3 } from './model';
import { NumberField } from './NumberField';

const AXES = ['x', 'y', 'z'] as const;
const DEGREES_PER_RADIAN = 180 / Math.PI;

export type TransformField = 'position' | 'rotation' | 'scale';

type TransformPanelProps =
  | {
    kind: 'object';
    name: string;
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
    onChange: (field: TransformField, axis: 'x' | 'y' | 'z', value: number, dragging?: boolean) => void;
    onDragEnd: () => void;
  }
  | {
    kind: 'vertices';
    name: string;
    count: number;
    median: Vec3;
    onChange: (axis: 'x' | 'y' | 'z', value: number, dragging?: boolean) => void;
    onDragEnd: () => void;
  }
  | { kind: 'empty'; message: string };

const panelStyle = {
  position: 'absolute' as const,
  top: 8,
  right: 8,
  width: 190,
  padding: '8px 10px',
  background: 'rgba(28, 31, 39, 0.94)',
  border: '1px solid #3a3f4d',
  borderRadius: 4,
};

const LOCATION_DRAG = 1;
const ROTATION_DRAG = 1;
const SCALE_DRAG = 0.01;

function vectorRows(title: string, value: Vec3, dragStep: number, onChange: (axis: 'x' | 'y' | 'z', value: number, dragging?: boolean) => void, onDragEnd: () => void) {
  return (
    <div key={title} style={{ marginBottom: 8 }}>
      <div style={{ opacity: 0.7, marginBottom: 2 }}>{title}</div>
      {AXES.map(axis => (
        <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ width: 12, textTransform: 'uppercase', opacity: 0.8 }}>{axis}</span>
          <NumberField label={`${title} ${axis.toUpperCase()}`} value={value[axis]} dragStep={dragStep} onCommit={(next, dragging) => onChange(axis, next, dragging)} onDragEnd={onDragEnd} />
        </div>
      ))}
    </div>
  );
}

function scaled({ x, y, z }: Vec3, factor: number): Vec3 {
  return { x: x * factor, y: y * factor, z: z * factor };
}

// The N panel: exact values for the active object's transform, or for the selected vertices' median.
export const TransformPanel = (props: TransformPanelProps) => {
  if (props.kind === 'empty') {
    return <div data-testid='n-panel' style={panelStyle}><span style={{ opacity: 0.7 }}>{props.message}</span></div>;
  }
  if (props.kind === 'vertices') {
    const title = props.count === 1 ? 'Vertex' : `Median of ${props.count} vertices`;
    return (
      <div data-testid='n-panel' style={panelStyle}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{props.name}</div>
        {vectorRows(title, props.median, LOCATION_DRAG, props.onChange, props.onDragEnd)}
        <div style={{ opacity: 0.6, fontSize: 12 }}>Relative to the object's origin.</div>
      </div>
    );
  }
  const { name, position, rotation, scale, onChange, onDragEnd } = props;
  return (
    <div data-testid='n-panel' style={panelStyle}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{name}</div>
      {vectorRows('Location', position, LOCATION_DRAG, (axis, value, dragging) => onChange('position', axis, value, dragging), onDragEnd)}
      {vectorRows('Rotation (degrees)', scaled(rotation, DEGREES_PER_RADIAN), ROTATION_DRAG, (axis, value, dragging) => onChange('rotation', axis, value / DEGREES_PER_RADIAN, dragging), onDragEnd)}
      {vectorRows('Scale', scale, SCALE_DRAG, (axis, value, dragging) => onChange('scale', axis, value, dragging), onDragEnd)}
    </div>
  );
};
