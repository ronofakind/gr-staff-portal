import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { smsMany } from '../lib/messages';
import { adminAsks, byText, dayShort, leftText, shortName, t12, waitingOf, type AdminAsk, type AskTarget, type Spot } from '../lib/shiftAsks';
import { AlsoWorking, otherShifts, type OtherShift } from './alsoWorking';
import { allStaff, ap12, bookingChange, confirmationsSent, eventsBetween, roleName, startIso, ROLES, type AEvent, type AShift, type AStaff } from './api';

/* Push 40 · admin side of "ask first" and "fill one spot":
   ChangeSheet (start / position / move: Ask first · Change now without asking), FillSheet (who to ask · all at once / one by one),
   AskTrackers (Day view: Yes / No / Waiting, Text the ones who haven't answered, Ask everyone left now, Stop asking),
   AskNeeds (Today → Needs you: Keep · Change anyway · Take off and replace / Ask someone else / Move anyway · No one took the spot). */

const TZ = 'America/Toronto';
export const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const isBarCode = (c: string | null) => ['BM', 'BT', 'BB'].includes(c ?? '');
const HOURS: [number, string][] = [[2, '2 h'], [12, '12 h'], [24, '24 h']];
const WAITS: [number, string][] = [[30, '30 min'], [60, '1 h'], [120, '2 h'], [240, '4 h']];
const infoOf = (e: AEvent, iso: string) => ({ id: e.id, event_date: e.event_date, title: e.title, sent: confirmationsSent(e), start: iso });
/** The fill link (Day view opens the Fill sheet from it). */
export const fillUrl = (s: Spot, replace?: string | null) => {
  const p = new URLSearchParams({ d: s.date, fill: s.event_id, at: s.start, code: s.code ?? 'W' });
  if (replace) p.set('replace', replace);
  return `/admin/day?${p}`;
};

/** Start choices every 15 min around the booked start (−3 h … +3 h). */
function startChoices(iso: string) {
  const out: string[] = []; const base = new Date(iso).getTime();
  for (let m = -180; m <= 180; m += 15) out.push(new Date(base + m * 60000).toISOString());
  return out;
}

