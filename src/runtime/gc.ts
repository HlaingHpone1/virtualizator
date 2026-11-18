import type { Heap } from './heap';
import type { Value } from './types';

/**
 * Mark phase of a mark-and-sweep collector: returns every address reachable
 * from the given roots (stack locals, static fields, in-flight temporaries).
 * Interned Strings are always reachable because the String pool holds them.
 */
export function markReachable(heap: Heap, roots: Iterable<Value>): Set<number> {
  const marked = new Set<number>();
  const work: number[] = [];

  const visit = (v: Value) => {
    if (v.kind === 'ref' && v.addr !== null && !marked.has(v.addr) && heap.objects.has(v.addr)) {
      marked.add(v.addr);
      work.push(v.addr);
    }
  };

  for (const v of roots) visit(v);
  for (const addr of heap.pool.values()) visit({ kind: 'ref', addr });

  while (work.length > 0) {
    const obj = heap.get(work.pop()!);
    if (obj.kind === 'object') obj.fields.forEach((f) => visit(f.value));
    else if (obj.kind === 'array') obj.elements.forEach(visit);
  }
  return marked;
}
