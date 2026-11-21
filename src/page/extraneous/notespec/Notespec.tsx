// The notespec editor: toolbar, the score canvas and a status bar. SPEC.md has the design.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Interaction, KeyInput, Rect, WheelInput } from './canvas/interaction';
import { useCanvas } from './canvas/useCanvas';
import { drawScore, ScoreActions } from './draw';
import {
  addFolder, addTrack, deleteFolder, deleteNotes, deleteTrack, moveItems, moveNotes, placeNote, setDurations, setFolder, setGlobal, setTrack,
  setTrackSection, splitGlobal, splitNotes, splitTrackSection,
} from './editing';
import { commit as commitHistory, History, redo, startHistory, undo } from './history';
import { DEFAULT_VIEW, HEADER_WIDTH, Lane, layoutLanes, lanesHeight, PitchLock, placementPitch, SCORE_TOP, View, xTick } from './layout';
import { DIVISIONS, lengthLabel, LengthMode, lengthTicks, Snap, snapTime, stepLength } from './lengths';
import { boxSelect, grabNotes, grabSections, OperatorContext } from './operators';
import { attributesAt, locateNotes, trackNotes, trackRows } from './score';
import { ItemKind, Outliner } from './Outliner';
import { Properties } from './Properties';
import { renderScore, TempoMap, tempoMap } from './sound';
import { EditorState, initialState, sameSection, tidy } from './state';
import './notespec.css';

type Settings = { pitchLock: PitchLock; snap: Snap; division: number; lengthMode: LengthMode };

const DEFAULT_SETTINGS: Settings = { pitchLock: 'key', snap: { division: 8, triplet: false }, division: 4, lengthMode: 'normal' };
const MIN_SCALE = 2 / 960;
const MAX_SCALE = 400 / 960;
// How far left of the score's start the view can scroll, in ticks.
const START_MARGIN = 960;

const keyInput = (event: KeyboardEvent): KeyInput => ({
  key: event.key, code: event.code, repeat: event.repeat, shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey,
});

