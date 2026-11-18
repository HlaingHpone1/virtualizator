import { java } from '@codemirror/lang-java';
import { Compartment, StateEffect, StateField } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { EditorView, basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

export interface LineMark {
  line: number;
  kind: 'current' | 'error';
}

const setMark = StateEffect.define<LineMark | null>();

const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setMark)) continue;
      const m = e.value;
      if (!m || m.line < 1 || m.line > tr.state.doc.lines) {
        deco = Decoration.none;
      } else {
        const line = tr.state.doc.line(m.line);
        deco = Decoration.set([Decoration.line({ class: `cm-mark-${m.kind}` }).range(line.from)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function CodeEditor({ value, onChange, mark }: { value: string; onChange: (v: string) => void; mark: LineMark | null }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const theme = new Compartment();
    const v = new EditorView({
      parent: host.current!,
      doc: value,
      extensions: [
        basicSetup,
        java(),
        markField,
        theme.of(darkQuery().matches ? oneDark : []),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });
    view.current = v;
    const mq = darkQuery();
    const onScheme = () => v.dispatch({ effects: theme.reconfigure(mq.matches ? oneDark : []) });
    mq.addEventListener('change', onScheme);
    return () => {
      mq.removeEventListener('change', onScheme);
      v.destroy();
    };
    // The editor is created once; later value changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the document when the value changes from outside (e.g. picking an example).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const effects: StateEffect<unknown>[] = [setMark.of(mark)];
    if (mark && mark.line >= 1 && mark.line <= v.state.doc.lines) {
      effects.push(EditorView.scrollIntoView(v.state.doc.line(mark.line).from, { y: 'nearest' }));
    }
    v.dispatch({ effects });
  }, [mark?.line, mark?.kind]);

  return <div className="editor" ref={host} />;
}
