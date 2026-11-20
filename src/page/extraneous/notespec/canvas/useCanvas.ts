// Binds a canvas to an Interaction: sizes it to its box at the screen's pixel density, redraws on
// request (at most once a frame), and turns pointer and wheel events into Interaction input in CSS
// pixels relative to the canvas. Keys are left to the page, which knows when they're for the canvas.
import { useCallback, useEffect, useRef } from 'react';
import { Frame, Interaction, PointerInput, WheelInput } from './interaction';

export type Size = { width: number; height: number };
export type Draw = (context: CanvasRenderingContext2D, frame: Frame, size: Size) => void;

export function useCanvas(interaction: Interaction, draw: Draw) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const pending = useRef(0);
  const size = useRef<Size>({ width: 0, height: 0 });

  const paint = useCallback(() => {
    pending.current = 0;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size.current.width, size.current.height);
    const frame = interaction.frame();
    drawRef.current(context, frame, size.current);
    interaction.commit(frame);
    canvas.style.cursor = interaction.cursor();
  }, [interaction]);

  const invalidate = useCallback(() => {
    if (!pending.current) {
      pending.current = requestAnimationFrame(paint);
    }
  }, [paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      size.current = { width, height };
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      paint();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const local = (event: MouseEvent) => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey };
    };
    const pointer = (event: PointerEvent): PointerInput => ({ ...local(event), button: event.button });
    const onDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      // Keys typed after a click belong to the canvas, not a field that had focus.
      (document.activeElement as HTMLElement | null)?.blur?.();
      interaction.pointerDown(pointer(event));
      canvas.style.cursor = interaction.cursor();
    };
    const onMove = (event: PointerEvent) => {
      interaction.pointerMove(pointer(event));
      canvas.style.cursor = interaction.cursor();
    };
    const onUp = (event: PointerEvent) => {
      interaction.pointerUp(pointer(event));
      canvas.style.cursor = interaction.cursor();
    };
    const onWheel = (event: WheelEvent) => {
      const input: WheelInput = { ...local(event), deltaX: event.deltaX, deltaY: event.deltaY };
      // Ctrl+wheel would zoom the page; Shift+wheel scrolls sideways on some systems (deltaX).
      if (interaction.wheel(input) || event.ctrlKey) {
        event.preventDefault();
      }
    };
    const onContextMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(pending.current);
      pending.current = 0;
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [interaction, paint]);

  return { canvasRef, invalidate };
}
