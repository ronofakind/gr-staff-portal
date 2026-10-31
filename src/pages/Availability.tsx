import { useEffect, useState } from 'react';
import { supabase, type Staff } from '../lib/supabase';
import { TabBar } from '../components/TabBar';
import { todayIso } from './Home';
import { FromPicker, ampm15 } from '../components/TimeWheel';
import { SwipeSheet } from '../components/SwipeSheet';
import { AskCards, useAsks, ampm } from '../components/AskCards';
export { ampm };

type Week = { dow: number; status: 'yes' | 'from' | 'no'; from_time: string | null };
type Off = { id: string; from_date: string; to_date: string; reason: string | null };

const D = (iso: string) => new Date(iso + 'T12:00:00');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SHORT = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Staff: answer availability asks, set the usual week, add days off. */
export function Availability({ me, preview = false }: { me: Staff; preview?: boolean }) {
  const { asks, reload: reloadAsks } = useAsks(me.id);
  const [selDow, setSelDow] = useState<number>(() => (new Date().getDay() + 6) % 7);
  const [week, setWeek] = useState<Record<number, Week>>({});
  const [saved, setSaved] = useState<Record<number, Week>>({});
  const [savingWk, setSavingWk] = useState(false);
  const [off, setOff] = useState<Off[]>([]);
  const [wkSheet, setWkSheet] = useState<number | null>(null); const [wkChoice, setWkChoice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nOff, setNOff] = useState({ from: '', to: '', reason: '' });
  const [err, setErr] = useState('');
  const today = todayIso();

  const load = () => Promise.all([
    supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', me.id),
    supabase.from('days_off').select('id,from_date,to_date,reason').eq('staff_id', me.id).gte('to_date', today).order('from_date'),
  ]).then(([w, o]) => {
    const wk = Object.fromEntries(((w.data ?? []) as Week[]).map((x) => [x.dow, x])); setWeek(wk); setSaved(wk);
    setOff((o.data ?? []) as Off[]);
  });
  useEffect(() => { load(); }, [me.id]);

  const setDay = (dow: number, status: Week['status'], from_time: string | null = null) => setWeek({ ...week, [dow]: { dow, status: status === 'from' ? 'yes' : status, from_time } });
  const wkText = (w?: Week) => (w && w.status !== 'no' ? (w.from_time ? `from ${ampm15(w.from_time.slice(0, 5))}` : 'any time') : '');
  const changed = DAYS.map((_, d) => d).filter((d) => week[d] && (week[d].status !== saved[d]?.status || (week[d].from_time ?? '').slice(0, 5) !== (saved[d]?.from_time ?? '').slice(0, 5)));
  const saveWeek = async () => {
    if (preview || !changed.length) return;
    setSavingWk(true); setErr('');
    const { error } = await supabase.from('staff_weekly').upsert(changed.map((d) => ({ staff_id: me.id, dow: d, status: week[d].status === 'from' ? 'yes' : week[d].status, from_time: week[d].status === 'no' ? null : week[d].from_time })));
    setSavingWk(false);
    if (error) setErr(error.message); else setSaved(week);
  };
  const addOff = async () => {
    if (preview || !nOff.from) return;
    setErr('');
    const { error } = await supabase.from('days_off').insert({ staff_id: me.id, from_date: nOff.from, to_date: nOff.to || nOff.from, reason: nOff.reason.trim() || null });
    if (error) { setErr(error.message.includes('booked') ? "You're booked on one of these days. Talk to Ronnie." : error.message); return; }
    setAdding(false); setNOff({ from: '', to: '', reason: '' }); load();
  };
  const delOff = async (id: string) => { if (preview) return; await supabase.from('days_off').delete().eq('id', id); load(); };

  const waiting = (asks ?? []).filter((a) => a.status === 'asked');
  const freeDays = DAYS.filter((_, d) => week[d] && week[d].status !== 'no').length;
  const comingOff = off.filter((o) => o.to_date >= today).length;
  const selW = week[selDow];
  const short = (iso: string) => D(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');

  return (
    <main className="page v2">
      <div style={{ padding: '18px 6px 0' }}>
        <div className="kicker">Availability</div>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05 }}>Are you available?</div>
      </div>
      <div className="sumbar">
        <div className={waiting.length ? 'red' : ''}><b>{waiting.length}</b><span>date{waiting.length === 1 ? '' : 's'} waiting</span></div>
        <div><b>{freeDays}</b><span>usual days free</span></div>
        <div><b>{comingOff}</b><span>day{comingOff === 1 ? '' : 's'} off coming</span></div>
      </div>
      {err && <p className="error">{err}</p>}

      <AskCards asks={asks} week={saved} preview={preview} onAnswered={reloadAsks} />

      <div className="sec-head"><span className="serif">My usual week</span><span className="muted sm">tap a day to change</span></div>
      <section className="month wk-strip">
        <div className="grid">
          {DAYS.map((name, dow) => {
            const w = week[dow]; const free = w && w.status !== 'no';
            return <button key={dow} className={'mcell' + (free ? ' ok' : ' usualno') + (dow === selDow ? ' sel' : '')} aria-label={name} onClick={() => setSelDow(dow)}>
              <span className="n">{SHORT[dow]}</span><span className="wk-sub">{free ? (w.from_time ? ampm15(w.from_time.slice(0, 5)).replace(':00', '').replace(' ', '') : 'Any') : '—'}</span></button>;
          })}
        </div>
        <div className="wk-detail">
          <div className="grow"><small>{DAYS[selDow].toUpperCase()}S</small><b className="serif">{selW && selW.status !== 'no' ? (selW.from_time ? `Free from ${ampm15(selW.from_time.slice(0, 5))}` : 'Free · any time') : 'Not free'}</b></div>
          {selW && selW.status !== 'no' ? (
            <>
              <button className="days-off-btn" onClick={() => { setWkSheet(selDow); setWkChoice(selW.from_time ? selW.from_time.slice(0, 5) : 'any'); }}>Change</button>
              <button className="days-off-btn soft" onClick={() => setDay(selDow, 'no')}>Not free</button>
            </>
          ) : (
            <button className="days-off-btn ok" onClick={() => { setWkSheet(selDow); setWkChoice(null); }}>I’m free</button>
          )}
        </div>
      </section>
      <p className="muted sm" style={{ margin: '-6px 6px 0' }}>Set this once. Ronnie only asks you for days you’re usually free.</p>

      <div className="sec-head"><span className="serif">Days off</span><button className="days-off-btn" onClick={() => setAdding(true)}>+ Add dates</button></div>
      <section className="stack" style={{ gap: 8 }}>
        {off.map((o) => (
          <div key={o.id} className="dayoff-card">
            <div className="grow"><small>DAY OFF · {(o.from_date === o.to_date ? short(o.from_date) : `${short(o.from_date)} – ${short(o.to_date)}`).toUpperCase()}</small><div className="serif">{o.reason || 'Day off'}</div></div>
            <button className="link-btn" style={{ color: 'var(--accent)' }} onClick={() => delOff(o.id)}>Remove</button>
          </div>
        ))}
        {!off.length && <div className="card muted sm">No days off added.</div>}
        <p className="muted sm" style={{ margin: '2px 6px' }}>Days off win over your usual week. You can also add them from the Schedule calendar.</p>
      </section>
      <div style={{ height: changed.length ? 160 : 90 }} />
      {changed.length > 0 && (
        <div className="save-bar">
          <div className="grow"><b>{changed.length} unsaved change{changed.length > 1 ? 's' : ''}</b><span>{changed.map((d) => `${DAYS[d]}${week[d].status === 'no' ? ' · no' : ' ' + wkText(week[d])}`).join(' · ')}</span></div>
          <button className="undo" onClick={() => setWeek(saved)}>Undo</button>
          <button className="save" disabled={savingWk} onClick={saveWeek}>{savingWk ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}

      {wkSheet !== null && (
        <>
          <div className="scrim" onClick={() => setWkSheet(null)} />
          <div className="sheet swipe" role="dialog" aria-label="From what time, usually?">
            <button className="sheet-x" aria-label="Close" onClick={() => setWkSheet(null)}>✕</button>
            <div><div className="kicker">{DAYS[wkSheet].toUpperCase()}S · <span style={{ color: 'var(--ok)' }}>YES ✓</span></div>
              <div className="serif" style={{ fontSize: 26 }}>From what time, usually?</div></div>
            <FromPicker choice={wkChoice} setChoice={setWkChoice} />
            <button className="big-btn dark" disabled={!wkChoice} style={{ justifyContent: 'center' }} onClick={() => { setDay(wkSheet, 'yes', wkChoice === 'any' ? null : wkChoice); setWkSheet(null); }}>
              {!wkChoice ? 'Pick a time or Any time' : `Done · ${DAYS[wkSheet]}s ${wkChoice === 'any' ? 'any time' : 'from ' + ampm15(wkChoice)}`}</button>
          </div>
        </>
      )}

      {adding && (
        <>
          <div className="scrim" onClick={() => setAdding(false)} />
          <SwipeSheet onClose={() => setAdding(false)} label="Add days off">
            <div className="serif" style={{ fontSize: 24 }}>Add days off</div>
            <div className="times-box">
              <label>From<input type="date" min={today} value={nOff.from} onChange={(e) => setNOff({ ...nOff, from: e.target.value })} /></label>
              <label>Until<input type="date" min={nOff.from || today} value={nOff.to} onChange={(e) => setNOff({ ...nOff, to: e.target.value })} /></label>
              <label>Reason<input placeholder="Optional" value={nOff.reason} onChange={(e) => setNOff({ ...nOff, reason: e.target.value })} /></label>
            </div>
            {err && <p className="error">{err}</p>}
            <button className="big-btn dark" disabled={!nOff.from} onClick={addOff}>Save days off</button>
          </SwipeSheet>
        </>
      )}
      <TabBar badge={waiting.length} />
    </main>
  );
}
