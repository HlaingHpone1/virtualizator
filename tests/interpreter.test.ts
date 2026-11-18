import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../src/examples';
import { run } from '../src/runtime/interpreter';
import type { Step, Value } from '../src/runtime/types';

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.code;

function runOk(code: string, input = ''): Step[] {
  const r = run(code, input);
  expect(r.parseError).toBeUndefined();
  const last = r.steps[r.steps.length - 1];
  expect(last.error, last.event).toBeUndefined();
  return r.steps;
}

const wrapMain = (body: string, extra = '') => `public class Main {\n public static void main(String[] args) {\n${body}\n }\n}\n${extra}`;

/** Value of a local in the top frame of a step. */
function local(step: Step, name: string): Value | undefined {
  return step.frames[step.frames.length - 1]?.locals.find((v) => v.name === name)?.value;
}

/** Last step where a local in main has this name. */
function lastWith(steps: Step[], name: string): Step {
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].frames.length && local(steps[i], name)) return steps[i];
  throw new Error(`no step with ${name}`);
}

describe('interpreter', () => {
  it('runs every example without errors', () => {
    for (const ex of EXAMPLES) {
      const r = run(ex.code, ex.input ?? '');
      const last = r.steps[r.steps.length - 1];
      expect(last?.error, `${ex.id}: ${last?.event}`).toBeUndefined();
    }
  });

  it('stores primitives in the frame and objects on the heap', () => {
    const steps = runOk(example('basics'));
    const s = lastWith(steps, 'copy');
    expect(local(s, 'age')).toEqual({ kind: 'prim', type: 'int', value: 25 });
    expect(local(s, 'copy')).toEqual({ kind: 'prim', type: 'int', value: 99 });
    expect(local(s, 'grade')).toEqual({ kind: 'prim', type: 'char', value: 65 });
    const p = local(s, 'p');
    expect(p?.kind).toBe('ref');
    const obj = s.heap.find((o) => p?.kind === 'ref' && o.addr === p.addr);
    expect(obj).toMatchObject({ kind: 'object', className: 'Person' });
    expect(steps[steps.length - 1].output).toBe('25 99\n');
  });

  it('aliases share one object', () => {
    const steps = runOk(example('aliasing'));
    const s = lastWith(steps, 'r');
    expect(local(s, 'p')).toEqual(local(s, 'q'));
    expect(local(s, 'p')).not.toEqual(local(s, 'r'));
    expect(steps[steps.length - 1].output).toBe('30\ntrue\nfalse\n');
  });

  it('models pass-by-value', () => {
    const steps = runOk(example('pass-by-value'));
    expect(steps[steps.length - 1].output).toBe('1, 2\n1\n');
    // While swap runs, there are two frames and the callee has its own copies.
    const inSwap = steps.find((s) => s.frames.length === 2 && s.frames[1].method === 'swap' && local(s, 'tmp'))!;
    expect(inSwap.frames[0].locals.find((v) => v.name === 'x')?.value).toMatchObject({ value: 1 });
    // After swap returns its frame is gone.
    const after = steps.find((s) => s.frames.length === 1 && s.output === '1, 2\n')!;
    expect(after.frames[0].locals.map((v) => v.name)).not.toContain('tmp');
  });

  it('interns literals but not new String', () => {
    const steps = runOk(example('strings'));
    const s = lastWith(steps, 'e');
    expect(local(s, 'a')).toEqual(local(s, 'b'));
    expect(local(s, 'a')).not.toEqual(local(s, 'c'));
    expect(local(s, 'a')).toEqual(local(s, 'e'));
    expect(steps[steps.length - 1].output).toBe('true\nfalse\ntrue\ntrue\n');
  });

  it('flags unreachable objects as garbage, then collects them', () => {
    const steps = runOk(example('gc'));
    const flagged = steps.findIndex((s) => s.heap.some((o) => o.kind === 'object' && o.garbage));
    expect(flagged).toBeGreaterThan(0);
    const addr = steps[flagged].heap.find((o) => o.garbage)!.addr;
    expect(steps[flagged + 1].collected).toContain(addr);
    expect(steps[flagged + 1].heap.some((o) => o.addr === addr)).toBe(false);
  });

  it('pushes one frame per recursive call', () => {
    const steps = runOk(example('recursion'));
    expect(Math.max(...steps.map((s) => s.frames.length))).toBe(5); // main + factorial(4..1)
    expect(steps[steps.length - 1].output).toBe('24\n');
  });

  it('handles static fields shared across instances', () => {
    const steps = runOk(example('statics'));
    expect(steps[steps.length - 1].output).toBe('2 1 2\n');
    expect(steps[steps.length - 1].statics[0]).toMatchObject({ className: 'Counter' });
  });

  it('reports a NullPointerException', () => {
    const r = run(wrapMain('Node n = null;\nint v = n.value;', 'class Node { int value; }'));
    const last = r.steps[r.steps.length - 1];
    expect(last.error).toMatch(/NullPointerException/);
    expect(last.output).toMatch(/Exception in thread "main" java.lang.NullPointerException/);
    expect(last.line).toBe(4);
  });

  it('reports array index out of bounds', () => {
    const r = run(wrapMain('int[] a = new int[2];\na[2] = 1;'));
    expect(r.steps[r.steps.length - 1].error).toMatch(/ArrayIndexOutOfBounds.*Index 2 out of bounds for length 2/);
  });

  it('stops infinite loops', () => {
    const r = run(wrapMain('int i = 0;\nwhile (true) { i++; }'));
    expect(r.steps[r.steps.length - 1].error).toMatch(/infinite loop/);
  });

  it('detects stack overflow', () => {
    const r = run(`public class Main { static int f(int n) { return f(n + 1); } public static void main(String[] args) { f(0); } }`);
    expect(r.steps[r.steps.length - 1].error).toMatch(/StackOverflowError/);
  });

  it('implements Java arithmetic rules', () => {
    const steps = runOk(wrapMain(`
      int a = 7 / 2;
      double b = 7 / 2.0;
      int c = 2147483647 + 1;
      char ch = 'a';
      int code = ch + 1;
      int t = (int) 3.9;
      System.out.println(a + " " + b + " " + c + " " + code + " " + t + " " + (1 + 2 + "x" + 1 + 2));
    `));
    expect(steps[steps.length - 1].output).toBe('3 3.5 -2147483648 98 3 3x12\n');
  });

  it('rejects lossy conversions and type mismatches', () => {
    expect(run(wrapMain('int x = 3.5;')).steps.at(-1)!.error).toMatch(/lossy conversion from double to int/);
    expect(run(wrapMain('int x = "hi";')).steps.at(-1)!.error).toMatch(/String cannot be converted to int/);
  });

  it('calls user toString in concatenation', () => {
    const steps = runOk(wrapMain('P p = new P();\nSystem.out.println("p=" + p);', 'class P { public String toString() { return "P!"; } }'));
    expect(steps.at(-1)!.output).toBe('p=P!\n');
  });

  it('returns a parse error instead of steps', () => {
    const r = run('class {');
    expect(r.steps).toEqual([]);
    expect(r.parseError?.line).toBe(1);
  });

  describe('Scanner and System.in', () => {
    const scannerMain = (body: string) =>
      `import java.util.Scanner;\npublic class Main {\n public static void main(String[] args) {\n Scanner sc = new Scanner(System.in);\n${body}\n }\n}`;

    it('reads ints, doubles, words and lines', () => {
      const steps = runOk(
        scannerMain('int n = sc.nextInt();\ndouble d = sc.nextDouble();\nString w = sc.next();\nsc.nextLine();\nString line = sc.nextLine();\nSystem.out.println(n + "|" + d + "|" + w + "|" + line);'),
        '42 3.5 hi\nhello world\n',
      );
      const last = steps[steps.length - 1];
      expect(last.output).toBe('42 3.5 hi\nhello world\n42|3.5|hi|hello world\n');
      expect(last.input.pos).toBe(last.input.text.length);
      const s = lastWith(steps, 'line');
      expect(local(s, 'n')).toEqual({ kind: 'prim', type: 'int', value: 42 });
      expect(local(s, 'd')).toEqual({ kind: 'prim', type: 'double', value: 3.5 });
    });

    it('nextLine after nextInt returns the empty leftover line', () => {
      const steps = runOk(scannerMain('int age = sc.nextInt();\nString rest = sc.nextLine();\nSystem.out.println("[" + rest + "]");'), '20\nAna\n');
      expect(steps[steps.length - 1].output).toMatch(/\[\]\n$/);
      expect(steps.some((s) => s.event.includes('classic Scanner pitfall'))).toBe(true);
    });

    it('stores System.in in a static field that the Scanner also references', () => {
      const steps = runOk(scannerMain('int x = 1;'));
      const s = lastWith(steps, 'x');
      const inField = s.statics.find((c) => c.className === 'System')!.fields[0].value;
      const sc = local(s, 'sc');
      const scanner = s.heap.find((o) => sc?.kind === 'ref' && o.addr === sc.addr);
      expect(scanner).toMatchObject({ kind: 'object', className: 'Scanner' });
      const source = scanner?.kind === 'object' ? scanner.fields.find((f) => f.name === 'source')!.value : undefined;
      expect(source).toEqual(inField);
      expect(s.heap.find((o) => inField.kind === 'ref' && o.addr === inField.addr)).toMatchObject({ className: 'InputStream' });
    });

    it('shows library calls as native frames', () => {
      const steps = runOk(scannerMain('int x = sc.nextInt();'), '5');
      const call = steps.find((s) => s.frames.at(-1)?.method === 'nextInt')!;
      expect(call.frames.at(-1)).toMatchObject({ className: 'Scanner', native: true });
      expect(call.frames.at(-1)!.locals[0].name).toBe('this');
    });

    it('throws InputMismatchException for a non-number', () => {
      const r = run(scannerMain('int x = sc.nextInt();'), 'abc');
      const last = r.steps[r.steps.length - 1];
      expect(last.error).toMatch(/InputMismatchException/);
      expect(last.output).toMatch(/java\.util\.InputMismatchException/);
      expect(last.input.pos).toBe(0); // the bad token is not consumed
    });

    it('throws NoSuchElementException when input runs out', () => {
      const r = run(scannerMain('int x = sc.nextInt();'), '');
      expect(r.steps[r.steps.length - 1].error).toMatch(/NoSuchElementException/);
    });

    it('requires the import', () => {
      const r = run(wrapMain('Scanner sc = new Scanner(System.in);'));
      expect(r.steps[r.steps.length - 1].error).toMatch(/import java\.util\.Scanner/);
    });

    it('accepts a wildcard import and reports unsupported java.util classes', () => {
      expect(runOk(`import java.util.*;\n` + wrapMain('Scanner sc = new Scanner(System.in);')).length).toBeGreaterThan(0);
      const r = run(`import java.util.ArrayList;\n` + wrapMain('ArrayList list = new ArrayList();'));
      expect(r.steps[r.steps.length - 1].error).toMatch(/java\.util\.ArrayList is not supported/);
    });
  });

  describe('Math', () => {
    it('keeps Java return types', () => {
      const steps = runOk(wrapMain('long r = Math.round(2.5);\nint a = Math.abs(-3);\ndouble s = Math.sqrt(16);\nint m = Math.max(2, 9);\nint f = Math.floorMod(-7, 3);\nSystem.out.println(r + " " + a + " " + s + " " + m + " " + f + " " + Math.round(-2.5));'));
      const s = lastWith(steps, 'f');
      expect(local(s, 'r')).toEqual({ kind: 'prim', type: 'long', value: 3 });
      expect(local(s, 'a')).toEqual({ kind: 'prim', type: 'int', value: 3 });
      expect(steps.at(-1)!.output).toBe('3 3 4.0 9 2 -2\n');
    });

    it('shows a native frame with converted parameters', () => {
      const steps = runOk(wrapMain('double s = Math.sqrt(16);'));
      const call = steps.find((s) => s.frames.at(-1)?.method === 'sqrt')!;
      expect(call.frames.at(-1)).toMatchObject({ className: 'Math', native: true });
      expect(call.frames.at(-1)!.locals).toEqual([{ name: 'a', type: 'double', value: { kind: 'prim', type: 'double', value: 16 } }]);
    });

    it('Math.random is deterministic between runs', () => {
      const code = wrapMain('System.out.println(Math.random());');
      expect(runOk(code).at(-1)!.output).toBe(runOk(code).at(-1)!.output);
    });
  });
});
