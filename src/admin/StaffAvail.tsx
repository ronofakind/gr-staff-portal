// Nov 11 · Staff profile → Availability tab (board StaffAvailV1). One person on one screen:
// usual week (their own times stay visible when Ronnie changes a day), the month coloured day by day, and the open answers in words.
// Booked day: venue name when it's the only event that day, "Booked" when there are several (Ronnie, 7:45 PM).
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isoDay, dLabel, type AStaff } from './api';

type W = { status: string; from_time: string | null; until_time?: string | null; set_by_admin?: boolean; own_status?: string | null; own_from?: string | null; own_until?: string | null };
type Off = { from_date: string; to_date: string; added_by_admin: boolean };
type A = { for_date: string; status: string; from_time: string | null; until_time: string | null; knows_by: string | null; answer_by: string | null; answered_at: string | null; released_at: string | null; event_id: string | null; event_start: string | null };
type Sh = { id: string; planned_start: string; status: string; pool_hold?: boolean; events: { event_date: string; title: string; department: string } };

const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DOWL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const t12 = (t: string | null | undefined) => { if (!t) return ''; const h = Number(t.slice(0, 2)), m = t.slice(3, 5); return `${h % 12 || 12}${m !== '00' ? ':' + m : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const dowOf = (iso: string) => (new Date(iso + 'T12:00:00').getDay() + 6) % 7;
const wText = (st: string | null | undefined, from: string | null | undefined, until: string | null | undefined) =>
  !st ? 'Not set' : st === 'no' ? 'No' : until ? `${from ? t12(from) : 'Any'}–${t12(until)}` : from ? `From ${t12(from)}` : 'Any time';

export function AvailTab({ s, week, off, onWeek }: { s: AStaff; week: Record<number, W>; off: Off[]; onWeek: (w: Record<number, W>) => void }) {
  const today = isoDay(new Date());
  const [ym, setYm] = useState(today.slice(0, 7));
  const [av, setAv] = useState<A[]>([]); const [sh, setSh] = useState<Sh[]>([]); const [nEv, setNEv] = useState<Record<string, number>>({});
  const [offAll, setOffAll] = useState<Off[]>(off);
  const [edit, setEdit] = useState<number | null>(null); const [draft, setDraft] = useState<{ st: string; from: string; until: string }>({ st: 'yes', from: '', until: '' });
  const [err, setErr] = useState('');
  const first = ym + '-01'; const last = isoDay(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
  const dept = s.department === 'bar' ? 'bar' : 'floor';
  useEffect(() => {
    supabase.from('availability').select('for_date,status,from_time,until_time,knows_by,answer_by,answered_at,released_at,event_id,event_start').eq('staff_id', s.id).gte('for_date', first < today ? first : today).order('for_date')
      .then(({ data }) => setAv((data ?? []) as A[]));
    supabase.from('shifts').select('id,planned_start,status,pool_hold,events!inner(event_date,title,department)').eq('staff_id', s.id).neq('status', 'declined').gte('events.event_date', first).lte('events.event_date', last)
      .then(({ data }) => setSh((data ?? []) as unknown as Sh[]));
    supabase.from('events').select('event_date,department').gte('event_date', first).lte('event_date', last)
      .then(({ data }) => { const m: Record<string, number> = {}; for (const e of (data ?? []) as { event_date: string; department: string }[]) if ((e.department === 'bar') === (dept === 'bar')) m[e.event_date] = (m[e.event_date] ?? 0) + 1; setNEv(m); });
    supabase.from('days_off').select('from_date,to_date,added_by_admin').eq('staff_id', s.id).gte('to_date', first).lte('from_date', last)
      .then(({ data }) => setOffAll((data ?? []) as Off[]));
  }, [s.id, ym]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayInfo = (d: string) => {
    const shift = sh.find((x) => x.events.event_date === d);
    if (shift) return { k: 'booked', l: (nEv[d] ?? 1) > 1 ? 'Booked' : shift.events.title };
    if (offAll.some((o) => o.from_date <= d && o.to_date >= d)) return { k: 'off', l: 'Time off' };
    const a = av.find((x) => x.for_date === d && !x.released_at);
    if (a) {
      if (a.status === 'asked') return { k: 'asked', l: 'Asked' };
      if (a.status === 'yes') return a.from_time || a.until_time ? { k: 'eve', l: a.until_time ? `${a.from_time ? t12(a.from_time) : ''}–${t12(a.until_time)}` : `from ${t12(a.from_time)}` } : { k: 'yes', l: 'Yes' };
      if (a.status === 'maybe') return { k: 'maybe', l: 'Maybe' };
      if (a.status === 'no') return { k: 'no', l: 'No' };
    }
    if (week[dowOf(d)]?.status === 'no') return { k: 'usualno', l: '' };
    return { k: '', l: '' };
  };
  const cells = useMemo(() => { const out: (string | null)[] = []; const lead = dowOf(first); for (let i = 0; i < lead; i++) out.push(null);
    for (let d = new Date(first + 'T12:00:00'); isoDay(d) <= last; d.setDate(d.getDate() + 1)) out.push(isoDay(d)); return out; }, [first, last]);
  const counts = cells.filter(Boolean).reduce((m, d) => { const k = dayInfo(d!).k; m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>);
  const open = av.filter((a) => a.for_date >= today && !a.released_at && !sh.some((x) => x.events.event_date === a.for_date) && a.status !== 'no');
  const shiftMonth = (n: number) => { const d = new Date(first + 'T12:00:00'); d.setMonth(d.getMonth() + n); setYm(isoDay(d).slice(0, 7)); };

  const startEdit = (i: number) => { const w = week[i]; setEdit(i); setErr(''); setDraft({ st: w?.status === 'no' ? 'no' : w ? 'yes' : 'yes', from: w?.from_time?.slice(0, 5) ?? '', until: w?.until_time?.slice(0, 5) ?? '' }); };
  const save = async (clear = false) => {
    if (edit == null) return; const w = week[edit]; setErr('');
    const keep = w && !w.set_by_admin ? { own_status: w.status, own_from: w.from_time, own_until: w.until_time ?? null } : {};
    if (clear) { const { error } = await supabase.from('staff_weekly').delete().eq('staff_id', s.id).eq('dow', edit); if (error) return setErr(error.message);
      const n = { ...week }; delete n[edit]; onWeek(n); setEdit(null); return; }
    const row = { staff_id: s.id, dow: edit, status: draft.st === 'no' ? 'no' : draft.from ? 'from' : 'yes', from_time: draft.st === 'no' ? null : draft.from || null, until_time: draft.st === 'no' ? null : draft.until || null, set_by_admin: true, ...keep };
    const { error } = await supabase.from('staff_weekly').upsert(row, { onConflict: 'staff_id,dow' });
    if (error) return setErr(error.message);
    onWeek({ ...week, [edit]: { ...w, ...row } }); setEdit(null);
  };

  return (
    <div className="sa-wrap">
      <div className="pcard">
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">USUAL WEEK</span><span className="muted sm">their times as they set them · tap a day to change</span></div>
        <div className="sa-week">{DOW.map((d, i) => { const w = week[i]; return (
          <button key={d} className={'sa-wd ' + (w ? (w.status === 'no' ? 'no' : 'ok') : 'unset') + (edit === i ? ' on' : '')} onClick={() => startEdit(i)}>
            <small>{d}</small><b>{wText(w?.status, w?.from_time, w?.until_time)}</b>
            {w?.set_by_admin && <i>set by you{w.own_status ? ` · they said ${wText(w.own_status, w.own_from, w.own_until).toLowerCase()}` : ''}</i>}
          </button>); })}</div>
        {edit != null && <div className="sa-edit">
          <b>{DOWL[edit]}s</b>
          <div className="seg3">{(['yes', 'no'] as const).map((v) => <button key={v} className={draft.st === v ? 'on' : ''} onClick={() => setDraft({ ...draft, st: v })}>{v === 'yes' ? 'Free' : 'Not free'}</button>)}</div>
          {draft.st === 'yes' && <><label>from <input type="time" step={900} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
            <label>until <input type="time" step={900} value={draft.until} onChange={(e) => setDraft({ ...draft, until: e.target.value })} /></label><small className="muted">empty = any time</small></>}
          <button className="abtn sm dark" onClick={() => save()}>Save</button>{week[edit] && <button className="lnk muted sm" onClick={() => save(true)}>Clear</button>}<button className="lnk muted sm" onClick={() => setEdit(null)}>Cancel</button>
          {err && <span className="error sm">{err}</span>}
        </div>}
      </div>
      <div className="pcard">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="serif sa-mon"><button className="lnk" onClick={() => shiftMonth(-1)}>‹</button> {dLabel(first, { month: 'long', year: 'numeric' })} <button className="lnk" onClick={() => shiftMonth(1)}>›</button></span>
          <small className="muted">{counts.booked ?? 0} booked · {(counts.yes ?? 0) + (counts.eve ?? 0)} yes · {counts.asked ?? 0} waiting</small></div>
        <div className="sa-cal">{DOW.map((d) => <small key={d}>{d}</small>)}
          {cells.map((d, i) => { if (!d) return <span key={'x' + i} />; const x = dayInfo(d); return (
            <div key={d} className={'sa-day k-' + (x.k || 'none') + (d < today ? ' past' : '') + (d === today ? ' today' : '')} title={x.l}><b>{Number(d.slice(8))}</b><small>{x.l}</small></div>); })}</div>
        <div className="sa-legend">{[['booked', 'Booked'], ['yes', 'Yes'], ['eve', 'Yes from a time'], ['maybe', 'Maybe'], ['asked', 'Asked · no answer'], ['no', 'No'], ['off', 'Time off'], ['usualno', 'Usually no']].map(([k, l]) => <span key={k}><i className={'k-' + k} />{l}</span>)}</div>
      </div>
      <div className="pcard">
        <span className="kick">COMING UP · NOT BOOKED</span>
        {!open.length && <span className="muted sm">Nothing open.</span>}
        {open.map((a) => <div key={a.for_date} className="sa-open"><b>{dLabel(a.for_date)}</b><span className="grow">
          <b className={'k-t-' + a.status}>{a.status === 'asked' ? 'Asked · no answer yet' : a.status === 'yes' ? `Yes${a.from_time ? ` · from ${t12(a.from_time)}` : ''}${a.until_time ? ` until ${t12(a.until_time)}` : ''}` : `Maybe${a.knows_by ? ` · knows by ${dLabel(a.knows_by, { month: 'short', day: 'numeric' })}` : ''}`}</b>
          <small className="muted">{a.status === 'asked' && a.answer_by ? `answer by ${new Date(a.answer_by).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })}` : a.answered_at ? `answered ${dLabel(a.answered_at.slice(0, 10), { month: 'short', day: 'numeric' })}` : ''}{a.event_id ? ' · asked for one shift' : ''}</small></span></div>)}
      </div>
    </div>
  );
}
