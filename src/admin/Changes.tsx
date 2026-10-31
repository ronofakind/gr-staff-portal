import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DeptTag } from './DeptTag';
import { eventsBetween, dLabel, tTime, roleName, type AEvent, type AShift } from './api';

/* Push 28 · admin side of changes after booking: last-minute cancel card (Today), "Find a replacement" links,
   and the time-change answer pop-up (Needs you → Answer ›). */

export type ChangeRow = {
  id: string; shift_id: string; kind: 'later' | 'leave_early'; new_time: string; old_time: string | null; note: string | null; created_at: string;
  shifts: { id: string; event_id: string; staff_id: string; planned_start: string; status: string; responded_at: string | null; position_code: string | null; leave_by: string | null;
    staff: { full_name: string } | null; events: { id: string; title: string; event_date: string; department: string; manager_id: string | null } | null } | null;
};
export const CHANGE_COLS = 'id,shift_id,kind,new_time,old_time,note,created_at,shifts!inner(id,event_id,staff_id,planned_start,status,responded_at,position_code,leave_by,staff:staff!shifts_staff_id_fkey(full_name),events(id,title,event_date,department,manager_id))';

const TZ = 'America/Toronto';
export const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const first = (n?: string | null) => (n ?? '?').split(' ')[0];
const isoDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const relDay = (d: string) => { const t = isoDay(new Date().toISOString()); const x = new Date(t + 'T12:00:00'); x.setDate(x.getDate() + 1);
  return d === t ? 'tonight' : d === x.toLocaleDateString('en-CA') ? 'tomorrow' : dLabel(d); };