export const Notespec = () => {
  const historyRef = useRef<History<EditorState>>(startHistory(initialState()));
  const previewRef = useRef<EditorState | null>(null);
  const viewRef = useRef<View>({ ...DEFAULT_VIEW });
  const cursorRef = useRef(0);
  const boxRef = useRef<Rect | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const [settings, setSettingsState] = useState(DEFAULT_SETTINGS);
  const settingsRef = useRef(settings);
  const [, setVersion] = useState(0);
  const invalidateRef = useRef(() => {});
  const interaction = useMemo(() => new Interaction(() => {
    invalidateRef.current();
    setVersion(version => version + 1);
  }), []);

  // Playback: the source playing, when it started (audio clock) and the tick it started from.
  const audioRef = useRef<AudioContext | null>(null);
  const playRef = useRef<{ source: AudioBufferSourceNode; startedAt: number; from: number; time: TempoMap; frame: number } | null>(null);

  const shown = () => previewRef.current ?? historyRef.current.present;
  const committed = () => historyRef.current.present;
  const lanes = () => layoutLanes(shown().score, trackRows(shown().score), viewRef.current);
  const refresh = () => {
    setVersion(version => version + 1);
    invalidateRef.current();
  };
  const setSettings = (changes: Partial<Settings>) => {
    settingsRef.current = { ...settingsRef.current, ...changes };
    setSettingsState(settingsRef.current);
  };

  const commit = (next: EditorState, coalesce: string | null = null) => {
    historyRef.current = commitHistory(historyRef.current, tidy(next), coalesce);
    previewRef.current = null;
    refresh();
  };
  // Selection and active track changes replace the present state rather than adding an undo step.
  const select = (next: EditorState) => {
    historyRef.current = { ...historyRef.current, present: tidy(next) };
    previewRef.current = null;
    refresh();
  };

  const operatorContext: OperatorContext = {
    state: committed,
    preview: state => {
      previewRef.current = state;
      refresh();
    },
    commit: state => commit(state),
    select,
    view: () => viewRef.current,
    lanes,
    snap: () => settingsRef.current.snap,
    overlay: rect => {
      boxRef.current = rect;
      refresh();
    },
  };

  const setCursor = (tick: number) => {
    cursorRef.current = Math.max(0, tick);
    refresh();
  };
  const snappedCursor = (tick: number) => {
    const state = committed();
    return snapTime(state.score, state.score.tracks[state.activeTrack], tick, settingsRef.current.snap);
  };

  const clampView = () => {
    const view = viewRef.current;
    const visible = sizeRef.current.height - SCORE_TOP;
    const content = lanesHeight(layoutLanes(shown().score, trackRows(shown().score), { ...view, scrollY: 0 }), { ...view, scrollY: 0 });
    view.scrollY = Math.max(0, Math.min(view.scrollY, content - visible + 40));
    view.start = Math.max(-START_MARGIN, view.start);
  };

  const actions: ScoreActions = {
    pressRuler: input => {
      setCursor(snappedCursor(xTick(viewRef.current, input.x)));
      return { move: move => setCursor(snappedCursor(xTick(viewRef.current, move.x))) };
    },
    pressHeader: lane => activate(lane.track.id),
    pressNote: (lane, id, input) => {
      const state = committed();
      if (input.button !== 0) {
        return;
      }
      if (state.mode === 'object') {
        select({ ...state, activeTrack: lane.track.id, sections: [] });
      } else if (input.shift) {
        select({ ...state, notes: state.notes.includes(id) ? state.notes.filter(other => other !== id) : [...state.notes, id] });
      } else {
        select({ ...state, notes: [id] });
      }
    },
    pressLane: (lane, tick, step, input) => {
      const state = committed();
      if (input.button !== 0) {
        return;
      }
      if (state.mode === 'edit' && lane.track.id === state.activeTrack) {
        placeAt(lane, tick, step);
      } else {
        setCursor(snappedCursor(tick));
        if (state.mode === 'object' && !input.shift) {
          select({ ...state, sections: [] });
        }
      }
    },
    pressSection: (ref, input) => {
      const state = committed();
      if (input.button !== 0) {
        return;
      }
      const has = state.sections.some(other => sameSection(other, ref));
      const sections = input.shift ? (has ? state.sections.filter(other => !sameSection(other, ref)) : [...state.sections, ref]) : [ref];
      select({ ...state, sections, activeTrack: ref.kind === 'track' ? ref.track : state.activeTrack });
    },
    pressBlank: (tick, input) => {
      if (input.button !== 0) {
        return;
      }
      if (input.x > HEADER_WIDTH) {
        setCursor(snappedCursor(tick));
      }
      const state = committed();
      if (!input.shift) {
        select({ ...state, sections: state.mode === 'object' ? [] : state.sections });
      }
    },
    wheel: input => wheel(input),
  };

  const placeAt = (lane: Lane, tick: number, step: number) => {
    const state = committed();
    const { snap, pitchLock, division, lengthMode } = settingsRef.current;
    const start = snapTime(state.score, lane.track, tick, snap, 'floor');
    const { key } = attributesAt(state.score, lane.track, start);
    const placed = placeNote(state.score, lane.track.id, start, placementPitch(step, key, pitchLock), lengthTicks(division, lengthMode));
    if (placed.id) {
      commit({ ...state, score: placed.score, notes: [placed.id] });
    }
  };

  const wheel = (input: WheelInput): boolean => {
    const view = viewRef.current;
    const delta = input.deltaY || input.deltaX;
    if (input.ctrl) {
      // Zoom time around the pointer.
      const anchor = xTick(view, Math.max(HEADER_WIDTH, input.x));
      view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-delta * 0.0015)));
      view.start = anchor - (Math.max(HEADER_WIDTH, input.x) - HEADER_WIDTH) / view.scale;
    } else if (input.alt) {
      changeLength(delta < 0 ? 1 : -1);
    } else if (input.shift) {
      view.start += delta / view.scale;
    } else {
      view.scrollY += input.deltaY;
      view.start += input.deltaX / view.scale;
    }
    clampView();
    refresh();
    return true;
  };

  // Alt+scroll: the selected notes' lengths in edit mode, otherwise the placement length. Up is longer.
  const changeLength = (steps: number) => {
    const state = committed();
    const { division, lengthMode } = settingsRef.current;
    if (state.mode === 'edit' && state.notes.length > 0) {
      let score = state.score;
      for (const { note } of locateNotes(score, state.notes)) {
        score = setDurations(score, [note.id], stepLength(note.duration, steps, lengthMode));
      }
      commit({ ...state, score }, 'note-lengths');
      return;
    }
    const index = DIVISIONS.indexOf(division);
    setSettings({ division: DIVISIONS[Math.max(0, Math.min(DIVISIONS.length - 1, index - steps))] });
  };

  const toggleLengthMode = (mode: LengthMode) => setSettings({ lengthMode: settingsRef.current.lengthMode === mode ? 'normal' : mode });

  const playhead = (): number | null => {
    const playing = playRef.current;
    const audio = audioRef.current;
    if (!playing || !audio) {
      return null;
    }
    return playing.time.tick(playing.time.seconds(playing.from) + Math.max(0, audio.currentTime - playing.startedAt));
  };

  const stop = () => {
    const playing = playRef.current;
    if (!playing) {
      return;
    }
    playRef.current = null;
    playing.source.onended = null;
    playing.source.stop();
    cancelAnimationFrame(playing.frame);
    refresh();
  };

  // Space: plays every audible track from the cursor, or stops.
  const togglePlay = () => {
    if (playRef.current) {
      stop();
      return;
    }
    const { score } = committed();
    const audio = audioRef.current ?? new AudioContext();
    audioRef.current = audio;
    void audio.resume();
    const samples = renderScore(score, audio.sampleRate, cursorRef.current);
    if (samples.length === 0) {
      return;
    }
    const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    const startedAt = audio.currentTime + 0.05;
    source.start(startedAt);
    source.onended = stop;
    const follow = () => {
      if (playRef.current) {
        playRef.current.frame = requestAnimationFrame(follow);
        invalidateRef.current();
      }
    };
    playRef.current = { source, startedAt, from: cursorRef.current, time: tempoMap(score), frame: requestAnimationFrame(follow) };
    refresh();
  };

  const onKey = (input: KeyInput): boolean => {
    if (interaction.key(input)) {
      return true;
    }
    if (interaction.busy) {
      return false;
    }
    const state = committed();
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key;
    if (input.ctrl) {
      if (key === 'z') {
        historyRef.current = input.shift ? redo(historyRef.current) : undo(historyRef.current);
        refresh();
        return true;
      }
      if (key === 'y') {
        historyRef.current = redo(historyRef.current);
        refresh();
        return true;
      }
      return false;
    }
    if (key === 'Tab') {
      select({ ...state, mode: state.mode === 'edit' ? 'object' : 'edit' });
      return true;
    }
    if (key === ' ') {
      togglePlay();
      return true;
    }
    if (key === 'd' && !input.shift) {
      toggleLengthMode('dotted');
      return true;
    }
    if (key === 't') {
      toggleLengthMode('triplet');
      return true;
    }
    return state.mode === 'edit' ? editKey(state, key, input) : objectKey(state, key, input);
  };

  const editKey = (state: EditorState, key: string, input: KeyInput): boolean => {
    const track = state.score.tracks[state.activeTrack];
    if (key === 'a') {
      select({ ...state, notes: input.alt || !track ? [] : trackNotes(state.score, track).map(item => item.note.id) });
      return true;
    }
    if (key === 'g' && state.notes.length > 0) {
      interaction.startModal(grabNotes(operatorContext, interaction.pointer));
      return true;
    }
    if (key === 'b') {
      interaction.startModal(boxSelect(operatorContext));
      return true;
    }
    if ((key === 'x' || key === 'Delete') && state.notes.length > 0) {
      commit({ ...state, score: deleteNotes(state.score, state.notes), notes: [] });
      return true;
    }
    if ((key === 'ArrowUp' || key === 'ArrowDown') && state.notes.length > 0) {
      commit({ ...state, score: moveNotes(state.score, state.notes, 0, key === 'ArrowUp' ? 1 : -1) });
      return true;
    }
    if (key === 's' && state.notes.length > 0) {
      const split = splitNotes(state.score, state.notes, cursorRef.current);
      if (split.created.length > 0) {
        commit({ ...state, score: split.score, notes: [...state.notes, ...split.created] });
      }
      return true;
    }
    return false;
  };

  const objectKey = (state: EditorState, key: string, input: KeyInput): boolean => {
    if (key === 'a' && input.alt) {
      select({ ...state, sections: [] });
      return true;
    }
    if (key === 'g' && state.sections.length > 0) {
      interaction.startModal(grabSections(operatorContext, interaction.pointer));
      return true;
    }
    if (key === 's' && state.sections.length > 0) {
      splitSelectedLines(state);
      return true;
    }
    return false;
  };

  // S in object mode: splits each selected line (the global one, or a track's) at the cursor.
  const splitSelectedLines = (state: EditorState) => {
    let score = state.score;
    const cursor = cursorRef.current;
    if (state.sections.some(ref => ref.kind === 'global')) {
      score = splitGlobal(score, cursor).score;
    }
    const tracks = new Set(state.sections.flatMap(ref => (ref.kind === 'track' ? [ref.track] : [])));
    for (const track of tracks) {
      score = splitTrackSection(score, track, cursor).score;
    }
    if (score !== state.score) {
      commit({ ...state, score });
    }
  };

  // ---- Outliner ----

  const activate = (track: string) => {
    const state = committed();
    select({ ...state, activeTrack: track, notes: track === state.activeTrack ? state.notes : [] });
  };

  const toggleItem = (kind: ItemKind, id: string, flag: 'hidden' | 'muted' | 'solo') => {
    const state = committed();
    const item = kind === 'track' ? state.score.tracks[id] : state.score.folders[id];
    const score = kind === 'track' ? setTrack(state.score, id, { [flag]: !item[flag] }) : setFolder(state.score, id, { [flag]: !item[flag] });
    commit({ ...state, score });
  };

  const renameItem = (kind: ItemKind, id: string, name: string) => {
    const state = committed();
    const current = kind === 'track' ? state.score.tracks[id]?.name : state.score.folders[id]?.name;
    if (current !== undefined && current !== name) {
      commit({ ...state, score: kind === 'track' ? setTrack(state.score, id, { name }) : setFolder(state.score, id, { name }) });
    }
  };

  const deleteItem = (kind: ItemKind, id: string) => {
    const state = committed();
    commit({ ...state, score: kind === 'track' ? deleteTrack(state.score, id) : deleteFolder(state.score, id) });
  };

  const newTrack = () => {
    const state = committed();
    const added = addTrack(state.score, `Track ${Object.keys(state.score.tracks).length + 1}`);
    commit({ ...state, score: added.score, activeTrack: added.id, notes: [] });
  };

  const newFolder = () => {
    const state = committed();
    commit({ ...state, score: addFolder(state.score, 'Folder').score });
  };

  const { canvasRef, invalidate } = useCanvas(interaction, (context, frame, size) => {
    sizeRef.current = size;
    drawScore(context, frame, size, {
      state: shown(), view: viewRef.current, lanes: lanes(), cursor: cursorRef.current, playhead: playhead(), box: boxRef.current, actions,
    });
  });
  invalidateRef.current = invalidate;

  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  const stopRef = useRef(stop);
  stopRef.current = stop;
  const handleKey = useCallback((event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && ['number', 'text'].includes((target as HTMLInputElement).type))) {
      return;
    }
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT') {
      target.blur();
    }
    if (onKeyRef.current(keyInput(event)) || event.key === 'Tab' || (event.ctrlKey && event.key.toLowerCase() === 's')) {
      event.preventDefault();
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    // The editor fills the window; the page under it shouldn't scroll.
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.documentElement.style.overflow = overflow;
      stopRef.current();
      void audioRef.current?.close();
    };
  }, [handleKey]);

  // For checks in development: the state, the view, the lanes and the cursor.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __notespec: object }).__notespec = {
        state: () => shown(), view: () => viewRef.current, lanes: () => lanes(), cursor: () => cursorRef.current, settings: () => settingsRef.current, playhead,
      };
    }
  });

  const state = shown();
  const modal = interaction.activeModal;
  const status = modal?.describe?.() ?? (state.mode === 'edit'
    ? ['Edit mode', 'Click: place a note', 'G: move (then Z: pitch)', 'B: box select', 'S: split at cursor', '↑↓: semitone', 'Alt+scroll: length', 'Space: play', 'Tab: object mode'].join('  ·  ')
    : ['Object mode', 'Click a section line to select it', 'G: move', 'S: split at cursor', 'Click a note: select its track', 'Space: play', 'Tab: edit mode'].join('  ·  '));

  return (
    <div className='notespec'>
      <div className='notespec-toolbar'>
        <div className='notespec-group'>
          <div className='notespec-segments' role='group' aria-label='Playback'>
            <button aria-pressed={playRef.current !== null} onClick={togglePlay} title='Play from the cursor (Space)'>{playRef.current ? '■ Stop' : '▶ Play'}</button>
          </div>
          <div className='notespec-segments' role='group' aria-label='Mode'>
            <button aria-pressed={state.mode === 'object'} onClick={() => select({ ...committed(), mode: 'object' })}>Object</button>
            <button aria-pressed={state.mode === 'edit'} onClick={() => select({ ...committed(), mode: 'edit' })}>Edit</button>
          </div>
        </div>
        <div className='notespec-group'>
          <span className='notespec-label'>Pitch</span>
          <div className='notespec-segments' role='group' aria-label='Pitch lock'>
            <button aria-pressed={settings.pitchLock === 'key'} onClick={() => setSettings({ pitchLock: 'key' })} title='Place notes on the key&apos;s scale'>Key</button>
            <button aria-pressed={settings.pitchLock === 'chromatic'} onClick={() => setSettings({ pitchLock: 'chromatic' })} title='Place natural notes; use ↑↓ for sharps and flats'>Chromatic</button>
            <button aria-pressed={settings.pitchLock === 'none'} disabled title='Fractional pitches are not supported yet'>None</button>
          </div>
        </div>
        <div className='notespec-group'>
          <span className='notespec-label'>Snap</span>
          <div className='notespec-segments' role='group' aria-label='Time snap'>
            <button aria-pressed={settings.snap === null} onClick={() => setSettings({ snap: null })}>Off</button>
            {DIVISIONS.map(division => (
              <button key={division} aria-pressed={settings.snap?.division === division && !settings.snap.triplet} onClick={() => setSettings({ snap: { division, triplet: false } })}>
                {lengthLabel(division, 'normal')}
              </button>
            ))}
          </div>
          {settings.lengthMode === 'triplet' && (
            <div className='notespec-segments' role='group' aria-label='Triplet time snap'>
              {DIVISIONS.slice(1).map(division => (
                <button key={division} aria-pressed={settings.snap?.division === division && settings.snap.triplet} onClick={() => setSettings({ snap: { division, triplet: true } })}>
                  {lengthLabel(division, 'triplet')}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className='notespec-group'>
          <span className='notespec-label'>Length</span>
          <div className='notespec-segments' role='group' aria-label='Note length'>
            {DIVISIONS.map(division => (
              <button key={division} aria-pressed={settings.division === division} onClick={() => setSettings({ division })}>{lengthLabel(division, 'normal')}</button>
            ))}
          </div>
          <div className='notespec-segments' role='group' aria-label='Length mode'>
            <button aria-pressed={settings.lengthMode === 'dotted'} onClick={() => toggleLengthMode('dotted')} title='Dotted (D)'>Dotted</button>
            <button aria-pressed={settings.lengthMode === 'triplet'} onClick={() => toggleLengthMode('triplet')} title='Triplet (T)'>Triplet</button>
          </div>
          <span className='notespec-label'>{lengthLabel(settings.division, settings.lengthMode)}</span>
        </div>
      </div>
      <div className='notespec-main'>
        <canvas ref={canvasRef} className='notespec-canvas' data-testid='score' />
        <div className='notespec-side'>
          <Outliner
            score={state.score}
            activeTrack={state.activeTrack}
            onActivate={activate}
            onToggle={toggleItem}
            onRename={renameItem}
            onDelete={deleteItem}
            onAddTrack={newTrack}
            onAddFolder={newFolder}
            onMove={(id, drop) => commit({ ...committed(), score: moveItems(committed().score, [id], drop) })}
          />
          <Properties
            score={state.score}
            section={state.mode === 'object' ? state.sections.at(-1) ?? null : null}
            activeTrack={state.activeTrack}
            onGlobal={(id, changes) => commit({ ...committed(), score: setGlobal(committed().score, id, changes) }, `global:${id}:${Object.keys(changes).join()}`)}
            onOverride={(track, id, overrides) => commit({ ...committed(), score: setTrackSection(committed().score, track, id, { overrides }) }, `section:${id}`)}
            onMargins={(track, margins) => commit({ ...committed(), score: setTrack(committed().score, track, { margins }) }, `margins:${track}`)}
          />
        </div>
      </div>
      <div className='notespec-status'>{status}</div>
    </div>
  );
};

export default Notespec;
