export type PrimType = 'int' | 'long' | 'double' | 'float' | 'boolean' | 'char' | 'byte' | 'short';

/**
 * A value held in a variable, field or array slot.
 * - prim: the value itself is stored in the slot (char is stored as its UTF-16 code)
 * - ref:  the slot stores only an address into the heap (or null)
 * - uninit: a local that was declared but not yet assigned
 */
export type Value =
  | { kind: 'prim'; type: PrimType; value: number | boolean }
  | { kind: 'ref'; addr: number | null }
  | { kind: 'uninit' };

export interface Var {
  name: string;
  type: string; // declared Java type, e.g. "int", "Person", "int[]"
  value: Value;
}

export type HeapObject =
  | { kind: 'object'; addr: number; className: string; fields: Var[] }
  | { kind: 'array'; addr: number; elemType: string; elements: Value[] }
  | { kind: 'string'; addr: number; value: string; interned: boolean };

export type HeapObjectSnap = HeapObject & { garbage: boolean };

export interface FrameSnap {
  id: number;
  className: string;
  method: string;
  line: number;
  locals: Var[];
  /** A built-in Java library method (Math, Scanner) rather than user code. */
  native?: boolean;
}

export interface StaticsSnap {
  className: string;
  fields: Var[];
}

export interface Step {
  /** Line the step refers to (1-based). */
  line: number;
  /** Bottom (main) first, top (current) last. */
  frames: FrameSnap[];
  heap: HeapObjectSnap[];
  statics: StaticsSnap[];
  output: string;
  /** Program input (System.in) and how much of it has been read so far. */
  input: { text: string; pos: number };
  /** Plain-language explanation of what just happened. */
  event: string;
  /** Addresses reclaimed by the garbage collector in this step. */
  collected: number[];
  error?: string;
}

export interface RunResult {
  steps: Step[];
  /** Compile-time (parse) error; when present, steps is empty. */
  parseError?: { message: string; line: number };
}