/* ───────── change a booked shift: start · position · move ───────── */
export type ChangeKind = 'start' | 'position' | 'move';
export function ChangeSheet({ kind, shift, ev, to, toStart, preset, onClose, onDone, onDirect }: {
  kind: ChangeKind; shift: AShift; ev: AEvent; to?: AEvent; toStart?: string; /** start: the new start picked in the Day view (ISO) */ preset?: string; onClose: () => void; onDone: (msg: string) => void;
  /** move: the Day view's own direct move (planned end, position rules, alert) */ onDirect?: (start: string) => Promise<void>;
}) {
  const name = shortName(shift.staff?.full_name);
  const booked = new Date(shift.planned_start).toISOString(); // one format for comparisons (DB "+00:00" vs ".000Z")
  const [start, setStart] = useState<string>(kind === 'move' && to && toStart ? startIso(to.event_date, toStart) : preset ? new Date(preset).toISOString() : booked);
  const [code, setCode] = useState<string>(shift.position_code && /^\d+$/.test(shift.position_code) ? 'W' : shift.position_code ?? 'W');
  const [who, setWho] = useState<'one' | 'group'>('one');
  const [hours, setHours] = useState(kind === 'move' ? 12 : 24);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const group = ev.shifts.filter((s) => s.status !== 'declined' && !s.attendance && s.planned_start === shift.planned_start && !s.punches?.punch_in);
  const list = who === 'group' && kind === 'start' ? group : [shift];
  const sent = !!shift.notified_at;
  const confirmed = shift.status === 'confirmed';
  const earlier = new Date(start).getTime() < new Date(booked).getTime();
  const changed = kind === 'start' ? start !== booked : kind === 'position' ? code !== (shift.position_code && /^\d+$/.test(shift.position_code) ? 'W' : shift.position_code) : true;
  // the rules: later start → no ask · earlier start → ask (once sent) · move / position → ask once confirmed
  const ask = kind === 'start' ? earlier && sent : confirmed;
  const roles = ROLES.filter((r) => (r.dept === 'bar') === (ev.department === 'bar' || isBarCode(shift.position_code)));

  const direct = async () => {
    setBusy(true); setErr('');
    try {
      if (kind === 'start') {
        for (const s of list) {
          const { error } = await supabase.from('shifts').update({ planned_start: start }).eq('id', s.id); if (error) throw error;
          await bookingChange('moved', { staff_id: s.staff_id, shift_id: s.id, from: infoOf(ev, s.planned_start), to: infoOf(ev, start) });
        }
      } else if (kind === 'position') {
        const label = roleName(code);
        const { error } = await supabase.from('shifts').update({ position_code: code, position_detail: isBarCode(code) ? null : label }).eq('id', shift.id); if (error) throw error;
        await bookingChange('moved', { staff_id: shift.staff_id, shift_id: shift.id, from: infoOf(ev, shift.planned_start), to: infoOf(ev, shift.planned_start), pos: { old: roleName(shift.position_code), new: label } });
      } else if (to && onDirect) {
        await onDirect(hmOf(start));
      }
      onDone(kind === 'move' ? `${name} moved to ${to?.title}.` : `Changed. ${list.length > 1 ? `${list.length} people get` : `${name} gets`} “Your shift changed” with Got it.`);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const askFirst = async () => {
    setBusy(true); setErr('');
    const args = kind === 'start' ? { p_shifts: list.filter((s) => s.notified_at).map((s) => s.id), p_kind: 'earlier_start', p_start: start, p_hours: hours }
      : kind === 'position' ? { p_shifts: [shift.id], p_kind: 'position', p_code: code, p_detail: isBarCode(code) ? null : roleName(code), p_hours: hours }
      : { p_shifts: [shift.id], p_kind: 'move', p_event: to!.id, p_start: start, p_hours: hours };
    const { error } = await supabase.rpc('admin_ask_change', args);
    // people in the group who weren't sent the shift yet: nothing to ask, the new time is simply what they'll confirm
    if (!error && kind === 'start') for (const s of list.filter((x) => !x.notified_at)) await supabase.from('shifts').update({ planned_start: start }).eq('id', s.id);
    setBusy(false);
    if (error) { setErr(/admin_ask_change|function/.test(error.message) ? 'Asking first needs migration 044. Use “now without asking” for now.' : error.message); return; }
    onDone(kind === 'move' ? `Asked ${name}. ${name} stays at ${ev.title} until they say yes.` : `Asked ${list.length > 1 ? `${list.length} people` : name}. Nothing changes until they say yes.`);
  };

  const title = kind === 'move' ? `Move ${name} to…` : kind === 'position' ? `Change ${name}’s position` : `Change ${who === 'group' ? `the ${ap12(hmOf(shift.planned_start))} group's` : `${name}’s`} start`;
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card ask-sheet" onClick={(x) => x.stopPropagation()} role="dialog" aria-label={title}>
      <div className="spread"><div><div className="kick">YOUR ADMIN · {dayShort(ev.event_date).toUpperCase()} · {ev.title.toUpperCase()}</div><div className="serif ca-h">{title}</div></div>
        <button className="abtn sm" aria-label="Close" onClick={onClose}>✕</button></div>

      {kind === 'move' && to && <>
        <div className="as-box"><small className={confirmed ? 'okc' : ''}>NOW{confirmed ? ' · ✓ CONFIRMED' : ' · NOT CONFIRMED YET'}</small><b className="serif">{ev.title}</b><span>{roleName(shift.position_code)} · {t12(shift.planned_start)}</span></div>
        <div className="as-arrow">↓</div>
        <div className="as-box gold"><small>MOVE TO</small><b className="serif">{to.title}</b><span>{roleName(shift.position_code)} · <b>{t12(start)}</b>{start < booked ? ' · earlier' : start > booked ? ' · later' : ''}</span>{to.address && <span className="muted sm">{to.address}</span>}</div>
      </>}
      {kind === 'start' && <>
        <small className="as-lbl">NEW START (NOW {t12(shift.planned_start)})</small>
        <select className="ca-note" value={start} onChange={(e) => setStart(e.target.value)}>{startChoices(booked).map((x) => <option key={x} value={x}>{t12(x)}{x === booked ? ' · now' : ''}</option>)}</select>
        {group.length > 1 && <><small className="as-lbl">WHO</small>
          <div className="seg3"><button className={who === 'one' ? 'on' : ''} onClick={() => setWho('one')}>{name} only</button><button className={who === 'group' ? 'on' : ''} onClick={() => setWho('group')}>Whole {ap12(hmOf(shift.planned_start))} group · {group.length}</button></div></>}
      </>}
      {kind === 'position' && <>
        <small className="as-lbl">NEW POSITION (NOW {roleName(shift.position_code).toUpperCase()})</small>
        <div className="seg3 wrap">{roles.map((r) => <button key={r.code} className={code === r.code ? 'on' : ''} onClick={() => setCode(r.code)}>{r.label}</button>)}</div>
      </>}

      {ask ? <>
        <small className="as-lbl">ANSWER BY</small>
        <div className="seg3">{HOURS.map(([h, l]) => <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{l}</button>)}</div>
        {err && <div className="accent sm">{err}</div>}
        <button className="abtn dark as-big" disabled={busy || !changed} onClick={askFirst}>{busy ? 'Asking…' : kind === 'move' ? `Ask ${name} first` : 'Ask first'}</button>
        <button className="link-btn as-now" disabled={busy || !changed} onClick={direct}>{kind === 'move' ? 'Move now without asking' : 'Change now without asking'}</button>
        <small className="muted as-foot">{kind === 'move' ? `${name} stays at ${ev.title} until they say yes.` : 'Nothing changes until they say yes.'}</small>
      </> : <>
        {err && <div className="accent sm">{err}</div>}
        <button className="abtn dark as-big" disabled={busy || !changed} onClick={direct}>{busy ? 'Saving…' : kind === 'move' ? `Move ${name}` : 'Change'}</button>
        <small className="muted as-foot">{kind === 'start' && !earlier ? 'A later start needs no ask: it changes now and they get “Your shift changed” with Got it.'
          : !sent ? 'Not sent yet: they see the new details when confirmations go out.'
          : 'Not confirmed yet: this just updates what they’re asked to confirm.'}</small>
      </>}
    </div></div>
  );
}

/* ───────── fill one spot · ask several people ───────── */
type Cand = { s: AStaff; tier: string | null; free: string; yes: boolean; also: OtherShift[] };
export function FillSheet({ spot, replaceFor, onClose, onDone }: { spot: Spot; replaceFor?: string | null; onClose: () => void; onDone: (msg: string) => void }) {
  const [ev, setEv] = useState<AEvent | null>(null); const [cands, setCands] = useState<Cand[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<'all' | 'chain'>('all'); const [step, setStep] = useState<'who' | 'order'>('who');
  const [wait, setWait] = useState(60); const [hours, setHours] = useState(2);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [dragI, setDragI] = useState<number | null>(null);
  useEffect(() => {
    (async () => {
      const [evs, st, av] = await Promise.all([eventsBetween(spot.date, spot.date), allStaff(),
        supabase.from('availability').select('staff_id,status,from_time,until_time').eq('for_date', spot.date)]);
      const e = evs.find((x) => x.id === spot.event_id) ?? null; setEv(e);
      const bar = e?.department === 'bar' || isBarCode(spot.code);
      // push 46 · people working another event that day stay in the list (after the free ones) with a 🕐 note; never pre-ticked
      const onEv = new Set((e?.shifts ?? []).map((s) => s.staff_id));
      const avm = Object.fromEntries(((av.data ?? []) as { staff_id: string; status: string; from_time: string | null; until_time: string | null }[]).map((a) => [a.staff_id, a]));
      const list = st.filter((s) => s.active && s.role !== 'admin' && (bar ? s.department === 'bar' || s.positions.some(isBarCode) : s.department !== 'bar') && !onEv.has(s.id))
        .map((s) => { const a = avm[s.id]; return { s, tier: s.staff_private?.tier ?? null, yes: a?.status === 'yes', also: otherShifts(evs, s.id, spot.event_id),
          free: a?.status === 'yes' ? (a.from_time ? `free from ${ap12(a.from_time.slice(0, 5))}` : a.until_time ? `free until ${ap12(a.until_time.slice(0, 5))}` : 'free all day') : a?.status === 'maybe' ? 'said maybe' : '' }; })
        .filter((c) => c.free)
        .sort((a, b) => Number(!!a.also.length) - Number(!!b.also.length) || Number(b.yes) - Number(a.yes) || (a.tier ?? 'Z').localeCompare(b.tier ?? 'Z') || (a.s.staff_private?.ranking ?? 999) - (b.s.staff_private?.ranking ?? 999));
      setCands(list); setPicked(list.filter((c) => c.yes && !c.also.length).slice(0, 3).map((c) => c.s.id));
    })();
  }, [spot.date, spot.event_id, spot.code]);
  const byId = useMemo(() => Object.fromEntries((cands ?? []).map((c) => [c.s.id, c])), [cands]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const move = (i: number, d: number) => setPicked((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const role = roleName(spot.code);
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_fill_spot', { p_event: spot.event_id, p_start: spot.start, p_code: spot.code ?? 'W', p_detail: spot.detail ?? (isBarCode(spot.code) ? null : role),
      p_staff: picked, p_mode: mode, p_wait_min: wait, p_hours: hours, p_replace_for: replaceFor ?? null });
    setBusy(false);
    if (error) { setErr(/admin_fill_spot|function/.test(error.message) ? 'Asking several people needs migration 044.' : error.message); return; }
    onDone(mode === 'all' ? `Asked ${picked.length} ${picked.length === 1 ? 'person' : 'people'} for 1 spot.` : `Asking one by one · ${shortName(byId[picked[0]]?.s.full_name)} first.`);
  };
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card ask-sheet" onClick={(x) => x.stopPropagation()} role="dialog" aria-label="Fill one spot">
      <div className="spread"><div><div className="kick">YOUR ADMIN · 1 OPEN SPOT</div>
        <div className="serif ca-h">{step === 'order' ? 'One by one' : `${ev?.title ?? '…'} · ${dayShort(spot.date)}`}</div>
        {step === 'who' && <div className="serif" style={{ fontSize: 20 }}>{role} · {t12(spot.start)}</div>}</div>
        <button className="abtn sm" aria-label="Close" onClick={onClose}>✕</button></div>
      {step === 'who' ? <>
        <small className="as-lbl">WHO TO ASK · FREE THAT DAY</small>
        <div className="as-people">
          {cands === null ? <div className="muted sm">Loading…</div> : !cands.length ? <div className="muted sm">Nobody said yes or maybe for that day and isn’t booked. <Link to={`/admin/availability`}>Ask availability ›</Link></div>
            : cands.slice(0, 30).map((c) => (
              <button key={c.s.id} className={'as-person' + (picked.includes(c.s.id) ? ' on' : '')} onClick={() => toggle(c.s.id)}>
                <span className="grow"><b>{c.s.full_name}</b><small>{c.tier ? `${c.tier} tier` : 'no tier'} · {c.free}</small><AlsoWorking others={c.also} start={spot.start} compact /></span><i aria-hidden="true">{picked.includes(c.s.id) ? '✓' : ''}</i>
              </button>))}
        </div>
        <small className="as-lbl">HOW</small>
        <div className="seg3"><button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>All at once</button><button className={mode === 'chain' ? 'on' : ''} onClick={() => setMode('chain')}>One by one</button></div>
        {mode === 'all' ? <>
          <small className="muted"><b>All at once:</b> the first to say yes gets it. The ask disappears for the others.</small>
          <small className="as-lbl">ANSWER BY</small>
          <div className="seg3">{HOURS.map(([h, l]) => <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{l}</button>)}</div>
        </> : <small className="muted"><b>One by one:</b> you set the order and how long each person has. A no (or no answer) asks the next one.</small>}
        {err && <div className="accent sm">{err}</div>}
        {mode === 'all' ? <button className="abtn dark as-big" disabled={busy || !picked.length} onClick={send}>{busy ? 'Asking…' : `Ask ${picked.length} ${picked.length === 1 ? 'person' : 'people'} · 1 spot`}</button>
          : <button className="abtn dark as-big" disabled={!picked.length} onClick={() => setStep('order')}>Next · set the order ›</button>}
      </> : <>
        <small className="as-lbl">ORDER · DRAG TO CHANGE</small>
        <div className="as-people">
          {picked.map((id, i) => (
            <div key={id} className="as-person on" draggable onDragStart={() => setDragI(i)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragI === null || dragI === i) return; setPicked((p) => { const n = [...p]; const [x] = n.splice(dragI, 1); n.splice(i, 0, x); return n; }); setDragI(null); }}>
              <span className="grow"><b>{byId[id]?.s.full_name}</b><small>{i === 0 ? 'asked first' : i === 1 ? `if ${shortName(byId[picked[0]]?.s.full_name)} says no or waits too long` : `then ${shortName(byId[id]?.s.full_name)}`}</small></span>
              <button className="sq" aria-label="Up" onClick={() => move(i, -1)} disabled={i === 0}>↑</button><button className="sq" aria-label="Down" onClick={() => move(i, 1)} disabled={i === picked.length - 1}>↓</button>
              <i className="as-n">{i + 1}</i>
            </div>))}
        </div>
        <small className="as-lbl">WAIT FOR EACH PERSON</small>
        <div className="seg3">{WAITS.map(([m, l]) => <button key={m} className={wait === m ? 'on' : ''} onClick={() => setWait(m)}>{l}</button>)}</div>
        <small className="muted">No answer in {WAITS.find(([m]) => m === wait)?.[1]} = counts as no, the next person is asked. Nights (10 PM – 8 AM) don’t count.</small>
        {err && <div className="accent sm">{err}</div>}
        <div className="row" style={{ gap: 8 }}><button className="abtn" onClick={() => setStep('who')}>‹ Back</button>
          <button className="abtn dark as-big grow" disabled={busy || !picked.length} onClick={send}>{busy ? 'Starting…' : `Start asking · ${shortName(byId[picked[0]]?.s.full_name)} first`}</button></div>
      </>}
    </div></div>
  );
}

