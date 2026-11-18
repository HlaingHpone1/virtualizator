/** A Java type, e.g. `int`, `String`, `Person[]`, `int[][]`. */
export interface TypeRef {
  name: string;
  dims: number;
}

export interface Program {
  /** Fully qualified imports, e.g. "java.util.Scanner" or "java.util.*". */
  imports: string[];
  classes: ClassDecl[];
}

export interface ClassDecl {
  name: string;
  fields: FieldDecl[];
  methods: MethodDecl[];
  constructors: MethodDecl[];
  line: number;
}

export interface FieldDecl {
  name: string;
  type: TypeRef;
  isStatic: boolean;
  init?: Expr;
  line: number;
}

export interface Param {
  name: string;
  type: TypeRef;
}

export interface MethodDecl {
  name: string;
  returnType: TypeRef | null; // null for constructors
  params: Param[];
  isStatic: boolean;
  body: Block;
  line: number;
  endLine: number;
}

export type Stmt =
  | Block
  | { kind: 'varDecl'; type: TypeRef; declarators: { name: string; init?: Expr }[]; line: number }
  | { kind: 'expr'; expr: Expr; line: number }
  | { kind: 'if'; cond: Expr; then: Stmt; else?: Stmt; line: number }
  | { kind: 'while'; cond: Expr; body: Stmt; line: number }
  | { kind: 'for'; init?: Stmt; cond?: Expr; update: Expr[]; body: Stmt; line: number }
  | { kind: 'return'; value?: Expr; line: number }
  | { kind: 'break'; line: number }
  | { kind: 'continue'; line: number };

export interface Block {
  kind: 'block';
  body: Stmt[];
  line: number;
  endLine: number;
}

export type Expr =
  | { kind: 'literal'; type: 'int' | 'long' | 'double' | 'boolean' | 'char' | 'null'; value: number | boolean | string | null; line: number }
  | { kind: 'string'; value: string; line: number }
  | { kind: 'name'; name: string; line: number }
  | { kind: 'this'; line: number }
  | { kind: 'field'; target: Expr; name: string; line: number }
  | { kind: 'index'; target: Expr; index: Expr; line: number }
  | { kind: 'call'; target: Expr | null; name: string; args: Expr[]; line: number }
  | { kind: 'new'; className: string; args: Expr[]; line: number }
  | { kind: 'newArray'; elemType: TypeRef; sizes: Expr[]; line: number }
  | { kind: 'arrayLit'; elemType: TypeRef | null; elements: Expr[]; line: number }
  | { kind: 'unary'; op: string; operand: Expr; line: number }
  | { kind: 'update'; op: '++' | '--'; prefix: boolean; target: Expr; line: number }
  | { kind: 'binary'; op: string; left: Expr; right: Expr; line: number }
  | { kind: 'assign'; op: string; target: Expr; value: Expr; line: number }
  | { kind: 'ternary'; cond: Expr; then: Expr; else: Expr; line: number }
  | { kind: 'cast'; type: TypeRef; expr: Expr; line: number };

export function typeToString(t: TypeRef): string {
  return t.name + '[]'.repeat(t.dims);
}
