import type { Value } from '../runtime/types';
import { describeValue, formatAddr } from '../runtime/values';

/**
 * Renders what a slot actually contains. A primitive shows its value;
 * a reference shows a dot that an arrow is drawn from (data-ref).
 */
export function ValueView({ value }: { value: Value }) {
  if (value.kind === 'uninit') return <span className="val val-uninit" title="Not initialized yet">?</span>;
  if (value.kind === 'prim') {
    return (
      <span className={`val val-prim val-${value.type}`} title={`${value.type} value stored right here`}>
        {describeValue(value)}
      </span>
    );
  }
  if (value.addr === null) return <span className="val val-null" title="Reference to no object">null</span>;
  return (
    <span className="val val-ref" title={`Reference: holds the address ${formatAddr(value.addr)}`}>
      <span className="ref-addr">{formatAddr(value.addr)}</span>
      <span className="ref-dot" data-ref={value.addr} />
    </span>
  );
}

export function sameValue(a: Value | undefined, b: Value | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'prim' && b.kind === 'prim') return a.value === b.value && a.type === b.type;
  if (a.kind === 'ref' && b.kind === 'ref') return a.addr === b.addr;
  return true;
}
