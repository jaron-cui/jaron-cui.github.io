import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';

// Yellow on a key, green with keys elsewhere, and as in Blender, orange for a change not keyed yet.
export const KEY_STATE_COLORS = { none: undefined, animated: '#2c6e3f', keyed: '#8f7a1c', held: '#a8601e' };

const DECIMALS = 3;
const DRAG_THRESHOLD = 3;
const FINE_DRAG = 0.1;
const SNAP_DRAG = 10;

function format(value: number): string {
  return String(Number(value.toFixed(DECIMALS)));
}

type NumberFieldProps = {
  label: string;
  value: number;
  disabled?: boolean;
  style?: CSSProperties;
  // How much a pixel of dragging changes the value. Left out, the field can only be typed in.
  dragStep?: number;
  // dragging is set for changes in the middle of a drag, which should undo together.
  onCommit: (value: number, dragging?: boolean) => void;
  onDragEnd?: () => void;
};

// A number. Dragging left or right changes it, with Shift finer and Ctrl in rounder steps, and Esc
// or right click during a drag puts it back. A click without a drag types in it instead, applying on
// Enter or on leaving the field. Esc or an invalid entry restores it.
export const NumberField = ({ label, value, disabled, style, dragStep, onCommit, onDragEnd }: NumberFieldProps) => {
  const [text, setText] = useState(format(value));
  const [editing, setEditing] = useState(false);
  const discardRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) {
      setText(format(value));
    }
  }, [value, editing]);

  const commit = () => {
    const parsed = Number(text);
    const discard = discardRef.current;
    discardRef.current = false;
    setEditing(false);
    if (!discard && text.trim() !== '' && Number.isFinite(parsed) && format(parsed) !== format(value)) {
      onCommit(parsed);
    } else {
      setText(format(value));
    }
  };

  const beginDrag = (event: ReactPointerEvent) => {
    if (!dragStep || disabled || editing || event.button !== 0) {
      return;
    }
    const startX = event.clientX;
    const startValue = value;
    let dragging = false;
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointerdown', onCancelPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
    const onMove = (move: PointerEvent) => {
      const moved = move.clientX - startX;
      if (!dragging && Math.abs(moved) < DRAG_THRESHOLD) {
        return;
      }
      dragging = true;
      const raw = startValue + moved * dragStep * (move.shiftKey ? FINE_DRAG : 1);
      const snap = dragStep * SNAP_DRAG;
      const next = move.ctrlKey ? Math.round(raw / snap) * snap : raw;
      onCommit(Number(next.toFixed(DECIMALS)), true);
    };
    const onUp = () => {
      finish();
      if (dragging) {
        onDragEnd?.();
      } else {
        inputRef.current?.focus();
      }
    };
    const cancel = () => {
      finish();
      if (dragging) {
        onCommit(startValue, true);
        onDragEnd?.();
      }
    };
    const onCancelPointer = (down: PointerEvent) => {
      if (down.button === 2) {
        down.stopPropagation();
        cancel();
      }
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key === 'Escape') {
        key.stopPropagation();
        cancel();
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointerdown', onCancelPointer, true);
    window.addEventListener('keydown', onKey, true);
  };

  return (
    <input
      ref={inputRef}
      type='text'
      inputMode='decimal'
      aria-label={label}
      disabled={disabled}
      value={text}
      onPointerDown={beginDrag}
      onMouseDown={event => {
        // Focusing waits for the release, to tell a click from a drag.
        if (dragStep && !editing) {
          event.preventDefault();
        }
      }}
      onFocus={event => {
        setEditing(true);
        event.target.select();
      }}
      onChange={event => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          discardRef.current = true;
          event.currentTarget.blur();
        }
      }}
      style={{ width: '100%', minWidth: 0, background: '#14161c', color: 'inherit', border: '1px solid #3a3f4d', borderRadius: 3, padding: '1px 4px', fontVariantNumeric: 'tabular-nums', cursor: dragStep && !editing ? 'ew-resize' : undefined, ...style }}
    />
  );
};
