import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, allStaff, addDays, isoDay, dLabel, ap12, startIso, roleName, bookingChange, confirmationsSent, type AEvent, type AStaff } from './api';

/* Push 23 · Bookings (admin). Practice mode by default: every change lives in a draft (booking_drafts) layered
   over the real shifts; staff see nothing until Ronnie switches to Live and saves. */

type Pl = { key: string; staff_id: string; event_id: string; start: string; code: string; shift_id?: string | null; extra?: boolean; suggested?: boolean };
type Av = { staff_id: string; status: string; from_time: string | null; note: string | null; tier: string | null };
type Wk = { staff_id: string; dow: number; status: string; from_time: string | null };
type Cond = { staff_id: string; kind: string; value: string | null };
type Draft = { pl: Pl[]; locks: string[]; extras: Record<string, number> };
type View = 'board' | 'sheet' | 'list';

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
const t12 = (t: string | null | undefined) => (t ? ap12(t.slice(0, 5)) : '');
const toMin = (t: string) => { const [h, m] = t.slice(0, 5).split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + m; };
const fromMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const q15 = (t: string) => fromMin(Math.ceil(toMin(t) / 15) * 15);
const dowOf = (iso: string) => (new Date(iso + 'T12:00:00').getDay() + 6) % 7;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const uid = () => Math.random().toString(36).slice(2, 10);
const isBarEv = (e: AEvent) => e.department === 'bar';
const floorNeed = (evs: AEvent[]) => evs.filter((e) => !isBarEv(e)).reduce((n, e) => n + e.staff_needed, 0);
const defaultExtras = (e: AEvent) => (!isBarEv(e) && e.staff_needed > 7 ? Math.ceil(e.staff_needed * 0.1) : 0);
const readLS = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function Bookings() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? isoDay(new Date());
  const view = (params.get('view') as View) ?? (window.innerWidth < 820 ? 'list' : 'board');
  const dept = (params.get('dept') as 'floor' | 'bar') ?? 'floor';
  const span = Number(params.get('span') ?? 7);
  const setP = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };

  const [mode, setMode] = useState<'practice' | 'live'>(() => (readLS('gr-book-mode', 'practice') as 'practice' | 'live'));
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [av, setAv] = useState<Av[]>([]); const [wk, setWk] = useState<Wk[]>([]); const [off, setOff] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<[string, string][]>([]); const [conds, setConds] = useState<Cond[]>([]);
  const [shifts30, setShifts30] = useState<Record<string, number>>({}); const [yesRate, setYesRate] = useState<Record<string, number>>({});
  const [base, setBase] = useState<Record<string, Pl[]>>({});
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [hist, setHist] = useState<Record<string, Draft>[]>([]);
  const [tab, setTab] = useState<'yes' | 'wait' | 'not'>('yes'); const [q, setQ] = useState('');
  const [drag, setDrag] = useState<{ staff_id: string; key?: string } | null>(null);
  const [hint, setHint] = useState<string>('');
  const [pair, setPair] = useState<{ moving: Pl; partner: Pl; to: { event_id: string; start: string } } | null>(null);
  const [auto, setAuto] = useState<{ open: boolean; skipped: { name: string; why: string }[] } | null>(null);
  const [review, setReview] = useState(false); const [askMore, setAskMore] = useState(false);
  const [phone, setPhone] = useState<Pl | null>(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const dragRef = useRef(drag); dragRef.current = drag;

  const range = view === 'board' ? { from: date, to: date } : { from: date, to: addDays(date, (view === 'sheet' ? span : 14) - 1) };
  const dates = useMemo(() => Array.from({ length: (new Date(range.to).getTime() - new Date(range.from).getTime()) / 864e5 + 1 }, (_, i) => addDays(range.from, i)), [range.from, range.to]);

  const load = async () => {
    setEvents(null);
    const since30 = addDays(date, -30); const since90 = addDays(date, -90);
    const [evs, st, a, w, o, l, c, s30, hist90, dr] = await Promise.all([
      eventsBetween(range.from, range.to), staff.length ? Promise.resolve(staff) : allStaff(),
      supabase.from('availability').select('staff_id,status,from_time,note,tier,for_date').gte('for_date', range.from).lte('for_date', range.to).not('ask_id', 'is', null),
      supabase.from('staff_weekly').select('staff_id,dow,status,from_time'),
      supabase.from('days_off').select('staff_id,from_date,to_date').lte('from_date', range.to).gte('to_date', range.from),
      supabase.from('staff_links').select('staff_a,staff_b'), supabase.from('staff_conditions').select('staff_id,kind,value'),
      supabase.from('shifts').select('staff_id,events!inner(event_date)').neq('status', 'declined').gte('events.event_date', since30).lt('events.event_date', date),
      supabase.from('availability').select('staff_id,status').gte('for_date', since90).in('status', ['yes', 'no']),
      supabase.from('booking_drafts').select('for_date,payload').gte('for_date', range.from).lte('for_date', range.to),
    ]);
    setStaff(st);
    setAv(((a.data ?? []) as (Av & { for_date: string })[]).filter((x) => x.for_date === date || view !== 'board'));
    setWk((w.data ?? []) as Wk[]);
    const offSet = new Set<string>(); for (const r of (o.data ?? []) as { staff_id: string; from_date: string; to_date: string }[]) for (const d of dates) if (r.from_date <= d && r.to_date >= d) offSet.add(r.staff_id + d); setOff(offSet);
    setLinks(((l.data ?? []) as { staff_a: string; staff_b: string }[]).map((x) => [x.staff_a, x.staff_b]));
    setConds((c.data ?? []) as Cond[]);
    const cnt: Record<string, number> = {}; for (const r of (s30.data ?? []) as { staff_id: string }[]) cnt[r.staff_id] = (cnt[r.staff_id] ?? 0) + 1; setShifts30(cnt);
    const yr: Record<string, [number, number]> = {}; for (const r of (hist90.data ?? []) as { staff_id: string; status: string }[]) { const x = (yr[r.staff_id] ??= [0, 0]); x[r.status === 'yes' ? 0 : 1]++; }
    setYesRate(Object.fromEntries(Object.entries(yr).map(([k, [y, n]]) => [k, y / (y + n)])));
    const b: Record<string, Pl[]> = {};
    for (const e of evs) for (const s of e.shifts) if (s.status !== 'declined' && !s.attendance) (b[e.event_date] ??= []).push({ key: s.id, staff_id: s.staff_id, event_id: e.id, start: hm(s.planned_start), code: s.position_code ?? 'W', shift_id: s.id });
    setBase(b);
    setDraft(Object.fromEntries(((dr.data ?? []) as { for_date: string; payload: Draft }[]).map((x) => [x.for_date, x.payload])));
    setHist([]);
    setEvents(evs);
  };
  useEffect(() => { load(); }, [date, view, span]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const evById = useMemo(() => Object.fromEntries((events ?? []).map((e) => [e.id, e])), [events]);
  const cur = (d: string): Draft => draft[d] ?? { pl: base[d] ?? [], locks: [], extras: {} };
  const setCur = (d: string, next: Draft) => { setHist((h) => [...h.slice(-30), draft]); setDraft({ ...draft, [d]: next }); };
  const plOf = (d: string) => cur(d).pl.filter((p) => !p.suggested || auto?.open);
  const name = (sid: string) => byId[sid]?.full_name ?? '?';
  const tier = (sid: string) => byId[sid]?.staff_private?.tier ?? null;
  const rank = (sid: string) => byId[sid]?.staff_private?.ranking ?? 9999;
  const partnerOf = (sid: string) => links.filter((l) => l.includes(sid)).map((l) => (l[0] === sid ? l[1] : l[0]));
  const condsOf = (sid: string) => conds.filter((c) => c.staff_id === sid);
  const avOf = (sid: string) => av.find((a) => a.staff_id === sid);
  const usual = (sid: string, d: string) => wk.find((w) => w.staff_id === sid && w.dow === dowOf(d));
  const evDept = (e: AEvent) => (isBarEv(e) ? 'bar' : 'floor');

  // ── changes vs the real shifts ─────────────────────────────────
  const changesFor = (d: string) => {
    const real = base[d] ?? []; const now = cur(d).pl.filter((p) => !p.suggested);
    const added = now.filter((p) => !p.shift_id); const removed = real.filter((r) => !now.some((p) => p.shift_id === r.shift_id));
    const moved = now.filter((p) => p.shift_id && real.some((r) => r.shift_id === p.shift_id && (r.event_id !== p.event_id || r.start !== p.start)));
    return { added, removed, moved };
  };
  const allChanges = dates.map((d) => ({ d, ...changesFor(d) })).filter((c) => draft[c.d]);
  const nChanges = allChanges.reduce((n, c) => n + c.added.length + c.removed.length + c.moved.length, 0);

  // ── placing ─────────────────────────────────────────────────────
  const place = (d: string, sid: string, to: { event_id: string; start: string; extra?: boolean }, fromKey?: string, both = false) => {
    const c = cur(d); let pl = [...c.pl];
    const a = avOf(sid); let start = to.start;
    if (a?.from_time && toMin(a.from_time) > toMin(to.start) + 15) start = q15(a.from_time); // can only start 15+ min later → own time group
    const existing = fromKey ? pl.find((p) => p.key === fromKey) : pl.find((p) => p.staff_id === sid);
    if (existing) {
      if (!both) { const partner = pl.find((p) => p.event_id === existing.event_id && partnerOf(sid).includes(p.staff_id) && p.key !== existing.key);
        if (partner && existing.event_id !== to.event_id) { setPair({ moving: existing, partner, to: { event_id: to.event_id, start } }); return; } }
      pl = pl.map((p) => (p.key === existing.key ? { ...p, event_id: to.event_id, start, extra: !!to.extra, suggested: false } : p));
    } else {
      const e = evById[to.event_id]; pl.push({ key: uid(), staff_id: sid, event_id: to.event_id, start, code: isBarEv(e) ? (byId[sid]?.positions.includes('BT') ? 'BT' : 'BB') : 'W', extra: !!to.extra });
    }
    if (start !== to.start) setHint(`${name(sid).split(' ')[0]} can only start ${t12(start)} · new ${t12(start)} group`);
    setCur(d, { ...c, pl });
  };
  const remove = (d: string, key: string) => { const c = cur(d); setCur(d, { ...c, pl: c.pl.filter((p) => p.key !== key) }); };
  const toggleLock = (d: string, sid: string) => { const c = cur(d); setCur(d, { ...c, locks: c.locks.includes(sid) ? c.locks.filter((x) => x !== sid) : [...c.locks, sid] }); };
  const undo = () => { const h = hist[hist.length - 1]; if (!h) return; setDraft(h); setHist(hist.slice(0, -1)); };

  // ── save / reset / live apply ──────────────────────────────────
  const save = async (send = false) => {
    setBusy(true); setMsg('');
    const { data: me } = await supabase.rpc('me');
    if (mode === 'practice') {
      for (const c of allChanges.length ? allChanges : dates.filter((d) => draft[d]).map((d) => ({ d }))) {
        const dr = draft[c.d]; if (!dr) continue;
        await supabase.from('booking_drafts').upsert({ admin_id: me, for_date: c.d, payload: { ...dr, pl: dr.pl.filter((p) => !p.suggested) }, updated_at: new Date().toISOString() });
      }
      setMsg(send ? 'Practice · nothing sent. Your practice board is saved.' : 'Saved in practice. Staff see nothing.');
    } else {
      let n = 0;
      for (const c of allChanges) {
        for (const r of c.removed) {
          const e = evById[r.event_id]; const sh = e?.shifts.find((s) => s.id === r.shift_id);
          if (sh?.punches?.punch_in) continue;
          await supabase.from('shifts').delete().eq('id', r.shift_id!);
          await bookingChange('removed', { staff_id: r.staff_id, shift_id: r.shift_id, from: { id: e.id, event_date: e.event_date, title: e.title, sent: confirmationsSent(e), start: startIso(e.event_date, r.start) } }); n++;
        }
        for (const p of c.moved) {
          const r = (base[c.d] ?? []).find((x) => x.shift_id === p.shift_id)!; const fe = evById[r.event_id]; const te = evById[p.event_id];
          await supabase.from('shifts').update({ event_id: p.event_id, planned_start: startIso(te.event_date, p.start) }).eq('id', p.shift_id!);
          await bookingChange('moved', { staff_id: p.staff_id, shift_id: p.shift_id, from: { id: fe.id, event_date: fe.event_date, title: fe.title, sent: confirmationsSent(fe), start: startIso(fe.event_date, r.start) }, to: { id: te.id, event_date: te.event_date, title: te.title, sent: confirmationsSent(te), start: startIso(te.event_date, p.start) } }); n++;
        }
        for (const p of c.added) {
          const e = evById[p.event_id];
          const { data: ins } = await supabase.from('shifts').insert({ event_id: p.event_id, staff_id: p.staff_id, position_code: p.code, position_detail: roleName(p.code), planned_start: startIso(e.event_date, p.start), status: 'booked' }).select('id').single();
          await bookingChange('booked', { staff_id: p.staff_id, shift_id: ins?.id ?? null, to: { id: e.id, event_date: e.event_date, title: e.title, sent: confirmationsSent(e), start: startIso(e.event_date, p.start) } }); n++;
        }
        await supabase.from('booking_drafts').delete().eq('admin_id', me).eq('for_date', c.d);
      }
      setMsg(`${n} change${n === 1 ? '' : 's'} saved to the schedule.${send ? ' Send the confirmations from the Day view.' : ''}`);
      await load();
    }
    setBusy(false); setReview(false);
  };
  const resetPractice = async () => {
    const { data: me } = await supabase.rpc('me');
    await supabase.from('booking_drafts').delete().eq('admin_id', me).in('for_date', dates);
    setDraft({}); setHist([]); setMsg('Practice reset. Back to the real schedule.');
  };

  // ── who's available ────────────────────────────────────────────
  const bookedOn = (d: string) => new Set(plOf(d).filter((p) => !p.suggested).map((p) => p.staff_id));
  const availFor = (d: string) => {
    const booked = bookedOn(d);
    return staff.filter((s) => s.active && (dept === 'bar' ? s.department === 'bar' : s.department !== 'bar') && !booked.has(s.id) && !off.has(s.id + d))
      .filter((s) => !/manual booking only/i.test(s.staff_private?.notes ?? ''))
      .map((s) => { const a = av.find((x) => x.staff_id === s.id); const u = usual(s.id, d); return { s, a, u }; })
      .filter(({ a, u }) => a?.status === 'yes' || a?.status === 'asked' || (!a && u?.status !== 'no') || (a && a.status !== 'no'))
      .sort((x, y) => rank(x.s.id) - rank(y.s.id));
  };
  const aList = availFor(date);
  const tabList = aList.filter(({ a }) => (tab === 'yes' ? a?.status === 'yes' : tab === 'wait' ? a?.status === 'asked' : !a)).filter(({ s }) => !q || s.full_name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q.toLowerCase()));
  const counts = { yes: aList.filter(({ a }) => a?.status === 'yes').length, wait: aList.filter(({ a }) => a?.status === 'asked').length, not: aList.filter(({ a }) => !a).length };

  // ── auto-fill ──────────────────────────────────────────────────
  const runAuto = () => {
    const d = date; const c = cur(d); const evs = (events ?? []).filter((e) => e.event_date === d && evDept(e) === dept);
    const pl = c.pl.filter((p) => !p.suggested); const booked = new Set(pl.map((p) => p.staff_id));
    const big = floorNeed((events ?? []).filter((e) => e.event_date === d)) >= 25;
    const skipped: { name: string; why: string }[] = []; const out: Pl[] = [];
    const pool = aList.filter(({ a }) => a?.status === 'yes').map(({ s, a }) => ({ s, from: a?.from_time ?? null })).filter(({ s }) => !c.locks.includes(s.id));
    const late: typeof pool = [];
    const ok = (sid: string, e: AEvent) => {
      for (const k of condsOf(sid)) {
        if (k.kind === 'not_venue' && k.value && (e.title + ' ' + (e.event_private?.client ?? '')).toLowerCase().includes(k.value.toLowerCase())) return `never ${k.value}`;
        if (k.kind === 'min_guests' && k.value && !((e.guests ?? 0) > Number(k.value))) return `only events over ${k.value} guests`;
        if (k.kind === 'not_weekday' && k.value && k.value.split(',').includes(DOW[dowOf(d)])) return `not on ${DOW[dowOf(d)]}`;
      }
      return '';
    };
    const slots = () => { const r: { e: AEvent; start: string; open: number }[] = [];
      for (const e of evs) { const lines = (e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code)); const starts = [...new Set(lines.map((l) => l.start))].sort();
        for (const st of starts) { const need = lines.filter((l) => l.start === st).reduce((n, l) => n + l.count, 0); const have = [...pl, ...out].filter((p) => p.event_id === e.id && p.start === st).length; if (need > have) r.push({ e, start: st, open: need - have }); } }
      return r; };
    const tryPlace = (s: AStaff, from: string | null) => {
      for (const sl of slots()) {
        const why = ok(s.id, sl.e); if (why) continue;
        if (from && toMin(from) > toMin(sl.start) + 15) continue;
        out.push({ key: uid(), staff_id: s.id, event_id: sl.e.id, start: sl.start, code: dept === 'bar' ? 'BT' : 'W', suggested: true }); booked.add(s.id);
        for (const pid of partnerOf(s.id)) { const pp = pool.find((x) => x.s.id === pid); if (pp && !booked.has(pid) && !ok(pid, sl.e)) { const again = slots().find((x) => x.e.id === sl.e.id); if (again) { out.push({ key: uid(), staff_id: pid, event_id: sl.e.id, start: again.start, code: dept === 'bar' ? 'BT' : 'W', suggested: true }); booked.add(pid); } } }
        return true;
      }
      return false;
    };
    for (const { s, from } of pool) {
      if (booked.has(s.id)) continue;
      const k = condsOf(s.id).map((x) => x.kind);
      if (k.includes('only_if_needed') || (k.includes('big_dates_only') && !big)) { late.push({ s, from }); continue; }
      if (!tryPlace(s, from)) { const e = evs.find((x) => ok(s.id, x)); skipped.push({ name: s.full_name, why: !e ? (evs.map((x) => ok(s.id, x)).find(Boolean) ?? 'condition') : from ? `free from ${t12(from)} · no group that late` : 'no open spot' }); }
    }
    for (const { s, from } of late) { if (booked.has(s.id)) continue; if (!slots().length || !tryPlace(s, from)) skipped.push({ name: s.full_name, why: condsOf(s.id).some((x) => x.kind === 'only_if_needed') ? 'only when we really need them' : 'only for very big dates' }); }
    setCur(d, { ...c, pl: [...pl, ...out] }); setAuto({ open: true, skipped });
  };
  const acceptAll = () => { const c = cur(date); setCur(date, { ...c, pl: c.pl.map((p) => ({ ...p, suggested: false })) }); setAuto(null); };
  const clearAuto = () => { const c = cur(date); setCur(date, { ...c, pl: c.pl.filter((p) => !p.suggested) }); setAuto(null); };
  const lockAll = () => { const c = cur(date); setCur(date, { ...c, locks: [...new Set([...c.locks, ...c.pl.map((p) => p.staff_id)])] }); };

  // ── board pieces ───────────────────────────────────────────────
  const dayEvs = (d: string) => (events ?? []).filter((e) => e.event_date === d && evDept(e) === dept);
  const groupsOf = (d: string, e: AEvent) => {
    const lines = (e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code));
    const pl = plOf(d).filter((p) => p.event_id === e.id && !['MD', 'BM'].includes(p.code));
    const starts = [...new Set([...lines.map((l) => l.start), ...pl.map((p) => p.start)])].sort((a, b) => toMin(a) - toMin(b));
    return starts.map((st) => { const ls = lines.filter((l) => l.start === st); return { start: st, end: ls.find((l) => l.end)?.end ?? null, need: ls.reduce((n, l) => n + l.count, 0), people: pl.filter((p) => p.start === st && !p.extra).sort((a, b) => rank(a.staff_id) - rank(b.staff_id)), isNew: !ls.length }; });
  };
  const extrasOf = (d: string, e: AEvent) => cur(d).extras[e.id] ?? e.extras ?? defaultExtras(e);
  const onDrop = (d: string, to: { event_id: string; start: string; extra?: boolean }) => { const g = dragRef.current; setDrag(null); if (!g) return; place(d, g.staff_id, to, g.key); };
  const dropAvail = (d: string) => { const g = dragRef.current; setDrag(null); if (g?.key) remove(d, g.key); };
  const Chip = ({ p, n, d }: { p: Pl; n?: number; d: string }) => {
    const locked = cur(d).locks.includes(p.staff_id); const t = tier(p.staff_id); const part = partnerOf(p.staff_id).find((x) => plOf(d).some((q2) => q2.staff_id === x));
    return (
      <div className={'bk-chip' + (p.suggested ? ' sug' : '') + (!p.shift_id && !p.suggested ? ' added' : '')} draggable onDragStart={() => setDrag({ staff_id: p.staff_id, key: p.key })} onClick={() => setPhone(p)}>
        {n != null && <span className="bk-n">{n}</span>}<i className={'bk-t t' + (t ?? 'x')} />
        <span className="grow">{name(p.staff_id)}{part && <small> 🔗 {name(part).split(' ')[0]}</small>}{p.extra && <small className="bk-x"> EXTRA</small>}</span>
        {p.suggested ? <span className="bk-sug">suggested</span> : <>
          <button className={'bk-lock' + (locked ? ' on' : '')} title={locked ? 'Locked · auto-fill never moves them' : 'Lock'} onClick={(ev) => { ev.stopPropagation(); toggleLock(d, p.staff_id); }}>{locked ? '🔒' : '🔓'}</button>
          <button className="bk-del" aria-label="Remove" onClick={(ev) => { ev.stopPropagation(); remove(d, p.key); }}>×</button></>}
      </div>
    );
  };

  const Column = ({ e, d }: { e: AEvent; d: string }) => {
    const groups = groupsOf(d, e); const pl = plOf(d).filter((p) => p.event_id === e.id);
    const lead = pl.find((p) => p.code === 'MD' || p.code === 'BM'); const extras = extrasOf(d, e);
    const placed = pl.filter((p) => !['MD', 'BM'].includes(p.code)).length; const need = e.staff_needed - (lead ? 1 : 0) + extras;
    return (
      <div className="bk-col" onDragOver={(ev) => ev.preventDefault()} onDrop={() => onDrop(d, { event_id: e.id, start: groups.find((g) => g.need > g.people.length)?.start ?? groups[0]?.start ?? (e.start_time ?? '17:00').slice(0, 5) })}>
        <div className="bk-colh">
          <Link to={`/admin/event/${e.id}`} className="serif bk-title">{e.title}</Link>
          <div className="muted sm">{[e.event_private?.client, e.event_type, e.guests ? `${e.guests} guests` : null].filter(Boolean).join(' · ')}</div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}><b>{placed} / {need}</b><div className="bk-bar"><i style={{ width: `${Math.min(100, (placed / Math.max(1, need)) * 100)}%` }} className={placed < need ? 'short' : ''} /></div></div>
          <div className="bk-md">{lead ? <>{lead.code} · <b>{name(lead.staff_id)}</b></> : <span className="accent">{isBarEv(e) ? 'Bar manager' : 'MD'} not set</span>}</div>
        </div>
        {groups.map((g) => (
          <div key={g.start} className={'bk-grp' + (drag ? ' dropok' : '')} onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.stopPropagation(); onDrop(d, { event_id: e.id, start: g.start }); }}>
            <div className="bk-gh"><span className="bk-time">{t12(g.start)}{g.end && <em> ~ {t12(g.end)}</em>}</span>{g.isNew && <span className="bk-new">NEW TIME</span>}<span className="muted sm">{g.people.length} / {g.need}</span></div>
            {g.people.map((p, i) => <Chip key={p.key} p={p} n={i + 1} d={d} />)}
            {g.need > g.people.length && <div className="bk-open">{g.need - g.people.length} open · drop here</div>}
          </div>
        ))}
        {extras > 0 && (
          <div className="bk-grp extras" onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.stopPropagation(); onDrop(d, { event_id: e.id, start: groups[0]?.start ?? '17:00', extra: true }); }}>
            <div className="bk-gh"><span className="bk-time gold">Extras +10%</span><span className="muted sm">{pl.filter((p) => p.extra).length} / {extras} · {(e.extras_billing ?? 'gr') === 'client' ? 'client pays' : 'on G&R'}</span>
              <input className="bk-xn" type="number" min={0} value={extras} onChange={(ev) => { const c = cur(d); setCur(d, { ...c, extras: { ...c.extras, [e.id]: Math.max(0, Number(ev.target.value) || 0) } }); }} /></div>
            {pl.filter((p) => p.extra).map((p) => <Chip key={p.key} p={p} d={d} />)}
            {extras > pl.filter((p) => p.extra).length && <div className="bk-open">{extras - pl.filter((p) => p.extra).length} extra · drop here</div>}
          </div>
        )}
      </div>
    );
  };

  // ── render ─────────────────────────────────────────────────────
  const strip = Array.from({ length: 7 }, (_, i) => addDays(date, i - ((new Date(date + 'T12:00:00').getDay() + 6) % 7)));
  return (
    <div className="stack-lg bk">
      <div className={'bk-mode ' + mode}>
        {mode === 'practice' ? <><b>Practice mode</b><span>changes stay here, staff see nothing</span></> : <><b>Live</b><span>Save writes to the real schedule (and alerts people whose confirmations went out)</span></>}
        <span className="grow" />
        {mode === 'practice' && <button className="abtn sm" onClick={resetPractice}>Reset practice</button>}
        <label className="bk-switch"><input type="checkbox" checked={mode === 'live'} onChange={(e) => { const m = e.target.checked ? 'live' : 'practice'; if (m === 'live' && !confirm('Switch to Live? Saving will change the real schedule.')) return; setMode(m); writeLS('gr-book-mode', m); }} /> Live</label>
      </div>

      <div className="toolbar">
        <div><div className="kick">BOOKINGS</div><h1 className="serif-h">{view === 'board' ? dLabel(date, { weekday: 'long', month: 'long', day: 'numeric' }) : `From ${dLabel(date)}`}</h1></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <div className="seg3">{(['board', 'sheet', 'list'] as View[]).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setP('view', v)}>{v[0].toUpperCase() + v.slice(1)}</button>)}</div>
          <div className="seg3">{(['floor', 'bar'] as const).map((v) => <button key={v} className={dept === v ? 'on' : ''} onClick={() => setP('dept', v)}>{v === 'floor' ? 'Floor' : 'Bar'}</button>)}</div>
          {view === 'sheet' && <div className="seg3">{[7, 14, 31].map((n) => <button key={n} className={span === n ? 'on' : ''} onClick={() => setP('span', String(n))}>{n === 31 ? 'Month' : `${n} days`}</button>)}</div>}
          {view === 'board' && <button className="abtn" onClick={() => (auto?.open ? setAuto(null) : setAuto({ open: false, skipped: [] }))}>Auto-fill</button>}
          <button className="abtn" onClick={() => setAskMore(true)}>Ask more people</button>
          <Link className="abtn dark" to={`/admin/event/new?d=${date}`}>+ New event</Link>
        </div>
      </div>

      <div className="bk-strip">
        <button className="round" onClick={() => setP('date', addDays(date, view === 'board' ? -1 : -7))}>‹</button>
        {view === 'board' ? strip.map((d) => { const evs = (events ?? []).length && d === date ? dayEvs(d) : []; const short = evs.reduce((n, e) => n + Math.max(0, e.staff_needed + extrasOf(d, e) - plOf(d).filter((p) => p.event_id === e.id).length), 0); return (
          <button key={d} className={'bk-day' + (d === date ? ' on' : '')} onClick={() => setP('date', d)}><small>{dLabel(d, { weekday: 'short' })}</small><b>{new Date(d + 'T12:00:00').getDate()}</b>{d === date && <span className={short ? 'accent' : 'okc'}>{short ? `${short} short` : evs.length ? 'ok' : '—'}</span>}</button>); })
          : <span className="grow muted sm" style={{ textAlign: 'center' }}>{dLabel(range.from)} – {dLabel(range.to)}</span>}
        <button className="round" onClick={() => setP('date', addDays(date, view === 'board' ? 1 : 7))}>›</button>
      </div>

      {hint && <div className="bk-hint" onClick={() => setHint('')}>{hint} ×</div>}
      {msg && <div className="bk-msg">{msg}</div>}

      {auto && !auto.open && view === 'board' && (
        <div className="adm-card bk-auto">
          <b>Auto-fill · {dLabel(date)}</b>
          <span className="muted sm">{cur(date).locks.length} locked {cur(date).locks.length === 1 ? 'person never moves' : 'people never move'} · only fills empty spots · uses who said yes, their from time, rank, notes, linked pairs and conditions.</span>
          <div className="row" style={{ gap: 8 }}><button className="abtn dark" onClick={runAuto}>Preview</button><button className="abtn" onClick={lockAll}>Lock all placed</button><button className="abtn" onClick={() => setAuto(null)}>Close</button></div>
        </div>
      )}
      {auto?.open && (
        <div className="bk-autobar">
          <b>Auto-fill preview · {cur(date).pl.filter((p) => p.suggested).length} suggestions</b><span className="grow">Dashed names are suggestions. Nothing is saved until Save.</span>
          <button className="abtn sm dark" onClick={acceptAll}>Accept all {cur(date).pl.filter((p) => p.suggested).length}</button><button className="abtn sm" onClick={clearAuto}>Clear</button>
        </div>
      )}
      {auto?.open && auto.skipped.length > 0 && <div className="bk-skipped"><b>Not suggested · {auto.skipped.length}</b>{auto.skipped.map((s) => <span key={s.name}>{s.name} · {s.why}</span>)}<small>You can still drag them in.</small></div>}

      {events === null ? <div className="muted">Loading…</div> : view === 'board' ? (
        <div className="bk-board">
          <aside className="bk-avail" onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropAvail(date)}>
            <div className="bk-tabs">{([['yes', 'Said yes'], ['wait', 'No reply'], ['not', 'Not asked']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} {counts[k]}</button>)}</div>
            <input className="bk-search" placeholder="Search staff…" value={q} onChange={(e) => setQ(e.target.value)} />
            {(['A', 'B', 'C', null] as const).map((t) => { const list = tabList.filter(({ s }) => (s.staff_private?.tier ?? null) === t); if (!list.length) return null; return (
              <div key={t ?? 'x'} className="bk-tier"><div className="kick">{t ? `TIER ${t}` : 'UNRANKED'} · {list.length}</div>
                {list.map(({ s, a, u }) => { const part = partnerOf(s.id); const c = condsOf(s.id); return (
                  <div key={s.id} className="bk-av" draggable onDragStart={() => setDrag({ staff_id: s.id })}>
                    <i className={'bk-t t' + (t ?? 'x')} />
                    <div className="grow"><b>{s.full_name}</b>
                      <small>{a?.status === 'yes' ? (a.from_time ? `from ${t12(a.from_time)}` : 'any time') : a?.status === 'asked' ? 'asked · no reply' : u?.status === 'yes' ? `usual week · ${u.from_time ? 'from ' + t12(u.from_time) : 'any time'}` : 'not asked'}
                        {part.length > 0 && ` · 🔗 ${part.map((x) => name(x).split(' ')[0]).join(', ')}`}{c.length > 0 && ` · ${c.map((x) => x.kind === 'not_venue' ? `no ${x.value}` : x.kind === 'min_guests' ? `${x.value}+ guests` : x.kind === 'big_dates_only' ? 'big dates only' : x.kind === 'only_if_needed' ? 'only if needed' : `not ${x.value}`).join(', ')}`}</small>
                      {a?.note && <i className="av-note-adm">“{a.note}”</i>}</div>
                  </div>); })}
              </div>); })}
            {tab === 'yes' && !counts.yes && <div className="muted sm" style={{ padding: 10 }}>Nobody said yes yet for this date.</div>}
            <button className="link-btn" style={{ margin: 10 }} onClick={() => setAskMore(true)}>Ask more people for {dLabel(date, { month: 'short', day: 'numeric' })} ›</button>
          </aside>
          <div className="bk-cols">{dayEvs(date).length ? dayEvs(date).map((e) => <Column key={e.id} e={e} d={date} />) : <div className="adm-card muted">No {dept} events on this day. <Link to={`/admin/event/new?d=${date}`}>+ New event</Link></div>}</div>
        </div>
      ) : view === 'sheet' ? (
        <div className="bk-sheet">
          {dates.map((d) => { const evs = dayEvs(d); if (!evs.length) return null; const total = evs.reduce((n, e) => n + e.staff_needed, 0); const named = plOf(d).filter((p) => evs.some((e) => e.id === p.event_id)).length; return (
            <div key={d} className="bk-sday">
              <div className="bk-sdh"><b>{dLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })}</b><span>{evs.length} event{evs.length > 1 ? 's' : ''} · {total} staff · {Math.max(0, total - named)} still to name</span><button className="link-btn" onClick={() => { setP('date', d); setP('view', 'board'); }}>Board view ›</button></div>
              {evs.map((e) => (
                <div key={e.id} className="bk-sev"><div className="bk-sevh"><b>{e.title}</b><span className="muted sm">{e.event_private?.client ?? ''}</span></div>
                  <table className="bk-st"><thead><tr><th>NEED</th><th>START ~ END</th><th>NAMES</th></tr></thead><tbody>
                    {(e.staffing ?? []).map((l, i) => { const people = plOf(d).filter((p) => p.event_id === e.id && p.start === l.start && (['MD', 'BM'].includes(l.code) ? p.code === l.code : !['MD', 'BM'].includes(p.code))); return (
                      <tr key={i}><td><i className={'dot ' + l.dept} /> {l.count} {roleName(l.code)}</td><td>{t12(l.start)}{l.end && <span className="muted"> ~ {t12(l.end)}</span>}</td>
                        <td><div className="row wrap" style={{ gap: 4 }}>{people.map((p) => <span key={p.key} className="bk-schip"><i className={'bk-t t' + (tier(p.staff_id) ?? 'x')} />{name(p.staff_id)}<button onClick={() => remove(d, p.key)}>×</button></span>)}
                          {people.length < l.count && <input className="bk-sadd" list={`bk-dl-${d}`} placeholder="+ type a name" onChange={(ev) => { const s = staff.find((x) => x.full_name === ev.target.value); if (s) { place(d, s.id, { event_id: e.id, start: l.start }); ev.target.value = ''; } }} />}</div></td></tr>); })}
                    {defaultExtras(e) > 0 && <tr><td colSpan={3} className="gold sm"><b>{extrasOf(d, e)} Extras +10%</b> · {(e.extras_billing ?? 'gr') === 'client' ? 'client pays' : 'on G&R'}</td></tr>}
                  </tbody></table>
                </div>
              ))}
              <datalist id={`bk-dl-${d}`}>{staff.filter((s) => s.active && !bookedOn(d).has(s.id) && !off.has(s.id + d)).sort((a, b) => Number(av.some((x) => x.staff_id === b.id && x.status === 'yes')) - Number(av.some((x) => x.staff_id === a.id && x.status === 'yes')) || rank(a.id) - rank(b.id)).map((s) => <option key={s.id} value={s.full_name} />)}</datalist>
            </div>); })}
          {!dates.some((d) => dayEvs(d).length) && <div className="adm-card muted">No {dept} events in this range.</div>}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {dates.map((d) => dayEvs(d).map((e) => { const pl = plOf(d).filter((p) => p.event_id === e.id); const lead = pl.find((p) => ['MD', 'BM'].includes(p.code)); const need = e.staff_needed + extrasOf(d, e); return (
            <button key={e.id} className="adm-card bk-li" onClick={() => { setP('date', d); setP('view', 'board'); }}>
              <span className="bk-ld"><small>{dLabel(d, { weekday: 'short' })}</small><b>{new Date(d + 'T12:00:00').getDate()}</b></span>
              <span className="grow" style={{ textAlign: 'left' }}><b>{e.title}</b><span className="muted sm"> · {e.event_private?.client ?? ''}</span><div className="muted sm">{lead ? `${lead.code} ${name(lead.staff_id)}` : 'MD not set'}</div></span>
              <span className={'tag ' + (pl.length >= need ? 'ok' : 'amber')}>{pl.length} / {need}</span>
            </button>); }))}
          {!dates.some((d) => dayEvs(d).length) && <div className="adm-card muted">No {dept} events in the next 14 days.</div>}
        </div>
      )}

      {nChanges > 0 && (
        <div className="bk-tray">
          <b>{nChanges} change{nChanges > 1 ? 's' : ''}</b>
          <span>{allChanges.reduce((n, c) => n + c.added.length, 0)} added · {allChanges.reduce((n, c) => n + c.moved.length, 0)} moved · {allChanges.reduce((n, c) => n + c.removed.length, 0)} removed · {mode === 'practice' ? 'practice · nobody alerted' : 'nobody alerted yet'}</span>
          <span className="grow" />
          <button className="abtn sm" disabled={!hist.length} onClick={undo}>Undo</button>
          <button className="abtn sm" disabled={busy} onClick={() => save(false)}>Save</button>
          <button className="abtn sm dark" disabled={busy} onClick={() => setReview(true)}>Save + send…</button>
        </div>
      )}

      {pair && (
        <div className="bk-modal" onClick={() => setPair(null)}><div className="adm-card" onClick={(e) => e.stopPropagation()}>
          <b>{name(pair.moving.staff_id).split(' ')[0]} + {name(pair.partner.staff_id).split(' ')[0]}: keep together?</b>
          <span className="muted sm">They're linked (they like working together).</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="abtn dark" onClick={() => { const d = date; const c = cur(d); setCur(d, { ...c, pl: c.pl.map((p) => (p.key === pair.moving.key || p.key === pair.partner.key ? { ...p, event_id: pair.to.event_id, start: pair.to.start } : p)) }); setPair(null); }}>Move both</button>
            <button className="abtn" onClick={() => { place(date, pair.moving.staff_id, pair.to, pair.moving.key, true); setPair(null); }}>Just this one</button>
          </div>
        </div></div>
      )}

      {phone && (
        <div className="bk-modal" onClick={() => setPhone(null)}><div className="adm-card" onClick={(e) => e.stopPropagation()}>
          <b>Move {name(phone.staff_id)} to…</b>
          {dayEvs(date).flatMap((e) => groupsOf(date, e).map((g) => (
            <button key={e.id + g.start} className="abtn" disabled={phone.event_id === e.id && phone.start === g.start} onClick={() => { place(date, phone.staff_id, { event_id: e.id, start: g.start }, phone.key); setPhone(null); }}>{e.title} · {t12(g.start)}</button>)))}
          <button className="abtn" onClick={() => { remove(date, phone.key); setPhone(null); }}>Back to available</button>
          <button className="abtn" onClick={() => setPhone(null)}>Close</button>
        </div></div>
      )}

      {review && (
        <div className="bk-modal" onClick={() => setReview(false)}><div className="adm-card bk-review" onClick={(e) => e.stopPropagation()}>
          <div className="spread"><b className="serif" style={{ fontSize: 22 }}>Review before sending</b><button className="abtn sm" onClick={() => setReview(false)}>✕</button></div>
          {allChanges.map((c) => <div key={c.d} className="stack" style={{ gap: 6 }}>
            <div className="kick">{dLabel(c.d, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
            {c.added.length > 0 && <div><b className="okc">New confirmations · {c.added.length}</b>{c.added.map((p) => <div key={p.key} className="sm">{name(p.staff_id)} · {evById[p.event_id]?.title} · {t12(p.start)}</div>)}</div>}
            {c.moved.length > 0 && <div><b className="gold">Changed · {c.moved.length}</b>{c.moved.map((p) => { const r = (base[c.d] ?? []).find((x) => x.shift_id === p.shift_id)!; return <div key={p.key} className="sm">{name(p.staff_id)} · <s>{evById[r.event_id]?.title} {t12(r.start)}</s> → {evById[p.event_id]?.title} {t12(p.start)}</div>; })}</div>}
            {c.removed.length > 0 && <div><b className="accent">Removed · {c.removed.length}</b>{c.removed.map((p) => <div key={p.key} className="sm">{name(p.staff_id)} · {evById[p.event_id]?.title}</div>)}</div>}
          </div>)}
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <button className="abtn" onClick={() => save(false)}>Save, send later</button>
            <button className="abtn dark" disabled={busy} onClick={() => save(true)}>{mode === 'practice' ? 'Practice · nothing sent' : `Save ${nChanges} now`}</button>
          </div>
        </div></div>
      )}

      {askMore && <AskMore date={date} dept={dept} events={(events ?? []).filter((e) => e.event_date === date)} staff={staff} av={av} wk={wk} off={off} conds={conds} links={links}
        booked={bookedOn(date)} shifts30={shifts30} yesRate={yesRate} extras={(e) => extrasOf(date, e)} practice={mode === 'practice'} onClose={() => setAskMore(false)} onAsked={load} />}
    </div>
  );
}

