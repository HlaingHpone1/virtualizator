import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { formatAddr } from '../../runtime/values';
import { handleIds, type HeapNodeData, type LabelNodeData } from '../memoryGraph';
import { ValueView } from '../ValueView';
import { RegionTag } from './FrameNode';
import { VarsTable, useHandleRefresh } from './VarsTable';

export function HeapNode({ id, data }: NodeProps<Node<HeapNodeData, 'heap'>>) {
  const { obj, isNew, changed } = data;
  const pooled = obj.kind === 'string' && obj.interned;
  useHandleRefresh(
    id,
    obj.kind === 'object'
      ? obj.fields.map((f) => ({ key: f.name, value: f.value }))
      : obj.kind === 'array'
        ? obj.elements.map((v, i) => ({ key: String(i), value: v }))
        : [],
  );

  const title = obj.kind === 'string' ? 'String' : obj.kind === 'array' ? `${obj.elemType}[${obj.elements.length}]` : obj.className;
  const cls = `heap-card region-heap heap-${obj.kind} ${pooled ? 'pooled' : ''} ${obj.garbage ? 'garbage' : ''} ${isNew ? 'flash' : ''}`;

  return (
    <div className={cls}>
      {/* Arrows end here; FloatingEdge picks the visible side of the card. */}
      <Handle type="target" position={Position.Left} className="target-handle" isConnectable={false} />
      <div className="heap-head node-drag" title="Drag to move">
        <RegionTag region="heap" />
        <span className="heap-title">{title}</span>
        {pooled && <span className="badge pool-badge" title="String literals are stored once in the String pool and shared">pool</span>}
        <span className="heap-addr">{formatAddr(obj.addr)}</span>
        {obj.garbage && <span className="badge">garbage</span>}
      </div>

      {obj.kind === 'string' && <div className="string-body">"{obj.value}"</div>}

      {obj.kind === 'array' &&
        (obj.elements.length === 0 ? (
          <div className="empty small">empty array</div>
        ) : (
          <div className="array-cells">
            {obj.elements.map((v, i) => (
              <div key={i} className={`array-cell ${changed.includes(String(i)) ? 'flash' : ''}`}>
                <div className="array-idx">{i}</div>
                <div className="array-val">
                  <ValueView value={v} handleId={handleIds.elem(i)} />
                </div>
              </div>
            ))}
          </div>
        ))}

      {obj.kind === 'object' &&
        (obj.fields.length === 0 ? (
          <div className="empty small">{obj.className === 'InputStream' ? 'System.in: delivers the program input' : 'no fields'}</div>
        ) : (
          <VarsTable vars={obj.fields} changed={changed} handle={handleIds.field} />
        ))}
    </div>
  );
}

export function LabelNode({ data }: NodeProps<Node<LabelNodeData, 'label'>>) {
  return (
    <div className="flow-label">
      {data.label} <span className="hint">{data.hint}</span>
    </div>
  );
}
