import type { HeapObjectSnap, Step } from '../runtime/types';
import { formatAddr } from '../runtime/values';
import { ValueView, sameValue } from './ValueView';

export function HeapPanel({ step, prev }: { step: Step; prev?: Step }) {
  const prevHeap = new Map(prev?.heap.map((o) => [o.addr, o]));
  const pooled = step.heap.filter((o) => o.kind === 'string' && o.interned);
  const others = step.heap.filter((o) => !(o.kind === 'string' && o.interned));

  return (
    <section className="panel heap-panel">
      <h2>
        Heap <span className="hint">objects, arrays and Strings created with new</span>
      </h2>
      {others.length === 0 && <p className="empty">No objects yet.</p>}
      <div className="heap-objects">
        {others.map((o) => (
          <HeapCard key={o.addr} obj={o} before={prevHeap.get(o.addr)} isNew={!!prev && !prevHeap.has(o.addr)} />
        ))}
      </div>
      {pooled.length > 0 && (
        <div className="pool">
          <h3>
            String pool <span className="hint">one shared copy of each literal</span>
          </h3>
          <div className="heap-objects">
            {pooled.map((o) => (
              <HeapCard key={o.addr} obj={o} before={prevHeap.get(o.addr)} isNew={!!prev && !prevHeap.has(o.addr)} />
            ))}
          </div>
        </div>
      )}
      {step.collected.length > 0 && (
        <p className="collected">Garbage collected: {step.collected.map(formatAddr).join(', ')}</p>
      )}
    </section>
  );
}

function HeapCard({ obj, before, isNew }: { obj: HeapObjectSnap; before?: HeapObjectSnap; isNew: boolean }) {
  const cls = `heap-card heap-${obj.kind} ${obj.garbage ? 'garbage' : ''} ${isNew ? 'flash' : ''}`;
  const head = (title: string) => (
    <div className="heap-head">
      <span className="heap-title">{title}</span>
      <span className="heap-addr">{formatAddr(obj.addr)}</span>
      {obj.garbage && <span className="badge">garbage</span>}
    </div>
  );

  if (obj.kind === 'string') {
    return (
      <div className={cls} data-addr={obj.addr}>
        {head('String')}
        <div className="string-body">"{obj.value}"</div>
      </div>
    );
  }

  if (obj.kind === 'array') {
    const old = before?.kind === 'array' ? before.elements : undefined;
    return (
      <div className={cls} data-addr={obj.addr}>
        {head(`${obj.elemType}[${obj.elements.length}]`)}
        {obj.elements.length === 0 ? (
          <div className="empty small">empty array</div>
        ) : (
          <div className="array-cells">
            {obj.elements.map((v, i) => (
              <div key={i} className={`array-cell ${old && !sameValue(old[i], v) ? 'flash' : ''}`}>
                <div className="array-idx">{i}</div>
                <div className="array-val">
                  <ValueView value={v} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const oldFields = before?.kind === 'object' ? before.fields : undefined;
  return (
    <div className={cls} data-addr={obj.addr}>
      {head(obj.className)}
      {obj.fields.length === 0 ? (
        <div className="empty small">no fields</div>
      ) : (
        <table className="vars">
          <tbody>
            {obj.fields.map((f) => {
              const old = oldFields?.find((x) => x.name === f.name);
              return (
                <tr key={f.name} className={oldFields && !sameValue(old?.value, f.value) ? 'flash' : ''}>
                  <td className="var-type">{f.type}</td>
                  <td className="var-name">{f.name}</td>
                  <td className="var-val">
                    <ValueView value={f.value} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
