import type { Edge, Node } from '@xyflow/react';
import type { FrameSnap, HeapObjectSnap, StaticsSnap, Step, Value } from '../runtime/types';
import { sameValue } from './ValueView';

export type XY = { x: number; y: number };
/** Positions of cards the user dragged, by node id. */
export type Pinned = Record<string, XY>;
/** Rendered sizes reported by React Flow, by node id. */
export type Sizes = Record<string, { width: number; height: number }>;

export type FrameNodeData = { frame: FrameSnap; isTop: boolean; isNew: boolean; changed: string[] };
export type StaticsNodeData = { statics: StaticsSnap; changed: string[] };
export type HeapNodeData = { obj: HeapObjectSnap; isNew: boolean; changed: string[]; column: number };
export type LabelNodeData = { label: string; hint: string };

export type MemoryNode =
  | Node<FrameNodeData, 'frame'>
  | Node<StaticsNodeData, 'statics'>
  | Node<HeapNodeData, 'heap'>
  | Node<LabelNodeData, 'label'>;

export type EdgeData = { faded: boolean; current: boolean };
export type MemoryEdge = Edge<EdgeData, 'floating'>;

// Layout constants (px). Estimates are only used until React Flow has measured a card.
const FRAME_WIDTH = 280;
const HEADER_H = 32;
const ROW_H = 29;
const V_GAP = 22;
const COL_GAP = 90;
const LABEL_Y = -44;

export const frameId = (f: FrameSnap) => `frame-${f.id}`;
export const staticsId = (s: StaticsSnap) => `static-${s.className}`;
export const objId = (addr: number) => `obj-${addr}`;

/** Handle ids for the slots that can hold a reference. */
export const handleIds = {
  local: (name: string) => `local:${name}`,
  static: (name: string) => `static:${name}`,
  field: (name: string) => `field:${name}`,
  elem: (i: number) => `elem:${i}`,
};

function estimateHeap(obj: HeapObjectSnap): { width: number; height: number } {
  switch (obj.kind) {
    case 'string':
      return { width: Math.min(420, Math.max(150, 60 + obj.value.length * 8)), height: HEADER_H + 34 };
    case 'array':
      return { width: Math.min(460, Math.max(150, obj.elements.length * 56)), height: HEADER_H + (obj.elements.length ? 50 : 30) };
    case 'object':
      return { width: 240, height: HEADER_H + Math.max(1, obj.fields.length) * ROW_H };
  }
}

const estimateRows = (rows: number) => ({ width: FRAME_WIDTH, height: HEADER_H + Math.max(1, rows) * ROW_H });

function refAddr(v: Value): number | null {
  return v.kind === 'ref' ? v.addr : null;
}

/** Every reference a heap object holds, with the handle it leaves from. */
function outgoing(obj: HeapObjectSnap): { handle: string; addr: number }[] {
  const out: { handle: string; addr: number }[] = [];
  if (obj.kind === 'object') {
    for (const f of obj.fields) {
      const a = refAddr(f.value);
      if (a !== null) out.push({ handle: handleIds.field(f.name), addr: a });
    }
  } else if (obj.kind === 'array') {
    obj.elements.forEach((v, i) => {
      const a = refAddr(v);
      if (a !== null) out.push({ handle: handleIds.elem(i), addr: a });
    });
  }
  return out;
}

function changedVars(now: { name: string; value: Value }[], before?: { name: string; value: Value }[]): string[] {
  if (!before) return [];
  return now.filter((v) => !sameValue(before.find((b) => b.name === v.name)?.value, v.value)).map((v) => v.name);
}

/**
 * Turns one memory snapshot into React Flow nodes and edges.
 *
 * Layout: the stack (frames, current on top, then static fields) is column 0.
 * Heap objects are placed in columns by how many references away from the
 * stack they are, in the order they are first reached, so most arrows run
 * left to right without crossing. Pinned (dragged) positions always win.
 */
