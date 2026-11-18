import type { FrameSnap, StaticsSnap, Step } from '../runtime/types';
import { ValueView, sameValue } from './ValueView';

function frameTitle(f: FrameSnap): string {
  if (f.method === '<init>') return `${f.className} constructor`;
  if (f.method === '<clinit>') return `${f.className} static init`;
  return `${f.className}.${f.method}()`;
}

export function StackPanel({ step, prev }: { step: Step; prev?: Step }) {
  const frames = [...step.frames].reverse(); // top of stack first
  const prevFrames = new Map(prev?.frames.map((f) => [f.id, f]));

  return (
    <section className="panel stack-panel">
      <h2>
        Stack <span className="hint">one frame per method call · top = running now</span>
      </h2>
      {frames.length === 0 && <p className="empty">The stack is empty.</p>}
      <div className="frames">
        {frames.map((f, i) => {
          const before = prevFrames.get(f.id);
          return (
            <div key={f.id} className={`frame ${i === 0 ? 'frame-top' : ''} ${f.native ? 'frame-native' : ''} ${before ? '' : 'flash'}`}>
              <div className="frame-head">
                <span className="frame-name">{frameTitle(f)}</span>
                {f.native ? (
                  <span className="frame-line" title="Built-in method from the Java library">java library</span>
                ) : (
                  <span className="frame-line">line {f.line}</span>
                )}
              </div>
              {f.locals.length === 0 ? (
                <div className="empty small">no local variables</div>
              ) : (
                <table className="vars">
                  <tbody>
                    {f.locals.map((v) => {
                      const old = before?.locals.find((x) => x.name === v.name);
                      const changed = before && !sameValue(old?.value, v.value);
                      return (
                        <tr key={v.name} className={changed ? 'flash' : ''}>
                          <td className="var-type">{v.type}</td>
                          <td className="var-name">{v.name}</td>
                          <td className="var-val">
                            <ValueView value={v.value} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
      {step.statics.length > 0 && <StaticsView statics={step.statics} prev={prev?.statics} />}
    </section>
  );
}

function StaticsView({ statics, prev }: { statics: StaticsSnap[]; prev?: StaticsSnap[] }) {
  return (
    <div className="statics">
      <h3>
        Static fields <span className="hint">stored with the class, shared by all objects</span>
      </h3>
      {statics.map((s) => (
        <div key={s.className} className="frame static-box">
          <div className="frame-head">
            <span className="frame-name">class {s.className}</span>
          </div>
          <table className="vars">
            <tbody>
              {s.fields.map((v) => {
                const old = prev?.find((p) => p.className === s.className)?.fields.find((f) => f.name === v.name);
                return (
                  <tr key={v.name} className={prev && !sameValue(old?.value, v.value) ? 'flash' : ''}>
                    <td className="var-type">{v.type}</td>
                    <td className="var-name">{v.name}</td>
                    <td className="var-val">
                      <ValueView value={v.value} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
