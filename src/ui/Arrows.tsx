import { useLayoutEffect, useState, type RefObject } from 'react';

interface Arrow {
  key: string;
  d: string;
  faded: boolean;
}

/**
 * Draws an SVG arrow from every reference dot ([data-ref]) to the heap card
 * with the matching address ([data-addr]), positioned over `container`.
 */
export function Arrows({ container, version }: { container: RefObject<HTMLElement>; version: unknown }) {
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const c = container.current;
    if (!c) return;

    const compute = () => {
      const cr = c.getBoundingClientRect();
      const out: Arrow[] = [];
      c.querySelectorAll<HTMLElement>('[data-ref]').forEach((src, i) => {
        const tgt = c.querySelector<HTMLElement>(`[data-addr="${src.dataset.ref}"]`);
        if (!tgt) return;
        const s = src.getBoundingClientRect();
        const t = tgt.getBoundingClientRect();
        const x1 = s.left + s.width / 2 - cr.left;
        const y1 = s.top + s.height / 2 - cr.top;
        const ty = t.top - cr.top + Math.min(16, t.height / 2);
        // Enter the target from whichever side faces the source.
        const fromLeft = t.left - cr.left >= x1 - 8 || t.right - cr.left > x1 + 40;
        const x2 = fromLeft ? t.left - cr.left - 2 : t.right - cr.left + 2;
        const dir = fromLeft ? 1 : -1;
        const dx = Math.max(36, Math.abs(x2 - x1) / 2);
        const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dir * dx} ${ty}, ${x2} ${ty}`;
        const faded = !!src.closest('.garbage') || tgt.classList.contains('garbage');
        out.push({ key: `${i}-${src.dataset.ref}`, d, faded });
      });
      setArrows(out);
      setSize({ w: c.scrollWidth, h: c.scrollHeight });
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(c);
    c.querySelectorAll('.panel').forEach((p) => ro.observe(p));
    window.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [container, version]);

  return (
    <svg className="arrows" width={size.w} height={size.h} aria-hidden="true">
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrowhead" />
        </marker>
        <marker id="arrowhead-faded" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="arrowhead faded" />
        </marker>
      </defs>
      {arrows.map((a) => (
        <path key={a.key} d={a.d} className={`arrow ${a.faded ? 'faded' : ''}`} markerEnd={`url(#${a.faded ? 'arrowhead-faded' : 'arrowhead'})`} />
      ))}
    </svg>
  );
}