export const hoursBefore = (at: string, start: string) => { const m = Math.round((new Date(start).getTime() - new Date(at).getTime()) / 60000);
  return m <= 0 ? 'after the start' : m < 60 ? `${m} min before` : m < 180 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) : ''} before` : `${Math.round(m / 60)} h before`; };
const diffTxt = (a: string, b: string) => { const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000); const h = Math.floor(Math.abs(m) / 60), mm = Math.abs(m) % 60; return `${h ? `${h} h` : ''}${h && mm ? ' ' : ''}${mm ? `${mm}${h ? '' : ' min'}` : ''}`; };

/** Bookings opened on that date with Ask more people for N spots; replace = the shift being replaced (the next person added there is saved as its replacement). */
export const replaceUrl = (e: { event_date: string; department: string }, o: { replace?: string | null; at?: string | null; spots?: number } = {}) => {
  const p = new URLSearchParams({ date: e.event_date, dept: e.department === 'bar' ? 'bar' : 'floor', view: 'board', ask: '1', spots: String(o.spots ?? 1) });
  if (o.replace) p.set('replace', o.replace); if (o.at) p.set('at', o.at);
  return `/admin/bookings?${p}`;
};

/** A staff self-cancel (attendance cancelled by the person, or already sent to the manager as no-show). */
export const isSelfCancel = (s: AShift) => !!s.cancel_self && (s.attendance === 'cancelled' || s.attendance === 'no_show');
/** Cancelled on the day of the event (Montreal) → Ronnie's red LAST-MINUTE CANCEL card. */
export const isEventDayCancel = (e: AEvent, s: AShift) => isSelfCancel(s) && !!s.cancelled_at && isoDay(s.cancelled_at) === e.event_date;
export const replacementOf = (e: AEvent, s: AShift) => e.shifts.find((x) => x.replacement_for === s.id && x.status !== 'declined' && !x.attendance);

/** 28c · LAST-MINUTE CANCEL · TONIGHT. "Send to <manager> · mark no-show" → manager list shows the person crossed out. */
export function LastMinute({ e, s, mgr, onSent }: { e: AEvent; s: AShift; mgr: string | null; onSent: () => void }) {
  const nav = useNavigate(); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const sent = !!s.cancel_sent_to_manager; const rep = replacementOf(e, s);
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_send_cancel_to_manager', { p_shift: s.id });
    setBusy(false); if (error) setErr(error.message); else onSent();
  };
  return (
    <div className="lm-card">
      <small>LAST-MINUTE CANCEL · {e.event_date === isoDay(new Date().toISOString()) ? 'TONIGHT' : relDay(e.event_date).toUpperCase()}</small>
      <b>{first(s.staff?.full_name)} cancelled · {e.title} {tTime(s.planned_start)}</b>
      <span>{s.cancel_reason ?? 'No reason given'}{s.cancel_note ? ` · “${s.cancel_note}”` : ''} · sent {tTime(s.cancelled_at ?? null)} · {hoursBefore(s.cancelled_at!, s.planned_start)}{s.cancel_late ? ' · had confirmed' : ''}</span>
      {err && <span className="lm-err">{err}</span>}
      <div className="lm-btns">
        {sent ? <span className="lm-done">✓ Sent to {first(mgr)} · marked no-show</span>
          : <button className="lm-b white" disabled={busy} onClick={send}>{busy ? 'Sending…' : `Send to ${first(mgr) === '?' ? 'the manager' : first(mgr)} · mark no-show`}</button>}
        {rep ? <span className="lm-done">✓ Replaced by {first(rep.staff?.full_name)} · {tTime(rep.planned_start)}</span>
          : <button className="lm-b" onClick={() => nav(replaceUrl(e, { replace: s.id, at: hmOf(s.planned_start) }))}>Find a replacement ›</button>}
      </div>
      {!sent && <i>{first(mgr) === '?' ? 'The manager' : first(mgr)} doesn’t see this yet. After you send, {first(s.staff?.full_name)} shows on the list as “CANCELLED · NO-SHOW”, so nobody waits.</i>}
    </div>
  );
}

type Opt = 'accept' | 'accept_fill' | 'keep' | 'replace';
/** 28d · Ronnie's answer to "My schedule changed". */
export function ChangeAnswer({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const nav = useNavigate();
  const [r, setR] = useState<ChangeRow | null | undefined>(undefined);
  const [ev, setEv] = useState<AEvent[] | null>(null); const [yes, setYes] = useState<number | null>(null); const [mgr, setMgr] = useState<string | null>(null);
  const [opt, setOpt] = useState<Opt>('accept'); const [tell, setTell] = useState(false); const [count, setCount] = useState(false);
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('shift_change_requests').select(CHANGE_COLS).eq('id', id).maybeSingle().then(async ({ data, error }) => {
      if (error || !data) { setR(null); return; }
      const row = data as unknown as ChangeRow; setR(row);
      const e = row.shifts?.events; if (!e) return;
      const [evs, av] = await Promise.all([eventsBetween(e.event_date, e.event_date), supabase.from('availability').select('staff_id').eq('for_date', e.event_date).eq('status', 'yes')]);
      setEv(evs);
      const booked = new Set(evs.flatMap((x) => x.shifts.filter((s) => s.status !== 'declined' && !s.attendance).map((s) => s.staff_id)));
      setYes(((av.data ?? []) as { staff_id: string }[]).filter((a) => !booked.has(a.staff_id)).length);
      if (e.manager_id) supabase.from('staff').select('full_name').eq('id', e.manager_id).maybeSingle().then(({ data: m }) => setMgr((m as { full_name: string } | null)?.full_name ?? null));
    });
  }, [id]);
  if (r === undefined) return null;
  if (r === null || !r.shifts?.events) return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card ca" onClick={(x) => x.stopPropagation()}><b>That request was answered or withdrawn.</b><button className="abtn" onClick={onClose}>Close</button></div></div>
  );
  const sh = r.shifts; const e = sh.events!; const name = first(sh.staff?.full_name); const later = r.kind === 'later';
  const booked = r.old_time ?? sh.planned_start;
  const evFull = ev?.find((x) => x.id === e.id);
  const at = hmOf(sh.planned_start); const to = hmOf(r.new_time);
  const inGrp = evFull ? evFull.shifts.filter((s) => s.status !== 'declined' && !s.attendance && hmOf(s.planned_start) === at && !['MD', 'BM'].includes(s.position_code ?? '')).length : null;
  const need = evFull ? (evFull.staffing ?? []).filter((l) => l.start === at && !['MD', 'BM'].includes(l.code)).reduce((n, l) => n + l.count, 0) : 0;
  const newGrp = evFull ? evFull.shifts.filter((s) => s.status !== 'declined' && !s.attendance && hmOf(s.planned_start) === to).length : 0;
  const m = first(mgr) === '?' ? 'the manager' : first(mgr);
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_answer_change', { p_id: r.id, p_answer: opt, p_tell_manager: tell, p_count: count, p_note: note.trim() || null });
    setBusy(false); if (error) { setErr(error.message); return; }
    onDone();
    if (opt === 'accept_fill') nav(replaceUrl(e, { at }));
    else if (opt === 'replace') nav(replaceUrl(e, { replace: sh.id, at }));
  };
  const opts: [Opt, string, string][] = later ? [
    ['accept', `Accept ${tTime(r.new_time)}`, `${name} moves to a ${tTime(r.new_time)} group, paid from ${tTime(r.new_time)}. ${name} and the manager see the new time.`],
    ['accept_fill', `Accept + fill the ${tTime(booked)} spot`, `Same, and opens Ask more people for one ${tTime(booked)} spot.`],
    ['keep', `Ask ${name} to keep ${tTime(booked)}`, `${name} gets “We really need you at ${tTime(booked)}. Can you make it?” with Yes / I can’t.`],
    ['replace', 'Take off and replace', 'Removes the shift (logged as a late change) and opens Ask more people for 1 spot.'],
  ] : [
    ['accept', `Accept · leaves ${tTime(r.new_time)}`, `The manager sees “leaves ~${tTime(r.new_time)}” on the list. Paid until ${name} is ended.`],
    ['accept_fill', 'Accept + find someone for the end', 'Same, and opens Ask more people for 1 spot.'],
    ['keep', `Ask ${name} to stay`, `${name} gets “We really need you … Can you make it?” with Yes / I can’t.`],
    ['replace', 'Take off and replace', 'Removes the shift (logged as a late change) and opens Ask more people for 1 spot.'],
  ];
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card ca" onClick={(x) => x.stopPropagation()} role="dialog" aria-label="Time change request">
      <div className="spread"><div><div className="kick">{later ? 'TIME CHANGE' : 'LEAVE EARLY'} · {sh.status === 'confirmed' ? 'AFTER CONFIRMING' : 'NOT CONFIRMED YET'}</div>
        <div className="serif ca-h">{later ? `${name} can only start at ${tTime(r.new_time)}` : `${name} needs to leave at ${tTime(r.new_time)}`}</div></div>
        <button className="abtn sm" aria-label="Close" onClick={onClose}>✕</button></div>
      <div className="ca-rows">
        <div><small>Shift</small><span>{relDay(e.event_date).replace(/^./, (c) => c.toUpperCase())} · {e.title} · {roleName(sh.position_code)} · <DeptTag dept={e.department} /></span></div>
        <div><small>Booked</small><span>{tTime(booked)}{sh.status === 'confirmed' && sh.responded_at ? ` · confirmed ${dLabel(isoDay(sh.responded_at), { weekday: 'short' })} ${tTime(sh.responded_at)}` : sh.status === 'confirmed' ? ' · confirmed' : ' · not confirmed'}</span></div>
        <div><small>Asks for</small><b>{tTime(r.new_time)}{later ? ` (${diffTxt(booked, r.new_time)} later)` : ' (leaves before the end)'}</b></div>
        {r.note && <div><small>Why</small><span>“{r.note}”</span></div>}
        <div><small>Sent</small><span>{dLabel(isoDay(r.created_at), { weekday: 'short' })} {tTime(r.created_at)} · {hoursBefore(r.created_at, sh.planned_start)}</span></div>
      </div>
      {later && evFull && <div className="ca-impact">If you accept: the {tTime(booked)} group goes <b>{inGrp}/{need || inGrp} → {(inGrp ?? 1) - 1}/{need || inGrp}</b>, {newGrp ? <>the {tTime(r.new_time)} group gets {name} ({newGrp + 1})</> : <>a new <b>{tTime(r.new_time)}</b> group appears with {name}</>}.{yes != null && <> {yes} {yes === 1 ? 'person' : 'people'} said yes for that date and {yes === 1 ? 'isn’t' : 'aren’t'} placed.</>}</div>}
      {!later && <div className="ca-impact">If you accept, {m} sees “leaves ~{tTime(r.new_time)}” next to {name} on the team list.{yes != null && <> {yes} said yes for that date and aren’t placed.</>}</div>}
      <div className="ca-opts">{opts.map(([k, t, sub]) => (
        <button key={k} className={'ca-opt' + (opt === k ? ' on' : '') + (k === 'replace' ? ' red' : '')} onClick={() => setOpt(k)}><i /><span><b>{t}</b><small>{sub}</small></span></button>
      ))}</div>
      <label className="ca-sw"><input type="checkbox" checked={tell} onChange={(x) => setTell(x.target.checked)} /><span><b>Also tell the manager ({m}) now</b><small>off = {m} only sees the new time once you accept</small></span></label>
      <label className="ca-sw"><input type="checkbox" checked={count} onChange={(x) => setCount(x.target.checked)} /><span><b>Count it in {name}’s reliability (late change)</b><small>off by default</small></span></label>
      <input className="ca-note" value={note} onChange={(x) => setNote(x.target.value)} placeholder={`Note to ${name} (optional)`} />
      {err && <div className="accent sm">{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="abtn" onClick={onClose}>Later</button>
        <button className={'abtn ' + (opt === 'replace' ? 'red' : 'dark')} disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send answer'}</button>
      </div>
    </div></div>
  );
}
