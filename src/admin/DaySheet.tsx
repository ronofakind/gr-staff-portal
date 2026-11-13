// push 108 · Bookings revamp, part 1: the Day sheet (board BookingDaySheetV1, doc "G&R staff app booking day sheet (mapping)").
// One screen shaped like the Events sheet: each event = a block (MD / bar manager at the head, one row per staff line with its
// count, time and slots, + an extras line), "Free this day" on the right. Tap a slot → pick; drag a name to another slot / event /
// back to Free; × → back to Free; ↶ Undo = last move. New placements are pool shifts (staff see nothing until you confirm).
// Part 2 (push 109) = ✦ Fill the day / week / block, Clear, ⚑ more than 3 shifts, hover = why. Part 3 = click a name (person card, note, lock, confirm), part 4 = phone swap + retire Bookings / Day pool.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { UNIFORMS, addDays, dLabel, eventsBetween, isoDay, roleName, startIso, type AEvent, type AShift, type AStaff } from './api';
import { ReplaceSheet } from './Replace';
import { SendBox, pendingCount } from './SendBox';
import { ROLES } from './api';
import { LEAD, hm, isBar, isFar, layout, loadCtx, loadDay, planFill, weekCounts, whyText, type Av, type Ctx, type Ev, type Line, type Row, type Sh, isNewStaff } from './dayFill';

