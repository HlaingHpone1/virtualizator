import type { Node, NodeProps } from '@xyflow/react';
import type { FrameSnap } from '../../runtime/types';
import { handleIds, type FrameNodeData, type StaticsNodeData } from '../memoryGraph';
import { VarsTable, useHandleRefresh } from './VarsTable';

const REGION_INFO = {
  stack: 'Lives on the STACK: a frame for one method call, holding its local variables and parameters.',
  heap: 'Lives on the HEAP: created with new (or a literal) and reached through references.',
  static: 'Lives in the STATIC area (method area): one copy per class, shared by every object.',
};

/** Coloured tag that says which memory region a card belongs to, wherever it is dragged. */
export function RegionTag({ region }: { region: keyof typeof REGION_INFO }) {
  return (
    <span className={`region-tag region-tag-${region}`} title={REGION_INFO[region]}>
      {region}
    </span>
  );
}

function frameTitle(f: FrameSnap): string {
  if (f.method === '<init>') return `${f.className} constructor`;
  if (f.method === '<clinit>') return `${f.className} static init`;
  return `${f.className}.${f.method}()`;
}

export function FrameNode({ id, data }: NodeProps<Node<FrameNodeData, 'frame'>>) {
  const { frame: f, isTop, isNew, changed } = data;
  useHandleRefresh(id, f.locals.map((v) => ({ key: v.name, value: v.value })));
  return (
    <div className={`frame region-stack ${isTop ? 'frame-top' : ''} ${f.native ? 'frame-native' : ''} ${isNew ? 'flash' : ''}`}>
      <div className="frame-head node-drag" title="Drag to move">
        <RegionTag region="stack" />
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
        <VarsTable vars={f.locals} changed={changed} handle={handleIds.local} />
      )}
    </div>
  );
}

export function StaticsNode({ id, data }: NodeProps<Node<StaticsNodeData, 'statics'>>) {
  const { statics: s, changed } = data;
  useHandleRefresh(id, s.fields.map((v) => ({ key: v.name, value: v.value })));
  return (
    <div className="frame static-box region-static">
      <div className="frame-head node-drag" title="Static fields are stored with the class and shared by all objects. Drag to move.">
        <RegionTag region="static" />
        <span className="frame-name">class {s.className}</span>
        <span className="frame-line">static fields</span>
      </div>
      <VarsTable vars={s.fields} changed={changed} handle={handleIds.static} />
    </div>
  );
}
