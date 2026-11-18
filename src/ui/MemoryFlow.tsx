import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Step } from '../runtime/types';
import { FloatingEdge } from './flow/FloatingEdge';
import { FrameNode, StaticsNode } from './flow/FrameNode';
import { HeapNode, LabelNode } from './flow/HeapNode';
import { buildGraph, type MemoryEdge, type MemoryNode, type Pinned, type Sizes } from './memoryGraph';

const nodeTypes: NodeTypes = { frame: FrameNode, statics: StaticsNode, heap: HeapNode, label: LabelNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

const storageKey = (layoutKey: string) => `jmv-layout:${layoutKey}`;

function loadPinned(layoutKey: string): Pinned {
  try {
    return JSON.parse(localStorage.getItem(storageKey(layoutKey)) ?? '{}') as Pinned;
  } catch {
    return {};
  }
}

function savePinned(layoutKey: string, pinned: Pinned) {
  try {
    if (Object.keys(pinned).length) localStorage.setItem(storageKey(layoutKey), JSON.stringify(pinned));
    else localStorage.removeItem(storageKey(layoutKey));
  } catch {
    // Storage can be unavailable (private mode); positions then last for this session only.
  }
}

interface Props {
  step: Step;
  prev?: Step;
  /** Dragged positions are remembered per layout key (the example id). */
  layoutKey: string;
  /** Changes whenever the program is re-run; the view is re-fitted then. */
  runKey: unknown;
}

export function MemoryFlow(props: Props) {
  return (
    <ReactFlowProvider>
      <MemoryCanvas {...props} />
    </ReactFlowProvider>
  );
}

function MemoryCanvas({ step, prev, layoutKey, runKey }: Props) {
  const [pinned, setPinned] = useState<Pinned>(() => loadPinned(layoutKey));
  const [nodes, setNodes, onNodesChange] = useNodesState<MemoryNode>([]);
  const [edges, setEdges] = useState<MemoryEdge[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const { fitView } = useReactFlow();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const pendingFit = useRef(true);

  useEffect(() => {
    setPinned(loadPinned(layoutKey));
  }, [layoutKey]);

  useEffect(() => {
    pendingFit.current = true;
  }, [runKey, layoutKey]);

  // Card sizes only change when their content changes (not while dragging),
  // so re-running the layout on size changes settles after one pass.
  const sizesKey = nodes.map((n) => `${n.id}:${Math.round(n.measured?.width ?? 0)}x${Math.round(n.measured?.height ?? 0)}`).join('|');

  useEffect(() => {
    const sizes: Sizes = {};
    for (const n of nodesRef.current) {
      if (n.measured?.width && n.measured?.height) sizes[n.id] = { width: n.measured.width, height: n.measured.height };
    }
    const graph = buildGraph(step, prev, pinned, sizes);
    setNodes((old) => {
      const byId = new Map(old.map((n) => [n.id, n]));
      // Keep React Flow's measurements, otherwise unchanged cards would stay hidden until re-measured.
      return graph.nodes.map((n) => {
        const o = byId.get(n.id);
        return o?.measured ? ({ ...n, measured: o.measured } as MemoryNode) : n;
      });
    });
    setEdges(graph.edges);
  }, [step, prev, pinned, sizesKey, setNodes]);

  // Fit the view once the cards of a new run have been measured.
  useEffect(() => {
    if (!pendingFit.current || nodes.length === 0 || nodes.some((n) => !n.measured?.width)) return;
    pendingFit.current = false;
    void fitView({ padding: 0.12, maxZoom: 1 });
  }, [sizesKey, nodes, fitView]);

  const onNodeDragStop = useCallback(
    (_: unknown, node: MemoryNode) => {
      setPinned((p) => {
        const next = { ...p, [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) } };
        savePinned(layoutKey, next);
        return next;
      });
    },
    [layoutKey],
  );

  const resetLayout = () => {
    savePinned(layoutKey, {});
    setPinned({});
    pendingFit.current = true;
  };

  // Hovering a card highlights the arrows touching it and dims the rest.
  const shownEdges = useMemo(
    () =>
      hovered
        ? edges.map((e) => ({ ...e, className: e.source === hovered || e.target === hovered ? 'hl' : 'dim' }))
        : edges,
    [edges, hovered],
  );

  return (
    <div className="memory">
      <ArrowMarkers />
      <ReactFlow
        nodes={nodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeMouseEnter={(_, n) => setHovered(n.id)}
        onNodeMouseLeave={() => setHovered(null)}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        colorMode="system"
        minZoom={0.2}
        maxZoom={2}
      >
        <Background gap={20} size={1.2} />
        <Controls showInteractive={false} />
        <Panel position="top-right" className="flow-panel">
          <button onClick={resetLayout} title="Forget dragged positions and arrange the cards automatically">
            Auto layout
          </button>
          <button onClick={() => void fitView({ padding: 0.12, maxZoom: 1, duration: 300 })}>Fit</button>
        </Panel>
        <Panel position="bottom-center" className="flow-hint">
          Drag a card by its header · scroll to zoom · drag the background to pan
        </Panel>
      </ReactFlow>
    </div>
  );
}

/** Arrowheads for the three edge styles; edges reference them by id. */
function ArrowMarkers() {
  return (
    <svg className="arrow-defs" aria-hidden="true">
      <defs>
        {(['normal', 'current', 'faded'] as const).map((kind) => (
          <marker key={kind} id={`jmv-arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={`arrowhead arrowhead-${kind}`} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
