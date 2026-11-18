import type { PrimType, Value } from './types';
import { prim } from './values';

/**
 * An error raised while running. `javaName` is set for real Java exceptions,
 * e.g. "NullPointerException" (java.lang) or "java.util.InputMismatchException".
 */
export class RunError extends Error {
  constructor(message: string, public line: number, public javaName?: string) {
    super(message);
  }
}

/** Fully qualified name of a Java exception, for the "Exception in thread main" line. */
export function qualifiedExceptionName(javaName: string): string {
  return javaName.includes('.') ? javaName : `java.lang.${javaName}`;
}

// ------------------------------------------------------------------ imports

/** java.util classes this visualizer implements. */
export const SUPPORTED_UTIL_CLASSES = new Set(['Scanner']);

export function isImported(imports: string[], pkg: string, className: string): boolean {
  return imports.includes(`${pkg}.${className}`) || imports.includes(`${pkg}.*`);
}

// ------------------------------------------------------------------ Math

const NUMERIC_RANK: Record<string, number> = { byte: 1, short: 2, char: 2, int: 3, long: 4, float: 5, double: 6 };

export const MATH_CONSTANTS: Record<string, Value> = {
  'Math.PI': prim('double', Math.PI),
  'Math.E': prim('double', Math.E),
};

export interface MathMethod {
  /** Parameter names as in the JDK, shown in the native frame. */
  params: string[];
  /**
   * 'double': arguments are widened to double (Math.sqrt(16) gets a = 16.0).
   * 'widest': overloads exist for int/long/double, so the widest argument type wins (Math.max).
   */
  paramType: 'double' | 'widest';
  /** Return type; 'same' means the parameter type. */
  returns: PrimType | 'same';
  fn: (...xs: number[]) => number;
}

const d = (params: string[], fn: (...xs: number[]) => number, returns: PrimType = 'double'): MathMethod => ({
  params,
  paramType: 'double',
  returns,
  fn,
});
const w = (params: string[], fn: (...xs: number[]) => number): MathMethod => ({ params, paramType: 'widest', returns: 'same', fn });

export const MATH_METHODS: Record<string, MathMethod> = {
  abs: w(['a'], Math.abs),
  max: w(['a', 'b'], Math.max),
  min: w(['a', 'b'], Math.min),
  floorDiv: w(['x', 'y'], (x, y) => Math.floor(x / y)),
  floorMod: w(['x', 'y'], (x, y) => x - Math.floor(x / y) * y),
  sqrt: d(['a'], Math.sqrt),
  cbrt: d(['a'], Math.cbrt),
  pow: d(['a', 'b'], Math.pow),
  hypot: d(['x', 'y'], Math.hypot),
  exp: d(['a'], Math.exp),
  log: d(['a'], Math.log),
  log10: d(['a'], Math.log10),
  sin: d(['a'], Math.sin),
  cos: d(['a'], Math.cos),
  tan: d(['a'], Math.tan),
  toRadians: d(['angdeg'], (a) => (a * Math.PI) / 180),
  toDegrees: d(['angrad'], (a) => (a * 180) / Math.PI),
  signum: d(['d'], Math.sign),
  floor: d(['a'], Math.floor),
  ceil: d(['a'], Math.ceil),
  // Java rounds half up (Math.round(-2.5) == -2), unlike some other languages.
  round: d(['a'], (a) => Math.floor(a + 0.5), 'long'),
  random: d([], () => 0), // replaced per run by a seeded generator
};

/** The parameter type each argument gets in the frame, following Java's overload rules. */
export function mathParamType(m: MathMethod, args: Value[]): PrimType {
  if (m.paramType === 'double') return 'double';
  let t: PrimType = 'int';
  for (const a of args) {
    if (a.kind === 'prim' && NUMERIC_RANK[a.type] > NUMERIC_RANK[t]) t = a.type === 'float' || a.type === 'double' ? 'double' : a.type === 'long' ? 'long' : 'int';
  }
  return t;
}

/** Small deterministic PRNG so Math.random() gives the same values every time you step through. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ System.in / Scanner

const INT_RE = /^[+-]?\d+$/;
const DOUBLE_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * The program's standard input, read the way java.util.Scanner reads it:
 * tokens are separated by whitespace, and nextLine() returns the rest of the current line.
 */
export class InputReader {
  pos = 0;
  /** How much of the input has been echoed to the console (like a terminal showing what was typed). */
  private echoed = 0;

  constructor(readonly text: string) {}

  private peekToken(): { text: string; start: number; end: number } | null {
    let s = this.pos;
    while (s < this.text.length && /\s/.test(this.text[s])) s++;
    if (s >= this.text.length) return null;
    let e = s;
    while (e < this.text.length && !/\s/.test(this.text[e])) e++;
    return { text: this.text.slice(s, e), start: s, end: e };
  }

  /** Returns the input lines that a read starting at `start` makes visible on the console. */
  private echoFrom(start: number): string {
    if (start < this.echoed) return '';
    const nl = this.text.indexOf('\n', start);
    const end = nl < 0 ? this.text.length : nl + 1;
    let out = this.text.slice(this.echoed, end).replace(/\r/g, '');
    if (!out.endsWith('\n')) out += '\n';
    this.echoed = end;
    return out;
  }

  hasNext(): boolean {
    return this.peekToken() !== null;
  }

  hasNextInt(): boolean {
    const t = this.peekToken();
    return !!t && INT_RE.test(t.text) && Math.abs(Number(t.text)) <= 2147483648;
  }

  hasNextDouble(): boolean {
    const t = this.peekToken();
    return !!t && DOUBLE_RE.test(t.text);
  }

  hasNextLine(): boolean {
    return this.pos < this.text.length;
  }

  /** Reads one token. `check` validates it; on failure the token is NOT consumed, as in Java. */
  nextToken(line: number, expected?: { re: RegExp; what: string }): { token: string; echo: string } {
    const t = this.peekToken();
    if (!t) {
      throw new RunError('no more input to read (type some input in the Program input box)', line, 'java.util.NoSuchElementException');
    }
    if (expected && !expected.re.test(t.text)) {
      throw new RunError(`the next token is "${t.text}", which is not ${expected.what}`, line, 'java.util.InputMismatchException');
    }
    const echo = this.echoFrom(t.start);
    this.pos = t.end;
    return { token: t.text, echo };
  }

  nextLine(line: number): { text: string; echo: string } {
    if (this.pos >= this.text.length) {
      throw new RunError('No line found (type some input in the Program input box)', line, 'java.util.NoSuchElementException');
    }
    const echo = this.echoFrom(this.pos);
    const nl = this.text.indexOf('\n', this.pos);
    const end = nl < 0 ? this.text.length : nl;
    const text = this.text.slice(this.pos, end).replace(/\r$/, '');
    this.pos = nl < 0 ? end : nl + 1;
    return { text, echo };
  }
}

export const SCANNER_PATTERNS = {
  int: { re: INT_RE, what: 'an int' },
  double: { re: DOUBLE_RE, what: 'a double' },
  boolean: { re: /^(true|false)$/i, what: 'a boolean (true/false)' },
};
