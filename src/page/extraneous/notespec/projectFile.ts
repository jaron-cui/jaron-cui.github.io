// notespec's file format: the score as JSON, with a format name and version so later versions can
// read older files.
import { FileType } from '../../../lib/psave/files';
import { Score } from './score';

export const FILE_TYPE: FileType = { description: 'notespec score', extension: '.notespec' };
const FORMAT = 'notespec';
const VERSION = 1;

export function serializeScore(score: Score): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, score });
}

// Reads a file's text, or throws an error that says what's wrong with it.
export function parseScore(text: string): Score {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a notespec score (it is not JSON).');
  }
  const file = data as { format?: unknown; version?: unknown; score?: Partial<Score> };
  if (file?.format !== FORMAT) {
    throw new Error('This file is not a notespec score.');
  }
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new Error('This score was saved by a newer version of notespec.');
  }
  const score = file.score;
  if (!score || !Array.isArray(score.globals) || typeof score.tracks !== 'object' || typeof score.folders !== 'object' || !Array.isArray(score.tree) || typeof score.nextId !== 'number') {
    throw new Error('This notespec score is incomplete.');
  }
  return score as Score;
}
