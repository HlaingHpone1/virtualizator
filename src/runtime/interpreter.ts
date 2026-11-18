import { typeToString, type Block, type ClassDecl, type Expr, type MethodDecl, type Program, type Stmt, type TypeRef } from '../lang/ast';
import { parse } from '../lang/parser';
import { SourceError } from '../lang/tokens';
import { markReachable } from './gc';
import { Heap } from './heap';
import {
  InputReader,
  MATH_CONSTANTS,
  MATH_METHODS,
  RunError,
  SCANNER_PATTERNS,
  SUPPORTED_UTIL_CLASSES,
  isImported,
  mathParamType,
  qualifiedExceptionName,
  seededRandom,
} from './library';
import { Frame } from './memory';
import type { HeapObject, HeapObjectSnap, PrimType, RunResult, Step, Value, Var } from './types';
import { NULL, UNINIT, describeValue, formatAddr, formatPrim, isPrimitiveType, prim, ref } from './values';

export const MAX_STEPS = 2000;
const MAX_DEPTH = 64;

/** Runs a Java program (with `input` as System.in) and returns one memory snapshot per step. */
export function run(source: string, input = ''): RunResult {
  let program: Program;
  try {
    program = parse(source);
  } catch (e) {
    if (e instanceof SourceError) return { steps: [], parseError: { message: e.message, line: e.line } };
    throw e;
  }
  return { steps: new Interpreter(program, input).run() };
}

type Signal =
  | { type: 'normal' }
  | { type: 'break' }
  | { type: 'continue' }
  | { type: 'return'; value: Value | null };

const NORMAL: Signal = { type: 'normal' };

/** A storage location that can be read and written: a local, a field, a static or an array element. */
interface Slot {
  get(): Value;
  set(v: Value): void;
  type: string;
  label: string;
  where: 'stack' | 'heap' | 'static';
  readonly?: boolean;
}

const NUMERIC_RANK: Record<string, number> = { byte: 1, short: 2, char: 2, int: 3, long: 4, float: 5, double: 6 };

class Interpreter {
  private heap = new Heap();
  private frames: Frame[] = [];
  private statics = new Map<string, Var[]>();
  private classes = new Map<string, ClassDecl>();
  /** Values produced mid-statement (new objects, return values) that must survive GC until the statement ends. */
  private temps: Value[] = [];
  private output = '';
  private notes: string[] = [];
  private steps: Step[] = [];
  private garbage = new Set<number>();
  private frameCounter = 0;
  private input: InputReader;
  private random = seededRandom(42);
  private closedScanners = new Set<number>();

  constructor(private program: Program, input: string) {
    this.input = new InputReader(input);
  }

  run(): Step[] {
    let line = 1;
    try {
      for (const cls of this.program.classes) {
        if (this.classes.has(cls.name)) throw new RunError(`duplicate class: ${cls.name}`, cls.line);
        this.classes.set(cls.name, cls);
      }
      const mainClass = this.program.classes.find((c) =>
        c.methods.some((m) => m.name === 'main' && m.isStatic && m.params.length === 1),
      );
      const main = mainClass?.methods.find((m) => m.name === 'main' && m.isStatic);
      if (!mainClass || !main) throw new RunError('No "public static void main(String[] args)" method found', 1);
      line = main.line;

      this.initStatics();

      const args = this.heap.allocArray('String', []);
      this.temps.push(ref(args.addr));
      this.callMethod(mainClass, main, null, [ref(args.addr)], main.line, 'start');
      this.temps = [];
      this.snapshot(main.endLine, 'Program finished. main returned, so the stack is empty.');
    } catch (e) {
      const err = e instanceof RunError ? e : new RunError(e instanceof Error ? e.message : String(e), line);
      if (err.javaName) {
        const msg = err.message ? `: ${err.message}` : '';
        this.output += `Exception in thread "main" ${qualifiedExceptionName(err.javaName)}${msg}\n`;
      }
      const text = err.javaName ? `${err.javaName}${err.message ? ': ' + err.message : ''}` : err.message;
      this.snapshot(err.line, err.javaName ? `Uncaught ${text}` : `Error: ${text}`, text);
    }
    return this.steps;
  }

  // ---------------------------------------------------------------- snapshots

  private snapshot(line: number, headline?: string, error?: string) {
    if (!error && this.steps.length >= MAX_STEPS) {
      throw new RunError(`Stopped after ${MAX_STEPS} steps. Is there an infinite loop?`, line);
    }
    const top = this.frames[this.frames.length - 1];
    if (top) top.line = line;

    const roots: Value[] = [
      ...this.temps,
      ...this.frames.flatMap((f) => f.allLocals().map((v) => v.value)),
      ...[...this.statics.values()].flat().map((v) => v.value),
    ];
    const reachable = markReachable(this.heap, roots);
    // Notes recorded while evaluating happened before the headline action; GC notes come after it.
    const before = [...new Set(this.notes)];
    this.notes = [];
    const collected: number[] = [];
    const newlyGarbage: string[] = [];
    for (const [addr, obj] of [...this.heap.objects]) {
      if (reachable.has(addr)) {
        this.garbage.delete(addr);
      } else if (this.garbage.has(addr)) {
        this.heap.objects.delete(addr);
        this.garbage.delete(addr);
        collected.push(addr);
      } else {
        this.garbage.add(addr);
        newlyGarbage.push(this.describeObj(obj));
      }
    }
    if (newlyGarbage.length) {
      this.notes.push(
        `${capitalize(listJoin(newlyGarbage))} ${newlyGarbage.length > 1 ? 'are' : 'is'} no longer reachable from any variable, so ${newlyGarbage.length > 1 ? 'they are' : 'it is'} now garbage.`,
      );
    }
    if (collected.length) {
      this.notes.push(`The garbage collector reclaimed ${collected.map(formatAddr).join(', ')}.`);
    }

    const heap: HeapObjectSnap[] = [...this.heap.objects.values()]
      .sort((a, b) => a.addr - b.addr)
      .map((o) => ({ ...cloneObj(o), garbage: this.garbage.has(o.addr) }));

    this.steps.push({
      line,
      frames: this.frames.map((f) => f.snapshot()),
      heap,
      statics: [...this.statics]
        .filter(([, fields]) => fields.length > 0)
        .map(([className, fields]) => ({ className, fields: fields.map((f) => ({ ...f, value: { ...f.value } })) })),
      output: this.output,
      input: { text: this.input.text, pos: this.input.pos },
      event: [...before, headline, ...this.notes].filter(Boolean).join(' ') || `Executed line ${line}.`,
      collected,
      error,
    });
    this.notes = [];
  }

  private describeObj(obj: HeapObject): string {
    const a = formatAddr(obj.addr);
    if (obj.kind === 'object') return `the ${obj.className} object ${a}`;
    if (obj.kind === 'array') return `the ${obj.elemType}[${obj.elements.length}] array ${a}`;
    return `the String "${obj.value}" ${a}`;
  }

  private describeRef(v: Value): string {
    if (v.kind === 'ref' && v.addr !== null) return this.describeObj(this.heap.get(v.addr));
    return describeValue(v);
  }

  // ---------------------------------------------------------------- classes & statics

