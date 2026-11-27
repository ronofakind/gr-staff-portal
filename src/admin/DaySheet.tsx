// push 108 · Bookings revamp, part 1: the Day sheet (board BookingDaySheetV1, doc "G&R staff app booking day sheet (mapping)").
// One screen shaped like the Events sheet: each event = a block (MD / bar manager at the head, one row per staff line with its
// count, time and slots, + an extras line), "Free this day" on the right. Tap a slot → pick; drag a name to another slot / event /
// back to Free; × → back to Free; ↶ Undo = last move. New placements are pool shifts (staff see nothing until you confirm).
// Part 2 (push 109) = ✦ Fill the day / week / block, Clear, ⚑ more than 3 shifts, hover = why. Part 3 = click a name (person card, note, lock, confirm), part 4 = phone swap + retire Bookings / Day pool.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { UniPick } from '../components/UniPick';
import { createPortal } from 'react-dom';
import { defaultAnswerBy } from '../lib/myDates';
import type { ReactElement } from 'react';
/** Nov 26 · on the phone the time picker sits above everything (a portal), centred, with a dim backdrop */
const portalIf = (on: boolean, el: ReactElement) => (on ? createPortal(<div className="ds-tback" onClick={(ev) => ev.stopPropagation()}>{el}</div>, document.body) : el);
import { supabase } from '../lib/supabase';
import { UNIFORMS, addDays, dLabel, eventsBetween, isoDay, roleName, startIso, type AEvent, type AShift, type AStaff } from './api';
import { ReplaceSheet } from './Replace';
import { SendBox, pendingCount } from './SendBox';
import { ROLES } from './api';
import { LEAD, hm, isBar, isFar, layout, loadCtx, loadDay, planFill, weekCounts, whyText, type Av, type Ctx, type Cx, type Ev, type Line, type Row, type Sh, isNewStaff } from './dayFill';

