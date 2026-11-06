import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Nov 6 · person sheet v2 · our own time wheel: hour · :00/:15/:30/:45 · AM/PM (the phone's wheel shows every minute).
 *  value / onChange use "HH:MM" (24 h), like QuarterTime. `start` = the time the wheel opens on when empty. */
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINS = [0, 15, 30, 45];
const ROW = 40;
const parse = (v: string) => { const [h, m] = v.split(':').map(Number); return Number.isNaN(h) ? null : { h12: ((h + 11) % 12) + 1, m: Math.round((m || 0) / 15) * 15 % 60, pm: h >= 12 }; };
export const fmtHm = (v: string) => { const p = v ? parse(v) : null; return p ? `${p.h12}:${String(p.m).padStart(2, '0')} ${p.pm ? 'PM' : 'AM'}` : ''; };
/** "HH:MM" rounded to the nearest quarter */
export const roundQ = (v: string) => { const [h, m] = v.split(':').map(Number); const t = (h * 60 + Math.round(m / 15) * 15) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

function Col({ items, idx, onIdx, label }: { items: string[]; idx: number; onIdx: (i: number) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null); const t = useRef<number>();
  useEffect(() => { if (ref.current) ref.current.scrollTop = idx * ROW; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="wt-col" ref={ref} role="listbox" aria-label={label} tabIndex={0}
      onScroll={(e) => { const el = e.currentTarget; window.clearTimeout(t.current); t.current = window.setTimeout(() => onIdx(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)))), 60); }}
      onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1))); onIdx(n); ref.current?.scrollTo({ top: n * ROW, behavior: 'smooth' }); } }}>
      <div className="wt-pad" />
      {items.map((x, i) => <div key={i} role="option" aria-selected={i === idx} className={'wt-item' + (i === idx ? ' on' : '')} onClick={() => { onIdx(i); ref.current?.scrollTo({ top: i * ROW, behavior: 'smooth' }); }}>{x}</div>)}
      <div className="wt-pad" />
    </div>
  );
}

export function WheelTime({ value, onChange, label, tone, start, empty = '— : —' }: { value: string; onChange: (v: string) => void; label: string; tone: 'start' | 'end'; start?: string; empty?: string }) {
  const [open, setOpen] = useState(false);
  const p = parse(value || start || '17:00') ?? { h12: 5, m: 0, pm: true };
  const [hi, setHi] = useState(HOURS.indexOf(p.h12)); const [mi, setMi] = useState(MINS.indexOf(p.m)); const [ap, setAp] = useState(p.pm ? 1 : 0);
  const show = () => { const q = parse(value || start || '17:00') ?? { h12: 5, m: 0, pm: true }; setHi(HOURS.indexOf(q.h12)); setMi(Math.max(0, MINS.indexOf(q.m))); setAp(q.pm ? 1 : 0); setOpen(true); };
  const done = () => { const H = (HOURS[hi] % 12) + (ap ? 12 : 0); onChange(`${String(H).padStart(2, '0')}:${String(MINS[mi]).padStart(2, '0')}`); setOpen(false); };
  return (
    <>
      <button type="button" className={'wt-val' + (value ? '' : ' empty')} aria-label={`${label}${value ? ' · ' + fmtHm(value) : ''} · change`} onClick={(e) => { e.stopPropagation(); show(); }}>{value ? fmtHm(value) : empty}</button>
      {open && createPortal(
        <div className="wt-scrim" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div className={'wt-sheet ' + tone} role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
            <div className="wt-top"><button type="button" onClick={() => setOpen(false)}>Cancel</button><b>{label}</b><button type="button" className="wt-done" onClick={done}>Done</button></div>
            <div className="wt-wheels">
              <i className="wt-band" aria-hidden="true" />
              <Col label="Hour" items={HOURS.map(String)} idx={hi} onIdx={setHi} />
              <Col label="Minutes" items={MINS.map((m) => ':' + String(m).padStart(2, '0'))} idx={mi} onIdx={setMi} />
              <Col label="AM or PM" items={['AM', 'PM']} idx={ap} onIdx={setAp} />
            </div>
          </div>
        </div>, document.body
      )}
    </>
  );
}