  private initStatics() {
    for (const cls of this.program.classes) {
      this.statics.set(
        cls.name,
        cls.fields.filter((f) => f.isStatic).map((f) => ({ name: f.name, type: typeToString(f.type), value: defaultFor(f.type) })),
      );
    }
    for (const cls of this.program.classes) {
      const inits = cls.fields.filter((f) => f.isStatic && f.init);
      if (inits.length === 0) continue;
      const frame = new Frame(++this.frameCounter, cls.name, '<clinit>', cls.line, null);
      this.frames.push(frame);
      const vars = this.statics.get(cls.name)!;
      for (const f of inits) {
        const v = vars.find((x) => x.name === f.name)!;
        v.value = this.coerce(this.eval(f.init!), v.type, f.line);
      }
      this.snapshot(
        cls.line,
        `Class ${cls.name} is loaded. Its static fields (${inits.map((f) => f.name).join(', ')}) live in the class's static area, not in any object, and are shared by everyone.`,
      );
      this.frames.pop();
      this.temps = [];
    }
  }

  private get frame(): Frame {
    return this.frames[this.frames.length - 1];
  }

  private get currentClass(): ClassDecl {
    return this.classes.get(this.frame.className)!;
  }

  private findMethod(list: MethodDecl[], name: string, args: Value[]): MethodDecl | undefined {
    const candidates = list.filter((m) => m.name === name && m.params.length === args.length);
    const score = (m: MethodDecl) => {
      let s = 0;
      for (let i = 0; i < args.length; i++) {
        const t = typeToString(m.params[i].type);
        const a = args[i];
        if (isPrimitiveType(t) !== (a.kind === 'prim')) return -1;
        if (a.kind === 'prim' && a.type === t) s += 2;
        else if (a.kind === 'ref' && a.addr !== null && this.runtimeType(a) === t) s += 2;
        else s += 1;
      }
      return s;
    };
    return candidates
      .map((m) => ({ m, s: score(m) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)[0]?.m;
  }

  private runtimeType(v: Value): string {
    if (v.kind === 'prim') return v.type;
    if (v.kind === 'uninit') return '?';
    if (v.addr === null) return 'null';
    const obj = this.heap.get(v.addr);
    if (obj.kind === 'object') return obj.className;
    if (obj.kind === 'array') return obj.elemType + '[]';
    return 'String';
  }

  // ---------------------------------------------------------------- method calls

  private callMethod(
    cls: ClassDecl,
    m: MethodDecl,
    thisAddr: number | null,
    args: Value[],
    callLine: number,
    mode: 'start' | 'call' | 'ctor' = 'call',
  ): Value | null {
    if (this.frames.length >= MAX_DEPTH) {
      throw new RunError(`the stack ran out of room after ${MAX_DEPTH} nested calls (infinite recursion?)`, callLine, 'StackOverflowError');
    }
    const isCtor = mode === 'ctor';
    const frame = new Frame(++this.frameCounter, cls.name, isCtor ? '<init>' : m.name, m.line, thisAddr);
    if (thisAddr !== null) frame.declare('this', cls.name, ref(thisAddr));
    const paramDescs: string[] = [];
    m.params.forEach((p, i) => {
      const type = typeToString(p.type);
      const v = this.coerce(args[i], type, callLine);
      frame.declare(p.name, type, v);
      paramDescs.push(`${p.name} = ${describeValue(v)}`);
    });
    this.frames.push(frame);

    const label = isCtor ? `the ${cls.name} constructor` : `${cls.name}.${m.name}()`;
    let headline: string;
    if (mode === 'start') {
      headline = 'Program starts. The JVM pushes a stack frame for main. args references an empty String[] array on the heap.';
    } else {
      headline = `Calling ${label}: a new stack frame is pushed on top of the stack.`;
      if (thisAddr !== null) headline += ` this = ${formatAddr(thisAddr)} (the object the method runs on).`;
      if (paramDescs.length) {
        const hasRef = args.some((a) => a.kind === 'ref' && a.addr !== null);
        headline += ` The arguments are copied into the parameters (Java is pass-by-value): ${paramDescs.join(', ')}.`;
        if (hasRef) headline += ' For a reference, the address is what gets copied, so caller and callee point to the same object.';
      }
    }

    if (isCtor) {
      const obj = this.heap.get(thisAddr!);
      for (const f of cls.fields) {
        if (f.isStatic || !f.init || obj.kind !== 'object') continue;
        const field = obj.fields.find((x) => x.name === f.name)!;
        field.value = this.coerce(this.eval(f.init), field.type, f.line);
        this.notes.push(`Field initializer sets this.${f.name} = ${describeValue(field.value)}.`);
      }
    }
    this.snapshot(m.line, headline);

    const sig = this.execBlock(m.body, true);
    let result: Value | null = null;
    if (sig.type === 'return') {
      result = sig.value;
    } else {
      if (!isCtor && m.returnType && m.returnType.name !== 'void') {
        throw new RunError(`missing return statement in ${m.name}`, m.endLine);
      }
      this.snapshot(m.endLine, `${capitalize(label)} finished. Its stack frame is popped, and its local variables disappear.`);
    }
    this.frames.pop();
    if (result && m.returnType) {
      result = this.coerce(result, typeToString(m.returnType), callLine);
      this.temps.push(result);
    }
    return result;
  }

  // ---------------------------------------------------------------- statements

  private execBlock(block: Block, isMethodBody = false): Signal {
    this.frame.pushScope();
    for (const s of block.body) {
      const sig = this.exec(s);
      if (sig.type !== 'normal') {
        this.frame.popScope();
        return sig;
      }
    }
    const gone = this.frame.popScope();
    if (!isMethodBody && gone.length) this.notes.push(`Block ended, so ${listJoin(gone)} went out of scope and left the frame.`);
    return NORMAL;
  }

  private exec(s: Stmt): Signal {
    this.frame.line = s.line;
    const mark = this.temps.length;
    switch (s.kind) {
      case 'block':
        return this.execBlock(s);

      case 'varDecl': {
        const type = typeToString(s.type);
        const descs: string[] = [];
        for (const d of s.declarators) {
          if (this.frame.lookup(d.name)) throw new RunError(`variable ${d.name} is already defined`, s.line);
          const v = d.init ? this.coerce(this.eval(d.init, type), type, s.line) : UNINIT;
          this.frame.declare(d.name, type, v);
          descs.push(this.describeStore(d.name, type, v, 'stack', true));
        }
        this.temps.length = mark;
        this.snapshot(s.line, descs.join(' '));
        return NORMAL;
      }

      case 'expr':
        this.eval(s.expr);
        this.temps.length = mark;
        this.snapshot(s.line);
        return NORMAL;

      case 'if': {
        const cond = this.evalCond(s.cond);
        this.temps.length = mark;
        this.snapshot(s.line, `Condition (${exprText(s.cond)}) is ${cond}, so ${cond ? 'the if branch runs' : s.else ? 'the else branch runs' : 'the if body is skipped'}.`);
        if (cond) return this.exec(s.then);
        if (s.else) return this.exec(s.else);
        return NORMAL;
      }

      case 'while':
        for (;;) {
          this.frame.line = s.line;
          const cond = this.evalCond(s.cond);
          this.temps.length = mark;
          this.snapshot(s.line, `Loop condition (${exprText(s.cond)}) is ${cond}${cond ? ', so the loop body runs.' : ', so the loop ends.'}`);
          if (!cond) return NORMAL;
          const sig = this.exec(s.body);
          if (sig.type === 'break') return NORMAL;
          if (sig.type === 'return') return sig;
        }

      case 'for': {
        this.frame.pushScope();
        try {
          if (s.init) this.exec(s.init);
          for (;;) {
            this.frame.line = s.line;
            if (s.cond) {
              const cond = this.evalCond(s.cond);
              this.temps.length = mark;
              this.snapshot(s.line, `Loop condition (${exprText(s.cond)}) is ${cond}${cond ? ', so the loop body runs.' : ', so the loop ends.'}`);
              if (!cond) break;
            }
            const sig = this.exec(s.body);
            if (sig.type === 'break') break;
            if (sig.type === 'return') return sig;
            this.frame.line = s.line;
            for (const u of s.update) this.eval(u);
            this.temps.length = mark;
          }
        } finally {
          const gone = this.frame.popScope();
          if (gone.length) this.notes.push(`Loop finished, so the loop variable ${listJoin(gone)} went out of scope.`);
        }
        return NORMAL;
      }

      case 'return': {
        const m = this.frame;
        const value = s.value ? this.eval(s.value) : null;
        if (value) this.temps.push(value);
        const who = m.method === '<init>' ? `the ${m.className} constructor` : `${m.className}.${m.method}()`;
        this.snapshot(
          s.line,
          value
            ? `return ${describeValue(value)}: ${who} hands ${describeValue(value)} back to its caller. Its frame will now be popped.`
            : `return: ${who} ends. Its frame will now be popped.`,
        );
        return { type: 'return', value };
      }

      case 'break':
        this.snapshot(s.line, 'break: leave the loop immediately.');
        return { type: 'break' };

      case 'continue':
        this.snapshot(s.line, 'continue: skip to the next iteration.');
        return { type: 'continue' };
    }
  }

  private evalCond(e: Expr): boolean {
    const v = this.eval(e);
    if (v.kind !== 'prim' || v.type !== 'boolean') {
      throw new RunError(`incompatible types: ${this.runtimeType(v)} cannot be converted to boolean`, e.line);
    }
    return v.value as boolean;
  }

  /** Explains what storing `v` into a variable means for memory. */
  private describeStore(label: string, type: string, v: Value, where: Slot['where'], isDecl = false): string {
    const place =
      where === 'stack'
        ? `${this.frameName()}'s stack frame`
        : where === 'static'
          ? 'the static area of the class (shared by everyone)'
          : 'the object on the heap';
    const decl = isDecl ? `${type} ${label}` : label;
    if (v.kind === 'uninit') return `Declared ${decl} in ${place}. It has no value yet.`;
    if (v.kind === 'prim') {
      return `${decl} = ${describeValue(v)}. A primitive ${type}, so the value itself is stored in ${place}.`;
    }
    if (v.addr === null) return `${decl} = null. It is a reference that currently points to no object.`;
    let text = `${decl} = ${formatAddr(v.addr)}. A reference: ${place} stores only the address of ${this.describeRef(v)}, which lives on the heap.`;
    const aliases = this.aliasesOf(v.addr).filter((n) => n !== label);
    if (aliases.length) text += ` ${listJoin([...aliases, label])} now ${aliases.length === 1 ? 'both' : 'all'} point to the same object (aliasing).`;
    return text;
  }

  private frameName(): string {
    const f = this.frame;
    return f.method === '<init>' ? `the ${f.className} constructor` : f.method;
  }

  /** Names of the variables in the current frame that hold `addr`. */
  private aliasesOf(addr: number): string[] {
    return this.frame
      .allLocals()
      .filter((v) => v.name !== 'this' && v.value.kind === 'ref' && v.value.addr === addr)
      .map((v) => v.name);
  }

  // ---------------------------------------------------------------- lvalues

  private varSlot(v: Var, where: Slot['where'], label: string): Slot {
    return { get: () => v.value, set: (x) => (v.value = x), type: v.type, label, where };
  }

  private resolveName(name: string, line: number): Slot | null {
    const local = this.frame.lookup(name);
    if (local) return this.varSlot(local, 'stack', name);
    const thisAddr = this.frame.thisAddr;
    if (thisAddr !== null) {
      const obj = this.heap.get(thisAddr);
      const field = obj.kind === 'object' ? obj.fields.find((f) => f.name === name) : undefined;
      if (field) return this.varSlot(field, 'heap', `this.${name}`);
    }
    const st = this.statics.get(this.frame.className)?.find((f) => f.name === name);
    if (st) return this.varSlot(st, 'static', `${this.frame.className}.${name}`);
    if (thisAddr === null && this.currentClass.fields.some((f) => f.name === name && !f.isStatic)) {
      throw new RunError(`non-static variable ${name} cannot be referenced from a static context`, line);
    }
    return null;
  }

  /** True when `e` is a bare name that refers to a class rather than a variable. */
  private asClassName(e: Expr): string | null {
    if (e.kind !== 'name') return null;
    if (this.frame.lookup(e.name) || this.resolveNameQuiet(e.name)) return null;
    return e.name;
  }

  private resolveNameQuiet(name: string): Slot | null {
    try {
      return this.resolveName(name, 0);
    } catch {
      return null;
    }
  }

  private lvalue(e: Expr): Slot {
    switch (e.kind) {
      case 'name': {
        const slot = this.resolveName(e.name, e.line);
        if (!slot) throw new RunError(`cannot find symbol: variable ${e.name}`, e.line);
        return slot;
      }
      case 'field': {
        const className = this.asClassName(e.target);
        if (className) {
          if (className === 'System' && e.name === 'in' && !this.classes.has('System')) {
            return { ...this.varSlot(this.systemIn(), 'static', 'System.in'), readonly: true };
          }
          const builtin = BUILTIN_STATICS[`${className}.${e.name}`];
          if (builtin) return { get: () => builtin, set: () => {}, type: builtin.kind === 'prim' ? builtin.type : '?', label: `${className}.${e.name}`, where: 'static', readonly: true };
          const st = this.statics.get(className)?.find((f) => f.name === e.name);
          if (st) return this.varSlot(st, 'static', `${className}.${e.name}`);
          if (this.classes.has(className)) throw new RunError(`cannot find symbol: static field ${className}.${e.name}`, e.line);
          throw new RunError(`cannot find symbol: ${className}`, e.line);
        }
        const target = this.eval(e.target);
        const obj = this.deref(target, e.line, () => `Cannot read field "${e.name}" because "${exprText(e.target)}" is null`);
        const label = `${exprText(e.target)}.${e.name}`;
        if (obj.kind === 'array') {
          if (e.name !== 'length') throw new RunError(`cannot find symbol: ${e.name} on an array`, e.line);
          const len = prim('int', obj.elements.length);
          return { get: () => len, set: () => {}, type: 'int', label, where: 'heap', readonly: true };
        }
        if (obj.kind === 'string') throw new RunError(`String has no field ${e.name} (did you mean ${e.name}()?)`, e.line);
        const field = obj.fields.find((f) => f.name === e.name);
        if (!field) throw new RunError(`cannot find symbol: field ${e.name} in ${obj.className}`, e.line);
        return this.varSlot(field, 'heap', label);
      }
      case 'index': {
        const arr = this.eval(e.target);
        const idxV = this.eval(e.index);
        const obj = this.deref(arr, e.line, () => `Cannot load from array because "${exprText(e.target)}" is null`);
        if (obj.kind !== 'array') throw new RunError(`array required, but ${this.runtimeType(arr)} found`, e.line);
        if (idxV.kind !== 'prim' || idxV.type === 'boolean' || idxV.type === 'double' || idxV.type === 'float') {
          throw new RunError('array index must be an int', e.line);
        }
        const i = idxV.value as number;
        if (i < 0 || i >= obj.elements.length) {
          throw new RunError(`Index ${i} out of bounds for length ${obj.elements.length}`, e.line, 'ArrayIndexOutOfBoundsException');
        }
        return {
          get: () => obj.elements[i],
          set: (x) => (obj.elements[i] = x),
          type: obj.elemType,
          label: `${exprText(e.target)}[${i}]`,
          where: 'heap',
        };
      }
      default:
        throw new RunError('cannot assign to this expression', e.line);
    }
  }

  private deref(v: Value, line: number, npeMessage: () => string): HeapObject {
    if (v.kind !== 'ref') throw new RunError(`${this.runtimeType(v)} is a primitive, not an object`, line);
    if (v.addr === null) throw new RunError(npeMessage(), line, 'NullPointerException');
    return this.heap.get(v.addr);
  }

  // ---------------------------------------------------------------- expressions

  /** `expectedType` lets array literals `{1, 2}` know their element type. */
  private eval(e: Expr, expectedType?: string): Value {
    switch (e.kind) {
      case 'literal':
        switch (e.type) {
          case 'null':
            return NULL;
          case 'boolean':
            return prim('boolean', e.value as boolean);
          case 'char':
            return prim('char', (e.value as string).charCodeAt(0));
          default:
            return prim(e.type, e.value as number);
        }

      case 'string': {
        const { obj, created } = this.heap.intern(e.value);
        this.notes.push(
          created
            ? `The literal "${e.value}" is stored once in the String pool at ${formatAddr(obj.addr)}.`
            : `The literal "${e.value}" reuses the existing String pool object ${formatAddr(obj.addr)}.`,
        );
        return ref(obj.addr);
      }

      case 'name': {
        const v = this.lvalue(e).get();
        if (v.kind === 'uninit') throw new RunError(`variable ${e.name} might not have been initialized`, e.line);
        return v;
      }

      case 'this':
        if (this.frame.thisAddr === null) throw new RunError('non-static variable this cannot be referenced from a static context', e.line);
        return ref(this.frame.thisAddr);

      case 'field':
      case 'index':
        return this.lvalue(e).get();

      case 'call':
        return this.evalCall(e);

      case 'new':
        return this.evalNew(e);

      case 'newArray': {
        const sizes = e.sizes.map((s) => {
          const v = this.eval(s);
          if (v.kind !== 'prim' || !['int', 'short', 'byte', 'char'].includes(v.type)) throw new RunError('array size must be an int', e.line);
          if ((v.value as number) < 0) throw new RunError(String(v.value), e.line, 'NegativeArraySizeException');
          return v.value as number;
        });
        const v = this.makeArray(e.elemType.name, e.elemType.dims + 1, sizes, 0);
        const top = this.heap.get((v as { addr: number }).addr) as Extract<HeapObject, { kind: 'array' }>;
        const def = top.elements.length ? ` Each element starts as ${describeValue(top.elements[0])}.` : '';
        this.notes.push(`new ${top.elemType}[${sizes[0]}] allocates an array object ${formatAddr(top.addr)} on the heap.${def}`);
        return v;
      }

      case 'arrayLit': {
        let elemType: string;
        if (e.elemType) elemType = typeToString(e.elemType);
        else if (expectedType?.endsWith('[]')) elemType = expectedType.slice(0, -2);
        else throw new RunError('illegal initializer: {...} needs an array type', e.line);
        const elements = e.elements.map((x) => this.coerce(this.eval(x, elemType), elemType, e.line));
        const arr = this.heap.allocArray(elemType, elements);
        const v = ref(arr.addr);
        this.temps.push(v);
        this.notes.push(`The array initializer creates a ${elemType}[${elements.length}] array object ${formatAddr(arr.addr)} on the heap.`);
        return v;
      }

      case 'unary': {
        const v = this.eval(e.operand);
        if (e.op === '!') {
          if (v.kind !== 'prim' || v.type !== 'boolean') throw new RunError("bad operand type for '!'", e.line);
          return prim('boolean', !v.value);
        }
        const n = this.num(v, e.op, e.line);
        const t = promote1(v as PrimValue);
        return makeNum(t, e.op === '-' ? -n : n);
      }

      case 'update': {
        const slot = this.lvalue(e.target);
        if (slot.readonly) throw new RunError(`cannot assign a value to ${slot.label}`, e.line);
        const old = slot.get();
        if (old.kind === 'uninit') throw new RunError(`variable ${slot.label} might not have been initialized`, e.line);
        const n = this.num(old, e.op, e.line);
        const next = this.castPrim(prim((old as PrimValue).type, e.op === '++' ? n + 1 : n - 1), slot.type, e.line);
        slot.set(next);
        this.notes.push(`${slot.label}${e.op}: ${slot.label} is now ${describeValue(next)}.`);
        return e.prefix ? next : old;
      }

      case 'binary':
        return this.evalBinary(e);

      case 'assign': {
        const slot = this.lvalue(e.target);
        if (slot.readonly) throw new RunError(`cannot assign a value to ${slot.label}`, e.line);
        let v: Value;
        if (e.op === '=') {
          v = this.coerce(this.eval(e.value, slot.type), slot.type, e.line);
        } else {
          const old = slot.get();
          if (old.kind === 'uninit') throw new RunError(`variable ${slot.label} might not have been initialized`, e.line);
          const rhs = this.eval(e.value);
          const combined = this.binaryOp(e.op.slice(0, -1), old, rhs, e.line);
          v = combined.kind === 'prim' && isPrimitiveType(slot.type) ? this.castPrim(combined, slot.type, e.line) : this.coerce(combined, slot.type, e.line);
        }
        slot.set(v);
        this.notes.push(this.describeStore(slot.label, slot.type, v, slot.where));
        return v;
      }

      case 'ternary':
        return this.evalCond(e.cond) ? this.eval(e.then, expectedType) : this.eval(e.else, expectedType);

      case 'cast': {
        const t = typeToString(e.type);
        const v = this.eval(e.expr);
        if (v.kind !== 'prim') throw new RunError(`incompatible types: ${this.runtimeType(v)} cannot be converted to ${t}`, e.line);
        return this.castPrim(v, t, e.line);
      }
    }
  }

  private makeArray(base: string, dims: number, sizes: number[], level: number): Value {
    const elemType = base + '[]'.repeat(dims - 1);
    const len = sizes[level];
    const elements: Value[] = [];
    for (let i = 0; i < len; i++) {
      elements.push(level + 1 < sizes.length ? this.makeArray(base, dims - 1, sizes, level + 1) : defaultFor({ name: base, dims: dims - 1 }));
    }
    const arr = this.heap.allocArray(elemType, elements);
    const v = ref(arr.addr);
    if (level === 0) this.temps.push(v);
    return v;
  }

  private evalNew(e: Extract<Expr, { kind: 'new' }>): Value {
    if (e.className === 'String') {
      const args = this.evalArgs(e.args);
      const text = args.length === 0 ? '' : this.toJavaString(args[0], e.line);
      const obj = this.heap.allocString(text);
      const v = ref(obj.addr);
      this.temps.push(v);
      this.notes.push(`new String("${text}") always creates a new object ${formatAddr(obj.addr)} on the heap, separate from the String pool.`);
      return v;
    }
    if (e.className === 'Scanner' && !this.classes.has('Scanner')) return this.newScanner(e);
    const cls = this.classes.get(e.className);
    if (!cls) throw new RunError(this.unknownClassMessage(e.className), e.line);
    const instanceFields = cls.fields.filter((f) => !f.isStatic).map((f) => ({ name: f.name, type: typeToString(f.type) }));
    const obj = this.heap.allocObject(cls.name, instanceFields);
    const v = ref(obj.addr);
    this.temps.push(v);
    const defaults = obj.kind === 'object' && obj.fields.length
      ? ` Its fields start with default values (${obj.fields.map((f) => `${f.name} = ${describeValue(f.value)}`).join(', ')}).`
      : '';
    this.notes.push(`new ${cls.name}(...) allocates an object ${formatAddr(obj.addr)} on the heap.${defaults}`);

    const args = this.evalArgs(e.args);
    let ctor = this.findMethod(cls.constructors, cls.name, args);
    if (!ctor) {
      if (cls.constructors.length > 0 || args.length > 0) {
        throw new RunError(`no constructor ${cls.name} matches ${args.length} argument(s)`, e.line);
      }
      // Implicit default constructor: only needs a frame if there are field initializers to run.
      if (!cls.fields.some((f) => !f.isStatic && f.init)) return v;
      ctor = { name: cls.name, returnType: null, params: [], isStatic: false, body: { kind: 'block', body: [], line: cls.line, endLine: cls.line }, line: cls.line, endLine: cls.line };
    }
    this.frame.line = e.line;
    this.callMethod(cls, ctor, obj.addr, args, e.line, 'ctor');
    return v;
  }

  private evalArgs(args: Expr[]): Value[] {
    return args.map((a) => {
      const v = this.eval(a);
      this.temps.push(v);
      return v;
    });
  }

  // ---------------------------------------------------------------- Java library: System.in, Scanner, Math

  private unknownClassMessage(name: string): string {
    const imported = this.program.imports.find((i) => i.endsWith(`.${name}`));
    if (imported && !SUPPORTED_UTIL_CLASSES.has(name)) return `${imported} is not supported by this visualizer yet`;
    return `cannot find symbol: class ${name}`;
  }

  private requireImport(className: string, line: number) {
    if (!isImported(this.program.imports, 'java.util', className)) {
      throw new RunError(`cannot find symbol: class ${className} (add "import java.util.${className};" at the top of the file)`, line);
    }
  }

  /** System.in is created on first use and held by a static field of class System. */
  private systemIn(): Var {
    let fields = this.statics.get('System');
    if (!fields) {
      const obj = this.heap.allocObject('InputStream', []);
      fields = [{ name: 'in', type: 'InputStream', value: ref(obj.addr) }];
      this.statics.set('System', fields);
      this.notes.push(
        `System.in is a static field of class System. It references an InputStream object ${formatAddr(obj.addr)} that delivers the program input.`,
      );
    }
    return fields[0];
  }

  private newScanner(e: Extract<Expr, { kind: 'new' }>): Value {
    this.requireImport('Scanner', e.line);
    const args = this.evalArgs(e.args);
    const inAddr = (this.systemIn().value as { addr: number }).addr;
    const src = args[0];
    if (args.length !== 1 || src.kind !== 'ref' || src.addr !== inAddr) {
      throw new RunError('this visualizer supports only new Scanner(System.in)', e.line);
    }
    const obj = this.heap.allocObject('Scanner', [
      { name: 'source', type: 'InputStream' },
      { name: 'position', type: 'int' },
    ]) as ObjectObj;
    const v = ref(obj.addr);
    this.temps.push(v);
    this.notes.push(
      `new Scanner(System.in) allocates a Scanner object ${formatAddr(obj.addr)} on the heap. Its fields start with default values (source = null, position = 0).`,
    );
    this.frame.line = e.line;
    this.callNative('Scanner', '<init>', obj.addr, [{ name: 'source', type: 'InputStream', value: src }], e.line, () => {
      setField(obj, 'source', src);
      setField(obj, 'position', prim('int', this.input.pos));
      this.notes.push('The constructor stores the System.in reference in the Scanner\'s source field, so both point to the same InputStream.');
      return null;
    });
    return v;
  }

  private scannerMethod(obj: ObjectObj, name: string, args: Value[], line: number, target: string): Value {
    if (args.length) throw new RunError(`Scanner.${name}() with arguments is not supported`, line);
    if (this.closedScanners.has(obj.addr) && name !== 'close') throw new RunError('Scanner closed', line, 'IllegalStateException');
    const r = this.input;
    const call = `${target}.${name}()`;

    const result = this.callNative('Scanner', name, obj.addr, [], line, () => {
      let v: Value | null = null;
      const lineBreakNote = () =>
        /^\r?\n/.test(r.text.slice(r.pos))
          ? ' The line break after it is still waiting in the input, so a nextLine() right now would return "".'
          : '';
      switch (name) {
        case 'nextInt':
        case 'nextLong':
        case 'nextDouble':
        case 'nextBoolean': {
          const type = name.slice(4).toLowerCase() as 'int' | 'long' | 'double' | 'boolean';
          const pattern = type === 'long' ? SCANNER_PATTERNS.int : SCANNER_PATTERNS[type];
          const { token, echo } = r.nextToken(line, pattern);
          this.output += echo;
          v = type === 'boolean' ? prim('boolean', token.toLowerCase() === 'true') : makeNum(type, Number(token));
          this.notes.push(`${call} read the token "${token}" from the input and turned it into the ${type} value ${describeValue(v)}.${lineBreakNote()}`);
          break;
        }
        case 'next': {
          const { token, echo } = r.nextToken(line);
          this.output += echo;
          v = this.newString(token);
          this.notes.push(`${call} read the word "${token}" and created a new String object ${describeValue(v)} on the heap.`);
          break;
        }
        case 'nextLine': {
          const { text, echo } = r.nextLine(line);
          this.output += echo;
          v = this.newString(text);
          this.notes.push(
            text === ''
              ? `${call} returned an empty String "": it only consumed the leftover line break from the previous read. This is the classic Scanner pitfall; call an extra nextLine() after nextInt() to skip it.`
              : `${call} read the rest of the line "${text}" and created a new String object ${describeValue(v)} on the heap.`,
          );
          break;
        }
        case 'hasNext':
        case 'hasNextInt':
        case 'hasNextDouble':
        case 'hasNextLine': {
          const answer = name === 'hasNext' ? r.hasNext() : name === 'hasNextInt' ? r.hasNextInt() : name === 'hasNextDouble' ? r.hasNextDouble() : r.hasNextLine();
          v = prim('boolean', answer);
          this.notes.push(`${call} only peeks at the input without consuming anything: ${answer}.`);
          break;
        }
        case 'close':
          this.closedScanners.add(obj.addr);
          this.notes.push(`${call} closes the Scanner (and System.in). Reading from it again would throw IllegalStateException.`);
          break;
        default:
          throw new RunError(`Scanner.${name}() is not supported`, line);
      }
      setField(obj, 'position', prim('int', r.pos));
      return v;
    });
    return result ?? UNINIT;
  }

  private callMath(name: string, args: Value[], line: number): Value {
    const m = MATH_METHODS[name];
    if (!m || m.params.length !== args.length) throw new RunError(`Math.${name}() with ${args.length} argument(s) is not supported`, line);
    for (const a of args) {
      if (a.kind !== 'prim' || a.type === 'boolean') throw new RunError(`Math.${name}() expects numbers, but got ${this.runtimeType(a)}`, line);
    }
    const pt = mathParamType(m, args);
    const params: Var[] = m.params.map((n, i) => ({ name: n, type: pt, value: this.castPrim(args[i], pt, line) }));
    return this.callNative('Math', name, null, params, line, () => {
      if (name === 'random') return prim('double', this.random());
      const xs = params.map((p) => (p.value as PrimValue).value as number);
      if ((name === 'floorDiv' || name === 'floorMod') && xs[1] === 0) throw new RunError('/ by zero', line, 'ArithmeticException');
      return makeNum(m.returns === 'same' ? pt : m.returns, m.fn(...xs));
    })!;
  }

  /**
   * Runs a built-in library method with its own (native) stack frame, so the
   * call is visible the same way as a call to user code.
   */
  private callNative(
    className: string,
    method: string,
    thisAddr: number | null,
    params: Var[],
    line: number,
    impl: () => Value | null,
  ): Value | null {
    if (this.frames.length >= MAX_DEPTH) {
      throw new RunError(`the stack ran out of room after ${MAX_DEPTH} nested calls (infinite recursion?)`, line, 'StackOverflowError');
    }
    const frame = new Frame(++this.frameCounter, className, method, line, thisAddr);
    frame.native = true;
    if (thisAddr !== null) frame.declare('this', className, ref(thisAddr));
    for (const p of params) frame.declare(p.name, p.type, p.value);
    this.frames.push(frame);

    const label = method === '<init>' ? `the ${className} constructor` : `${className}.${method}()`;
    let headline = `Calling the Java library method ${label}: library methods get a stack frame too, just like your own methods.`;
    headline += thisAddr === null ? ' It is static, so no object is needed.' : ` this = ${formatAddr(thisAddr)}.`;
    if (params.length) {
      headline += ` The arguments are copied into its parameters: ${params.map((p) => `${p.name} = ${describeValue(p.value)}`).join(', ')}.`;
    }
    this.snapshot(line, headline);

    const result = impl();
    this.frames.pop();
    if (result) {
      this.temps.push(result);
      this.notes.push(`${capitalize(label)} returned ${result.kind === 'ref' ? this.describeRef(result) : describeValue(result)}, and its frame was popped.`);
    } else {
      this.notes.push(`${capitalize(label)} finished, and its frame was popped.`);
    }
    return result;
  }

  private evalCall(e: Extract<Expr, { kind: 'call' }>): Value {
    this.frame.line = e.line;
    const t = e.target;

    // System.out.println / print
    if (t && t.kind === 'field' && t.name === 'out' && t.target.kind === 'name' && t.target.name === 'System' && !this.resolveNameQuiet('System')) {
      if (e.name !== 'println' && e.name !== 'print') throw new RunError(`System.out.${e.name} is not supported`, e.line);
      const args = this.evalArgs(e.args);
      const text = args.length ? this.toJavaString(args[0], e.line) : '';
      this.output += text + (e.name === 'println' ? '\n' : '');
      this.notes.push(`Printed "${text}" to the console.`);
      return UNINIT;
    }

    // Unqualified call: a method of the current class.
    if (!t) {
      const cls = this.currentClass;
      const args = this.evalArgs(e.args);
      const m = this.findMethod(cls.methods, e.name, args);
      if (!m) throw new RunError(`cannot find symbol: method ${e.name}(${args.length} args) in ${cls.name}`, e.line);
      if (!m.isStatic && this.frame.thisAddr === null) {
        throw new RunError(`non-static method ${e.name}() cannot be referenced from a static context`, e.line);
      }
      return this.callMethod(cls, m, m.isStatic ? null : this.frame.thisAddr, args, e.line) ?? UNINIT;
    }

    // Static call: ClassName.method(...)
    const className = this.asClassName(t);
    if (className) {
      const args = this.evalArgs(e.args);
      if (className === 'Math' && !this.classes.has('Math')) return this.callMath(e.name, args, e.line);
      const builtin = BUILTIN_STATIC_METHODS[`${className}.${e.name}`];
      if (builtin) return builtin(this, args, e.line);
      const cls = this.classes.get(className);
      if (!cls) throw new RunError(this.unknownClassMessage(className), e.line);
      const m = this.findMethod(cls.methods.filter((x) => x.isStatic), e.name, args);
      if (!m) throw new RunError(`cannot find symbol: static method ${className}.${e.name}`, e.line);
      return this.callMethod(cls, m, null, args, e.line) ?? UNINIT;
    }

    // Instance call: expr.method(...)
    const target = this.eval(t);
    this.temps.push(target);
    const args = this.evalArgs(e.args);
    const obj = this.deref(target, e.line, () => `Cannot invoke "${this.runtimeTypeOfExpr(target)}.${e.name}()" because "${exprText(t)}" is null`);
    if (obj.kind === 'string') return this.stringMethod(target, obj.value, e.name, args, e.line, exprText(t));
    if (obj.kind === 'array') throw new RunError(`arrays have no method ${e.name}() (use .length for the size)`, e.line);
    if (obj.className === 'Scanner' && !this.classes.has('Scanner')) return this.scannerMethod(obj, e.name, args, e.line, exprText(t));
    const cls = this.classes.get(obj.className);
    if (!cls) throw new RunError(`cannot find symbol: method ${e.name}() in ${obj.className}`, e.line);
    const m = this.findMethod(cls.methods.filter((x) => !x.isStatic), e.name, args);
    if (m) return this.callMethod(cls, m, obj.addr, args, e.line) ?? UNINIT;
    if (e.name === 'equals' && args.length === 1) {
      const same = args[0].kind === 'ref' && args[0].addr === obj.addr;
      this.notes.push(`${cls.name} does not override equals(), so Object.equals compares addresses: ${same}.`);
      return prim('boolean', same);
    }
    if (e.name === 'hashCode' && args.length === 0) return prim('int', obj.addr);
    if (e.name === 'toString' && args.length === 0) return this.newString(`${cls.name}@${obj.addr.toString(16)}`);
    throw new RunError(`cannot find symbol: method ${e.name}() in ${cls.name}`, e.line);
  }

  private runtimeTypeOfExpr(v: Value): string {
    return v.kind === 'ref' && v.addr === null ? 'Object' : this.runtimeType(v);
  }

  newString(text: string): Value {
    const obj = this.heap.allocString(text);
    const v = ref(obj.addr);
    this.temps.push(v);
    return v;
  }

  private stringMethod(self: Value, s: string, name: string, args: Value[], line: number, targetText: string): Value {
    const str = (i: number) => {
      const a = args[i];
      if (a?.kind !== 'ref') throw new RunError(`${name}() expects a String argument`, line);
      if (a.addr === null) return null;
      const o = this.heap.get(a.addr);
      return o.kind === 'string' ? o.value : null;
    };
    const int = (i: number) => {
      const a = args[i];
      if (a?.kind !== 'prim' || typeof a.value !== 'number') throw new RunError(`${name}() expects an int argument`, line);
      return a.value;
    };
    const fresh = (text: string) => {
      const v = this.newString(text);
      this.notes.push(`Strings are immutable, so ${targetText}.${name}() returns a new String "${text}" ${describeValue(v)}.`);
      return v;
    };
    switch (`${name}/${args.length}`) {
      case 'length/0':
        return prim('int', s.length);
      case 'isEmpty/0':
        return prim('boolean', s.length === 0);
      case 'charAt/1': {
        const i = int(0);
        if (i < 0 || i >= s.length) throw new RunError(`Index ${i} out of bounds for length ${s.length}`, line, 'StringIndexOutOfBoundsException');
        return prim('char', s.charCodeAt(i));
      }
      case 'equals/1': {
        const other = str(0);
        const eq = other === s;
        this.notes.push(`${targetText}.equals(...) compares the characters, not the addresses: ${eq}.`);
        return prim('boolean', eq);
      }
      case 'equalsIgnoreCase/1':
        return prim('boolean', str(0)?.toLowerCase() === s.toLowerCase());
      case 'contains/1':
        return prim('boolean', s.includes(str(0) ?? ''));
      case 'startsWith/1':
        return prim('boolean', s.startsWith(str(0) ?? ''));
      case 'indexOf/1':
        return prim('int', s.indexOf(str(0) ?? ''));
      case 'toUpperCase/0':
        return fresh(s.toUpperCase());
      case 'toLowerCase/0':
        return fresh(s.toLowerCase());
      case 'trim/0':
        return fresh(s.trim());
      case 'concat/1':
        return fresh(s + (str(0) ?? ''));
      case 'substring/1':
      case 'substring/2': {
        const a = int(0);
        const b = args.length === 2 ? int(1) : s.length;
        if (a < 0 || b > s.length || a > b) throw new RunError(`begin ${a}, end ${b}, length ${s.length}`, line, 'StringIndexOutOfBoundsException');
        return fresh(s.substring(a, b));
      }
      case 'intern/0': {
        const { obj } = this.heap.intern(s);
        this.notes.push(`intern() returns the String pool copy ${formatAddr(obj.addr)}.`);
        return ref(obj.addr);
      }
      case 'hashCode/0': {
        let h = 0;
        for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
        return prim('int', h);
      }
      case 'toString/0':
        return self;
    }
    throw new RunError(`String.${name}() with ${args.length} argument(s) is not supported`, line);
  }

  /** Java's string conversion, used by println and `+` with a String. */
  toJavaString(v: Value, line: number): string {
    if (v.kind === 'uninit') return '';
    if (v.kind === 'prim') return formatPrim(v);
    if (v.addr === null) return 'null';
    const obj = this.heap.get(v.addr);
    if (obj.kind === 'string') return obj.value;
    if (obj.kind === 'array') {
      const code: Record<string, string> = { int: 'I', long: 'J', double: 'D', float: 'F', boolean: 'Z', char: 'C', byte: 'B', short: 'S' };
      return `[${code[obj.elemType] ?? 'L' + obj.elemType + ';'}@${obj.addr.toString(16)}`;
    }
    const cls = this.classes.get(obj.className);
    const m = cls?.methods.find((x) => x.name === 'toString' && x.params.length === 0 && !x.isStatic);
    if (!m) return `${obj.className}@${obj.addr.toString(16)}`;
    const r = this.callMethod(cls!, m, obj.addr, [], line);
    return r ? this.toJavaString(r, line) : 'null';
  }

  private isString(v: Value): boolean {
    return v.kind === 'ref' && v.addr !== null && this.heap.get(v.addr).kind === 'string';
  }

  private evalBinary(e: Extract<Expr, { kind: 'binary' }>): Value {
    if (e.op === '&&' || e.op === '||') {
      const l = this.evalCond(e.left);
      if (e.op === '&&' ? !l : l) return prim('boolean', l);
      return prim('boolean', this.evalCond(e.right));
    }
    if (e.op === '+') return this.evalPlusChain(e);
    const l = this.eval(e.left);
    this.temps.push(l);
    const r = this.eval(e.right);
    const result = this.binaryOp(e.op, l, r, e.line);
    if ((e.op === '==' || e.op === '!=') && l.kind === 'ref' && r.kind === 'ref' && l.addr !== null && r.addr !== null) {
      this.notes.push(
        `${exprText(e.left)} ${e.op} ${exprText(e.right)} compares references (addresses): ${formatAddr(l.addr)} vs ${formatAddr(r.addr)}, so the result is ${(result as PrimValue).value}.`,
      );
    }
    return result;
  }

  /**
   * Evaluates a chain like `"a" + b + c` the way javac does: left to right,
   * building a single new String once any operand is a String.
   */
  private evalPlusChain(e: Expr): Value {
    const operands: Expr[] = [];
    let cur: Expr = e;
    while (cur.kind === 'binary' && cur.op === '+') {
      operands.unshift(cur.right);
      cur = cur.left;
    }
    operands.unshift(cur);

    let acc: Value = this.eval(operands[0]);
    this.temps.push(acc);
    let text: string | null = null;
    for (const o of operands.slice(1)) {
      const v = this.eval(o);
      this.temps.push(v);
      if (text !== null) text += this.toJavaString(v, e.line);
      else if (this.isString(acc) || this.isString(v)) text = this.toJavaString(acc, e.line) + this.toJavaString(v, e.line);
      else acc = this.binaryOp('+', acc, v, e.line);
    }
    if (text === null) return acc;
    const v = this.newString(text);
    this.notes.push(`String concatenation creates a new String object "${text}" ${describeValue(v)} on the heap.`);
    return v;
  }

  binaryOp(op: string, l: Value, r: Value, line: number): Value {
    if (op === '+' && (this.isString(l) || this.isString(r))) {
      const v = this.newString(this.toJavaString(l, line) + this.toJavaString(r, line));
      return v;
    }
    if (op === '==' || op === '!=') {
      let eq: boolean;
      if (l.kind === 'ref' && r.kind === 'ref') eq = l.addr === r.addr;
      else if (l.kind === 'prim' && r.kind === 'prim') {
        if ((l.type === 'boolean') !== (r.type === 'boolean')) throw new RunError(`incomparable types: ${l.type} and ${r.type}`, line);
        eq = l.value === r.value;
      } else throw new RunError(`incomparable types: ${this.runtimeType(l)} and ${this.runtimeType(r)}`, line);
      return prim('boolean', op === '==' ? eq : !eq);
    }
    const a = this.num(l, op, line);
    const b = this.num(r, op, line);
    const t = promote2(l as PrimValue, r as PrimValue);
    switch (op) {
      case '<': return prim('boolean', a < b);
      case '>': return prim('boolean', a > b);
      case '<=': return prim('boolean', a <= b);
      case '>=': return prim('boolean', a >= b);
      case '+': return makeNum(t, a + b);
      case '-': return makeNum(t, a - b);
      case '*': return makeNum(t, t === 'int' ? Math.imul(a, b) : a * b);
      case '/':
      case '%':
        if ((t === 'int' || t === 'long') && b === 0) throw new RunError('/ by zero', line, 'ArithmeticException');
        if (op === '%') return makeNum(t, a % b);
        return makeNum(t, t === 'int' || t === 'long' ? Math.trunc(a / b) : a / b);
      case '<<': return makeNum(t, a << b);
      case '>>': return makeNum(t, a >> b);
      case '>>>': return makeNum(t, a >>> b);
    }
    throw new RunError(`unsupported operator ${op}`, line);
  }

  private num(v: Value, op: string, line: number): number {
    if (v.kind !== 'prim' || v.type === 'boolean') {
      throw new RunError(`bad operand type ${this.runtimeType(v)} for operator '${op}'`, line);
    }
    return v.value as number;
  }

  // ---------------------------------------------------------------- conversions

  /** Assignment conversion: widening is implicit, narrowing needs a cast, no autoboxing. */
  private coerce(v: Value, type: string, line: number): Value {
    if (v.kind === 'uninit') throw new RunError('this expression has no value (void method?)', line);
    if (isPrimitiveType(type)) {
      if (v.kind !== 'prim') throw new RunError(`incompatible types: ${this.runtimeType(v)} cannot be converted to ${type}`, line);
      if ((type === 'boolean') !== (v.type === 'boolean')) throw new RunError(`incompatible types: ${v.type} cannot be converted to ${type}`, line);
      if (type === 'boolean') return v;
      if (NUMERIC_RANK[v.type] > NUMERIC_RANK[type] && !(v.type === 'int' && ['byte', 'short', 'char'].includes(type))) {
        throw new RunError(`incompatible types: possible lossy conversion from ${v.type} to ${type} (use a cast like (${type}))`, line);
      }
      return this.castPrim(v, type, line);
    }
    if (v.kind === 'prim') {
      throw new RunError(`incompatible types: ${v.type} cannot be converted to ${type}${['Integer', 'Double', 'Boolean', 'Character', 'Long'].includes(type) ? ' (wrapper classes are not supported in this visualizer)' : ''}`, line);
    }
    if (v.addr !== null && type !== 'Object') {
      const actual = this.runtimeType(v);
      if (actual !== type) throw new RunError(`incompatible types: ${actual} cannot be converted to ${type}`, line);
    }
    return v;
  }

  private castPrim(v: Value, type: string, line: number): Value {
    if (v.kind !== 'prim' || !isPrimitiveType(type)) throw new RunError(`cannot cast to ${type}`, line);
    if (type === 'boolean' || v.type === 'boolean') {
      if (type !== v.type) throw new RunError(`incompatible types: ${v.type} cannot be converted to ${type}`, line);
      return v;
    }
    return makeNum(type, v.value as number);
  }
}

// ------------------------------------------------------------------ helpers

type PrimValue = Extract<Value, { kind: 'prim' }>;
type ObjectObj = Extract<HeapObject, { kind: 'object' }>;

function setField(obj: ObjectObj, name: string, v: Value) {
  obj.fields.find((f) => f.name === name)!.value = v;
}

function makeNum(type: PrimType, n: number): Value {
  switch (type) {
    case 'int': return prim('int', Number.isFinite(n) ? Math.trunc(n) | 0 : 0);
    case 'short': return prim('short', (Math.trunc(n) << 16) >> 16);
    case 'byte': return prim('byte', (Math.trunc(n) << 24) >> 24);
    case 'char': return prim('char', Math.trunc(n) & 0xffff);
    case 'long': return prim('long', Number.isFinite(n) ? Math.trunc(n) : 0);
    case 'float': return prim('float', Math.fround(n));
    default: return prim(type, n);
  }
}

function promote1(v: PrimValue): PrimType {
  return v.type === 'double' || v.type === 'float' || v.type === 'long' ? v.type : 'int';
}

function promote2(a: PrimValue, b: PrimValue): PrimType {
  if (a.type === 'double' || b.type === 'double') return 'double';
  if (a.type === 'float' || b.type === 'float') return 'float';
  if (a.type === 'long' || b.type === 'long') return 'long';
  return 'int';
}

function defaultFor(t: TypeRef): Value {
  if (t.dims > 0 || !isPrimitiveType(t.name)) return NULL;
  return prim(t.name, t.name === 'boolean' ? false : 0);
}

function cloneObj(o: HeapObject): HeapObject {
  if (o.kind === 'object') return { ...o, fields: o.fields.map((f) => ({ ...f, value: { ...f.value } })) };
  if (o.kind === 'array') return { ...o, elements: o.elements.map((v) => ({ ...v })) };
  return { ...o };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

const BUILTIN_STATICS: Record<string, Value> = {
  'Integer.MAX_VALUE': prim('int', 2147483647),
  'Integer.MIN_VALUE': prim('int', -2147483648),
  ...MATH_CONSTANTS,
};

type Builtin = (it: Interpreter, args: Value[], line: number) => Value;

const BUILTIN_STATIC_METHODS: Record<string, Builtin> = {
  'String.valueOf': (it, a, l) => it.newString(it.toJavaString(a[0], l)),
  'Integer.parseInt': (it, a, l) => {
    const n = Number(it.toJavaString(a[0], l));
    if (!Number.isInteger(n)) throw new RunError(`For input string: "${it.toJavaString(a[0], l)}"`, l, 'NumberFormatException');
    return prim('int', n | 0);
  },
};

/** Re-creates readable source text for an expression (used in explanations and error messages). */
export function exprText(e: Expr): string {
  switch (e.kind) {
    case 'literal':
      if (e.type === 'char') return `'${e.value}'`;
      if (e.type === 'null') return 'null';
      return String(e.value) + (e.type === 'long' ? 'L' : '');
    case 'string': return JSON.stringify(e.value);
    case 'name': return e.name;
    case 'this': return 'this';
    case 'field': return `${exprText(e.target)}.${e.name}`;
    case 'index': return `${exprText(e.target)}[${exprText(e.index)}]`;
    case 'call': return `${e.target ? exprText(e.target) + '.' : ''}${e.name}(${e.args.map(exprText).join(', ')})`;
    case 'new': return `new ${e.className}(${e.args.map(exprText).join(', ')})`;
    case 'newArray': return `new ${e.elemType.name}${e.sizes.map((s) => `[${exprText(s)}]`).join('')}${'[]'.repeat(e.elemType.dims + 1 - e.sizes.length)}`;
    case 'arrayLit': return `{${e.elements.map(exprText).join(', ')}}`;
    case 'unary': return `${e.op}${exprText(e.operand)}`;
    case 'update': return e.prefix ? `${e.op}${exprText(e.target)}` : `${exprText(e.target)}${e.op}`;
    case 'binary': return `${exprText(e.left)} ${e.op} ${exprText(e.right)}`;
    case 'assign': return `${exprText(e.target)} ${e.op} ${exprText(e.value)}`;
    case 'ternary': return `${exprText(e.cond)} ? ${exprText(e.then)} : ${exprText(e.else)}`;
    case 'cast': return `(${typeToString(e.type)}) ${exprText(e.expr)}`;
  }
}
