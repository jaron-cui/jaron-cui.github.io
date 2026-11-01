// Undo history over immutable snapshots. Because a snapshot shares everything unchanged with its
// neighbors, keeping many of them costs little.
export type History<T> = { past: T[]; present: T; future: T[]; coalesceKey: string | null };

const MAX_UNDO_STEPS = 500;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], coalesceKey: null };
}

// Records a new present and clears the redo steps. Consecutive commits with the same key form one
// undo step, as when dragging a color or a key. Committing the same object records nothing.
export function commit<T>(history: History<T>, next: T, coalesceKey: string | null = null): History<T> {
  if (next === history.present) {
    return history;
  }
  if (coalesceKey !== null && coalesceKey === history.coalesceKey) {
    return { ...history, present: next, future: [] };
  }
  return { past: [...history.past, history.present].slice(-MAX_UNDO_STEPS), present: next, future: [], coalesceKey };
}

// Ends the current undo step, so that the next commit starts a new one even with the same key.
export function endStep<T>(history: History<T>): History<T> {
  return history.coalesceKey === null ? history : { ...history, coalesceKey: null };
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) {
    return history;
  }
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
    coalesceKey: null,
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) {
    return history;
  }
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
    coalesceKey: null,
  };
}
