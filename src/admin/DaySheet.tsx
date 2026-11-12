// push 108 · Bookings revamp, part 1: the Day sheet (board BookingDaySheetV1, doc "G&R staff app booking day sheet (mapping)").
// One screen shaped like the Events sheet: each event = a block (MD / bar manager at the head, one row per staff line with its
// count, time and slots, + an extras line), "Free this day" on the right. Tap a slot → pick; drag a name to another slot / event /
// back to Free; × → back to Free; ↶ Undo = last move. New placements are pool shifts (staff see nothing until you confirm).
// Part 2 (push 109) = ✦ Fill the day / week / block, Clear, ⚑ more than 3 shifts, hover = why. Part 3 = click a name (person card, note, lock, confirm), part 4 = phone swap + retire Bookings / Day pool.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { addDays, dLabel, eventsBetween, isoDay, roleName, startIso, type AEvent, type AShift, type AStaff } from './api';
import { ReplaceSheet } from './Replace';
import { LEAD, hm, isBar, isFar, layout, loadCtx, loadDay, planFill, weekCounts, whyText, type Av, type Ctx, type Ev, type Line, type Row, type Sh } from './dayFill';

type Op = { label: string; undo: () => PromiseLike<unknown> };
const TORD: Record<string, number> = { A: 0, B: 1, C: 2 };
const ap = (t: string | null | undefined) => { if (!t) return 'TBC'; const h = Number(t.slice(0, 2)); return `${h % 12 || 12}${t.slice(2, 5) !== ':00' ? t.slice(2, 5) : ''} ${h < 12 ? 'AM' : 'PM'}`; };
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
  const [ctx, setCtx] = useState<Ctx | null>(null); const [wn, setWn] = useState<Record<string, number>>({}); const [why, setWhy] = useState<Record<string, string>>({}); const [card, setCard] = useState<Sh | null>(null); const [repl, setRepl] = useState<{ s: AShift; e: AEvent } | null>(null);
  useEffect(() => { loadCtx().then((c) => { setCtx(c); setStaff(c.staff); }).catch((x) => setErr((x as Error).message)); }, []);
  useEffect(() => { try { localStorage.setItem('gr_ds_dept', dept); } catch { /* */ } }, [dept]);
  const wk0 = monday(date);

  useEffect(() => { (async () => {
    try { const d = await loadDay(date); setEvs(d.evs); setSh(d.sh); setAv(d.av); setOff(d.off); } catch (x) { setErr((x as Error).message); }
  })(); }, [date, tick]);
  useEffect(() => { weekCounts(wk0, addDays(wk0, 6)).then(setWn); }, [wk0, tick]);

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
  const sortP = (a: string, b: string) => (TORD[tier(a) ?? ''] ?? 9) - (TORD[tier(b) ?? ''] ?? 9) || rank(a) - rank(b);
  const onDay = new Set(sh.map((s) => s.staff_id));
  const shown = evs.filter((e) => dept === 'both' || (dept === 'bar') === isBar(e));
  const aDept = (a: Av) => a.avail_asks?.department ?? byId[a.staff_id]?.department ?? 'floor';
  const inDept = (a: Av) => dept === 'both' || (aDept(a) === 'bar') === (dept === 'bar');
  const free = av.filter((a) => inDept(a) && a.status === tab && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).sort((a, b) => sortP(a.staff_id, b.staff_id));
  const nYes = av.filter((a) => inDept(a) && a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).length;
  const nMaybe = av.filter((a) => inDept(a) && a.status === 'maybe' && !a.released_at && !onDay.has(a.staff_id)).length;
  const lays = useMemo(() => Object.fromEntries(evs.map((e) => [e.id, layout(e, sh.filter((s) => s.event_id === e.id))])), [evs, sh]);
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
  const remove = (s: Sh) => run(async () => {
    if (!removable(s)) throw new Error('Only placed (not locked, not sent) people go back to Free here.');
    const { data: row } = await supabase.from('shifts').select('*').eq('id', s.id).single();
    const { error } = await supabase.from('shifts').delete().eq('id', s.id).eq('pool_hold', true); if (error) throw error;
    return { label: `removed ${byId[s.staff_id]?.full_name ?? ''}`, undo: () => supabase.from('shifts').insert(row as Record<string, unknown>).then() };
  });
  const move = (s: Sh, e: Ev, code: string, start: string | null) => run(async () => {
    if (!removable(s)) throw new Error('Locked or already sent: change it from the event.');
    const before = { event_id: s.event_id, position_code: s.position_code, position_detail: s.position_detail ?? null, planned_start: s.planned_start };
    const t = start ?? e.start_time?.slice(0, 5) ?? '17:00';
    const { error } = await supabase.from('shifts').update({ event_id: e.id, position_code: code, position_detail: roleName(code), planned_start: startIso(date, t) }).eq('id', s.id); if (error) throw error;
    return { label: `moved ${byId[s.staff_id]?.full_name ?? ''}`, undo: () => supabase.from('shifts').update(before).eq('id', s.id).then() };
  });
  /** push 110 · person card: one change = one undo step. */
  const patch = (s0: Sh, row: Record<string, unknown>, label: string) => run(async () => {
    const keys = Object.keys(row); const { data: b, error: e0 } = await supabase.from('shifts').select(keys.join(',')).eq('id', s0.id).single(); if (e0) throw e0;
    const { error } = await supabase.from('shifts').update(row).eq('id', s0.id); if (error) throw error;
    return { label: `${label} · ${byId[s0.staff_id]?.full_name ?? ''}`, undo: () => supabase.from('shifts').update(b as unknown as Record<string, unknown>).eq('id', s0.id).then() };
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
  const dropOn = (e: Ev, code: string, start: string | null) => { const d = dragR.current; setDrag(null); if (!d) return; if ('id' in d) move(d, e, code, start); else place(d.staff_id, e, code, start); };

  const Chip = ({ s }: { s: Sh }) => { const nm = byId[s.staff_id]?.full_name ?? '…'; const t = tier(s.staff_id); const can = removable(s);
    const a = av.find((x) => x.staff_id === s.staff_id); const late = a?.from_time && s.planned_start && a.from_time.slice(0, 5) > hm(s.planned_start);
    const e = evs.find((x) => x.id === s.event_id); const n = wn[s.staff_id] ?? 0;
    const w = [why[s.id] ? `✦ ${why[s.id]}` : null, e && ctx ? whyText(s.staff_id, e, ctx, sh.filter((x) => x.event_id === s.event_id && x.staff_id !== s.staff_id).map((x) => x.staff_id), n, a) : null,
      s.locked ? 'locked' : null, !s.pool_hold ? (s.status === 'confirmed' ? 'confirmed' : s.notified_at ? 'sent' : 'booked') : null].filter(Boolean).join(' · ');
    return <span className={'ds-chip' + (can ? '' : ' fixed') + (n > 3 ? ' flag' : '')} draggable={can} onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', s.id); ev.dataTransfer.effectAllowed = 'move'; setDrag(s); }} onDragEnd={() => setDrag(null)} title={`${nm} · ${w}${s.booking_note ? ` · 📌 ${s.booking_note}` : ''} · click = options`} onClick={() => setCard(s)}>
      <i className={'ds-t ' + (t ?? '')} />{short(nm)}{s.locked ? ' 🔒' : ''}{!s.pool_hold && s.status === 'confirmed' ? ' ✓' : ''}{late ? <small className="gold"> from {ap(a!.from_time)}</small> : null}{s.booking_note ? <small className="ds-note" title={s.booking_note}>📌</small> : null}{n > 3 ? <small className="ds-flag" title={`${n} shifts this week`}>⚑{n}</small> : null}
      {can && <button className="ds-x" disabled={busy} onClick={(ev) => { ev.stopPropagation(); remove(s); }} aria-label={`Back to free: ${nm}`}>×</button>}</span>; };
  const Slot = ({ e, code, start }: { e: Ev; code: string; start: string | null }) =>
    <button className="ds-slot" onClick={() => setPick({ e, code, start })} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>+ tap to fill</button>;
  const Row = ({ e, label, code, start, count, people, extra }: { e: Ev; label: React.ReactNode; code: string; start: string | null; count: number; people: Sh[]; extra?: boolean }) => (
    <div className={'ds-line' + (extra ? ' ex' : '')} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>
      <b className="ds-lbl">{label}</b><span className="ds-time">{e.start_tbc || e.details_pending ? 'TBC' : ap(start)}</span>
      <span className="ds-cells">{people.map((s) => <Chip key={s.id} s={s} />)}{[...Array(Math.max(0, count - people.length))].map((_, i) => <Slot key={i} e={e} code={code} start={start} />)}</span>
      <span className={'ds-n' + (people.length >= count ? ' ok' : '')}>{people.length}/{count}{people.length >= count ? ' ✓' : ''}</span>
    </div>);

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
      {msg && <div className="adm-card okc sm">{msg}</div>}{err && <div className="adm-card err sm">{err}</div>}
      <div className="ds-cols">
        <div className="ds-blocks">
          {!shown.length && <div className="adm-card muted">No {dept === 'both' ? '' : dept + ' '}events this day.</div>}
          {shown.map((e) => { const L = lays[e.id]; const have = sh.filter((s) => s.event_id === e.id).length; const need = L.client + L.extras.count;
            return (
              <section key={e.id} className={'ds-block' + (isBar(e) ? ' ds-barev' : '')}>
                <div className="ds-bh"><span className="serif ds-title">{e.venues?.name ?? e.title}{isBar(e) ? ' · bar' : ''}</span>{isFar(e) && <span className="ds-far" title="Far venue: ✦ puts drivers first, with the people they're linked to">🚗 far</span>}
                  <small className="muted">{[e.caterer_name ? `Food by ${e.caterer_name}` : null, e.guests ? `${e.guests} guests` : null].filter(Boolean).join(' · ')}</small>
                  <span className="grow" /><span className="ds-count">Client {L.client}{L.extras.count ? ` · +${L.extras.count} extra${L.extras.count > 1 ? 's' : ''} = ${need}` : isBar(e) ? '' : ' · no extras'} · <b className={have >= need ? 'okc' : 'accent'}>{have} placed</b></span>
                  {need > have && <button className="lnk sm" disabled={busy || !ctx} onClick={() => fillDay(e)} title="✦ Fill this block only">✦ Fill</button>}
                  {sh.some((x) => x.event_id === e.id && x.pool_hold && !x.locked && !LEAD.includes(x.position_code ?? '')) && <button className="lnk sm muted" disabled={busy} onClick={() => clear(e)}>Clear</button>}
                  <Link className="lnk sm" to={`/admin/event/${e.id}`}>Event ›</Link></div>
                <div className="ds-lead" onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, isBar(e) ? 'BM' : 'MD', e.start_time?.slice(0, 5) ?? null)}>
                  <small>{isBar(e) ? 'BAR MANAGER' : 'MD'}</small>{L.leads.map((s) => <Chip key={s.id} s={s} />)}
                  {L.leads.length < L.leadNeed && <Slot e={e} code={isBar(e) ? 'BM' : 'MD'} start={e.start_time?.slice(0, 5) ?? null} />}</div>
                {L.lines.map((l) => <Row key={l.key} e={e} label={`${l.count} ${plural(l.code, l.count)}`} code={l.code} start={l.start} count={l.count} people={l.people} />)}
                {!L.lines.length && <div className="muted sm" style={{ padding: '8px 0' }}>No staff lines yet: <Link to={`/admin/event/${e.id}/edit`}>add them on the event ›</Link></div>}
                {L.extras.count > 0 && <Row e={e} extra label={<>+{L.extras.count} Extras <small>(10%)</small></>} code={L.extras.code} start={L.extras.start} count={L.extras.count} people={L.extras.people} />}
                {L.over.length > 0 && <div className="ds-line over"><b className="ds-lbl">Also placed</b><span className="ds-time" /><span className="ds-cells">{L.over.map((s) => <Chip key={s.id} s={s} />)}</span><span className="ds-n">over</span></div>}
              </section>); })}
        </div>
        <aside className="ds-free" onDragOver={(ev) => ev.preventDefault()} onDrop={() => { const d = dragR.current; setDrag(null); if (d && 'id' in d) remove(d); }}>
          <b className="serif">Free this day · {nYes}</b>
          <small className="muted">said yes, not placed · best first · drag onto a slot, or tap a slot · drop a name here = back to free</small>
          <span className="seg3"><button className={tab === 'yes' ? 'on' : ''} onClick={() => setTab('yes')}>Yes {nYes}</button><button className={tab === 'maybe' ? 'on' : ''} onClick={() => setTab('maybe')}>Maybe {nMaybe}</button></span>
          {!free.length && <span className="muted sm">{tab === 'yes' ? 'Nobody left. Ask more from Bookings → Ask more people.' : 'No maybes.'}</span>}
          {free.map((a) => <div key={a.staff_id} className="ds-fp" draggable onDragStart={(ev) => { ev.dataTransfer.setData('text/plain', a.staff_id); ev.dataTransfer.effectAllowed = 'move'; setDrag({ staff_id: a.staff_id }); }} onDragEnd={() => setDrag(null)}>
            <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{byId[a.staff_id]?.full_name ?? '…'}{ctx?.cars.has(a.staff_id) ? ' 🚗' : ''}</b>{(wn[a.staff_id] ?? 0) >= 3 && <small className="ds-flag" title={`Already ${wn[a.staff_id]} shifts this week`}>⚑{wn[a.staff_id]}</small>}<small className="muted">{a.from_time ? `from ${ap(a.from_time)}` : 'any time'}</small></div>)}
          {(() => { const open = shown.reduce((n, e) => { const L = lays[e.id]; return n + Math.max(0, L.client + L.extras.count - sh.filter((s) => s.event_id === e.id).length); }, 0);
            return <div className="ds-after">{open > 0 ? <><b>{open} open</b> slot{open > 1 ? 's' : ''} · {nYes} free</> : <><b>All slots filled.</b> {nYes} left = backups (not booked, released when you confirm)</>}</div>; })()}
        </aside>
      </div>
      {card && (() => { const c = sh.find((x) => x.id === card.id); if (!c) return null; const e = evs.find((x) => x.id === c.event_id); if (!e) return null;
        return <PersonCard s={c} e={e} date={date} evs={evs} lays={lays} byId={byId} av={av} onDay={onDay} off={off} sortP={sortP} tier={tier} busy={busy} wn={wn[c.staff_id] ?? 0}
          why={[why[c.id] ? `✦ ${why[c.id]}` : null, ctx ? whyText(c.staff_id, e, ctx, sh.filter((x) => x.event_id === c.event_id && x.staff_id !== c.staff_id).map((x) => x.staff_id), wn[c.staff_id] ?? 0, av.find((x) => x.staff_id === c.staff_id)) : null].filter(Boolean).join(' · ')}
          onClose={() => setCard(null)}
          onMove={(e2, code, start) => { setCard(null); move(c, e2, code, start); }}
          onStart={(t) => patch(c, { planned_start: startIso(date, t) }, `start ${ap(t)}`)}
          onRole={(code) => patch(c, { position_code: code, position_detail: roleName(code) }, roleName(code))}
          onLock={() => patch(c, { locked: c.locked ? false : true, locked_at: new Date().toISOString() }, c.locked ? 'unlocked' : 'locked')}
          onSwap={(id) => patch(c, { staff_id: id }, `swapped for ${byId[id]?.full_name ?? ''}`)}
          onReplace={() => run(async () => { const all = await eventsBetween(date, date); const fe = all.find((x) => x.id === c.event_id); const fs = fe?.shifts.find((x) => x.id === c.id);
            if (!fe || !fs) throw new Error('Could not open the replacement list.'); setCard(null); setRepl({ s: fs, e: fe }); })}
          onRemove={() => { setCard(null); remove(c); }} onNote={(t) => patch(c, { booking_note: t.trim() || null }, t.trim() ? 'note' : 'note removed')} />; })()}
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
function PersonCard({ s, e, date, evs, lays, byId, av, onDay, off, sortP, tier, busy, wn, why, onClose, onMove, onStart, onRole, onLock, onSwap, onRemove, onNote, onReplace }: {
  s: Sh; e: Ev; date: string; evs: Ev[]; lays: Record<string, ReturnType<typeof layout>>; byId: Record<string, AStaff>; av: Av[]; onDay: Set<string>; off: Set<string>;
  sortP: (a: string, b: string) => number; tier: (id: string) => string | null; busy: boolean; wn: number; why: string; onClose: () => void;
  onMove: (e: Ev, code: string, start: string | null) => void; onStart: (t: string) => void; onRole: (code: string) => void; onLock: () => void; onSwap: (id: string) => void; onRemove: () => void; onNote: (t: string) => void; onReplace: () => void }) {
  const [tab, setTab] = useState<'main' | 'swap'>('main'); const [t, setT] = useState(hm(s.planned_start)); const [q, setQ] = useState(''); const [nt, setNt] = useState(s.booking_note ?? '');
  const p = byId[s.staff_id]; const can = s.pool_hold && !LEAD.includes(s.position_code ?? '');
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
    <div className="ds-pick-wrap" onClick={onClose}><div className="ds-pick ds-card" onClick={(ev) => ev.stopPropagation()}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}><i className={'ds-t ' + (tier(s.staff_id) ?? '')} /><b className="grow serif" style={{ fontSize: 18 }}>{p?.full_name ?? '…'}</b><button className="lnk muted" onClick={onClose}>✕</button></div>
      <small className="muted">{e.venues?.name ?? e.title} · {roleName(s.position_code)} · {e.start_tbc || e.details_pending ? 'time TBC' : ap(hm(s.planned_start))} · {state}{a?.from_time ? ` · free from ${ap(a.from_time)}` : ''}{wn > 3 ? ` · ⚑ ${wn} shifts this week` : ''}</small>
      {why && <small className="ds-why">{why}</small>}
      {!can && <small className="gold">{LEAD.includes(s.position_code ?? '') ? 'MD / bar manager: change it from the event.' : 'Already sent to them: change the time or place from the event so they get told.'}</small>}
      <div className="seg3"><button className={tab === 'main' ? 'on' : ''} onClick={() => setTab('main')}>Change</button><button className={tab === 'swap' ? 'on' : ''} disabled={!can} onClick={() => setTab('swap')}>{can ? 'Swap' : 'Swap (placed only)'}</button></div>
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