/* ───────── trackers (Day view) ───────── */
const tagOf = (a: AdminAsk, t: AskTarget) => {
  if (a.kind === 'fill') {
    if (t.answer === 'yes') return <i className="ib-tag ok">✓ BOOKED</i>;
    if (t.answer === 'no') return <i className="ib-tag red">NO</i>;
    if (t.answer === 'expired') return <i className="ib-tag">NO ANSWER</i>;
    if (t.removed_at) return <i className="ib-tag">—</i>;
    if (t.asked_at) return <i className="ib-tag gold">{a.mode === 'chain' ? leftText(t.due_at) : 'WAITING'}</i>;
    return <i className="ib-tag">NEXT</i>;
  }
  return t.answer === 'yes' ? <i className="ib-tag ok">✓ {a.kind === 'move' ? 'MOVED' : 'YES'}</i> : t.answer === 'no' ? <i className="ib-tag red">NO</i>
    : t.answer === 'expired' ? <i className="ib-tag">NO ANSWER</i> : a.status === 'cancelled' ? <i className="ib-tag">STOPPED</i> : <i className="ib-tag gold">WAITING</i>;
};

/** Groups for the Day view: all moves of the day together ("Moves waiting · n"), start / position asks by group, each fill on its own. */
export function trackerGroups(asks: AdminAsk[]) {
  const live = asks.filter((a) => a.status === 'open' || a.needs_you || (a.closed_at && Date.now() - new Date(a.closed_at).getTime() < 12 * 3600e3 && a.status !== 'cancelled'));
  const g = new Map<string, AdminAsk[]>();
  for (const a of live) { const k = a.kind === 'move' ? 'moves' : a.kind === 'fill' ? a.id : a.group_key; g.set(k, [...(g.get(k) ?? []), a]); }
  return [...g.entries()].filter(([, l]) => l.some((a) => a.status === 'open' || a.needs_you));
}

