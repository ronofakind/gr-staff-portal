import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { dayShort, shortName, t12, waitingOf, type AdminAsk } from '../lib/shiftAsks';
import { AlsoWorking, otherShifts, type OtherShift } from './alsoWorking';
import { hoursBefore, isEventDayCancel, replacementOf } from './Changes';
import { allStaff, addDays, ap12, eventsBetween, roleName, roleOfShift, tTime, type AEvent, type AShift, type AStaff } from './api';

/* Push 47 §B · Can't make it / Not confirmed → Find replacement (admin only; the staff side is unchanged).
   Find replacement = push 40 fill a spot (admin_fill_spot with p_replace_for): first yes wins, the ask disappears for the
   others. The person replaced stays on the event until someone says yes; migration 054 then takes them off and tells them. */

const TZ = 'America/Toronto';
const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const isBarCode = (c: string | null) => ['BM', 'BT', 'BB'].includes(c ?? '');
export const initials = (n?: string | null) => (n ?? '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]?.toUpperCase() ?? '').join('') || '?';
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
/** "HH:MM[:SS]" → minutes, early-morning times (before 6 AM) count as after midnight. */
export const minOf = (t: string | null | undefined) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + (m || 0); };
const monday = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };

/* ───────── candidates: said Yes / Maybe for the date, free at the start, ranked ───────── */
export type Av = { staff_id: string; status: string; from_time: string | null; until_time: string | null; answered_at: string | null; note?: string | null; knows_by?: string | null; knows_note?: string | null };
export type Pool = { date: string; evs: AEvent[]; staff: AStaff[]; av: Record<string, Av>; week: Record<string, number> };
export type Cand = { s: AStaff; tier: string | null; av: Av; also: OtherShift[]; nth: number; line: string };

/** Everything the candidate list needs for one date (same-day events, staff, availability, shifts this week). */
export async function loadPool(date: string): Promise<Pool> {
  const mon = monday(date);
  const avq = (cols: string) => supabase.from('availability').select(cols).eq('for_date', date);
  const [evs, staff, week, av0] = await Promise.all([eventsBetween(date, date), allStaff(), eventsBetween(mon, addDays(mon, 6)), avq('staff_id,status,from_time,until_time,answered_at,note,knows_by,knows_note')]);
  const avr = av0.error ? await avq('staff_id,status,from_time,until_time,answered_at,note') : av0; // 041 not applied → no knows_by
  const av: Record<string, Av> = {};
  for (const a of ((avr.data ?? []) as unknown as Av[])) if (!av[a.staff_id] || a.status === 'yes' || (a.status === 'maybe' && av[a.staff_id].status !== 'yes')) av[a.staff_id] = a;
  const wk: Record<string, number> = {};
  for (const e of week) for (const s of e.shifts) if (s.status !== 'declined' && !s.attendance) wk[s.staff_id] = (wk[s.staff_id] ?? 0) + 1;
  return { date, evs, staff, av, week: wk };
}

const TIER_ORDER: Record<string, number> = { A: 0, B: 1, C: 2 };
/**
 * Yes / Maybe for the date, not on this event, not on another shift that covers the start (push 46 "Also working" before
 * or after is fine: shown as a note), and their answer fits the start. Ranked by tier, then answer time.
 */
