import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { StaffProfile } from './StaffProfile';
import { openReminders, resolveReminder, friendly, type Reminder } from './StaffRemind';
import { supabase } from '../lib/supabase';
import { setting, autoExtras } from '../lib/settings';
import { DeptTag } from './DeptTag';
import { BoardAlso, type OtherShift } from './alsoWorking';
import { needsSend, liveShift, doesBar, eventsBetween, allStaff, addDays, isoDay, dLabel, ap12, startIso, endIso, roleName, bookingChange, confirmationsSent, countOf, sendStateOf, type AEvent, type AStaff, type Client, type Venue } from './api';
import { misfits, linksOf, other, condShort, RuleIcons, type SLink, type SCond } from './rules';
import { loadScoreData, scoreOf, type ScoreData } from './score';
import { locksBetween, setLock, lockTitle, NO_LOCKS, type Locks } from './locks';

/* Push 23 · Bookings (admin). Practice mode by default: every change lives in a draft (booking_drafts) layered
   over the real shifts; staff see nothing until Ronnie switches to Live and saves. */

type Pl = { key: string; staff_id: string; event_id: string; start: string; code: string; shift_id?: string | null; extra?: boolean; suggested?: boolean;
  /** Nov 4 · the line (time group) they sit in when their own start differs ("starts 4:30 PM" tag). start = their real start. */
  line?: string;
  /** Nov 4 · you dragged them onto a line (keep them off the automatic extras) */
  keep?: boolean };
