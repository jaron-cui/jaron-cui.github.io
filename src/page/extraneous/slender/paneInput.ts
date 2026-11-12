import { RefObject, useEffect, useRef } from 'react';

let modalRunning = false;

type Modal = { onMove: (event: PointerEvent) => void; onConfirm: () => void; onCancel: () => void };

// Runs a transformation that follows the pointer until left click or Enter confirms it, or right
// click or Esc cancels it. Until then, nothing else in the page hears clicks or keys.
export function runModal({ onMove, onConfirm, onCancel }: Modal): void {
  const finish = (done: () => void) => {
    modalRunning = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    done();
  };
  const onPointerDown = (event: PointerEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.button === 0) {
      finish(onConfirm);
    } else if (event.button === 2) {
      // The browser's menu arrives after the press that cancels.
      window.addEventListener('contextmenu', menu => menu.preventDefault(), { capture: true, once: true });
      finish(onCancel);
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === 'Enter') {
      finish(onConfirm);
    } else if (event.code === 'Escape') {
      finish(onCancel);
    }
  };
  modalRunning = true;
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
}

// Gives a pane first refusal of plain keys while the pointer is over it, as Blender's editors have.
// The handler says whether it used the key, and any it does not use go on to the viewport. The
// pointer's last position is returned for transformations to start from.
export function usePaneKeys(rootRef: RefObject<HTMLElement | null>, enabled: boolean, handler: (event: KeyboardEvent) => boolean): RefObject<{ x: number; y: number }> {
  const pointerRef = useRef({ x: 0, y: 0 });
  const latest = useRef({ enabled, handler });
  latest.current = { enabled, handler };
  useEffect(() => {
    let hovered = false;
    const onPointerMove = (event: PointerEvent) => {
      hovered = Boolean(rootRef.current?.contains(event.target as Node));
      if (hovered) {
        pointerRef.current = { x: event.clientX, y: event.clientY };
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.tagName === 'SELECT' || (target.tagName === 'INPUT' && ['number', 'text'].includes((target as HTMLInputElement).type));
      if (!hovered || modalRunning || !latest.current.enabled || typing || event.ctrlKey || event.metaKey || event.repeat) {
        return;
      }
      if (latest.current.handler(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointermove', onPointerMove, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [rootRef]);
  return pointerRef;
}