export function candidatesFor(p: Pool, o: { eventId: string; start: string; bar: boolean; exclude?: Set<string> }): { list: Cand[]; notFree: number } {
  const ev = p.evs.find((e) => e.id === o.eventId);
  const onEv = new Set((ev?.shifts ?? []).filter((s) => s.status !== 'declined').map((s) => s.staff_id));
  const st = new Date(o.start).getTime(); const stMin = minOf(hmOf(o.start));
  let notFree = 0;
  const list: Cand[] = [];
  for (const s of p.staff) {
    if (!s.active || s.role === 'admin' || onEv.has(s.id) || o.exclude?.has(s.id)) continue;
    if (o.bar ? !(s.department === 'bar' || s.positions.some(isBarCode)) : s.department === 'bar') continue;
    const a = p.av[s.id]; if (!a || (a.status !== 'yes' && a.status !== 'maybe')) continue;
    const also = otherShifts(p.evs, s.id, o.eventId);
    const covers = also.some((x) => new Date(x.start).getTime() <= st && (!x.end || new Date(x.end).getTime() > st));
    const from = minOf(a.from_time); const until = minOf(a.until_time);
    const fits = (from == null || stMin == null || from <= stMin) && (until == null || stMin == null || until > stMin);
    if (covers || !fits) { notFree++; continue; }
    const tier = s.staff_private?.tier ?? null; const nth = (p.week[s.id] ?? 0) + 1;
    const said = a.status === 'yes' ? (a.from_time ? `said Yes from ${ap12(a.from_time.slice(0, 5)).replace(':00', '')}` : a.until_time ? `said Yes until ${ap12(a.until_time.slice(0, 5)).replace(':00', '')}` : 'said Yes · all evening')
      : `Maybe${a.knows_note || a.note ? ` · “${(a.knows_note || a.note)!.slice(0, 40)}”` : a.knows_by ? ` · knows by ${new Date(a.knows_by + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}` : ''}`;
    list.push({ s, tier, av: a, also, nth, line: `${tier ?? '–'} · ${said}` });
  }
  list.sort((a, b) => (TIER_ORDER[a.tier ?? ''] ?? 3) - (TIER_ORDER[b.tier ?? ''] ?? 3)
    || (a.av.answered_at ?? '9999').localeCompare(b.av.answered_at ?? '9999') || (a.s.staff_private?.ranking ?? 999) - (b.s.staff_private?.ranking ?? 999));
  return { list, notFree };
}
/** "⚠ 5th shift this week" from the 4th; "3rd shift this week" as plain text. */
export const tiredText = (nth: number) => (nth >= 4 ? `⚠ ${ord(nth)} shift this week` : nth === 3 ? `${ord(nth)} shift this week` : '');
export const isTired = (nth: number) => nth >= 4;

/* ───────── Find replacement sheet ───────── */
const ALL_H: [number, string][] = [[2, '2 h'], [12, '12 h'], [24, '24 h']];
const WAITS: [number, string][] = [[30, '30 min'], [60, '1 h'], [120, '2 h']];
export function ReplaceSheet({ shift, ev, onClose, onDone }: { shift: AShift; ev: AEvent; onClose: () => void; onDone: (msg: string) => void }) {
  const [pool, setPool] = useState<Pool | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<'all' | 'chain'>('all'); const [hours, setHours] = useState(2); const [wait, setWait] = useState(60);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const bar = ev.department === 'bar' || isBarCode(shift.position_code);
  const name = shortName(shift.staff?.full_name);
  useEffect(() => { loadPool(ev.event_date).then(setPool).catch((e) => setErr((e as Error).message)); }, [ev.event_date]);
  const res = useMemo(() => (pool ? candidatesFor(pool, { eventId: ev.id, start: shift.planned_start, bar }) : null), [pool, ev.id, shift.planned_start, bar]);
  useEffect(() => { if (res) setPicked(res.list.filter((c) => !isTired(c.nth) && !c.also.length).slice(0, 2).map((c) => c.s.id)); }, [res]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // one by one asks in the ranked order shown
  const ordered = (res?.list ?? []).filter((c) => picked.includes(c.s.id)).map((c) => c.s.id);
  const started = new Date(shift.planned_start).getTime() <= Date.now();
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_fill_spot', {
      p_event: ev.id, p_start: shift.planned_start, p_code: shift.position_code ?? 'W', p_detail: shift.position_detail ?? (bar ? null : roleName(roleOfShift(shift.position_code))),
      p_staff: ordered, p_mode: mode, p_wait_min: wait, p_hours: hours, p_replace_for: shift.id,
    });
    setBusy(false);
    if (error) { setErr(/admin_fill_spot|function/.test(error.message) && !/started|Tick|already/.test(error.message) ? 'Asking several people needs migration 044.' : error.message); return; }
    onDone(mode === 'all' ? `Asked ${ordered.length} ${ordered.length === 1 ? 'person' : 'people'} to replace ${name}.` : `Asking one by one to replace ${name} · ${shortName(res?.list.find((c) => c.s.id === ordered[0])?.s.full_name)} first.`);
  };
  const at = ap12(hmOf(shift.planned_start)).replace(':00', '');
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card ask-sheet rp-sheet" onClick={(x) => x.stopPropagation()} role="dialog" aria-label={`Replace ${name}`}>
      <div className="spread"><div><div className="kick">YOUR ADMIN · FIND REPLACEMENT</div><div className="serif ca-h">Replace {name}</div>
        <div className="muted sm">{dayShort(ev.event_date)} · {ev.title} · {roleName(roleOfShift(shift.position_code))} {t12(shift.planned_start)}</div></div>
        <button className="abtn sm" aria-label="Close" onClick={onClose}>✕</button></div>
      <small className="as-lbl">SAID YES OR MAYBE · FREE AT {at.toUpperCase()}</small>
      <div className="as-people">
        {!res ? <div className="muted sm">{err || 'Loading…'}</div> : !res.list.length
          ? <div className="muted sm">Nobody who said Yes or Maybe for {dayShort(ev.event_date)} is free at {at}. <Link to={`/admin/availability`}>Ask availability ›</Link></div>
          : res.list.slice(0, 30).map((c) => (
            <button key={c.s.id} className={'as-person' + (picked.includes(c.s.id) ? ' on' : '')} onClick={() => toggle(c.s.id)} aria-pressed={picked.includes(c.s.id)}>
              <span className="rp-av" aria-hidden="true">{initials(c.s.full_name)}</span>
              <span className="grow"><b>{c.s.full_name}</b><small>{c.line}{tiredText(c.nth) && <> · <span className={isTired(c.nth) ? 'tired' : ''}>{tiredText(c.nth)}</span></>}</small>
                <AlsoWorking others={c.also} start={shift.planned_start} compact /></span>
              <i aria-hidden="true">{picked.includes(c.s.id) ? '✓' : ''}</i>
            </button>))}
      </div>
      {res && res.notFree > 0 && <div className="rp-more">{res.notFree} more said Yes or Maybe but aren’t free at {at} (another shift then, or their time doesn’t fit).</div>}
      <small className="as-lbl">HOW TO ASK</small>
      <div className="seg3"><button className={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>All at once</button><button className={mode === 'chain' ? 'on' : ''} onClick={() => setMode('chain')}>One by one</button></div>
      {mode === 'all' ? <>
        <small className="as-lbl">ANSWER BY</small>
        <div className="seg3">{ALL_H.map(([h, l]) => <button key={h} className={hours === h ? 'on' : ''} onClick={() => setHours(h)}>{l}</button>)}</div>
      </> : <>
        <small className="as-lbl">WAIT FOR EACH PERSON · IN THE ORDER ABOVE</small>
        <div className="seg3">{WAITS.map(([m, l]) => <button key={m} className={wait === m ? 'on' : ''} onClick={() => setWait(m)}>{l}</button>)}</div>
      </>}
      {started && <div className="accent sm">This shift has started. Call the manager instead.</div>}
      {err && res && <div className="accent sm">{err}</div>}
      <button className="abtn dark as-big" disabled={busy || !ordered.length || started} onClick={send}>{busy ? 'Asking…' : `Ask ${ordered.length} ${ordered.length === 1 ? 'person' : 'people'}`}</button>
      <small className="muted as-foot">{mode === 'all' ? 'First yes gets it; the ask quietly disappears for the others.' : 'A no, or no answer in time, asks the next person. Nights (10 PM – 8 AM) don’t count.'} {name} comes off when someone says yes.</small>
    </div></div>
  );
}