/** Line start a time belongs to: the latest line at or before it, else the first line. null = it is a line start / no lines. */
const lineFor = (starts: string[], t: string): string | undefined => {
  if (!starts.length || starts.includes(t)) return undefined;
  const m = (x: string) => { const [h, mi] = x.split(':').map(Number); return h * 60 + mi; };
  const sorted = [...starts].sort((a, b) => m(a) - m(b));
  return [...sorted].reverse().find((x) => m(x) <= m(t)) ?? sorted[0];
};
type Av = { staff_id: string; status: string; from_time: string | null; note: string | null; tier: string | null };
type Wk = { staff_id: string; dow: number; status: string; from_time: string | null };
type Cond = SCond;
type Warn = { key: string; cls: 'red' | 'gold' | 'ok'; text: React.ReactNode };
/** locks (push 50): staff ids locked on a placement not saved yet; saved shifts use the real padlock (shifts.locked, migration 055). */
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
/** Settings → Extras (over 7 staff → 10 % rounded up by default). */
const defaultExtras = (e: AEvent) => (!isBarEv(e) ? autoExtras(e.staff_needed) : 0);
const readLS = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const writeLS = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function Bookings() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? isoDay(new Date());
  const view = (params.get('view') as View) ?? (window.innerWidth < 820 ? 'list' : 'board');
  // Nov 5 · Floor / Bar / Both (both = every event of the day, floor first then bar)
  const dept: 'floor' | 'bar' | 'both' = params.get('dept') === 'bar' ? 'bar' : params.get('dept') === 'floor' ? 'floor' : 'both'; // Nov 5 · Both by default
  const [oneDept, setOneDept] = useState<'floor' | 'bar'>('floor'); // which team Auto-fill / Ask more works on in Both
  const fillDept: 'floor' | 'bar' = dept === 'both' ? oneDept : dept;
  const [sideDept, setSideDept] = useState<'all' | 'floor' | 'bar'>('all');
  const span = Number(params.get('span') ?? 7);
  const setP = (k: string, v: string) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p, { replace: true }); };

  const [mode, setMode] = useState<'practice' | 'live'>(() => (readLS('gr-book-mode', 'practice') as 'practice' | 'live'));
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [prof, setProf] = useState<string | null>(null); // Nov 5 · staff profile opened from the name menu (knows, tier, notes)
  const navB = useNavigate();
  const [av, setAv] = useState<Av[]>([]); const [wk, setWk] = useState<Wk[]>([]); const [off, setOff] = useState<Set<string>>(new Set());
  const [links, setLinks] = useState<[string, string][]>([]); const [conds, setConds] = useState<Cond[]>([]);
  const [rl, setRl] = useState<SLink[]>([]); const [clients, setClients] = useState<Client[]>([]); const [venues, setVenues] = useState<Venue[]>([]);
  const [sd, setSd] = useState<ScoreData | null>(null); const [warns, setWarns] = useState<Warn[]>([]);
  const [shifts30, setShifts30] = useState<Record<string, number>>({}); const [yesRate, setYesRate] = useState<Record<string, number>>({});
  const [base, setBase] = useState<Record<string, Pl[]>>({});
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [hist, setHist] = useState<Record<string, Draft>[]>([]);
  const [tab, setTab] = useState<'yes' | 'wait' | 'not'>('yes'); const [q, setQ] = useState('');
  // push 49 · add = dragged from "Already placed today" → a 2nd shift that day (not a move)
  // Nov 4 · drag lives in a ref (no re-render on drag start: that cancelled the drag on laptops); body class = drop-zone styling
  type Drag = { staff_id: string; key?: string; add?: boolean };
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (g: Drag | null) => { dragRef.current = g; try { document.body.classList.toggle('bk-dragging', !!g); } catch { /* ssr */ } };
  const dragStart = (ev: React.DragEvent, g: Drag) => { try { ev.dataTransfer.setData('text/plain', g.staff_id); ev.dataTransfer.effectAllowed = 'move'; } catch { /* old browsers */ } setDrag(g); };
  /** push 49 · a placed chip dropped on ANOTHER event → "Add a 2nd shift · keep both" / "Move · off <event 1>" / Cancel */
  const [dropAsk, setDropAsk] = useState<{ p: Pl; to: { event_id: string; start: string; extra?: boolean; lead?: 'MD' | 'BM' } } | null>(null);
  const [hint, setHint] = useState<string>('');
  const [sendOf, setSendOf] = useState<string | null>(null); const [sendBusy, setSendBusy] = useState(false); // Nov 6 · SEND chip menu
  // Nov 6 · 📌 reminders for the next booking (068) · only Ronnie sees them
  const [rems, setRems] = useState<Record<string, Reminder[]>>({}); const [remTxt, setRemTxt] = useState('');
  useEffect(() => { openReminders().then(setRems); }, []);
  // Nov 4 · Confirm all (with Undo), fold "Already placed today", find a name on the board
  const [undoConf, setUndoConf] = useState<{ ids: string[]; title: string } | null>(null);
  // Nov 5 · the staff list folds into a thin strip so the events get the room (remembered)
  const [sideOpen, setSideOpen0] = useState(() => { try { return localStorage.getItem('gr_bk_side') !== '0'; } catch { return true; } });
  const setSideOpen = (v: boolean) => { setSideOpen0(v); try { localStorage.setItem('gr_bk_side', v ? '1' : '0'); } catch { /* private mode */ } };
  const [placedOpen, setPlacedOpen] = useState(() => { try { return localStorage.getItem('gr_bk_placed') === '1'; } catch { return false; } });
  const [findQ, setFindQ] = useState(''); const [flash, setFlash] = useState('');
  const [pair, setPair] = useState<{ moving: Pl; partner: Pl; to: { event_id: string; start: string } } | null>(null);
  const [auto, setAuto] = useState<{ open: boolean; skipped: { name: string; why: string }[] } | null>(null);
  const [review, setReview] = useState(false); const [askMore, setAskMore] = useState(() => params.get('ask') === '1');
  // push 28 · opened from "Find a replacement ›" / "Accept + fill the spot": Ask more for N spots, and the next person added to
  // that event (Live save) is saved as the replacement of the cancelled shift (shifts.replacement_for).
  const spots = params.get('spots') ? Math.max(1, Number(params.get('spots')) || 1) : undefined;
  const replaceId = params.get('replace'); const replaceAt = params.get('at');
  const [asksBy, setAsksBy] = useState<Record<string, { kind: string; new_time: string }>>({});
  /** chip menu (phone + click): Move to… · Also add to… (2nd shift that day) · Remove. No `p` = from the side list "+ 2nd shift". */
  const [phone, setPhone] = useState<{ sid: string; p?: Pl; step: 'menu' | 'move' | 'add' | 'time' | 'note' | 'rem'; rid?: string } | null>(null);
  // Nov 5 · note for the manager (has to leave by + note; managers/MDs see it, staff don't)
  const [mNotes, setMNotes] = useState<Record<string, string>>({}); const [nLeave, setNLeave] = useState(''); const [nText, setNText] = useState('');
  const [sNotes, setSNotes] = useState<Record<string, { note: string; shifts: number | null; from_date: string }>>({}); const [nScope, setNScope] = useState<'shift' | 'first3' | 'always'>('shift'); // 076
  const [ownT, setOwnT] = useState(''); // Nov 4 · Change start time (one person)
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [locks, setLocks] = useState<Locks>(NO_LOCKS); // push 50 · padlock on saved shifts

  const range = view === 'board' ? { from: date, to: date } : { from: date, to: addDays(date, (view === 'sheet' ? span : 14) - 1) };
  const dates = useMemo(() => Array.from({ length: (new Date(range.to).getTime() - new Date(range.from).getTime()) / 864e5 + 1 }, (_, i) => addDays(range.from, i)), [range.from, range.to]);

  const load = async () => {
    setEvents(null);
    const since30 = addDays(date, -setting('ask.hold_back').days); const since90 = addDays(date, -90);
    const [evs, st, a, w, o, l, c, s30, hist90, dr] = await Promise.all([
      eventsBetween(range.from, range.to), staff.length ? Promise.resolve(staff) : allStaff(),
      supabase.from('availability').select('staff_id,status,from_time,note,tier,for_date').gte('for_date', range.from).lte('for_date', range.to).not('ask_id', 'is', null),
      supabase.from('staff_weekly').select('staff_id,dow,status,from_time'),
      supabase.from('days_off').select('staff_id,from_date,to_date').lte('from_date', range.to).gte('to_date', range.from),
      supabase.from('staff_links').select('staff_a,staff_b,kind,reason'), supabase.from('staff_conditions').select('id,staff_id,kind,value,reason'),
      supabase.from('shifts').select('staff_id,events!inner(event_date)').neq('status', 'declined').gte('events.event_date', since30).lt('events.event_date', date),
      supabase.from('availability').select('staff_id,status').gte('for_date', since90).in('status', ['yes', 'no']),
      supabase.from('booking_drafts').select('for_date,payload').gte('for_date', range.from).lte('for_date', range.to),
    ]);
    setStaff(st);
    setAv(((a.data ?? []) as (Av & { for_date: string })[]).filter((x) => x.for_date === date || view !== 'board'));
    setWk((w.data ?? []) as Wk[]);
    const offSet = new Set<string>(); for (const r of (o.data ?? []) as { staff_id: string; from_date: string; to_date: string }[]) for (const d of dates) if (r.from_date <= d && r.to_date >= d) offSet.add(r.staff_id + d); setOff(offSet);
    const allLinks = (Array.isArray(l.data) ? l.data as SLink[] : []).filter((x) => x && typeof x.staff_a === 'string' && typeof x.staff_b === 'string').map((x) => ({ ...x, kind: x.kind === 'apart' ? 'apart' : 'together' } as SLink));
    setRl(allLinks); setLinks(allLinks.filter((x) => x.kind === 'together').map((x) => [x.staff_a, x.staff_b]));
    setConds((Array.isArray(c.data) ? c.data as Cond[] : []).filter((x) => x && typeof x.staff_id === 'string'));
    if (!sd) loadScoreData().then(setSd);
    if (!clients.length) supabase.from('clients').select('id,name,kind').then(({ data }) => setClients(Array.isArray(data) ? data as Client[] : []));
    if (!venues.length) supabase.from('venues').select('id,name').then(({ data }) => setVenues(Array.isArray(data) ? data as Venue[] : []));
    const cnt: Record<string, number> = {}; for (const r of (s30.data ?? []) as { staff_id: string }[]) cnt[r.staff_id] = (cnt[r.staff_id] ?? 0) + 1; setShifts30(cnt);
    const yr: Record<string, [number, number]> = {}; for (const r of (hist90.data ?? []) as { staff_id: string; status: string }[]) { const x = (yr[r.staff_id] ??= [0, 0]); x[r.status === 'yes' ? 0 : 1]++; }
    setYesRate(Object.fromEntries(Object.entries(yr).map(([k, [y, n]]) => [k, y / (y + n)])));
    const b: Record<string, Pl[]> = {};
    for (const e of evs) { const ls = [...new Set((e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code)).map((l) => l.start))];
      for (const s of e.shifts) if (s.status !== 'declined' && !s.attendance) { const st = hm(s.planned_start); const line = ['MD', 'BM'].includes(s.position_code ?? '') ? undefined : lineFor(ls, st);
        (b[e.event_date] ??= []).push({ key: s.id, staff_id: s.staff_id, event_id: e.id, start: st, code: s.position_code ?? 'W', shift_id: s.id, ...(line ? { line } : {}) }); } }
    // Nov 5 · your own Extras / line picks (migration 063)
    const xIds = evs.flatMap((e) => e.shifts.map((x) => x.id));
    if (xIds.length) { const { data: xs } = await supabase.from('shift_extras').select('shift_id,kind').in('shift_id', xIds).in('kind', ['manual', 'keep']);
      const k = new Map(((xs ?? []) as { shift_id: string; kind: string }[]).map((x) => [x.shift_id, x.kind]));
      for (const d of Object.keys(b)) b[d] = b[d].map((p) => (p.shift_id && k.get(p.shift_id) === 'manual' ? { ...p, extra: true } : p.shift_id && k.get(p.shift_id) === 'keep' ? { ...p, keep: true } : p)); }
    setBase(b);
    locksBetween(range.from, range.to, evs).then(setLocks);
    // push 28d · gold "asks 7:00 PM" tag on the name until Ronnie answers (table is new in 034: errors → no tags)
    const ids = evs.flatMap((e) => e.shifts.map((x) => x.id));
    if (ids.length) supabase.from('shift_change_requests').select('shift_id,kind,new_time').eq('status', 'pending').in('shift_id', ids)
      .then(({ data, error }) => { if (!error && Array.isArray(data)) setAsksBy(Object.fromEntries((data as { shift_id: string; kind: string; new_time: string }[]).map((x) => [x.shift_id, x]))); });
    setDraft(Object.fromEntries(((dr.data ?? []) as { for_date: string; payload: Draft }[]).map((x) => [x.for_date, x.payload])));
    setHist([]);
    setEvents(evs);
    { const ids = evs.flatMap((e) => e.shifts.map((s) => s.id)); if (ids.length) supabase.from('shift_mgr_notes').select('shift_id,note').in('shift_id', ids).then(({ data, error }) => { if (!error) setMNotes(Object.fromEntries(((data ?? []) as { shift_id: string; note: string }[]).map((r) => [r.shift_id, r.note]))); }); }
    supabase.from('staff_mgr_notes').select('staff_id,note,shifts,from_date').then(({ data, error }) => { if (!error) setSNotes(Object.fromEntries(((data ?? []) as { staff_id: string; note: string; shifts: number | null; from_date: string }[]).map((r) => [r.staff_id, r]))); });
  };
  useEffect(() => { load(); }, [date, view, span]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const replaceOf = useMemo(() => { for (const e of events ?? []) { const x = e.shifts.find((y) => y.id === replaceId); if (x) return { ...x, event_id: e.id, title: e.title }; } return null; }, [events, replaceId]);
  const evById = useMemo(() => Object.fromEntries((events ?? []).map((e) => [e.id, e])), [events]);
  const cur = (d: string): Draft => draft[d] ?? { pl: base[d] ?? [], locks: [], extras: {} };
  const setCur = (d: string, next: Draft) => { setHist((h) => [...h.slice(-30), draft]); setDraft({ ...draft, [d]: next }); };
  const plOf = (d: string) => cur(d).pl.filter((p) => !p.suggested || auto?.open);
  const name = (sid: string) => byId[sid]?.full_name ?? '?';
  const tier = (sid: string) => byId[sid]?.staff_private?.tier ?? null;
  const rank = (sid: string) => byId[sid]?.staff_private?.ranking ?? 9999;
  const scores = useMemo(() => (sd ? Object.fromEntries(staff.map((s) => [s.id, scoreOf(s, sd).total])) : {} as Record<string, number>), [sd, staff]);
  // Nov 5 · Ranking v3: team strength = average form score (0–100), so bar and floor compare fairly
  const forms = useMemo(() => (sd ? Object.fromEntries(staff.map((s) => [s.id, scoreOf(s, sd).form])) : {} as Record<string, number>), [sd, staff]);
  /** Higher score first; the old rank breaks ties. */
  const byScore = (a: string, b: string) => (scores[b] ?? -1e9) - (scores[a] ?? -1e9) || rank(a) - rank(b);
  const apartOf = (sid: string) => linksOf(rl, sid, 'apart').map((l) => other(l, sid));
  const isBig = (d: string) => floorNeed((events ?? []).filter((e) => e.event_date === d)) >= setting('ask.big_date');
  /** Warnings when adding someone (never blocking) + green hint when a works-well-with partner said yes. */
  const warnFor = (d: string, sid: string, e: AEvent, pl: Pl[]): Warn[] => {
    const f = (x: string) => name(x).split(' ')[0]; const out: Warn[] = [];
    for (const x of apartOf(sid)) if (pl.some((p) => p.event_id === e.id && p.staff_id === x)) {
      const why = linksOf(rl, sid, 'apart').find((l) => other(l, sid) === x)?.reason;
      out.push({ key: 'ap' + x, cls: 'red', text: <><b>{f(sid)} + {f(x)}</b> are kept apart{why ? ` (${why})` : ''}. Book anyway?</> });
    }
    for (const m of misfits(sid, e, { conds, clients, venues, big: isBig(d) })) out.push({ key: m.kind, cls: 'gold', text: <><b>{f(sid)}</b> {m.text}.</> });
    for (const x of partnerOf(sid)) if (!pl.some((p) => p.staff_id === x) && av.some((a) => a.staff_id === x && a.status === 'yes') && !off.has(x + d)) {
      out.push({ key: 'tg' + x, cls: 'ok', text: <><b>{f(x)}</b> works well with {f(sid)} · said yes to this date. <button className="lnk" onClick={() => { place(d, x, { event_id: e.id, start: pl.find((p) => p.staff_id === sid)?.start ?? (e.start_time ?? '17:00').slice(0, 5) }); setWarns((w) => w.filter((y) => y.key !== 'tg' + x)); }}>Add {f(x)}</button></> });
    }
    return out;
  };
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
    // Nov 5 · into / out of Extras on the same event (saved as your own pick)
    const marked = now.filter((p) => p.shift_id && real.some((r) => r.shift_id === p.shift_id && r.event_id === p.event_id && r.start === p.start && (!!r.extra !== !!p.extra || !!r.keep !== !!p.keep)));
    // Nov 9 · role change only (e.g. dropped on the MD slot, same event and time) → position updated, nothing sent
    const reroled = now.filter((p) => p.shift_id && real.some((r) => r.shift_id === p.shift_id && r.event_id === p.event_id && r.start === p.start && (r.code ?? 'W') !== p.code));
    return { added, removed, moved, marked, reroled };
  };
  const allChanges = dates.map((d) => ({ d, ...changesFor(d) })).filter((c) => draft[c.d]);
  const nChanges = allChanges.reduce((n, c) => n + c.added.length + c.removed.length + c.moved.length + c.marked.length + c.reroled.length, 0);

  // ── placing ─────────────────────────────────────────────────────
  /** push 49 · is the person already (really) placed on this event that day? (one shift per person per event) */
  const onEvent = (d: string, sid: string, eventId: string, exceptKey?: string) => plOf(d).some((p) => p.staff_id === sid && p.event_id === eventId && !p.suggested && p.key !== exceptKey);
  const place = (d: string, sid: string, to: { event_id: string; start: string; extra?: boolean; lead?: 'MD' | 'BM' }, fromKey?: string, both = false, add = false) => {
    if (rems[sid]?.length && !fromKey) setTimeout(() => setHint(`📌 ${name(sid).split(' ')[0]}: ${rems[sid][0].note} · click her name to add it to her confirmation`), 50);
    const c = cur(d); let pl = [...c.pl];
    const a = avOf(sid); let start = to.start;
    if (a?.from_time && toMin(a.from_time) > toMin(to.start) + 15) start = q15(a.from_time); // can only start 15+ min later → own time group
    // push 49 · add = a 2nd shift that day: never moves the first one (info only, no gap rule, never blocks)
    if (add && onEvent(d, sid, to.event_id)) { setHint(`${name(sid).split(' ')[0]} is already on ${evById[to.event_id]?.title ?? 'this event'}`); return; }
    const existing = add ? undefined : fromKey ? pl.find((p) => p.key === fromKey) : pl.find((p) => p.staff_id === sid);
    if (existing) {
      if (!both) { const partner = pl.find((p) => p.event_id === existing.event_id && partnerOf(sid).includes(p.staff_id) && p.key !== existing.key && !isLocked(d, p)); // push 50 · a locked partner stays
        if (partner && existing.event_id !== to.event_id) { setPair({ moving: existing, partner, to: { event_id: to.event_id, start } }); return; } }
      const sameEv = existing.event_id === to.event_id;
      // Nov 5 · into Extras on the same event: same start time, only the Extras flag changes
      if (to.extra && sameEv) pl = pl.map((p) => (p.key === existing.key ? { ...p, extra: true, keep: false, suggested: false } : p));
      else { const e2 = evById[to.event_id]; const dflt = isBarEv(e2) ? (byId[sid]?.positions.includes('BT') ? 'BT' : 'BB') : 'W';
        // Nov 9 · dropped on the MD / Bar manager slot → becomes the lead; dragged out of it → back to a normal role
        const code = to.lead ?? (['MD', 'BM'].includes(existing.code) ? dflt : existing.code);
        pl = pl.map((p) => (p.key === existing.key ? { ...p, code, event_id: to.event_id, start, line: start !== to.start ? to.start : undefined, extra: !to.lead && !!to.extra, keep: !to.extra, suggested: false } : p)); }
    } else {
      const e = evById[to.event_id]; pl.push({ key: uid(), staff_id: sid, event_id: to.event_id, start, ...(start !== to.start ? { line: to.start } : {}), code: to.lead ?? (isBarEv(e) ? (byId[sid]?.positions.includes('BT') ? 'BT' : 'BB') : 'W'), extra: !to.lead && !!to.extra });
    }
    if (start !== to.start) setHint(`${name(sid).split(' ')[0]} can only start ${t12(start)} · gold “starts ${t12(start)}” tag on the name`);
    if (!existing || existing.event_id !== to.event_id) { const e = evById[to.event_id]; if (e) setWarns(warnFor(d, sid, e, pl)); }
    setCur(d, { ...c, pl });
  };
  const remove = (d: string, key: string) => { const c = cur(d); const p = c.pl.find((x) => x.key === key); if (p && !okLocked(d, p, 'remove')) return; setCur(d, { ...c, pl: c.pl.filter((x) => x.key !== key) }); };
  /** push 50 · saved shift → the real padlock (admin only, staff never see it, written right away in both modes); not saved yet → kept in the draft and written on Live save. */
  const isLocked = (d: string, p: Pl) => (p.suggested ? false : p.shift_id ? locks.ids.has(p.shift_id) : cur(d).locks.includes(p.staff_id));
  const lockShift = async (id: string, on: boolean) => {
    const now = await setLock(id, on);
    setLocks((l) => { const ids = new Set(l.ids); const bd = new Set(l.byDefault); bd.delete(id); if (now) ids.add(id); else ids.delete(id); return { ...l, ids, byDefault: bd }; });
  };
  const toggleLock = async (d: string, p: Pl) => {
    if (p.shift_id) {
      if (!locks.ready) { setHint('The padlock needs migration 055. MDs and managers already count as locked.'); return; }
      try { await lockShift(p.shift_id, !locks.ids.has(p.shift_id)); } catch (e) { setHint((e as Error).message); }
      return;
    }
    const c = cur(d); const sid = p.staff_id; setCur(d, { ...c, locks: c.locks.includes(sid) ? c.locks.filter((x) => x !== sid) : [...c.locks, sid] });
  };
  /** Moving or removing a locked person by hand: ask first (suggestions never do it). */
  const okLocked = (d: string, p: Pl, verb: 'move' | 'remove') => !isLocked(d, p) || confirm(`${name(p.staff_id)} is locked on ${evById[p.event_id]?.title ?? 'this event'}. ${verb === 'move' ? 'Move' : 'Remove'} anyway?`);
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
        for (const p of c.marked) { await supabase.rpc('admin_mark_extra', { p_shift: p.shift_id, p_kind: p.extra ? 'manual' : p.keep ? 'keep' : null }); n++; }
        for (const p of c.moved) if (p.shift_id && (p.extra || p.keep)) await supabase.rpc('admin_mark_extra', { p_shift: p.shift_id, p_kind: p.extra ? 'manual' : 'keep' });
        for (const p of c.moved) {
          const r = (base[c.d] ?? []).find((x) => x.shift_id === p.shift_id)!; const fe = evById[r.event_id]; const te = evById[p.event_id];
          await supabase.from('shifts').update({ event_id: p.event_id, planned_start: startIso(te.event_date, p.start), position_code: p.code, position_detail: roleName(p.code) }).eq('id', p.shift_id!);
          await bookingChange('moved', { staff_id: p.staff_id, shift_id: p.shift_id, from: { id: fe.id, event_date: fe.event_date, title: fe.title, sent: confirmationsSent(fe), start: startIso(fe.event_date, r.start) }, to: { id: te.id, event_date: te.event_date, title: te.title, sent: confirmationsSent(te), start: startIso(te.event_date, p.start) } }); n++;
        }
        for (const p of c.reroled) { await supabase.from('shifts').update({ position_code: p.code, position_detail: roleName(p.code) }).eq('id', p.shift_id!); n++; }
        let repFor = replaceId && replaceOf ? replaceId : null;
        for (const p of c.added) {
          const e = evById[p.event_id];
          const row: Record<string, unknown> = { event_id: p.event_id, staff_id: p.staff_id, position_code: p.code, position_detail: roleName(p.code), planned_start: startIso(e.event_date, p.start), status: 'booked' };
          const isRep = !!repFor && p.event_id === replaceOf?.event_id;
          let { data: ins, error: insErr } = await supabase.from('shifts').insert(isRep ? { ...row, replacement_for: repFor } : row).select('id').single();
          if (insErr && isRep) ({ data: ins, error: insErr } = await supabase.from('shifts').insert(row).select('id').single()); // migration 034 not applied yet
          if (isRep && ins) repFor = null;
          if (ins?.id && (p.extra || p.keep)) await supabase.rpc('admin_mark_extra', { p_shift: ins.id, p_kind: p.extra ? 'manual' : 'keep' });
          if (ins?.id && (draft[c.d]?.locks ?? []).includes(p.staff_id)) await setLock(ins.id, true).catch(() => {}); // push 50 · locked before it was saved
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
    return staff.filter((s) => s.active && (dept === 'both' ? (sideDept === 'all' || (sideDept === 'bar' ? doesBar(s) : s.department !== 'bar')) : dept === 'bar' ? doesBar(s) : s.department !== 'bar') && !booked.has(s.id) && !off.has(s.id + d))
      .filter((s) => !/manual booking only/i.test(s.staff_private?.notes ?? ''))
      .map((s) => { const a = av.find((x) => x.staff_id === s.id); const u = usual(s.id, d); return { s, a, u }; })
      .filter(({ a, u }) => a?.status === 'yes' || a?.status === 'asked' || (!a && u?.status !== 'no') || (a && a.status !== 'no'))
      .sort((x, y) => byScore(x.s.id, y.s.id));
  };
  const aList = availFor(date);
  const tabList = aList.filter(({ a }) => (tab === 'yes' ? a?.status === 'yes' : tab === 'wait' ? a?.status === 'asked' : !a)).filter(({ s }) => !q || s.full_name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q.toLowerCase()));
  const counts = { yes: aList.filter(({ a }) => a?.status === 'yes').length, wait: aList.filter(({ a }) => a?.status === 'asked').length, not: aList.filter(({ a }) => !a).length };

  // ── auto-fill ──────────────────────────────────────────────────
  const runAuto = () => {
    const d = date; const c = cur(d); const evs = (events ?? []).filter((e) => e.event_date === d && evDept(e) === fillDept);
    const pl = c.pl.filter((p) => !p.suggested); const booked = new Set(pl.map((p) => p.staff_id));
    const big = isBig(d);
    const skipped: { name: string; why: string }[] = []; const out: Pl[] = [];
    const pool = aList.filter(({ a }) => a?.status === 'yes').map(({ s, a }) => ({ s, from: a?.from_time ?? null })).filter(({ s }) => !c.locks.includes(s.id) && !pl.some((p) => p.staff_id === s.id && isLocked(d, p))).sort((x, y) => byScore(x.s.id, y.s.id)); // push 50 · locked people never move
    const late: typeof pool = [];
    /** '' = fits. Skips misfits (venue, private houses only, weekday, old min guests) and never puts "keep apart" people together. */
    const ok = (sid: string, e: AEvent) => {
      const m = misfits(sid, e, { conds, clients, venues, big }).filter((x) => x.kind !== 'only_if_needed' && x.kind !== 'big_dates_only');
      if (m.length) return m[0].text;
      const ap = apartOf(sid).find((x) => [...pl, ...out].some((p) => p.event_id === e.id && p.staff_id === x));
      if (ap) return `kept apart from ${name(ap).split(' ')[0]}`;
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
        out.push({ key: uid(), staff_id: s.id, event_id: sl.e.id, start: sl.start, code: fillDept === 'bar' ? 'BT' : 'W', suggested: true }); booked.add(s.id);
        for (const pid of partnerOf(s.id)) { const pp = pool.find((x) => x.s.id === pid); if (pp && !booked.has(pid) && !ok(pid, sl.e)) { const again = slots().find((x) => x.e.id === sl.e.id); if (again) { out.push({ key: uid(), staff_id: pid, event_id: sl.e.id, start: again.start, code: fillDept === 'bar' ? 'BT' : 'W', suggested: true }); booked.add(pid); } } }
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
  const lockAll = async () => {
    const c = cur(date); const pl = c.pl.filter((p) => !p.suggested);
    const unsaved = pl.filter((p) => !p.shift_id).map((p) => p.staff_id);
    if (unsaved.length) setCur(date, { ...c, locks: [...new Set([...c.locks, ...unsaved])] });
    const saved = pl.filter((p) => p.shift_id && !locks.ids.has(p.shift_id));
    if (saved.length && !locks.ready) { setHint('The padlock needs migration 055.'); return; }
    try { for (const p of saved) await lockShift(p.shift_id!, true); } catch (e) { setHint((e as Error).message); }
  };
  const nLocked = (d: string) => plOf(d).filter((p) => isLocked(d, p)).length;

  // ── board pieces ───────────────────────────────────────────────
  const dayEvs = (d: string) => (events ?? []).filter((e) => e.event_date === d && (dept === 'both' || evDept(e) === dept)).sort((a, b) => (isBarEv(a) ? 1 : 0) - (isBarEv(b) ? 1 : 0));
  /** Ronnie, Nov 4 · automatic extras: when more people are booked than the client count, the extra ones go in the Extras box:
   *  people who finish early first, then the lowest ranked. Never MDs, never padlocked people, never someone you dragged onto a line. */
  const clientOf = (e: AEvent) => { const lines = (e.staffing ?? []).reduce((n, l) => n + (l.count || 0), 0); return e.staff_needed > 0 ? e.staff_needed : lines; };
  const autoX = (d: string, e: AEvent, from?: Pl[]): Set<string> => {
    const pl = (from ?? plOf(d)).filter((p) => p.event_id === e.id && !p.suggested); const client = clientOf(e);
    const over = client ? pl.length - client - pl.filter((p) => p.extra).length : 0; if (over <= 0) return new Set();
    const early = (p: Pl) => { const sh = p.shift_id ? evById[e.id]?.shifts.find((y) => y.id === p.shift_id) : undefined; return sh?.leave_by || sh?.left_early ? 0 : 1; };
    const cand = pl.filter((p) => !p.extra && !p.keep && !['MD', 'BM'].includes(p.code) && !isLocked(d, p))
      .sort((a, b) => early(a) - early(b) || (scores[a.staff_id] ?? -1e9) - (scores[b.staff_id] ?? -1e9) || rank(b.staff_id) - rank(a.staff_id));
    return new Set(cand.slice(0, over).map((p) => p.key));
  };
  const isX = (d: string, e: AEvent, p: Pl) => !!p.extra || autoX(d, e).has(p.key);
  const groupsOf = (d: string, e: AEvent) => {
    const lines = (e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code));
    const ax = autoX(d, e);
    const pl = plOf(d).filter((p) => p.event_id === e.id && !['MD', 'BM'].includes(p.code) && !ax.has(p.key));
    const gOf = (p: Pl) => p.line ?? p.start;
    const starts = [...new Set([...lines.map((l) => l.start), ...pl.map(gOf)])].sort((a, b) => toMin(a) - toMin(b));
    return starts.map((st) => { const ls = lines.filter((l) => l.start === st); return { start: st, end: ls.find((l) => l.end)?.end ?? null, need: ls.reduce((n, l) => n + l.count, 0), people: pl.filter((p) => gOf(p) === st && !p.extra).sort((a, b) => rank(a.staff_id) - rank(b.staff_id)), isNew: !ls.length }; });
  };
  const extrasOf = (d: string, e: AEvent) => cur(d).extras[e.id] ?? e.extras ?? defaultExtras(e);
  const setExtras = (d: string, e: AEvent, n: number) => { const c = cur(d); setCur(d, { ...c, extras: { ...c.extras, [e.id]: Math.max(0, n) } }); };
  /** Nov 4 · the event title exactly as staff see it in their app (venue name, else the title). */
  const seeTitle = (e: AEvent | undefined) => (e ? venues.find((v) => v.id === e.venue_id)?.name ?? e.title : '');
  const isLead = (p: Pl) => p.code === 'MD' || p.code === 'BM';
  const shiftOf = (p: Pl) => (p.shift_id ? evById[p.event_id]?.shifts.find((y) => y.id === p.shift_id) : undefined);
  /** Nov 4 · round dot: ok = confirmed · late = not confirmed 24 h+ after the confirmation went out · wait = everything else. */
  const confOf = (p: Pl): 'ok' | 'wait' | 'late' => { const sh = p.suggested ? undefined : shiftOf(p); if (!sh) return 'wait';
    if (sh.status === 'confirmed') return 'ok'; return sh.notified_at && Date.now() - new Date(sh.notified_at).getTime() > 864e5 ? 'late' : 'wait'; };
  /** Nov 4 · column numbers: client count (MDs and extras not counted), extras, team strength, confirmed. */
  const statsOf = (d: string, e: AEvent) => {
    const pl = plOf(d).filter((p) => p.event_id === e.id); const leads = pl.filter((p) => isLead(p) && !p.suggested);
    const leadLines = (e.staffing ?? []).filter((l) => ['MD', 'BM'].includes(l.code));
    const leadSlots = leadLines.reduce((n, l) => n + l.count, 0) || (leads.length ? 1 : 0);
    const lineSum = (e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code)).reduce((n, l) => n + l.count, 0);
    // Nov 4 · client count = staff count minus MDs; no count on the event (old imports) → the staffing lines, else unknown (0 = "count not set")
    // Ronnie, Nov 4 · the total on top includes the MDs (what the client pays for)
    const client = e.staff_needed > 0 ? Math.max(e.staff_needed, leads.length) : lineSum + Math.max(leadSlots, leads.length);
    const crew = pl.filter((p) => !isLead(p) && !p.extra && !p.suggested);
    const flagged = pl.filter((p) => p.extra && !p.suggested).length;
    const sc = crew.map((p) => forms[p.staff_id]).filter((x): x is number => typeof x === 'number' && isFinite(x));
    const strength = sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) : null;
    const all = [...crew, ...leads];
    const confirmed = all.filter((p) => confOf(p) === 'ok').length;
    // Ronnie, Nov 4 · anyone booked beyond the client count is an extra (Le 9e: 21 booked on 19 = 19 + 2 extras)
    const over = client ? Math.max(0, all.length - client) : 0; const extrasPlaced = flagged + over;
    return { pl, leads, leadSlots, leadStart: leadLines[0]?.start ?? leads[0]?.start ?? (e.start_time ?? '17:00').slice(0, 5), client, placed: client ? Math.min(all.length, client) : all.length, booked: all.length, extrasPlaced, extras: extrasOf(d, e), strength, confirmed };
  };
  const onDrop = (d: string, to: { event_id: string; start: string; extra?: boolean; lead?: 'MD' | 'BM' }) => {
    const g = dragRef.current; setDrag(null); if (!g) return;
    if (g.add) { place(d, g.staff_id, to, undefined, false, true); return; }
    const p = g.key ? cur(d).pl.find((x) => x.key === g.key) : undefined;
    if (p && !p.suggested && p.event_id !== to.event_id) { // push 49 · placed chip → another event: ask
      if (onEvent(d, p.staff_id, to.event_id, p.key)) { setHint(`${name(p.staff_id).split(' ')[0]} is already on ${evById[to.event_id]?.title ?? 'that event'}`); return; }
      setDropAsk({ p, to }); return;
    }
    place(d, g.staff_id, to, g.key);
  };
  const dropAvail = (d: string) => { const g = dragRef.current; setDrag(null); if (g?.key) remove(d, g.key); };
  /** push 46 · the person's other placements that day (another event) → gold info note on the chip, never blocks. */
  const othersOf = (d: string, p: Pl): OtherShift[] => plOf(d).filter((x) => x.staff_id === p.staff_id && x.event_id !== p.event_id && !x.suggested).map((x) => {
    const e = evById[x.event_id]; const sh = x.shift_id ? e?.shifts.find((y) => y.id === x.shift_id) : undefined;
    return { venue: e?.title ?? '?', start: startIso(d, x.start), end: sh?.planned_end ?? (e?.end_time ? endIso(d, x.start, e.end_time.slice(0, 5)) : null) };
  });
  /** push 49 · planned end (HH:MM) of a placement: the shift's own end, else its time group's end, else the event end. */
  const endHm = (p: Pl): string | null => {
    const e = evById[p.event_id]; const sh = p.shift_id ? e?.shifts.find((y) => y.id === p.shift_id) : undefined;
    if (sh?.planned_end) return hm(sh.planned_end);
    return (e?.staffing ?? []).find((l) => l.start === p.start && l.end)?.end ?? e?.end_time?.slice(0, 5) ?? null;
  };
  const span12 = (p: Pl) => { const en = endHm(p); return en ? `${t12(p.start)} – ${t12(en)}` : t12(p.start); };
  /** push 49 · the person's real placements that day, earliest first ("1 OF 2" / "2 OF 2"). */
  const dayOf = (d: string, sid: string) => plOf(d).filter((x) => x.staff_id === sid && !x.suggested).sort((a, b) => toMin(a.start) - toMin(b.start) || a.key.localeCompare(b.key));
  const pron = (sid: string) => (byId[sid]?.sex === 'f' ? 'her' : byId[sid]?.sex === 'm' ? 'him' : 'them');
  /** Ronnie, Nov 4 · tap the dot = confirmed / not confirmed (no question, nothing sent). Updates the dot right away. */
  const toggleConf = async (p: Pl) => {
    const sh = shiftOf(p); if (!sh) return; const on = sh.status !== 'confirmed';
    sh.status = on ? 'confirmed' : 'booked'; setHint(`${on ? '✓ ' : ''}${name(p.staff_id).split(' ')[0]} ${on ? 'confirmed' : 'back to waiting'}`);
    const { error } = await supabase.rpc('admin_mark_confirmed', { p_shift: p.shift_id, p_on: on });
    if (error) { sh.status = on ? 'booked' : 'confirmed'; setHint(error.message); }
    await load();
  };
  const confirmAll = async (d: string, e: AEvent) => {
    const ids = plOf(d).filter((p) => p.event_id === e.id && !p.suggested && p.shift_id && shiftOf(p)?.status !== 'confirmed').map((p) => p.shift_id!);
    if (!ids.length) return;
    for (const id of ids) { const { error } = await supabase.rpc('admin_mark_confirmed', { p_shift: id, p_on: true }); if (error) { setHint(error.message); break; } }
    setUndoConf({ ids, title: seeTitle(e) }); setTimeout(() => setUndoConf((u) => (u && u.ids === ids ? null : u)), 10000);
    await load();
  };
  const undoConfirmAll = async () => {
    const u = undoConf; if (!u) return; setUndoConf(null);
    for (const id of u.ids) await supabase.rpc('admin_mark_confirmed', { p_shift: id, p_on: false });
    setHint(`${u.title} · back to waiting`); await load();
  };
  const Chip = ({ p, n, d }: { p: Pl; n?: number; d: string }) => {
    const also = othersOf(d, p); const mine = p.suggested ? [] : dayOf(d, p.staff_id); const nth = mine.findIndex((x) => x.key === p.key) + 1;
    const locked = isLocked(d, p); const t = tier(p.staff_id); const part = partnerOf(p.staff_id).find((x) => plOf(d).some((q2) => q2.staff_id === x));
    const cf = confOf(p);
    return (
      <div data-key={p.key} className={'bk-chip rk' + (t ?? 'x') + (flash === p.key ? ' flash' : '') + (p.suggested ? ' sug' : '') + (!p.shift_id && !p.suggested ? ' added' : '') + (also.length ? ' has-also' : '')} draggable onDragStart={(ev) => dragStart(ev, { staff_id: p.staff_id, key: p.key })} onDragEnd={() => setDrag(null)} onClick={() => setPhone({ sid: p.staff_id, p, step: 'menu' })}>
        {n != null && <span className="bk-n">{n}</span>}<i className={'bk-cf ' + cf + (p.shift_id && !p.suggested ? ' tap' : '')} title={!p.shift_id || p.suggested ? 'Not saved yet' : cf === 'ok' ? 'Confirmed · tap to undo' : 'Tap to mark confirmed'}
          onClick={(ev) => { if (!p.shift_id || p.suggested) return; ev.stopPropagation(); toggleConf(p); }}>{cf === 'ok' ? '✓' : ''}</i>
        <span className="grow">{name(p.staff_id)}{part && <small> 🔗 {name(part).split(' ')[0]}</small>}{p.extra && <small className="bk-x"> EXTRA</small>}{rems[p.staff_id]?.length ? <small className="bk-pin" title={rems[p.staff_id].map((r) => r.note).join(' · ')}> 📌</small> : null}{p.line && p.line !== p.start && <small className="bk-own" title="Their own start time"> starts {t12(p.start)}</small>}
          {(() => { const sh = shiftOf(p); const nt = p.shift_id ? mNotes[p.shift_id] : undefined; if (p.suggested || !sh) return null;
            if (sh.leave_by) return <small className="bk-leave" title={nt ? `Has to leave by ${t12(hm(sh.leave_by))} · ${nt}` : `Has to leave by ${t12(hm(sh.leave_by))} · managers see it`}> ⏱ {t12(hm(sh.leave_by)).replace(':00', '')}</small>;
            return nt ? <small className="bk-mnote" title={nt}> ✎ note</small> : null; })()}
          {p.shift_id && asksBy[p.shift_id] && <small className="bk-asks" title="Waiting for your answer (Today → Needs you)">{asksBy[p.shift_id].kind === 'later' ? 'asks' : 'leaves'} {t12(hm(asksBy[p.shift_id].new_time))}</small>}</span>
        {isLead(p) && <b className="bk-lead">{p.code}</b>}
        {mine.length > 1 && nth > 0 && <span className="bk-of" title="Two shifts this day">{nth} OF {mine.length}</span>}
        {p.suggested ? <span className="bk-sug">suggested</span> : <>
          <button className={'bk-lock' + (locked ? ' on' : '')} title={lockTitle(locked, !!p.shift_id && locks.byDefault.has(p.shift_id))} aria-label={locked ? `Unlock ${name(p.staff_id)}` : `Lock ${name(p.staff_id)}`} aria-pressed={locked} onClick={(ev) => { ev.stopPropagation(); toggleLock(d, p); }}>{locked ? '🔒' : '🔓'}</button>
          <button className="bk-del" aria-label="Remove" onClick={(ev) => { ev.stopPropagation(); remove(d, p.key); }}>×</button></>}
        {also.length > 0 && <BoardAlso others={also} start={startIso(d, p.start)} />}
      </div>
    );
  };

  const Column = ({ e, d }: { e: AEvent; d: string }) => {
    const groups = groupsOf(d, e); const st = statsOf(d, e); const { pl, leads, leadSlots, client, placed, extras } = st;
    // Nov 4 · balance note: 2+ events that day and this team is more than 5 below the strongest
    // Nov 5 · in Both, floor teams compare with floor teams and bar with bar
    const same = dayEvs(d).filter((x) => isBarEv(x) === isBarEv(e));
    const day = same.length > 1 ? same.map((x) => ({ e: x, s: statsOf(d, x).strength })).filter((x) => x.s != null) : [];
    const top = day.reduce<{ e: AEvent; s: number | null } | null>((b, x) => (!b || (x.s ?? 0) > (b.s ?? 0) ? x : b), null);
    const diff = top && top.e.id !== e.id && st.strength != null ? (top.s ?? 0) - st.strength : 0;
    const leadLabel = isBarEv(e) ? 'Bar manager' : 'MDs'; const leadCode = isBarEv(e) ? 'BM' : 'MD';
    return (
      <div data-ev={e.id} className={'bk-col' + (focusEv === e.id ? ' focus' : '') + (dept === 'both' && isBarEv(e) ? ' bar-col' : '') + (e.tentative ? ' tbc-col' : '')} onDragOver={(ev) => ev.preventDefault()} onDrop={() => onDrop(d, { event_id: e.id, start: groups.find((g) => g.need > g.people.length)?.start ?? groups[0]?.start ?? (e.start_time ?? '17:00').slice(0, 5) })}>
        <div className="bk-colh">
          <div className="bk-see">{dept === 'both' && <i className={'bk-dtag' + (isBarEv(e) ? ' is-bar' : '')}>{isBarEv(e) ? 'BAR' : 'FLOOR'}</i>}AS STAFF SEE IT</div>
          <Link to={`/admin/event/${e.id}`} className="serif bk-title">{e.tentative ? '⏳ ' : ''}{seeTitle(e)}</Link>
          <div className="muted sm">{[e.event_private?.client, e.event_type, e.guests ? `${e.guests} guests` : null].filter(Boolean).join(' · ')}</div>
          <div className="bk-cc">
            <span className="bk-ccn">{client > 0 ? <><b>{placed} / {client}</b> <span className="muted sm">client count</span></> : <><b>{placed}</b> <Link to={`/admin/event/${e.id}/edit`} className="gold sm strong">client count not set ›</Link></>}</span>
            <span className="bk-xs">+ {st.extrasPlaced} / <span className="bk-step" onClick={(ev) => ev.stopPropagation()}>
              <button type="button" aria-label="One less extra" disabled={extras <= 0} onClick={() => setExtras(d, e, extras - 1)}>−</button><b>{extras}</b>
              <button type="button" aria-label="One more extra" onClick={() => setExtras(d, e, extras + 1)}>+</button></span> extras</span>
          </div>
          <div className="bk-bar"><i style={{ width: `${Math.min(100, (placed / Math.max(1, client)) * 100)}%` }} className={placed < client ? 'short' : ''} /></div>
          {(st.strength != null || placed > 0) && <div className="bk-ts">{st.strength != null ? <span>Team strength <b>{st.strength}</b></span> : <span />}{placed > 0 && <span className="bk-tsr"><span className="okc">{st.confirmed} of {st.booked} confirmed</span>{st.confirmed < pl.filter((p) => !p.suggested && p.shift_id).length && <button type="button" className="bk-call" onClick={() => confirmAll(d, e)}>✓ Confirm all</button>}</span>}</div>}
          {diff > 5 && top && <div className="bk-bal">{diff} below {seeTitle(top.e)} today · worth balancing</div>}
        </div>
        {(leadSlots > 0 || leads.length > 0) && (
          <div className="bk-mds" onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.stopPropagation(); onDrop(d, { event_id: e.id, start: st.leadStart, lead: leadCode }); }}>
            <div className="bk-gh"><b className="bk-mdh">{leadLabel} · {t12(st.leadStart)}</b><span className="muted sm">{leads.length} / {leadSlots}</span></div>
            {leads.map((p) => <Chip key={p.key} p={p} d={d} />)}
            {Array.from({ length: Math.max(0, leadSlots - leads.length) }, (_, i) => <div key={i} className="bk-open bk-mdopen">{leadCode} not set · drop here</div>)}
          </div>
        )}
        {groups.map((g) => (
          <div key={g.start} className="bk-grp" onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.stopPropagation(); onDrop(d, { event_id: e.id, start: g.start }); }}>
            <div className="bk-gh"><span className="bk-time">{t12(g.start)}{g.end && <em> ~ {t12(g.end)}</em>}</span>{g.isNew && <span className="bk-new">NEW TIME</span>}<span className="muted sm">{g.people.length} / {g.need}</span></div>
            {g.people.map((p, i) => <Chip key={p.key} p={p} n={i + 1} d={d} />)}
            {g.need > g.people.length && <div className="bk-open">{g.need - g.people.length} open · drop here</div>}
          </div>
        ))}
        {(extras > 0 || pl.some((p) => isX(d, e, p))) && (
          <div className="bk-grp extras" onDragOver={(ev) => ev.preventDefault()} onDrop={(ev) => { ev.stopPropagation(); onDrop(d, { event_id: e.id, start: groups[0]?.start ?? '17:00', extra: true }); }}>
            <div className="bk-gh"><span className="bk-time gold">Extras +{setting('extras.rule').pct}%</span><span className="muted sm">{pl.filter((p) => isX(d, e, p)).length} / {extras} · {(e.extras_billing ?? 'gr') === 'client' ? 'client pays' : 'on G&R'}</span></div>
            {pl.filter((p) => isX(d, e, p)).map((p) => <Chip key={p.key} p={p} d={d} />)}
            {extras > pl.filter((p) => isX(d, e, p)).length && <div className="bk-open">{extras - pl.filter((p) => isX(d, e, p)).length} extra · drop here</div>}
          </div>
        )}
      </div>
    );
  };

  /** push 49 · people already placed today (this dept's events) stay in the side list, at the bottom, with "+ 2nd shift". */
  const placedList = (() => { if (view !== 'board' || !events) return [];
    const ids = new Set(dayEvs(date).map((e) => e.id));
    const sids = [...new Set(plOf(date).filter((p) => !p.suggested && ids.has(p.event_id)).map((p) => p.staff_id))]
      .filter((sid) => !q || name(sid).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(q.toLowerCase()));
    return sids.sort(byScore).map((sid) => ({ sid, mine: dayOf(date, sid) })); })();
  // ── render ─────────────────────────────────────────────────────
  const strip = Array.from({ length: 7 }, (_, i) => addDays(date, i - ((new Date(date + 'T12:00:00').getDay() + 6) % 7)));
  // Nov 4 · week strip: every day of the week with its events (venue · booked/needed · +extras · ✓ / SEND / ○)
  const [weekEvs, setWeekEvs] = useState<AEvent[]>([]);
  // Nov 4 · the manager sees who the extras are (migration 061). Worked out from the real schedule, never from practice or unsaved changes.
  const xSent = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!events || !sd) return;
    for (const e of events) {
      const ax = autoX(e.event_date, e, base[e.event_date] ?? []); // the real schedule, never a practice board
      const ids = (base[e.event_date] ?? []).filter((p) => p.event_id === e.id && p.shift_id && ax.has(p.key)).map((p) => p.shift_id!).sort();
      const sig = ids.join(','); if (xSent.current[e.id] === sig) continue;
      xSent.current[e.id] = sig;
      supabase.rpc('admin_set_extras', { p_event: e.id, p_shifts: ids }).then(({ error }) => { if (error) delete xSent.current[e.id]; });
    }
  }, [events, base, sd, locks]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'board') eventsBetween(strip[0], strip[6]).then(setWeekEvs).catch(() => setWeekEvs([])); }, [strip[0], view, events]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nov 6 · while dragging a name, the page (and the column under it) scrolls near the top/bottom edge
  useEffect(() => {
    let raf = 0; let vy = 0; let el: HTMLElement | null = null;
    const step = () => { if (vy) { window.scrollBy(0, vy); if (el) el.scrollTop += vy; raf = requestAnimationFrame(step); } else raf = 0; };
    const over = (e: DragEvent) => {
      const edge = 90; const h = window.innerHeight; const y = e.clientY;
      vy = y < edge ? -Math.ceil((edge - y) / 6) : y > h - edge ? Math.ceil((y - (h - edge)) / 6) : 0;
      let n = e.target as HTMLElement | null; el = null;
      while (n && n !== document.body) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight) { el = n; break; } n = n.parentElement; }
      if (vy && !raf) raf = requestAnimationFrame(step);
    };
    const stop = () => { vy = 0; };
    document.addEventListener('dragover', over); document.addEventListener('dragend', stop); document.addEventListener('drop', stop);
    return () => { document.removeEventListener('dragover', over); document.removeEventListener('dragend', stop); document.removeEventListener('drop', stop); cancelAnimationFrame(raf); };
  }, []);
  const focusEv = params.get('ev');
  useEffect(() => { if (!focusEv || !events) return; const t = setTimeout(() => document.querySelector(`[data-ev="${CSS.escape(focusEv)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }), 300); return () => clearTimeout(t); }, [focusEv, events]);
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
          <div className="seg3">{(['floor', 'bar', 'both'] as const).map((v) => <button key={v} className={dept === v ? 'on' : ''} onClick={() => setP('dept', v)}>{v === 'floor' ? 'Floor' : v === 'bar' ? 'Bar' : 'Both'}</button>)}</div>
          {view === 'sheet' && <div className="seg3">{[7, 14, 31].map((n) => <button key={n} className={span === n ? 'on' : ''} onClick={() => setP('span', String(n))}>{n === 31 ? 'Month' : `${n} days`}</button>)}</div>}
          {view === 'board' && <button className="abtn" onClick={() => (auto?.open ? setAuto(null) : setAuto({ open: false, skipped: [] }))}>Auto-fill</button>}
          <button className="abtn" onClick={() => setAskMore(true)}>Ask more people</button>
          {dept === 'both' && <div className="seg3 bk-onedept" title="Auto-fill and Ask more work on this team">{(['floor', 'bar'] as const).map((v) => <button key={v} className={oneDept === v ? 'on' : ''} onClick={() => setOneDept(v)}>for {v}</button>)}</div>}
          <Link className="abtn dark" to={`/admin/event/new?d=${date}`}>+ New event</Link>
        </div>
      </div>

      {replaceOf && <div className="bk-rep"><b>Replacing {replaceOf.staff?.full_name ?? '?'}</b><span>{replaceOf.title} · {t12(replaceAt ?? hm(replaceOf.planned_start))}{replaceOf.cancel_reason ? ` · ${replaceOf.cancel_reason.toLowerCase()}` : ''} · the next person you add to {replaceOf.title} is saved as the replacement (blue tag on the manager’s list){mode === 'practice' ? ' · switch to Live to save it' : ''}.</span>
        <button className="lnk" aria-label="Stop replacing" onClick={() => { const p = new URLSearchParams(params); ['replace', 'at', 'ask', 'spots'].forEach((k) => p.delete(k)); setParams(p, { replace: true }); }}>×</button></div>}
      <div className="bk-strip">
        <button className="round" onClick={() => setP('date', addDays(date, -7))}>‹</button>
        {view === 'board' ? strip.map((d) => {
          const evs = weekEvs.filter((e) => e.event_date === d && (dept === 'both' || evDept(e) === dept)); const short = evs.reduce((n, e) => n + countOf(e).short, 0); const today0 = isoDay(new Date());
          const go = (evId?: string) => { const p = new URLSearchParams(params); p.set('date', d); if (evId) p.set('ev', evId); else p.delete('ev'); setParams(p, { replace: true }); };
          return (
          <div key={d} role="button" tabIndex={0} className={'bk-wd' + (d === date ? ' on' : '') + (d === today0 ? ' today' : '')} onClick={() => go()} onKeyDown={(k) => { if (k.key === 'Enter') go(); }}>
            <div className="bk-wdh"><small>{dLabel(d, { weekday: 'short' })}</small><b>{new Date(d + 'T12:00:00').getDate()}</b>{d === today0 && <em>TODAY</em>}<span className="grow" />{short > 0 && <span className="bk-wds">{short} short</span>}</div>
            {!evs.length && <span className="bk-wdn">no events</span>}
            {evs.slice(0, 3).map((e) => { const c = countOf(e); const st = sendStateOf(e, today0); return (
              <button key={e.id} type="button" className={'bk-wl' + (e.department === 'bar' ? ' is-bar' : '')} onClick={(ev) => { ev.stopPropagation(); go(e.id); }}>
                <span className="bk-wlt">{seeTitle(e)}</span><b className={c.need && c.short ? 'sh' : 'ok'}>{c.need ? `${c.booked}/${c.need}` : c.n}</b>{c.extra > 0 && <i>+{c.extra}</i>}
                {st === 'sent' ? <span className="bk-wok">✓</span> : st === 'ready' && d >= today0 ? <span className="bk-wsend" role="button" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); setSendOf(sendOf === e.id ? null : e.id); }}>SEND</span> : st === 'later' ? <span className="bk-wlater">○</span> : null}
              </button>); })}
            {evs.length > 3 && <span className="bk-wmore">+{evs.length - 3} more</span>}
          </div>); })
          : <span className="grow muted sm" style={{ textAlign: 'center' }}>{dLabel(range.from)} – {dLabel(range.to)}</span>}
        <button className="round" onClick={() => setP('date', addDays(date, 7))}>›</button>
      </div>

      {sendOf && (() => {
        const e = weekEvs.find((x) => x.id === sendOf); if (!e) return null;
        const list = e.shifts.filter((x) => liveShift(x) && !x.attendance && needsSend(x));
        const told = list.filter((x) => x.status === 'confirmed');
        const why = (x: typeof list[number]) => (x.status !== 'confirmed' ? (x.notified_at ? 'changed after it was sent' : 'not sent yet') : x.notified_at ? 'changed after it was sent' : 'changed after they confirmed');
        const mark = async (ids: string[]) => { if (!ids.length) return; setSendBusy(true); const { error } = await supabase.from('shifts').update({ notified_at: new Date().toISOString() }).in('id', ids); setSendBusy(false); if (error) { setHint(error.message); return; } setSendOf(null); await load(); };
        return (
          <div className="bk-sendm">
            <div className="bk-sendm-h"><b>{seeTitle(e)} · {dLabel(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' })}</b><button className="lnk" aria-label="Close" onClick={() => setSendOf(null)}>×</button></div>
            {list.length ? <ul>{list.map((x) => <li key={x.id}><b>{x.staff?.full_name ?? '?'}</b><small>{why(x)}</small></li>)}</ul> : <small className="muted">Nothing to send.</small>}
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="abtn dark" disabled={sendBusy || !list.length} onClick={() => mark(list.map((x) => x.id))}>Send to {list.length}</button>
              {told.length > 0 && <button className="abtn" disabled={sendBusy} onClick={() => mark(told.map((x) => x.id))}>Already told them{told.length < list.length ? ` · ${told.length}` : ''}</button>}
            </div>
            <small className="muted">Already told them clears SEND for people who confirmed with you, without sending anything.{told.length < list.length ? ' People still to confirm need the real send.' : ''}</small>
          </div>);
      })()}
      {hint && <div className="bk-hint" onClick={() => setHint('')}>{hint} ×</div>}
      {undoConf && <div className="bk-undo"><span>✓ {undoConf.ids.length} confirmed · {undoConf.title}</span><button type="button" onClick={undoConfirmAll}>Undo</button></div>}
      {warns.length > 0 && <div className="bk-warns">{warns.map((w) => <div key={w.key} className={'bk-warn ' + w.cls}><span className="grow">{w.text}</span><button className="lnk" aria-label="Dismiss" onClick={() => setWarns(warns.filter((x) => x.key !== w.key))}>×</button></div>)}<small className="muted">Warnings never block you; you can still book.</small></div>}
      {msg && <div className="bk-msg">{msg}</div>}

      {auto && !auto.open && view === 'board' && (
        <div className="adm-card bk-auto">
          <b>Auto-fill · {dLabel(date)}{dept === 'both' ? ` · ${fillDept}` : ''}</b>
          <span className="muted sm">{nLocked(date)} locked {nLocked(date) === 1 ? 'person never moves' : 'people never move'} · only fills empty spots · uses who said yes, their from time, rank, notes, linked pairs and conditions.</span>
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
        <div className={'bk-board' + (sideOpen ? '' : ' side-off')}>
          {!sideOpen ? (
            <button type="button" className="bk-sidestrip" aria-label="Show the staff list" onClick={() => setSideOpen(true)} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropAvail(date)}>
              <span>›</span><b>STAFF · {counts.yes} said yes</b>
            </button>
          ) : (
          <aside className="bk-avail" onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropAvail(date)}>
            <div className="bk-sidehead"><button type="button" className="bk-sidefold" aria-label="Hide the staff list" onClick={() => setSideOpen(false)}>‹ Hide</button></div>
            {dept === 'both' && <div className="bk-sidedept">{(['all', 'floor', 'bar'] as const).map((v) => <button key={v} type="button" className={sideDept === v ? 'on' : ''} onClick={() => setSideDept(v)}>{v === 'all' ? 'All' : v === 'floor' ? 'Floor' : 'Bar'}</button>)}</div>}
            <div className="bk-tabs">{([['yes', 'Said yes'], ['wait', 'No reply'], ['not', 'Not asked']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} {counts[k]}</button>)}</div>
            <input className="bk-search" placeholder="Search staff…" value={q} onChange={(e) => setQ(e.target.value)} />
            {(['A', 'B', 'C', null] as const).map((t) => { const list = tabList.filter(({ s }) => (s.staff_private?.tier ?? null) === t); if (!list.length) return null; return (
              <div key={t ?? 'x'} className="bk-tier"><div className="kick">{t ? `TIER ${t}` : 'UNRANKED'} · {list.length}</div>
                {list.map(({ s, a, u }) => { const part = partnerOf(s.id); const c = condsOf(s.id); return (
                  <div key={s.id} className={'bk-av' + (dept === 'both' && s.department === 'bar' ? ' bar-p' : '')} draggable onDragStart={(ev) => dragStart(ev, { staff_id: s.id })} onDragEnd={() => setDrag(null)}>
                    <i className={'bk-t t' + (t ?? 'x')} />
                    <div className="grow"><b>{s.full_name}<RuleIcons sid={s.id} links={rl} conds={conds} /></b>
                      <small>{a?.status === 'yes' ? (a.from_time ? `from ${t12(a.from_time)}` : 'any time') : a?.status === 'asked' ? 'asked · no reply' : u?.status === 'yes' ? `usual week · ${u.from_time ? 'from ' + t12(u.from_time) : 'any time'}` : 'not asked'}
                        {part.length > 0 && ` · 🔗 ${part.map((x) => name(x).split(' ')[0]).join(', ')}`}{c.length > 0 && ` · ${c.map(condShort).join(', ')}`}{apartOf(s.id).length > 0 && ` · ⊘ ${apartOf(s.id).map((x) => name(x).split(' ')[0]).join(', ')}`}</small>
                      {a?.note && <i className="av-note-adm">“{a.note}”</i>}</div>
                  </div>); })}
              </div>); })}
            {tab === 'yes' && !counts.yes && <div className="muted sm" style={{ padding: 10 }}>Nobody said yes yet for this date.</div>}
            {placedList.length > 0 && (
              <div className="bk-tier bk-placed"><button type="button" className="kick bk-fold" aria-expanded={placedOpen} onClick={() => { const v = !placedOpen; setPlacedOpen(v); try { localStorage.setItem('gr_bk_placed', v ? '1' : '0'); } catch { /* private mode */ } }}><span className="grow">ALREADY PLACED TODAY · {placedList.length}</span><span>{placedOpen ? '▾' : '▸'}</span></button>
                {placedOpen && placedList.map(({ sid, mine }) => (
                  <div key={sid} className="bk-av" draggable={mine.length < 2} onDragStart={(ev) => dragStart(ev, { staff_id: sid, add: true })} onDragEnd={() => setDrag(null)} title={mine.length < 2 ? 'Drag onto another event = a 2nd shift that day' : undefined}>
                    <i className={'bk-t t' + (tier(sid) ?? 'x')} />
                    <div className="grow"><b>{name(sid)}</b><small>{mine.length > 1 ? mine.map((x) => evById[x.event_id]?.title ?? '?').join(' + ') : `${evById[mine[0].event_id]?.title ?? '?'} ${span12(mine[0])}`}</small></div>
                    {mine.length > 1 ? <span className="muted sm bk-2n">{mine.length} shifts</span> : <button className="bk-2nd" onClick={() => setPhone({ sid, step: 'add' })}>+ 2nd shift</button>}
                  </div>))}
              </div>)}
            <button className="link-btn" style={{ margin: 10 }} onClick={() => setAskMore(true)}>Ask more people for {dLabel(date, { month: 'short', day: 'numeric' })} ›</button>
          </aside>
          )}
          <div className="bk-main">
            {(() => { const q = findQ.trim().toLowerCase(); const day = plOf(date).filter((p) => !p.suggested);
              const hits = q.length < 2 ? [] : staff.filter((x) => (x.full_name + ' ' + (x.nickname ?? '')).toLowerCase().includes(q)).slice(0, 8)
                .map((x) => ({ x, on: day.filter((p) => p.staff_id === x.id) }));
              const show = (key: string) => { const el = document.querySelector(`[data-key="${CSS.escape(key)}"]`); el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }); setFlash(key); setTimeout(() => setFlash((f) => (f === key ? '' : f)), 3000); };
              return (
              <div className="bk-find">
                <div className="bk-findin"><span aria-hidden="true">🔍</span><input placeholder="Find someone on the board…" value={findQ} onChange={(ev) => setFindQ(ev.target.value)} />{findQ && <button type="button" aria-label="Clear" onClick={() => setFindQ('')}>✕</button>}</div>
                {hits.length > 0 && <div className="bk-hits">{hits.map(({ x, on }) => on.length ? on.map((p) => { const cf = confOf(p); return (
                  <button key={p.key} type="button" className="bk-hit" onClick={() => show(p.key)}><span className="grow"><b>{x.full_name}</b><small>{seeTitle(evById[p.event_id])} · {t12(p.start)} · {cf === 'ok' ? '✓ confirmed' : 'waiting'}</small></span><b className="sm">Show ›</b></button>); })
                  : <div key={x.id} className="bk-hit"><span className="grow"><b>{x.full_name}</b><small>Not placed today</small></span><button type="button" className="abtn sm" onClick={() => { setPhone({ sid: x.id, step: 'add' }); }}>+ Add</button></div>)}</div>}
                {q.length >= 2 && !hits.length && <div className="muted sm">No one called “{findQ.trim()}”.</div>}
              </div>); })()}
            {dayEvs(date).length > 1 && (() => { const rows = dayEvs(date).map((e) => ({ e, s: statsOf(date, e) }));
              const max = Math.max(0, ...rows.map((r) => r.s.strength ?? 0)); const sum = (k: 'placed' | 'client' | 'extrasPlaced' | 'extras' | 'confirmed') => rows.reduce((n, r) => n + r.s[k], 0);
              return (
              <div className="bk-balc">
                <div className="bk-balh"><b>Today’s balance</b><span className="muted sm">{sum('placed')}/{sum('client')} · +{sum('extrasPlaced')}/{sum('extras')} extras · {sum('confirmed')} ✓</span></div>
                <div className="muted sm">Average ranking score of each team (MDs not counted)</div>
                {rows.map(({ e, s }) => (
                  <div key={e.id} className="bk-balr">
                    <div className="bk-balt"><b>{seeTitle(e)}{dept === 'both' && isBarEv(e) ? ' · bar' : ''}</b><b>{s.strength ?? '—'}</b></div>
                    <div className="bk-balbar"><i className={s.strength != null && max - s.strength > 5 ? 'gold' : ''} style={{ width: `${Math.max(0, Math.min(100, s.strength ?? 0))}%` }} /></div>
                  </div>))}
              </div>); })()}
            <div className="bk-cols">{dayEvs(date).length ? dayEvs(date).map((e, i, all) => <Fragment key={e.id}>{dept === 'both' && i > 0 && isBarEv(e) && !isBarEv(all[i - 1]) && <div className="bk-split" aria-hidden="true" />}<Column e={e} d={date} /></Fragment>) : <div className="adm-card muted">No {dept === 'both' ? '' : dept + ' '}events on this day. <Link to={`/admin/event/new?d=${date}`}>+ New event</Link></div>}</div>
          </div>
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
                    {defaultExtras(e) > 0 && <tr><td colSpan={3} className="gold sm"><b>{extrasOf(d, e)} Extras +{setting('extras.rule').pct}%</b> · {(e.extras_billing ?? 'gr') === 'client' ? 'client pays' : 'on G&R'}</td></tr>}
                  </tbody></table>
                </div>
              ))}
              <datalist id={`bk-dl-${d}`}>{staff.filter((s) => s.active && !bookedOn(d).has(s.id) && !off.has(s.id + d)).sort((a, b) => Number(av.some((x) => x.staff_id === b.id && x.status === 'yes')) - Number(av.some((x) => x.staff_id === a.id && x.status === 'yes')) || rank(a.id) - rank(b.id)).map((s) => <option key={s.id} value={s.full_name} />)}</datalist>
            </div>); })}
          {!dates.some((d) => dayEvs(d).length) && <div className="adm-card muted">No {dept === 'both' ? '' : dept + ' '}events in this range.</div>}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {dates.map((d) => dayEvs(d).map((e) => { const pl = plOf(d).filter((p) => p.event_id === e.id); const lead = pl.find((p) => ['MD', 'BM'].includes(p.code)); const need = e.staff_needed + extrasOf(d, e); return (
            <button key={e.id} className="adm-card bk-li" onClick={() => { setP('date', d); setP('view', 'board'); }}>
              <span className="bk-ld"><small>{dLabel(d, { weekday: 'short' })}</small><b>{new Date(d + 'T12:00:00').getDate()}</b></span>
              <span className="grow" style={{ textAlign: 'left' }}><b>{e.title}</b> <DeptTag dept={e.department} /><span className="muted sm"> · {e.event_private?.client ?? ''}</span><div className="muted sm">{lead ? `${lead.code} ${name(lead.staff_id)}` : 'MD not set'}</div></span>
              <span className={'tag ' + (pl.length >= need ? 'ok' : 'amber')}>{pl.length} / {need}</span>
            </button>); }))}
          {!dates.some((d) => dayEvs(d).length) && <div className="adm-card muted">No {dept === 'both' ? '' : dept + ' '}events in the next 14 days.</div>}
        </div>
      )}

      {nChanges > 0 && (
        <div className="bk-tray">
          <b>{nChanges} change{nChanges > 1 ? 's' : ''}</b>
          <span>{allChanges.reduce((n, c) => n + c.added.length, 0)} added · {allChanges.reduce((n, c) => n + c.moved.length + c.marked.length + c.reroled.length, 0)} moved · {allChanges.reduce((n, c) => n + c.removed.length, 0)} removed · {mode === 'practice' ? 'practice · nobody alerted' : 'nobody alerted yet'}</span>
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

      {prof && byId[prof] && <StaffProfile s={byId[prof]} all={staff} onClose={() => { setProf(null); allStaff().then(setStaff); }} onEdit={() => navB(`/admin/staff?open=${prof}`)} />}
      {phone && (() => { const { sid, p, step } = phone; const first = name(sid).split(' ')[0]; const close = () => setPhone(null);
        const groups = dayEvs(date).flatMap((e) => groupsOf(date, e).map((g) => ({ e, g })));
        const addable = groups.filter(({ e }) => !onEvent(date, sid, e.id));
        return (
        <div className="bk-modal" onClick={close}><div className="adm-card bk-menu" onClick={(e) => e.stopPropagation()}>
          {step === 'menu' && p ? (() => { const sh = p.suggested ? undefined : shiftOf(p); const on = sh?.status === 'confirmed';
            const ic = (d: string) => <svg className="bk-mi" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d.split('|').map((x, i) => (x.startsWith('c') ? <circle key={i} cx="12" cy="12" r="9" /> : <path key={i} d={x} />))}</svg>;
            return <>
            <div className="bk-mh">
              <div className="grow"><b className="bk-mname">{name(sid)}</b>
                <div className="muted sm">{seeTitle(evById[p.event_id])} · {t12(p.start)}{sh && <> · {on ? <span className="okc">✓ Confirmed</span> : <span className="gold">Not confirmed yet</span>}</>}</div></div>
              <button className="bk-mx" aria-label="Close" onClick={close}>✕</button>
            </div>
            {rems[sid]?.length ? <div className="bk-rem">{rems[sid].map((r) => <div key={r.id} className="bk-rem-i"><span>📌 <b>{first}</b>: {r.note}</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {sh ? <button className="abtn sm dark" onClick={() => { setRemTxt(friendly(r.note)); setPhone({ ...phone, step: 'rem', rid: r.id } as typeof phone); }}>Add to {first}’s confirmation</button> : <span className="muted sm">Save the booking first to add it to her confirmation</span>}
                <button className="abtn sm" onClick={async () => { await resolveReminder(r.id, 'told'); setRems(await openReminders()); setHint(`✓ Reminder cleared for ${first}`); }}>✓ Told {first}</button>
                <button className="lnk sm" onClick={close}>Keep for later</button></div></div>)}</div> : null}
            {sh && <button className={'bk-mconf' + (on ? ' undo' : '')} onClick={async () => { const { error } = await supabase.rpc('admin_mark_confirmed', { p_shift: p.shift_id, p_on: !on }); if (error) { setHint(error.message); return; } setHint(on ? `${first} back to waiting` : `✓ ${first} confirmed`); close(); await load(); }}>
              {on ? 'Undo confirmed' : '✓ Mark confirmed'}</button>}
            <div className="bk-mlist">
              {/* Nov 6 · one click instead of dragging down to EXTRAS (time stays) */}
              {!p.suggested && !['MD', 'BM'].includes(p.code) && (() => { const ev = evById[p.event_id]; const xNow = !!ev && isX(date, ev, p); return (
                <button className={'bk-mli' + (xNow ? '' : ' bk-mx-on')} onClick={() => { const c = cur(date); setCur(date, { ...c, pl: c.pl.map((q) => q.key === p.key ? (xNow ? { ...q, extra: false, keep: true } : { ...q, extra: true, keep: false }) : q) }); setHint(xNow ? `${first} is back on the line · Save to keep` : `${first} is an extra · stays at ${t12(p.start)} · Save to keep`); close(); }}>
                  <span className="bk-mi" aria-hidden="true" style={{ display: 'inline-flex', justifyContent: 'center' }}>⭐</span><span className="grow">{xNow ? 'Not an extra' : 'Make extra'}<small className="muted"> · {xNow ? 'back on the line' : `stays at ${t12(p.start)}`}</small></span></button>); })()}
              {!p.suggested && <button className="bk-mli" onClick={() => { setOwnT(p.start); setPhone({ ...phone, step: 'time' }); }}>{ic('c|M12 7v5l3 2')}<span className="grow">Change time</span><span className="bk-mch">›</span></button>}
              <button className="bk-mli" onClick={() => setPhone({ ...phone, step: 'move' })}>{ic('M5 12h14|M13 6l6 6-6 6')}<span className="grow">Move</span><span className="bk-mch">›</span></button>
              {!p.suggested && <button className="bk-mli" onClick={() => setPhone({ ...phone, step: 'add' })}>{ic('M12 5v14|M5 12h14')}<span className="grow">Add a 2nd shift</span><span className="bk-mch">›</span></button>}
              {sh && <button className="bk-mli" onClick={() => { setNLeave(sh.leave_by ? hm(sh.leave_by) : ''); { const sn = sNotes[sid]; const st0 = staff.find((x) => x.id === sid); const fresh = !!st0?.created_at && Date.now() - new Date(st0.created_at).getTime() < 45 * 864e5;
                setNText(mNotes[sh.id] ?? sn?.note ?? ''); setNScope(mNotes[sh.id] ? 'shift' : sn ? (sn.shifts ? 'first3' : 'always') : fresh ? 'first3' : 'shift'); } setPhone({ ...phone, step: 'note' }); }}>{ic('c|M12 7v5l3 2')}<span className="grow">Note for the manager{(sh.leave_by || mNotes[sh.id] || sNotes[sid]) && <small className="gold"> · {sh.leave_by ? `leaves ${t12(hm(sh.leave_by))}` : sNotes[sid] && !mNotes[sh.id] ? (sNotes[sid].shifts ? '📌 first 3 shifts' : '📌 every shift') : 'note set'}</small>}</span><span className="bk-mch">›</span></button>}
              <button className="bk-mli" onClick={() => { setProf(sid); close(); }}>{ic('c|M12 8v.01|M12 11v5')}<span className="grow">Profile · ranking · knows</span><span className="bk-mch">›</span></button>
              <Link className="bk-mli" to={`/admin/messages?staff=${sid}`} onClick={close}>{ic('M4 5h16v11H9l-5 4z')}<span className="grow">Message</span><span className="bk-mch">›</span></Link>
            </div>
            <button className="bk-mrm" onClick={() => { remove(date, p.key); close(); }}>Remove</button>
          </>; })() : step === 'time' && p ? (() => { const lineT = p.line ?? p.start; const okT = /^\d{2}:\d{2}$/.test(ownT);
            const bump = (m: number) => { const b = okT ? toMin(ownT) : toMin(p.start); const v = Math.max(0, Math.min(23 * 60 + 45, b + m)); setOwnT(`${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`); };
            const apply = (t: string) => { const c = cur(date); setCur(date, { ...c, pl: c.pl.map((x) => (x.key === p.key ? { ...x, start: t, line: t === lineT ? undefined : lineT } : x)) }); setHint(t === lineT ? `${first} back to ${t12(t)}` : `${first} starts ${t12(t)} · Save to keep it`); close(); };
            return <>
            <div><b>{first}’s start time</b><div className="muted sm">{evById[p.event_id]?.title} · the line starts {t12(lineT)}</div></div>
            <div className="bk-tq">{[[-60, '−1 h'], [-30, '−30 min'], [30, '+30 min'], [60, '+1 h']].map(([m, l]) => <button key={l} type="button" className="abtn" onClick={() => bump(m as number)}>{l}</button>)}</div>
            <label className="bk-tin"><span className="muted sm">Starts at</span><input type="time" step={300} value={ownT} onChange={(ev) => setOwnT(ev.target.value)} /></label>
            <span className="muted sm">Same end time. They stay in this line with a gold “starts …” tag. Nothing is sent until you Save (or Save + send).</span>
            <div className="row" style={{ gap: 8 }}>
              {p.start !== lineT && <button className="abtn" onClick={() => apply(lineT)}>Back to {t12(lineT)}</button>}
              <button className="abtn dark" disabled={!okT || ownT === p.start} onClick={() => apply(ownT)}>Save time</button>
            </div></>; })()
          : step === 'rem' && p ? (() => { const sh = shiftOf(p); const rid = (phone as { rid?: string }).rid; if (!sh) return null; return <>
            <div><b className="serif" style={{ fontSize: 20 }}>Add to {first}’s confirmation</b><div className="muted sm">{seeTitle(evById[p.event_id])} · {t12(p.start)} · this is what {first} reads</div></div>
            <textarea rows={3} value={remTxt} onChange={(ev) => setRemTxt(ev.target.value)} />
            <span className="muted sm">Covers her event page until she taps Got it, sits on her Home card, and goes to her messages. You see when she got it.</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="abtn dark grow" disabled={!remTxt.trim()} onClick={async () => {
                const { error } = await supabase.rpc('admin_note_to_shift', { p_shift: sh.id, p_body: remTxt.trim(), p_reminder: rid ?? null });
                if (error) { setHint(error.message); return; }
                const { data: conv } = await supabase.rpc('start_conversation', { p_staff: sid });
                if (conv) await supabase.rpc('send_message', { p_conversation: conv as string, p_body: `📌 ${remTxt.trim()}`, p_topic: 'shift', p_shift: sh.id });
                setRems(await openReminders()); setHint(`✓ Added to ${first}’s shift · you’ll see when she taps Got it`); close(); }}>Add to her shift</button>
              <button className="abtn" onClick={() => setPhone({ ...phone, step: 'menu' })}>Back</button>
            </div></>; })()
          : step === 'note' && p ? (() => { const sh = shiftOf(p); if (!sh) return null; const okT = !nLeave || /^\d{2}:\d{2}$/.test(nLeave);
            const save = async (clear = false) => {
              const lv = clear || !nLeave ? null : startIso(nLeave < p.start ? addDays(date, 1) : date, nLeave);
              const { error } = await supabase.rpc('admin_set_mgr_note', { p_shift: sh.id, p_leave_by: lv, p_note: clear ? '' : nText, p_scope: nScope });
              if (error) { setHint(error.message); return; }
              setHint(clear ? `Note cleared for ${first}` : `✓ Note saved · ${first}'s manager sees it${nScope === 'first3' ? ' on their first 3 shifts' : nScope === 'always' ? ' on every shift' : ''}`); close(); await load(); };
            return <>
            <div><b className="serif" style={{ fontSize: 20 }}>Note for the manager</b><div className="muted sm">{first} · {seeTitle(evById[p.event_id])} · booked {t12(p.start)}</div></div>
            <label className="bk-tin"><span className="sm strong">Has to leave by</span><input type="time" step={900} value={nLeave} onChange={(ev) => setNLeave(ev.target.value)} />{nLeave && <button type="button" className="lnk" onClick={() => setNLeave('')}>no time</button>}</label>
            <span className="muted sm">Their end time does not change. The manager gets a reminder 30 min before.</span>
            <label className="stack" style={{ gap: 4 }}><span className="sm strong">Note <span className="muted">(optional)</span></span><textarea rows={3} value={nText} onChange={(ev) => setNText(ev.target.value)} placeholder="Last metro, let them go first if it runs late" /></label>
            <div className="stack" style={{ gap: 6 }}><span className="sm strong">Show it for</span>
              <div className="bk-scope">{([['shift', 'This shift only'], ['first3', 'First 3 shifts'], ['always', 'Every shift']] as const).map(([k, l]) => <button key={k} type="button" className={nScope === k ? 'on' : ''} onClick={() => setNScope(k)}>{l}</button>)}</div>
              <span className="muted sm">{nScope === 'first3' ? `Counts from this shift · drops off on its own after ${first}'s 3rd shift.` : nScope === 'always' ? `On every shift until you remove it (here or in ${first}'s profile).` : 'Only on this shift.'}</span></div>
            <span className="muted sm">Managers and MDs on that event see it. Staff don't. Saves right away.</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="abtn dark grow" disabled={!okT || (!nLeave && !nText.trim() && !sh.leave_by && !mNotes[sh.id] && !sNotes[sid])} onClick={() => save()}>Save note</button>
              {(sh.leave_by || mNotes[sh.id] || sNotes[sid]) && <button className="abtn" onClick={() => save(true)}>Clear</button>}
            </div></>; })()
          : step === 'move' && p ? <>
            <b>Move {name(sid)} to…</b>
            {groups.map(({ e, g }) => (
              <button key={e.id + g.start} className="abtn" disabled={(p.event_id === e.id && p.start === g.start) || (p.event_id !== e.id && onEvent(date, sid, e.id, p.key))} onClick={() => { if (p.event_id !== e.id && !okLocked(date, p, 'move')) return; place(date, sid, { event_id: e.id, start: g.start }, p.key); close(); }}>{e.title} · {t12(g.start)}</button>))}
          </> : <>
            {dayOf(date, sid).length ? <div><b>Add {first} to… · 2nd shift that day</b><div className="muted sm">Now on {dayOf(date, sid).map((x) => `${evById[x.event_id]?.title ?? '?'} ${span12(x)}`).join(' + ')}</div></div>
              : <div><b>Add {first} to…</b><div className="muted sm">Not placed today</div></div>}
            {addable.length ? addable.map(({ e, g }) => (
              <button key={e.id + g.start} className="abtn" onClick={() => { place(date, sid, { event_id: e.id, start: g.start }, undefined, false, true); close(); }}>{e.title} · {t12(g.start)}</button>))
              : <span className="muted sm">No other {dept} event this day.</span>}
          </>}
          {!(step === 'menu' && p) && <button className="abtn" onClick={close}>{step === 'menu' ? 'Close' : 'Cancel'}</button>}
        </div></div>); })()}

      {dropAsk && (() => { const { p, to } = dropAsk; const e1 = evById[p.event_id]; const e2 = evById[to.event_id]; const first = name(p.staff_id).split(' ')[0]; const close = () => setDropAsk(null); return (
        <div className="bk-modal" onClick={close}><div className="adm-card bk-dropask" onClick={(e) => e.stopPropagation()}>
          <b className="bk-dah">{first} is already on {e1?.title}</b>
          <div className="sm">{e1?.title} · {roleName(p.code)} · {span12(p)}<br />You dropped {pron(p.staff_id)} on <b>{e2?.title} · {t12(to.start)}</b>.</div>
          <button className="abtn dark" autoFocus onClick={() => { close(); place(date, p.staff_id, to, undefined, false, true); }}>Add a 2nd shift · keep both</button>
          <button className="abtn" onClick={() => { close(); if (okLocked(date, p, 'move')) place(date, p.staff_id, to, p.key); }}>Move · off {e1?.title}</button>
          <button className="lnk" onClick={close}>Cancel</button>
        </div></div>); })()}

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

      {askMore && events && staff.length > 0 && <AskMore date={date} dept={fillDept} events={(events ?? []).filter((e) => e.event_date === date)} staff={staff} av={av} wk={wk} off={off} conds={conds} links={links}
        booked={bookedOn(date)} shifts30={shifts30} yesRate={yesRate} extras={(e) => extrasOf(date, e)} practice={mode === 'practice'} spots={spots} spotAt={replaceAt} onClose={() => setAskMore(false)} onAsked={load} />}
    </div>
  );
}

