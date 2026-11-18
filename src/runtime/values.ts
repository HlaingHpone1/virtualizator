import { PRIMITIVE_TYPES } from '../lang/tokens';
import type { PrimType, Value } from './types';

export const NULL: Value = { kind: 'ref', addr: null };
export const UNINIT: Value = { kind: 'uninit' };

export function isPrimitiveType(type: string): type is PrimType {
  return PRIMITIVE_TYPES.has(type);
}

export function prim(type: PrimType, value: number | boolean): Value {
  return { kind: 'prim', type, value };
}

export function ref(addr: number | null): Value {
  return { kind: 'ref', addr };
}

/** The value a field or array element starts with before anything is assigned. */
export function defaultValue(type: string): Value {
  if (!isPrimitiveType(type)) return NULL;
  return prim(type, type === 'boolean' ? false : 0);
}

export function formatAddr(addr: number): string {
  return '@' + addr.toString(16);
}

/** Java's Double.toString, close enough for teaching purposes. */
export function formatDouble(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n > 0 ? 'Infinity' : '-Infinity';
  if (Number.isInteger(n) && Math.abs(n) < 1e7) return n.toFixed(1);
  const abs = Math.abs(n);
  if (abs >= 1e7 || (abs > 0 && abs < 1e-3)) {
    const [mant, exp] = n.toExponential().split('e');
    const m = mant.includes('.') ? mant : mant + '.0';
    return `${m}E${Number(exp)}`;
  }
  return String(n);
}

/** Formats a primitive the way System.out.println would print it. */
export function formatPrim(v: Extract<Value, { kind: 'prim' }>): string {
  switch (v.type) {
    case 'boolean':
      return String(v.value);
    case 'char':
      return String.fromCharCode(v.value as number);
    case 'double':
    case 'float':
      return formatDouble(v.value as number);
    default:
      return String(v.value);
  }
}

/** Short label for showing a value in the memory view or explanations. */
export function describeValue(v: Value): string {
  if (v.kind === 'uninit') return '?';
  if (v.kind === 'ref') return v.addr === null ? 'null' : formatAddr(v.addr);
  if (v.type === 'char') return `'${formatPrim(v)}'`;
  return formatPrim(v);
}
