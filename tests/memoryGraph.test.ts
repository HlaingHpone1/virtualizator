import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { run } from '../src/runtime/interpreter';
import type { Step } from '../src/runtime/types';
import { buildGraph, type MemoryNode } from '../src/ui/memoryGraph';

function stepsFor(id: string): Step[] {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  return run(ex.code, ex.input ?? '').steps;
}

/** First step where main has a local with this name. */
function stepWith(steps: Step[], name: string): { step: Step; prev?: Step } {
  const i = steps.findIndex((s) => s.frames.length === 1 && s.frames[0].locals.some((v) => v.name === name));
  return { step: steps[i], prev: steps[i - 1] };
}

const byId = (nodes: MemoryNode[], id: string) => nodes.find((n) => n.id === id)!;
const heapColumn = (n: MemoryNode) => (n.type === 'heap' ? n.data.column : -1);

describe('buildGraph', () => {
  it('creates one node per frame, static class and heap object, plus labels', () => {
    const { step } = stepWith(stepsFor('scanner'), 'age');
    const { nodes } = buildGraph(step, undefined, {}, {});
    const count = (t: string) => nodes.filter((n) => n.type === t).length;
    expect(count('frame')).toBe(step.frames.length);
    expect(count('statics')).toBe(step.statics.length);
    expect(count('heap')).toBe(step.heap.length);
    expect(count('label')).toBe(2);
  });

  it('keeps node ids stable between steps', () => {
    const steps = stepsFor('linked-list');
    const ids = (s: Step) => new Set(buildGraph(s, undefined, {}, {}).nodes.map((n) => n.id));
    const a = ids(steps[10]);
    const b = ids(steps[11]);
    const shared = [...a].filter((id) => b.has(id));
    expect(shared).toContain(`frame-${steps[10].frames[0].id}`);
    expect(shared.filter((id) => id.startsWith('obj-')).length).toBeGreaterThan(0);
  });

  it('creates one edge per non-null reference with the right handle', () => {
    const { step } = stepWith(stepsFor('scanner'), 'age');
    const { edges } = buildGraph(step, undefined, {}, {});
    const main = step.frames[0];
    const sc = main.locals.find((v) => v.name === 'sc')!.value as { addr: number };
    expect(edges).toContainEqual(
      expect.objectContaining({ source: `frame-${main.id}`, sourceHandle: 'local:sc', target: `obj-${sc.addr}`, type: 'floating' }),
    );
    expect(edges).toContainEqual(expect.objectContaining({ source: `obj-${sc.addr}`, sourceHandle: 'field:source' }));
    expect(edges).toContainEqual(expect.objectContaining({ source: 'static-System', sourceHandle: 'static:in' }));
    const refCount =
      step.frames.flatMap((f) => f.locals).filter((v) => v.value.kind === 'ref' && v.value.addr !== null).length +
      step.statics.flatMap((s) => s.fields).filter((v) => v.value.kind === 'ref' && v.value.addr !== null).length +
      step.heap.flatMap((o) => (o.kind === 'object' ? o.fields.map((f) => f.value) : o.kind === 'array' ? o.elements : []))
        .filter((v) => v.kind === 'ref' && v.addr !== null).length;
    expect(edges).toHaveLength(refCount);
  });

  it('places heap objects in columns by reference depth', () => {
    const { step } = stepWith(stepsFor('scanner'), 'age');
    const { nodes } = buildGraph(step, undefined, {}, {});
    const local = (name: string) => (step.frames[0].locals.find((v) => v.name === name)!.value as { addr: number }).addr;
    const scanner = byId(nodes, `obj-${local('sc')}`);
    const stdin = byId(nodes, `obj-${(step.statics[0].fields[0].value as { addr: number }).addr}`);
    expect(heapColumn(scanner)).toBe(1);
    expect(heapColumn(stdin)).toBe(1); // System.in is referenced directly from a static field
    expect(scanner.position.x).toBeGreaterThan(0);

    // In the linked list, node 3 is only reachable through node 1 → node 2 → node 3.
    const ll = stepsFor('linked-list');
    const s = ll.find((x) => x.heap.filter((o) => o.kind === 'object').length === 3 && x.frames.length === 1)!;
    const g = buildGraph(s, undefined, {}, {});
    const cols = g.nodes.filter((n) => n.type === 'heap' && n.data.obj.kind === 'object').map(heapColumn);
    expect(cols).toEqual(expect.arrayContaining([1, 2, 3]));
  });

  it('does not overlap auto-laid-out cards in the same column', () => {
    for (const ex of EXAMPLES) {
      const steps = run(ex.code, ex.input ?? '').steps;
      const { nodes } = buildGraph(steps[Math.floor(steps.length / 2)], undefined, {}, {});
      const cards = nodes.filter((n) => n.type !== 'label');
      const columns = new Map<number, MemoryNode[]>();
      for (const n of cards) columns.set(n.position.x, [...(columns.get(n.position.x) ?? []), n]);
      for (const col of columns.values()) {
        const ys = col.map((n) => n.position.y).sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], ex.id).toBeGreaterThan(40);
      }
    }
  });

  it('hides a column label once a card in that column has been dragged', () => {
    const { step } = stepWith(stepsFor('aliasing'), 'q');
    const labels = (pinned: Record<string, { x: number; y: number }>) =>
      buildGraph(step, undefined, pinned, {}).nodes.filter((n) => n.type === 'label').map((n) => n.id);
    const heapNode = `obj-${step.heap[0].addr}`;
    expect(labels({})).toEqual(['label-stack', 'label-heap']);
    expect(labels({ [`frame-${step.frames[0].id}`]: { x: 0, y: 300 } })).toEqual(['label-heap']);
    expect(labels({ [heapNode]: { x: 900, y: 0 } })).toEqual(['label-stack']);
    expect(labels({ 'obj-999999': { x: 0, y: 0 } })).toEqual(['label-stack', 'label-heap']); // stale pins don't count
  });

  it('uses pinned positions and measured sizes', () => {
    const { step } = stepWith(stepsFor('aliasing'), 'q');
    const frame = `frame-${step.frames[0].id}`;
    const { nodes } = buildGraph(step, undefined, { [frame]: { x: 500, y: -200 } }, {});
    expect(byId(nodes, frame).position).toEqual({ x: 500, y: -200 });

    // A tall measured frame pushes the next card in column 0 down.
    const withStatics = stepWith(stepsFor('scanner'), 'age').step;
    const f = `frame-${withStatics.frames[0].id}`;
    const small = buildGraph(withStatics, undefined, {}, {}).nodes;
    const tall = buildGraph(withStatics, undefined, {}, { [f]: { width: 280, height: 900 } }).nodes;
    expect(byId(tall, 'static-System').position.y).toBeGreaterThan(byId(small, 'static-System').position.y);
  });

  it('marks changed slots and new objects against the previous step', () => {
    const { step, prev } = stepWith(stepsFor('aliasing'), 'q');
    const frame = byId(buildGraph(step, prev, {}, {}).nodes, `frame-${step.frames[0].id}`);
    expect(frame.type === 'frame' && frame.data.changed).toEqual(['q']);
  });
});
