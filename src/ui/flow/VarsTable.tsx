import { useUpdateNodeInternals } from '@xyflow/react';
import { useEffect } from 'react';
import type { Value, Var } from '../../runtime/types';
import { ValueView } from '../ValueView';

/** Rows of `type name value`, with a handle on every reference value. */
export function VarsTable({ vars, changed, handle }: { vars: Var[]; changed: string[]; handle: (name: string) => string }) {
  return (
    <table className="vars">
      <tbody>
        {vars.map((v) => (
          <tr key={v.name} className={changed.includes(v.name) ? 'flash' : ''}>
            <td className="var-type">{v.type}</td>
            <td className="var-name">{v.name}</td>
            <td className="var-val">
              <ValueView value={v.value} handleId={handle(v.name)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * React Flow measures handle positions when a node mounts or resizes. A slot
 * changing from null to a reference adds a handle without resizing, so tell
 * React Flow to re-measure whenever the set of reference slots changes.
 */
export function useHandleRefresh(nodeId: string, slots: { key: string; value: Value }[]) {
  const update = useUpdateNodeInternals();
  const key = slots
    .filter((s) => s.value.kind === 'ref' && s.value.addr !== null)
    .map((s) => s.key)
    .join(',');
  useEffect(() => update(nodeId), [key, nodeId, update]);
}