/** Open fill ask replacing this shift (push 40 tracker in the Day view). */
export const replaceAskOf = (asks: AdminAsk[], shiftId: string) => asks.find((a) => a.kind === 'fill' && a.status === 'open' && a.replace_for === shiftId);
const askingText = (a: AdminAsk) => { const w = waitingOf(a); return a.mode === 'chain' ? `Asking one by one · ${w[0] ? shortName(w[0].full_name) + ' now' : 'next…'}` : `Asking ${a.targets.length} ${a.targets.length === 1 ? 'person' : 'people'} · ${w.length} waiting`; };

/* ───────── Needs you · CAN'T MAKE IT (replaces push 28's LAST-MINUTE CANCEL card and "Find a replacement" row) ───────── */
export function CantMakeIt({ e, s, mgr, ask, onFind, onChanged }: { e: AEvent; s: AShift; mgr: string | null; ask?: AdminAsk; onFind: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const rep = replacementOf(e, s); const evDay = isEventDayCancel(e, s); const sent = !!s.cancel_sent_to_manager;
  const m = (mgr ?? '').split(' ')[0] || 'the manager';
  const tel = (s.staff?.phone ?? '').replace(/[^\d+]/g, '');
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_send_cancel_to_manager', { p_shift: s.id });
    setBusy(false); if (error) setErr(error.message); else onChanged();
  };
  const note = s.cancel_note ? `“${s.cancel_note}”` : s.cancel_reason ? s.cancel_reason.toLowerCase() : 'no reason given';
  return (
    <div className="nx-card">
      <div className="nx-top"><span className="nx-tag">CAN’T MAKE IT{evDay ? ' · TONIGHT' : ''}</span><span className="muted">{tTime(s.cancelled_at ?? null)}{s.cancelled_at ? ` · ${hoursBefore(s.cancelled_at, s.planned_start)}` : ''}</span></div>
      <b>{s.staff?.full_name ?? '?'} · {dayShort(e.event_date)} · {e.title}</b>
      <span>{roleName(roleOfShift(s.position_code))} {t12(s.planned_start)}{s.cancel_late ? ' · was confirmed' : ' · before confirming (not counted)'} · {note}</span>
      {err && <span className="accent sm">{err}</span>}
      {rep ? <span className="nx-done">✓ Replaced · {rep.staff?.full_name ?? '?'} in · {shortName(s.staff?.full_name)} out</span>
        : ask ? <span className="nx-wait">{askingText(ask)} · <Link to={`/admin/day?d=${e.event_date}`}>Day view ›</Link></span>
        : <div className="nx-btns">
          <button className="abtn dark" onClick={onFind}>Find replacement</button>
          {tel ? <a className="abtn" href={`tel:${tel}`}>Call</a> : <span className="abtn" aria-disabled title="No phone on file">Call</span>}
        </div>}
      {evDay && (sent ? <span className="nx-done">✓ Sent to {m} · marked no-show</span>
        : <div className="nx-btns"><button className="abtn" disabled={busy} onClick={send}>{busy ? 'Sending…' : `Send to ${m} · mark no-show`}</button></div>)}
      {evDay && !sent && <small className="muted">{m[0].toUpperCase() + m.slice(1)} doesn’t see this yet. After you send, {shortName(s.staff?.full_name)} shows on the list as “CANCELLED · NO-SHOW”, so nobody waits.</small>}
    </div>
  );
}

