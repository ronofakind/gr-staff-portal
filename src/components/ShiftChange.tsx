import { useEffect, useState } from 'react';
import { supabase, type ShiftRow } from '../lib/supabase';
import { FixedSheet } from './SwipeSheet';
import { TimeWheel, ampm15 } from './TimeWheel';

/* Push 28 · staff side of "changes after booking": Need a change? bubbles, Can't make it, My schedule changed,
   I'm running late, and the status cards (waiting / OK / keep / manager knows). All writes go through the 034 RPCs. */

export type ChangeReq = {
  id: string; shift_id: string; kind: 'later' | 'leave_early'; new_time: string; old_time: string | null; note: string | null;
  status: 'pending' | 'accepted' | 'keep' | 'replaced' | 'withdrawn'; answer: string | null; answer_note: string | null;
  keep_reply: 'yes' | 'no' | null; staff_seen_at: string | null; created_at: string;
};
export type LateNotice = { id: string; shift_id: string; minutes: number; eta: string; reason: string | null; note: string | null; sent_at: string; seen_at: string | null };

const TZ = 'America/Toronto';
export const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const short = (iso: string) => t12(iso).replace(/\s?[AP]M$/, '');
export const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDay = (d: string, n: number) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
export const dayWordOf = (d: string) => d === today() ? 'Today' : d === addDay(today(), 1) ? 'Tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long' });
const dateLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');
/** "HH:MM" (Montreal) on the shift's evening; times well before the booked start roll to after midnight. */
export function atOn(date: string, hm: string, ref: string) {
  const guess = new Date(`${date}T${hm}:00Z`);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(guess).find((p) => p.type === 'timeZoneName')!.value;
  let d = new Date(guess.getTime() - Number(tz.replace('GMT', '') || 0) * 3600e3);
  if (d.getTime() < new Date(ref).getTime() - 6 * 3600e3) d = new Date(d.getTime() + 24 * 3600e3);
  return d.toISOString();
}
const diffLabel = (a: string, b: string) => { const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000); const h = Math.floor(Math.abs(m) / 60), mm = Math.abs(m) % 60; return `${h ? `${h} h` : ''}${h && mm ? ' ' : ''}${mm ? `${mm}${h ? '' : ' min'}` : ''}`; };
const firstName = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] || 'your manager';
const telOf = (p?: string | null) => p?.replace(/[^\d+]/g, '') || '';

/** Latest change request + running-late notice per shift (both tables are new in 034: errors → nothing). */
export function useShiftChanges(ids: string[]) {
  const key = ids.join(',');
  const [reqs, setReqs] = useState<Record<string, ChangeReq>>({});
  const [late, setLate] = useState<Record<string, LateNotice>>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!ids.length) { setReqs({}); setLate({}); return; }
    supabase.from('shift_change_requests').select('id,shift_id,kind,new_time,old_time,note,status,answer,answer_note,keep_reply,staff_seen_at,created_at').in('shift_id', ids).order('created_at')
      .then(({ data, error }) => {
        if (error) return; const m: Record<string, ChangeReq> = {};
        for (const r of (Array.isArray(data) ? data : []) as ChangeReq[]) if (r && typeof r.shift_id === 'string' && typeof r.new_time === 'string') m[r.shift_id] = r; // newest wins
        for (const k of Object.keys(m)) if (m[k].status === 'withdrawn') delete m[k];
        setReqs(m);
      });
    supabase.from('late_notices').select('id,shift_id,minutes,eta,reason,note,sent_at,seen_at').in('shift_id', ids)
      .then(({ data, error }) => { if (error) return; const m: Record<string, LateNotice> = {}; for (const r of (Array.isArray(data) ? data : []) as LateNotice[]) if (r && typeof r.shift_id === 'string' && typeof r.eta === 'string') m[r.shift_id] = r; setLate(m); });
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return { reqs, late, reload: () => setTick((t) => t + 1), setLate, setReqs };
}

