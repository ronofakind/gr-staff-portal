import { useRef, useState, type ReactNode } from 'react';

/** Bottom sheet that closes with the ✕, when dragged down from its top (grab bar or header), or when its content is scrolled to the top. */
export function SwipeSheet({ onClose, label, children, x = true }: { onClose: () => void; label: string; children: ReactNode; x?: boolean }) {
  const ref = useRef<HTMLDivElement>(null); const start = useRef<number | null>(null); const [dy, setDy] = useState(0);
  return (
    <div ref={ref} className="sheet swipe" role="dialog" aria-label={label} style={dy ? { transform: `translateY(${dy}px)`, transition: 'none' } : undefined}
      onTouchStart={(e) => { const el = ref.current!; const t = e.target as HTMLElement; if (el.scrollTop <= 0 && !t.closest('input,select,textarea,.qtime')) start.current = e.touches[0].clientY; }}
      onTouchMove={(e) => { if (start.current == null) return; const d = e.touches[0].clientY - start.current; setDy(d > 0 ? d : 0); }}
      onTouchEnd={() => { if (start.current != null && dy > 90) onClose(); start.current = null; setDy(0); }}>
      {x && <button className="sheet-x" aria-label="Close" onClick={onClose}>✕</button>}
      <div className="grab" /><div className="grab-hint">Swipe down to close</div>
      {children}
    </div>
  );
}
