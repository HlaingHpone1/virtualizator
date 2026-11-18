import type { Step } from '../runtime/types';

export function Explanation({ step, parseError }: { step?: Step; parseError?: { message: string; line: number } }) {
  if (parseError) {
    return (
      <div className="explanation error" role="status">
        <strong>Syntax error on line {parseError.line}:</strong> {parseError.message}
      </div>
    );
  }
  if (!step) return null;
  return (
    <div className={`explanation ${step.error ? 'error' : ''}`} role="status">
      <span className="line-tag">line {step.line}</span>
      {step.event}
    </div>
  );
}

export function Console({ output }: { output: string }) {
  return (
    <div className="console">
      <div className="console-head">Console output</div>
      <pre>{output || <span className="empty">(nothing printed yet)</span>}</pre>
    </div>
  );
}

/**
 * Program input (System.in): editable text, plus a view of what Scanner has
 * already consumed at the current step (dimmed) and where it will read next.
 */
export function InputPanel({ value, onChange, step }: { value: string; onChange: (v: string) => void; step?: Step }) {
  const pos = step?.input.text === value ? step.input.pos : 0;
  return (
    <div className="console input-panel">
      <div className="console-head">
        Program input (System.in) <span className="hint">one value per line, read by Scanner</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder="Type the input your program will read, e.g. 42"
        aria-label="Program input"
      />
      {value && (
        <div className="input-progress" aria-label="Input read so far">
          <span className="consumed">{value.slice(0, pos)}</span>
          <span className="read-cursor" title="Scanner reads from here next" />
          <span>{value.slice(pos)}</span>
        </div>
      )}
    </div>
  );
}
