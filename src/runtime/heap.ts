import type { HeapObject, Var } from './types';
import { defaultValue } from './values';
import type { Value } from './types';

const BASE_ADDR = 0x1000;
const ADDR_STRIDE = 0x10;

/** Simulated heap: every object, array and String lives here, keyed by address. */
export class Heap {
  readonly objects = new Map<number, HeapObject>();
  /** String pool: literal text → address of its interned String object. */
  readonly pool = new Map<string, number>();
  private nextAddr = BASE_ADDR;

  private take(): number {
    const addr = this.nextAddr;
    this.nextAddr += ADDR_STRIDE;
    return addr;
  }

  get(addr: number): HeapObject {
    const obj = this.objects.get(addr);
    if (!obj) throw new Error(`Internal error: dangling reference ${addr.toString(16)}`);
    return obj;
  }

  allocObject(className: string, fields: { name: string; type: string }[]): HeapObject {
    const obj: HeapObject = {
      kind: 'object',
      addr: this.take(),
      className,
      fields: fields.map((f): Var => ({ name: f.name, type: f.type, value: defaultValue(f.type) })),
    };
    this.objects.set(obj.addr, obj);
    return obj;
  }

  allocArray(elemType: string, elements: Value[]): HeapObject {
    const obj: HeapObject = { kind: 'array', addr: this.take(), elemType, elements };
    this.objects.set(obj.addr, obj);
    return obj;
  }

  allocString(value: string): HeapObject {
    const obj: HeapObject = { kind: 'string', addr: this.take(), value, interned: false };
    this.objects.set(obj.addr, obj);
    return obj;
  }

  /** Returns the pooled String for a literal, creating it on first use. */
  intern(value: string): { obj: HeapObject; created: boolean } {
    const existing = this.pool.get(value);
    if (existing !== undefined) return { obj: this.get(existing), created: false };
    const obj: HeapObject = { kind: 'string', addr: this.take(), value, interned: true };
    this.objects.set(obj.addr, obj);
    this.pool.set(value, obj.addr);
    return { obj, created: true };
  }
}
