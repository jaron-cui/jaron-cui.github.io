import {
  addConnection, addSegment, addVertex, buildIndex, bundlePorts, connectionPorts, emptyDoc, isComplete, pruneRoutes,
  routeAlongWire, unrouted,
} from './model';
import type { GNode, GraphDoc } from './model';

function circle(id: string, x: number, y: number): GNode {
  return { id, label: id, shape: 'circle', x, y, r: 10, w: 0, h: 0, angle: 0, units: [{ id, label: id }], labelAt: 'inside' };
}

// A source S with two outputs bundled into one port, to targets A and B.
function bundled(): { doc: GraphDoc; port: string; portA: string; portB: string } {
  const doc = emptyDoc('test');
  doc.nodes.S = circle('S', 0, 0);
  doc.nodes.A = circle('A', 100, -50);
  doc.nodes.B = circle('B', 100, 50);
  addConnection(doc, buildIndex(doc), 'S', 'A', 1);
  addConnection(doc, buildIndex(doc), 'S', 'B', -1);
  const index = buildIndex(doc);
  const port = bundlePorts(doc, [connectionPorts(index, 'S->A')[0]!, connectionPorts(index, 'S->B')[0]!])!;
  const after = buildIndex(doc);
  return { doc, port, portA: connectionPorts(after, 'S->A')[1]!, portB: connectionPorts(after, 'S->B')[1]! };
}

describe('wiring a bundle', () => {
  it('lets a branch fork off a trunk that already runs into another target', () => {
    const { doc, port, portA, portB } = bundled();
    // The trunk carries both connections all the way into A's port.
    const fork = addVertex(doc, { x: 50, y: 0 });
    addSegment(doc, port, fork, ['S->A', 'S->B']);
    addSegment(doc, fork, portA, ['S->A', 'S->B']);
    let index = buildIndex(doc);
    expect(isComplete(doc, index, 'S->A')).toBe(true);
    expect(isComplete(doc, index, 'S->B')).toBe(false);
    // At the fork, only the connection still missing its target is offered.
    expect(unrouted(doc, index, fork)).toEqual(['S->B']);

    // Branch to B; once complete, S->B comes off the part of the trunk it no longer uses.
    const corner = addVertex(doc, { x: 80, y: 40 });
    addSegment(doc, fork, corner, ['S->B']);
    addSegment(doc, corner, portB, ['S->B']);
    pruneRoutes(doc);
    index = buildIndex(doc);
    expect(isComplete(doc, index, 'S->B')).toBe(true);
    const intoA = Object.values(doc.segments).find(sg => (sg.a === fork && sg.b === portA) || (sg.b === fork && sg.a === portA))!;
    expect(intoA.conns).toEqual(['S->A']);
  });

  it('routes connections along wire that was drawn carrying nothing', () => {
    const { doc, port, portA, portB } = bundled();
    const fork = addVertex(doc, { x: 50, y: 0 });
    addSegment(doc, port, fork);
    addSegment(doc, fork, portA);
    addSegment(doc, fork, portB);
    expect(routeAlongWire(doc, ['S->A', 'S->B'])).toBe(2);
    const index = buildIndex(doc);
    expect(isComplete(doc, index, 'S->A')).toBe(true);
    expect(isComplete(doc, index, 'S->B')).toBe(true);
    // Each branch carries only its own connection; the trunk carries both.
    const carries = (a: string, b: string) => Object.values(doc.segments).find(sg => (sg.a === a && sg.b === b) || (sg.a === b && sg.b === a))!.conns.sort();
    expect(carries(port, fork)).toEqual(['S->A', 'S->B']);
    expect(carries(fork, portA)).toEqual(['S->A']);
    expect(carries(fork, portB)).toEqual(['S->B']);
  });

  it('does not route through another port', () => {
    const { doc, port, portA, portB } = bundled();
    addSegment(doc, port, portA);
    addSegment(doc, portA, portB);
    expect(routeAlongWire(doc, ['S->B'])).toBe(0);
  });
});