export function AskTracker({ asks, onChanged }: { asks: AdminAsk[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const a0 = asks[0];
  const rows = asks.flatMap((a) => a.targets.map((t) => ({ a, t })));
  const run = async (fn: string, id: string) => { setBusy(true); setErr(''); const { error } = await supabase.rpc(fn, { p_ask: id }); setBusy(false); if (error) setErr(error.message); else onChanged(); };
  const waiting = asks.flatMap(waitingOf);
  const sms = smsMany(waiting.map((t) => t.phone));
  if (a0.kind === 'fill') {
    const open = a0.status === 'open';
    return (
      <div className="adm-card at-card">
        <div className="kick">{dayShort(a0.event_date).toUpperCase()} · {a0.mode === 'chain' ? `ONE BY ONE · ${a0.wait_min && a0.wait_min >= 60 ? `${a0.wait_min / 60} H` : `${a0.wait_min} MIN`} EACH` : `ALL AT ONCE · ${byText(a0.answer_by).toUpperCase()}`}</div>
        <div className="serif at-h">{a0.event_title} · 1 spot <small className="muted">{a0.meta.new.position} · {t12(a0.meta.new.start)}</small></div>
        {a0.status === 'filled' && <div className="at-ok">✓ {a0.targets.find((t) => t.answer === 'yes')?.full_name} took it · the others’ ask was removed</div>}
        {a0.status === 'nobody' && <div className="at-no">No one took the spot</div>}
        {rows.map(({ t }, i) => (
          <div key={t.staff_id} className="at-row"><span className="grow"><b>{a0.mode === 'chain' ? `${i + 1} · ` : ''}{t.full_name}</b>
            <small className="muted">{t.answer ? `${t.answer === 'no' ? 'said no' : t.answer === 'yes' ? 'said yes' : 'no answer'} ${t.answered_at ? t12(t.answered_at) : ''}` : t.asked_at ? `asked ${t12(t.asked_at)}` : i > 0 ? `if ${shortName(rows[i - 1].t.full_name)} says no` : ''}{t.note ? ` · “${t.note}”` : ''}</small></span>{tagOf(a0, t)}</div>
        ))}
        {err && <div className="accent sm">{err}</div>}
        {open && <div className="row wrap" style={{ gap: 8 }}>
          {a0.mode === 'chain' && a0.targets.some((t) => !t.asked_at && !t.removed_at) && <button className="abtn sm" disabled={busy} onClick={() => run('admin_ask_rest_now', a0.id)}>Ask everyone left now</button>}
          {sms && <a className="abtn sm" href={sms}>Text the {waiting.length} who {waiting.length === 1 ? 'hasn’t' : 'haven’t'} answered</a>}
          <button className="abtn sm danger" disabled={busy} onClick={() => { if (confirm('Stop asking? The ask disappears for everyone still waiting.')) run('admin_stop_ask', a0.id); }}>Stop asking</button>
        </div>}
      </div>
    );
  }
  const n = { yes: rows.filter((r) => r.t.answer === 'yes').length, no: rows.filter((r) => r.t.answer === 'no' || r.t.answer === 'expired').length, wait: waiting.length };
  const total = Math.max(1, rows.length);
  const title = a0.kind === 'move' ? `Moves waiting · ${asks.length}` : a0.kind === 'position' ? `New position · ${asks.length}` : `${t12(a0.meta.old?.start ?? a0.created_at)} ${asks.length > 1 ? 'group ' : ''}→ ${t12(a0.meta.new.start)}`;
  return (
    <div className="adm-card at-card">
      <div className="kick">{a0.kind === 'move' ? `DAY VIEW · ${dayShort(a0.event_date).toUpperCase()}` : `${a0.event_title.toUpperCase()} · ${dayShort(a0.event_date).toUpperCase()}`}</div>
      <div className="serif at-h">{title}</div>
      <small className="muted">Asked {t12(a0.created_at)} · {byText(a0.answer_by).toLowerCase()}</small>
      <div className="at-bar"><i className="ok" style={{ width: `${(n.yes / total) * 100}%` }} /><i className="red" style={{ width: `${(n.no / total) * 100}%` }} /></div>
      <div className="at-counts"><b className="okc">{a0.kind === 'move' ? 'Moved' : 'Yes'} {n.yes}</b><b className="accent">No {n.no}</b><b>Waiting {n.wait}</b></div>
      {rows.map(({ a, t }) => (
        <div key={a.id + t.staff_id} className="at-row"><span className="grow"><b>{t.full_name}</b>
          {a.kind === 'move' && <small className="muted">{a.meta.old?.venue} → {a.meta.new.venue}</small>}{t.note && <small className="muted">“{t.note}”</small>}</span>{tagOf(a, t)}</div>
      ))}
      {err && <div className="accent sm">{err}</div>}
      <div className="row wrap" style={{ gap: 8 }}>
        {sms && <a className="abtn sm dark" href={sms}>Text the {n.wait} who {n.wait === 1 ? 'hasn’t' : 'haven’t'} answered</a>}
        {asks.filter((a) => a.status === 'open').length === 1 && <button className="abtn sm danger" disabled={busy} onClick={() => run('admin_stop_ask', asks.find((a) => a.status === 'open')!.id)}>Stop asking</button>}
      </div>
      <small className="muted">Each yes changes that person right away. A no comes to Needs you.</small>
    </div>
  );
}

/* ───────── Needs you (Today) ───────── */
export function useAskNeeds(from: string, to: string, tick: number) {
  const [list, setList] = useState<AdminAsk[]>([]);
  useEffect(() => { adminAsks(from, to).then((l) => setList(l.filter((a) => a.needs_you))); }, [from, to, tick]);
  return list;
}

export function AskNeed({ a, onChanged }: { a: AdminAsk; onChanged: () => void }) {
  const nav = useNavigate(); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const t = a.targets[0]; const name = shortName(t?.full_name); const o = a.meta.old; const n = a.meta.new;
  const said = a.status === 'declined' ? 'SAID NO' : a.status === 'nobody' ? '' : 'NO ANSWER';
  const act = async (action: string) => {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('admin_resolve_ask', { p_ask: a.id, p_action: action });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    const spot = (data as { spot: Spot | null } | null)?.spot;
    onChanged();
    if (spot && (action === 'replace' || action === 'ask_else')) nav(fillUrl(spot));
  };
  if (a.kind === 'fill') return (
    <div className="ask-need">
      <small className="red">NO ONE TOOK THE SPOT</small>
      <b>{a.event_title} · {dayShort(a.event_date)}</b>
      <span>{n.position} · {t12(n.start)} · asked {a.targets.length} {a.targets.length === 1 ? 'person' : 'people'}{a.mode === 'chain' ? ' one by one' : ''}</span>
      {err && <span className="accent sm">{err}</span>}
      <div className="ask-btns"><button className="abtn dark" disabled={busy} onClick={() => act('ask_else')}>Ask more people</button><button className="abtn" disabled={busy} onClick={() => act('dismiss')}>Dismiss</button></div>
    </div>
  );
  const move = a.kind === 'move';
  return (
    <div className={'ask-need' + (a.status === 'declined' ? ' no' : '')}>
      <small className={a.status === 'declined' ? 'red' : 'gold'}>{move ? 'MOVE' : a.kind === 'position' ? 'NEW POSITION' : 'NEW TIME'} · {said}</small>
      <b>{t?.full_name} · {dayShort(a.event_date)} · {o?.venue}</b>
      {move ? <span>{o?.venue} {o ? t12(o.start) : ''} → <b>{n.venue} {t12(n.start)}</b></span>
        : a.kind === 'position' ? <span>You asked <b>{n.position}</b> instead of {o?.position}.</span>
        : <span>You asked <b>{t12(n.start)}</b> instead of {o ? t12(o.start) : ''}.</span>}
      {t?.note && <i>“{t.note}”</i>}
      {err && <span className="accent sm">{err}</span>}
      <div className="ask-btns">
        <button className="abtn dark" disabled={busy} onClick={() => act('keep')}>{move ? `Keep ${name} at ${o?.venue}` : a.kind === 'position' ? `Keep ${name} ${o?.position}` : `Keep ${name} at ${o ? t12(o.start) : ''}`}</button>
        {move ? <>
          <button className="abtn" disabled={busy} onClick={() => act('ask_else')}>Ask someone else</button>
          <button className="abtn danger" disabled={busy} onClick={() => act('change_anyway')}>Move anyway</button>
        </> : <>
          <button className="abtn" disabled={busy} onClick={() => act('change_anyway')}>Change anyway</button>
          <button className="abtn danger" disabled={busy} onClick={() => { if (confirm(`Take ${name} off and ask other people for the spot?`)) act('replace'); }}>Take {name} off and replace</button>
        </>}
      </div>
      <small className="muted">{move ? '“Ask someone else” opens your Day view with the open spot and who’s free.' : '“Change anyway” tells them it changed (Got it / Can’t make it). Replace opens Ask several people.'}</small>
    </div>
  );
}
