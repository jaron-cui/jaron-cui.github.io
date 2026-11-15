import type { Edge, Face } from '../../../lib/vrender/model';
import { marksAfterCopy, marksAfterDelete, marksAfterMirror, marksAfterOffset, marksAfterSubdivide, marksOnMesh, selectedLines, setMarked } from './marks';

const square: Face[] = [[0, 1, 2], [0, 2, 3]];
const sorted = (edges: Edge[]) => edges.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)).sort();

describe('marked edges', () => {
  it('chooses lines with both ends selected, sides and diagonals alike', () => {
    expect(sorted(selectedLines(square, [], new Set([0, 1, 2])))).toEqual(['0-1', '0-2', '1-2']);
    expect(sorted(selectedLines(square, [[3, 4]], new Set([3, 4])))).toEqual(['3-4']);
  });

  it('marks and clears without duplicates, whichever way a pair is written', () => {
    const marked = setMarked([[0, 1]], [[1, 0], [1, 2]], true);
    expect(sorted(marked)).toEqual(['0-1', '1-2']);
    expect(sorted(setMarked(marked, [[2, 1]], false))).toEqual(['0-1']);
  });

  it('follows deletion, and drops marks whose line is gone', () => {
    // Deleting vertex 1 renumbers 2 and 3 down by one.
    expect(sorted(marksAfterDelete([[0, 1], [2, 3], [0, 3]], [0, 2, 3]))).toEqual(['0-2', '1-2']);
    // A line deleted in line mode leaves its vertices but loses its mark.
    expect(sorted(marksOnMesh([[0, 1], [0, 2], [5, 6]], [[0, 2, 3]], []))).toEqual(['0-2']);
  });

  it('copies marks with duplicated vertices, splits them, and offsets them', () => {
    // Vertices 1 and 2 are copied to 4 and 5.
    expect(sorted(marksAfterCopy([[1, 2], [0, 1]], [1, 2], 4))).toEqual(['0-1', '1-2', '4-5']);
    // Splitting 1–2 at new vertex 4 keeps both halves marked.
    expect(sorted(marksAfterSubdivide([[1, 2], [0, 3]], [[2, 1]], 4))).toEqual(['0-3', '1-4', '2-4']);
    expect(marksAfterOffset([[0, 1]], 10)).toEqual([[10, 11]]);
  });

  it('reflects marks in a mirror, with welded vertices shared', () => {
    // Vertex 0 is on the plane (welded); 1 and 2 are copied to 3 and 4.
    expect(sorted(marksAfterMirror([[0, 1], [1, 2]], [1, 2], 3))).toEqual(['0-1', '0-3', '1-2', '3-4']);
  });
});
