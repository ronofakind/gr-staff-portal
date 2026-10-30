import { useEffect, useRef } from 'react';

const ROW = 44;
/** 15-minute steps, 8:00 AM → 1:00 AM. */
export const WHEEL_TIMES = (() => { const out: string[] = []; for (let m = 8 * 60; m <= 25 * 60; m += 15) { const h = Math.floor(m / 60) % 24; out.push(`${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); } return out; })();
export const ampm15 = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const snap = (t: string) => { const [h, m] = t.split(':').map(Number); const q = Math.round(m / 15) * 15; return `${String((h + Math.floor(q / 60)) % 24).padStart(2, '0')}:${String(q % 60).padStart(2, '0')}`; };

/** Scroll wheel of times. value null = nothing picked yet (wheel rests at `rest`, dimmed). */
export function TimeWheel({ value, onChange, rest = '17:00' }: { value: string | null; onChange: (t: string) => void; rest?: string }) {
  const box = useRef<HTMLDivElement>(null); const timer = useRef<number>(); const quiet = useRef(true);
  const idxOf = (t: string) => Math.max(0, WHEEL_TIMES.indexOf(snap(t)));
  useEffect(() => {
    const el = box.current; if (!el) return;
    quiet.current = true; el.scrollTop = idxOf(value ?? rest) * ROW;
    const t = window.setTimeout(() => { quiet.current = false; }, 150); return () => window.clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    if (quiet.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { const el = box.current; if (!el) return; const i = Math.min(WHEEL_TIMES.length - 1, Math.max(0, Math.round(el.scrollTop / ROW))); if (WHEEL_TIMES[i] !== value) onChange(WHEEL_TIMES[i]); }, 90);
  };
  const pick = (i: number) => { const el = box.current; if (el) el.scrollTo({ top: i * ROW, behavior: 'smooth' }); onChange(WHEEL_TIMES[i]); };
  const cur = value ? idxOf(value) : -1;
  return (
    <div className={'twheel' + (value ? ' set' : '')}>
      <div className="twheel-band" />
      <div className="twheel-scroll" ref={box} onScroll={onScroll} role="listbox" aria-label="From what time">
        <div style={{ height: ROW * 2 }} />
        {WHEEL_TIMES.map((t, i) => <button key={t} type="button" role="option" aria-selected={i === cur} className={i === cur ? 'on' : ''} onClick={() => pick(i)}>{ampm15(t)}</button>)}
        <div style={{ height: ROW * 2 }} />
      </div>
    </div>
  );
}

/** "Any time" tile + wheel. choice: 'any' | 'HH:MM' | null. */
export function FromPicker({ choice, setChoice, rest }: { choice: string | null; setChoice: (c: string) => void; rest?: string }) {
  return (
    <div className="from-pick">
      <button type="button" className={'any-tile' + (choice === 'any' ? ' on' : '')} onClick={() => setChoice('any')}><b>Any time</b><small>whole event</small></button>
      <TimeWheel value={choice && choice !== 'any' ? choice : null} onChange={setChoice} rest={rest} />
    </div>
  );
}