/* ───────── Needs you · NOT CONFIRMED · n (push 33 confirm window passed) ───────── */
export type Late = { s: AShift & { confirm_sent_at: string; confirm_by: string | null }; e: AEvent };
export function NotConfirmed({ rows, seen, nudged, asks, onReplace, onChanged }: {
  rows: Late[]; seen: Record<string, string | null>; nudged: Record<string, string>; asks: AdminAsk[]; onReplace: (r: Late) => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState(''); const [done, setDone] = useState<Record<string, string>>({});
  if (!rows.length) return null;
  const nudge = async (r: Late) => {
    setBusy(r.s.id); setErr('');
    const { data, error } = await supabase.rpc('admin_nudge_confirm', { p_shift: r.s.id });
    setBusy(null);
    if (error) { setErr(/admin_nudge_confirm|function/.test(error.message) && !/Nudged|answered|started|sent/.test(error.message) ? 'Nudge needs migration 054.' : error.message); return; }
    setDone((d) => ({ ...d, [r.s.id]: (data as string) ?? new Date().toISOString() })); onChanged();
  };
  return (
    <div className="nx-card gold">
      <div className="nx-top"><span className="nx-tag">NOT CONFIRMED · {rows.length}</span><span className="muted">24 h window passed</span></div>
      {rows.map((r) => {
        const last = seen[r.s.staff_id]; const opened = !!last && last > r.s.confirm_sent_at;
        const n = done[r.s.id] ?? nudged[r.s.id]; const ask = replaceAskOf(asks, r.s.id);
        return (
          <div key={r.s.id} className="nx-row">
            <span className="nx-av" aria-hidden="true">{initials(r.s.staff?.full_name)}</span>
            <span className="grow"><b>{r.s.staff?.full_name ?? '?'}</b>
              <small>{roleName(roleOfShift(r.s.position_code))} · {dayShort(r.e.event_date)} · {r.e.title}{last !== undefined ? ` · ${opened ? 'opened, no tap' : 'not opened'}` : ''}{n ? ` · nudged ${tTime(n)}` : ''}</small>
              {ask && <small className="nx-wait">{askingText(ask)}</small>}</span>
            {!ask && <>
              <button className="abtn sm" disabled={busy === r.s.id} onClick={() => nudge(r)}>{busy === r.s.id ? '…' : 'Nudge'}</button>
              <button className="abtn sm rep" onClick={() => onReplace(r)}>Replace</button>
            </>}
          </div>
        );
      })}
      {err && <span className="accent sm">{err}</span>}
      <div className="nx-foot">Nudge = one more phone alert (a text if they have no alerts). Replace opens the replacement sheet; they stay on until someone says yes. Nothing is cancelled by itself.</div>
    </div>
  );
}

/* ───────── Event page · ✓ REPLACED · <new> in · <old> out ───────── */
export function ReplacedBanners({ evs }: { evs: AEvent[] }) {
  const all = evs.flatMap((e) => e.shifts.map((s) => ({ e, s })));
  const pairs = all.filter(({ s }) => s.replacement_for && s.status !== 'declined' && !s.attendance)
    .map(({ e, s }) => ({ e, nw: s, old: all.find((x) => x.s.id === s.replacement_for)?.s })).filter((p) => p.old);
  if (!pairs.length) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {pairs.map(({ e, nw, old }) => {
        const n = shortName(nw.staff?.full_name); const o = shortName(old!.staff?.full_name);
        return (
          <div key={nw.id} className="rp-done">
            <div className="row" style={{ gap: 8, alignItems: 'center' }}><i className="ib-tag ok">✓ REPLACED</i>{nw.responded_at && <span className="muted sm">{tTime(nw.responded_at)}</span>}</div>
            <b>{nw.staff?.full_name ?? '?'} in · {old!.staff?.full_name ?? '?'} out</b>
            <span>{n} {nw.status === 'confirmed' ? 'is confirmed (said yes)' : 'is booked'} · {roleName(roleOfShift(nw.position_code))} {t12(nw.planned_start)}. {o} {old!.attendance ? `was told “Thanks for telling us, you’re off ${dayShort(e.event_date)}”` : 'was told someone else is taking the spot'}. The manager sees the new name.</span>
          </div>
        );
      })}
      <div className="muted sm" style={{ padding: '0 6px' }}>Every step is in the event history.</div>
    </div>
  );
}
