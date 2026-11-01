import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Ease, Key, sampleTrack } from './animation';
import { CurveChannel, EditorDocument, updateChannel } from './document';
import { changeHandle, deleteKeys, EASE_IN_OUT, HandleSide, KeyMove, remapKeys, rotateOffset, scaledTimes, segmentHandles, setCoordinateEase, setCoordinateValue, shiftedTimes } from './keyframes';
import { runModal, usePaneKeys } from './paneInput';
import { panView, TimeView, timeScaleFactor, zoomView } from './timelineView';

const CHANNEL_LIST_WIDTH = 150;
const ZOOM_PER_WHEEL_PIXEL = 1.002;
const CURVE_SAMPLE_PIXELS = 2;
const COORDINATE_COLORS = { x: '#ff6a6a', y: '#7fe07f', z: '#6aa8ff' };
const ACCENT = '#ffa030';

type ValueView = { min: number; max: number };
type CurveItem = { channel: string; time: number; part: 'key' | HandleSide };
type InterpolationName = 'constant' | 'linear' | 'bezier';

// How an edit in progress is shown, and then kept or undone.
export type KeyEdit = { preview: (change: (document: EditorDocument) => EditorDocument) => void; confirm: () => void; cancel: () => void };

function interpolationOf(ease: Ease | undefined): InterpolationName {
  return ease === 'hold' ? 'constant' : ease === 'linear' || ease === undefined ? 'linear' : 'bezier';
}

const INTERPOLATIONS: Record<InterpolationName, Ease> = { constant: 'hold', linear: 'linear', bezier: EASE_IN_OUT };

function sameTime(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

// Everything the curves show, with a little room around it, so that a fit shows it all.
function fittedValues(channels: CurveChannel[]): ValueView {
  const values = channels.flatMap(({ track: { keys }, scale }) => keys.flatMap((key, i) => {
    const handles = keys[i + 1] && segmentHandles(key, keys[i + 1]);
    return [key.value * scale, ...(handles ? [(key.value + handles.out[1]) * scale, (keys[i + 1].value + handles.in[1]) * scale] : [])];
  }));
  if (values.length === 0) {
    return { min: -1, max: 1 };
  }
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const margin = Math.max((max - min) * 0.15, 1);
  return { min: min - margin, max: max + margin };
}

// Round numbers for the value axis, about every 50 pixels.
function valueTicks({ min, max }: ValueView, height: number): number[] {
  const rough = (max - min) * 50 / Math.max(height, 1);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough) ?? power * 10;
  const ticks: number[] = [];
  for (let i = Math.ceil(min / step); i * step <= max; i++) {
    ticks.push(Number((i * step).toFixed(6)));
  }
  return ticks;
}

type CurvesEditorProps = {
  channels: CurveChannel[];
  frameRate: number;
  time: number;
  frameStart: number;
  frameEnd: number;
  view: TimeView;
  locked: boolean;
  onView: (view: TimeView) => void;
  onEdit: (change: (document: EditorDocument) => EditorDocument) => void;
  onBeginKeyEdit: () => KeyEdit;
  onMessage: (message: string) => void;
};