/** Ask more people: who to ask so the date fills, by rank, weekday fit, recent shifts and yes rate. */
function AskMore({ date, dept, events, staff, av, wk, off, conds, links, booked, shifts30, yesRate, extras, practice, onClose, onAsked, spots, spotAt }: {
  date: string; dept: 'floor' | 'bar'; events: AEvent[]; staff: AStaff[]; av: Av[]; wk: Wk[]; off: Set<string>; conds: Cond[]; links: [string, string][];
  booked: Set<string>; shifts30: Record<string, number>; yesRate: Record<string, number>; extras: (e: AEvent) => number; practice: boolean; onClose: () => void; onAsked: () => void;
  /** push 28: "Find a replacement" → ask for exactly this many spots (pre-ticks enough people for it) */ spots?: number; spotAt?: string | null;
}) {
  const evs = events.filter((e) => (dept === 'bar') === isBarEv(e));
  const order = evs.reduce((n, e) => n + e.staff_needed, 0); const ex = evs.reduce((n, e) => n + extras(e), 0); const target = order + ex;
  const yesFree = av.filter((a) => a.status === 'yes' && !booked.has(a.staff_id)).length;
  const covered = [...booked].filter((sid) => staff.find((s) => s.id === sid)).length + yesFree;
  const waiting = av.filter((a) => a.status === 'asked');
  const expected = waiting.reduce((n, a) => n + (yesRate[a.staff_id] ?? 0.5), 0);
  const need = spots != null ? spots : Math.max(0, Math.ceil(target - covered - expected));
  const dow = dowOf(date);
  const asked = new Set(av.map((a) => a.staff_id));
  const condsOf = (sid: string) => conds.filter((c) => c.staff_id === sid);
  const cands = staff.filter((s) => s.active && (dept === 'bar' ? doesBar(s) : s.department !== 'bar') && !asked.has(s.id) && !booked.has(s.id) && !off.has(s.id + date)
    && wk.find((w) => w.staff_id === s.id && w.dow === dow)?.status !== 'no' && !/manual booking only|leaving|do not book/i.test(s.staff_private?.notes ?? ''))
    .map((s) => { const u = wk.find((w) => w.staff_id === s.id && w.dow === dow); const k = condsOf(s.id).map((c) => c.kind);
      const linkedBooked = links.some((l) => l.includes(s.id) && [...booked, ...av.filter((a) => a.status === 'yes').map((a) => a.staff_id)].includes(l[0] === s.id ? l[1] : l[0]));
      const hb = setting('ask.hold_back'); const held = (shifts30[s.id] ?? 0) >= hb.shifts ? `${hb.shifts}+ shifts in ${hb.days} days` : k.includes('big_dates_only') ? 'only for very big dates' : k.includes('only_if_needed') ? 'only when we really need them' : '';
      return { s, u, rate: yesRate[s.id] ?? 0.5, n30: shifts30[s.id] ?? 0, held, linkedBooked }; })
    .sort((a, b) => Number(b.linkedBooked) - Number(a.linkedBooked) || (a.s.staff_private?.ranking ?? 9999) - (b.s.staff_private?.ranking ?? 9999) || Number(!!b.u) - Number(!!a.u) || a.n30 - b.n30 || b.rate - a.rate);
  const main = cands.filter((c) => !c.held); const held = cands.filter((c) => c.held);
  const [pick, setPick] = useState<Set<string>>(() => { const p = new Set<string>(); let sum = 0; for (const c of main) { if (sum >= need) break; p.add(c.s.id); sum += c.rate; } return p; });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const text = `Hey! G&R has a new date for you: ${dLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}. Let me know in the app (My dates) 👉 https://gr-staff-portal.vercel.app/my-dates`;
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
      <div className="spread"><b className="serif" style={{ fontSize: 22 }}>Ask more people · {dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} · {dept}{spots != null && <span className="accent"> · {spots} spot{spots > 1 ? 's' : ''}{spotAt ? ` at ${t12(spotAt)}` : ''}</span>}</b><button className="abtn sm" onClick={onClose}>✕</button></div>
      {spots != null && yesFree > 0 && <div className="bk-warn ok"><span className="grow"><b>{yesFree} said yes</b> for this date and {yesFree === 1 ? 'isn’t' : 'aren’t'} placed yet: drag one onto the board first, it’s faster than asking.</span></div>}
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
