/** Time picker in 15-minute steps only (iPhone ignores `step` on <input type="time">). Value is "HH:MM" (24 h) or ''. */
export function QuarterTime({ value, onChange, label, className = '' }: { value: string; onChange: (v: string) => void; label?: string; className?: string }) {
  const [h24, m] = value ? value.split(':').map(Number) : [NaN, NaN];
  const has = !Number.isNaN(h24);
  const pm = has ? h24 >= 12 : true;
  const h12 = has ? ((h24 + 11) % 12) + 1 : NaN;
  const mq = has ? Math.round(m / 15) * 15 % 60 : NaN;
  const emit = (hh: number, mm: number, isPm: boolean) => {
    const H = (hh % 12) + (isPm ? 12 : 0);
    onChange(`${String(H).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  };
  return (
    <span className={'qtime ' + className} aria-label={label} role="group" onClick={(e) => e.stopPropagation()}>
      <select aria-label="Hour" value={has ? h12 : ''} onChange={(e) => emit(Number(e.target.value), has ? mq : 0, pm)}>
        {!has && <option value="">--</option>}
        {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span className="colon">:</span>
      <select aria-label="Minutes" value={has ? mq : ''} onChange={(e) => emit(has ? h12 : 12, Number(e.target.value), pm)}>
        {!has && <option value="">--</option>}
        {[0, 15, 30, 45].map((x) => <option key={x} value={x}>{String(x).padStart(2, '0')}</option>)}
      </select>
      <select aria-label="AM or PM" value={pm ? 'PM' : 'AM'} onChange={(e) => emit(has ? h12 : 12, has ? mq : 0, e.target.value === 'PM')}>
        <option>AM</option><option>PM</option>
      </select>
    </span>
  );
}