type Op = { label: string; undo: () => PromiseLike<unknown> };
const TORD: Record<string, number> = { A: 0, B: 1, C: 2 };
const ap = (t: string | null | undefined) => { if (!t) return 'TBC'; const h = Number(t.slice(0, 2)); return `${h % 12 || 12}${t.slice(2, 5) !== ':00' ? t.slice(2, 5) : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const roleShort = (c: string) => ({ W: 'W', WW: 'WW', BT: 'BT', BB: 'BB', BUS: 'Bus', MD: 'MD', BM: 'BM' } as Record<string, string>)[c] ?? c;
const plural = (code: string, n: number) => { const r = roleName(code) || code; return n === 1 ? r : r.endsWith('s') ? r : r + 's'; };
const short = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : n; };
const monday = (d: string) => { const x = new Date(d + 'T12:00:00'); const k = (x.getDay() + 6) % 7; return addDays(d, -k); };

/** push 112 · old Day pool links land on the Day sheet. */
export function PoolToSheet() { const { date = isoDay(new Date()) } = useParams(); return <Navigate to={`/admin/day-sheet/${date}`} replace />; }

export function DaySheet() {
  const { date = isoDay(new Date()) } = useParams(); const nav = useNavigate();
  const [dept, setDept] = useState<'floor' | 'bar' | 'both'>(() => { try { return (localStorage.getItem('gr_ds_dept') as 'floor' | 'bar' | 'both') || 'both'; } catch { return 'both'; } });
  const [evs, setEvs] = useState<Ev[]>([]); const [sh, setSh] = useState<Sh[]>([]); const [av, setAv] = useState<Av[]>([]); const [off, setOff] = useState<Set<string>>(new Set());
  const [staff, setStaff] = useState<AStaff[]>([]); const [week, setWeek] = useState<{ d: string; need: number; have: number; n: number; free: number }[]>([]);
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [ops, setOps] = useState<Op[]>([]); const [pick, setPick] = useState<{ e: Ev; code: string; start: string | null } | null>(null);
  // a ref, not state: setting state on drag start re-rendered the page and the browser dropped the drag (Ronnie, Nov 12)
  const dragR = useRef<Sh | { staff_id: string } | null>(null); const setDrag = (d: Sh | { staff_id: string } | null) => { dragR.current = d; }; const [tab, setTab] = useState<'yes' | 'maybe'>('yes');
  const [ctx, setCtx] = useState<Ctx | null>(null); const [wn, setWn] = useState<Record<string, number>>({}); const [why, setWhy] = useState<Record<string, string>>({}); const [card, setCard] = useState<Sh | null>(null);
  // push 113 · line editing + cell grid
  const [ed, setEd] = useState<{ eid: string; key: string } | null>(null); const [edT, setEdT] = useState(''); const [add, setAdd] = useState<{ eid: string; code: string; count: string; t: string } | null>(null);
  const [flagged, setFlagged] = useState<Record<string, string>>({}); const [pend, setPend] = useState(0); const [sendOpen, setSendOpen] = useState(false);
  const [types, setTypes] = useState<string[]>([]); const [detTick, setDetTick] = useState(0);
  useEffect(() => { supabase.from('event_types').select('name,sort').order('sort').then(({ data }) => setTypes(((data ?? []) as { name: string }[]).map((x) => x.name))); }, []);
  const detOpen = (id: string) => { void detTick; try { return localStorage.getItem('gr_ds_det_' + id) !== '0'; } catch { return true; } };
  const togDet = (id: string) => { try { localStorage.setItem('gr_ds_det_' + id, detOpen(id) ? '0' : '1'); } catch { /* */ } setDetTick((t) => t + 1); };
  const blocksR = useRef<HTMLDivElement | null>(null); const [cols, setCols] = useState(4); const [narrow, setNarrow] = useState(false);
  // push 119 · Ronnie: "a little squished" → Free this day folds to a thin tab, END ~ column can be hidden (both remembered)
  const ls0 = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
  const [freeFold, setFreeFold] = useState(() => ls0('gr_ds_freefold')); const [noEnd, setNoEnd] = useState(() => ls0('gr_ds_noend'));
  useEffect(() => { try { localStorage.setItem('gr_ds_freefold', freeFold ? '1' : '0'); localStorage.setItem('gr_ds_noend', noEnd ? '1' : '0'); } catch { /* */ } }, [freeFold, noEnd]); const [repl, setRepl] = useState<{ s: AShift; e: AEvent } | null>(null);
  useEffect(() => { loadCtx().then((c) => { setCtx(c); setStaff(c.staff); }).catch((x) => setErr((x as Error).message)); }, []);
  useEffect(() => { try { localStorage.setItem('gr_ds_dept', dept); } catch { /* */ } }, [dept]);
  const wk0 = monday(date);

  useEffect(() => { (async () => {
    try { const d = await loadDay(date); setEvs(d.evs); setSh(d.sh); setAv(d.av); setOff(d.off); } catch (x) { setErr((x as Error).message); }
  })(); }, [date, tick]);
  useEffect(() => { weekCounts(wk0, addDays(wk0, 6)).then(setWn); }, [wk0, tick]);
  useEffect(() => { const ids = evs.map((e) => e.id); if (!ids.length) { setPend(0); return; } pendingCount(ids).then(setPend); }, [evs, tick]);
  const noEndR = useRef(noEnd); noEndR.current = noEnd;
  // C · as many equal cells across as fit (Ronnie, Nov 12): one count for the whole sheet so every block lines up
  useEffect(() => { const el = blocksR.current; if (!el) return; const f = () => { const w = el.clientWidth; const phone = window.innerWidth <= 700 || w < 760; setNarrow(w < 760);
      const room = phone ? w - 40 : w - 40 - 140 - 92 - (noEndR.current ? 0 : 100) - 112 - 46 - 32; setCols(Math.max(2, Math.floor((room + 6) / ((phone ? 128 : 142) + 6)))); };
    f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, [evs.length, noEnd, freeFold]);

  // week strip
  useEffect(() => { (async () => {
    const to = addDays(wk0, 6);
    const { data: we } = await supabase.from('events').select('id,event_date,department,staffing,staff_needed').gte('event_date', wk0).lte('event_date', to);
    const ids = ((we ?? []) as { id: string }[]).map((x) => x.id);
    const [{ data: ws }, { data: wa }] = await Promise.all([
      supabase.from('shifts').select('event_id').in('event_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).neq('status', 'declined'),
      supabase.from('availability').select('for_date,staff_id,status,released_at').gte('for_date', wk0).lte('for_date', to).eq('status', 'yes').is('released_at', null)]);
    const byEv: Record<string, number> = {}; for (const r of (ws ?? []) as { event_id: string }[]) byEv[r.event_id] = (byEv[r.event_id] ?? 0) + 1;
    const out = [...Array(7)].map((_, i) => { const d = addDays(wk0, i); const de = ((we ?? []) as { id: string; event_date: string; staffing: Line[] | null; staff_needed: number }[]).filter((x) => x.event_date === d);
      const need = de.reduce((n, x) => n + ((x.staffing ?? []).reduce((m, l) => m + (l.count || 0), 0) || x.staff_needed || 0), 0);
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
  const free = av.filter((a) => inDept(a) && a.status === tab && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).sort((a, b) => sortP(a.staff_id, b.staff_id));
  const nYes = av.filter((a) => inDept(a) && a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).length;
  const nMaybe = av.filter((a) => inDept(a) && a.status === 'maybe' && !a.released_at && !onDay.has(a.staff_id)).length;
  const lays = useMemo(() => Object.fromEntries(evs.map((e) => [e.id, layout(e, sh.filter((s) => s.event_id === e.id), rkOf)])), [evs, sh, staff]); // eslint-disable-line react-hooks/exhaustive-deps
  const tot = (b: boolean) => evs.filter((e) => isBar(e) === b).reduce((acc, e) => { const L = lays[e.id]; const need = L.client + L.extras.count; const have = sh.filter((s) => s.event_id === e.id).length; return [acc[0] + have, acc[1] + need]; }, [0, 0]);
  const [fl, br] = [tot(false), tot(true)];
  const removable = (s: Sh) => s.pool_hold && !s.locked;

  const run = async (f: () => Promise<Op | string | void>) => { setBusy(true); setErr(''); setMsg('');
    try { const r = await f(); if (r && typeof r === 'object') setOps((o) => [...o.slice(-29), r]); else if (typeof r === 'string') setMsg(r); } catch (x) { setErr((x as Error).message); }
    setBusy(false); setTick((t) => t + 1); };
  const place = (staffId: string, e: Ev, code: string, start: string | null) => run(async () => {
    const t = start ?? e.start_time?.slice(0, 5) ?? '17:00';
    const { data, error } = await supabase.from('shifts').insert({ event_id: e.id, staff_id: staffId, position_code: code, position_detail: roleName(code), planned_start: startIso(date, t), status: 'booked', pool_hold: true,
      time_tbc: !!(e.start_tbc || e.details_pending) }).select('id').single(); if (error) throw error;
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
  const lineSave = (e: Ev, next: Line[], label: string, moves: { s: Sh; t: string }[] = []) => run(async () => {
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
    st[idx] = { ...l, start: t }; lineSave(e, st, `${plural(l.code, 2)} → ${ap(t)}`, moves);
  };
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
    if (add.code === 'EX') { const a0 = add; setAdd(null); run(async () => { const b = { extras: e.extras ?? null, extras_start: e.extras_start ?? null };
      const { error } = await supabase.from('events').update({ extras: n, extras_start: a0.t }).eq('id', e.id); if (error) throw error;
      return { label: `+ ${n} extras ${ap(a0.t)}`, undo: () => supabase.from('events').update(b).eq('id', e.id).then() }; }); return; }
    const st = [...(e.staffing ?? []), { dept: isBar(e) ? 'bar' : 'floor', code: add.code, count: n, start: add.t }]; setAdd(null); lineSave(e, st, `+ ${n} ${plural(add.code, n)} ${ap(add.t)}`); };
  /** push 118 · details right in the card (saves like the event form; staff see it in the app, no message). */
  const saveEv = (e: Ev, row: Record<string, unknown>, label: string) => run(async () => {
    const keys = Object.keys(row); const before = Object.fromEntries(keys.map((k) => [k, (e as unknown as Record<string, unknown>)[k] ?? null]));
    const { error } = await supabase.from('events').update(row).eq('id', e.id); if (error) throw error;
    return { label: `${label} · ${e.venues?.name ?? e.title}`, undo: () => supabase.from('events').update(before).eq('id', e.id).then() };
  });
  const saveClient = (e: Ev, cid: string) => run(async () => {
    const c = ctx?.clients.find((x) => x.id === cid); const b = { client_id: e.event_private?.client_id ?? null, client: e.event_private?.client ?? null };
    const { error } = await supabase.from('event_private').upsert({ event_id: e.id, client_id: cid || null, client: c?.name ?? null }, { onConflict: 'event_id' }); if (error) throw error;
    return { label: `client → ${c?.name ?? '—'}`, undo: () => supabase.from('event_private').upsert({ event_id: e.id, ...b }, { onConflict: 'event_id' }).then() };
  });
  const setVenue = (e: Ev, vid: string) => { const v = ctx?.venues.find((x) => x.id === vid); const row: Record<string, unknown> = { venue_id: vid || null };
    if (v && (!e.title || e.title === e.venues?.name)) row.title = v.name; saveEv(e, row, `venue → ${v?.name ?? '—'}`); };
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
  const unflag = (id: string) => setFlagged((f) => { const g = { ...f }; delete g[id]; return g; });
  const dropOn = (e: Ev, code: string, start: string | null) => { const d = dragR.current; setDrag(null); if (!d) return; if ('id' in d) move(d, e, code, start); else place(d.staff_id, e, code, start); };

  const Chip = ({ s, at }: { s: Sh; at?: string | null }) => { const own = at && s.planned_start && hm(s.planned_start) !== at ? hm(s.planned_start) : null; const nm = byId[s.staff_id]?.full_name ?? '…'; const t = tier(s.staff_id); const can = removable(s);
    const a = av.find((x) => x.staff_id === s.staff_id); const late = a?.from_time && s.planned_start && a.from_time.slice(0, 5) > hm(s.planned_start);
    const e = evs.find((x) => x.id === s.event_id); const n = wn[s.staff_id] ?? 0;
    const w = [why[s.id] ? `✦ ${why[s.id]}` : null, e && ctx ? whyText(s.staff_id, e, ctx, sh.filter((x) => x.event_id === s.event_id && x.staff_id !== s.staff_id).map((x) => x.staff_id), n, a) : null,
      s.locked ? 'locked' : null, !s.pool_hold ? (s.status === 'confirmed' ? 'confirmed' : s.notified_at ? 'sent' : 'booked') : null].filter(Boolean).join(' · ');
    return <span className={'ds-chip' + (can ? '' : ' fixed') + (n > 3 ? ' flag' : '') + (flagged[s.id] ? ' over' : '')} draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', s.id); ev.dataTransfer.effectAllowed = 'move'; setDrag(s); }} onDragEnd={() => setDrag(null)} title={`${nm} · ${w}${s.booking_note ? ` · 📌 ${s.booking_note}` : ''}${s.pool_hold ? ' · moving them sends nothing' : ' · already sent: moving them sends "Your shift changed" (asked first)'} · click = options`} onClick={() => setCard(s)}>
      <i className={'ds-t ' + (t ?? '')} /><span className="ds-nm">{short(nm)}</span>{ctx && isNewStaff(ctx, s.staff_id) ? <small className="ds-new" title="New: came through onboarding">NEW</small> : null}{s.locked ? ' 🔒' : ''}{!s.pool_hold && s.status === 'confirmed' ? ' ✓' : ''}{own ? <small className="ds-own" title={`Starts at ${ap(own)} (line ${ap(at)})`}>{ap(own)}</small> : late ? <small className="gold"> from {ap(a!.from_time)}</small> : null}{s.booking_note ? <small className="ds-note" title={s.booking_note}>📌</small> : null}{n > 3 ? <small className="ds-flag" title={`${n} shifts this week`}>⚑{n}</small> : null}
      {!LEAD.includes(s.position_code ?? '') && <button className="ds-x" disabled={busy} onClick={(ev) => { ev.stopPropagation(); remove(s); }} aria-label={`Back to free: ${nm}`}>×</button>}</span>; };
  const Slot = ({ e, code, start }: { e: Ev; code: string; start: string | null }) =>
    <button className="ds-slot" onClick={() => setPick({ e, code, start })} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>+ fill</button>;
  const Step = ({ n, on }: { n: number; on: (n: number) => void }) => <span className="ds-step"><button disabled={busy} onClick={() => on(n - 1)} aria-label="One less">−</button><b>{n}</b><button disabled={busy} onClick={() => on(n + 1)} aria-label="One more">+</button></span>;
  const TimePop = ({ e, k, start, title, onSet, people }: { e: Ev; k: string; start: string | null; title: string; onSet: (t: string) => void; people?: Sh[] }) => (
    ed?.eid === e.id && ed.key === k ? <span className="ds-tpop" onClick={(ev) => ev.stopPropagation()}><b>{title}</b>
      <span className="ds-tq">{(() => { const [h, m] = (start ?? '17:00').split(':').map(Number); const b0 = h * 60 + m; return [-60, -30, -15, 15, 30, 60].map((d) => { const x = b0 + d; const t = `${String(Math.floor(((x % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((x % 60) + 60) % 60).padStart(2, '0')}`; return <button key={d} onClick={() => onSet(t)}>{ap(t)}</button>; }); })()}</span>
      <span className="row" style={{ gap: 6 }}><input type="time" step={900} value={edT} onChange={(ev) => setEdT(ev.target.value)} /><button className="abtn sm dark" disabled={!edT || edT === start} onClick={() => onSet(edT)}>Set</button></span>
      {people && <small className="muted">{people.length ? `${people.length} on this line move with it${people.some((x) => !x.pool_hold) ? ' · already sent: you choose how they’re told' : ' (not sent yet)'}` : 'nobody on it yet'}</small>}</span> : null);
  const tBtn = (e: Ev, k: string, start: string | null) => <button className={'ds-tbtn' + (ed?.eid === e.id && ed.key === k ? ' on' : '')} disabled={busy} onClick={() => { setEdT(start ?? ''); setEd(ed?.eid === e.id && ed.key === k ? null : { eid: e.id, key: k }); }}>{ap(start)}</button>;
  /** push 118 · one row like the event form: ROLE · START · END ~ · HOW MANY · NAMES (equal cells, rating colour) · n/n */
  const Row = ({ e, code, start, end, count, people, extra, idx, lead }: { e: Ev; code: string; start: string | null; end?: string | null; count: number; people: Sh[]; extra?: boolean; idx?: number; lead?: boolean }) => {
    const cells = people.length + Math.max(0, count - people.length); const pad = cells ? (cols - (cells % cols)) % cols : 0; const tbc = !!(e.start_tbc || e.details_pending);
    const roles = ROLES.filter((r) => (isBar(e) ? r.dept === 'bar' : r.dept === 'floor') && !LEAD.includes(r.code));
    return (
    <div className={'ds-line' + (extra ? ' ex' : '') + (lead ? ' lead' : '')} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>
      <span className="ds-role">{lead ? <b>{isBar(e) ? 'Bar manager' : 'MD'}</b> : extra ? <b>Extras <em>{e.extras == null ? '10%' : ''}</em></b>
        : <select value={code} disabled={busy || idx == null} onChange={(ev) => idx != null && setRole(e, idx, ev.target.value)}>{roles.some((r) => r.code === code) ? null : <option value={code}>{roleName(code)}</option>}{roles.map((r) => <option key={r.code} value={r.code}>{r.code === 'WW' ? 'Wine waiter' : r.label}</option>)}</select>}</span>
      <span className="ds-time">{tbc ? <span className="ds-tro">TBC</span> : lead ? <span className="ds-tro">{ap(start)}</span> : extra ? <>{tBtn(e, 'x', start)}<TimePop e={e} k="x" start={start} title="Start of the extras" onSet={(t) => setExtrasTime(e, t)} /></>
        : idx != null ? <>{tBtn(e, String(idx), start)}<TimePop e={e} k={String(idx)} start={start} title="Start of this line" onSet={(t) => setTime(e, idx, t)} people={people} /></> : <span className="ds-tro">{ap(start)}</span>}</span>
      <span className="ds-end">{idx != null && !lead && !extra ? <input type="time" step={900} value={end ?? ''} disabled={busy} title="End ~ (optional)" onChange={(ev) => setLineField(e, idx, { end: ev.target.value || null }, `end ${ev.target.value ? ap(ev.target.value) : '—'}`)} /> : <span className="muted">—</span>}</span>
      <span className="ds-hm">{lead ? <Step n={count} on={(n) => setLeads(e, n)} /> : extra ? <Step n={count} on={(n) => setExtras(e, n)} /> : idx != null ? <Step n={count} on={(n) => setCount(e, idx, n)} /> : <b>{count}</b>}</span>
      <span className="ds-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{people.map((s) => <Chip key={s.id} s={s} at={start} />)}{[...Array(Math.max(0, count - people.length))].map((_, i) => <Slot key={i} e={e} code={code} start={start} />)}{[...Array(pad)].map((_, i) => <i key={'p' + i} className="ds-off" />)}</span>
      <span className={'ds-n' + (people.length >= count ? ' ok' : '')}>{people.length}/{count}</span>
    </div>); };

  return (
    <div className="stack-lg ds">
      <div className="kick"><Link to={`/admin/bookings?date=${date}&view=sheet`}>Bookings · week</Link> · DAY SHEET</div>
      <div className="ds-week">{week.map((w) => <Link key={w.d} to={`/admin/day-sheet/${w.d}`} className={'ds-wd' + (w.d === date ? ' on' : '') + (!w.n ? ' none' : w.have >= w.need ? ' done' : ' short')}>
        <small>{dLabel(w.d, { weekday: 'short', day: 'numeric' })}</small><b>{w.n ? `${w.have}/${w.need}` : '—'}</b><small>{w.n ? `${w.n} event${w.n > 1 ? 's' : ''}${w.free ? ` · ${w.free} free` : ''}` : 'no events'}</small></Link>)}</div>
      <div className="ds-top">
        <span className="serif-h ds-day"><Link to={`/admin/day-sheet/${addDays(date, -1)}`}>‹</Link> {dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} <Link to={`/admin/day-sheet/${addDays(date, 1)}`}>›</Link></span>
        <span className="grow" />
        <span className="seg3">{(['floor', 'bar', 'both'] as const).map((d) => <button key={d} className={dept === d ? 'on' : ''} onClick={() => setDept(d)}>{d === 'both' ? 'Both' : d === 'floor' ? 'Floor' : 'Bar'}</button>)}</span>
        <button className="abtn dark" disabled={busy || !ctx || !shown.length} onClick={() => fillDay()} title="Fills the open slots of the events shown, best first, by the rules · one move for Undo">✦ Fill the day</button>
        <button className="abtn" disabled={busy || !ctx} onClick={fillWeek} title={`Every day from today to Sun ${dLabel(addDays(wk0, 6), { month: 'short', day: 'numeric' })} · ${dept === 'both' ? 'floor + bar' : dept}`}>✦ Fill the week</button>
        <button className="abtn" disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={() => clear()}>Clear unlocked</button>
        <button className="abtn" disabled={busy || !sh.some((x) => x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? ''))} onClick={lockAll} title="🔒 everyone placed: ✦ Fill and Clear won't move them">🔒 Lock all</button>
        <button className="abtn" disabled={busy || !ops.length} onClick={undo} title={ops.length ? `Undo: ${ops[ops.length - 1].label}` : 'Nothing to undo'}>↶ Undo{ops.length ? ` (${ops.length})` : ''}</button>
        {(() => { const n = sh.filter((x) => x.pool_hold && shown.some((e) => e.id === x.event_id)).length; const out = addDays(date, -4); const due = isoDay(new Date()) >= out;
          return <button className={'abtn' + (due && n ? ' dark' : '')} disabled={busy || !n} onClick={confirmDay} title={`Confirmations usually go ~4 days out (${dLabel(out, { weekday: 'short', month: 'short', day: 'numeric' })})`}>Confirm {n}{dept !== 'both' ? ` ${dept}` : ''} ›</button>; })()}
      </div>
      <div className="ds-sum"><b>{evs.length} event{evs.length === 1 ? '' : 's'}</b><span>Floor <b className={fl[0] >= fl[1] ? 'okc' : 'accent'}>{fl[0]}/{fl[1]}</b></span><span>Bar <b className={br[0] >= br[1] ? 'okc' : 'accent'}>{br[0]}/{br[1]}</b></span><span>Free <b>{nYes}</b></span>
        <span className="muted">✦ fills by your rules · hover a name = why · ⚑ = more than 3 shifts this week · tap a slot to fill · drag a name to move it · × = back to Free · staff see nothing until you confirm</span></div>
      {pend > 0 && <div className="ds-pend"><b>✉ {pend} change{pend > 1 ? 's' : ''} not sent yet</b><span className="muted">staff who were already sent a shift that changed · they're told when you press Send</span><span className="grow" /><button className="abtn sm dark" onClick={() => setSendOpen(true)}>Review &amp; send ›</button></div>}
      {sendOpen && <SendBox events={evs.map((e) => e.id)} onClose={() => { setSendOpen(false); setTick((t) => t + 1); }} onSent={() => { setMsg('Sent.'); setTick((t) => t + 1); }} />}
      {ops.length > 0 && <div className="ds-undofab"><span className="grow">{ops[ops.length - 1].label}</span><button disabled={busy} onClick={undo}>↶ Undo</button>{ops.length > 1 && <small>{ops.length} steps</small>}</div>}{/* push 120 · always in reach */}
      {msg && <div className="adm-card okc sm">{msg}</div>}{err && <div className="adm-card err sm">{err}</div>}
      <div className={'ds-cols' + (freeFold ? ' ffold' : '')}>
        <div className={'ds-blocks' + (narrow ? ' narrow' : '') + (noEnd ? ' noend' : '')} ref={blocksR} onClick={() => ed && setEd(null)}>
          {!shown.length && <div className="adm-card muted">No {dept === 'both' ? '' : dept + ' '}events this day.</div>}
          {shown.map((e) => { const L = lays[e.id]; const have = sh.filter((s) => s.event_id === e.id).length; const need = L.client + L.extras.count;
            return (
              <section key={e.id} className={'ds-card' + (isBar(e) ? ' ds-barev' : '')}>
                <div className="ds-ch"><span className="serif ds-title">{e.venues?.name ?? e.title}{isBar(e) ? ' · bar' : ''}</span>{isFar(e) && <span className="ds-far" title="Far venue: ✦ puts drivers first, with the people they're linked to">🚗 far</span>}
                  <small className="muted">{dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} · client {L.client}{L.extras.count ? ` · +${L.extras.count} extra${L.extras.count > 1 ? 's' : ''} = ${need}` : ''}</small>
                  <span className="grow" />
                  {need > have && <button className="lnk sm" disabled={busy || !ctx} onClick={() => fillDay(e)} title="✦ Fill this block only">✦ Fill</button>}
                  {sh.some((x) => x.event_id === e.id && x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? '')) && <button className="lnk sm muted" disabled={busy} onClick={() => clear(e)}>Clear</button>}
                  <Link className="lnk sm" to={`/admin/event/${e.id}`}>Event ›</Link></div>
                <Details e={e} open={detOpen(e.id)} onToggle={() => togDet(e.id)} venues={ctx?.venues ?? []} clients={ctx?.clients ?? []} types={types} busy={busy}
                  onEv={(row, label) => saveEv(e, row, label)} onVenue={(v) => setVenue(e, v)} onClient={(c) => saveClient(e, c)} />
                <div className="ds-grid">
                  <div className="ds-gh"><span>ROLE</span><span>START{noEnd && <button className="ds-ghb" onClick={() => setNoEnd(false)} title="Show the END ~ column">+ end</button>}</span>{!noEnd && <span>END ~ <button className="ds-ghb" onClick={() => setNoEnd(true)} title="Hide the END ~ column">hide</button></span>}<span>HOW MANY</span><span>NAMES · rating colour = tier</span><span /></div>
                  <div className={'ds-grp ' + (isBar(e) ? 'g-bar' : 'g-floor')}><div className="ds-grph"><i />{isBar(e) ? 'BAR' : 'FLOOR'}</div>
                    <Row e={e} lead code={isBar(e) ? 'BM' : 'MD'} start={e.start_time?.slice(0, 5) ?? null} count={L.leadNeed} people={L.leads} />
                    {L.lines.map((l) => <Row key={l.key} idx={l.idx} e={e} code={l.code} start={l.start} end={(e.staffing ?? [])[l.idx] ? ((e.staffing ?? [])[l.idx] as Line & { end?: string | null }).end ?? null : null} count={l.count} people={l.people} />)}
                    {(L.extras.count > 0 || (!isBar(e) && L.lines.length > 0)) && <Row e={e} extra code={L.extras.code} start={L.extras.start} count={L.extras.count} people={L.extras.people} />}
                    {L.over.length > 0 && <div className="ds-line over"><span className="ds-role"><b>Also placed</b></span><span /><span /><span /><span className="ds-cells" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{L.over.map((s) => <Chip key={s.id} s={s} />)}</span><span className="ds-n">over</span></div>}
                  </div>
                  {(() => { const fl = sh.filter((x) => x.event_id === e.id && flagged[x.id]); return fl.length > 0 && <div className="ds-flagbox"><b>⚑ Line lowered · weakest flagged</b>
                    {fl.map((x) => <span key={x.id} className="ds-flagp"><span className="grow">{byId[x.staff_id]?.full_name ?? '…'} <small className="muted">{flagged[x.id]}</small></span>
                      <button className="abtn sm" disabled={busy} onClick={() => { unflag(x.id); const ex = L.extras.start; if (ex && hm(x.planned_start) !== ex) patch(x, { planned_start: startIso(date, ex) }, 'to extras'); }}>Make extra</button>
                      <button className="abtn sm" disabled={busy} onClick={() => { unflag(x.id); remove(x); }}>Back to Free</button>
                      <button className="lnk sm muted" onClick={() => unflag(x.id)}>Keep</button></span>)}</div>; })()}
                  <div className="ds-addrow">{(isBar(e) ? [['BT', '+ Bar row'], ['BB', '+ Barback row'], ['WW', '+ Wine row'], ['EX', '+ Extras']] : [['W', '+ Floor row'], ['EX', '+ Extras']]).map(([c, l]) => <button key={c} disabled={busy} onClick={() => addRow(e, c)}>{l}</button>)}</div>
                </div>
                {(() => { const conf = sh.filter((x) => x.event_id === e.id && x.status === 'confirmed').length; const lines = L.lines.map((l) => `${l.count} ${roleShort(l.code)} ${ap(l.start)}`);
                  return <div className="ds-tot"><span><b>{need}</b> {isBar(e) ? 'bar' : 'floor'} <small>({[L.leadNeed ? `${L.leadNeed} ${isBar(e) ? 'BM' : 'MD'}` : '', ...lines, L.extras.count ? `${L.extras.count} extras` : ''].filter(Boolean).join(' · ')})</small></span><span className="grow" /><span><b>{have}</b> placed · {conf} confirmed{need > have ? <em> · {need - have} open</em> : ''}</span></div>; })()}
              </section>); })}
        </div>
        {freeFold ? <aside className="ds-free fold" onClick={() => setFreeFold(false)} title="Show Free this day (you can still drop a name here = back to Free)" onDragOver={(ev) => ev.preventDefault()} onDrop={() => { const d = dragR.current; setDrag(null); if (d && 'id' in d) remove(d); }}>
          <span>‹</span><b>Free · {nYes}</b></aside> : <aside className="ds-free" onDragOver={(ev) => ev.preventDefault()} onDrop={() => { const d = dragR.current; setDrag(null); if (d && 'id' in d) remove(d); }}>
          <span className="row" style={{ alignItems: 'baseline' }}><b className="serif grow">Free this day · {nYes}</b><button className="ds-dett" onClick={() => setFreeFold(true)} title="Fold to make room">Hide ›</button></span>
          <small className="muted">said yes, not placed · best first · drag onto a slot, or tap a slot · drop a name here = back to free</small>
          <span className="seg3"><button className={tab === 'yes' ? 'on' : ''} onClick={() => setTab('yes')}>Yes {nYes}</button><button className={tab === 'maybe' ? 'on' : ''} onClick={() => setTab('maybe')}>Maybe {nMaybe}</button></span>
          {!free.length && <span className="muted sm">{tab === 'yes' ? 'Nobody left. Ask more from Bookings → Ask more people.' : 'No maybes.'}</span>}
          {free.map((a) => <div key={a.staff_id} className="ds-fp" draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', a.staff_id); ev.dataTransfer.effectAllowed = 'move'; setDrag({ staff_id: a.staff_id }); }} onDragEnd={() => setDrag(null)}>
            <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{byId[a.staff_id]?.full_name ?? '…'}{ctx?.cars.has(a.staff_id) ? ' 🚗' : ''}{ctx && isNewStaff(ctx, a.staff_id) ? <small className="ds-new">NEW</small> : null}</b>{(wn[a.staff_id] ?? 0) >= 3 && <small className="ds-flag" title={`Already ${wn[a.staff_id]} shifts this week`}>⚑{wn[a.staff_id]}</small>}<small className="muted">{a.from_time ? `from ${ap(a.from_time)}` : 'any time'}</small></div>)}
          {(() => { const open = shown.reduce((n, e) => { const L = lays[e.id]; return n + Math.max(0, L.client + L.extras.count - sh.filter((s) => s.event_id === e.id).length); }, 0);
            return <div className="ds-after">{open > 0 ? <><b>{open} open</b> slot{open > 1 ? 's' : ''} · {nYes} free</> : <><b>All slots filled.</b> {nYes} left = backups (not booked, released when you confirm)</>}</div>; })()}
        </aside>}
      </div>
      {card && (() => { const c = sh.find((x) => x.id === card.id); if (!c) return null; const e = evs.find((x) => x.id === c.event_id); if (!e) return null;
        return <PersonCard s={c} e={e} date={date} evs={evs} lays={lays} byId={byId} av={av} onDay={onDay} off={off} sortP={sortP} tier={tier} busy={busy} wn={wn[c.staff_id] ?? 0}
          why={[why[c.id] ? `✦ ${why[c.id]}` : null, ctx ? whyText(c.staff_id, e, ctx, sh.filter((x) => x.event_id === c.event_id && x.staff_id !== c.staff_id).map((x) => x.staff_id), wn[c.staff_id] ?? 0, av.find((x) => x.staff_id === c.staff_id)) : null].filter(Boolean).join(' · ')}
          onClose={() => setCard(null)}
          onMove={(e2, code, start) => { setCard(null); move(c, e2, code, start); }}
          onStart={(t) => patch(c, { planned_start: startIso(date, t) }, `start ${ap(t)}`)}
          onRole={(code) => patch(c, { position_code: code, position_detail: roleName(code) }, roleName(code))}
          onConfirm={() => markConfirmed(c)}
          onLock={() => patch(c, { locked: c.locked ? false : true, locked_at: new Date().toISOString() }, c.locked ? 'unlocked' : 'locked')}
          onSwap={(id) => patch(c, { staff_id: id }, `swapped for ${byId[id]?.full_name ?? ''}`)}
          onReplace={() => run(async () => { const all = await eventsBetween(date, date); const fe = all.find((x) => x.id === c.event_id); const fs = fe?.shifts.find((x) => x.id === c.id);
            if (!fe || !fs) throw new Error('Could not open the replacement list.'); setCard(null); setRepl({ s: fs, e: fe }); })}
          onRemove={() => { setCard(null); remove(c); }} onNote={(t) => patch(c, { booking_note: t.trim() || null }, t.trim() ? 'note' : 'note removed')} />; })()}
      {tellQ && <TellBox q={tellQ} names={tellQ.who.map((x) => byId[x.staff_id]?.full_name ?? '…')} states={tellQ.who.map((x) => sentTxt(x))} />}
      {repl && <ReplaceSheet shift={repl.s} ev={repl.e} onClose={() => setRepl(null)} onDone={(m) => { setRepl(null); setMsg(m); setTick((t) => t + 1); }} />}
      {pick && <PickSheet date={date} e={pick.e} code={pick.code} start={pick.start} staff={staff} av={av} onDay={onDay} off={off} sortP={sortP} tier={tier}
        onClose={() => setPick(null)} onPick={(id) => { const p = pick; setPick(null); place(id, p.e, p.code, p.start); }} onAsk={() => nav(`/admin/bookings?date=${date}&view=list&ask=1`)} />}
    </div>
  );
}

function PickSheet({ date, e, code, start, staff, av, onDay, off, sortP, tier, onClose, onPick, onAsk }: { date: string; e: Ev; code: string; start: string | null; staff: AStaff[]; av: Av[]; onDay: Set<string>; off: Set<string>;
  sortP: (a: string, b: string) => number; tier: (id: string) => string | null; onClose: () => void; onPick: (id: string) => void; onAsk: () => void }) {
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
      <button className="lnk sm" onClick={onAsk}>Ask more people for this day ›</button>
    </div></div>);
}

/** push 110 · click a name: move, start later, role, lock, swap, profile, back to Free. Sent / confirmed shifts: lock + profile only (change them from the event). */
function PersonCard({ s, e, date, evs, lays, byId, av, onDay, off, sortP, tier, busy, wn, why, onClose, onMove, onStart, onRole, onLock, onConfirm, onSwap, onRemove, onNote, onReplace }: {
  s: Sh; e: Ev; date: string; evs: Ev[]; lays: Record<string, ReturnType<typeof layout>>; byId: Record<string, AStaff>; av: Av[]; onDay: Set<string>; off: Set<string>;
  sortP: (a: string, b: string) => number; tier: (id: string) => string | null; busy: boolean; wn: number; why: string; onClose: () => void;
  onMove: (e: Ev, code: string, start: string | null) => void; onStart: (t: string) => void; onRole: (code: string) => void; onLock: () => void; onConfirm: () => void; onSwap: (id: string) => void; onRemove: () => void; onNote: (t: string) => void; onReplace: () => void }) {
  const [tab, setTab] = useState<'main' | 'swap'>('main'); const [t, setT] = useState(hm(s.planned_start)); const [q, setQ] = useState(''); const [nt, setNt] = useState(s.booking_note ?? '');
  const p = byId[s.staff_id]; const can = !LEAD.includes(s.position_code ?? '');
  const a = av.find((x) => x.staff_id === s.staff_id);
  const dept = isBar(e) ? 'bar' : 'floor';
  const slots = evs.filter((x) => isBar(x) === isBar(e)).flatMap((x) => { const L = lays[x.id]; const ls = [...L.lines.map((l) => ({ ...l, extra: false })), ...(L.extras.count ? [{ ...L.extras, extra: true }] : [])];
    return ls.map((l) => ({ v: `${x.id}|${l.code}|${l.start ?? ''}`, e: x, code: l.code, start: l.start, label: `${x.venues?.name ?? x.title} · ${l.extra ? 'Extras' : plural(l.code, 2)} ${ap(l.start)} (${l.people.length}/${l.count})`, here: x.id === s.event_id && hm(s.planned_start) === l.start })); });
  const ql = q.trim().toLowerCase();
  const st = hm(s.planned_start); const fitT = (x: Av) => !x.from_time || !st || x.from_time.slice(0, 5) <= st;
  const sameDept = (x: Av) => ((x.avail_asks?.department ?? byId[x.staff_id]?.department ?? 'floor') === 'bar') === isBar(e);
  const swaps = av.filter((x) => x.status === 'yes' && !x.released_at && !onDay.has(x.staff_id) && !off.has(x.staff_id) && sameDept(x) && (!ql || (byId[x.staff_id]?.full_name ?? '').toLowerCase().includes(ql)))
    .sort((x, y) => Number(!fitT(x)) - Number(!fitT(y)) || sortP(x.staff_id, y.staff_id)).slice(0, 12);
  const state = s.pool_hold ? (s.locked ? 'placed · locked' : 'placed · not sent') : s.status === 'confirmed' ? 'confirmed' : s.notified_at ? 'sent · waiting for confirm' : 'booked';
  return (
    <div className="ds-pick-wrap" onClick={onClose}><div className="ds-pick ds-pcard" onClick={(ev) => ev.stopPropagation()}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}><i className={'ds-t ' + (tier(s.staff_id) ?? '')} /><b className="grow serif" style={{ fontSize: 18 }}>{p?.full_name ?? '…'}</b><button className="lnk muted" onClick={onClose}>✕</button></div>
      <small className="muted">{e.venues?.name ?? e.title} · {roleName(s.position_code)} · {e.start_tbc || e.details_pending ? 'time TBC' : ap(hm(s.planned_start))} · {state}{a?.from_time ? ` · free from ${ap(a.from_time)}` : ''}{wn > 3 ? ` · ⚑ ${wn} shifts this week` : ''}</small>
      {why && <small className="ds-why">{why}</small>}
      {!can ? <small className="gold">MD / bar manager: drag them, or change it from the event.</small> : !s.pool_hold ? <small className="gold">Already {s.status === 'confirmed' ? 'confirmed' : 'sent'}: any change here asks you first, then “Your shift changed” waits in About to send.</small> : <small className="muted">Placed, not sent: changes here send nothing.</small>}
      <div className="seg3"><button className={tab === 'main' ? 'on' : ''} onClick={() => setTab('main')}>Change</button><button className={tab === 'swap' ? 'on' : ''} disabled={!can || !s.pool_hold} onClick={() => setTab('swap')}>{can && s.pool_hold ? 'Swap' : 'Swap (placed only)'}</button></div>
      {tab === 'main' ? <div className="ds-cardgrid">
        <label>Move to<select disabled={!can || busy} value={slots.find((x) => x.here)?.v ?? ''} onChange={(ev) => { const x = slots.find((y) => y.v === ev.target.value); if (x) onMove(x.e, x.code, x.start); }}>
          {!slots.some((x) => x.here) && <option value="">—</option>}{slots.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select></label>
        <label>Start<span className="row" style={{ gap: 6 }}><input type="time" step={900} value={t} disabled={!can || busy} onChange={(ev) => setT(ev.target.value)} />
          <button className="abtn sm" disabled={!can || busy || !t || t === hm(s.planned_start)} onClick={() => onStart(t)}>Set</button></span></label>
        <label>Role<select disabled={!can || busy} value={s.position_code ?? ''} onChange={(ev) => onRole(ev.target.value)}>
          {(dept === 'bar' ? ['BT', 'BB', 'WW'] : ['W', 'BUS']).map((c) => <option key={c} value={c}>{roleName(c)}</option>)}</select></label>
        <label style={{ gridColumn: '1 / -1' }}>Note for this shift <small className="muted" style={{ fontWeight: 400 }}>(you + the MD see it, not them)</small>
          <span className="row" style={{ gap: 6 }}><input className="grow" placeholder="e.g. from 4:00 PM · brings the truck" value={nt} onChange={(ev) => setNt(ev.target.value)} />
          <button className="abtn sm" disabled={busy || nt.trim() === (s.booking_note ?? '')} onClick={() => onNote(nt)}>Save</button></span></label>
        <div className="row wrap" style={{ gap: 8, gridColumn: '1 / -1' }}>
          {s.status !== 'confirmed' && <button className="abtn sm ok" disabled={busy} onClick={onConfirm} title="They told you yes (text, call): marked confirmed, no message sent">✓ Mark confirmed · no message</button>}
          <button className="abtn sm" disabled={busy} onClick={onLock}>{s.locked ? '🔓 Unlock' : '🔒 Lock'}</button>
          {can && <button className="abtn sm" disabled={busy} onClick={onRemove}>× Back to Free</button>}
          {!s.pool_hold && !LEAD.includes(s.position_code ?? '') && <button className="abtn sm dark" disabled={busy} onClick={onReplace} title="Asks the best free people; they stay on until someone says yes">Can't make it · find a replacement</button>}
          <span className="grow" /><a className="lnk sm" href={`/admin/staff?open=${s.staff_id}`}>Profile ›</a></div>
        <small className="muted" style={{ gridColumn: '1 / -1' }}>🔒 locked = ✦ Fill and Clear leave them where they are · every change here is one ↶ Undo</small>
      </div> : <>
        <input autoFocus placeholder="🔍 Search a free name…" value={q} onChange={(ev) => setQ(ev.target.value)} />
        <small className="kick">FREE · SAID YES · PUT IN THEIR PLACE</small>
        {!swaps.length && <span className="muted sm">Nobody free{ql ? ' with that name' : ''}.</span>}
        {swaps.map((x) => <button key={x.staff_id} className="ds-pp" disabled={busy} onClick={() => { onSwap(x.staff_id); onClose(); }}>
          <i className={'ds-t ' + (tier(x.staff_id) ?? '')} /><b className="grow">{byId[x.staff_id]?.full_name ?? '…'}</b><small className={fitT(x) ? 'muted' : 'gold'}>{x.from_time ? `from ${ap(x.from_time)}${fitT(x) ? '' : ' · after the start'}` : 'any time'}</small><span className="ds-putin">Put in</span></button>)}
        <small className="muted">{p?.full_name ?? 'They'} go{p?.full_name ? 'es' : ''} back to Free · {dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })}</small>
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
function Details({ e, open, onToggle, venues, clients, types, busy, onEv, onVenue, onClient }: { e: Ev; open: boolean; onToggle: () => void; venues: { id: string; name: string }[]; clients: { id: string; name: string }[]; types: string[]; busy: boolean;
  onEv: (row: Record<string, unknown>, label: string) => void; onVenue: (id: string) => void; onClient: (id: string) => void }) {
  const [g, setG] = useState(e.guests ? String(e.guests) : ''); const [nt, setNt] = useState(e.notes ?? ''); const [ti, setTi] = useState(e.title ?? '');
  useEffect(() => { setG(e.guests ? String(e.guests) : ''); setNt(e.notes ?? ''); setTi(e.title ?? ''); }, [e.guests, e.notes, e.title]);
  const uKey = isBar(e) ? 'uniform_bar' : 'uniform_floor'; const uVal = (isBar(e) ? e.uniform_bar : e.uniform_floor) ?? '';
  const uLabel = UNIFORMS.find(([k]) => k === uVal)?.[1];
  const sum = [e.event_private?.client, e.guests ? `${e.guests} guests${e.guests_final ? ' · final' : ''}` : null, e.caterer_name ? `Food by ${e.caterer_name}` : null, uLabel, e.event_type].filter(Boolean).join(' · ');
  if (!open) return <button className="ds-det fold" onClick={onToggle}><b>Details</b><span className="grow">{sum || 'nothing filled in yet'}</span><span className="ds-dett">Show details ▾</span></button>;
  const vs = [...venues].sort((a, b) => a.name.localeCompare(b.name)); const cs = [...clients].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="ds-det">
      <div className="row" style={{ alignItems: 'center' }}><b>Details</b><span className="grow" /><button className="ds-dett" onClick={onToggle}>Hide details ▴</button></div>
      <div className="ds-detg">
        <label className="wide2">EVENT NAME<input value={ti} disabled={busy} onChange={(ev) => setTi(ev.target.value)} onBlur={() => { if (ti.trim() && ti.trim() !== (e.title ?? '')) onEv({ title: ti.trim() }, `name → ${ti.trim()}`); else setTi(e.title ?? ''); }} onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} /></label>
        <label>VENUE<select value={e.venue_id ?? ''} disabled={busy} onChange={(ev) => onVenue(ev.target.value)}><option value="">—</option>{vs.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label>CLIENT<select value={e.event_private?.client_id ?? ''} disabled={busy} onChange={(ev) => onClient(ev.target.value)}><option value="">{e.event_private?.client ?? '—'}</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>GUESTS<span className="row" style={{ gap: 4 }}><input inputMode="numeric" value={g} disabled={busy} onChange={(ev) => setG(ev.target.value.replace(/\D/g, ''))} onBlur={() => { const n = g ? Number(g) : null; if (n !== (e.guests ?? null)) onEv({ guests: n }, `guests → ${n ?? '—'}`); }} />
          <button className={'ds-fin' + (e.guests_final ? ' on' : '')} disabled={busy || !e.guests} onClick={() => onEv({ guests_final: !e.guests_final }, e.guests_final ? 'guests not final' : 'guests final')}>{e.guests_final ? '✓ Final' : 'Final?'}</button></span></label>
        <label>FOOD BY<select value={e.caterer_id ?? ''} disabled={busy} onChange={(ev) => onEv({ caterer_id: ev.target.value || null }, `food by → ${cs.find((c) => c.id === ev.target.value)?.name ?? '—'}`)}><option value="">—</option>{cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>UNIFORM<select value={uVal} disabled={busy} onChange={(ev) => onEv({ [uKey]: ev.target.value || null }, `uniform → ${UNIFORMS.find(([k]) => k === ev.target.value)?.[1] ?? '—'}`)}><option value="">—</option>{UNIFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>EVENT TYPE<select value={e.event_type ?? ''} disabled={busy} onChange={(ev) => onEv({ event_type: ev.target.value || null }, `type → ${ev.target.value || '—'}`)}><option value="">—</option>{[...new Set([...(e.event_type ? [e.event_type] : []), ...types])].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="wide">NOTES FOR STAFF<input value={nt} disabled={busy} placeholder="e.g. enter by the side door · parking at the back" onChange={(ev) => setNt(ev.target.value)} onBlur={() => { if (nt.trim() !== (e.notes ?? '')) onEv({ notes: nt.trim() || null }, 'notes for staff'); }} /></label>
      </div>
      <small className="muted">Saves as you go, like the event form · ↶ Undo · staff see it in the app (no message) · on-site contact = the MD</small>
    </div>);
}
