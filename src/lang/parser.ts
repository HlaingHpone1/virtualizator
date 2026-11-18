import type { Block, ClassDecl, Expr, FieldDecl, MethodDecl, Param, Program, Stmt, TypeRef } from './ast';
import { lex } from './lexer';
import { PRIMITIVE_TYPES, SourceError, type Token } from './tokens';

const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final']);
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=']);

// Binary operator precedence, lowest first.
const BINARY_LEVELS: string[][] = [
  ['||'],
  ['&&'],
  ['==', '!='],
  ['<', '>', '<=', '>='],
  ['<<', '>>', '>>>'],
  ['+', '-'],
  ['*', '/', '%'],
];

export function parse(source: string): Program {
  return new Parser(lex(source)).parseProgram();
}

class Parser {
  private pos = 0;

  constructor(private tokens: Token[]) {}

  // ---- token helpers ----

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.pos++;
    return t;
  }

  private is(value: string, offset = 0): boolean {
    const t = this.peek(offset);
    return (t.kind === 'op' || t.kind === 'keyword') && t.value === value;
  }

  private accept(value: string): boolean {
    if (this.is(value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(value: string): Token {
    if (!this.is(value)) this.fail(`Expected '${value}'`);
    return this.next();
  }

  private expectIdent(): string {
    const t = this.peek();
    if (t.kind !== 'ident') this.fail('Expected a name');
    this.pos++;
    return t.value;
  }

  private fail(message: string): never {
    const t = this.peek();
    const found = t.kind === 'eof' ? 'end of input' : `'${t.value}'`;
    throw new SourceError(`${message} but found ${found}`, t.line, t.col);
  }

  // ---- declarations ----

  parseProgram(): Program {
    const imports: string[] = [];
    if (this.peek().kind === 'ident' && this.peek().value === 'package') {
      this.next();
      this.parseQualifiedName(false);
      this.expect(';');
    }
    while (this.peek().kind === 'ident' && this.peek().value === 'import') {
      this.next();
      this.accept('static');
      imports.push(this.parseQualifiedName(true));
      this.expect(';');
    }
    const classes: ClassDecl[] = [];
    while (this.peek().kind !== 'eof') classes.push(this.parseClass());
    if (classes.length === 0) throw new SourceError('Program must contain at least one class', 1);
    return { imports, classes };
  }

  /** `a.b.C`, or `a.b.*` when wildcards are allowed. */
  private parseQualifiedName(allowWildcard: boolean): string {
    const parts = [this.expectIdent()];
    while (this.accept('.')) {
      if (allowWildcard && this.accept('*')) {
        parts.push('*');
        break;
      }
      parts.push(this.expectIdent());
    }
    return parts.join('.');
  }

  private parseClass(): ClassDecl {
    while (MODIFIERS.has(this.peek().value) && this.peek().kind === 'keyword') this.next();
    const line = this.expect('class').line;
    const name = this.expectIdent();
    this.expect('{');
    const cls: ClassDecl = { name, fields: [], methods: [], constructors: [], line };
    while (!this.is('}')) {
      if (this.peek().kind === 'eof') this.fail("Expected '}' to close class");
      this.parseMember(cls);
    }
    this.expect('}');
    return cls;
  }

  private parseMember(cls: ClassDecl) {
    let isStatic = false;
    while (this.peek().kind === 'keyword' && MODIFIERS.has(this.peek().value)) {
      if (this.next().value === 'static') isStatic = true;
    }
    const line = this.peek().line;

    // Constructor: ClassName(
    if (this.peek().kind === 'ident' && this.peek().value === cls.name && this.is('(', 1)) {
      this.next();
      cls.constructors.push(this.parseMethodRest(cls.name, null, false, line));
      return;
    }

    const returnType: TypeRef = this.accept('void') ? { name: 'void', dims: 0 } : this.parseType();
    const name = this.expectIdent();
    if (this.is('(')) {
      cls.methods.push(this.parseMethodRest(name, returnType, isStatic, line));
      return;
    }

    // Field(s): Type a = 1, b;
    let fieldName = name;
    for (;;) {
      const field: FieldDecl = { name: fieldName, type: returnType, isStatic, line };
      if (this.accept('=')) field.init = this.parseVarInit(returnType);
      cls.fields.push(field);
      if (!this.accept(',')) break;
      fieldName = this.expectIdent();
    }
    this.expect(';');
  }

  private parseMethodRest(name: string, returnType: TypeRef | null, isStatic: boolean, line: number): MethodDecl {
    this.expect('(');
    const params: Param[] = [];
    if (!this.is(')')) {
      do {
        this.accept('final');
        const type = this.parseType();
        params.push({ type, name: this.expectIdent() });
      } while (this.accept(','));
    }
    this.expect(')');
    const body = this.parseBlock();
    return { name, returnType, params, isStatic, body, line, endLine: body.endLine };
  }

  private parseType(): TypeRef {
    const t = this.peek();
    let name: string;
    if (t.kind === 'keyword' && PRIMITIVE_TYPES.has(t.value)) {
      name = t.value;
    } else if (t.kind === 'ident') {
      name = t.value;
    } else {
      this.fail('Expected a type');
    }
    this.next();
    let dims = 0;
    while (this.is('[') && this.is(']', 1)) {
      this.pos += 2;
      dims++;
    }
    return { name, dims };
  }

  /** Tries to parse `Type name` at the current position without consuming on failure. */
  private looksLikeVarDecl(): boolean {
    const save = this.pos;
    try {
      const t = this.peek();
      if (!(t.kind === 'ident' || (t.kind === 'keyword' && PRIMITIVE_TYPES.has(t.value)))) return false;
      this.parseType();
      return this.peek().kind === 'ident';
    } catch {
      return false;
    } finally {
      this.pos = save;
    }
  }

  // ---- statements ----

  private parseBlock(): Block {
    const line = this.expect('{').line;
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.peek().kind === 'eof') this.fail("Expected '}'");
      body.push(this.parseStatement());
    }
    const endLine = this.expect('}').line;
    return { kind: 'block', body, line, endLine };
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    const line = t.line;
    if (this.is('{')) return this.parseBlock();
    if (this.accept(';')) return { kind: 'block', body: [], line, endLine: line };
    if (this.accept('if')) {
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      const then = this.parseStatement();
      const els = this.accept('else') ? this.parseStatement() : undefined;
      return { kind: 'if', cond, then, else: els, line };
    }
    if (this.accept('while')) {
      this.expect('(');
      const cond = this.parseExpr();
      this.expect(')');
      return { kind: 'while', cond, body: this.parseStatement(), line };
    }
    if (this.accept('for')) {
      this.expect('(');
      let init: Stmt | undefined;
      if (!this.is(';')) {
        init = this.looksLikeVarDecl()
          ? this.parseVarDecl()
          : { kind: 'expr', expr: this.parseExpr(), line: this.peek().line };
      }
      this.expect(';');
      const cond = this.is(';') ? undefined : this.parseExpr();
      this.expect(';');
      const update: Expr[] = [];
      if (!this.is(')')) {
        do update.push(this.parseExpr());
        while (this.accept(','));
      }
      this.expect(')');
      return { kind: 'for', init, cond, update, body: this.parseStatement(), line };
    }
    if (this.accept('return')) {
      const value = this.is(';') ? undefined : this.parseExpr();
      this.expect(';');
      return { kind: 'return', value, line };
    }
    if (this.accept('break')) {
      this.expect(';');
      return { kind: 'break', line };
    }
    if (this.accept('continue')) {
      this.expect(';');
      return { kind: 'continue', line };
    }
    this.accept('final');
    if (this.looksLikeVarDecl()) {
      const decl = this.parseVarDecl();
      this.expect(';');
      return decl;
    }
    const expr = this.parseExpr();
    this.expect(';');
    return { kind: 'expr', expr, line };
  }

  private parseVarDecl(): Stmt {
    const line = this.peek().line;
    const type = this.parseType();
    const declarators: { name: string; init?: Expr }[] = [];
    do {
      const name = this.expectIdent();
      declarators.push({ name, init: this.accept('=') ? this.parseVarInit(type) : undefined });
    } while (this.accept(','));
    return { kind: 'varDecl', type, declarators, line };
  }

  /** An initializer may be an array literal `{1, 2, 3}` when the declared type is an array. */
  private parseVarInit(type: TypeRef): Expr {
    if (this.is('{')) return this.parseArrayLiteral(type.dims > 0 ? { name: type.name, dims: type.dims - 1 } : null);
    return this.parseExpr();
  }

  private parseArrayLiteral(elemType: TypeRef | null): Expr {
    const line = this.expect('{').line;
    const elements: Expr[] = [];
    if (!this.is('}')) {
      do {
        if (this.is('}')) break; // trailing comma
        elements.push(
          this.is('{')
            ? this.parseArrayLiteral(elemType && elemType.dims > 0 ? { name: elemType.name, dims: elemType.dims - 1 } : null)
            : this.parseExpr(),
        );
      } while (this.accept(','));
    }
    this.expect('}');
    return { kind: 'arrayLit', elemType, elements, line };
  }

  // ---- expressions ----

  parseExpr(): Expr {
    return this.parseAssign();
  }

  private parseAssign(): Expr {
    const left = this.parseTernary();
    const t = this.peek();
    if (t.kind === 'op' && ASSIGN_OPS.has(t.value)) {
      if (left.kind !== 'name' && left.kind !== 'field' && left.kind !== 'index') {
        throw new SourceError('Left side of assignment must be a variable, field or array element', t.line, t.col);
      }
      this.next();
      return { kind: 'assign', op: t.value, target: left, value: this.parseAssign(), line: t.line };
    }
    return left;
  }

  private parseTernary(): Expr {
    const cond = this.parseBinary(0);
    if (this.is('?')) {
      const line = this.next().line;
      const then = this.parseExpr();
      this.expect(':');
      return { kind: 'ternary', cond, then, else: this.parseTernary(), line };
    }
    return cond;
  }

  private parseBinary(level: number): Expr {
    if (level >= BINARY_LEVELS.length) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op' || !BINARY_LEVELS[level].includes(t.value)) return left;
      this.next();
      left = { kind: 'binary', op: t.value, left, right: this.parseBinary(level + 1), line: t.line };
    }
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'op' && (t.value === '++' || t.value === '--')) {
      this.next();
      return { kind: 'update', op: t.value, prefix: true, target: this.parseUnary(), line: t.line };
    }
    if (t.kind === 'op' && (t.value === '-' || t.value === '+' || t.value === '!')) {
      this.next();
      return { kind: 'unary', op: t.value, operand: this.parseUnary(), line: t.line };
    }
    // Primitive cast: (int) x
    if (this.is('(') && this.peek(1).kind === 'keyword' && PRIMITIVE_TYPES.has(this.peek(1).value)) {
      this.next();
      const type = this.parseType();
      this.expect(')');
      return { kind: 'cast', type, expr: this.parseUnary(), line: t.line };
    }
    return this.parsePostfix(this.parsePrimary());
  }

  private parsePostfix(expr: Expr): Expr {
    for (;;) {
      const t = this.peek();
      if (this.accept('.')) {
        const name = this.expectIdent();
        if (this.is('(')) {
          expr = { kind: 'call', target: expr, name, args: this.parseArgs(), line: t.line };
        } else {
          expr = { kind: 'field', target: expr, name, line: t.line };
        }
      } else if (this.accept('[')) {
        const index = this.parseExpr();
        this.expect(']');
        expr = { kind: 'index', target: expr, index, line: t.line };
      } else if (t.kind === 'op' && (t.value === '++' || t.value === '--')) {
        this.next();
        expr = { kind: 'update', op: t.value, prefix: false, target: expr, line: t.line };
      } else {
        return expr;
      }
    }
  }

  private parseArgs(): Expr[] {
    this.expect('(');
    const args: Expr[] = [];
    if (!this.is(')')) {
      do args.push(this.parseExpr());
      while (this.accept(','));
    }
    this.expect(')');
    return args;
  }

  private parsePrimary(): Expr {
    const t = this.peek();
    const line = t.line;
    switch (t.kind) {
      case 'int': {
        this.next();
        const isLong = t.value.endsWith('L');
        return { kind: 'literal', type: isLong ? 'long' : 'int', value: Number(t.value.replace(/L$/, '')), line };
      }
      case 'double':
        this.next();
        return { kind: 'literal', type: 'double', value: Number(t.value), line };
      case 'string':
        this.next();
        return { kind: 'string', value: t.value, line };
      case 'char':
        this.next();
        return { kind: 'literal', type: 'char', value: t.value, line };
      case 'ident': {
        this.next();
        if (this.is('(')) return { kind: 'call', target: null, name: t.value, args: this.parseArgs(), line };
        return { kind: 'name', name: t.value, line };
      }
      case 'keyword':
        if (t.value === 'true' || t.value === 'false') {
          this.next();
          return { kind: 'literal', type: 'boolean', value: t.value === 'true', line };
        }
        if (t.value === 'null') {
          this.next();
          return { kind: 'literal', type: 'null', value: null, line };
        }
        if (t.value === 'this') {
          this.next();
          return { kind: 'this', line };
        }
        if (t.value === 'new') return this.parseNew();
        break;
      case 'op':
        if (t.value === '(') {
          this.next();
          const e = this.parseExpr();
          this.expect(')');
          return e;
        }
        break;
    }
    this.fail('Expected an expression');
  }

  private parseNew(): Expr {
    const line = this.expect('new').line;
    const t = this.peek();
    const isPrim = t.kind === 'keyword' && PRIMITIVE_TYPES.has(t.value);
    if (!isPrim && t.kind !== 'ident') this.fail('Expected a type after new');
    this.next();
    const name = t.value;

    if (this.is('(')) {
      if (isPrim) this.fail('Cannot use new on a primitive type');
      return { kind: 'new', className: name, args: this.parseArgs(), line };
    }
    if (!this.is('[')) this.fail("Expected '(' or '['");

    // new T[n][m][] or new T[]{...}
    const sizes: Expr[] = [];
    let dims = 0;
    while (this.accept('[')) {
      dims++;
      if (this.accept(']')) continue;
      if (dims !== sizes.length + 1) this.fail('Array size dimensions must come first');
      sizes.push(this.parseExpr());
      this.expect(']');
    }
    if (sizes.length === 0) {
      if (!this.is('{')) this.fail("Expected array size or '{'");
      return this.parseArrayLiteral({ name, dims: dims - 1 });
    }
    return { kind: 'newArray', elemType: { name, dims: dims - 1 }, sizes, line };
  }
}
