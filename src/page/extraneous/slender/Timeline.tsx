import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Ease } from './animation';
import { CurvesEditor, KeyEdit } from './CurvesEditor';
import { changeRowKeys, curveChannels, EditorDocument, KeyRow, rowKeyEase, rowKeyTimes } from './document';
import { DeleteKeyIcon, InsertKeyIcon, PauseIcon, PlayIcon } from './icons';
import { COORDINATES, deleteKeys, EASE_IN_OUT, KeyingSet, KEYING_PROPERTIES, remapKeys, scaledTimes, setKeyEase, shiftedTimes } from './keyframes';
import { NumberField } from './NumberField';
import { runModal, usePaneKeys } from './paneInput';
import { panView, rulerTicks, TimeView, timeScaleFactor, zoomView } from './timelineView';

// Selected keys all belong to one row, since a row is what says which things a key time covers.
type KeySelection = { row: KeyRow; times: number[] };

const LABEL_WIDTH = 80;
const ROW_HEIGHT = 22;
const ACCENT = '#ffa030';
const ZOOM_PER_WHEEL_PIXEL = 1.002;
const FIT_MARGIN = 0.03;

type EaseName = 'bezier' | 'linear' | 'constant';
type PaneMode = 'keys' | 'curves';

function easeName(ease: Ease): EaseName {
  return ease === 'hold' ? 'constant' : ease === 'linear' ? 'linear' : 'bezier';
}

function easeFromName(name: EaseName): Ease {
  return { bezier: EASE_IN_OUT, linear: 'linear' as const, constant: 'hold' as const }[name];
}

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

type TimelineProps = {
  // While locked, pointer presses here do nothing, as during a transformation.
  locked: boolean;
  document: EditorDocument;
  time: number;
  playing: boolean;
  onSeek: (time: number) => void;
  onTogglePlaying: () => void;
  onFrameStartChange: (frame: number, dragging?: boolean) => void;
  onFrameEndChange: (frame: number, dragging?: boolean) => void;
  onDragEnd: () => void;
  onInsertKey: () => void;
  onEdit: (change: (document: EditorDocument) => EditorDocument) => void;
  onBeginKeyEdit: () => KeyEdit;
  onMessage: (message: string) => void;
  keying: KeyingSet;
  onKeyingChange: (keying: KeyingSet) => void;
  onModeChange: (curves: boolean) => void;
};

