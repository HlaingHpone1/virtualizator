import { Position, getBezierPath, useInternalNode, type Edge, type EdgeProps } from '@xyflow/react';
import type { EdgeData } from '../memoryGraph';

/** How far below a card's top edge side-entering arrows land (the header row). */
const HEADER_Y = 16;

/**
 * An arrow from a reference dot to whichever side of the target card faces
 * it, so arrows stay readable however the user drags the cards around.
 */
export function FloatingEdge({ target, sourceX, sourceY, sourcePosition, data }: EdgeProps<Edge<EdgeData, 'floating'>>) {
  const node = useInternalNode(target);
  const w = node?.measured.width;
  const h = node?.measured.height;
  if (!node || !w || !h) return null;

  const { x: left, y: top } = node.internals.positionAbsolute;
  const right = left + w;
  const bottom = top + h;

  let targetX: number;
  let targetY: number;
  let targetPosition: Position;
  if (sourceX < left - 12) {
    [targetX, targetY, targetPosition] = [left, top + Math.min(HEADER_Y, h / 2), Position.Left];
  } else if (sourceX > right + 12) {
    [targetX, targetY, targetPosition] = [right, top + Math.min(HEADER_Y, h / 2), Position.Right];
  } else if (sourceY < top) {
    [targetX, targetY, targetPosition] = [left + w / 2, top, Position.Top];
  } else {
    [targetX, targetY, targetPosition] = [left + w / 2, bottom, Position.Bottom];
  }

  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const kind = data?.faded ? 'faded' : data?.current ? 'current' : 'normal';
  return <path d={path} className={`jmv-edge jmv-edge-${kind}`} markerEnd={`url(#jmv-arrow-${kind})`} />;
}
