import { describe, expect, it } from 'vitest';
import { parse } from '../src/lang/parser';
import { SourceError } from '../src/lang/tokens';
import { EXAMPLES } from '../src/examples';

describe('parser', () => {
  it('parses classes, fields, constructors and methods', () => {
    const prog = parse(`
      class Person {
        String name;
        int age = 3, h;
        static int count;
        Person(String n) { name = n; }
        int getAge() { return age; }
      }`);
    const cls = prog.classes[0];
    expect(cls.name).toBe('Person');
    expect(cls.fields.map((f) => f.name)).toEqual(['name', 'age', 'h', 'count']);
    expect(cls.fields[3].isStatic).toBe(true);
    expect(cls.constructors).toHaveLength(1);
    expect(cls.methods[0]).toMatchObject({ name: 'getAge', returnType: { name: 'int', dims: 0 } });
  });

  it('distinguishes declarations from expressions', () => {
    const prog = parse(`class A { void m() { Person p = q; p = q; a[i] = 1; int[] xs = {1, 2}; x.y.z(); } }`);
    const kinds = prog.classes[0].methods[0].body.body.map((s) => s.kind);
    expect(kinds).toEqual(['varDecl', 'expr', 'expr', 'varDecl', 'expr']);
  });

  it('respects operator precedence', () => {
    const prog = parse(`class A { void m() { int x = 1 + 2 * 3 == 7 && true ? 1 : 0; } }`);
    const decl = prog.classes[0].methods[0].body.body[0];
    if (decl.kind !== 'varDecl') throw new Error('expected varDecl');
    expect(decl.declarators[0].init?.kind).toBe('ternary');
  });

  it('parses array creation forms', () => {
    const prog = parse(`class A { void m() { int[][] g = new int[2][3]; int[] a = new int[]{1}; String[] s = new String[4]; } }`);
    const body = prog.classes[0].methods[0].body.body;
    const inits = body.map((s) => (s.kind === 'varDecl' ? s.declarators[0].init?.kind : null));
    expect(inits).toEqual(['newArray', 'arrayLit', 'newArray']);
  });

  it('reports syntax errors with line numbers', () => {
    try {
      parse('class A {\n void m() {\n int x = ;\n }\n}');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SourceError);
      expect((e as SourceError).line).toBe(3);
    }
  });

  it('parses package and import declarations', () => {
    const prog = parse(`package demo.app;\nimport java.util.Scanner;\nimport java.util.*;\nimport static java.lang.Math.max;\nclass A {}`);
    expect(prog.imports).toEqual(['java.util.Scanner', 'java.util.*', 'java.lang.Math.max']);
    expect(prog.classes[0].name).toBe('A');
  });

  it('parses every built-in example', () => {
    for (const ex of EXAMPLES) expect(() => parse(ex.code), ex.id).not.toThrow();
  });
});