// The animation pane: transport controls over a dope sheet of keys or their curves, under a ruler of
// frames. Left click anywhere moves the time cursor, right click selects keys, and with the pointer
// here G moves them and S stretches their timing about the current frame. The wheel zooms at the
// cursor and middle drag pans. The current frame can sit anywhere, though playing loops between the
// start and end frames.
export const Timeline = ({
  locked, document, time, playing, onSeek, onTogglePlaying, onFrameStartChange, onFrameEndChange, onDragEnd, onInsertKey, onEdit, onBeginKeyEdit, onMessage, keying, onKeyingChange, onModeChange,
}: TimelineProps) => {
  const { frameRate, frameStart, frameEnd } = document;
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<PaneMode>('keys');
  const [trackWidth, setTrackWidth] = useState(800);
  const [selection, setSelection] = useState<KeySelection | null>(null);
  // Until zoomed or panned, the view follows the play range.
  const [customView, setCustomView] = useState<TimeView | null>(null);
  const margin = Math.max(1, (frameEnd - frameStart) * FIT_MARGIN);
  const view = customView ?? { start: frameStart - margin, end: frameEnd + margin };
  const viewRef = useRef(view);
  viewRef.current = view;
  const span = view.end - view.start;

  const rowTimes = { all: rowKeyTimes(document, 'all'), selected: rowKeyTimes(document, 'selected') };
  // A selection can outlive its keys, through undo or a change of what is selected.
  const liveTimes = selection ? selection.times.filter(keyTime => rowTimes[selection.row].some(other => sameTime(other, keyTime))) : [];
  const selectedEase = selection && liveTimes.length > 0 ? rowKeyEase(document, selection.row, liveTimes[0]) : null;

  // The curves plot lines up under the ruler by having the channel list's width to its left.
  const labelWidth = mode === 'curves' ? 150 : LABEL_WIDTH;

  useEffect(() => {
    const track = trackRef.current!;
    const tracks = tracksRef.current!;
    const measure = () => setTrackWidth(track.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = track.getBoundingClientRect();
      setCustomView(zoomView(viewRef.current, (event.clientX - bounds.left) / bounds.width, Math.pow(ZOOM_PER_WHEEL_PIXEL, event.deltaY)));
    };
    tracks.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      tracks.removeEventListener('wheel', onWheel);
    };
  }, []);

  const frameAt = (clientX: number): number => {
    const bounds = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.round(view.start + (clientX - bounds.left) / bounds.width * span));
  };

  const followPointer = (onMove: (event: PointerEvent) => void) => {
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const beginPan = (event: ReactPointerEvent) => {
    event.preventDefault();
    let lastX = event.clientX;
    followPointer(move => {
      const current = viewRef.current;
      setCustomView(panView(current, -(move.clientX - lastX) / trackWidth * (current.end - current.start)));
      lastX = move.clientX;
    });
  };

  // Everything below the transport controls lands here, unless a key or handle took a right click.
  const beginPanePointer = (event: ReactPointerEvent) => {
    if (event.button === 1) {
      beginPan(event);
      return;
    }
    if (locked) {
      return;
    }
    if (event.button === 0) {
      onSeek(frameAt(event.clientX) / frameRate);
      followPointer(move => onSeek(frameAt(move.clientX) / frameRate));
    } else if (event.button === 2 && !event.shiftKey) {
      setSelection(null);
    }
  };

  const selectKey = (event: ReactPointerEvent, row: KeyRow, keyTime: number) => {
    if (event.button !== 2 || locked) {
      return;
    }
    event.stopPropagation();
    if (event.shiftKey && selection?.row === row) {
      const has = liveTimes.some(other => sameTime(other, keyTime));
      setSelection({ row, times: has ? liveTimes.filter(other => !sameTime(other, keyTime)) : [...liveTimes, keyTime] });
    } else {
      setSelection({ row, times: [keyTime] });
    }
  };

  const beginKeyTransform = (kind: 'move' | 'scale', row: KeyRow) => {
    const times = liveTimes;
    const start = pointerRef.current!;
    const bounds = trackRef.current!.getBoundingClientRect();
    const cursorX = (time * frameRate - view.start) / span * bounds.width;
    const framesPerPixel = span / bounds.width;
    if (playing) {
      onTogglePlaying();
    }
    const edit = onBeginKeyEdit();
    onMessage(kind === 'move'
      ? 'Moving keys: left click to confirm, Esc or right click to cancel.'
      : 'Scaling key timing about the current frame: left click to confirm, Esc or right click to cancel.');
    runModal({
      onMove: move => {
        const factor = kind === 'scale' ? timeScaleFactor(start.x - bounds.left, move.clientX - bounds.left, cursorX) : 1;
        const destinations = kind === 'scale'
          ? scaledTimes(times, factor, time, frameRate)
          : shiftedTimes(times, Math.round((move.clientX - start.x) * framesPerPixel), frameRate);
        const moves = times.map((from, i) => ({ from, to: destinations[i] }));
        edit.preview(current => changeRowKeys(current, row, (part, indices) => remapKeys(part, indices, moves, factor)));
        setSelection({ row, times: destinations.filter((to, i) => destinations.findIndex(other => sameTime(other, to)) === i) });
      },
      onConfirm: () => {
        edit.confirm();
        onMessage('Applied.');
      },
      onCancel: () => {
        edit.cancel();
        setSelection({ row, times });
        onMessage('Cancelled.');
      },
    });
  };

  const deleteSelectedKeys = () => {
    if (!selection || liveTimes.length === 0) {
      return;
    }
    const { row } = selection;
    onEdit(current => liveTimes.reduce((next, keyTime) => changeRowKeys(next, row, (part, indices) => deleteKeys(part, indices, keyTime)), current));
    setSelection(null);
    onMessage('Deleted keys.');
  };

  const changeEase = (ease: Ease) => {
    if (selection) {
      onEdit(current => liveTimes.reduce((next, keyTime) => changeRowKeys(next, selection.row, (part, indices) => setKeyEase(part, indices, keyTime, ease)), current));
    }
  };

  const pointerRef = usePaneKeys(rootRef, mode === 'keys' && !locked, event => {
    if (event.code === 'KeyA' && event.altKey) {
      setSelection(null);
      return true;
    }
    if (event.altKey || event.shiftKey) {
      return false;
    }
    if (event.code === 'KeyA') {
      const row = selection?.row ?? 'all';
      setSelection({ row, times: rowTimes[row] });
    } else if (event.code === 'KeyX' || event.code === 'Delete') {
      deleteSelectedKeys();
    } else if (event.code === 'KeyR') {
      onMessage('R turns bezier handles, in the Curves view.');
    } else if (event.code === 'KeyG' || event.code === 'KeyS') {
      if (selection && liveTimes.length > 0) {
        beginKeyTransform(event.code === 'KeyG' ? 'move' : 'scale', selection.row);
      } else {
        onMessage('Select keys first, with right click.');
      }
    } else {
      return false;
    }
    return true;
  });

  const percent = (frame: number) => `${(frame - view.start) / span * 100}%`;

  const renderRow = (row: KeyRow, label: string, times: number[]) => (
    <div style={{ display: 'flex', height: ROW_HEIGHT, borderTop: '1px solid #2a2e39' }}>
      <div style={{ width: labelWidth, flexShrink: 0, paddingLeft: 12, lineHeight: `${ROW_HEIGHT}px`, opacity: 0.8 }}>{label}</div>
      <div style={{ position: 'relative', flex: 1, minWidth: 0, overflow: 'hidden', marginRight: 16 }}>
        {times.map(keyTime => {
          const selected = selection?.row === row && liveTimes.some(other => sameTime(other, keyTime));
          return (
            <div
              key={keyTime}
              data-testid={`key-${row}`}
              data-time={keyTime}
              data-selected={selected}
              title={`Frame ${Math.round(keyTime * frameRate)}`}
              onPointerDown={event => selectKey(event, row, keyTime)}
              style={{
                position: 'absolute',
                left: percent(keyTime * frameRate),
                top: '50%',
                width: 10,
                height: 10,
                transform: 'translate(-50%, -50%) rotate(45deg)',
                background: selected ? ACCENT : '#d8dbe4',
                border: '1px solid #101218',
              }}
            />
          );
        })}
      </div>
    </div>
  );

  // Clicking a control must not leave it focused, or Space would press it instead of playing.
  const keepFocus = (event: React.MouseEvent) => event.preventDefault();
  const frameFieldStyle = { width: 60 };

  return (
    <div ref={rootRef} onContextMenu={event => event.preventDefault()} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto', background: '#1c1f27', userSelect: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 12px', flexWrap: 'wrap', flexShrink: 0 }}>
        <button className='slender-transport-button' aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'} onMouseDown={keepFocus} onClick={onTogglePlaying}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className='slender-transport-button' aria-label='Key selected' title='Key selected (I)' onMouseDown={keepFocus} onClick={onInsertKey}><InsertKeyIcon /></button>
        <div data-testid='keying' title='What I keys' style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {KEYING_PROPERTIES.map(property => {
            const name = { location: 'Location', rotation: 'Rotation', scale: 'Scale' }[property];
            const allOn = COORDINATES.every(coordinate => keying[property][coordinate]);
            return (
              <div key={property} className='slender-segments' role='group' aria-label={`Key ${name}`}>
                <button
                  aria-pressed={allOn}
                  aria-label={`Key all of ${name}`}
                  title={`Key ${name}: turn all its axes on or off`}
                  onMouseDown={keepFocus}
                  onClick={() => onKeyingChange({ ...keying, [property]: { x: !allOn, y: !allOn, z: !allOn } })}
                >
                  {{ location: 'Loc', rotation: 'Rot', scale: 'Scale' }[property]}
                </button>
                {COORDINATES.map(coordinate => (
                  <button
                    key={coordinate}
                    aria-pressed={keying[property][coordinate]}
                    aria-label={`Key ${name} ${coordinate.toUpperCase()}`}
                    title={`Key ${name} ${coordinate.toUpperCase()}`}
                    onMouseDown={keepFocus}
                    onClick={() => onKeyingChange({ ...keying, [property]: { ...keying[property], [coordinate]: !keying[property][coordinate] } })}
                  >
                    {coordinate.toUpperCase()}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <span data-testid='time' style={{ fontVariantNumeric: 'tabular-nums', minWidth: 76 }}>Frame {Math.round(time * frameRate)}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          Start <NumberField label='Start frame' value={frameStart} dragStep={1} style={frameFieldStyle} onCommit={onFrameStartChange} onDragEnd={onDragEnd} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          End <NumberField label='End frame' value={frameEnd} dragStep={1} style={frameFieldStyle} onCommit={onFrameEndChange} onDragEnd={onDragEnd} />
        </label>
        {mode === 'keys' && selectedEase !== null && (
          <>
            <label>
              Interpolation <select
                aria-label='Easing to next key'
                value={easeName(selectedEase)}
                onChange={event => changeEase(easeFromName(event.target.value as EaseName))}
              >
                <option value='constant'>Constant</option>
                <option value='linear'>Linear</option>
                <option value='bezier'>Bezier</option>
              </select>
            </label>
            <button className='slender-transport-button' aria-label='Delete key' title='Delete keys (X or Del, over this pane)' onMouseDown={keepFocus} onClick={deleteSelectedKeys}><DeleteKeyIcon /></button>
          </>
        )}
        <div style={{ flex: 1 }} />
        <div className='slender-segments' role='group' aria-label='Animation view' data-testid='animation-view'>
          {(['keys', 'curves'] as const).map(name => (
            <button
              key={name}
              aria-pressed={mode === name}
              onMouseDown={keepFocus}
              onClick={() => {
                setMode(name);
                onModeChange(name === 'curves');
              }}
            >
              {name === 'keys' ? 'Keys' : 'Curves'}
            </button>
          ))}
        </div>
      </div>
      <div ref={tracksRef} data-testid='tracks' onPointerDown={beginPanePointer} onMouseDown={event => event.button === 1 && event.preventDefault()} style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', height: 20, flexShrink: 0 }}>
          <div style={{ width: labelWidth, flexShrink: 0 }} />
          <div
            ref={trackRef}
            data-testid='ruler'
            style={{ position: 'relative', flex: 1, minWidth: 0, marginRight: mode === 'curves' ? 0 : 16, overflow: 'hidden', cursor: 'pointer', background: '#232731' }}
          >
            <div style={{ position: 'absolute', left: percent(frameStart), width: `${(frameEnd - frameStart) / span * 100}%`, top: 0, bottom: 0, background: '#2f3545' }} />
            {rulerTicks(view, trackWidth).map(frame => (
              <div key={frame} style={{ position: 'absolute', left: percent(frame), top: 0, bottom: 0, borderLeft: '1px solid #4a5060', paddingLeft: 3, fontSize: 11, opacity: 0.8, whiteSpace: 'nowrap' }}>
                {frame}
              </div>
            ))}
          </div>
        </div>
        {mode === 'keys' ? (
          <div>
            {renderRow('all', 'All', rowTimes.all)}
            {renderRow('selected', 'Selected', rowTimes.selected)}
          </div>
        ) : (
          <CurvesEditor
            channels={curveChannels(document)}
            frameRate={frameRate}
            time={time}
            frameStart={frameStart}
            frameEnd={frameEnd}
            view={view}
            locked={locked}
            onView={setCustomView}
            onEdit={onEdit}
            onBeginKeyEdit={() => {
              if (playing) {
                onTogglePlaying();
              }
              return onBeginKeyEdit();
            }}
            onMessage={onMessage}
          />
        )}
        {mode === 'keys' && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: labelWidth, right: 16, overflow: 'hidden', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: percent(time * frameRate), top: 0, bottom: 0, width: 2, marginLeft: -1, background: '#5aa9ff' }} />
          </div>
        )}
      </div>
    </div>
  );
};