/** "Need a change?" + two small outline bubbles (on purpose not big buttons). Lives inside the dark card. */
export function NeedChange({ onSchedule, onCancel, canSchedule = true }: { onSchedule: () => void; onCancel: () => void; canSchedule?: boolean }) {
  return (
    <div className="nchg">
      <span>Need a change?</span>
      <div>
        {canSchedule && <button type="button" className="nchg-b" onClick={onSchedule}>Schedule changed</button>}
        <button type="button" className="nchg-b" onClick={onCancel}>Can’t make it</button>
      </div>
    </div>
  );
}

const CANCEL_REASONS = ['Sick', 'Emergency', 'Transport', 'Other'];
/** 28b · Can't make it? — reason asked softly (not required), note for Ronnie, warning once confirmed. */
export function CancelSheet({ s, onClose, onDone, preview = false }: { s: ShiftRow; onClose: () => void; onDone: (late: boolean) => void; preview?: boolean }) {
  const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async () => {
    if (preview) return onClose();
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('staff_cancel_shift', { p_shift: s.id, p_reason: reason || null, p_note: note.trim() || null });
    setBusy(false);
    if (error) return setErr(/function|does not exist|schema cache/i.test(error.message) ? 'Cancelling in the app is not on yet. Text Ronnie.' : error.message);
    onDone(!!(data as { late?: boolean } | null)?.late);
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <FixedSheet onClose={onClose} label="Can't make it" closeLabel={null}>
        <div><div className="kicker">{dayWordOf(s.events.event_date)} · {s.events.title}</div><div className="serif p28-h">Can’t make it?</div></div>
        <div className="p28-chips">{CANCEL_REASONS.map((r) => <button key={r} type="button" className={reason === r ? 'on' : ''} onClick={() => setReason(reason === r ? '' : r)}>{r}</button>)}</div>
        <textarea className="sheet-note" rows={2} value={note} placeholder="Note for Ronnie (optional)" onChange={(e) => setNote(e.target.value)} />
        {s.status === 'confirmed' && <div className="p28-warn"><b>You already confirmed this shift.</b><span>Please only cancel if you really have to. The team is counting on you.</span></div>}
        {err && <p className="error">{err}</p>}
        <button className="btn-red" disabled={busy} onClick={go}>{busy ? 'Cancelling…' : 'Cancel my shift'}</button>
        <button type="button" className="fs-close" onClick={onClose}>Keep my shift · close</button>
      </FixedSheet>
    </>
  );
}

