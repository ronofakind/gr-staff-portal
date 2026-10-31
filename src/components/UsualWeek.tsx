import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FromPicker, ampm15 } from './TimeWheel';
import { SwipeSheet } from './SwipeSheet';

export type WeekDay = { dow: number; status: 'yes' | 'from' | 'no'; from_time: string | null };
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The person's usual week (staff_weekly). Every change saves at once. */
export function useUsualWeek(staffId: string, preview = false) {
  const [week, setWeek] = useState<Record<number, WeekDay>>({});
  const [loaded, setLoaded] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', staffId).then(({ data }) => {
      setWeek(Object.fromEntries(((data ?? []) as WeekDay[]).map((x) => [x.dow, x]))); setLoaded(true);
    });
  }, [staffId]);
  const setDay = async (dow: number, status: WeekDay['status'], from_time: string | null = null) => {
    const row = { dow, status: (status === 'from' ? 'yes' : status) as WeekDay['status'], from_time: status === 'no' ? null : from_time };
    setWeek((w) => ({ ...w, [dow]: row }));
    if (preview) return;
    const { error } = await supabase.from('staff_weekly').upsert({ staff_id: staffId, ...row });
    setErr(error ? error.message : '');
  };
  return { week, setDay, loaded, err };
}

/** "My usual week" switch rows (commit 36f5be6): flip a day on → "From what time can you usually start?" sheet. */
export function UsualWeekList({ week, setDay, plural = false }: { week: Record<number, WeekDay>; setDay: (dow: number, status: WeekDay['status'], from?: string | null) => void; plural?: boolean }) {
  const [wkSheet, setWkSheet] = useState<number | null>(null); const [wkChoice, setWkChoice] = useState<string | null>(null);
  return (
    <>
      <section className="card wk-list">
        {DAYS.map((name, dow) => {
          const w = week[dow]; const on = !!w && w.status !== 'no'; const pending = !on && wkSheet === dow;
          return (
            <div key={dow} className="wk-row2">
              <div className="grow"><b>{plural ? name + 's' : name}</b><span className={on ? 'on' : ''}>{pending ? 'Pick a time to turn this on…' : on ? (w.from_time ? `I can work · from ${ampm15(w.from_time.slice(0, 5))}` : 'I can work · any time') : 'I don’t work this day'}</span></div>
              {on && <button className="wk-time" onClick={() => { setWkSheet(dow); setWkChoice(w.from_time ? w.from_time.slice(0, 5) : 'any'); }}>{w.from_time ? ampm15(w.from_time.slice(0, 5)) : 'Any time'} <i>▾</i></button>}
              <button className={'switch' + (on ? ' on' : pending ? ' on pending' : '')} role="switch" aria-checked={on} aria-label={`${on ? 'Free' : 'Not free'} on ${name}s`}
                onClick={() => { if (on) setDay(dow, 'no'); else { setWkSheet(dow); setWkChoice(null); } }}><span /></button>
            </div>
          );
        })}
      </section>
      {wkSheet !== null && (
        <>
          <div className="scrim" onClick={() => setWkSheet(null)} />
          <SwipeSheet onClose={() => setWkSheet(null)} label="From what time can you usually start?">
            <div><div className="kicker">{DAYS[wkSheet].toUpperCase()}S · <span style={{ color: 'var(--ok)' }}>YES ✓</span></div>
              <div className="serif" style={{ fontSize: 26 }}>From what time can you usually start?</div></div>
            <FromPicker choice={wkChoice} setChoice={setWkChoice} />
            <button className="big-btn dark" disabled={!wkChoice} style={{ justifyContent: 'center' }} onClick={() => { setDay(wkSheet, 'yes', wkChoice === 'any' ? null : wkChoice); setWkSheet(null); }}>
              {!wkChoice ? 'Pick a time or Any time' : `Done · ${DAYS[wkSheet]}s ${wkChoice === 'any' ? 'any time' : 'from ' + ampm15(wkChoice)}`}</button>
          </SwipeSheet>
        </>
      )}
    </>
  );
}
