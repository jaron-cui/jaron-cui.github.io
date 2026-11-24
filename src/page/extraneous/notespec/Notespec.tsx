// The notespec editor: toolbar, the score canvas and a status bar. SPEC.md has the design.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Interaction, KeyInput, Rect, WheelInput } from './canvas/interaction';
import { useCanvas } from './canvas/useCanvas';
import { drawScore, Ghost, ScoreActions } from './draw';
import {
  addFolder, addTrack, Clip, copyNotes, deleteFolder, deleteNotes, deleteTrack, moveItems, moveNotes, pasteNotes, placeNote, setDurations,
  setFolder, setGlobal, setSpelling, setTrack, setTrackSection, splitGlobal, splitNotes, splitTrackSection, tieNotes, untieNotes,
} from './editing';
import { FileHandle, isCancel, pickFileToOpen, saveText } from '../../../lib/psave/files';
import { keyValueStore } from '../../../lib/psave/store';
import { FILE_TYPE, parseScore, serializeScore } from './projectFile';
import { commit as commitHistory, History, redo, startHistory, undo } from './history';
import {
  DEFAULT_VIEW, Lane, layoutLanes, lanesHeight, MAX_HEADER_WIDTH, MIN_HEADER_WIDTH, PitchLock, placementPitch, SCORE_TOP, View, xTick, yStep,
} from './layout';
import { PaneDivider } from './PaneDivider';
import { DIVISIONS, lengthLabel, LengthMode, lengthTicks, Snap, snapTime, stepLength } from './lengths';
import { boxSelect, grabNotes, grabSections, OperatorContext } from './operators';
import { attributesAt, locateNotes, newScore, Score, trackNotes, trackRows } from './score';
import { ItemKind, Outliner } from './Outliner';
import { Properties } from './Properties';
import { auditionSamples, renderScore, TempoMap, tempoMap } from './sound';
import { EditorState, initialState, sameSection, tidy } from './state';
import './notespec.css';

// `placing` is note-placing mode (Tab): a click on blank lane space places a note.
type Settings = { pitchLock: PitchLock; snap: Snap; division: number; lengthMode: LengthMode; placing: boolean };

const DEFAULT_SETTINGS: Settings = { pitchLock: 'key', snap: { division: 8, triplet: false }, division: 4, lengthMode: 'normal', placing: false };
const MIN_SCALE = 2 / 960;
const MAX_SCALE = 400 / 960;
// How far left of the score's start the view can scroll, in ticks.
const START_MARGIN = 960;

