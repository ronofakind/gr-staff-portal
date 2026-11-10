import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FromPicker, TimeWheel, ampm15 } from './TimeWheel';
import { FixedSheet } from './SwipeSheet';

export type WeekDay = { dow: number; status: 'yes' | 'from' | 'no'; from_time: string | null; until_time?: string | null };
/** push 64 · "Day only · 8:00 AM–3:00 PM" / "from 5:00 PM" / "any time" */
export const weekText = (w: WeekDay) => w.until_time ? `Day only · ${w.from_time ? ampm15(w.from_time.slice(0, 5)) : 'any time'}–${ampm15(w.until_time.slice(0, 5))}` : w.from_time ? `from ${ampm15(w.from_time.slice(0, 5))}` : 'any time';
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The person's usual week (staff_weekly). Every change saves at once. */
export function useUsualWeek(staffId: string, preview = false) {
  const [week, setWeek] = useState<Record<number, WeekDay>>({});
  const [loaded, setLoaded] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('staff_weekly').select('dow,status,from_time,until_time').eq('staff_id', staffId).then(({ data }) => {
      setWeek(Object.fromEntries(((data ?? []) as WeekDay[]).map((x) => [x.dow, x]))); setLoaded(true);
    });
  }, [staffId]);
  const setDay = async (dow: number, status: WeekDay['status'], from_time: string | null = null, until_time: string | null = null) => {
    const row = { dow, status: (status === 'from' ? 'yes' : status) as WeekDay['status'], from_time: status === 'no' ? null : from_time, until_time: status === 'no' ? null : until_time };
    setWeek((w) => ({ ...w, [dow]: row }));
    if (preview) return;
    const { error } = await supabase.from('staff_weekly').upsert({ staff_id: staffId, ...row });
    setErr(error ? error.message : '');
  };
  return { week, setDay, loaded, err };
}

/** "My usual week" switch rows (commit 36f5be6): flip a day on → "From what time can you usually start?" sheet. */
export function UsualWeekList({ week, setDay, plural = false }: { week: Record<number, WeekDay>; setDay: (dow: number, status: WeekDay['status'], from?: string | null, until?: string | null) => void; plural?: boolean }) {
  const [wkSheet, setWkSheet] = useState<number | null>(null); const [wkChoice, setWkChoice] = useState<string | null>(null);
  const [dayOnly, setDayOnly] = useState(false); const [dFrom, setDFrom] = useState<string | null>(null); const [dUntil, setDUntil] = useState<string | null>(null);
  const openSheet = (dow: number, w?: WeekDay) => { setWkSheet(dow); setWkChoice(w && w.status !== 'no' && !w.until_time ? (w.from_time ? w.from_time.slice(0, 5) : 'any') : null); setDayOnly(!!w?.until_time); setDFrom(w?.until_time ? (w.from_time?.slice(0, 5) ?? '08:00') : '08:00'); setDUntil(w?.until_time ? w.until_time.slice(0, 5) : '15:00'); };
  const dayOk = !!dFrom && !!dUntil && dUntil > dFrom;
  return (
    <>
      <section className="card wk-list">
        {DAYS.map((name, dow) => {
          const w = week[dow]; const on = !!w && w.status !== 'no'; const pending = !on && wkSheet === dow;
          return (
            <div key={dow} className="wk-row2">
              <div className="grow"><b>{plural ? name + 's' : name}</b><span className={on ? 'on' : ''}>{pending ? 'Pick a time to turn this on…' : on ? (w.until_time ? `I can work · ${weekText(w).replace('Day only · ', 'day only, ')}` : w.from_time ? `I can work · from ${ampm15(w.from_time.slice(0, 5))}` : 'I can work · any time') : 'I don’t work this day'}</span></div>
              {on && <button className={'wk-time' + (w.until_time ? ' day' : '')} onClick={() => openSheet(dow, w)}>{w.until_time ? 'Day only' : w.from_time ? ampm15(w.from_time.slice(0, 5)) : 'Any time'} <i>▾</i></button>}
              <button className={'switch' + (on ? ' on' : pending ? ' on pending' : '')} role="switch" aria-checked={on} aria-label={`${on ? 'Free' : 'Not free'} on ${name}s`}
                onClick={() => { if (on) setDay(dow, 'no'); else openSheet(dow); }}><span /></button>
            </div>
          );
        })}
      </section>
      {wkSheet !== null && (
        <>
          <div className="scrim" onClick={() => setWkSheet(null)} />
          <FixedSheet onClose={() => setWkSheet(null)} label="When can you usually work?" closeLabel={null}>{/* no swipe-to-close: scrolling the time wheel kept closing it (Ronnie, Nov 4) */}
            <div><div className="kicker">{DAYS[wkSheet].toUpperCase()}S · <span style={{ color: 'var(--ok)' }}>YES ✓</span></div>
              <div className="serif" style={{ fontSize: 26 }}>{dayOnly ? 'Day only · from… until…' : 'From what time can you usually start?'}</div></div>
            {/* push 64 · two choices: when you can start (evenings) or Day only (from… until…) */}
            <div className="wk-mode" role="tablist">
              <button type="button" role="tab" aria-selected={!dayOnly} className={!dayOnly ? 'on' : ''} onClick={() => setDayOnly(false)}>Start time</button>
              <button type="button" role="tab" aria-selected={dayOnly} className={dayOnly ? 'on' : ''} onClick={() => setDayOnly(true)}>Day only</button>
            </div>
            {!dayOnly ? <>
              {/* Any time = one tap (saves + closes); Save = the time on the wheel (Ronnie, Nov 2). */}
              <FromPicker choice={wkChoice} setChoice={setWkChoice} onAny={() => { setDay(wkSheet, 'yes', null); setWkSheet(null); }} />
              <div className="wk-save-row">
                <button type="button" className="big-btn wk-any" onClick={() => { setDay(wkSheet, 'yes', null); setWkSheet(null); }}>Any time</button>
                <button type="button" className="big-btn dark" disabled={!wkChoice || wkChoice === 'any'} onClick={() => { if (!wkChoice || wkChoice === 'any') return; setDay(wkSheet, 'yes', wkChoice); setWkSheet(null); }}>Save</button>
              </div>
            </> : <>
              <p className="muted sm" style={{ margin: 0 }}>Day only = you can’t do evenings that day (school, family, shabbat…). You’ll only be offered events that end by then.</p>
              <div className="wk-two">
                <div><small>From</small><TimeWheel value={dFrom} onChange={setDFrom} rest="08:00" /></div>
                <div><small>Until</small><TimeWheel value={dUntil} onChange={setDUntil} rest="15:00" /></div>
              </div>
              <button type="button" className="big-btn dark" disabled={!dayOk} onClick={() => { if (!dayOk) return; setDay(wkSheet, 'yes', dFrom, dUntil); setWkSheet(null); }}>{dayOk ? `Save · day only ${ampm15(dFrom)}–${ampm15(dUntil)}` : 'Until must be after From'}</button>
            </>}
          </FixedSheet>
        </>
      )}
    </>
  );
}
