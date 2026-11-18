export type TokenKind =
  | 'ident'
  | 'keyword'
  | 'int'
  | 'double'
  | 'string'
  | 'char'
  | 'op'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
}

export const KEYWORDS = new Set([
  'class', 'public', 'private', 'protected', 'static', 'final', 'void',
  'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short',
  'new', 'return', 'if', 'else', 'while', 'for', 'null', 'true', 'false', 'this',
  'break', 'continue',
]);

export const PRIMITIVE_TYPES = new Set([
  'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short',
]);

// Longest first so the lexer matches greedily.
export const OPERATORS = [
  '>>>', '<<=', '>>=',
  '==', '!=', '<=', '>=', '&&', '||', '++', '--', '+=', '-=', '*=', '/=', '%=', '<<', '>>',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '(', ')', '{', '}', '[', ']', ';', ',', '.', '?', ':',
];

export class SourceError extends Error {
  constructor(message: string, public line: number, public col = 0) {
    super(message);
  }
}