// Editing what happens between keys. The left list picks which curve to focus on. Right click
// selects keys and handles, Shift adding to them. G moves them, R turns handles about their keys, and
// S stretches key timing about the current frame. Left click belongs to the time cursor, which the
// surrounding pane handles. The wheel zooms at the cursor and middle drag pans.
export const CurvesEditor = ({ channels, frameRate, time, frameStart, frameEnd, view, locked, onView, onEdit, onBeginKeyEdit, onMessage }: CurvesEditorProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 150 });
  const [solo, setSolo] = useState<string | null>(null);
  const [selected, setSelected] = useState<CurveItem[]>([]);
  const [values, setValues] = useState<ValueView | null>(null);

  const shown = channels.filter(channel => !solo || channel.id === solo);
  const valueView = values ?? fittedValues(shown);
  const viewRef = useRef({ view, valueView, onView, setValues });
  viewRef.current = { view, valueView, onView, setValues };

  useEffect(() => {
    const plot = plotRef.current!;
    const measure = () => setSize({ width: plot.clientWidth, height: plot.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(plot);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = plot.getBoundingClientRect();
      const factor = Math.pow(ZOOM_PER_WHEEL_PIXEL, event.deltaY);
      const current = viewRef.current;
      current.onView(zoomView(current.view, (event.clientX - bounds.left) / bounds.width, factor));
      const position = 1 - (event.clientY - bounds.top) / bounds.height;
      const anchor = current.valueView.min + (current.valueView.max - current.valueView.min) * position;
      const span = (current.valueView.max - current.valueView.min) * factor;
      current.setValues({ min: anchor - span * position, max: anchor + span * (1 - position) });
    };
    plot.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      observer.disconnect();
      plot.removeEventListener('wheel', onWheel);
    };
  }, []);

  const { width, height } = size;
  const span = view.end - view.start;
  const x = (frame: number) => (frame - view.start) / span * width;
  const y = (value: number) => (1 - (value - valueView.min) / (valueView.max - valueView.min)) * height;
  const frameAtPixel = (pixel: number) => view.start + pixel / width * span;

  const channelOf = (id: string) => channels.find(channel => channel.id === id);
  // Selections can outlive what they name, through undo or a change of what is selected.
  const live = selected.filter(item => channelOf(item.channel)?.track.keys.some(key => sameTime(key.time, item.time)));
  const isSelected = (channel: string, time: number, part: CurveItem['part']) => (
    live.some(item => item.channel === channel && item.part === part && sameTime(item.time, time))
  );

  const selectItem = (event: ReactPointerEvent, item: CurveItem) => {
    if (event.button !== 2 || locked) {
      return;
    }
    event.stopPropagation();
    if (!event.shiftKey) {
      setSelected([item]);
    } else if (isSelected(item.channel, item.time, item.part)) {
      setSelected(live.filter(other => !(other.channel === item.channel && other.part === item.part && sameTime(other.time, item.time))));
    } else {
      setSelected([...live, item]);
    }
  };

  // The plot leaves left clicks to the pane around it, which moves the time cursor.
  const beginPlotPointer = (event: ReactPointerEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      event.stopPropagation();
      let last = { x: event.clientX, y: event.clientY };
      const onMove = (move: PointerEvent) => {
        const current = viewRef.current;
        const [dx, dy] = [move.clientX - last.x, move.clientY - last.y];
        last = { x: move.clientX, y: move.clientY };
        current.onView(panView(current.view, -dx / width * (current.view.end - current.view.start)));
        const perPixel = (current.valueView.max - current.valueView.min) / height;
        current.setValues({ min: current.valueView.min + dy * perPixel, max: current.valueView.max + dy * perPixel });
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    } else if (event.button === 2) {
      event.stopPropagation();
      if (!event.shiftKey) {
        setSelected([]);
      }
    }
  };

  const keysSelected = live.filter(item => item.part === 'key');
  // A key moved carries its handles along, so those need no moving of their own.
  const handlesAlone = live.filter(item => item.part !== 'key' && !isSelected(item.channel, item.time, 'key'));

  // Moves only the selected keys, curve by curve. Each curve's keys are its own.
  const movedKeys = (document: EditorDocument, destination: (time: number) => number, factor: number, values: Map<CurveItem, number>) => {
    let next = document;
    new Set(keysSelected.map(item => item.channel)).forEach(id => {
      const channel = channelOf(id)!;
      const items = keysSelected.filter(item => item.channel === id);
      const moves: KeyMove[] = items.map(({ time: from }) => ({ from, to: destination(from) }));
      next = updateChannel(next, channel, vertex => items.reduce((result, item) => {
        const value = values.get(item);
        return value === undefined ? result : setCoordinateValue(result, channel.coordinate, destination(item.time), value);
      }, remapKeys([vertex], [0], moves, factor, [channel.coordinate])[0]));
    });
    return next;
  };

  const beginEdit = (preview: (edit: KeyEdit, move: PointerEvent) => void, after: (move: PointerEvent) => void = () => undefined) => {
    const edit = onBeginKeyEdit();
    const start = selected;
    setValues(valueView);
    runModal({
      onMove: move => {
        preview(edit, move);
        after(move);
      },
      onConfirm: () => {
        edit.confirm();
        onMessage('Applied.');
      },
      onCancel: () => {
        edit.cancel();
        setSelected(start);
        onMessage('Cancelled.');
      },
    });
  };

  const beginMove = () => {
    const start = pointerRef.current!;
    const framesPerPixel = span / width;
    const valuePerPixel = (valueView.max - valueView.min) / height;
    const times = keysSelected.map(item => item.time);
    const keyValue = (item: CurveItem) => channelOf(item.channel)!.track.keys.find(key => sameTime(key.time, item.time))!.value;
    const originals = new Map(keysSelected.map(item => [item, keyValue(item)]));
    const offsets = (move: PointerEvent) => ({
      frames: Math.round((move.clientX - start.x) * framesPerPixel),
      value: (start.y - move.clientY) * valuePerPixel,
    });
    const destination = (move: PointerEvent) => {
      const moved = shiftedTimes(times, offsets(move).frames, frameRate);
      return (time: number) => moved[times.findIndex(other => sameTime(other, time))];
    };
    onMessage('Moving keys: left click to confirm, Esc or right click to cancel.');
    beginEdit((edit, move) => {
      const { frames, value } = offsets(move);
      const to = destination(move);
      edit.preview(document => {
        const withHandles = handlesAlone.reduce((next, item) => {
          const channel = channelOf(item.channel)!;
          return updateChannel(next, channel, vertex => changeHandle(vertex, channel.coordinate, item.time, item.part as HandleSide, ([dt, dv]) => [dt + frames / frameRate, dv + value / channel.scale]));
        }, document);
        const newValues = new Map(keysSelected.map(item => [item, originals.get(item)! + value / channelOf(item.channel)!.scale]));
        return movedKeys(withHandles, to, 1, newValues);
      });
    }, move => {
      const to = destination(move);
      setSelected([...handlesAlone, ...keysSelected.map(item => ({ ...item, time: to(item.time) }))]);
    });
  };

  const beginScale = () => {
    if (keysSelected.length === 0) {
      onMessage('S stretches key timing. Select keys.');
      return;
    }
    const bounds = plotRef.current!.getBoundingClientRect();
    const startX = pointerRef.current!.x - bounds.left;
    const cursorX = x(time * frameRate);
    const times = keysSelected.map(item => item.time);
    const measure = (move: PointerEvent) => {
      const factor = timeScaleFactor(startX, move.clientX - bounds.left, cursorX);
      const scaled = scaledTimes(times, factor, time, frameRate);
      return { factor, to: (from: number) => scaled[times.findIndex(other => sameTime(other, from))] };
    };
    onMessage('Scaling key timing about the current frame: left click to confirm, Esc or right click to cancel.');
    beginEdit((edit, move) => {
      const { factor, to } = measure(move);
      edit.preview(document => movedKeys(document, to, factor, new Map()));
    }, move => {
      const { to } = measure(move);
      setSelected([...handlesAlone, ...keysSelected.map(item => ({ ...item, time: to(item.time) }))]);
    });
  };

  const beginRotate = () => {
    const targets: { channel: CurveChannel; time: number; side: HandleSide }[] = [];
    live.forEach(item => {
      const channel = channelOf(item.channel)!;
      (item.part === 'key' ? ['out', 'in'] as const : [item.part]).forEach(side => {
        const keys = channel.track.keys;
        const i = keys.findIndex(key => sameTime(key.time, item.time));
        const [from, to] = side === 'out' ? [keys[i], keys[i + 1]] : [keys[i - 1], keys[i]];
        const duplicate = targets.some(target => target.channel === channel && target.side === side && sameTime(target.time, item.time));
        if (from && to && segmentHandles(from, to) && !duplicate) {
          targets.push({ channel, time: item.time, side });
        }
      });
    });
    if (targets.length === 0) {
      onMessage('R turns bezier handles. Select a handle, or a key that has them.');
      return;
    }
    const bounds = plotRef.current!.getBoundingClientRect();
    const anchors = targets.map(({ channel, time: keyTime }) => {
      const key = channel.track.keys.find(candidate => sameTime(candidate.time, keyTime))!;
      return [x(key.time * frameRate), y(key.value * channel.scale)];
    });
    const pivot = { x: anchors.reduce((sum, [ax]) => sum + ax, 0) / anchors.length, y: anchors.reduce((sum, [, ay]) => sum + ay, 0) / anchors.length };
    const start = pointerRef.current!;
    const angleOf = (clientX: number, clientY: number) => Math.atan2(clientY - bounds.top - pivot.y, clientX - bounds.left - pivot.x);
    const startAngle = angleOf(start.x, start.y);
    const xPerSecond = frameRate * width / span;
    const yPerUnit = -height / (valueView.max - valueView.min);
    onMessage('Rotating handles: left click to confirm, Esc or right click to cancel.');
    beginEdit((edit, move) => {
      const angle = angleOf(move.clientX, move.clientY) - startAngle;
      edit.preview(document => targets.reduce((next, { channel, time: keyTime, side }) => (
        updateChannel(next, channel, vertex => changeHandle(vertex, channel.coordinate, keyTime, side, offset => rotateOffset(offset, angle, xPerSecond, yPerUnit * channel.scale)))
      ), document));
    });
  };

  const deleteSelected = () => {
    if (keysSelected.length === 0) {
      return;
    }
    onEdit(document => keysSelected.reduce((next, item) => {
      const channel = channelOf(item.channel)!;
      return updateChannel(next, channel, vertex => deleteKeys([vertex], [0], item.time, [channel.coordinate])[0]);
    }, document));
    setSelected([]);
    onMessage('Deleted keys.');
  };

  const pointerRef = usePaneKeys(rootRef, !locked, event => {
    if (event.code === 'KeyA' && event.altKey) {
      setSelected([]);
      return true;
    }
    if (event.altKey || event.shiftKey) {
      return false;
    }
    if (event.code === 'KeyA') {
      setSelected(shown.flatMap(channel => channel.track.keys.map((key): CurveItem => ({ channel: channel.id, time: key.time, part: 'key' }))));
    } else if (event.code === 'KeyX' || event.code === 'Delete') {
      deleteSelected();
    } else if (event.code === 'KeyG' || event.code === 'KeyS' || event.code === 'KeyR') {
      if (live.length === 0) {
        onMessage('Select keys or handles first, with right click.');
      } else {
        ({ KeyG: beginMove, KeyS: beginScale, KeyR: beginRotate })[event.code]();
      }
    } else {
      return false;
    }
    return true;
  });

  const curvePoints = (channel: CurveChannel) => {
    const points: string[] = [];
    for (let px = 0; px <= width; px += CURVE_SAMPLE_PIXELS) {
      points.push(`${px},${y(sampleTrack(channel.track, frameAtPixel(px) / frameRate) * channel.scale)}`);
    }
    return points.join(' ');
  };

  const firstKey = keysSelected[0] ?? live[0];
  const firstChannel = firstKey && channelOf(firstKey.channel);
  const firstIndex = firstChannel ? firstChannel.track.keys.findIndex(key => sameTime(key.time, firstKey.time)) : -1;
  const shownKey = firstChannel?.track.keys[firstIndex];

  const renderHandles = (channel: CurveChannel, index: number) => {
    const { keys } = channel.track;
    const keyTime = keys[index].time;
    const handle = (from: Key, to: Key, side: HandleSide) => {
      const handles = segmentHandles(from, to);
      if (!handles) {
        return null;
      }
      const anchor = side === 'out' ? from : to;
      const [dt, dv] = handles[side];
      const [hx, hy] = [x((anchor.time + dt) * frameRate), y((anchor.value + dv) * channel.scale)];
      return (
        <g key={side}>
          <line x1={x(anchor.time * frameRate)} y1={y(anchor.value * channel.scale)} x2={hx} y2={hy} stroke={ACCENT} strokeWidth={1} />
          <circle
            data-testid={`handle-${side}`}
            cx={hx}
            cy={hy}
            r={5}
            fill={isSelected(channel.id, keyTime, side) ? ACCENT : '#1c1f27'}
            stroke={ACCENT}
            strokeWidth={2}
            onPointerDown={event => selectItem(event, { channel: channel.id, time: keyTime, part: side })}
          />
        </g>
      );
    };
    return (
      <g key={`${channel.id}:${keyTime}:handles`}>
        {keys[index + 1] && handle(keys[index], keys[index + 1], 'out')}
        {keys[index - 1] && handle(keys[index - 1], keys[index], 'in')}
      </g>
    );
  };

  // Handles show for any key with something selected at it, so a selected handle stays reachable.
  const handleKeys = shown.flatMap(channel => channel.track.keys.flatMap((key, index) => (
    live.some(item => item.channel === channel.id && sameTime(item.time, key.time)) ? [{ channel, index }] : []
  )));

  const stayOutOfTheCursor = (event: ReactPointerEvent) => event.stopPropagation();

  return (
    <div ref={rootRef} style={{ display: 'flex', flex: 1, minHeight: 0 }} data-testid='curves-editor'>
      <div onPointerDown={stayOutOfTheCursor} style={{ width: CHANNEL_LIST_WIDTH, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid #2a2e39', fontSize: 12 }}>
        {channels.length === 0 && <div style={{ padding: '4px 8px', opacity: 0.6 }}>Select something animated.</div>}
        {channels.map(channel => (
          <div
            key={channel.id}
            data-testid='curve-channel'
            className='slender-row'
            aria-selected={solo === channel.id}
            onClick={() => setSolo(solo === channel.id ? null : channel.id)}
            style={{ padding: '1px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: COORDINATE_COLORS[channel.coordinate], background: solo === channel.id ? '#3a4560' : undefined, cursor: 'pointer' }}
          >
            {channel.label}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
        <div onPointerDown={stayOutOfTheCursor} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px', minHeight: 26, fontSize: 12 }}>
          {firstChannel && shownKey ? (
            <>
              <span style={{ opacity: 0.8 }}>{firstChannel.label}, frame {Math.round(shownKey.time * frameRate)}</span>
              {firstIndex < firstChannel.track.keys.length - 1 && (
                <label>
                  To next key <select
                    aria-label='Interpolation'
                    value={interpolationOf(shownKey.ease)}
                    onChange={event => {
                      const ease = INTERPOLATIONS[event.target.value as InterpolationName];
                      const chosen = keysSelected.length > 0 ? keysSelected : [firstKey];
                      onEdit(document => chosen.reduce((next, item) => {
                        const channel = channelOf(item.channel)!;
                        return updateChannel(next, channel, vertex => setCoordinateEase(vertex, channel.coordinate, item.time, ease));
                      }, document));
                    }}
                  >
                    <option value='constant'>Constant</option>
                    <option value='linear'>Linear</option>
                    <option value='bezier'>Bezier</option>
                  </select>
                </label>
              )}
            </>
          ) : <span style={{ opacity: 0.6 }}>Right click a key to edit it.</span>}
          <div style={{ flex: 1 }} />
          <button className='slender-transport-button' onMouseDown={event => event.preventDefault()} onClick={() => setValues(null)}>Fit values</button>
        </div>
        <div ref={plotRef} data-testid='curves-plot' onPointerDown={beginPlotPointer} onMouseDown={event => event.button === 1 && event.preventDefault()} style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', background: '#171a21' }}>
          <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, display: 'block' }}>
            <rect x={x(frameStart)} y={0} width={Math.max(0, x(frameEnd) - x(frameStart))} height={height} fill='rgba(255, 255, 255, 0.035)' />
            {valueTicks(valueView, height).map(tick => (
              <g key={tick}>
                <line x1={0} x2={width} y1={y(tick)} y2={y(tick)} stroke='rgba(255, 255, 255, 0.08)' />
                <text x={4} y={y(tick) - 2} fill='rgba(255, 255, 255, 0.5)' fontSize={10}>{tick}</text>
              </g>
            ))}
            {shown.map(channel => (
              <polyline key={channel.id} data-testid='curve-path' points={curvePoints(channel)} fill='none' stroke={COORDINATE_COLORS[channel.coordinate]} strokeWidth={1.5} />
            ))}
            <line x1={x(time * frameRate)} x2={x(time * frameRate)} y1={0} y2={height} stroke='#5aa9ff' strokeWidth={2} />
            {shown.map(channel => channel.track.keys.map(key => {
              const [kx, ky] = [x(key.time * frameRate), y(key.value * channel.scale)];
              return (
                <rect
                  key={`${channel.id}:${key.time}`}
                  data-testid='curve-key'
                  data-channel={channel.label}
                  data-time={key.time}
                  x={kx - 4}
                  y={ky - 4}
                  width={8}
                  height={8}
                  transform={`rotate(45 ${kx} ${ky})`}
                  fill={isSelected(channel.id, key.time, 'key') ? ACCENT : '#d8dbe4'}
                  stroke='#101218'
                  onPointerDown={event => selectItem(event, { channel: channel.id, time: key.time, part: 'key' })}
                />
              );
            }))}
            {handleKeys.map(({ channel, index }) => renderHandles(channel, index))}
          </svg>
        </div>
      </div>
    </div>
  );
};
