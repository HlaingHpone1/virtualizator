import { useEffect, useMemo, useRef, useState } from 'react';
import { EXAMPLES } from '../examples';
import { run } from '../runtime/interpreter';
import type { RunResult } from '../runtime/types';
import { CodeEditor, type LineMark } from './CodeEditor';
import { Controls } from './Controls';
import { Console, Explanation, InputPanel } from './Explanation';
import { MemoryFlow } from './MemoryFlow';

function safeRun(code: string, input: string): RunResult {
  try {
    return run(code, input);
  } catch (e) {
    return { steps: [], parseError: { message: `Internal error: ${(e as Error).message}`, line: 1 } };
  }
}

/** Supports links like #example=aliasing&step=6 (step is 1-based). */
function readHash(): { example: (typeof EXAMPLES)[number]; step: number } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const example = EXAMPLES.find((e) => e.id === params.get('example')) ?? EXAMPLES[0];
  return { example, step: Math.max(0, (Number(params.get('step')) || 1) - 1) };
}

export function App() {
  const [initial] = useState(readHash);
  const [exampleId, setExampleId] = useState(initial.example.id);
  const [code, setCode] = useState(initial.example.code);
  const [input, setInput] = useState(initial.example.input ?? '');
  const [result, setResult] = useState<RunResult>(() => safeRun(initial.example.code, initial.example.input ?? ''));
  const [index, setIndex] = useState(initial.step);
  const lastRun = useRef({ code: initial.example.code, input: initial.example.input ?? '' });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(800);

  // Re-run the program shortly after the user stops typing code or input.
  useEffect(() => {
    if (code === lastRun.current.code && input === lastRun.current.input) return;
    const t = setTimeout(() => {
      lastRun.current = { code, input };
      setResult(safeRun(code, input));
      setIndex(0);
      setPlaying(false);
    }, 350);
    return () => clearTimeout(t);
  }, [code, input]);

  const total = result.steps.length;
  const clamped = Math.min(index, Math.max(0, total - 1));
  const step = result.steps[clamped];
  const prev = clamped > 0 ? result.steps[clamped - 1] : undefined;

  useEffect(() => {
    if (!playing) return;
    if (clamped >= total - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIndex(clamped + 1), speed);
    return () => clearTimeout(t);
  }, [playing, clamped, total, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('.cm-editor') || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return;
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, total - 1));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === 'Home') setIndex(0);
      else if (e.key === 'End') setIndex(total - 1);
      else if (e.key === ' ') setPlaying((p) => !p);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  const mark: LineMark | null = useMemo(() => {
    if (result.parseError) return { line: result.parseError.line, kind: 'error' };
    if (!step) return null;
    return { line: step.line, kind: step.error ? 'error' : 'current' };
  }, [result, step]);

  const pickExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setExampleId(id);
    setCode(ex.code);
    setInput(ex.input ?? '');
    history.replaceState(null, '', `#example=${id}`);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Java Memory Visualizer</h1>
        <label className="example-picker">
          Example
          <select value={exampleId} onChange={(e) => pickExample(e.target.value)}>
            {EXAMPLES.map((ex) => (
              <option key={ex.id} value={ex.id}>{ex.title}</option>
            ))}
            {!EXAMPLES.some((ex) => ex.code === code) && <option value="custom">Your code</option>}
          </select>
        </label>
      </header>

      <main className="layout">
        <div className="side-column">
          <CodeEditor
            value={code}
            mark={mark}
            onChange={(v) => {
              setCode(v);
              if (!EXAMPLES.some((ex) => ex.code === v)) setExampleId('custom');
            }}
          />
          <Controls
            index={clamped}
            total={total}
            playing={playing}
            speed={speed}
            onIndex={(i) => {
              setPlaying(false);
              setIndex(Math.max(0, Math.min(i, total - 1)));
            }}
            onPlay={(p) => {
              if (p && clamped >= total - 1) setIndex(0);
              setPlaying(p);
            }}
            onSpeed={setSpeed}
          />
          {(input || /\bScanner\b|System\.in/.test(code)) && <InputPanel value={input} onChange={setInput} step={step} />}
          <Explanation step={step} parseError={result.parseError} />
          <Console output={step?.output ?? ''} />
        </div>

        {step ? (
          <MemoryFlow step={step} prev={prev} layoutKey={exampleId} runKey={result} />
        ) : (
          <div className="memory memory-empty">
            <p className="empty">Fix the error in the code to see memory.</p>
          </div>
        )}
      </main>

      <footer className="legend">
        <span><span className="region-tag region-tag-stack">stack</span> method frames with local variables</span>
        <span><span className="region-tag region-tag-heap">heap</span> objects, arrays and Strings</span>
        <span><span className="region-tag region-tag-static">static</span> class (static) fields</span>
        <span><span className="val val-prim">25</span> primitive: the value is stored right there</span>
        <span><span className="val val-ref"><span className="ref-dot static" /></span> reference: an address that points to a heap object</span>
        <span><span className="swatch garbage" /> unreachable (garbage), removed on the next step</span>
        <span className="keys">Keys: ← → step · Space play · Home/End</span>
      </footer>
    </div>
  );
}