type Op = { label: string; undo: () => PromiseLike<unknown> };
const TORD: Record<string, number> = { A: 0, B: 1, C: 2 };
/** Nov 13 · every 15 minutes, 6 AM → 3:45 AM (next day) */
const Q15 = Array.from({ length: 88 }, (_, k) => { const m = 6 * 60 + k * 15; return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
const ap = (t: string | null | undefined) => { if (!t) return 'TBC'; const h = Number(t.slice(0, 2)); return `${h % 12 || 12}${t.slice(2, 5)} ${h < 12 ? 'AM' : 'PM'}`; }; // Nov 23 · always 1:00 PM
const roleShort = (c: string) => ({ W: 'W', WW: 'WW', BT: 'BT', BB: 'BB', BUS: 'Bus', MD: 'MD', BM: 'BM' } as Record<string, string>)[c] ?? c;
const plural = (code: string, n: number) => { const r = roleName(code) || code; return n === 1 ? r : r.endsWith('s') ? r : r + 's'; };
const short = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : n; };
const monday = (d: string) => { const x = new Date(d + 'T12:00:00'); const k = (x.getDay() + 6) % 7; return addDays(d, -k); };

/** push 112 · old Day pool links land on the Day sheet. */
export function PoolToSheet() { const { date = isoDay(new Date()) } = useParams(); return <Navigate to={`/admin/day-sheet/${date}`} replace />; }

/** Nov 23 · v6 = Bookings V6 (boards AdminBookingsDayV6 + AdminBookingsEventDetailsV6), side by side with the Day sheet:
 *  staffing as a table (STAFF 0–50 · ROLE · START · END · NAMES · NOTES · ×), ✓ / ◷ marks, dashed open spots, no counts on rows,
 *  details in 4 groups with Estimate # and notes (Staff · MDs · Billing, migration 136), Free list with Floor / Bar tabs. */
export function DaySheet({ v6 = false }: { v6?: boolean } = {}) {
  const { date = isoDay(new Date()) } = useParams(); const nav = useNavigate(); const base = v6 ? '/admin/bookings-v6' : '/admin/day-sheet';
  const [priv, setPriv] = useState<Record<string, { estimate_no?: string | null; md_note?: string | null; billing_note?: string | null }>>({});
  const [fdept, setFdept] = useState<'floor' | 'bar'>('floor');
  const [dept, setDept] = useState<'floor' | 'bar' | 'both'>(() => { try { return (localStorage.getItem('gr_ds_dept') as 'floor' | 'bar' | 'both') || 'both'; } catch { return 'both'; } });
  const [evs, setEvs] = useState<Ev[]>([]); const [sh, setSh] = useState<Sh[]>([]); const [av, setAv] = useState<Av[]>([]); const [off, setOff] = useState<Set<string>>(new Set());
  const [staff, setStaff] = useState<AStaff[]>([]); const [week, setWeek] = useState<{ d: string; need: number; have: number; n: number; free: number }[]>([]);
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [ops, setOps] = useState<Op[]>([]); const [pick, setPick] = useState<{ e: Ev; code: string; start: string | null } | null>(null);
  // a ref, not state: setting state on drag start re-rendered the page and the browser dropped the drag (Ronnie, Nov 12)
  const dragR = useRef<Sh | { staff_id: string } | null>(null); const setDrag = (d: Sh | { staff_id: string } | null) => { dragR.current = d; }; const [tab, setTab] = useState<'yes' | 'maybe'>('yes');
  const [ctx, setCtx] = useState<Ctx | null>(null); const [wn, setWn] = useState<Record<string, number>>({}); const [why, setWhy] = useState<Record<string, string>>({}); const [card, setCard] = useState<Sh | null>(null);
  // push 122 · search a name (day you're on) · cancel with a reason (kept, counts or not) · week arrows
  const [cx, setCx] = useState<Cx[]>([]); const [find, setFind] = useState(''); const [hl, setHl] = useState<string | null>(null); const [cancelQ, setCancelQ] = useState<Sh | null>(null);
  // push 113 · line editing + cell grid
  const [ed, setEd] = useState<{ eid: string; key: string } | null>(null); const [edT, setEdT] = useState(''); const [add, setAdd] = useState<{ eid: string; code: string; count: string; t: string } | null>(null);
  const [flagged, setFlagged] = useState<Record<string, string>>({}); const [pend, setPend] = useState(0); const [sendOpen, setSendOpen] = useState(false);
  const [types, setTypes] = useState<string[]>([]); const [detTick, setDetTick] = useState(0); const [more, setMore] = useState(false); const [newQ, setNewQ] = useState<string | null>(null);
  useEffect(() => { supabase.from('event_types').select('name,sort').order('sort').then(({ data }) => setTypes(((data ?? []) as { name: string }[]).map((x) => x.name))); }, []);
  // Nov 23 · V6: event details start hidden (own key, so the old Day sheet keeps its choice)
  const detK = (id: string) => (v6 ? 'gr_v6_det_' : 'gr_ds_det_') + id;
  const detOpen = (id: string) => { void detTick; try { const v = localStorage.getItem(detK(id)); return v6 ? v === '1' : v !== '0'; } catch { return !v6; } };
  const togDet = (id: string) => { try { localStorage.setItem(detK(id), detOpen(id) ? '0' : '1'); } catch { /* */ } setDetTick((t) => t + 1); };
  const blocksR = useRef<HTMLDivElement | null>(null); const [cols, setCols] = useState(4); const [lineEd, setLineEd] = useState<string | null>(null); const [endK, setEndK] = useState<string | null>(null); const [narrow, setNarrow] = useState(false); const [phOpen, setPhOpen] = useState<string | null>(null);
  // Nov 26 · phone top (week strip) + Free sheet (Book / Ask)
  const [phFind, setPhFind] = useState(false); const [freeOpen, setFreeOpen] = useState(false); const [fsDept, setFsDept] = useState<'floor' | 'bar'>('floor');
  const [bookFor, setBookFor] = useState<string | null>(null); const [askQ, setAskQ] = useState<{ ids: string[]; ev: string; t: string } | null>(null);
  const [weekly, setWeekly] = useState<{ staff_id: string; status: string; from_time: string | null }[]>([]); const [asked, setAsked] = useState<Record<string, string>>({});
  // push 119 · Ronnie: "a little squished" → Free this day folds to a thin tab, END ~ column can be hidden (both remembered)
  const ls0 = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
  const [freeFold, setFreeFold] = useState(() => ls0('gr_ds_freefold')); const [noEnd, setNoEnd] = useState(() => ls0('gr_ds_noend'));
  useEffect(() => { try { localStorage.setItem('gr_ds_freefold', freeFold ? '1' : '0'); localStorage.setItem('gr_ds_noend', noEnd ? '1' : '0'); } catch { /* */ } }, [freeFold, noEnd]); const [repl, setRepl] = useState<{ s: AShift; e: AEvent } | null>(null);
  useEffect(() => { loadCtx().then((c) => { setCtx(c); setStaff(c.staff); }).catch((x) => setErr((x as Error).message)); }, []);
  useEffect(() => { try { localStorage.setItem('gr_ds_dept', dept); } catch { /* */ } }, [dept]);
  const wk0 = monday(date);
  useEffect(() => { setPhOpen(null); setFreeOpen(false); setAsked({}); }, [date]);
  useEffect(() => { if (!freeOpen) return; const dw = (new Date(date + 'T12:00:00').getDay() + 6) % 7;
    supabase.from('staff_weekly').select('staff_id,status,from_time').eq('dow', dw).neq('status', 'no').then(({ data }) => setWeekly((data ?? []) as { staff_id: string; status: string; from_time: string | null }[])); }, [freeOpen, date]);

  useEffect(() => { (async () => {
    try { const d = await loadDay(date); setEvs(d.evs); setSh(d.sh); setAv(d.av); setOff(d.off); setCx(d.cx); } catch (x) { setErr((x as Error).message); }
  })(); }, [date, tick]);
  useEffect(() => { weekCounts(wk0, addDays(wk0, 6)).then(setWn); }, [wk0, tick]);
  useEffect(() => { if (!v6 || !evs.length) return; supabase.from('event_private').select('event_id,estimate_no,md_note,billing_note').in('event_id', evs.map((e) => e.id))
    .then(({ data, error }) => { if (error) return; setPriv(Object.fromEntries(((data ?? []) as { event_id: string; estimate_no: string | null; md_note: string | null; billing_note: string | null }[]).map((r) => [r.event_id, r]))); }); }, [v6, evs, tick]);
  useEffect(() => { const ids = evs.map((e) => e.id); if (!ids.length) { setPend(0); return; } pendingCount(ids).then(setPend); }, [evs, tick]);
  const noEndR = useRef(noEnd); noEndR.current = noEnd;
  // C · as many equal cells across as fit (Ronnie, Nov 12): one count for the whole sheet so every block lines up
  useEffect(() => { const el = blocksR.current; if (!el) return; const f = () => { const w = el.clientWidth; const phone = window.innerWidth <= 700 || w < 760; setNarrow(w < 760);
      setCols(phone ? 1 : v6 && w >= 760 ? Math.max(3, Math.min(6, Math.floor((w - 380) / 150))) : 3); }; // Nov 23 · V6: as many name columns as fit (3–6) // Nov 16 · like the Events sheet: names in 3 columns (E–G), full names · phone 2
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, [evs.length, noEnd, freeFold, v6]);

  // week strip
  useEffect(() => { (async () => {
    const to = addDays(wk0, 6);
    const { data: we } = await supabase.from('events').select('id,event_date,department,staffing,staff_needed,extras').gte('event_date', wk0).lte('event_date', to);
    const ids = ((we ?? []) as { id: string }[]).map((x) => x.id);
    const [{ data: ws }, { data: wa }] = await Promise.all([
      supabase.from('shifts').select('event_id').in('event_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).neq('status', 'declined').is('attendance', null),
      supabase.from('availability').select('for_date,staff_id,status,released_at').gte('for_date', wk0).lte('for_date', to).eq('status', 'yes').is('released_at', null)]);
    const byEv: Record<string, number> = {}; for (const r of (ws ?? []) as { event_id: string }[]) byEv[r.event_id] = (byEv[r.event_id] ?? 0) + 1;
    const out = [...Array(7)].map((_, i) => { const d = addDays(wk0, i); const de = ((we ?? []) as { id: string; event_date: string; department: string; staffing: Line[] | null; staff_needed: number; extras: number | null }[]).filter((x) => x.event_date === d);
      // Nov 25 · same count as the day totals: rows + extras (10 % on big floor events when not set)
      const need = de.reduce((n, x) => { const c = (x.staffing ?? []).reduce((m, l) => m + (l.count || 0), 0); if (!c) return n + (x.staff_needed || 0); return n + c; }, 0); // Nov 26 · extras are on top: 60/57, not 60/60
      const have = de.reduce((n, x) => n + (byEv[x.id] ?? 0), 0); return { d, need, have, n: de.length, free: ((wa ?? []) as { for_date: string }[]).filter((x) => x.for_date === d).length }; });
    setWeek(out);
  })(); }, [wk0, tick]);

  const byId = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const tier = (id: string) => byId[id]?.staff_private?.tier ?? null;
  const rank = (id: string) => byId[id]?.staff_private?.ranking ?? 9999;
  const rkOf = (id: string) => (TORD[tier(id) ?? ''] ?? 9) * 100000 + rank(id);
  const sortP = (a: string, b: string) => (TORD[tier(a) ?? ''] ?? 9) - (TORD[tier(b) ?? ''] ?? 9) || rank(a) - rank(b);
  const onDay = new Set(sh.map((s) => s.staff_id));
  const shown = evs.filter((e) => dept === 'both' || (dept === 'bar') === isBar(e));
  const aDept = (a: Av) => a.avail_asks?.department ?? byId[a.staff_id]?.department ?? 'floor';
  const inDept = (a: Av) => dept === 'both' || (aDept(a) === 'bar') === (dept === 'bar');
  const inFree = (a: Av) => (v6 && dept === 'both' ? (aDept(a) === 'bar') === (fdept === 'bar') : inDept(a));
  const free = av.filter((a) => inFree(a) && a.status === tab && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).sort((a, b) => sortP(a.staff_id, b.staff_id));
  const nYes = av.filter((a) => inDept(a) && a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).length;
  const nMaybe = av.filter((a) => inDept(a) && a.status === 'maybe' && !a.released_at && !onDay.has(a.staff_id)).length;
  const lays = useMemo(() => Object.fromEntries(evs.map((e) => [e.id, layout(e, sh.filter((s) => s.event_id === e.id), rkOf)])), [evs, sh, staff]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nov 13 · the manager's EXTRA tag = who sits on the Extras line here (automatic rows only; your own picks stay)
  const xSent = useRef<Record<string, string>>({});
  useEffect(() => { if (!ctx) return;
    for (const e of evs) { const L = lays[e.id]; if (!L) continue; const ids = L.extras.people.map((x) => x.id).sort(); const sig = ids.join(',');
      if (xSent.current[e.id] === sig) continue; xSent.current[e.id] = sig;
      supabase.rpc('admin_set_extras', { p_event: e.id, p_shifts: ids }).then(({ error }) => { if (error) delete xSent.current[e.id]; }); } }, [lays, ctx]); // eslint-disable-line react-hooks/exhaustive-deps
  const tot = (b: boolean) => evs.filter((e) => isBar(e) === b).reduce((acc, e) => { const L = lays[e.id]; const need = L.client; const have = sh.filter((s) => s.event_id === e.id).length; return [acc[0] + have, acc[1] + need]; }, [0, 0]);
  const [fl, br] = [tot(false), tot(true)];
  const removable = (s: Sh) => s.pool_hold && !s.locked;

  const run = async (f: () => Promise<Op | string | void>) => { setBusy(true); setErr(''); setMsg('');
    try { const r = await f(); if (r && typeof r === 'object') setOps((o) => [...o.slice(-29), r]); else if (typeof r === 'string') setMsg(r); } catch (x) { setErr((x as Error).message); }
    setBusy(false); setTick((t) => t + 1); };
  const place = (staffId: string, e: Ev, code: string, start: string | null) => run(async () => {
    const t = start ?? e.start_time?.slice(0, 5) ?? '17:00';
    const { data, error } = await supabase.from('shifts').insert({ event_id: e.id, staff_id: staffId, position_code: code, position_detail: roleName(code), planned_start: startIso(date, t), status: 'booked', pool_hold: true,
      time_tbc: !!(e.start_tbc || e.details_pending || (e.staffing ?? []).some((l) => l.tbc && l.code === code && l.start === t)) }).select('id').single(); if (error) throw error;
    const id = (data as { id: string }).id; return { label: `placed ${byId[staffId]?.full_name ?? ''}`, undo: () => supabase.from('shifts').delete().eq('id', id).eq('pool_hold', true).then() };
  });
  // push 114 · anyone can be dragged / removed. Placed (not sent) = silent; already sent = asked first, then the notice waits in About to send.
  const nm0 = (s: Sh) => byId[s.staff_id]?.full_name ?? '…';
  const sentTxt = (s: Sh) => s.status === 'confirmed' ? 'confirmed' : s.notified_at ? 'sent (not confirmed yet)' : 'booked';
  // push 115 · how to tell them (Ronnie, Nov 12): 1 send now + alert · 2 send now, no alert · 3 About to send (default) · 4 don't tell them
  type Tell = 'buzz' | 'soft' | 'later' | 'skip';
  const [tellQ, setTellQ] = useState<{ who: Sh[]; what: string; notice: string; res: (t: Tell | null) => void } | null>(null);
  const askTell = (who: Sh[], what: string, notice: string): Promise<Tell | null> => { const sent = who.filter((x) => !x.pool_hold); if (!sent.length) return Promise.resolve('later');
    return new Promise((res) => setTellQ({ who: sent, what, notice, res: (t) => { setTellQ(null); res(t); } })); };
  const tell = async (who: Sh[], t: Tell | null) => {
    const sent = [...new Set(who.filter((x) => !x.pool_hold).map((x) => x.staff_id))]; if (!sent.length || !t || t === 'later') return sent.length ? ' · waiting in About to send' : ' · no notification (not sent yet)';
    for (const id of sent) { const { error } = await supabase.rpc('admin_send_staff_changes', { p_staff: id, p_events: evs.map((e) => e.id), p_mode: t }); if (error) throw error; }
    return t === 'skip' ? ' · nobody told (you told them yourself)' : t === 'buzz' ? ' · sent now with a phone alert' : ' · sent now, no alert';
  };
  const remove = (s: Sh) => run(async () => {
    const ev = evs.find((x) => x.id === s.event_id);
    const how = await askTell([s], `Back to Free = off ${ev?.venues?.name ?? ev?.title ?? 'this event'}.`, 'Shift removed'); if (!how) return;
    if (s.pool_hold && s.locked && !confirm(`${nm0(s)} is locked 🔒. Back to Free anyway?`)) return;
    const { data: row } = await supabase.from('shifts').select('*').eq('id', s.id).single();
    const { error } = await supabase.from('shifts').delete().eq('id', s.id); if (error) throw error;
    if (!s.pool_hold) await supabase.rpc('admin_shift_note', { p_staff: s.staff_id, p_kind: 'removed', p_shift: null, p_alert: null, p_meta: { date, venue: ev?.venues?.name ?? ev?.title, event_id: s.event_id } });
    setMsg(`${short(nm0(s))} back to Free${await tell([s], how)}.`);
    return { label: `removed ${nm0(s)}`, undo: () => supabase.from('shifts').insert(row as Record<string, unknown>).then() };
  });
  const move = (s: Sh, e: Ev, code: string, start: string | null) => run(async () => {
    const t = start ?? e.start_time?.slice(0, 5) ?? '17:00';
    if (s.event_id === e.id && hm(s.planned_start) === t && (s.position_code ?? '') === code) return;
    const how = await askTell([s], `Move to ${e.venues?.name ?? e.title} · ${roleName(code)} ${ap(t)}.`, 'Your shift changed'); if (!how) return;
    const before = { event_id: s.event_id, position_code: s.position_code, position_detail: s.position_detail ?? null, planned_start: s.planned_start };
    const { error } = await supabase.from('shifts').update({ event_id: e.id, position_code: code, position_detail: roleName(code), planned_start: startIso(date, t) }).eq('id', s.id); if (error) throw error;
    setMsg(`Moved ${short(nm0(s))}${await tell([s], how)}.`);
    return { label: `moved ${nm0(s)}`, undo: () => supabase.from('shifts').update(before).eq('id', s.id).then() };
  });
  const findRes = useMemo(() => { const w = find.trim().toLowerCase().split(/\s+/).filter(Boolean); if (w.join('').length < 2) return [];
    const hit = (n: string) => w.every((x) => n.toLowerCase().includes(x));
    const on = sh.filter((x) => hit(byId[x.staff_id]?.full_name ?? '')).map((x) => { const e = evs.find((y) => y.id === x.event_id); return { id: x.staff_id, name: byId[x.staff_id]?.full_name ?? '…', where: `${e?.venues?.name ?? e?.title ?? ''}${e && isBar(e) ? ' bar' : ''} · ${roleName(x.position_code)} ${ap(hm(x.planned_start))}${x.status === 'confirmed' ? ' ✓' : ''}`, on: true }; });
    const off0 = staff.filter((p) => p.active && hit(p.full_name) && !onDay.has(p.id)).slice(0, 6).map((p) => { const a = av.find((x) => x.staff_id === p.id && !x.released_at);
      return { id: p.id, name: p.full_name, where: `not on today · ${a ? (a.status === 'yes' ? 'free (said yes) · drag from Free' : a.status) : 'not asked'}`, on: false }; });
    return [...on, ...off0].slice(0, 8); }, [find, sh, staff, av]); // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = (sid: string) => { setHl(sid); setTimeout(() => { const el = document.querySelector(`[data-sid="${sid}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); else { setFreeFold(false); setTab('yes'); } }, 50); };
  /** push 122 · cancel with a reason: kept on their record (Reliability), counts in ranking or not, nothing sent to them; their MD sees them crossed out. */
  const doCancel = (s0: Sh, reason: string, note: string, counts: boolean, replace: boolean) => run(async () => {
    setCancelQ(null); setCard(null); const now = new Date().toISOString();
    const { data: b } = await supabase.from('shifts').select('attendance,cancelled_at,cancel_reason,cancel_note,cancel_late,cancel_self,cancel_sent_to_manager').eq('id', s0.id).single();
    const { error } = await supabase.from('shifts').update({ attendance: 'cancelled', cancelled_at: now, cancel_reason: reason, cancel_note: note.trim() || null, cancel_late: counts, cancel_self: false, cancel_sent_to_manager: now }).eq('id', s0.id); if (error) throw error;
    setMsg(`${short(nm0(s0))} cancelled · ${reason}${counts ? ' · counts as a late cancel' : ' · excused (not counted)'} · nothing sent to them.`);
    if (replace) { const e = evs.find((x) => x.id === s0.event_id); if (e) setTimeout(() => setPick({ e, code: s0.position_code ?? 'W', start: hm(s0.planned_start) || null }), 300); }
    return { label: `cancelled ${nm0(s0)}`, undo: () => supabase.from('shifts').update(b as Record<string, unknown>).eq('id', s0.id).then() };
  });
  const unCancel = (c0: Cx) => run(async () => {
    const { error } = await supabase.from('shifts').update({ attendance: null, cancelled_at: null, cancel_reason: null, cancel_note: null, cancel_late: false, cancel_sent_to_manager: null }).eq('id', c0.id); if (error) throw error;
    const b = { attendance: 'cancelled', cancelled_at: c0.cancelled_at, cancel_reason: c0.cancel_reason, cancel_note: c0.cancel_note, cancel_late: c0.cancel_late };
    return { label: `un-cancelled ${nm0(c0)}`, undo: () => supabase.from('shifts').update(b).eq('id', c0.id).then() };
  });
  /** push 110 · person card: one change = one undo step. */
  const patch = (s0: Sh, row: Record<string, unknown>, label: string) => run(async () => {
    const big = ['planned_start', 'position_code', 'staff_id', 'event_id'].some((k) => k in row);
    const how = big ? await askTell([s0], `Change: ${label}.`, row.staff_id ? 'Shift removed' : 'Your shift changed') : 'later'; if (!how) return;
    const keys = Object.keys(row); const { data: b, error: e0 } = await supabase.from('shifts').select(keys.join(',')).eq('id', s0.id).single(); if (e0) throw e0;
    const { error } = await supabase.from('shifts').update(row).eq('id', s0.id); if (error) throw error;
    if (big) setMsg(`${label} · ${short(nm0(s0))}${await tell([s0], how)}.`);
    return { label: `${label} · ${byId[s0.staff_id]?.full_name ?? ''}`, undo: () => supabase.from('shifts').update(b as unknown as Record<string, unknown>).eq('id', s0.id).then() };
  });
  /** push 117 · they told Ronnie yes by text / call: confirmed, nothing sent (placed ones skip the confirmation request too). */
  const markConfirmed = (s0: Sh) => run(async () => {
    const { data: me } = await supabase.rpc('me'); const now = new Date().toISOString();
    const { data: b } = await supabase.from('shifts').select('pool_hold,notified_at,status,responded_at,confirmed_by').eq('id', s0.id).single();
    const { error } = s0.pool_hold
      ? await supabase.from('shifts').update({ pool_hold: false, notified_at: now, status: 'confirmed', responded_at: now, confirmed_by: me ?? null }).eq('id', s0.id)
      : await supabase.rpc('admin_mark_confirmed', { p_shift: s0.id, p_on: true });
    if (error) throw error; setCard(null);
    setMsg(`✓ ${short(nm0(s0))} marked confirmed · no message sent.`);
    return { label: `confirmed ${nm0(s0)}`, undo: () => supabase.from('shifts').update(b as Record<string, unknown>).eq('id', s0.id).then() };
  });
  const lockAll = () => run(async () => {
    const xs = sh.filter((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? '') && shown.some((e) => e.id === x.event_id));
    if (!xs.length) return 'Nothing to lock: everyone placed is already locked.';
    const ids = xs.map((x) => x.id); const { error } = await supabase.from('shifts').update({ locked: true, locked_at: new Date().toISOString() }).in('id', ids); if (error) throw error;
    return { label: `locked ${ids.length}`, undo: () => supabase.from('shifts').update({ locked: null, locked_at: null }).in('id', ids).then() };
  });
  const confirmDay = () => run(async () => {
    const hold = sh.filter((x) => x.pool_hold && shown.some((e) => e.id === x.event_id));
    const open = shown.reduce((n, e) => { const L = lays[e.id]; return n + Math.max(0, L.client + L.extras.count - sh.filter((x) => x.event_id === e.id).length); }, 0);
    const tbc = shown.filter((e) => e.start_tbc || e.details_pending).map((e) => e.venues?.name ?? e.title);
    const left = av.filter((a) => inDept(a) && ['yes', 'maybe', 'asked'].includes(a.status) && !a.released_at && !onDay.has(a.staff_id)).length;
    if (!confirm([`Send ${hold.length} confirmation${hold.length === 1 ? '' : 's'} for ${dLabel(date, { weekday: 'long', month: 'short', day: 'numeric' })}${dept !== 'both' ? ` (${dept})` : ''}?`,
      open ? `⚠ ${open} slot${open === 1 ? '' : 's'} still open.` : '', tbc.length ? `⚠ Start time / venue still to come: ${tbc.join(', ')}.` : '',
      `${left} not placed are released: they see nothing and stay as backups.`, 'This can\'t be undone from here.'].filter(Boolean).join('\n'))) return;
    const { data, error } = await supabase.rpc('admin_day_confirm', { p_date: date, p_dept: dept }); if (error) throw error;
    const r = data as { confirmed: number; released: number }; setOps([]); return `✓ ${r.confirmed} confirmations sent · ${r.released} released (backups).`;
  });
  // Nov 25 · the Undo bar shows for 5 s after each change, then hides (the steps stay; More → Undo)
  const [fabOn, setFabOn] = useState(false); const opsN = useRef(0);
  useEffect(() => { const grew = ops.length > opsN.current; opsN.current = ops.length; if (!grew) return; setFabOn(true); const id = setTimeout(() => setFabOn(false), 5000); return () => clearTimeout(id); }, [ops.length]);
  const undo = () => { const last = ops[ops.length - 1]; if (!last) return; setOps((o) => o.slice(0, -1)); run(async () => { await last.undo(); return `Undone: ${last.label}.`; }); };
  /** ✦ one move: fills the open slots of these events (Floor / Bar switch respected). Undo takes the whole fill back. */
  const insertPlan = async (rows: Row[], w: Record<string, string>, label: string, extra: string): Promise<Op | string> => {
    if (!rows.length) return `Nothing to place${extra}: no open slots, or nobody free who fits (said yes, from time, department, rules).`;
    const { data, error } = await supabase.from('shifts').insert(rows).select('id,event_id,staff_id'); if (error) throw error;
    const ins = (data ?? []) as { id: string; event_id: string; staff_id: string }[]; const ids = ins.map((x) => x.id);
    setWhy((o) => { const n = { ...o }; for (const x of ins) { const k = `${x.event_id}|${x.staff_id}`; if (w[k]) n[x.id] = w[k]; } return n; });
    setMsg(`✦ Placed ${rows.length}${extra}. Hover a name to see why · ↶ Undo takes the whole fill back · staff see nothing yet.`);
    return { label: `${label} (${rows.length})`, undo: () => supabase.from('shifts').delete().in('id', ids).eq('pool_hold', true).then() };
  };
  const note = (held: string[], flags: string[]) => [held.length ? ` · ${held.length} at $18 kept free (event type not cocktail / dînatoire / stations)` : '', flags.length ? ` · ⚑ more than 3 shifts this week: ${[...new Set(flags)].join(', ')}` : ''].join('');
  const fillDay = (only?: Ev) => run(async () => {
    if (!ctx) throw new Error('Still loading…'); const d = await loadDay(date); const n = await weekCounts(wk0, addDays(wk0, 6));
    const targets = only ? d.evs.filter((x) => x.id === only.id) : d.evs.filter((x) => dept === 'both' || (dept === 'bar') === isBar(x));
    const p = planFill(d, targets, ctx, n); const r = await insertPlan(p.rows, p.why, only ? `✦ ${only.venues?.name ?? only.title}` : '✦ Fill the day', note(p.held, p.flags));
    if (typeof r === 'string') return r; return r;
  });
  const fillWeek = () => run(async () => {
    if (!ctx) throw new Error('Still loading…'); const today = isoDay(new Date()); const n = await weekCounts(wk0, addDays(wk0, 6));
    const rows: Row[] = []; const w: Record<string, string> = {}; const held: string[] = []; const flags: string[] = []; const days: string[] = [];
    for (let i = 0; i < 7; i++) { const dd = addDays(wk0, i); if (dd < today) continue; const d = await loadDay(dd); if (!d.evs.length) continue;
      const p = planFill(d, d.evs.filter((x) => dept === 'both' || (dept === 'bar') === isBar(x)), ctx, n);
      rows.push(...p.rows); Object.assign(w, p.why); held.push(...p.held); flags.push(...p.flags); if (p.rows.length) days.push(dLabel(dd, { weekday: 'short' })); }
    return insertPlan(rows, w, '✦ Fill the week', `${days.length ? ` on ${days.join(', ')}` : ''}${note([...new Set(held)], flags)}`);
  });
  /** Clear = everyone placed but not locked / not sent back to Free (MDs, bar managers, locked, sent stay). */
  const clear = (only?: Ev) => run(async () => {
    const xs = sh.filter((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? '') && (only ? x.event_id === only.id : shown.some((e) => e.id === x.event_id)));
    if (!xs.length) return 'Nothing to clear: only placed people that are not locked or sent go back to Free.';
    if (!confirm(`Put ${xs.length} placed ${xs.length === 1 ? 'person' : 'people'} back in Free${only ? ` (${only.venues?.name ?? only.title})` : ''}? Locked, sent, MDs and bar managers stay. ↶ Undo brings them back.`)) return;
    const { data: rows } = await supabase.from('shifts').select('*').in('id', xs.map((x) => x.id));
    const { error } = await supabase.from('shifts').delete().in('id', xs.map((x) => x.id)).eq('pool_hold', true); if (error) throw error;
    return { label: `cleared ${xs.length}`, undo: () => supabase.from('shifts').insert((rows ?? []) as Record<string, unknown>[]).then() };
  });
  /** push 113 · change a line (count / time / add) right on the Day sheet. Saves to the event like the event form. */
  // Nov 25 · rows always saved manager first, then by start time (TBC rows last)
  const sortLines = (ls: Line[]) => [...ls].sort((a, b) => (LEAD.includes(a.code) ? 0 : 1) - (LEAD.includes(b.code) ? 0 : 1) || (a.tbc ? 1 : 0) - (b.tbc ? 1 : 0) || (a.start ?? '').localeCompare(b.start ?? ''));
  const lineSave = (e: Ev, next0: Line[], label: string, moves: { s: Sh; t: string }[] = []) => run(async () => { const next = sortLines(next0);
    const sent = moves.filter((m) => !m.s.pool_hold);
    const how = sent.length ? await askTell(sent.map((m) => m.s), `${label}: ${ap(hm(sent[0].s.planned_start))} → ${ap(sent[0].t)}.`, 'Your shift changed') : 'later'; if (!how) return;
    const before = { staffing: e.staffing, staff_needed: e.staff_needed, start_time: e.start_time };
    const starts = next.map((l) => l.start).filter(Boolean).sort() as string[];
    const row = { staffing: next, staff_needed: next.reduce((n, l) => n + (l.count || 0), 0), start_time: starts[0] ?? e.start_time };
    const { error } = await supabase.from('events').update(row).eq('id', e.id); if (error) throw error;
    const old = moves.map((m) => ({ id: m.s.id, planned_start: m.s.planned_start }));
    for (const m of moves) { const { error: e2 } = await supabase.from('shifts').update({ planned_start: startIso(date, m.t) }).eq('id', m.s.id); if (e2) throw e2; }
    if (sent.length) setMsg(`Saved${await tell(sent.map((m) => m.s), how)}.`);
    return { label: `${label} · ${e.venues?.name ?? e.title}`, undo: async () => { await supabase.from('events').update(before).eq('id', e.id); for (const o of old) await supabase.from('shifts').update({ planned_start: o.planned_start }).eq('id', o.id); } };
  });
  const setCount = (e: Ev, idx: number, n: number) => {
    const st = [...(e.staffing ?? [])]; const l = st[idx]; if (!l || n < 0) return;
    if (n === 0 && !confirm(`Remove the line "${l.count} ${plural(l.code, l.count)} ${ap(l.start)}"?`)) return;
    const L = lays[e.id]; const line = L.lines.find((x) => x.idx === idx);
    if (line && n < line.people.length) { const over = [...line.people].sort((a, b) => rkOf(a.staff_id) - rkOf(b.staff_id)).slice(n);
      setFlagged((f) => { const g = { ...f }; for (const x of over) g[x.id] = `${plural(l.code, 2)} ${ap(l.start)} lowered to ${n}`; return g; }); }
    if (n === 0) st.splice(idx, 1); else st[idx] = { ...l, count: n };
    lineSave(e, st, `${plural(l.code, 2)} ${ap(l.start)} → ${n}`);
  };
  const setTime = (e: Ev, idx: number, t: string) => {
    const st = [...(e.staffing ?? [])]; const l = st[idx]; if (!l || !t) return; setEd(null);
    const line = lays[e.id].lines.find((x) => x.idx === idx);
    const moves = (line?.people ?? []).filter((x) => hm(x.planned_start) === line?.start).map((x) => ({ s: x, t }));
    if (l.tbc) { const ids = (line?.people ?? []).map((x) => x.id); if (ids.length) void supabase.from('shifts').update({ time_tbc: false }).in('id', ids); }
    st[idx] = { ...l, start: t, tbc: false }; lineSave(e, st, `${plural(l.code, 2)} → ${ap(t)}`, moves);
  };
  /** Nov 25 · a row's start can be TBC (staff see "Time TBC" until it's set). */
  const setTbc = (e: Ev, idx: number) => {
    const st = [...(e.staffing ?? [])]; const l = st[idx]; if (!l) return; setEd(null);
    const ids = (lays[e.id].lines.find((x) => x.idx === idx)?.people ?? []).map((x) => x.id); if (ids.length) void supabase.from('shifts').update({ time_tbc: true }).in('id', ids);
    st[idx] = { ...l, tbc: true }; lineSave(e, st, `${plural(l.code, 2)} → TBC`);
  };
  /** Nov 13 · MD / bar manager start: the lead line's time + the leads on it move with it (asked first if already sent). */
  const setLeadTime = (e: Ev, t: string) => { if (!t) return; setEd(null);
    const st = [...(e.staffing ?? [])]; const i = st.findIndex((l) => LEAD.includes(l.code));     if (i >= 0) st[i] = { ...st[i], start: t }; else st.unshift({ dept: isBar(e) ? 'bar' : 'floor', code: isBar(e) ? 'BM' : 'MD', count: 1, start: t });
    const moves = sh.filter((x) => x.event_id === e.id && LEAD.includes(x.position_code ?? '') && hm(x.planned_start) !== t).map((x) => ({ s: x, t }));
    lineSave(e, st, `${isBar(e) ? 'Bar managers' : 'MD'} → ${ap(t)}`, moves); };
  /** push 114 · how many MDs / bar managers: the MD (BM) line in the event's staffing. */
  const setLeads = (e: Ev, n: number) => {
    if (n < 0) return; const code = isBar(e) ? 'BM' : 'MD'; const st = [...(e.staffing ?? [])]; const i = st.findIndex((l) => LEAD.includes(l.code));
    const have = sh.filter((x) => x.event_id === e.id && LEAD.includes(x.position_code ?? '')).length;
    if (n < have && !confirm(`${have} ${code === 'MD' ? 'MD' : 'bar manager'}${have > 1 ? 's are' : ' is'} on this event. Lower to ${n} anyway? (Nobody is taken off: drag one to Free if needed.)`)) return;
    if (i >= 0) { if (n === 0) st.splice(i, 1); else st[i] = { ...st[i], count: n }; }
    else if (n > 0) st.unshift({ dept: isBar(e) ? 'bar' : 'floor', code, count: n, start: e.start_time?.slice(0, 5) ?? null });
    lineSave(e, st, `${code === 'MD' ? 'MDs' : 'bar managers'} → ${n}`);
  };
  /** push 116 · extras line time (events.extras_start). People on the extras line move with it (asked first if already sent). */
  const setExtrasTime = (e: Ev, t: string) => run(async () => {
    setEd(null); const L = lays[e.id]; const who = L.extras.people.filter((x) => hm(x.planned_start) === L.extras.start);
    const how = await askTell(who, `Extras: ${ap(L.extras.start)} → ${ap(t)}.`, 'Your shift changed'); if (!how) return;
    const b = e.extras_start ?? null; const { error } = await supabase.from('events').update({ extras_start: t }).eq('id', e.id); if (error) throw error;
    const old = who.map((x) => ({ id: x.id, p: x.planned_start }));
    for (const x of who) await supabase.from('shifts').update({ planned_start: startIso(date, t) }).eq('id', x.id);
    if (who.some((x) => !x.pool_hold)) setMsg(`Extras → ${ap(t)}${await tell(who, how)}.`);
    return { label: `extras → ${ap(t)}`, undo: async () => { await supabase.from('events').update({ extras_start: b }).eq('id', e.id); for (const o of old) await supabase.from('shifts').update({ planned_start: o.p }).eq('id', o.id); } };
  });
  const setExtras = (e: Ev, n: number) => run(async () => { const b = e.extras ?? null; const { error } = await supabase.from('events').update({ extras: Math.max(0, n) }).eq('id', e.id); if (error) throw error;
    return { label: `extras → ${n}`, undo: () => supabase.from('events').update({ extras: b }).eq('id', e.id).then() }; });
  const addLine = () => { if (!add) return; const e = evs.find((x) => x.id === add.eid); const n = parseInt(add.count, 10); if (!e || !(n > 0) || !add.t) return;
    const isTbc = add.t === 'TBC'; const t0 = isTbc ? ((e.staffing ?? []).slice(-1)[0]?.start ?? e.start_time?.slice(0, 5) ?? '17:00') : add.t;
    if (add.code === 'EX') { const a0 = add; setAdd(null); run(async () => { const b = { extras: e.extras ?? null, extras_start: e.extras_start ?? null };
      const { error } = await supabase.from('events').update({ extras: n, extras_start: isTbc ? null : a0.t }).eq('id', e.id); if (error) throw error;
      return { label: `+ ${n} extras ${isTbc ? 'TBC' : ap(a0.t)}`, undo: () => supabase.from('events').update(b).eq('id', e.id).then() }; }); return; }
    const dept = (ROLES.find((r) => r.code === add.code)?.dept ?? (isBar(e) ? 'bar' : 'floor')) as 'bar' | 'floor';
    const st = [...(e.staffing ?? []), { dept, code: add.code, count: n, start: t0, ...(isTbc ? { tbc: true } : {}) }]; setAdd(null); lineSave(e, st, `+ ${n} ${plural(add.code, n)} ${isTbc ? 'TBC' : ap(t0)}`); };
  /** push 118 · details right in the card (saves like the event form; staff see it in the app, no message). */
  const saveEv = (e: Ev, row: Record<string, unknown>, label: string) => run(async () => {
    const keys = Object.keys(row); const before = Object.fromEntries(keys.map((k) => [k, (e as unknown as Record<string, unknown>)[k] ?? null]));
    const { error } = await supabase.from('events').update(row).eq('id', e.id); if (error) throw error;
    return { label: `${label} · ${e.venues?.name ?? e.title}`, undo: () => supabase.from('events').update(before).eq('id', e.id).then() };
  });
  const savePriv = (e: Ev, row: Record<string, string | null>, label: string) => run(async () => {
    const b = Object.fromEntries(Object.keys(row).map((k) => [k, (priv[e.id] as Record<string, string | null> | undefined)?.[k] ?? null]));
    const { error } = await supabase.from('event_private').upsert({ event_id: e.id, ...row }, { onConflict: 'event_id' }); if (error) throw new Error(/column/.test(error.message) ? 'Estimate # and notes need migration 136.' : error.message);
    return { label: `${label} · ${e.venues?.name ?? e.title}`, undo: () => supabase.from('event_private').upsert({ event_id: e.id, ...b }, { onConflict: 'event_id' }).then() };
  });
  const saveClient = (e: Ev, cid: string) => run(async () => {
    const c = ctx?.clients.find((x) => x.id === cid); const b = { client_id: e.event_private?.client_id ?? null, client: e.event_private?.client ?? null };
    const { error } = await supabase.from('event_private').upsert({ event_id: e.id, client_id: cid || null, client: c?.name ?? null }, { onConflict: 'event_id' }); if (error) throw error;
    return { label: `client → ${c?.name ?? '—'}`, undo: () => supabase.from('event_private').upsert({ event_id: e.id, ...b }, { onConflict: 'event_id' }).then() };
  });
  /** Nov 16 · event name = what staff see as the title · default "Venue · Type", still editable (a typed name is kept). */
  const autoName = (v?: string | null, t?: string | null) => [v, t].filter(Boolean).join(' · ');
  const isAuto = (e: Ev) => !e.title || e.title === 'New event' || e.title === 'Details to come' || e.title === e.venues?.name || e.title === autoName(e.venues?.name, e.event_type);
  const setVenue = (e: Ev, vid: string) => { const v = ctx?.venues.find((x) => x.id === vid); const row: Record<string, unknown> = { venue_id: vid || null };
    if (v && isAuto(e)) row.title = autoName(v.name, e.event_type); saveEv(e, row, `venue → ${v?.name ?? '—'}`); };
  const setType = (e: Ev, t: string) => { const row: Record<string, unknown> = { event_type: t || null };
    if (isAuto(e) && (e.venues?.name || t)) row.title = autoName(e.venues?.name, t || null) || 'New event'; saveEv(e, row, `type → ${t || '—'}`); };
  const setLineField = (e: Ev, idx: number, patch2: Partial<Line> & { end?: string | null }, label: string) => { const st = [...(e.staffing ?? [])]; if (!st[idx]) return; st[idx] = { ...st[idx], ...patch2 } as Line; lineSave(e, st, label); };
  const setRole = (e: Ev, idx: number, code: string) => run(async () => {
    const st = [...(e.staffing ?? [])]; const l = st[idx]; if (!l || l.code === code) return;
    const line = lays[e.id].lines.find((x) => x.idx === idx); const who = line?.people ?? [];
    const how = await askTell(who, `${plural(l.code, 2)} → ${plural(code, 2)}.`, 'Your shift changed'); if (!how) return;
    const b = e.staffing; st[idx] = { ...l, code }; const { error } = await supabase.from('events').update({ staffing: st }).eq('id', e.id); if (error) throw error;
    for (const x of who) await supabase.from('shifts').update({ position_code: code, position_detail: roleName(code) }).eq('id', x.id);
    if (who.some((x) => !x.pool_hold)) setMsg(`${plural(code, 2)}${await tell(who, how)}.`);
    return { label: `role → ${roleName(code)}`, undo: async () => { await supabase.from('events').update({ staffing: b }).eq('id', e.id); for (const x of who) await supabase.from('shifts').update({ position_code: x.position_code, position_detail: x.position_detail ?? null }).eq('id', x.id); } };
  });
  const addRow = (e: Ev, code: string) => { const L = lays[e.id]; const t = L.lines[L.lines.length - 1]?.start ?? e.start_time?.slice(0, 5) ?? '17:00';
    if (code === 'EX') { saveEv(e, { extras: Math.max(1, L.extras.count), extras_start: e.extras_start ?? t }, 'extras'); return; }
    lineSave(e, [...(e.staffing ?? []), { dept: code === 'W' || code === 'BUS' ? 'floor' : 'bar', code, count: 1, start: t }], `+ ${roleName(code)} row`); };
  /** Nov 16 · ＋ New event on this day: empty position lines, details open, name = Venue · Type once picked. */
  const createEv = (d: 'floor' | 'bar') => run(async () => { setNewQ(null);
    const { data, error } = await supabase.from('events').insert({ event_date: date, title: 'New event', department: d, start_time: '17:00', staff_needed: 0, staffing: [],
      uniform_floor: 'black_shirt', uniform_bar: 'black_shirt', uniform_floor_w: 'black_shirt', uniform_bar_w: 'dress' }).select('id').single(); if (error) throw error;
    const id = (data as { id: string }).id; try { localStorage.removeItem('gr_ds_det_' + id); } catch { /* */ } if (dept !== 'both' && dept !== d) setDept('both');
    return { label: `new ${d} event`, undo: () => supabase.from('events').delete().eq('id', id).then() }; });
  const NewEv = ({ cls, label }: { cls: string; label: string }) => dept !== 'both'
    ? <button className={cls} disabled={busy} onClick={() => createEv(dept)}>{label}</button>
    : newQ === cls ? <span className={cls + ' ds-newq'}><button className="abtn sm" disabled={busy} onClick={() => createEv('floor')}>Floor event</button><button className="abtn sm" disabled={busy} onClick={() => createEv('bar')}>Bar event</button><button className="lnk sm muted" onClick={() => setNewQ(null)}>Cancel</button></span>
    : <button className={cls} disabled={busy} onClick={() => setNewQ(cls)}>{label}</button>;
  const unflag = (id: string) => setFlagged((f) => { const g = { ...f }; delete g[id]; return g; });
  const dropOn = (e: Ev, code: string, start: string | null) => { const d = dragR.current; setDrag(null); if (!d) return; if ('id' in d) move(d, e, code, start); else place(d.staff_id, e, code, start); };

  const Chip = ({ s, at }: { s: Sh; at?: string | null }) => { const own = at && s.planned_start && hm(s.planned_start) !== at ? hm(s.planned_start) : null; const nm = byId[s.staff_id]?.full_name ?? '…'; const can = removable(s);
    const a = av.find((x) => x.staff_id === s.staff_id); const late = a?.from_time && s.planned_start && a.from_time.slice(0, 5) > hm(s.planned_start);
    const e = evs.find((x) => x.id === s.event_id); const n = wn[s.staff_id] ?? 0;
    const w = [why[s.id] ? `✦ ${why[s.id]}` : null, e && ctx ? whyText(s.staff_id, e, ctx, sh.filter((x) => x.event_id === s.event_id && x.staff_id !== s.staff_id).map((x) => x.staff_id), n, a) : null,
      s.locked ? 'locked' : null, !s.pool_hold ? (s.status === 'confirmed' ? 'confirmed' : s.notified_at ? 'sent' : 'booked') : null].filter(Boolean).join(' · ');
    return <span data-sid={s.staff_id} className={'ds-chip' + (can ? '' : ' fixed') + (flagged[s.id] ? ' over' : '') + (hl === s.staff_id ? ' hl' : '')} draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', s.id); ev.dataTransfer.effectAllowed = 'move'; setDrag(s); }} onDragEnd={() => setDrag(null)} title={v6 ? `${nm}${s.planned_start ? ` · from ${ap(hm(s.planned_start))}` : ''}${s.locked ? ' · locked' : ''}` : `${nm} · ${w}${s.booking_note ? ` · 📌 ${s.booking_note}` : ''}${s.pool_hold ? ' · moving them sends nothing' : ' · already sent: moving them sends "Your shift changed" (asked first)'} · click = options`} onClick={() => setCard(s)}>
      {v6 ? (s.status === 'confirmed' ? <i className="v6m ok" title="Confirmed">✓</i> : !s.pool_hold && s.notified_at ? <i className="v6m sent" title="Sent, waiting for a reply">◷</i> : null)
        : <i className={'ds-sd' + (s.status === 'confirmed' ? ' ok' : !s.pool_hold && s.notified_at ? ' sent' : '')} title={s.status === 'confirmed' ? 'Confirmed' : !s.pool_hold && s.notified_at ? 'Sent, not confirmed yet' : 'Placed, not sent yet'} />}<span className="ds-nm">{nm}</span>{ctx && isNewStaff(ctx, s.staff_id) ? <small className="ds-new" title="New: came through onboarding">NEW</small> : null}{v6 ? <button className={'v6-lk' + (s.locked ? ' on' : '')} disabled={busy} draggable={false} title={s.locked ? 'Locked · Fill and Clear leave them here · click to unlock' : 'Lock · Fill and Clear leave them here'}
          onClick={(ev) => { ev.stopPropagation(); void patch(s, { locked: s.locked ? false : true, locked_at: new Date().toISOString() }, s.locked ? 'unlocked' : 'locked'); }}>{s.locked ? '🔒' : '🔓'}</button>
          : s.locked ? <small className="ds-lk" title="Locked">locked</small> : null}{own ? <small className="ds-own" title={`Starts at ${ap(own)} (line ${ap(at)})`}>{ap(own)}</small> : late ? <small className="gold"> from {ap(a!.from_time)}</small> : null}
      {!LEAD.includes(s.position_code ?? '') && <button className="ds-x" disabled={busy} onClick={(ev) => { ev.stopPropagation(); remove(s); }} aria-label={`Back to free: ${nm}`}>×</button>}</span>; };
  const Slot = ({ e, code, start }: { e: Ev; code: string; start: string | null }) =>
    <button className={'ds-slot' + (v6 ? ' v6' : '')} onClick={() => setPick({ e, code, start })} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>{v6 ? 'open' : '+ add'}</button>;
  const Step = ({ n, on }: { n: number; on: (n: number) => void }) => <span className="ds-step"><button disabled={busy} onClick={() => on(n - 1)} aria-label="One less">−</button><b>{n}</b><button disabled={busy} onClick={() => on(n + 1)} aria-label="One more">+</button></span>;
  const TimePop = ({ e, k, start, title, onSet, people }: { e: Ev; k: string; start: string | null; title: string; onSet: (t: string) => void; people?: Sh[] }) => (
    ed?.eid === e.id && ed.key === k ? portalIf(narrow, <span className={'ds-tpop' + (narrow ? ' ph' : '')} onClick={(ev) => ev.stopPropagation()}><b>{title}</b>
      {/^\d+$/.test(k) && !e.staffing?.[Number(k)]?.tbc && <button className="abtn sm v6-tbcb" onClick={() => setTbc(e, Number(k))}>TBC</button>}
      <span className="ds-tq">{(() => { const [h, m] = (start ?? '17:00').split(':').map(Number); const b0 = h * 60 + m; return [-60, -30, -15, 15, 30, 60].map((d) => { const x = b0 + d; const t = `${String(Math.floor(((x % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((x % 60) + 60) % 60).padStart(2, '0')}`; return <button key={d} onClick={() => onSet(t)}>{ap(t)}</button>; }); })()}</span>
      <span className="row" style={{ gap: 6 }}><select className="ds-tsel" value={edT} onChange={(ev) => setEdT(ev.target.value)}>{!Q15.includes(edT) && <option value={edT}>{edT ? ap(edT) : '—'}</option>}{Q15.map((q) => <option key={q} value={q}>{ap(q)}</option>)}</select><button className="abtn sm dark" disabled={!edT || edT === start} onClick={() => onSet(edT)}>Set</button></span>
      {narrow && <button className="abtn sm ds-tclose" onClick={() => setEd(null)}>Cancel</button>}
</span>) : null);
  const tBtn = (e: Ev, k: string, start: string | null) => <button className={'ds-tbtn' + (ed?.eid === e.id && ed.key === k ? ' on' : '')} disabled={busy} onClick={() => { setEdT(start ?? ''); setEd(ed?.eid === e.id && ed.key === k ? null : { eid: e.id, key: k }); }}>{ap(start)}</button>;
  /** push 123 · each line = a band on top (desktop: position · − n + · start · end, all clickable · phone: "6 Barbacks · 12 PM" + ✎) and the names under it, 5 across. */
  const Row = ({ e, code, start, end, count, people, extra, idx, lead }: { e: Ev; code: string; start: string | null; end?: string | null; count: number; people: Sh[]; extra?: boolean; idx?: number; lead?: boolean }) => {
    const cells = people.length + Math.max(0, count - people.length); const pad = cells ? (cols - (cells % cols)) % cols : 0; const tbc = !!(e.start_tbc || e.details_pending);
    const roles = ROLES.filter((r) => (isBar(e) ? r.dept === 'bar' : r.dept === 'floor') && !LEAD.includes(r.code));
    const k = `${e.id}:${lead ? 'L' : extra ? 'X' : idx ?? 'r'}`; const plain = idx != null && !lead && !extra;
    const name = lead ? (isBar(e) ? 'Bar manager' : 'MD') : extra ? 'Extras' : roleName(code);
    const roleC = lead || extra ? <b className="ds-lname">{name}{extra && e.extras == null ? <em> 10%</em> : null}</b>
      : <select className="ds-lsel" value={code} disabled={busy || idx == null} onChange={(ev) => idx != null && setRole(e, idx, ev.target.value)}>{roles.some((r) => r.code === code) ? null : <option value={code}>{plural(code, Math.max(2, count))}</option>}{roles.map((r) => <option key={r.code} value={r.code}>{r.code === 'WW' ? (count === 1 ? 'Wine waiter' : 'Wine waiters') : plural(r.code, Math.max(2, count))}</option>)}</select>;
    const stepC = lead ? <Step n={count} on={(n) => setLeads(e, n)} /> : extra ? <Step n={count} on={(n) => setExtras(e, n)} /> : idx != null ? <Step n={count} on={(n) => setCount(e, idx, n)} /> : <b>{count}</b>;
    const timeC = tbc ? <span className="ds-tro">TBC</span> : lead ? <>{tBtn(e, 'L', start)}<TimePop e={e} k="L" start={start} title={isBar(e) ? 'Start of the bar managers' : 'Start of the MD'} onSet={(t) => setLeadTime(e, t)} people={people} /></> : extra ? <>{tBtn(e, 'x', start)}<TimePop e={e} k="x" start={start} title="Start of the extras" onSet={(t) => setExtrasTime(e, t)} /></>
      : idx != null && e.staffing?.[idx]?.tbc ? <><button className={'ds-tbtn v6-tbc' + (ed?.eid === e.id && ed.key === String(idx) ? ' on' : '')} disabled={busy} onClick={() => { setEdT(''); setEd(ed?.eid === e.id && ed.key === String(idx) ? null : { eid: e.id, key: String(idx) }); }}>TBC</button><TimePop e={e} k={String(idx)} start={start} title="Start of this line" onSet={(t) => setTime(e, idx, t)} people={people} /></>
      : idx != null ? <>{tBtn(e, String(idx), start)}<TimePop e={e} k={String(idx)} start={start} title="Start of this line" onSet={(t) => setTime(e, idx, t)} people={people} /></> : <span className="ds-tro">{ap(start)}</span>;
    const endC = !plain ? null : end || endK === k ? <select className="ds-tsel" value={end ?? ''} disabled={busy} autoFocus={!end} title="End ~ (optional)" onBlur={() => setEndK(null)}
        onChange={(ev) => { setEndK(null); setLineField(e, idx!, { end: ev.target.value || null }, `end ${ev.target.value ? ap(ev.target.value) : '—'}`); }}><option value="">— no end</option>{end && !Q15.includes(end) && <option value={end}>{ap(end)}</option>}{Q15.map((q) => <option key={q} value={q}>{ap(q)}</option>)}</select>
      : <button className="ds-endb" disabled={busy} onClick={() => setEndK(k)} title="Add an end time (optional)">→ end</button>;
    const ok = people.length >= count;
    if (v6 && !narrow) {
      const setN = (n: number) => (lead ? setLeads(e, n) : extra ? setExtras(e, n) : idx != null ? setCount(e, idx, n) : undefined);
      // Nov 23 · option C: anyone starting at another time drops to a sub-line under the row, with their time in the Start column
      const ownT = (x: Sh) => (start && x.planned_start && hm(x.planned_start) !== start ? hm(x.planned_start) : null);
      const main = people.filter((x) => !ownT(x)); const subT = [...new Set(people.map(ownT).filter(Boolean) as string[])].sort();
      return (<>
        <div className={'v6-row' + (extra ? ' ex' : '') + (lead ? ' lead' : '') + (subT.length ? ' hassub' : '')} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>
          <select className="v6-n" value={count} disabled={busy} onChange={(ev) => setN(Number(ev.target.value))}>{[...Array(51)].map((_, i) => <option key={i} value={i}>{i}</option>)}</select>
          <span className="v6-role">{roleC}</span>
          <span className="v6-t">{timeC}</span>
          <span className="v6-t">{plain ? endC : null}</span>
          <span className="ds-cells v6-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{main.map((s) => <Chip key={s.id} s={s} at={start} />)}{[...Array(Math.max(0, count - people.length))].map((_, i) => <Slot key={i} e={e} code={code} start={start} />)}</span>
          <button className="v6-x" disabled={busy} onClick={() => (lead ? setLeads(e, 0) : extra ? setExtras(e, 0) : setCount(e, idx!, 0))} title="Remove this row">×</button>
        </div>
        {subT.map((t) => <div key={t} className="v6-row v6-sub">
          <span /><span /><span className="v6-t"><span className="ds-tro">{ap(t)}</span></span><span className="v6-t" />
          <span className="ds-cells v6-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{people.filter((x) => ownT(x) === t).map((s) => <Chip key={s.id} s={s} at={t} />)}</span><span />
        </div>)}</>); }
    const badge = <span className={'ds-badge' + (ok ? ' ok' : '')}>{people.length}/{count} {ok ? 'full' : `${count - people.length} open`}</span>;
    const band = narrow
      ? <><div className="ds-lh ph"><span className="serif ds-lt">{lead || extra ? name : `${count} ${plural(code, count)}`}</span><span className="ds-lt2">{tbc ? 'TBC' : ap(start)}{end ? ` → ${ap(end)}` : ''}</span><span className="grow" />{badge}
          {(lead || extra || idx != null) && <button className={'ds-pen' + (lineEd === k ? ' on' : '')} onClick={() => setLineEd(lineEd === k ? null : k)} aria-label="Edit this line">✎</button>}</div>
        {lineEd === k && <div className="ds-led">{!lead && !extra && <label><small>Position</small>{roleC}</label>}<label><small>How many</small>{stepC}</label><label><small>Start</small><span className="ds-time">{timeC}</span></label>
          {plain && <label><small>End (optional)</small><span className="ds-end">{endC}</span></label>}
          {plain && <button className="lnk sm ds-ldel" disabled={busy} onClick={() => { setLineEd(null); setCount(e, idx!, 0); }}>🗑 Remove line</button>}<button className="abtn sm dark" onClick={() => setLineEd(null)}>Done</button></div>}</>
      : null;
    const amt = <span className="ds-ramt">{stepC}{roleC}</span>;
    return (
    <div className={'ds-line2' + (narrow ? '' : ' sh') + (extra ? ' ex' : '') + (lead ? ' lead' : '') + (ok ? ' full' : ' short')} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>
      {narrow ? band : <div className="ds-rmeta">{amt}<small className="ds-rcnt">{people.length}/{count}{ok ? ' · full' : ` · ${count - people.length} open`}{plain && <button className="ds-rdel" disabled={busy} onClick={() => setCount(e, idx!, 0)} title="Remove this line">remove</button>}</small></div>}
      {!narrow && <div className="ds-rtime"><span className="ds-time">{timeC}</span>{plain && <span className="ds-end">{endC}</span>}</div>}
      <span className="ds-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{people.map((s) => <Chip key={s.id} s={s} at={start} />)}{[...Array(Math.max(0, count - people.length))].map((_, i) => <Slot key={i} e={e} code={code} start={start} />)}{[...Array(pad)].map((_, i) => <i key={'p' + i} className="ds-off" />)}</span>
    </div>); };

  // ── Nov 26 · phone (A): week strip on top, Free sheet with Book / Ask ──
  const moreMenu = more && <span className="ds-morel" onClick={() => setMore(false)}>
    {(() => { const n = sh.filter((x) => x.pool_hold && shown.some((e) => e.id === x.event_id)).length; return <button disabled={busy || !n} onClick={confirmDay}>Confirm people ({n})</button>; })()}
    <button disabled={busy || !ops.length} onClick={undo}>Undo{ops.length ? ` · ${ops[ops.length - 1].label}` : ''}</button>
    <button disabled={busy || !ctx} onClick={fillWeek}>Fill the week</button>
    <button disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={() => clear()}>Clear unlocked</button>
    <button disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={lockAll}>Lock all</button>
    <NewEv cls="" label="＋ New event" />
    <Link to={`/admin/day-sheet/${date}`}>Old layout</Link></span>;
  const findBox = <span className="ds-find"><input autoFocus={phFind} placeholder="Find a name" value={find} onChange={(ev) => { setFind(ev.target.value); setHl(null); }}
    onKeyDown={(ev) => { if (ev.key === 'Enter' && findRes[0]) goTo(findRes[0].id); if (ev.key === 'Escape') { setFind(''); setHl(null); } }} />
    {find.trim().length >= 2 && !hl && <span className="ds-findl">{findRes.length ? findRes.map((r) => <button key={r.id} onClick={() => goTo(r.id)}><b>{r.name}</b> <small>{r.where}</small></button>) : <small className="muted">Nobody by that name</small>}</span>}</span>;
  const nFree = av.filter((a) => a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).length;
  const phoneTop = <div className="ph-top">
    <div className="ph-mrow"><Link className="ph-arr" to={`${base}/${addDays(date, -7)}`} aria-label="Week before">‹</Link><span className="ph-month">{dLabel(date, { month: 'long' }).toUpperCase()}</span><Link className="ph-arr" to={`${base}/${addDays(date, 7)}`} aria-label="Next week">›</Link><span className="grow" />
      <button className={'ph-ic' + (phFind ? ' on' : '')} onClick={() => { setPhFind(!phFind); if (phFind) { setFind(''); setHl(null); } }} aria-label="Find a name"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></button>
      <span className="ds-more"><button className="ph-ic" onClick={() => setMore(!more)} aria-label="More">···</button>{moreMenu}</span></div>
    {phFind && findBox}
    <div className="ph-week">{week.map((w) => <Link key={w.d} to={`${base}/${w.d}`} className={'ph-day' + (w.d === date ? ' on' : '')}>
      <small>{dLabel(w.d, { weekday: 'narrow' })}</small><b>{Number(w.d.slice(8))}</b><i className={!w.n ? '' : w.have >= w.need ? 'ok' : 'short'} /></Link>)}</div>
    <div className="ph-drow"><span className="serif ph-date">{dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span className="grow" />
      <button className="ph-free" onClick={() => setFreeOpen(true)}>Free <b>{nFree}</b></button></div>
    <div className="ph-tot">Floor <b className={fl[0] >= fl[1] ? 'okc' : 'accent'}>{fl[0]}/{fl[1]}</b> · Bar <b className={br[0] >= br[1] ? 'okc' : 'accent'}>{br[0]}/{br[1]}</b> · {evs.length} event{evs.length === 1 ? '' : 's'}</div>
    <div className="ph-frow"><span className="seg3">{(['floor', 'bar', 'both'] as const).map((d) => <button key={d} className={dept === d ? 'on' : ''} onClick={() => setDept(d)}>{d === 'both' ? 'Both' : d === 'floor' ? 'Floor' : 'Bar'}</button>)}</span>
      <button className="abtn dark" disabled={busy || !ctx || !shown.length} onClick={() => fillDay()}>Fill the day</button></div>
  </div>;
  const soon = (new Date(date + 'T12:00:00').getTime() - new Date(isoDay(new Date()) + 'T12:00:00').getTime()) / 86400000 <= 3;
  const dptOf = (id: string) => (byId[id]?.department === 'bar' ? 'bar' : 'floor');
  const fsYes = av.filter((a) => a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id) && aDept(a) === fsDept).sort((a, b) => sortP(a.staff_id, b.staff_id));
  const fsWait = av.filter((a) => a.status === 'asked' && !onDay.has(a.staff_id) && !off.has(a.staff_id) && aDept(a) === fsDept);
  const answered = new Set(av.map((a) => a.staff_id));
  const fsUsual = weekly.filter((w) => byId[w.staff_id]?.active && byId[w.staff_id]?.role !== 'admin' && !/app review|unranked|test/i.test(byId[w.staff_id]?.full_name ?? '') && dptOf(w.staff_id) === fsDept && !answered.has(w.staff_id) && !onDay.has(w.staff_id) && !off.has(w.staff_id) && !asked[w.staff_id])
    .sort((a, b) => sortP(a.staff_id, b.staff_id));
  const tierB = (id: string) => { const t = tier(id); return <i className={'ph-t ' + (t ?? 'x')}>{t ?? '?'}</i>; };
  const evLines = (e: Ev) => { const L = lays[e.id]; return [...L.lines.map((l) => ({ k: l.key, code: l.code, start: l.start, label: `${l.count} ${plural(l.code, l.count)}`, open: Math.max(0, l.count - l.people.length) })),
    { k: 'x', code: L.extras.code, start: L.extras.start, label: 'Extras', open: Math.max(0, L.extras.count - L.extras.people.length) }]; };
  const sendAsk = (ids: string[], evId: string, t: string) => run(async () => {
    const e = evs.find((x) => x.id === evId); const label = soon && e ? `${e.venues?.name ?? e.title}${t ? ` · ${ap(t)}` : ''}` : 'Event';
    // reuse the day's ask if there is one (keeps its tiers / headcount); short notice puts the event + time on it
    const { data: ex } = await supabase.from('avail_asks').select('id').eq('for_date', date).eq('department', fsDept).maybeSingle();
    let ask = ex as { id: string } | null;
    if (ask) { if (soon) { const { error } = await supabase.from('avail_asks').update({ label, approx_start: t || null }).eq('id', ask.id); if (error) throw new Error(error.message); } }
    else { const { data, error } = await supabase.from('avail_asks').insert({ for_date: date, department: fsDept, label, approx_start: soon && t ? t : null, staff_needed: 0, tiers_sent: [], reply_by: null }).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Could not save the ask'); ask = data as { id: string }; }
    const now = new Date().toISOString();
    const { error: e2 } = await supabase.from('availability').upsert(ids.map((id) => ({ staff_id: id, for_date: date, part: 'evening', status: 'asked', ask_id: ask.id, asked_at: now, answer_by: defaultAnswerBy(date).toISOString() })), { onConflict: 'staff_id,for_date,part' });
    if (e2) throw new Error(e2.message);
    setAsked((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, now])) })); setAskQ(null); setTick((x) => x + 1);
  });
  const askStart = (ids: string[]) => { const e0 = shown.find((e) => isBar(e) === (fsDept === 'bar')) ?? shown[0]; const l0 = e0 ? evLines(e0).find((l) => l.open > 0) ?? evLines(e0)[0] : null;
    setAskQ({ ids, ev: e0?.id ?? '', t: l0?.start ?? e0?.start_time?.slice(0, 5) ?? '' }); };
  const freeSheet = freeOpen && createPortal(<div className="ph-back" onClick={() => { setFreeOpen(false); setBookFor(null); setAskQ(null); }}>
    <div className="ph-sheet" onClick={(ev) => ev.stopPropagation()}>
      <span className="ph-grip" />
      <div className="ph-shead"><b className="serif">Free this day</b><span className="grow" /><button className="lnk sm" onClick={() => { setFreeOpen(false); setBookFor(null); setAskQ(null); }}>Close</button></div>
      <span className="seg3 ph-seg">{(['floor', 'bar'] as const).map((d) => <button key={d} className={fsDept === d ? 'on' : ''} onClick={() => setFsDept(d)}>{d === 'floor' ? 'Floor' : 'Bar'}</button>)}</span>
      {err && <div className="adm-card err sm">{err}</div>}
      <div className="ph-g">SAID YES <span>{fsYes.length}</span></div>
      {!fsYes.length && <div className="ph-none">Nobody yet</div>}
      {fsYes.map((a) => <div key={a.staff_id} className="ph-fr">{tierB(a.staff_id)}<span className="ph-nm"><b>{byId[a.staff_id]?.full_name ?? '…'}</b><small className={a.from_time ? 'amber' : ''}>{a.from_time ? `From ${ap(a.from_time.slice(0, 5))}` : 'Any time'}</small></span>
        <button className="ph-btn" disabled={busy} onClick={() => setBookFor(bookFor === a.staff_id ? null : a.staff_id)}>Book</button>
        {bookFor === a.staff_id && <div className="ph-pick">{shown.filter((e) => isBar(e) === (fsDept === 'bar')).concat(shown.filter((e) => isBar(e) !== (fsDept === 'bar'))).map((e) => <div key={e.id} className="ph-pe"><small>{e.title || e.venues?.name}</small>
          {evLines(e).map((l) => <button key={l.k} disabled={busy} className={l.open ? 'open' : ''} onClick={() => { setBookFor(null); place(a.staff_id, e, l.code, l.start); }}>{l.label} · {l.start ? ap(l.start) : 'TBC'}{l.open ? ` · ${l.open} open` : ''}</button>)}</div>)}</div>}
      </div>)}
      <div className="ph-g">WAITING ON A REPLY <span>{fsWait.length + Object.keys(asked).filter((id) => dptOf(id) === fsDept && !answered.has(id)).length}</span></div>
      {fsWait.map((a) => <div key={a.staff_id} className="ph-fr">{tierB(a.staff_id)}<span className="ph-nm"><b>{byId[a.staff_id]?.full_name ?? '…'}</b><small className="amber">Asked · no reply yet</small></span></div>)}
      {Object.keys(asked).filter((id) => dptOf(id) === fsDept && !answered.has(id)).map((id) => <div key={id} className="ph-fr">{tierB(id)}<span className="ph-nm"><b>{byId[id]?.full_name ?? '…'}</b><small className="amber">Asked {ap(hm(asked[id]))}</small></span></div>)}
      <div className="ph-g">USUALLY FREE {dLabel(date, { weekday: 'long' }).toUpperCase()}S · NOT ASKED <span>{fsUsual.length}</span><span className="grow" />{fsUsual.length > 1 && <button className="ph-ask" disabled={busy} onClick={() => askStart(fsUsual.map((w) => w.staff_id))}>Ask all {fsUsual.length}</button>}</div>
      {!fsUsual.length && <div className="ph-none">Nobody else</div>}
      {fsUsual.map((w) => <div key={w.staff_id} className="ph-fr">{tierB(w.staff_id)}<span className="ph-nm"><b>{byId[w.staff_id]?.full_name ?? '…'}</b><small>{w.from_time ? `Usually from ${ap(w.from_time.slice(0, 5))}` : 'Usually any time'}</small></span>
        <button className="ph-ask" disabled={busy} onClick={() => askStart([w.staff_id])}>Ask</button></div>)}
      {askQ && <div className="ph-askq"><b>Ask {askQ.ids.length === 1 ? byId[askQ.ids[0]]?.full_name : `${askQ.ids.length} people`} for {dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}?</b>
        {soon ? <><label><small>Event</small><select value={askQ.ev} onChange={(ev) => { const e = evs.find((x) => x.id === ev.target.value); const l = e ? evLines(e).find((x) => x.open > 0) ?? evLines(e)[0] : null; setAskQ({ ...askQ, ev: ev.target.value, t: l?.start ?? '' }); }}>{shown.map((e) => <option key={e.id} value={e.id}>{e.title || e.venues?.name}</option>)}</select></label>
          <label><small>Time</small><select value={askQ.t} onChange={(ev) => setAskQ({ ...askQ, t: ev.target.value })}>{!Q15.includes(askQ.t) && <option value={askQ.t}>{askQ.t ? ap(askQ.t) : '—'}</option>}{Q15.map((q) => <option key={q} value={q}>{ap(q)}</option>)}</select></label>
          <small className="muted">They see: {(() => { const e = evs.find((x) => x.id === askQ.ev); return `${e?.venues?.name ?? e?.title ?? ''}${askQ.t ? ` · ${ap(askQ.t)}` : ''}`; })()}</small></>
          : <small className="muted">They’re asked for the day. It’s more than 3 days away.</small>}
        <span className="row" style={{ gap: 6 }}><button className="abtn dark" disabled={busy} onClick={() => sendAsk(askQ.ids, askQ.ev, askQ.t)}>Send the ask</button><button className="abtn" onClick={() => setAskQ(null)}>Cancel</button></span></div>}
    </div></div>, document.body);

  return (
    <div className={'stack-lg ds' + (v6 ? ' ds-v6' : '')}>
      {!v6 && <div className="kick"><Link to={`/admin/bookings?date=${date}&view=sheet`}>Bookings · week</Link> · DAY SHEET</div>}
      {v6 && narrow ? <>{phoneTop}{freeSheet}</> : <>
      <div className="ds-weekw"><Link className="ds-warr" to={`${base}/${addDays(date, -7)}`} title="Week before">‹</Link><div className="ds-week">{week.map((w) => <Link key={w.d} to={`${base}/${w.d}`} className={'ds-wd' + (w.d === date ? ' on' : '') + (!w.n ? ' none' : w.have >= w.need ? ' done' : ' short')}>
        <small>{dLabel(w.d, { weekday: 'short', day: 'numeric' })}</small><b>{w.n ? `${w.have}/${w.need}` : '—'}</b><small>{w.n ? `${w.n} event${w.n > 1 ? 's' : ''}${w.free && !v6 ? ` · ${w.free} free` : ''}` : 'no events'}</small></Link>)}</div><Link className="ds-warr" to={`${base}/${addDays(date, 7)}`} title="Next week">›</Link></div>
      {v6 ? <>
      <div className="ds-top v6-top1">
        <span className="serif-h ds-day">{dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span className="v6-tot">Floor <b className={fl[0] >= fl[1] ? 'okc' : 'accent'}>{fl[0]}/{fl[1]}</b> · Bar <b className={br[0] >= br[1] ? 'okc' : 'accent'}>{br[0]}/{br[1]}</b> · {nYes} free</span>
        <span className="grow" />
        <NewEv cls="abtn" label="＋ New event" />
        <button className="abtn dark" disabled={busy || !ctx || !shown.length} onClick={() => fillDay()}>Fill the day</button>
        <span className="ds-more"><button className="abtn" onClick={() => setMore(!more)}>More ▾</button>{more && <span className="ds-morel" onClick={() => setMore(false)}>
          {(() => { const n = sh.filter((x) => x.pool_hold && shown.some((e) => e.id === x.event_id)).length; return <button disabled={busy || !n} onClick={confirmDay}>Confirm people ({n})</button>; })()}
          <button disabled={busy || !ops.length} onClick={undo}>Undo{ops.length ? ` · ${ops[ops.length - 1].label}` : ''}</button>
          <button disabled={busy || !ctx} onClick={fillWeek}>Fill the week</button>
          <button disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={() => clear()}>Clear unlocked</button>
          <button disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={lockAll}>Lock all</button>
          <Link to={`/admin/day-sheet/${date}`}>Old layout</Link>
          <span className="v6-legend"><i className="v6m ok">✓</i> confirmed · <i className="v6m sent">◷</i> sent, waiting · no mark = not sent</span></span>}</span>
      </div>
      <div className="ds-top v6-top2">
        <span className="ds-find"><input placeholder="Find a name" value={find} onChange={(ev) => { setFind(ev.target.value); setHl(null); }}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && findRes[0]) goTo(findRes[0].id); if (ev.key === 'Escape') { setFind(''); setHl(null); } }} />
          {find.trim().length >= 2 && !hl && <span className="ds-findl">{findRes.length ? findRes.map((r) => <button key={r.id} onClick={() => goTo(r.id)}><b>{r.name}</b> <small>{r.where}</small></button>) : <small className="muted">Nobody by that name</small>}</span>}</span>
        <span className="seg3">{(['floor', 'bar', 'both'] as const).map((d) => <button key={d} className={dept === d ? 'on' : ''} onClick={() => setDept(d)}>{d === 'both' ? 'Both' : d === 'floor' ? 'Floor' : 'Bar'}</button>)}</span>
      </div></> :
      <div className="ds-top">
        <span className="serif-h ds-day"><Link to={`${base}/${addDays(date, -1)}`}>‹</Link> {dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} <Link to={`${base}/${addDays(date, 1)}`}>›</Link></span>
        <span className="ds-find"><input placeholder="Find a name" value={find} onChange={(ev) => { setFind(ev.target.value); setHl(null); }}
          onKeyDown={(ev) => { if (ev.key === 'Enter' && findRes[0]) goTo(findRes[0].id); if (ev.key === 'Escape') { setFind(''); setHl(null); } }} />
          {find.trim().length >= 2 && !hl && <span className="ds-findl">{findRes.length ? findRes.map((r) => <button key={r.id} onClick={() => goTo(r.id)}><b>{r.name}</b> <small>{r.where}</small></button>) : <small className="muted">Nobody by that name</small>}</span>}</span>
        <span className="grow" />
        <span className="seg3">{(['floor', 'bar', 'both'] as const).map((d) => <button key={d} className={dept === d ? 'on' : ''} onClick={() => setDept(d)}>{d === 'both' ? 'Both' : d === 'floor' ? 'Floor' : 'Bar'}</button>)}</span>
        <NewEv cls="abtn" label="＋ New event" />
        <button className="abtn dark" disabled={busy || !ctx || !shown.length} onClick={() => fillDay()} title="Fills the open slots of the events shown, best first, by the rules · one move for Undo">Fill the day</button>
        <span className="ds-more"><button className="abtn" onClick={() => setMore(!more)}>More ▾</button>{more && <span className="ds-morel" onClick={() => setMore(false)}>
          <button disabled={busy || !ctx} onClick={fillWeek} title={`Every day from today to Sun ${dLabel(addDays(wk0, 6), { month: 'short', day: 'numeric' })} · ${dept === 'both' ? 'floor + bar' : dept}`}>Fill the week</button>
          <button disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={() => clear()}>Clear unlocked</button>
          <button disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={lockAll} title="Everyone placed: Fill and Clear won't move them">Lock all</button></span>}</span>
        <button className="abtn" disabled={busy || !ops.length} onClick={undo} title={ops.length ? `Undo: ${ops[ops.length - 1].label}` : 'Nothing to undo'}>↶ Undo{ops.length ? ` (${ops.length})` : ''}</button>
        {(() => { const n = sh.filter((x) => x.pool_hold && shown.some((e) => e.id === x.event_id)).length; const out = addDays(date, -4); const due = isoDay(new Date()) >= out;
          return <button className={'abtn' + (due && n ? ' dark' : '')} disabled={busy || !n} onClick={confirmDay} title={`Confirmations usually go ~4 days out (${dLabel(out, { weekday: 'short', month: 'short', day: 'numeric' })})`}>Confirm {n}{dept !== 'both' ? ` ${dept}` : ''} ›</button>; })()}
      </div>}</>}
      {!v6 && <div className="ds-sum"><b>{evs.length} event{evs.length === 1 ? '' : 's'}</b><span>Floor <b className={fl[0] >= fl[1] ? 'okc' : 'accent'}>{fl[0]}/{fl[1]}</b></span><span>Bar <b className={br[0] >= br[1] ? 'okc' : 'accent'}>{br[0]}/{br[1]}</b></span><span>Free <b>{nYes}</b></span>
        {v6 ? <span className="muted ds-legend"><i className="v6m ok">✓</i> confirmed <i className="v6m sent">◷</i> sent, waiting · no mark = not sent · <span className="v6-dash">open</span> = open spot</span>
          : <span className="muted ds-legend"><i className="ds-sd ok" /> confirmed <i className="ds-sd sent" /> sent, not confirmed <i className="ds-sd" /> placed, not sent</span>}
        <Link className="lnk sm" to={`${v6 ? '/admin/day-sheet' : '/admin/bookings-v6'}/${date}`}>{v6 ? '← Old layout' : 'Try the new layout (V6) ›'}</Link></div>}
      {false && pend > 0 && <div className="ds-pend"><b>✉ {pend} change{pend > 1 ? 's' : ''} not sent yet</b><span className="muted">staff who were already sent a shift that changed · they're told when you press Send</span><span className="grow" /><button className="abtn sm dark" onClick={() => setSendOpen(true)}>Review &amp; send ›</button></div>}
      {sendOpen && <SendBox events={evs.map((e) => e.id)} onClose={() => { setSendOpen(false); setTick((t) => t + 1); }} onSent={() => { setMsg('Sent.'); setTick((t) => t + 1); }} />}
      {ops.length > 0 && fabOn && <div className="ds-undofab"><span className="grow">{ops[ops.length - 1].label}</span><button disabled={busy} onClick={undo}>↶ Undo</button>{ops.length > 1 && <small>{ops.length} steps</small>}</div>}{/* push 120 · always in reach */}
      {msg && <div className="adm-card okc sm">{msg}</div>}{err && <div className="adm-card err sm">{err}</div>}
      <div className={'ds-cols' + (freeFold ? ' ffold' : '')}>
        <div className={'ds-blocks' + (narrow ? ' narrow' : '') + (noEnd ? ' noend' : '')} ref={blocksR} onClick={() => ed && setEd(null)}>
          {!shown.length && <div className="adm-card muted">No {dept === 'both' ? '' : dept + ' '}events this day.</div>}
          {shown.map((e) => { const L = lays[e.id]; const have = sh.filter((s) => s.event_id === e.id).length; const need = L.client;
            // Nov 26 · phone: one event open at a time (the first short one opens by itself)
            const autoOpen = (shown.find((x) => lays[x.id].client > sh.filter((y) => y.event_id === x.id).length) ?? shown[0])?.id;
            const folded = narrow && (phOpen ?? autoOpen) !== e.id;
            if (folded) { const st = (e.staffing ?? []).map((l) => l.start).concat(e.start_time ? [e.start_time.slice(0, 5)] : []).filter(Boolean).sort()[0];
              return <button key={e.id} className={'ds-card ds-fold' + (isBar(e) ? ' ds-barev' : '')} onClick={() => setPhOpen(e.id)}>
                <span className="ds-ch"><span className="ds-car">▸</span><span className="serif ds-title">{e.title || e.venues?.name || 'New event'}</span><span className={'ds-dept ' + (isBar(e) ? 'bar' : 'floor')}>{isBar(e) ? 'BAR' : 'FLOOR'}</span><span className={'ds-open' + (need > have ? '' : ' ok')}>{need > have ? `${need - have} open` : need ? 'All filled' : 'No lines yet'}</span></span>
                <span className="ds-fsub">{st ? `Start ${ap(st)}` : 'Start TBC'} · {Math.min(have, need)} / {need}{have > need ? ` · ${have - need} extra${have - need > 1 ? 's' : ''}` : ''}</span></button>; }
            return (
              <section key={e.id} className={'ds-card' + (isBar(e) ? ' ds-barev' : '')}>
                <div className="ds-ch" onClick={narrow ? (ev) => { if ((ev.target as HTMLElement).closest('a,button,select,input')) return; setPhOpen('__none'); } : undefined}>{narrow && <span className="ds-car">▾</span>}<span className="serif ds-title">{e.title || e.venues?.name || 'New event'}</span><span className={'ds-dept ' + (isBar(e) ? 'bar' : 'floor')}>{isBar(e) ? 'BAR' : 'FLOOR'}</span>{isFar(e) && <span className="ds-far" title="Far venue: Fill puts drivers first, with the people they're linked to">far</span>}
                  {(e as unknown as { staff_estimate?: boolean }).staff_estimate && <span className="tag est-tag ds-est">ESTIMATE</span>}<span className={'ds-open' + (need > have ? '' : ' ok') + ((e as unknown as { staff_estimate?: boolean }).staff_estimate ? ' est' : '')}>{need > have ? `${need - have} open` : need ? 'All filled' : 'No lines yet'}</span>
                  <span className="grow" />
                  {need > have && <button className="lnk sm" disabled={busy || !ctx} onClick={() => fillDay(e)} title="Fill this event only">Fill</button>}
                  {sh.some((x) => x.event_id === e.id && x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? '')) && <button className="lnk sm muted" disabled={busy} onClick={() => clear(e)}>Clear</button>}
                  <Link className="lnk sm" to={`/admin/event/${e.id}`}>{v6 ? 'Full event ›' : 'Event ›'}</Link></div>
                {v6 ? <DetailsV6 e={e} pv={priv[e.id]} open={detOpen(e.id)} onToggle={() => togDet(e.id)} venues={ctx?.venues ?? []} clients={ctx?.clients ?? []} types={types} busy={busy}
                  onEv={(row, label) => saveEv(e, row, label)} onPriv={(row, label) => savePriv(e, row, label)} onVenue={(v) => setVenue(e, v)} onClient={(c) => saveClient(e, c)} onType={(t) => setType(e, t)} />
                : <Details e={e} open={detOpen(e.id)} onToggle={() => togDet(e.id)} venues={ctx?.venues ?? []} clients={ctx?.clients ?? []} types={types} busy={busy}
                  onEv={(row, label) => saveEv(e, row, label)} onVenue={(v) => setVenue(e, v)} onClient={(c) => saveClient(e, c)} onType={(t) => setType(e, t)} />}
                {v6 && !narrow && <div className="v6-head"><span>STAFF</span><span>ROLE</span><span>START</span><span>END</span><span>NAMES</span><span /></div>}
                <div className="ds-grid">
                  <div className={'ds-grp ' + (isBar(e) ? 'g-bar' : 'g-floor')}>
                    <Row e={e} lead code={isBar(e) ? 'BM' : 'MD'} start={(e.staffing ?? []).find((l) => LEAD.includes(l.code))?.start ?? e.start_time?.slice(0, 5) ?? null} count={L.leadNeed} people={L.leads} />
                    {[...L.lines].sort((a, b) => ((e.staffing ?? [])[a.idx]?.tbc ? 1 : 0) - ((e.staffing ?? [])[b.idx]?.tbc ? 1 : 0) || (a.start ?? '').localeCompare(b.start ?? '')).map((l) => <Row key={l.key} idx={l.idx} e={e} code={l.code} start={l.start} end={(e.staffing ?? [])[l.idx] ? ((e.staffing ?? [])[l.idx] as Line & { end?: string | null }).end ?? null : null} count={l.count} people={l.people} />)}
                    {(L.extras.count > 0 || (!isBar(e) && L.lines.length > 0)) && <Row e={e} extra code={L.extras.code} start={L.extras.start} count={L.extras.count} people={L.extras.people} />}
                    {cx.some((x) => x.event_id === e.id) && <div className="ds-line2 cxl"><div className="ds-lh"><b className="ds-lname">Cancelled</b></div>
                      <span className="ds-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{cx.filter((x) => x.event_id === e.id).map((x) => <button key={x.id} className="ds-chip cx" disabled={busy}
                        title={`${byId[x.staff_id]?.full_name ?? ''} · cancelled · ${x.cancel_reason ?? ''}${x.cancel_note ? ` — ${x.cancel_note}` : ''} · ${x.cancel_late ? 'counts as a late cancel' : 'excused (not counted)'} · click to un-cancel`}
                        onClick={() => { if (confirm(`Un-cancel ${byId[x.staff_id]?.full_name ?? ''}? They go back on ${roleName(x.position_code)} ${ap(hm(x.planned_start))}.`)) unCancel(x); }}>
                        <span className="ds-nm">{short(byId[x.staff_id]?.full_name ?? '…')}</span>{v6 ? (x.cancel_late ? <small>⚑</small> : null) : <small>{x.cancel_reason ?? ''}{x.cancel_late ? ' ⚑' : ''}</small>}</button>)}</span></div>}
                    {L.over.length > 0 && <div className="ds-line2 over"><div className="ds-lh"><b className="ds-lname">Also placed</b><span className="grow" /><span className="ds-badge">over</span></div><span className="ds-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{L.over.map((s) => <Chip key={s.id} s={s} />)}</span></div>}
                  </div>
                  {(() => { const fl = sh.filter((x) => x.event_id === e.id && flagged[x.id]); return fl.length > 0 && <div className="ds-flagbox"><b>⚑ Line lowered · weakest flagged</b>
                    {fl.map((x) => <span key={x.id} className="ds-flagp"><span className="grow">{byId[x.staff_id]?.full_name ?? '…'} <small className="muted">{flagged[x.id]}</small></span>
                      <button className="abtn sm" disabled={busy} onClick={() => { unflag(x.id); const ex = L.extras.start; if (ex && hm(x.planned_start) !== ex) patch(x, { planned_start: startIso(date, ex) }, 'to extras'); }}>Make extra</button>
                      <button className="abtn sm" disabled={busy} onClick={() => { unflag(x.id); remove(x); }}>Back to Free</button>
                      <button className="lnk sm muted" onClick={() => unflag(x.id)}>Keep</button></span>)}</div>; })()}
                  {v6 ? (add?.eid === e.id ? <div className="v6-row v6-new">
                      <select className="v6-n" value={add.count} onChange={(ev) => setAdd({ ...add, count: ev.target.value })}>{[...Array(30)].map((_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select>
                      <select className="ds-lsel" value={add.code} onChange={(ev) => setAdd({ ...add, code: ev.target.value })}>{[...ROLES.filter((r) => (isBar(e) ? r.dept === 'bar' : r.dept === 'floor')), ...ROLES.filter((r) => (isBar(e) ? r.dept !== 'bar' : r.dept !== 'floor'))].map((r) => <option key={r.code} value={r.code}>{plural(r.code, 2)}</option>)}<option value="EX">Extras</option></select>
                      <select className="ds-tsel" value={add.t} onChange={(ev) => setAdd({ ...add, t: ev.target.value })}><option value="TBC">TBC</option>{Q15.map((q) => <option key={q} value={q}>{ap(q)}</option>)}</select>
                      <span />
                      <span className="v6-newb"><button className="abtn sm dark" disabled={busy} onClick={addLine}>Add row</button><button className="abtn sm" onClick={() => setAdd(null)}>Cancel</button></span><span />
                    </div> : <button className="v6-plus" disabled={busy} title="Add a row" onClick={() => setAdd({ eid: e.id, code: isBar(e) ? 'BT' : 'W', count: '1', t: (e.staffing ?? []).slice(-1)[0]?.start ?? e.start_time?.slice(0, 5) ?? 'TBC' })}>+</button>) :
                  <div className="ds-addrow">{(isBar(e) ? [['BT', '+ Bar row'], ['BB', '+ Barback row'], ['WW', '+ Wine row'], ['EX', '+ Extras']] : [['W', '+ Floor row'], ['EX', '+ Extras']]).map(([c, l]) => <button key={c} disabled={busy} onClick={() => addRow(e, c)}>{l}</button>)}</div>}
                </div>
              </section>); })}
          <NewEv cls="ds-newev" label={`＋ New event on ${dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}`} />
        </div>
        {v6 && narrow ? null : freeFold ? <aside className="ds-free fold" onClick={() => setFreeFold(false)} title="Show Free this day (you can still drop a name here = back to Free)" onDragOver={(ev) => ev.preventDefault()} onDrop={() => { const d = dragR.current; setDrag(null); if (d && 'id' in d) remove(d); }}>
          <span>‹</span><b>Free · {nYes}</b></aside> : <aside className="ds-free" onDragOver={(ev) => ev.preventDefault()} onDrop={() => { const d = dragR.current; setDrag(null); if (d && 'id' in d) remove(d); }}>
          <span className="row" style={{ alignItems: 'baseline' }}><b className="serif grow">Free this day · {nYes}</b><button className="ds-dett" onClick={() => setFreeFold(true)} title="Fold to make room">Hide ›</button></span>
          <small className="muted">said yes, not placed · best first · drag onto a slot, or tap a slot · drop a name here = back to free</small>
          {v6 && dept === 'both' && <span className="seg3"><button className={fdept === 'floor' ? 'on' : ''} onClick={() => setFdept('floor')}>Floor</button><button className={fdept === 'bar' ? 'on' : ''} onClick={() => setFdept('bar')}>Bar</button></span>}
          <span className="seg3"><button className={tab === 'yes' ? 'on' : ''} onClick={() => setTab('yes')}>Yes {nYes}</button><button className={tab === 'maybe' ? 'on' : ''} onClick={() => setTab('maybe')}>Maybe {nMaybe}</button></span>
          {!free.length && <span className="muted sm">{tab === 'yes' ? 'Nobody left. Ask more from Bookings → Ask more people.' : 'No maybes.'}</span>}
          {free.map((a) => <div key={a.staff_id} data-sid={a.staff_id} className={'ds-fp' + (hl === a.staff_id ? ' hl' : '')} draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', a.staff_id); ev.dataTransfer.effectAllowed = 'move'; setDrag({ staff_id: a.staff_id }); }} onDragEnd={() => setDrag(null)}>
            <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{byId[a.staff_id]?.full_name ?? '…'}{ctx?.cars.has(a.staff_id) ? ' 🚗' : ''}{ctx && isNewStaff(ctx, a.staff_id) ? <small className="ds-new">NEW</small> : null}</b>{(wn[a.staff_id] ?? 0) >= 3 && <small className="ds-flag" title={`Already ${wn[a.staff_id]} shifts this week`}>⚑{wn[a.staff_id]}</small>}<small className="muted">{a.from_time ? `from ${ap(a.from_time)}` : 'any time'}</small></div>)}
          {(() => { const open = shown.reduce((n, e) => { const L = lays[e.id]; return n + Math.max(0, L.client + L.extras.count - sh.filter((s) => s.event_id === e.id).length); }, 0);
            return <div className="ds-after">{open > 0 ? <><b>{open} open</b> slot{open > 1 ? 's' : ''} · {nYes} free</> : <><b>All slots filled.</b> {nYes} left = backups (not booked, released when you confirm)</>}</div>; })()}
        </aside>}
      </div>
      {card && (() => { const c = sh.find((x) => x.id === card.id); if (!c) return null; const e = evs.find((x) => x.id === c.event_id); if (!e) return null;
        return <PersonCard s={c} e={e} date={date} evs={evs} lays={lays} byId={byId} av={av} onDay={onDay} off={off} sortP={sortP} tier={tier} busy={busy} wn={wn[c.staff_id] ?? 0}
          why={[why[c.id] ? `✦ ${why[c.id]}` : null, ctx ? whyText(c.staff_id, e, ctx, sh.filter((x) => x.event_id === c.event_id && x.staff_id !== c.staff_id).map((x) => x.staff_id), wn[c.staff_id] ?? 0, av.find((x) => x.staff_id === c.staff_id)) : null].filter(Boolean).join(' · ')}
          onClose={() => setCard(null)}
          onSave={(row, label) => { setCard(null); patch(c, row, label); }}
          onConfirm={() => markConfirmed(c)}
          onLock={() => patch(c, { locked: c.locked ? false : true, locked_at: new Date().toISOString() }, c.locked ? 'unlocked' : 'locked')}
          onSwap={(id) => patch(c, { staff_id: id }, `swapped for ${byId[id]?.full_name ?? ''}`)}
          onReplace={() => run(async () => { const all = await eventsBetween(date, date); const fe = all.find((x) => x.id === c.event_id); const fs = fe?.shifts.find((x) => x.id === c.id);
            if (!fe || !fs) throw new Error('Could not open the replacement list.'); setCard(null); setRepl({ s: fs, e: fe }); })}
          onRemove={() => { setCard(null); remove(c); }} onCancel={() => setCancelQ(c)} />; })()}
      {cancelQ && <CancelBox s={cancelQ} name={byId[cancelQ.staff_id]?.full_name ?? '…'} where={(() => { const e = evs.find((x) => x.id === cancelQ.event_id); return `${e?.venues?.name ?? e?.title ?? ''} · ${roleName(cancelQ.position_code)} ${ap(hm(cancelQ.planned_start))} · ${sentTxt(cancelQ)}`; })()}
        onClose={() => setCancelQ(null)} onSave={(r, n, c, rep) => doCancel(cancelQ, r, n, c, rep)} />}
      {tellQ && <TellBox q={tellQ} names={tellQ.who.map((x) => byId[x.staff_id]?.full_name ?? '…')} states={tellQ.who.map((x) => sentTxt(x))} />}
      {repl && <ReplaceSheet shift={repl.s} ev={repl.e} onClose={() => setRepl(null)} onDone={(m) => { setRepl(null); setMsg(m); setTick((t) => t + 1); }} />}
      {pick && <PickSheet date={date} e={pick.e} code={pick.code} start={pick.start} staff={staff} av={av} onDay={onDay} off={off} sortP={sortP} tier={tier}
        onClose={() => setPick(null)} onPick={(id) => { const p = pick; setPick(null); place(id, p.e, p.code, p.start); }} onAsk={() => nav(`/admin/bookings?date=${date}&view=list&ask=1`)}
        onAskSpot={() => { const p = pick; run(async () => { const all = await eventsBetween(date, date); const fe = all.find((x) => x.id === p.e.id); if (!fe) throw new Error('Could not open the ask list.');
          const t = p.start ?? p.e.start_time?.slice(0, 5) ?? '17:00';
          const fs = { id: '', event_id: fe.id, staff_id: '', position_code: p.code, position_detail: roleName(p.code), planned_start: startIso(date, t), status: 'booked', changed_at: '', notified_at: null, attendance: null, leave_by: null, punches: null, staff: null } as unknown as AShift;
          setPick(null); setRepl({ s: fs, e: fe }); }); }} />}
    </div>
  );
}

function PickSheet({ date, e, code, start, staff, av, onDay, off, sortP, tier, onClose, onPick, onAsk, onAskSpot }: { date: string; e: Ev; code: string; start: string | null; staff: AStaff[]; av: Av[]; onDay: Set<string>; off: Set<string>;
  sortP: (a: string, b: string) => number; tier: (id: string) => string | null; onClose: () => void; onPick: (id: string) => void; onAsk: () => void; onAskSpot: () => void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const fits = (a: Av) => !a.from_time || !start || a.from_time.slice(0, 5) <= start;
  const yes = av.filter((a) => a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).sort((a, b) => Number(!fits(a)) - Number(!fits(b)) || sortP(a.staff_id, b.staff_id));
  const maybe = av.filter((a) => a.status === 'maybe' && !a.released_at && !onDay.has(a.staff_id));
  const nm = (id: string) => staff.find((s) => s.id === id)?.full_name ?? '…';
  const others = ql.length >= 2 ? staff.filter((s) => s.active && !onDay.has(s.id) && (s.full_name.toLowerCase().includes(ql) || (s.nickname ?? '').toLowerCase().includes(ql)) && !yes.some((a) => a.staff_id === s.id)).slice(0, 8) : [];
  const match = (id: string) => !ql || nm(id).toLowerCase().includes(ql);
  return (
    <div className="ds-pick-wrap" onClick={onClose}><div className="ds-pick" onClick={(ev) => ev.stopPropagation()}>
      <div className="row" style={{ gap: 8 }}><b className="grow">{e.venues?.name ?? e.title} · {plural(code, 2)} {ap(start)}</b><button className="lnk muted" onClick={onClose}>✕</button></div>
      <small className="muted">{dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} · placed, not sent: they see nothing until you confirm</small>
      <input autoFocus placeholder="🔍 Search a name…" value={q} onChange={(ev) => setQ(ev.target.value)} />
      <small className="kick">FREE · SAID YES</small>
      {!yes.filter((a) => match(a.staff_id)).length && <span className="muted sm">Nobody free{ql ? ' with that name' : ''}.</span>}
      {yes.filter((a) => match(a.staff_id)).map((a) => <button key={a.staff_id} className="ds-pp" onClick={() => onPick(a.staff_id)}>
        <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{nm(a.staff_id)}</b><small className={fits(a) ? 'muted' : 'gold'}>{a.from_time ? `from ${ap(a.from_time)}${fits(a) ? '' : ' · after the start'}` : 'any time'}</small></button>)}
      {maybe.filter((a) => match(a.staff_id)).length > 0 && <><small className="kick">MAYBE</small>{maybe.filter((a) => match(a.staff_id)).map((a) => <button key={a.staff_id} className="ds-pp" onClick={() => onPick(a.staff_id)}>
        <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{nm(a.staff_id)}</b><small className="gold">maybe</small></button>)}</>}
      {others.length > 0 && <><small className="kick">OTHERS · NOT ASKED FOR THIS DAY</small>{others.map((s) => <button key={s.id} className="ds-pp" onClick={() => onPick(s.id)}>
        <i className={'ds-t ' + (s.staff_private?.tier ?? '')} /><b className="grow">{s.full_name}</b><small className="gold">not asked · placing = you’ll ask them</small></button>)}</>}
      <button className="abtn sm dark" onClick={onAskSpot} title="Ask free people or people on other events · first yes gets it">Ask people for this spot ›</button>
      <button className="lnk sm" onClick={onAsk}>Ask more people for this day ›</button>
    </div></div>);
}

/** Nov 23 · staff card V2 (Ronnie): Move to (the day's events + lines, or a custom time) · Start · Role · Note → one Save.
 *  Mark confirmed · Replace (not sent = swap with a free person · sent = ask people) · lock bottom left · Back to Free / Cancel bottom right. */
function PersonCard({ s, e, date, evs, lays, byId, av, onDay, off, sortP, tier, busy, onClose, onSave, onLock, onConfirm, onSwap, onRemove, onReplace, onCancel }: {
  s: Sh; e: Ev; date: string; evs: Ev[]; lays: Record<string, ReturnType<typeof layout>>; byId: Record<string, AStaff>; av: Av[]; onDay: Set<string>; off: Set<string>;
  sortP: (a: string, b: string) => number; tier: (id: string) => string | null; busy: boolean; wn?: number; why?: string; onClose: () => void;
  onSave: (row: Record<string, unknown>, label: string) => void; onLock: () => void; onConfirm: () => void; onSwap: (id: string) => void; onRemove: () => void; onReplace: () => void; onCancel: () => void }) {
  const p = byId[s.staff_id]; const can = !LEAD.includes(s.position_code ?? '');
  const dept = isBar(e) ? 'bar' : 'floor';
  const slots = evs.filter((x) => isBar(x) === isBar(e)).flatMap((x) => { const L = lays[x.id]; const ls = [...L.lines.map((l) => ({ ...l, extra: false })), ...(L.extras.count ? [{ ...L.extras, extra: true }] : [])];
    return ls.map((l) => ({ v: `${x.id}|${l.code}|${l.start ?? ''}`, e: x, code: l.code, start: l.start, label: `${x.venues?.name ?? x.title} · ${l.extra ? 'Extras' : plural(l.code, 2)} ${ap(l.start)} (${l.people.length}/${l.count})`, here: x.id === s.event_id && hm(s.planned_start) === l.start })); });
  const hereV = slots.find((x) => x.here)?.v ?? '';
  const [view, setView] = useState<'main' | 'swap'>('main'); const [q, setQ] = useState('');
  const [mv, setMv] = useState(hereV); const [cEv, setCEv] = useState(s.event_id); const [cT, setCT] = useState(hm(s.planned_start));
  const [t, setT] = useState(hm(s.planned_start)); const [role, setRole] = useState(s.position_code ?? ''); const [nt, setNt] = useState(s.booking_note ?? '');
  const slot = slots.find((x) => x.v === mv);
  const moving = can && mv !== hereV && (mv === 'custom' ? (cEv !== s.event_id || cT !== hm(s.planned_start)) : !!slot);
  const row: Record<string, unknown> = {}; const what: string[] = [];
  if (moving) {
    if (mv === 'custom') { const x = evs.find((y) => y.id === cEv); row.event_id = cEv; row.planned_start = startIso(date, cT); what.push(`→ ${x?.venues?.name ?? x?.title ?? ''} ${ap(cT)}`); }
    else if (slot) { row.event_id = slot.e.id; row.position_code = slot.code; row.position_detail = roleName(slot.code); row.planned_start = startIso(date, slot.start ?? slot.e.start_time?.slice(0, 5) ?? '17:00'); what.push(`→ ${slot.e.venues?.name ?? slot.e.title} ${ap(slot.start)}`); }
  } else if (t && t !== hm(s.planned_start)) { row.planned_start = startIso(date, t); what.push(`start ${ap(t)}`); }
  if (can && role && role !== (s.position_code ?? '') && !(moving && mv !== 'custom')) { row.position_code = role; row.position_detail = roleName(role); what.push(roleName(role)); }
  if (nt.trim() !== (s.booking_note ?? '')) { row.booking_note = nt.trim() || null; what.push('note'); }
  const n = what.length;
  const gold = (on: boolean) => (on ? { boxShadow: 'inset 0 0 0 1.5px #C9A227', borderRadius: 8 } : undefined);
  const st = hm(s.planned_start); const fitT = (x: Av) => !x.from_time || !st || x.from_time.slice(0, 5) <= st;
  const sameDept = (x: Av) => ((x.avail_asks?.department ?? byId[x.staff_id]?.department ?? 'floor') === 'bar') === isBar(e);
  const ql = q.trim().toLowerCase();
  const swaps = av.filter((x) => x.status === 'yes' && !x.released_at && !onDay.has(x.staff_id) && !off.has(x.staff_id) && sameDept(x) && (!ql || (byId[x.staff_id]?.full_name ?? '').toLowerCase().includes(ql)))
    .sort((x, y) => Number(!fitT(x)) - Number(!fitT(y)) || sortP(x.staff_id, y.staff_id)).slice(0, 12);
  const chip = s.pool_hold ? <span className="pc-chip">Not sent</span> : s.status === 'confirmed' ? <span className="pc-chip ok">✓ Confirmed</span> : <span className="pc-chip sent">◷ Sent · waiting</span>;
  const tms = (cur: string) => <>{!Q15.includes(cur) && <option value={cur}>{cur ? ap(cur) : '—'}</option>}{Q15.map((x) => <option key={x} value={x}>{ap(x)}</option>)}</>;
  return (
    <div className="ds-pick-wrap" onClick={onClose}><div className="ds-pick ds-pcard pc2" onClick={(ev) => ev.stopPropagation()}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span className="pc-av">{(p?.full_name ?? '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
        <span className="grow"><b className="serif" style={{ fontSize: 19, display: 'block', lineHeight: 1.15 }}>{p?.full_name ?? '…'}</b><a className="lnk sm" href={`/admin/staff?open=${s.staff_id}`}>Profile ›</a></span>
        {chip}<button className="lnk muted" onClick={onClose} aria-label="Close">✕</button></div>
      {view === 'swap' ? <>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}><button className="lnk sm" onClick={() => setView('main')}>‹ Back</button><b>Swap with a free person</b></div>
        <input autoFocus placeholder="Search a free name…" value={q} onChange={(ev) => setQ(ev.target.value)} />
        {!swaps.length && <span className="muted sm">Nobody free{ql ? ' with that name' : ''}.</span>}
        {swaps.map((x) => <button key={x.staff_id} className="ds-pp" disabled={busy} onClick={() => { onSwap(x.staff_id); onClose(); }}>
          <i className={'ds-t ' + (tier(x.staff_id) ?? '')} /><b className="grow">{byId[x.staff_id]?.full_name ?? '…'}</b><small className={fitT(x) ? 'muted' : 'gold'}>{x.from_time ? `from ${ap(x.from_time)}${fitT(x) ? '' : ' · after the start'}` : 'any time'}</small><span className="ds-putin">Put in</span></button>)}
        <small className="muted">{p?.full_name?.split(' ')[0] ?? 'They'} go{p ? 'es' : ''} back to Free.</small>
      </> : <>
        {!s.pool_hold && <small className="pc-sent">Already sent · after Save, a change goes out as “Your shift changed”</small>}
        {can && <label className="pc-f">MOVE TO<select style={gold(moving)} disabled={busy} value={mv} onChange={(ev) => setMv(ev.target.value)}>
          {!hereV && <option value="">—</option>}{slots.map((x) => <option key={x.v} value={x.v}>{x.label}{x.here ? ' · here' : ''}</option>)}<option value="custom">+ Custom time…</option></select></label>}
        {can && mv === 'custom' && <div className="pc-row">
          <label className="pc-f">EVENT<select value={cEv} onChange={(ev) => setCEv(ev.target.value)}>{evs.filter((x) => isBar(x) === isBar(e)).map((x) => <option key={x.id} value={x.id}>{x.venues?.name ?? x.title}</option>)}</select></label>
          <label className="pc-f">START<select className="ds-tsel" value={cT} onChange={(ev) => setCT(ev.target.value)}>{tms(cT)}</select></label></div>}
        <div className="pc-row">
          {!(moving) && <label className="pc-f">START<select className="ds-tsel" style={gold(!!t && t !== hm(s.planned_start))} value={t} disabled={busy} onChange={(ev) => setT(ev.target.value)}>{tms(t)}</select></label>}
          {can && <label className="pc-f">ROLE<select style={gold(role !== (s.position_code ?? ''))} disabled={busy} value={role} onChange={(ev) => setRole(ev.target.value)}>
            {(dept === 'bar' ? ['BT', 'BB', 'WW'] : ['W', 'BUS']).map((c) => <option key={c} value={c}>{roleName(c)}</option>)}</select></label>}
        </div>
        <label className="pc-f">NOTE · YOU + THE MD<input style={gold(nt.trim() !== (s.booking_note ?? ''))} placeholder="e.g. from 4 PM · brings the truck" value={nt} onChange={(ev) => setNt(ev.target.value)} /></label>
        <div className="pc-btns">
          {s.status !== 'confirmed' && <button className="pc-b ok" disabled={busy} onClick={onConfirm} title="They told you yes (text, call): marked confirmed, no message sent">Mark confirmed</button>}
          {can && <button className="pc-b line" disabled={busy} onClick={() => (s.pool_hold ? setView('swap') : onReplace())}>Replace</button>}
          <button className="pc-b ink" disabled={busy || !n} onClick={() => onSave(row, what.join(' · '))}>{n ? `Save · ${n} change${n > 1 ? 's' : ''}` : 'Save'}</button>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <button className={'pc-lock' + (s.locked ? ' on' : '')} disabled={busy} onClick={onLock} title={s.locked ? 'Locked · Fill and Clear leave them here · tap to unlock' : 'Lock · Fill and Clear leave them here'}>{s.locked ? '🔒' : '🔓'}</button>
          {s.locked && <small className="muted">Locked</small>}<span className="grow" />
          {can && (s.pool_hold ? <button className="lnk sm red" disabled={busy} onClick={onRemove}>Back to Free</button> : <button className="lnk sm red" disabled={busy} onClick={onCancel}>Cancel with a reason…</button>)}
        </div>
      </>}
    </div></div>);
}

/** push 115 · change after they were sent / confirmed → pick how they're told. Default = About to send (as before). */
function TellBox({ q, names, states }: { q: { what: string; notice: string; res: (t: 'buzz' | 'soft' | 'later' | 'skip' | null) => void }; names: string[]; states: string[] }) {
  const [t, setT] = useState<'buzz' | 'soft' | 'later' | 'skip'>('later');
  const opts: ['buzz' | 'soft' | 'later' | 'skip', string, string][] = [
    ['buzz', 'Send now · phone alert', 'only them, right away (with their other waiting changes)'],
    ['soft', 'Send now · no alert', 'the card shows in their app, quietly'],
    ['later', 'Add to “About to send”', 'goes with the others when you press Send'],
    ['skip', 'Don’t tell them', 'you told them yourself · saved, nothing sent, counts as seen'],
  ];
  return (
    <div className="ds-pick-wrap" onClick={() => q.res(null)}><div className="ds-pick ds-tell" onClick={(ev) => ev.stopPropagation()}>
      <b className="serif" style={{ fontSize: 18 }}>{names.length === 1 ? names[0] : `${names.length} people`} {names.length === 1 ? `is ${states[0]}` : 'already sent'}</b>
      {names.length > 1 && <small className="muted">{names.join(', ')}</small>}
      <span className="sm">{q.what}</span>
      <small className="kick">THEY GET “{q.notice.toUpperCase()}” · HOW?</small>
      {opts.map(([k, l, d]) => <button key={k} className={'ds-topt' + (t === k ? ' on' : '')} onClick={() => setT(k)}><i>{t === k ? '●' : '○'}</i><span className="grow"><b>{l}</b><small>{d}</small></span></button>)}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}><button className="lnk muted sm" onClick={() => q.res(null)}>Cancel · change nothing</button><button className="abtn dark" onClick={() => q.res(t)}>Save the change</button></div>
    </div></div>);
}

/** push 118 · event details right in the booking card (Ronnie: collapsible, open by default, remembered per event). */
function Details({ e, open, onToggle, venues, clients, types, busy, onEv, onVenue, onClient, onType }: { e: Ev; open: boolean; onToggle: () => void; venues: { id: string; name: string }[]; clients: { id: string; name: string }[]; types: string[]; busy: boolean;
  onEv: (row: Record<string, unknown>, label: string) => void; onVenue: (id: string) => void; onClient: (id: string) => void; onType: (t: string) => void }) {
  const [g, setG] = useState(e.guests ? String(e.guests) : ''); const [nt, setNt] = useState(e.notes ?? ''); const [ti, setTi] = useState(e.title ?? '');
  useEffect(() => { setG(e.guests ? String(e.guests) : ''); setNt(e.notes ?? ''); setTi(e.title ?? ''); }, [e.guests, e.notes, e.title]);
  // Nov 16 · uniform = two pickers from a fixed list: Men and Women (each person sees theirs)
  const uKey = isBar(e) ? 'uniform_bar' : 'uniform_floor'; const uVal = (isBar(e) ? e.uniform_bar : e.uniform_floor) ?? '';
  const wKey = uKey + '_w'; const wVal = (isBar(e) ? e.uniform_bar_w : e.uniform_floor_w) ?? '';
  const uL = (k: string) => UNIFORMS.find(([x]) => x === k)?.[1];
  const MEN = UNIFORMS.filter(([k]) => k !== 'dress');
  const sum = [e.event_private?.client, e.guests ? `${e.guests} guests` : null, e.caterer_name ? `Food by ${e.caterer_name}` : null, uVal ? `Men: ${uL(uVal)}` : null, wVal ? `Women: ${uL(wVal)}` : null, e.event_type].filter(Boolean).join(' · ');
  if (!open) return <button className="ds-det fold" onClick={onToggle}><b>Details</b><span className="grow">{sum || 'nothing filled in yet'}</span><span className="ds-dett">Show details ▾</span></button>;
  const vs = [...venues].sort((a, b) => a.name.localeCompare(b.name)); const cs = [...clients].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="ds-det">
      <div className="row" style={{ alignItems: 'center' }}><b>Details</b><span className="grow" /><button className="ds-dett" onClick={onToggle}>Hide details ▴</button></div>
      <div className="ds-detg">
        <label className="wide2" title="What staff see as the title · Venue · Type unless you type one">EVENT NAME<input value={ti} disabled={busy} onChange={(ev) => setTi(ev.target.value)} onBlur={() => { if (ti.trim() && ti.trim() !== (e.title ?? '')) onEv({ title: ti.trim() }, `name → ${ti.trim()}`); else setTi(e.title ?? ''); }} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} /></label>
        <label>VENUE<select value={e.venue_id ?? ''} disabled={busy} onChange={(ev) => onVenue(ev.target.value)}><option value="">—</option>{vs.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label>CLIENT<select value={e.event_private?.client_id ?? ''} disabled={busy} onChange={(ev) => onClient(ev.target.value)}><option value="">{e.event_private?.client ?? '—'}</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>GUESTS<input inputMode="numeric" value={g} disabled={busy} onChange={(ev) => setG(ev.target.value.replace(/\D/g, ''))} onBlur={() => { const n = g ? Number(g) : null; if (n !== (e.guests ?? null)) onEv({ guests: n }, `guests → ${n ?? '—'}`); }} /></label>
        <label>FOOD BY<select value={e.caterer_id ?? ''} disabled={busy} onChange={(ev) => onEv({ caterer_id: ev.target.value || null }, `food by → ${cs.find((c) => c.id === ev.target.value)?.name ?? '—'}`)}><option value="">—</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="wide2">EVENT TYPE<select value={e.event_type ?? ''} disabled={busy} onChange={(ev) => onType(ev.target.value)}><option value="">—</option>{[...new Set([...(e.event_type ? [e.event_type] : []), ...types])].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <UniPick label="UNIFORM · MEN" value={uVal} onChange={(v) => onEv({ [uKey]: v || null }, `men's uniform → ${uL(v) ?? (v.startsWith('custom:') ? v.slice(7) : v === 'none' ? 'No uniform' : '—')}`)} />
        <UniPick women label="UNIFORM · WOMEN" value={wVal} onChange={(v) => onEv({ [wKey]: v || null }, `women's uniform → ${uL(v) ?? (v.startsWith('custom:') ? v.slice(7) : v === 'none' ? 'No uniform' : '—')}`)} />
        <label className="wide2">NOTES FOR STAFF<input value={nt} disabled={busy} placeholder="e.g. enter by the side door · parking at the back" onChange={(ev) => setNt(ev.target.value)} onBlur={() => { if (nt.trim() !== (e.notes ?? '')) onEv({ notes: nt.trim() || null }, 'notes for staff'); }} /></label>
      </div>
      <small className="muted">Saves as you go, like the event form · ↶ Undo · staff see it in the app (no message) · on-site contact = the MD</small>
    </div>);
}

/** Nov 23 · V6 details: folded = one line; open = 4 groups · What & who (+ Estimate #) · Where & when · For the staff (+ Drive folder) · Notes (Staff / MDs / Billing). */
function DetailsV6({ e, pv, open, onToggle, venues, clients, types, busy, onEv, onPriv, onVenue, onClient, onType }: { e: Ev; pv?: { estimate_no?: string | null; md_note?: string | null; billing_note?: string | null }; open: boolean; onToggle: () => void;
  venues: { id: string; name: string }[]; clients: { id: string; name: string }[]; types: string[]; busy: boolean;
  onEv: (row: Record<string, unknown>, label: string) => void; onPriv: (row: Record<string, string | null>, label: string) => void; onVenue: (id: string) => void; onClient: (id: string) => void; onType: (t: string) => void }) {
  const [ti, setTi] = useState(e.title ?? ''); const [g, setG] = useState(e.guests ? String(e.guests) : ''); const [est, setEst] = useState(pv?.estimate_no ?? ''); const [dr, setDr] = useState(e.drive_folder_url ?? '');
  const [nt, setNt] = useState<'staff' | 'md' | 'bill'>('staff'); const [nv, setNv] = useState({ staff: e.notes ?? '', md: pv?.md_note ?? '', bill: pv?.billing_note ?? '' });
  useEffect(() => { setTi(e.title ?? ''); setG(e.guests ? String(e.guests) : ''); setDr(e.drive_folder_url ?? ''); }, [e.title, e.guests, e.drive_folder_url]);
  useEffect(() => { setEst(pv?.estimate_no ?? ''); setNv({ staff: e.notes ?? '', md: pv?.md_note ?? '', bill: pv?.billing_note ?? '' }); }, [pv?.estimate_no, pv?.md_note, pv?.billing_note, e.notes]);
  const uKey = isBar(e) ? 'uniform_bar' : 'uniform_floor'; const uVal = (isBar(e) ? e.uniform_bar : e.uniform_floor) ?? '';
  const wKey = uKey + '_w'; const wVal = (isBar(e) ? e.uniform_bar_w : e.uniform_floor_w) ?? '';
  const uL = (k: string) => UNIFORMS.find(([x]) => x === k)?.[1]; const MEN = UNIFORMS.filter(([k]) => k !== 'dress');
  const tm = (t?: string | null) => (t ? ap(t.slice(0, 5)) : '');
  const sum = [e.event_private?.client, e.guests ? `${e.guests} guests` : null, e.start_time ? `start ${tm(e.start_time)}` : null, pv?.estimate_no ? `est. #${pv.estimate_no}` : null].filter(Boolean).join(' · ');
  if (!open) return <button className="ds-det fold" onClick={onToggle}><b>Details</b><span className="grow">{sum || 'nothing filled in yet'}</span><span className="ds-dett">Show details ▾</span></button>;
  const vs = [...venues].sort((a, b) => a.name.localeCompare(b.name)); const cs = [...clients].sort((a, b) => a.name.localeCompare(b.name));
  const saveNote = () => { const cur = nt === 'staff' ? e.notes ?? '' : nt === 'md' ? pv?.md_note ?? '' : pv?.billing_note ?? ''; const v = nv[nt].trim(); if (v === cur) return;
    if (nt === 'staff') onEv({ notes: v || null }, 'notes for staff'); else onPriv(nt === 'md' ? { md_note: v || null } : { billing_note: v || null }, nt === 'md' ? 'notes for MDs' : 'billing notes'); };
  const tabB = (k: 'staff' | 'md' | 'bill', l: string, has: boolean) => <button className={nt === k ? 'on' : ''} onClick={() => { saveNote(); setNt(k); }}>{l}{has ? ' ·' : ''}</button>;
  return (
    <div className="ds-det v6det">
      <div className="row" style={{ alignItems: 'center' }}><b>EVENT DETAILS</b><small className="muted" style={{ marginLeft: 10 }}>saves as you go · staff see the title, place, times, uniform, staff notes, folder</small><span className="grow" /><button className="ds-dett" onClick={onToggle}>Hide ▴</button></div>
      <small className="v6g">1 · WHAT &amp; WHO</small>
      <div className="ds-detg">
        <label>EVENT NAME<input value={ti} disabled={busy} onChange={(ev) => setTi(ev.target.value)} onBlur={() => { if (ti.trim() && ti.trim() !== (e.title ?? '')) onEv({ title: ti.trim() }, `name → ${ti.trim()}`); else setTi(e.title ?? ''); }} /></label>
        <label>CLIENT · ONLY YOU<select value={e.event_private?.client_id ?? ''} disabled={busy} onChange={(ev) => onClient(ev.target.value)}><option value="">{e.event_private?.client ?? '—'}</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>ESTIMATE # · ONLY YOU<input value={est} disabled={busy} placeholder="e.g. 3325" onChange={(ev) => setEst(ev.target.value)} onBlur={() => { if (est.trim() !== (pv?.estimate_no ?? '')) onPriv({ estimate_no: est.trim() || null }, `estimate # ${est.trim() || '—'}`); }} /></label>
        <label>EVENT TYPE<select value={e.event_type ?? ''} disabled={busy} onChange={(ev) => onType(ev.target.value)}><option value="">—</option>{[...new Set([...(e.event_type ? [e.event_type] : []), ...types])].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      </div>
      <small className="v6g">2 · WHERE &amp; WHEN</small>
      <div className="ds-detg">
        <label>VENUE<select value={e.venue_id ?? ''} disabled={busy} onChange={(ev) => onVenue(ev.target.value)}><option value="">—</option>{vs.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label>GUESTS<input inputMode="numeric" value={g} disabled={busy} onChange={(ev) => setG(ev.target.value.replace(/\D/g, ''))} onBlur={() => { const n = g ? Number(g) : null; if (n !== (e.guests ?? null)) onEv({ guests: n }, `guests → ${n ?? '—'}`); }} /></label>
        <label>STARTS<select className="ds-tsel" value={e.start_time?.slice(0, 5) ?? ''} disabled={busy} onChange={(ev) => onEv({ start_time: ev.target.value || null }, `start → ${tm(ev.target.value) || '—'}`)}><option value="">—</option>{Q15.map((q) => <option key={q} value={q}>{ap(q)}</option>)}</select></label>
        <label>ENDS<select className="ds-tsel" value={e.end_time?.slice(0, 5) ?? ''} disabled={busy} onChange={(ev) => onEv({ end_time: ev.target.value || null }, `end → ${tm(ev.target.value) || '—'}`)}><option value="">—</option>{Q15.map((q) => <option key={q} value={q}>{ap(q)}</option>)}</select></label>
      </div>
      <small className="v6g">3 · FOR THE STAFF</small>
      <div className="ds-detg">
        <UniPick label="UNIFORM · MEN" value={uVal} onChange={(v) => onEv({ [uKey]: v || null }, `men's uniform → ${uL(v) ?? (v.startsWith('custom:') ? v.slice(7) : v === 'none' ? 'No uniform' : '—')}`)} />
        <UniPick women label="UNIFORM · WOMEN" value={wVal} onChange={(v) => onEv({ [wKey]: v || null }, `women's uniform → ${uL(v) ?? (v.startsWith('custom:') ? v.slice(7) : v === 'none' ? 'No uniform' : '—')}`)} />
        <label>FOOD BY<select value={e.caterer_id ?? ''} disabled={busy} onChange={(ev) => onEv({ caterer_id: ev.target.value || null }, `food by → ${cs.find((c) => c.id === ev.target.value)?.name ?? '—'}`)}><option value="">—</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>DRIVE FOLDER<input value={dr} disabled={busy} placeholder="Paste a link…" onChange={(ev) => setDr(ev.target.value)} onBlur={() => { if (dr.trim() !== (e.drive_folder_url ?? '')) onEv({ drive_folder_url: dr.trim() || null }, 'Drive folder'); }} /></label>
      </div>
      <small className="v6g">4 · NOTES</small>
      <span className="seg3 v6tabs">{tabB('staff', 'Staff', !!e.notes)}{tabB('md', 'MDs', !!pv?.md_note)}{tabB('bill', 'Billing', !!pv?.billing_note)}</span>
      <textarea className="v6-notes" rows={2} disabled={busy} value={nv[nt]} placeholder={nt === 'staff' ? 'Everyone on the event sees it · e.g. enter by the side door' : nt === 'md' ? 'Only the MD / bar manager and co-managers' : 'Only you · goes with the invoice: extras, overtime, transport…'}
        onChange={(ev) => setNv({ ...nv, [nt]: ev.target.value })} onBlur={saveNote} />
    </div>);
}

/** push 122 · cancel with a reason (Ronnie, Nov 13): kept on their record; ranking or not is his call. */
function CancelBox({ s, name, where, onClose, onSave }: { s: Sh; name: string; where: string; onClose: () => void; onSave: (reason: string, note: string, counts: boolean, replace: boolean) => void }) {
  const [r, setR] = useState(''); const [n, setN] = useState(''); const [c, setC] = useState(s.status === 'confirmed'); const [rep, setRep] = useState(false);
  return (
    <div className="ds-pick-wrap" onClick={onClose}><div className="ds-pick ds-tell" onClick={(ev) => ev.stopPropagation()}>
      <b className="serif" style={{ fontSize: 19 }}>{name} · cancel</b><small className="muted">{where}</small>
      <small className="kick">REASON</small>
      <div className="ds-rs">{['Sick', 'Emergency', 'Transport', 'Time change', 'No-show', 'Other'].map((x) => <button key={x} className={r === x ? 'on' : ''} onClick={() => setR(x)}>{x}</button>)}</div>
      <input placeholder="Note (stays on their profile) · e.g. texted at 7:40 AM, fever" value={n} onChange={(ev) => setN(ev.target.value)} />
      <small className="kick">COUNTS IN RANKING?</small>
      <div className="ds-rs two"><button className={c ? 'on' : ''} onClick={() => setC(true)}>Yes · late cancel</button><button className={!c ? 'on' : ''} onClick={() => setC(false)}>No · excused</button></div>
      <small className="muted">Starts on Yes when they had confirmed · you decide</small>
      <label className="row sm" style={{ gap: 8 }}><input type="checkbox" checked={rep} onChange={(ev) => setRep(ev.target.checked)} /> Find a replacement after (opens the pick list for the spot)</label>
      <div className="row" style={{ gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}><button className="lnk muted sm" onClick={onClose}>Cancel · change nothing</button>
        <button className="abtn ds-cxgo" disabled={!r} onClick={() => onSave(r, n, c, rep)}>Cancel {name.split(' ')[0]}</button></div>
      <small className="muted">Nothing is sent to them · their MD sees them crossed out · ↶ Undo</small>
    </div></div>);
}
