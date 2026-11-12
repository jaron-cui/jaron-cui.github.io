import { useEffect, useRef, useState } from 'react';
import { evaluateScene } from './animation';
import { DEMO_DURATION, demoScene } from './demo';
import { renderScene, View } from '../../../lib/vrender/render';

const ZOOM_PER_WHEEL_PIXEL = 1.002;

export const Slender = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timeRef = useRef(0);
  const playingRef = useRef(true);
  const viewRef = useRef<View>({ panX: 0, panY: 0, zoom: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) {
      return;
    }

    // The view's pan starts at the canvas center and keeps its offset through resizes.
    let previousWidth = 0;
    let previousHeight = 0;
    let frame = 0;
    let previousTimestamp: number | undefined;
    const tick = (timestamp: number) => {
      const { clientWidth, clientHeight } = canvas;
      const pixelRatio = window.devicePixelRatio;
      const width = Math.round(clientWidth * pixelRatio);
      const height = Math.round(clientHeight * pixelRatio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      viewRef.current.panX += (clientWidth - previousWidth) / 2;
      viewRef.current.panY += (clientHeight - previousHeight) / 2;
      previousWidth = clientWidth;
      previousHeight = clientHeight;

      if (playingRef.current && previousTimestamp !== undefined) {
        timeRef.current = (timeRef.current + (timestamp - previousTimestamp) / 1000) % DEMO_DURATION;
        setTime(timeRef.current);
      }
      previousTimestamp = timestamp;

      renderScene(ctx, evaluateScene(demoScene, timeRef.current), viewRef.current, pixelRatio);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // React registers wheel listeners as passive, which would not allow preventDefault.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const view = viewRef.current;
      const bounds = canvas.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left;
      const cursorY = event.clientY - bounds.top;
      const factor = Math.pow(ZOOM_PER_WHEEL_PIXEL, -event.deltaY);
      // Zooms about the cursor, keeping the world point beneath it in place.
      view.panX = cursorX - (cursorX - view.panX) * factor;
      view.panY = cursorY - (cursorY - view.panY) * factor;
      view.zoom *= factor;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  const togglePlaying = () => {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  };

  const scrub = (value: number) => {
    timeRef.current = value;
    setTime(value);
  };

  const pan = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.buttons === 1) {
      viewRef.current.panX += event.movementX;
      viewRef.current.panY += event.movementY;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#16181f', color: '#e6e8ef' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={pan}
        style={{ flex: 1, minHeight: 0, width: '100%', display: 'block', cursor: 'grab', touchAction: 'none' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px' }}>
        <button onClick={togglePlaying} style={{ width: 72 }}>{playing ? 'Pause' : 'Play'}</button>
        <input
          type='range'
          aria-label='Time'
          min={0}
          max={DEMO_DURATION}
          step={0.001}
          value={time}
          onChange={event => scrub(Number(event.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ width: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{time.toFixed(2)}s</span>
      </div>
    </div>
  );
};
