import { useState } from 'react';

const THICKNESS = 5;

type PaneDividerProps = {
  // A vertical divider separates panes side by side, and is dragged sideways.
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  // Whether dragging right or down makes the value smaller, for a pane after the divider.
  inverted: boolean;
  label: string;
  onChange: (value: number) => void;
};

// A draggable border between two panes, resizing the pane whose size is the value.
export const PaneDivider = ({ orientation, value, min, max, inverted, label, onChange }: PaneDividerProps) => {
  const [hovered, setHovered] = useState(false);
  const [dragStart, setDragStart] = useState<{ pointer: number; value: number } | null>(null);
  const vertical = orientation === 'vertical';

  return (
    <div
      role='separator'
      aria-label={label}
      aria-orientation={orientation}
      aria-valuenow={value}
      data-testid={`divider-${orientation}`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={event => {
        if (event.button === 0) {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragStart({ pointer: vertical ? event.clientX : event.clientY, value });
        }
      }}
      onPointerMove={event => {
        if (dragStart) {
          const moved = (vertical ? event.clientX : event.clientY) - dragStart.pointer;
          onChange(Math.max(min, Math.min(max, dragStart.value + (inverted ? -moved : moved))));
        }
      }}
      onPointerUp={() => setDragStart(null)}
      style={{
        flexShrink: 0,
        [vertical ? 'width' : 'height']: THICKNESS,
        cursor: vertical ? 'col-resize' : 'row-resize',
        background: hovered || dragStart ? '#5aa9ff' : '#3a3f4d',
        touchAction: 'none',
      }}
    />
  );
};
