import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FromPicker, ampm15 } from './TimeWheel';
import { SwipeSheet } from './SwipeSheet';
import { todayIso } from '../pages/Home';

export type Ask = { id: string; for_date: string; status: 'asked' | 'yes' | 'no' | 'maybe'; from_time: string | null; note: string | null;
  avail_asks: { label: string; approx_start: string | null; reply_by: string | null } | null };
type Week = { dow: number; status: 'yes' | 'from' | 'no'; from_time: string | null };

const D = (iso: string) => new Date(iso + 'T12:00:00');
export const ampm = (t: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number); const hh = h % 12 || 12;
  return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
};

/** Availability asks from G&R, answered right where they are shown (Home and the Availability page share this).
 *  `onlyWaiting`: Home shows only the unanswered ones, so a date answered anywhere leaves Home. */
export function useAsks(meId: string) {
  const [asks, setAsks] = useState<Ask[] | null>(null);
  const [week, setWeek] = useState<Record<number, Week>>({});
  const today = todayIso();
  const load = () => Promise.all([
    supabase.from('availability').select('id,for_date,status,from_time,note,avail_asks(label,approx_start,reply_by)')
      .eq('staff_id', meId).not('ask_id', 'is', null).gte('for_date', today).order('for_date'),
    supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', meId),
  ]).then(([a, w]) => {
    setAsks((a.data ?? []) as unknown as Ask[]);
    setWeek(Object.fromEntries(((w.data ?? []) as Week[]).map((x) => [x.dow, x])));
  });
  useEffect(() => { load(); }, [meId]);
  return { asks, week, reload: load };
}

export function AskCards({ asks, week, preview = false, onlyWaiting = false, onAnswered, header = true }:
  { asks: Ask[] | null; week: Record<number, Week>; preview?: boolean; onlyWaiting?: boolean; onAnswered: () => void; header?: boolean }) {
  const [pick, setPick] = useState<Ask | null>(null);
  const [choice, setChoice] = useState<string | null>(null); const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const list = (asks ?? []).filter((a) => !onlyWaiting || a.status === 'asked');
  const waiting = (asks ?? []).filter((a) => a.status === 'asked');
  const replyBy = waiting.map((a) => a.avail_asks?.reply_by).filter(Boolean).sort()[0];
  const dowOf = (iso: string) => (D(iso).getDay() + 6) % 7;
  const usualFor = (iso: string) => { const w = week[dowOf(iso)]; return w && w.status !== 'no' && w.from_time ? w.from_time.slice(0, 5) : null; };
  const openAsk = (a: Ask) => { setPick(a); setNote(a.note ?? ''); setChoice(a.status === 'yes' ? (a.from_time ? a.from_time.slice(0, 5) : 'any') : usualFor(a.for_date)); };
  const answer = async (a: Ask, status: 'yes' | 'no', f: string | null = null, n: string | null = null) => {
    if (preview) return;
    setErr('');
    const { error } = await supabase.rpc('answer_availability', { p_id: a.id, p_status: status, p_from: f, p_note: n });
    if (error) setErr(error.message); setPick(null); onAnswered();
  };
  const range = (a: Ask) => (a.from_time ? `from ${ampm15(a.from_time.slice(0, 5))}` : 'any time');
  if (asks === null || !list.length) return null;
  return (
    <>
      {header && <div className="sec-head"><span className="serif">{onlyWaiting ? 'Are you available?' : 'G&R is asking'}</span>
        <span className={'sm' + (waiting.length ? ' red-b' : ' muted')}>{waiting.length ? `${waiting.length} waiting${replyBy ? ` · reply by ${D(replyBy).toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '')}` : ''}` : 'all answered'}</span></div>}
      {err && <p className="error">{err}</p>}
      <section className="stack" style={{ gap: 10 }}>
        {list.map((a) => (
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
        <p className="muted sm" style={{ margin: '-2px 6px 0' }}>{onlyWaiting ? 'Answered dates leave this list. Change an answer any time in Availability.' : 'Saying yes doesn’t book you yet. You’ll get the shift to confirm once you’re scheduled.'}</p>
      </section>

      {pick && (
        <>
          <div className="scrim" onClick={() => setPick(null)} />
          <SwipeSheet onClose={() => setPick(null)} label="From what time?">
            <div><div className="kicker">{D(pick.for_date).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()} · <span style={{ color: 'var(--ok)' }}>AVAILABLE ✓</span></div>
              <div className="serif" style={{ fontSize: 26 }}>From what time?</div></div>
            {usualFor(pick.for_date) && <span className="usual-tag">From your usual week · {D(pick.for_date).toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '')} {ampm15(usualFor(pick.for_date))}</span>}
            <FromPicker choice={choice} setChoice={setChoice} rest={usualFor(pick.for_date) ?? pick.avail_asks?.approx_start?.slice(0, 5) ?? '17:00'} />
            <div className="kicker">Note (optional)</div>
            <input className="av-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note for G&R (optional)" />
            <button className="big-btn dark" disabled={!choice} style={{ justifyContent: 'center' }} onClick={() => answer(pick, 'yes', choice === 'any' ? null : choice, note)}>
              {!choice ? 'Pick a time or Any time' : `Confirm · available ${choice === 'any' ? 'any time' : 'from ' + ampm15(choice)}`}</button>
          </SwipeSheet>
        </>
      )}
    </>
  );
}