// The working state kept between visits: the score, the file it belongs to, and whether it matches
// that file.
type Session = { score: Score; file: { name: string; handle: FileHandle | null } | null; saved: boolean };
const sessions = keyValueStore<Session>('notespec');
const SESSION_KEY = 'session';
const AUTOSAVE_MS = 1000;

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
  }, () => {
    // The placement preview follows the pointer.
    if (settingsRef.current.placing) {
      invalidateRef.current();
    }
  }), []);

  // Playback: the source playing, when it started (audio clock) and the tick it started from.
  const audioRef = useRef<AudioContext | null>(null);
  const playRef = useRef<{ source: AudioBufferSourceNode; startedAt: number; from: number; time: TempoMap; frame: number } | null>(null);

  // The file the score belongs to, and the score as last saved to it (or opened from it).
  const fileRef = useRef<{ name: string; handle: FileHandle | null } | null>(null);
  const savedScoreRef = useRef<Score>(historyRef.current.present.score);
  const clipboardRef = useRef<Clip | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // The side panel's width and the outliner's height in it, both dragged by their borders.
  const [sideWidth, setSideWidth] = useState(260);
  const [outlinerHeight, setOutlinerHeight] = useState(320);

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
    audition: (state, ids) => audition(state, ids),
  };

  // Plays notes on their own (a placed note, or notes whose pitch changed), cutting off the last ones.
  const auditionRef = useRef<AudioBufferSourceNode | null>(null);
  const audition = (state: EditorState, ids: string[]) => {
    const audio = audioRef.current ?? new AudioContext();
    audioRef.current = audio;
    void audio.resume();
    const samples = auditionSamples(state.score, ids, audio.sampleRate);
    if (samples.length === 0) {
      return;
    }
    auditionRef.current?.stop();
    const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start();
    auditionRef.current = source;
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
    pressRuler: input => scrub(input.x),
    pressHeader: lane => activate(lane.track.id),
    pressNote: (lane, id, input) => {
      const state = committed();
      if (input.button !== 0) {
        return;
      }
      // While placing notes, a click on a note places one there too (taking over a same-pitch note).
      if (settingsRef.current.placing) {
        placeAt(lane, xTick(viewRef.current, input.x), Math.round(yStep(lane, input.y)));
        return;
      }
      // Selected notes share a track: Shift+click adds within the active track, and a note on another
      // track starts a new selection there.
      if (input.shift && lane.track.id === state.activeTrack) {
        select({ ...state, notes: state.notes.includes(id) ? state.notes.filter(other => other !== id) : [...state.notes, id], sections: [] });
      } else {
        select({ ...state, activeTrack: lane.track.id, notes: [id], sections: [] });
      }
    },
    // Blank lane space: places a note while placing notes; otherwise clears the selection and places
    // (or drags) the cursor.
    pressLane: (lane, tick, step, input) => {
      if (input.button !== 0) {
        return;
      }
      if (settingsRef.current.placing) {
        placeAt(lane, tick, step);
        return;
      }
      if (!input.shift) {
        select({ ...committed(), notes: [], sections: [] });
      }
      return scrub(input.x);
    },
    pressSection: (ref, input) => {
      const state = committed();
      if (input.button !== 0) {
        return;
      }
      const has = state.sections.some(other => sameSection(other, ref));
      const sections = input.shift ? (has ? state.sections.filter(other => !sameSection(other, ref)) : [...state.sections, ref]) : [ref];
      select({ ...state, sections, notes: [], activeTrack: ref.kind === 'track' ? ref.track : state.activeTrack });
    },
    // Blank space below the lanes: clears the selection, and places (or drags) the cursor.
    pressBlank: (_, input) => {
      if (input.button !== 0) {
        return;
      }
      if (!input.shift) {
        select({ ...committed(), notes: [], sections: [] });
      }
      return input.x > viewRef.current.header ? scrub(input.x) : undefined;
    },
    pressHeaderEdge: input => {
      const from = { x: input.x, header: viewRef.current.header };
      return {
        move: move => {
          viewRef.current.header = Math.max(MIN_HEADER_WIDTH, Math.min(MAX_HEADER_WIDTH, from.header + move.x - from.x));
          refresh();
        },
      };
    },
    wheel: input => wheel(input),
  };

  // Places the cursor at a point and follows the pointer until release.
  const scrub = (x: number) => {
    setCursor(snappedCursor(xTick(viewRef.current, x)));
    return { move: (move: { x: number }) => setCursor(snappedCursor(xTick(viewRef.current, move.x))) };
  };

  // Where a click at a time and staff step of a lane places a note, and how long it is.
  const placement = (lane: Lane, tick: number, step: number) => {
    const { score } = committed();
    const { snap, pitchLock, division, lengthMode } = settingsRef.current;
    const start = snapTime(score, lane.track, tick, snap, 'floor');
    const { key } = attributesAt(score, lane.track, start);
    return { track: lane.track.id, start, pitch: placementPitch(step, key, pitchLock), duration: lengthTicks(division, lengthMode) };
  };

  // The note a click would place, while placing notes and the pointer is over a lane's staff area
  // (blank space or a note; not a section line).
  const ghost = (): Ghost | null => {
    const hovered = interaction.hovered;
    if (!settingsRef.current.placing || interaction.busy || !(hovered?.startsWith('lane:') || hovered?.startsWith('note:'))) {
      return null;
    }
    const { x, y } = interaction.pointer;
    const lane = lanes().find(other => y >= other.top && y < other.top + other.height);
    return lane ? placement(lane, xTick(viewRef.current, x), Math.round(yStep(lane, y))) : null;
  };

  const placeAt = (lane: Lane, tick: number, step: number) => {
    const state = committed();
    const { start, pitch, duration } = placement(lane, tick, step);
    const placed = placeNote(state.score, lane.track.id, start, pitch, duration);
    if (placed.id) {
      // A placed note isn't selected, and placing clears the selection, so Alt+scroll goes on setting
      // the next note's length rather than changing notes already placed.
      const next = { ...state, score: placed.score, activeTrack: lane.track.id, notes: [], sections: [] };
      commit(next);
      audition(next, [placed.id]);
    }
  };

  const wheel = (input: WheelInput): boolean => {
    const view = viewRef.current;
    const delta = input.deltaY || input.deltaX;
    if (input.ctrl) {
      // Zoom time around the pointer.
      const anchor = xTick(view, Math.max(view.header, input.x));
      view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-delta * 0.0015)));
      view.start = anchor - (Math.max(view.header, input.x) - view.header) / view.scale;
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

  // Alt+scroll: the selected notes' lengths, or with none selected the placement length. Up is longer.
  const changeLength = (steps: number) => {
    const state = committed();
    const { division, lengthMode } = settingsRef.current;
    if (state.notes.length > 0) {
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

  // Note-placing mode on or off. Turning it on clears the note selection, so what's placed next
  // isn't confused with what was selected.
  const togglePlacing = () => {
    const placing = !settingsRef.current.placing;
    setSettings({ placing });
    if (placing && committed().notes.length > 0) {
      select({ ...committed(), notes: [] });
    }
    invalidateRef.current();
  };

  const toggleLengthMode = (mode: LengthMode) => setSettings({ lengthMode: settingsRef.current.lengthMode === mode ? 'normal' : mode });

  // ---- Files ----

  const unsaved = () => committed().score !== savedScoreRef.current;

  const save = async (as: boolean) => {
    const { score } = committed();
    try {
      const name = fileRef.current?.name ?? `score${FILE_TYPE.extension}`;
      const result = await saveText(FILE_TYPE, serializeScore(score), name, as ? null : fileRef.current?.handle ?? null);
      if (result) {
        fileRef.current = { name: result.name, handle: result.handle };
        savedScoreRef.current = score;
        setMessage(result.downloaded ? `Downloaded ${result.name}` : `Saved ${result.name}`);
        refresh();
      }
    } catch (error) {
      if (!isCancel(error)) {
        setMessage(`Could not save: ${(error as Error).message}`);
      }
    }
  };

  const replaceScore = (score: Score, file: { name: string; handle: FileHandle | null } | null, saved: boolean) => {
    stop();
    historyRef.current = startHistory(initialState(score));
    previewRef.current = null;
    fileRef.current = file;
    // An unsaved score compares unequal to any other object, so it shows as unsaved.
    savedScoreRef.current = saved ? score : newScore();
    cursorRef.current = 0;
    refresh();
  };

  const open = async () => {
    if (unsaved() && !window.confirm('Discard unsaved changes?')) {
      return;
    }
    try {
      const opened = await pickFileToOpen(FILE_TYPE);
      if (opened) {
        replaceScore(parseScore(opened.text), { name: opened.name, handle: opened.handle }, true);
        setMessage(`Opened ${opened.name}`);
      }
    } catch (error) {
      setMessage(`Could not open: ${(error as Error).message}`);
    }
  };

  const startNew = () => {
    if (unsaved() && !window.confirm('Discard unsaved changes?')) {
      return;
    }
    replaceScore(newScore(), null, true);
    setMessage(null);
  };

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
      if (key === 's') {
        void save(input.shift);
        return true;
      }
      if (key === 'o') {
        void open();
        return true;
      }
      if (key === 'j' && state.notes.length > 0) {
        commit({ ...state, score: tieNotes(state.score, state.notes) });
        return true;
      }
      if (key === 'c' && state.notes.length > 0) {
        clipboardRef.current = copyNotes(state.score, state.notes);
        return true;
      }
      if (key === 'v' && clipboardRef.current && state.score.tracks[state.activeTrack]) {
        const pasted = pasteNotes(state.score, state.activeTrack, cursorRef.current, clipboardRef.current);
        commit({ ...state, score: pasted.score, notes: pasted.ids, sections: [] });
        return true;
      }
      // Ctrl+J would open the browser's downloads.
      return key === 'j';
    }
    if (key === ' ') {
      togglePlay();
      return true;
    }
    if (key === 'Tab') {
      togglePlacing();
      return true;
    }
    if (key === 'Escape' && settingsRef.current.placing) {
      setSettings({ placing: false });
      invalidateRef.current();
      return true;
    }
    if (key === 'd' && !input.shift && !input.alt) {
      toggleLengthMode('dotted');
      return true;
    }
    if (key === 't') {
      toggleLengthMode('triplet');
      return true;
    }
    return sectionKey(state, key) || noteKey(state, key, input);
  };

  const noteKey = (state: EditorState, key: string, input: KeyInput): boolean => {
    const track = state.score.tracks[state.activeTrack];
    if (key === 'a') {
      select({ ...state, notes: input.alt || !track ? [] : trackNotes(state.score, track).map(item => item.note.id), sections: [] });
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
      const next = { ...state, score: moveNotes(state.score, state.notes, 0, key === 'ArrowUp' ? 1 : -1) };
      commit(next);
      audition(next, state.notes);
      return true;
    }
    if (key === 'j' && input.alt && state.notes.length > 0) {
      commit({ ...state, score: untieNotes(state.score, state.notes) });
      return true;
    }
    // Shift+D: copies of the selection, then moving them; cancelling the move removes them.
    if (key === 'd' && input.shift && state.notes.length > 0) {
      const clip = copyNotes(state.score, state.notes);
      const origin = Math.min(...locateNotes(state.score, state.notes).map(item => item.start));
      const pasted = pasteNotes(state.score, state.activeTrack, origin, clip, false);
      interaction.startModal(grabNotes(operatorContext, interaction.pointer, { ...state, score: pasted.score, notes: pasted.ids }, state));
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

  // Keys for selected section lines and bounds.
  const sectionKey = (state: EditorState, key: string): boolean => {
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

  // S with sections selected: splits each selected line (the global one, or a track's) at the cursor.
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
      state: shown(), placing: settingsRef.current.placing, ghost: ghost(), view: viewRef.current, lanes: lanes(), cursor: cursorRef.current, playhead: playhead(), box: boxRef.current, actions,
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

  // Restore the last session's score, once.
  const replaceRef = useRef(replaceScore);
  replaceRef.current = replaceScore;
  useEffect(() => {
    let cancelled = false;
    sessions.get(SESSION_KEY).then(session => {
      if (!cancelled && session?.score) {
        replaceRef.current(session.score, session.file, session.saved);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave the score a second after it last changed.
  const autosaved = useRef<Score | null>(null);
  const currentScore = historyRef.current.present.score;
  useEffect(() => {
    if (autosaved.current === currentScore) {
      return;
    }
    const timer = setTimeout(() => {
      autosaved.current = currentScore;
      const session: Session = { score: currentScore, file: fileRef.current, saved: currentScore === savedScoreRef.current };
      // If the file handle can't be stored, keep the score and the file's name without it.
      sessions.put(SESSION_KEY, session)
        .catch(() => sessions.put(SESSION_KEY, { ...session, file: session.file && { name: session.file.name, handle: null } }))
        .catch(() => {});
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
  });

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
  const status = modal?.describe?.() ?? (settings.placing
    ? ['Placing notes: click a lane', 'Tab or Esc: stop placing', 'Alt+scroll: length', 'D / T: dotted / triplet', 'Space: play']
    : state.sections.length > 0
    ? ['Sections', 'G: move (bounds: resize)', 'S: split at cursor', 'Alt+A: deselect', 'Space: play']
    : ['Tab: place notes', 'Click a note, section line or bound: select it', 'Drag a lane or the ruler: cursor', 'G: move (then Z: pitch)', 'B: box select', 'S: split at cursor', '↑↓: semitone', 'Ctrl+J: tie', 'Shift+D: duplicate', 'Alt+scroll: length', 'Space: play']).join('  ·  ');

  return (
    <div className='notespec'>
      <div className='notespec-toolbar'>
        <div className='notespec-group'>
          <div className='notespec-segments' role='group' aria-label='File'>
            <button onClick={startNew} title='New score'>New</button>
            <button onClick={() => void open()} title='Open (Ctrl+O)'>Open</button>
            <button onClick={() => void save(false)} title='Save (Ctrl+S; Shift+Ctrl+S: save as)'>Save</button>
          </div>
          <span className='notespec-label' data-testid='file-name'>{fileRef.current?.name ?? 'Unsaved score'}{unsaved() ? ' •' : ''}</span>
        </div>
        <div className='notespec-group'>
          <div className='notespec-segments' role='group' aria-label='Placing'>
            <button aria-pressed={settings.placing} onClick={togglePlacing} title='Place notes by clicking a lane (Tab; Esc stops)'>
              Place notes
            </button>
          </div>
          <div className='notespec-segments' role='group' aria-label='Playback'>
            <button aria-pressed={playRef.current !== null} onClick={togglePlay} title='Play from the cursor (Space)'>{playRef.current ? '■ Stop' : '▶ Play'}</button>
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
        <div className='notespec-group'>
          <span className='notespec-label'>Spell</span>
          <div className='notespec-segments' role='group' aria-label='Spelling'>
            {(['sharp', 'flat'] as const).map(spelling => {
              const notes = locateNotes(state.score, state.notes);
              const pressed = notes.length > 0 && notes.every(item => item.note.spelling === spelling);
              return (
                <button
                  key={spelling}
                  aria-label={`Spell as ${spelling}s`}
                  aria-pressed={pressed}
                  disabled={notes.length === 0}
                  title={`Draw the selected notes with ${spelling}s; click again to follow the key`}
                  onClick={() => commit({ ...committed(), score: setSpelling(committed().score, committed().notes, pressed ? undefined : spelling) })}
                >
                  {spelling === 'sharp' ? '♯' : '♭'}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className='notespec-main'>
        <canvas ref={canvasRef} className='notespec-canvas' data-testid='score' />
        <PaneDivider orientation='vertical' value={sideWidth} min={180} max={600} inverted label='Resize the side panel' onChange={setSideWidth} />
        <div className='notespec-side' style={{ width: sideWidth }}>
          <div style={{ display: 'flex', flexDirection: 'column', height: outlinerHeight, minHeight: 0 }}>
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
          </div>
          <PaneDivider orientation='horizontal' value={outlinerHeight} min={80} max={1200} inverted={false} label='Resize the outliner' onChange={setOutlinerHeight} />
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <Properties
            score={state.score}
            section={state.sections.at(-1) ?? null}
            activeTrack={state.activeTrack}
            onGlobal={(id, changes) => commit({ ...committed(), score: setGlobal(committed().score, id, changes) }, `global:${id}:${Object.keys(changes).join()}`)}
            onOverride={(track, id, overrides) => commit({ ...committed(), score: setTrackSection(committed().score, track, id, { overrides }) }, `section:${id}`)}
            onMargins={(track, margins) => commit({ ...committed(), score: setTrack(committed().score, track, { margins }) }, `margins:${track}`)}
          />
          </div>
        </div>
      </div>
      <div className='notespec-status'>{message ? `${message}  ·  ${status}` : status}</div>
    </div>
  );
};

export default Notespec;
