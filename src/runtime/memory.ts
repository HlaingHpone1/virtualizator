import type { FrameSnap, Value, Var } from './types';

/** One stack frame: the local variables of a single method invocation. */
export class Frame {
  /** Block scopes, outermost first. Variables vanish when their block ends. */
  private scopes: Var[][] = [[]];
  line: number;
  /** True for built-in library methods such as Math.sqrt or Scanner.nextInt. */
  native = false;

  constructor(
    readonly id: number,
    readonly className: string,
    readonly method: string,
    line: number,
    /** Address of `this` for instance methods and constructors. */
    readonly thisAddr: number | null,
  ) {
    this.line = line;
  }

  declare(name: string, type: string, value: Value) {
    if (this.lookup(name)) throw new Error(`Variable '${name}' is already defined in ${this.method}`);
    this.scopes[this.scopes.length - 1].push({ name, type, value });
  }

  lookup(name: string): Var | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].find((x) => x.name === name);
      if (v) return v;
    }
    return undefined;
  }

  pushScope() {
    this.scopes.push([]);
  }

  /** Returns the names of the variables that went out of scope. */
  popScope(): string[] {
    return (this.scopes.pop() ?? []).map((v) => v.name);
  }

  allLocals(): Var[] {
    return this.scopes.flat();
  }

  snapshot(): FrameSnap {
    return {
      id: this.id,
      className: this.className,
      method: this.method,
      line: this.line,
      locals: this.allLocals().map((v) => ({ ...v, value: { ...v.value } })),
      ...(this.native ? { native: true } : {}),
    };
  }
}
