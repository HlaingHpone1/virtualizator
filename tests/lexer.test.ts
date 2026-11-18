import { describe, expect, it } from 'vitest';
import { lex } from '../src/lang/lexer';

describe('lexer', () => {
  it('tokenizes declarations and literals', () => {
    const toks = lex('int x = 42; double d = 1.5; long l = 3L; char c = \'a\'; String s = "hi\\n";');
    expect(toks.map((t) => t.value)).toEqual([
      'int', 'x', '=', '42', ';',
      'double', 'd', '=', '1.5', ';',
      'long', 'l', '=', '3L', ';',
      'char', 'c', '=', 'a', ';',
      'String', 's', '=', 'hi\n', ';',
      '',
    ]);
    expect(toks[0].kind).toBe('keyword');
    expect(toks[1].kind).toBe('ident');
    expect(toks[8].kind).toBe('double');
    expect(toks[18].kind).toBe('char');
  });

  it('skips comments and tracks lines', () => {
    const toks = lex('// hello\n/* multi\nline */ x++ >>= y');
    expect(toks[0]).toMatchObject({ value: 'x', line: 3 });
    expect(toks.map((t) => t.value)).toEqual(['x', '++', '>>=', 'y', '']);
  });

  it('reports unexpected characters with a line', () => {
    expect(() => lex('int x;\n#')).toThrowError(/Unexpected character/);
  });
});