/** Ask more people: who to ask so the date fills, by rank, weekday fit, recent shifts and yes rate. */
function AskMore({ date, dept, events, staff, av, wk, off, conds, links, booked, shifts30, yesRate, extras, practice, onClose, onAsked }: {
  date: string; dept: 'floor' | 'bar'; events: AEvent[]; staff: AStaff[]; av: Av[]; wk: Wk[]; off: Set<string>; conds: Cond[]; links: [string, string][];
  booked: Set<string>; shifts30: Record<string, number>; yesRate: Record<string, number>; extras: (e: AEvent) => number; practice: boolean; onClose: () => void; onAsked: () => void;
}) {
  const evs = events.filter((e) => (dept === 'bar') === isBarEv(e));
  const order = evs.reduce((n, e) => n + e.staff_needed, 0); const ex = evs.reduce((n, e) => n + extras(e), 0); const target = order + ex;
  const yesFree = av.filter((a) => a.status === 'yes' && !booked.has(a.staff_id)).length;
  const covered = [...booked].filter((sid) => staff.find((s) => s.id === sid)).length + yesFree;
  const waiting = av.filter((a) => a.status === 'asked');
  const expected = waiting.reduce((n, a) => n + (yesRate[a.staff_id] ?? 0.5), 0);
  const need = Math.max(0, Math.ceil(target - covered - expected));
  const dow = dowOf(date);
  const asked = new Set(av.map((a) => a.staff_id));
  const condsOf = (sid: string) => conds.filter((c) => c.staff_id === sid);
  const cands = staff.filter((s) => s.active && (dept === 'bar' ? s.department === 'bar' : s.department !== 'bar') && !asked.has(s.id) && !booked.has(s.id) && !off.has(s.id + date)
    && wk.find((w) => w.staff_id === s.id && w.dow === dow)?.status !== 'no' && !/manual booking only|leaving|do not book/i.test(s.staff_private?.notes ?? ''))
    .map((s) => { const u = wk.find((w) => w.staff_id === s.id && w.dow === dow); const k = condsOf(s.id).map((c) => c.kind);
      const linkedBooked = links.some((l) => l.includes(s.id) && [...booked, ...av.filter((a) => a.status === 'yes').map((a) => a.staff_id)].includes(l[0] === s.id ? l[1] : l[0]));
      const held = (shifts30[s.id] ?? 0) >= 7 ? '7+ shifts in 30 days' : k.includes('big_dates_only') ? 'only for very big dates' : k.includes('only_if_needed') ? 'only when we really need them' : '';
      return { s, u, rate: yesRate[s.id] ?? 0.5, n30: shifts30[s.id] ?? 0, held, linkedBooked }; })
    .sort((a, b) => Number(b.linkedBooked) - Number(a.linkedBooked) || (a.s.staff_private?.ranking ?? 9999) - (b.s.staff_private?.ranking ?? 9999) || Number(!!b.u) - Number(!!a.u) || a.n30 - b.n30 || b.rate - a.rate);
  const main = cands.filter((c) => !c.held); const held = cands.filter((c) => c.held);
  const [pick, setPick] = useState<Set<string>>(() => { const p = new Set<string>(); let sum = 0; for (const c of main) { if (sum >= need) break; p.add(c.s.id); sum += c.rate; } return p; });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const text = `Hey! G&R has a new date for you: ${dLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}. Let me know in the app 👉 https://gr-staff-portal.vercel.app/availability`;
  const ask = async () => {
    if (practice) return;
    setBusy(true); setMsg('');
    const people = staff.filter((s) => pick.has(s.id));
    const { data: a, error } = await supabase.from('avail_asks').upsert({ for_date: date, department: dept, label: evs.length === 1 ? 'Evening event' : `${evs.length} events`, approx_start: evs[0]?.start_time ?? null, staff_needed: target }, { onConflict: 'for_date,department' }).select('id').single();
    if (error || !a) { setMsg(error?.message ?? 'Could not save'); setBusy(false); return; }
    const r = await supabase.from('availability').upsert(people.map((s) => ({ staff_id: s.id, for_date: date, part: 'evening', status: 'asked', ask_id: a.id, tier: s.staff_private?.tier ?? null, asked_at: new Date().toISOString() })), { onConflict: 'staff_id,for_date,part', ignoreDuplicates: true });
    setBusy(false); if (r.error) setMsg(r.error.message); else { setMsg(`${people.length} people asked. They see it in the app.`); onAsked(); }
  };
  const Row = ({ c }: { c: typeof cands[number] }) => (
    <label className="bk-ask">
      <input type="checkbox" checked={pick.has(c.s.id)} onChange={(e) => { const p = new Set(pick); if (e.target.checked) p.add(c.s.id); else p.delete(c.s.id); setPick(p); }} />
      <span className="grow"><b>{c.s.full_name}</b> <i className={'bk-t t' + (c.s.staff_private?.tier ?? 'x')} /><small> rank {c.s.staff_private?.ranking ?? '—'}</small>{c.linkedBooked && <small className="okc"> · 🔗 partner is on</small>}</span>
      <span className={c.u ? 'okc sm' : 'muted sm'}>{c.u ? (c.u.from_time ? `from ${t12(c.u.from_time)}` : 'any time') : 'not set'}</span>
      <span className="bk-n30"><i style={{ width: `${Math.min(100, c.n30 * 12)}%` }} /></span><span className="sm" style={{ width: 34, textAlign: 'right' }}>{Math.round(c.rate * 100)}%</span>
      {c.held && <small className="gold" style={{ width: 150 }}>{c.held}</small>}
    </label>);
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card bk-askm" onClick={(e) => e.stopPropagation()}>
      <div className="spread"><b className="serif" style={{ fontSize: 22 }}>Ask more people · {dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} · {dept}</b><button className="abtn sm" onClick={onClose}>✕</button></div>
      <div className="bk-stats">
        <div><small>CLIENT ORDER</small><b>{order}</b></div><div><small>+ EXTRAS</small><b>{ex}</b></div><div><small>TARGET</small><b>{target}</b></div>
        <div><small>COVERED</small><b>{covered}</b></div><div><small>STILL WAITING</small><b>{waiting.length}</b><span>≈ {expected.toFixed(1)} yes</span></div><div className="need"><small>NEED MORE YES</small><b>{need}</b></div>
      </div>
      <div className="kick">SUGGESTED · {main.length}</div>
      <div className="bk-asklist">{main.map((c) => <Row key={c.s.id} c={c} />)}</div>
      {held.length > 0 && <><div className="kick">HELD BACK · WAVE 2 · {held.length}</div><div className="bk-asklist">{held.map((c) => <Row key={c.s.id} c={c} />)}</div></>}
      {msg && <div className="okc sm">{msg}</div>}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button className="abtn" onClick={() => navigator.clipboard?.writeText(text)}>Copy text</button>
        <button className="abtn dark" disabled={busy || practice || !pick.size} onClick={ask}>{practice ? 'Practice · no asks sent' : `Ask ${pick.size} people`}</button>
      </div>
    </div></div>
  );
}