/** 28d · What changed? Arrive later / Leave early, 15-min wheel, note → Send to Ronnie. The shift stays as booked until he answers. */
export function ChangeSheet({ s, onClose, onSent, preview = false }: { s: ShiftRow; onClose: () => void; onSent: () => void; preview?: boolean }) {
  const [kind, setKind] = useState<'later' | 'leave_early'>('later');
  const start = s.planned_start;
  const plus = (iso: string, m: number) => hmOf(new Date(new Date(iso).getTime() + m * 60000).toISOString());
  const [t, setT] = useState<string | null>(null); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const at = t ? atOn(s.events.event_date, t, start) : null;
  const okTime = !!at && new Date(at).getTime() > new Date(start).getTime();
  const send = async () => {
    if (!at) return;
    if (!okTime) return setErr(kind === 'later' ? `Pick a time after ${t12(start)}.` : 'Pick a time after your start.');
    if (preview) return onClose();
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('staff_request_change', { p_shift: s.id, p_kind: kind, p_time: at, p_note: note.trim() || null });
    setBusy(false);
    if (error) return setErr(/function|does not exist|schema cache/i.test(error.message) ? 'Not on yet. Text Ronnie.' : error.message);
    onSent();
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <FixedSheet onClose={onClose} label="What changed">
        <div><div className="kicker">{dayWordOf(s.events.event_date)} · booked {t12(start)}</div><div className="serif p28-h">What changed?</div></div>
        <div className="seg2">
          <button type="button" className={kind === 'later' ? 'on' : ''} onClick={() => { setKind('later'); setT(null); }}>Arrive later</button>
          <button type="button" className={kind === 'leave_early' ? 'on' : ''} onClick={() => { setKind('leave_early'); setT(null); }}>Leave early</button>
        </div>
        <div className="p28-wheel"><small>{kind === 'later' ? 'I can start at' : 'I need to leave at'}</small>
          <TimeWheel key={kind} value={t} onChange={setT} rest={kind === 'later' ? plus(start, 60) : plus(start, 5 * 60)} /></div>
        <textarea className="sheet-note" rows={2} value={note} placeholder={kind === 'later' ? 'Why? e.g. class finishes at 6 PM' : 'Why? e.g. early flight tomorrow'} onChange={(e) => setNote(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <button className="btn-ink" disabled={busy || !t} onClick={send}>{busy ? 'Sending…' : t ? `Send to Ronnie · ${kind === 'later' ? 'start' : 'leave'} ${ampm15(t)}` : 'Send to Ronnie'}</button>
        <div className="muted sm p28-foot">Your shift stays at {t12(start)} until Ronnie answers.</div>
      </FixedSheet>
    </>
  );
}

const LATE_MIN = [5, 10, 15, 20];
const LATE_LONG: [string, number][] = [['45 min', 45], ['1 h', 60], ['1 h 30', 90], ['2 h+', 120]];
const LATE_REASONS = ['Traffic', 'Metro / bus', 'Parking', 'Other'];
/** 28e · How late will you be? 5 · 10 · 15 · 20 · 30+ → (30+) When will you get there? Goes to the manager, not to Ronnie. */
export function LateSheet({ s, mgr, onClose, onSent, preview = false, again }: { s: ShiftRow; mgr: string | null; onClose: () => void; onSent: (n: LateNotice) => void; preview?: boolean; again?: LateNotice | null }) {
  const [step, setStep] = useState<'min' | 'long'>(again && again.minutes > 20 ? 'long' : 'min');
  const [min, setMin] = useState<number | null>(again && again.minutes <= 20 ? again.minutes : null);
  const [t, setT] = useState<string | null>(again && again.minutes > 20 ? hmOf(again.eta) : null);
  const [reason, setReason] = useState(again?.reason ?? ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [note, setNote] = useState(again?.note ?? '');
  const start = s.planned_start; const who = firstName(mgr);
  const base = Math.max(new Date(start).getTime(), Date.now());
  const etaOf = (m: number) => new Date(Math.round((new Date(start).getTime() + m * 60000 < Date.now() ? base + m * 60000 : new Date(start).getTime() + m * 60000) / 60000) * 60000).toISOString();
  const eta = step === 'min' ? (min ? etaOf(min) : null) : t ? atOn(s.events.event_date, t, start) : null;
  const pickReason = (r: string) => setReason(reason === r ? '' : r);
  const noteLine = reason === 'Other' ? <textarea className="sheet-note" rows={2} autoComplete="off" autoCorrect="on" value={note} placeholder="What’s going on? (optional)" onChange={(e) => setNote(e.target.value)} /> : null;
  const staffNotes = s.events.venues?.staff_notes?.trim();
  const send = async () => {
    if (!eta) return;
    const minutes = Math.max(1, Math.round((new Date(eta).getTime() - new Date(start).getTime()) / 60000));
    const n: LateNotice = { id: again?.id ?? 'local', shift_id: s.id, minutes, eta, reason: reason || null, note: reason === 'Other' ? note.trim() || null : null, sent_at: new Date().toISOString(), seen_at: null };
    if (preview) return onSent(n);
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('staff_running_late', { p_shift: s.id, p_minutes: minutes, p_eta: eta, p_reason: reason || null, p_note: reason === 'Other' ? note.trim() || null : null });
    setBusy(false);
    if (error) return setErr(/function|does not exist|schema cache/i.test(error.message) ? `Not on yet. Call ${who}.` : error.message);
    onSent({ ...n, id: typeof data === 'string' ? data : n.id });
  };
  const parking = staffNotes ? <div className="p28-park"><span aria-hidden="true">🅿️</span><div><b>Parking &amp; entrance</b><span>{staffNotes}</span></div></div> : null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <FixedSheet onClose={onClose} label="Running late" onBack={step === 'long' ? () => { setStep('min'); setT(null); } : undefined}>
        {step === 'min' ? <>
          <div><div className="kicker">Today · starts {t12(start)}</div><div className="serif p28-h">How late will you be?</div></div>
          <div className="p28-mins">
            {LATE_MIN.map((m) => <button key={m} type="button" className={min === m ? 'on' : ''} onClick={() => setMin(m)}>{m}{m === 5 ? ' min' : ''}</button>)}
            <button type="button" onClick={() => { setStep('long'); setMin(null); }}>30+</button>
          </div>
          <div className="p28-chips">{LATE_REASONS.map((r) => <button key={r} type="button" className={reason === r ? 'on' : ''} onClick={() => pickReason(r)}>{r}</button>)}</div>
          {noteLine}
          {parking}
          {err && <p className="error">{err}</p>}
          <button className="btn-gold" disabled={busy || !eta} onClick={send}>{busy ? 'Sending…' : `Tell ${who}${eta ? ` · I’ll be there ~${short(eta)}` : ''}`}</button>
          <div className="muted sm p28-foot">Goes to your manager tonight. One tap, no call needed.</div>
        </> : <>
          <div><div className="kicker">30+ min · starts {t12(start)}</div><div className="serif p28-h">When will you get there?</div></div>
          <div className="p28-mins four">{LATE_LONG.map(([l, m]) => { const v = hmOf(etaOf(m)); return <button key={l} type="button" className={t === v ? 'on' : ''} onClick={() => setT(v)}>{l}</button>; })}</div>
          <div className="p28-wheel"><TimeWheel key={t ?? 'x'} value={t} onChange={setT} rest={hmOf(etaOf(45))} /></div>
          <div className="p28-chips">{LATE_REASONS.map((r) => <button key={r} type="button" className={reason === r ? 'on' : ''} onClick={() => pickReason(r)}>{r}</button>)}</div>
          {noteLine}
          {parking}
          {err && <p className="error">{err}</p>}
          <button className="btn-gold" disabled={busy || !eta} onClick={send}>{busy ? 'Sending…' : `Tell ${who}${eta ? ` · there at ${short(eta)}` : ''}`}</button>
        </>}
      </FixedSheet>
    </>
  );
}

/** Gold "I'm running late" button, or once sent: "<mgr> knows · ~6:00 PM" → "✓ <mgr> saw it", with Call and Update. */
export function LateBlock({ notice, mgr, mgrPhone, onOpen }: { notice: LateNotice | null; mgr: string | null; mgrPhone?: string | null; onOpen: () => void }) {
  const who = firstName(mgr); const tel = telOf(mgrPhone);
  if (!notice) return <button type="button" className="late-btn" onClick={onOpen}><span aria-hidden="true">⏱</span> I’m running late</button>;
  return (
    <div className={'late-st' + (notice.seen_at ? ' seen' : '')}>
      <div><b>{notice.seen_at ? `✓ ${who} saw it` : `${who} knows`}</b><span> · you’ll be there ~{t12(notice.eta)}{notice.reason ? ` (${notice.reason.toLowerCase()})` : ''} · sent {t12(notice.sent_at)}</span></div>
      <div className="row2">
        {tel ? <a className="late-st-b" href={`tel:${tel}`}>📞 Call {who}</a> : <span />}
        <button type="button" className="late-st-b" onClick={onOpen}>Update</button>
      </div>
    </div>
  );
}

/** 28d status card under the dark card: ⏳ waiting · ✓ Ronnie said OK · "Can you make it?" (keep). */
export function ChangeCard({ r, s, onChanged, preview = false, where = null }: { r: ChangeReq; s: ShiftRow; onChanged: () => void; preview?: boolean; where?: string | null }) {
  const wh = where ? <small className="chg-where">{where}</small> : null;
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [sure, setSure] = useState(false);
  const call = async (fn: string, args: Record<string, unknown>) => {
    if (preview) return; setBusy(true); setErr('');
    const { error } = await supabase.rpc(fn, args); setBusy(false);
    if (error) setErr(error.message); else onChanged();
  };
  const booked = r.old_time ?? s.planned_start;
  if (r.status === 'pending') return (
    <section className="chg-card wait">
      <div className="chg-ic">⏳</div>
      <div className="grow">{wh}<b>Waiting for Ronnie</b>
        <span>You asked to {r.kind === 'later' ? 'start' : 'leave'} at <b>{t12(r.new_time)}</b>{r.kind === 'later' ? ` instead of ${t12(booked)}` : ''}.</span>
        {r.note && <i>“{r.note}”</i>}
        {err && <span className="error">{err}</span>}
        <button className="link-btn chg-link" disabled={busy} onClick={() => call('staff_withdraw_change', { p_id: r.id })}>Cancel my request</button></div>
    </section>
  );
  if (r.status === 'accepted' && !r.staff_seen_at) return (
    <section className="chg-card ok">
      <div className="chg-ic">✓</div>
      <div className="grow">{wh}<b>Ronnie said OK</b>
        <span>{r.kind === 'later' ? <>Your start is now <b>{t12(r.new_time)}</b>. Paid from {t12(r.new_time)}.</> : <>You can leave at <b>{t12(r.new_time)}</b>. Your manager knows.</>}</span>
        {r.answer_note && <i>“{r.answer_note}”</i>}</div>
      <button className="pill-ok" disabled={busy} onClick={() => call('staff_change_seen', { p_id: r.id })}>OK</button>
    </section>
  );
  if (r.status === 'keep' && !r.keep_reply) return (
    <section className="chg-card keep">
      <div className="grow">{wh ?? <small>RONNIE ANSWERED</small>}<b>We really need you at {t12(booked)}. Can you make it?</b>
        {r.answer_note && <i>“{r.answer_note}”</i>}
        {sure && <span className="red">I can’t = your shift is cancelled (late cancel). Ronnie finds someone else.</span>}
        {err && <span className="error">{err}</span>}
        <div className="row2" style={{ marginTop: 8 }}>
          <button className="btn-ink" disabled={busy} onClick={() => call('staff_answer_keep', { p_id: r.id, p_yes: true })}>Yes, {short(booked)}</button>
          <button className="btn-ghost chg-cant" disabled={busy} onClick={() => (sure ? call('staff_answer_keep', { p_id: r.id, p_yes: false }) : setSure(true))}>{sure ? 'Yes, cancel it' : 'I can’t'}</button>
        </div></div>
    </section>
  );
  return null;
}

/** Shift cancelled · Ronnie has been told (right after cancelling, and for 24 h on Home). */
export function CancelledCard({ title, date, late, onOk }: { title: string; date: string; late?: boolean; onOk: () => void }) {
  return (
    <section className="chg-card gone">
      <div className="chg-ic">✕</div>
      <div className="grow"><b>Shift cancelled</b><span>{dateLabel(date)} · {title}. Ronnie has been told.</span>
        <span className="muted">It’s off your schedule.{late ? ' It counts as a late cancel.' : ''} If things change, message Ronnie before booking it back.</span></div>
      <button className="pill-line" onClick={onOk}>OK</button>
    </section>
  );
}
