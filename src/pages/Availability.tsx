import { useEffect, useState } from 'react';
import { supabase, type Staff } from '../lib/supabase';
import { TabBar } from '../components/TabBar';
import { todayIso } from './Home';
import { FromPicker, ampm15 } from '../components/TimeWheel';

type Ask = { id: string; for_date: string; status: 'asked' | 'yes' | 'no' | 'maybe'; from_time: string | null; note: string | null;
  avail_asks: { label: string; approx_start: string | null; reply_by: string | null } | null };
type Week = { dow: number; status: 'yes' | 'from' | 'no'; from_time: string | null };
type Off = { id: string; from_date: string; to_date: string; reason: string | null };

const D = (iso: string) => new Date(iso + 'T12:00:00');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const ampm = (t: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number); const hh = h % 12 || 12;
  return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Staff: answer availability asks, set the usual week, add days off. */
export function Availability({ me, preview = false }: { me: Staff; preview?: boolean }) {
  const [asks, setAsks] = useState<Ask[] | null>(null);
  const [week, setWeek] = useState<Record<number, Week>>({});
  const [saved, setSaved] = useState<Record<number, Week>>({});
  const [savingWk, setSavingWk] = useState(false);
  const [off, setOff] = useState<Off[]>([]);
  const [pick, setPick] = useState<Ask | null>(null);
  const [choice, setChoice] = useState<string | null>(null); const [note, setNote] = useState('');
  const [wkSheet, setWkSheet] = useState<number | null>(null); const [wkChoice, setWkChoice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [nOff, setNOff] = useState({ from: '', to: '', reason: '' });
  const [err, setErr] = useState('');
  const today = todayIso();

  const load = () => Promise.all([
    supabase.from('availability').select('id,for_date,status,from_time,note,avail_asks(label,approx_start,reply_by)')
      .eq('staff_id', me.id).not('ask_id', 'is', null).gte('for_date', today).order('for_date'),
    supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', me.id),
    supabase.from('days_off').select('id,from_date,to_date,reason').eq('staff_id', me.id).gte('to_date', today).order('from_date'),
  ]).then(([a, w, o]) => {
    setAsks((a.data ?? []) as unknown as Ask[]);
    const wk = Object.fromEntries(((w.data ?? []) as Week[]).map((x) => [x.dow, x])); setWeek(wk); setSaved(wk);
    setOff((o.data ?? []) as Off[]);
  });
  useEffect(() => { load(); }, [me.id]);

  const answer = async (a: Ask, status: 'yes' | 'no', f: string | null = null, n: string | null = null) => {
    if (preview) return;
    setErr('');
    const { error } = await supabase.rpc('answer_availability', { p_id: a.id, p_status: status, p_from: f, p_note: n });
    if (error) setErr(error.message); setPick(null); load();
  };
  const setDay = (dow: number, status: Week['status'], from_time: string | null = null) => setWeek({ ...week, [dow]: { dow, status: status === 'from' ? 'yes' : status, from_time } });
  const dowOf = (iso: string) => (D(iso).getDay() + 6) % 7;
  const usualFor = (iso: string) => { const w = saved[dowOf(iso)]; return w && w.status !== 'no' && w.from_time ? w.from_time.slice(0, 5) : null; };
  const openAsk = (a: Ask) => { setPick(a); setNote(a.note ?? ''); setChoice(a.status === 'yes' ? (a.from_time ? a.from_time.slice(0, 5) : 'any') : usualFor(a.for_date)); };
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
  const replyBy = waiting.map((a) => a.avail_asks?.reply_by).filter(Boolean).sort()[0];
  const range = (a: Ask) => (a.from_time ? `from ${ampm15(a.from_time.slice(0, 5))}` : 'any time');
  const short = (iso: string) => D(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');

  return (
    <main className="page v2">
      <div style={{ padding: '18px 6px 0' }}>
        <div className="kicker">Availability</div>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05 }}>Are you available?</div>
        <div className="muted sm" style={{ marginTop: 4 }}>
          {waiting.length ? `${waiting.length} date${waiting.length > 1 ? 's' : ''} waiting for your answer${replyBy ? ` · reply by ${D(replyBy).toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '')}` : ''}` : 'Nothing waiting right now.'}
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      {asks === null ? <div className="loading" style={{ minHeight: 160 }} /> : asks.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          {asks.map((a) => (
            <div key={a.id} className={'av-row' + (a.status === 'asked' ? ' waiting' : '')}>
              <div className="d"><small>{D(a.for_date).toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '').toUpperCase()}</small><b>{D(a.for_date).getDate()}</b></div>
              <div className="grow" style={{ minWidth: 0 }}>
                <b>{a.avail_asks?.label ?? 'Event'}</b>
                <span>{a.avail_asks?.approx_start ? `Around ${ampm(a.avail_asks.approx_start)} start` : D(a.for_date).toLocaleDateString('en-CA', { month: 'long' })}</span>
              </div>
              <div className="av-btns">
                <button className={a.status === 'yes' ? 'yes on' : 'yes'} onClick={() => openAsk(a)}>
                  {a.status === 'yes' ? <>✓ Available<small>{range(a)}</small></> : 'Available'}</button>
                <button className={a.status === 'no' ? 'no on' : 'no'} onClick={() => answer(a, 'no')}>{a.status === 'no' ? '✕ Can’t' : 'Can’t'}</button>
              </div>
            </div>
          ))}
          {asks.length > 0 && <p className="muted sm" style={{ margin: '2px 6px' }}>Saying yes doesn’t book you yet. You’ll get the shift to confirm once you’re scheduled.</p>}
        </section>
      )}

      <div className="sec-head"><span className="serif">My usual week</span></div>
      <p className="muted sm" style={{ margin: '-6px 6px 0' }}>Set this once. Ronnie only asks you for days you’re usually free. Change it any time.</p>
      <section className="card" style={{ padding: '4px 14px' }}>
        {DAYS.map((name, dow) => {
          const w = week[dow];
          return (
            <div key={dow} className="wk-row">
              <div className="grow"><b>{name}</b>{w && w.status !== 'no' && <div><button className="wk-from" onClick={() => { setWkSheet(dow); setWkChoice(w.from_time ? w.from_time.slice(0, 5) : 'any'); }}>{wkText(w)} ✎</button></div>}</div>
              <div className="wk-seg">
                <button className={w && w.status !== 'no' ? 'on yes' : ''} onClick={() => { setWkSheet(dow); setWkChoice(w && w.status !== 'no' ? (w.from_time ? w.from_time.slice(0, 5) : 'any') : null); }}>Yes</button>
                <button className={w?.status === 'no' ? 'on no' : ''} onClick={() => setDay(dow, 'no')}>No</button>
              </div>
            </div>
          );
        })}
      </section>

      <div className="sec-head"><span className="serif">Days off</span><button className="link-btn" onClick={() => setAdding(true)}>+ Add dates</button></div>
      <section className="stack" style={{ gap: 8 }}>
        {off.map((o) => (
          <div key={o.id} className="off-row">
            <div className="grow"><b>{o.from_date === o.to_date ? short(o.from_date) : `${short(o.from_date)} – ${short(o.to_date)}`}</b>{o.reason && <span>{o.reason}</span>}</div>
            <button aria-label="Remove" onClick={() => delOff(o.id)}>✕</button>
          </div>
        ))}
        {!off.length && <div className="muted sm" style={{ padding: '0 6px' }}>No days off added.</div>}
        <p className="muted sm" style={{ margin: '2px 6px' }}>Days off win over your usual week. You can’t add a day you’re already booked on. Talk to Ronnie.</p>
      </section>
      <div style={{ height: changed.length ? 160 : 90 }} />
      {changed.length > 0 && (
        <div className="save-bar">
          <div className="grow"><b>{changed.length} unsaved change{changed.length > 1 ? 's' : ''}</b><span>{changed.map((d) => `${DAYS[d]}${week[d].status === 'no' ? ' · no' : ' ' + wkText(week[d])}`).join(' · ')}</span></div>
          <button className="undo" onClick={() => setWeek(saved)}>Undo</button>
          <button className="save" disabled={savingWk} onClick={saveWeek}>{savingWk ? 'Saving…' : 'Save changes'}</button>
        </div>
      )}

      {pick && (
        <>
          <div className="scrim" onClick={() => setPick(null)} />
          <div className="sheet swipe" role="dialog" aria-label="From what time?">
            <div className="grab" />
            <div><div className="kicker">{D(pick.for_date).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()} · <span style={{ color: 'var(--ok)' }}>AVAILABLE ✓</span></div>
              <div className="serif" style={{ fontSize: 26 }}>From what time?</div></div>
            {usualFor(pick.for_date) && <span className="usual-tag">From your usual week · {D(pick.for_date).toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '')} {ampm15(usualFor(pick.for_date))}</span>}
            <FromPicker choice={choice} setChoice={setChoice} rest={usualFor(pick.for_date) ?? pick.avail_asks?.approx_start?.slice(0, 5) ?? '17:00'} />
            <div className="kicker">Note (optional)</div>
            <input className="av-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note for G&R (optional)" />
            <button className="big-btn dark" disabled={!choice} style={{ justifyContent: 'center' }} onClick={() => answer(pick, 'yes', choice === 'any' ? null : choice, note)}>
              {!choice ? 'Pick a time or Any time' : `Confirm · available ${choice === 'any' ? 'any time' : 'from ' + ampm15(choice)}`}</button>
          </div>
        </>
      )}

      {wkSheet !== null && (
        <>
          <div className="scrim" onClick={() => setWkSheet(null)} />
          <div className="sheet swipe" role="dialog" aria-label="From what time, usually?">
            <div className="grab" />
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
          <div className="sheet" role="dialog" aria-label="Add days off">
            <div className="grab" />
            <div className="serif" style={{ fontSize: 24 }}>Add days off</div>
            <div className="times-box">
              <label>From<input type="date" min={today} value={nOff.from} onChange={(e) => setNOff({ ...nOff, from: e.target.value })} /></label>
              <label>Until<input type="date" min={nOff.from || today} value={nOff.to} onChange={(e) => setNOff({ ...nOff, to: e.target.value })} /></label>
              <label>Reason<input placeholder="Optional" value={nOff.reason} onChange={(e) => setNOff({ ...nOff, reason: e.target.value })} /></label>
            </div>
            {err && <p className="error">{err}</p>}
            <button className="big-btn dark" disabled={!nOff.from} onClick={addOff}>Save days off</button>
          </div>
        </>
      )}
      <TabBar badge={waiting.length} />
    </main>
  );
}