export function buildGraph(step: Step, prev: Step | undefined, pinned: Pinned, sizes: Sizes): { nodes: MemoryNode[]; edges: MemoryEdge[] } {
  const nodes: MemoryNode[] = [];
  const edges: MemoryEdge[] = [];
  const size = (id: string, fallback: { width: number; height: number }) => sizes[id] ?? fallback;
  const place = (id: string, auto: XY): XY => pinned[id] ?? auto;

  const heapByAddr = new Map(step.heap.map((o) => [o.addr, o]));
  const prevHeap = new Map(prev?.heap.map((o) => [o.addr, o]));
  const prevFrames = new Map(prev?.frames.map((f) => [f.id, f]));
  const topFrameId = step.frames[step.frames.length - 1]?.id;

  const addEdge = (source: string, handle: string, addr: number, current: boolean, sourceGarbage: boolean) => {
    const target = heapByAddr.get(addr);
    if (!target) return;
    edges.push({
      id: `${source}|${handle}`,
      source,
      sourceHandle: handle,
      target: objId(addr),
      type: 'floating',
      data: { faded: sourceGarbage || target.garbage, current },
    });
  };

  // ---- column 0: the stack, then static fields
  let y = 0;
  const roots: number[] = [];
  for (const f of [...step.frames].reverse()) {
    const id = frameId(f);
    const before = prevFrames.get(f.id);
    nodes.push({
      id,
      type: 'frame',
      position: place(id, { x: 0, y }),
      dragHandle: '.node-drag',
      data: { frame: f, isTop: f.id === topFrameId, isNew: !!prev && !before, changed: changedVars(f.locals, before?.locals) },
    });
    y += size(id, estimateRows(f.locals.length)).height + V_GAP;
    for (const v of f.locals) {
      const a = refAddr(v.value);
      if (a === null) continue;
      roots.push(a);
      addEdge(id, handleIds.local(v.name), a, f.id === topFrameId, false);
    }
  }
  if (step.statics.length) y += V_GAP;
  for (const s of step.statics) {
    const id = staticsId(s);
    const before = prev?.statics.find((p) => p.className === s.className);
    nodes.push({
      id,
      type: 'statics',
      position: place(id, { x: 0, y }),
      dragHandle: '.node-drag',
      data: { statics: s, changed: changedVars(s.fields, before?.fields) },
    });
    y += size(id, estimateRows(s.fields.length)).height + V_GAP;
    for (const v of s.fields) {
      const a = refAddr(v.value);
      if (a === null) continue;
      roots.push(a);
      addEdge(id, handleIds.static(v.name), a, false, false);
    }
  }

  // ---- heap columns by reference depth (breadth-first from the stack)
  const columns: HeapObjectSnap[][] = [];
  const depth = new Map<number, number>();
  let frontier = roots.filter((a) => heapByAddr.has(a));
  let d = 0;
  while (frontier.length) {
    const next: number[] = [];
    for (const addr of frontier) {
      if (depth.has(addr)) continue;
      depth.set(addr, d);
      const obj = heapByAddr.get(addr)!;
      (columns[d] ??= []).push(obj);
      for (const o of outgoing(obj)) if (!depth.has(o.addr) && heapByAddr.has(o.addr)) next.push(o.addr);
    }
    frontier = next;
    d++;
  }
  // Objects no variable reaches: pooled literals, in-flight temporaries, then garbage last.
  const unreached = step.heap.filter((o) => !depth.has(o.addr));
  const rest = unreached.filter((o) => !o.garbage);
  const garbage = unreached.filter((o) => o.garbage);
  if (rest.length) columns.push(rest);
  if (garbage.length) columns.push(garbage);

  const heapX0 = FRAME_WIDTH + COL_GAP;
  let x = heapX0;
  columns.forEach((col, ci) => {
    let cy = 0;
    let colWidth = 0;
    for (const obj of col) {
      const id = objId(obj.addr);
      const s = size(id, estimateHeap(obj));
      const before = prevHeap.get(obj.addr);
      let changed: string[] = [];
      if (obj.kind === 'object' && before?.kind === 'object') changed = changedVars(obj.fields, before.fields);
      if (obj.kind === 'array' && before?.kind === 'array') {
        changed = obj.elements.flatMap((v, i) => (sameValue(before.elements[i], v) ? [] : [String(i)]));
      }
      nodes.push({
        id,
        type: 'heap',
        position: place(id, { x, y: cy }),
        dragHandle: '.node-drag',
        data: { obj, isNew: !!prev && !before, changed, column: ci + 1 },
      });
      cy += s.height + V_GAP;
      colWidth = Math.max(colWidth, s.width);
      for (const o of outgoing(obj)) addEdge(id, o.handle, o.addr, false, obj.garbage);
    }
    x += colWidth + COL_GAP;
  });

  // Column labels only make sense while their column is still auto-arranged;
  // once the user drags one of its cards, the label would float over nothing.
  const isPinned = (types: MemoryNode['type'][]) => nodes.some((n) => types.includes(n.type) && pinned[n.id]);
  if (!isPinned(['frame', 'statics'])) {
    nodes.push(labelNode('label-stack', { x: 0, y: LABEL_Y }, 'Stack', 'one frame per method call · top = running now'));
  }
  if (step.heap.length && !isPinned(['heap'])) {
    nodes.push(labelNode('label-heap', { x: heapX0, y: LABEL_Y }, 'Heap', 'objects, arrays and Strings'));
  }
  return { nodes, edges };
}

function labelNode(id: string, position: XY, label: string, hint: string): MemoryNode {
  return { id, type: 'label', position, data: { label, hint }, draggable: false, selectable: false, focusable: false };
}
