// push 109 · Day sheet part 2: ✦ Fill the day / the week (doc "G&R staff app booking day sheet (mapping)", answers 12–15).
// Hard rules: said yes (and "from" time) · not on another event that day · no time off · keep-apart · Hub conditions · department ·
// $18 people only on cocktail / dînatoire / stations. Order: tier A → B → C then ranking; client lines first, extras next (new staff
// first); spread the best across events, small events get the most experienced; linked people together; early lines to early people.
// Far venues: drivers first, with the people they're linked to. More than 3 shifts that week = a flag only. Never touches MDs, BMs, locked.
import { supabase } from '../lib/supabase';
import { allStaff, startIso, roleName, type AStaff, type Client, type Venue } from './api';
import { loadRules, misfits, other, type SCond, type SLink } from './rules';

export type Line = { dept?: string; code: string; start: string | null; count: number };
export type Ev = { id: string; title: string; event_date: string; department: string; start_time: string | null; staff_needed: number; guests: number | null; staffing: Line[] | null;
  details_pending: boolean | null; start_tbc: boolean | null; caterer_name?: string | null; caterer_id?: string | null; uniform_floor?: string | null; uniform_bar?: string | null; notes?: string | null; guests_final?: boolean | null; event_type?: string | null; extras?: number | null; extras_start?: string | null; venue_id: string | null;
  event_private?: { client: string | null; client_id?: string | null } | null; venues: { name: string; far?: boolean | null; area?: string | null } | null };
export type Sh = { id: string; event_id: string; staff_id: string; position_code: string | null; position_detail?: string | null; status: string; pool_hold: boolean; locked: boolean | null;
  notified_at: string | null; planned_start: string | null; time_tbc?: boolean | null; booking_note?: string | null };
export type Av = { staff_id: string; status: string; from_time: string | null; released_at: string | null; avail_asks?: { department: string | null } | null };
export type Cx = Sh & { cancel_reason?: string | null; cancel_note?: string | null; cancel_late?: boolean | null; cancelled_at?: string | null };
export type Day = { date: string; evs: Ev[]; sh: Sh[]; av: Av[]; off: Set<string>; cx: Cx[] };
export type Ctx = { staff: AStaff[]; byId: Record<string, AStaff>; cars: Set<string>; worked: Record<string, number>; newIds: Set<string>; links: SLink[]; conds: SCond[]; rate: Record<string, number>; venues: Venue[]; clients: Client[] };

export const LEAD = ['MD', 'BM'];
const TORD: Record<string, number> = { A: 0, B: 1, C: 2 };
export const hm = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }) : '';
export const isBar = (e: { department: string }) => e.department === 'bar';
export const isFar = (e: Ev) => !!(e.venues?.far || e.venues?.area === 'Far');
const NONE = ['00000000-0000-0000-0000-000000000000'];
const EV_COLS = 'id,title,event_date,department,start_time,staff_needed,guests,staffing,details_pending,start_tbc,caterer_name,caterer_id,uniform_floor,uniform_bar,notes,guests_final,event_type,extras,extras_start,venue_id,event_private(client,client_id),venues(*)';

/** One day: its events (both departments), the shifts on them, the answers for that date, who is off. */
export async function loadDay(date: string): Promise<Day> {
  const [e, a0, o] = await Promise.all([
    supabase.from('events').select(EV_COLS).eq('event_date', date).order('start_time'),
    supabase.from('availability').select('staff_id,status,from_time,released_at,avail_asks(department)').eq('for_date', date).not('ask_id', 'is', null),
    supabase.from('days_off').select('staff_id').lte('from_date', date).gte('to_date', date),
  ]);
  if (e.error) throw e.error;
  const a = a0.error ? await supabase.from('availability').select('staff_id,status,from_time,released_at').eq('for_date', date).not('ask_id', 'is', null) : a0;
  const evs = (e.data ?? []) as unknown as Ev[];
  const s = await supabase.from('shifts').select('id,event_id,staff_id,position_code,position_detail,status,pool_hold,locked,notified_at,planned_start,time_tbc,attendance,booking_note,cancel_reason,cancel_note,cancel_late,cancelled_at')
    .in('event_id', evs.length ? evs.map((x) => x.id) : NONE).neq('status', 'declined');
  const all = (s.data ?? []) as (Cx & { attendance?: string | null })[];
  const sh = all.filter((x) => x.attendance !== 'cancelled'); const cx = all.filter((x) => x.attendance === 'cancelled');
  // one row per person (an ask for floor and one for bar the same day: keep the yes)
  const av: Av[] = []; for (const r of (a.data ?? []) as unknown as Av[]) { const i = av.findIndex((x) => x.staff_id === r.staff_id); if (i < 0) av.push(r); else if (r.status === 'yes' && av[i].status !== 'yes') av[i] = r; }
  return { date, evs, sh, av, cx, off: new Set(((o.data ?? []) as { staff_id: string }[]).map((x) => x.staff_id)) };
}

/** Everything that doesn't change from day to day: staff, links, Hub conditions, pay rates, venues, clients. */
export async function loadCtx(staff0?: AStaff[]): Promise<Ctx> {
  const [staff, rules, r, v, c] = await Promise.all([
    staff0?.length ? Promise.resolve(staff0) : allStaff(), loadRules(),
    supabase.from('staff_rates').select('staff_id,rate,from_date').order('from_date', { ascending: false }),
    supabase.from('venues').select('*'), supabase.from('clients').select('id,name,area,kind'),
  ]);
  const { data: tr } = await supabase.from('staff').select('id,transport').eq('transport', 'car');
  // Ronnie, Nov 12: "the only new staff are coming through our onboarding system now" → new = has an onboarding record (and under 5 shifts in the app)
  const { data: ob } = await supabase.from('staff_onboarding').select('staff_id').limit(1000);
  // "new" = fewer than 5 shifts worked (created_at is the app import date for most people)
  const worked: Record<string, number> = {}; const today = new Date().toISOString().slice(0, 10);
  for (let i = 0; i < 20; i++) { const { data } = await supabase.from('shifts').select('staff_id,events!inner(event_date)').lt('events.event_date', today).neq('status', 'declined').range(i * 1000, i * 1000 + 999);
    const xs = (data ?? []) as { staff_id: string }[]; for (const x of xs) worked[x.staff_id] = (worked[x.staff_id] ?? 0) + 1; if (xs.length < 1000) break; }
  const rate: Record<string, number> = {}; for (const x of (r.data ?? []) as { staff_id: string; rate: number }[]) if (rate[x.staff_id] == null) rate[x.staff_id] = Number(x.rate);
  return { staff, byId: Object.fromEntries(staff.map((s) => [s.id, s])), cars: new Set(((tr ?? []) as { id: string }[]).map((x) => x.id)), worked, newIds: new Set(((ob ?? []) as { staff_id: string }[]).map((x) => x.staff_id)), links: rules.links, conds: rules.conds, rate, venues: (v.data ?? []) as Venue[], clients: (c.data ?? []) as unknown as Client[] };
}

/** Shifts per person in the Mon–Sun week (for the "more than 3" flag). */
export async function weekCounts(mon: string, sun: string) {
  const { data } = await supabase.from('shifts').select('staff_id,events!inner(event_date)').gte('events.event_date', mon).lte('events.event_date', sun).neq('status', 'declined');
  const n: Record<string, number> = {}; for (const x of (data ?? []) as { staff_id: string }[]) n[x.staff_id] = (n[x.staff_id] ?? 0) + 1; return n;
}

/** Lines of an event with the people on them (same code + time, up to the count). Leftovers → extras line, then "also placed". */
/** rk = ranking (lower = better): inside a line the best are kept, the weakest overflow (push 113). */
export function layout(e: Ev, shifts: Sh[], rk?: (sid: string) => number) {
  const lines = (e.staffing ?? []).map((l, i) => ({ l, i })).filter(({ l }) => !LEAD.includes(l.code) && l.count > 0).map(({ l, i }) => ({ idx: i, key: `${i}`, code: l.code, start: l.start ?? e.start_time?.slice(0, 5) ?? null, count: l.count, people: [] as Sh[] }));
  const leadNeed = (e.staffing ?? []).filter((l) => LEAD.includes(l.code)).reduce((n, l) => n + l.count, 0);
  const leads = shifts.filter((s) => LEAD.includes(s.position_code ?? ''));
  const rest = shifts.filter((s) => !LEAD.includes(s.position_code ?? '')).sort((a, b) => (a.planned_start ?? '').localeCompare(b.planned_start ?? '') || (rk ? rk(a.staff_id) - rk(b.staff_id) : 0));
  const left: Sh[] = [];
  const odd: Sh[] = [];
  for (const s of rest) { const t = hm(s.planned_start); const L = lines.find((l) => l.code === (s.position_code ?? 'W') && l.start === t && l.people.length < l.count)
      ?? lines.find((l) => l.start === t && l.people.length < l.count); if (L) L.people.push(s); else odd.push(s); }
  // Nov 12 · someone given their own start (e.g. 4:30 on a 4 PM line) stays on their line: same role, the closest line that starts before them
  const exStart0 = e.extras_start?.slice(0, 5) ?? (lines.length ? lines[lines.length - 1].start : null);
  for (const s of odd) { const t = hm(s.planned_start); const code = s.position_code ?? 'W';
    const L = t === exStart0 ? undefined : [...lines].filter((l) => l.code === code && l.people.length < l.count && (l.start ?? '') <= t).sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''))[0]
      ?? [...lines].filter((l) => l.code === code && l.people.length < l.count).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))[0];
    if (L) L.people.push(s); else left.push(s); }
  const client = lines.reduce((n, l) => n + l.count, 0) + leadNeed;
  const exN = e.extras != null ? Math.max(0, e.extras) : !isBar(e) && client > 7 ? Math.ceil(client * 0.1) : 0;
  const lastStart = lines.length ? lines[lines.length - 1].start : e.start_time?.slice(0, 5) ?? null;
  const extras = { key: 'x', code: isBar(e) ? 'BT' : 'W', start: e.extras_start?.slice(0, 5) ?? lastStart, count: exN, people: left.splice(0, exN) };
  return { lines, leads, leadNeed: (e.staffing ?? []).some((l) => LEAD.includes(l.code)) ? leadNeed : 1, leadIdx: (e.staffing ?? []).findIndex((l) => LEAD.includes(l.code)), client, extras, over: left };
}

const HARD = new Set(['not_venue', 'private_only', 'big_dates_only', 'not_weekday', 'min_guests', 'areas']);
const cheapOk = (e: Ev) => /cocktail|d[iî]natoire|station/i.test(e.event_type ?? '');
const deptOf = (a: Av, s?: AStaff) => a.avail_asks?.department ?? s?.department ?? 'floor';

export type Row = Record<string, unknown> & { staff_id: string; event_id: string };
export type Plan = { rows: Row[]; why: Record<string, string>; held: string[]; flags: string[] };

export const isNewStaff = (ctx: Ctx, sid: string) => ctx.newIds.has(sid) && (ctx.worked[sid] ?? 0) < 5;

/** Why this person sits here (hover on a name). */
export function whyText(sid: string, e: Ev, ctx: Ctx, onEvent: string[], weekN: number, a?: Av | null) {
  const s = ctx.byId[sid]; const sp = s?.staff_private;
  const bits = [sp?.tier ? `Tier ${sp.tier}` : 'no tier', sp?.ranking ? `rank ${sp.ranking}` : null, a?.from_time ? `free from ${a.from_time.slice(0, 5)}` : a ? 'any time' : null,
    isFar(e) ? (ctx.cars.has(sid) ? '🚗 has a car' : 'no car listed') : null,
    ...ctx.links.filter((l) => l.kind === 'together' && (l.staff_a === sid || l.staff_b === sid) && onEvent.includes(other(l, sid))).map((l) => `with ${ctx.byId[other(l, sid)]?.full_name ?? '…'}`),
    isNewStaff(ctx, sid) ? `new · ${ctx.worked[sid] ?? 0} shift${(ctx.worked[sid] ?? 0) === 1 ? '' : 's'} so far` : null, ctx.rate[sid] != null && ctx.rate[sid] <= 18 ? '$18' : null, weekN > 3 ? `⚑ ${weekN} shifts this week` : null,
    ...misfits(sid, e as never, { conds: ctx.conds, clients: ctx.clients, venues: ctx.venues, big: true }).filter((m) => m.kind !== 'big_dates_only').map((m) => `⚠ ${m.text}`)];
  return bits.filter(Boolean).join(' · ');
}

/** ✦ plan for one day. targets = the events to fill (a block, or the day under the Floor / Bar switch). weekN is updated in place. */
export function planFill(day: Day, targets: Ev[], ctx: Ctx, weekN: Record<string, number>): Plan {
  const { date } = day; const why: Record<string, string> = {}; const held = new Set<string>(); const flags: string[] = [];
  const floorBig = day.evs.filter((e) => !isBar(e)).reduce((n, e) => n + layout(e, []).client, 0) >= 25;
  const onDay = new Set(day.sh.map((s) => s.staff_id));
  const at: Record<string, string[]> = {}; for (const s of day.sh) (at[s.event_id] ??= []).push(s.staff_id);
  type Slot = { e: Ev; code: string; start: string | null; kind: 'client' | 'extra' };
  const open: Slot[] = [];
  for (const e of targets) { const L = layout(e, day.sh.filter((s) => s.event_id === e.id));
    for (const l of L.lines) for (let i = l.people.length; i < l.count; i++) open.push({ e, code: l.code, start: l.start, kind: 'client' });
    for (let i = L.extras.people.length; i < L.extras.count; i++) open.push({ e, code: L.extras.code, start: L.extras.start, kind: 'extra' }); }
  const tier = (id: string) => TORD[ctx.byId[id]?.staff_private?.tier ?? ''] ?? 9; const rank = (id: string) => ctx.byId[id]?.staff_private?.ranking ?? 9999;
  const pool = day.av.filter((a) => a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !day.off.has(a.staff_id) && ctx.byId[a.staff_id]?.active)
    .sort((a, b) => tier(a.staff_id) - tier(b.staff_id) || rank(a.staff_id) - rank(b.staff_id));
  const avOf = Object.fromEntries(pool.map((a) => [a.staff_id, a]));
  const used = new Set<string>(); const rows: Row[] = [];
  const size = (e: Ev) => layout(e, []).client;
  const filled = (e: Ev) => (at[e.id]?.length ?? 0);
  const together = (sid: string) => ctx.links.filter((l) => l.kind === 'together' && (l.staff_a === sid || l.staff_b === sid)).map((l) => other(l, sid));
  const apart = (sid: string) => ctx.links.filter((l) => l.kind === 'apart' && (l.staff_a === sid || l.staff_b === sid)).map((l) => other(l, sid));
  const onlyIfNeeded = (sid: string) => ctx.conds.some((c) => c.staff_id === sid && c.kind === 'only_if_needed');
  const car = (sid: string) => ctx.cars.has(sid);
  const isNew = (sid: string) => isNewStaff(ctx, sid);

  const fits = (sid: string, sl: Slot) => {
    const a = avOf[sid]; if (!a) return false;
    if ((deptOf(a, ctx.byId[sid]) === 'bar') !== isBar(sl.e)) return false;
    if (a.from_time && sl.start && !(sl.e.start_tbc || sl.e.details_pending) && a.from_time.slice(0, 5) > sl.start) return false;
    if (apart(sid).some((x) => at[sl.e.id]?.includes(x))) return false;
    if (misfits(sid, sl.e as never, { conds: ctx.conds, clients: ctx.clients, venues: ctx.venues, big: floorBig }).some((m) => HARD.has(m.kind))) return false;
    if (ctx.rate[sid] != null && ctx.rate[sid] <= 18 && !cheapOk(sl.e)) { held.add(sid); return false; }
    return true;
  };
  const put = (sid: string, sl: Slot, note: string) => {
    open.splice(open.indexOf(sl), 1); used.add(sid); (at[sl.e.id] ??= []).push(sid); weekN[sid] = (weekN[sid] ?? 0) + 1;
    const t = sl.start ?? sl.e.start_time?.slice(0, 5) ?? '17:00';
    const st = avOf[sid]?.from_time && avOf[sid]!.from_time!.slice(0, 5) > t ? avOf[sid]!.from_time!.slice(0, 5) : t;
    rows.push({ event_id: sl.e.id, staff_id: sid, position_code: sl.code, position_detail: roleName(sl.code), planned_start: startIso(date, st), status: 'booked', pool_hold: true, time_tbc: !!(sl.e.start_tbc || sl.e.details_pending) });
    why[`${sl.e.id}|${sid}`] = [note, sl.kind === 'extra' ? 'extra' : null].filter(Boolean).join(' · ');
    if (weekN[sid] > 3) flags.push(`${ctx.byId[sid]?.full_name ?? '…'} (${weekN[sid]} this week)`);
  };
  // earliest open line in this event that fits (any-time people take the early lines first)
  const slotIn = (sid: string, e: Ev, kinds: Slot['kind'][]) => open.filter((s) => s.e.id === e.id && kinds.includes(s.kind) && fits(sid, s)).sort((a, b) => (a.start ?? '99').localeCompare(b.start ?? '99'))[0];
  const withPartners = (sid: string, e: Ev, kinds: Slot['kind'][], note: string) => {
    for (const p of together(sid)) { if (used.has(p) || !avOf[p]) continue; const sl = slotIn(p, e, kinds) ?? slotIn(p, e, ['client', 'extra']); if (sl) put(p, sl, `${note} · with ${ctx.byId[sid]?.full_name ?? '…'}`); }
  };
  const best = (sid: string, kinds: Slot['kind'][]) => {
    const evs = [...new Set(open.filter((s) => kinds.includes(s.kind)).map((s) => s.e))].filter((e) => slotIn(sid, e, kinds));
    if (!evs.length) return null;
    const mate = evs.find((e) => together(sid).some((p) => at[e.id]?.includes(p)));
    if (mate) return mate;
    return evs.sort((a, b) => filled(a) / Math.max(1, size(a)) - filled(b) / Math.max(1, size(b)) || size(a) - size(b))[0];
  };
  const pass = (people: string[], kinds: Slot['kind'][], note: string) => {
    for (const sid of people) { if (used.has(sid)) continue; const e = best(sid, kinds); if (!e) continue; const sl = slotIn(sid, e, kinds)!; put(sid, sl, note); withPartners(sid, e, kinds, note); }
  };
  const ids = pool.map((a) => a.staff_id);
  // 0 · far venues: drivers first, with the people they're linked to
  for (const e of targets.filter(isFar)) for (const sid of ids.filter(car)) { if (used.has(sid)) continue; const sl = slotIn(sid, e, ['client']); if (!sl) continue; put(sid, sl, '🚗 driver · far venue'); withPartners(sid, e, ['client', 'extra'], 'rides with the driver'); }
  // 1 · client lines: best first, spread (new staff + "only if needed" wait for the extras)
  pass(ids.filter((x) => !isNew(x) && !onlyIfNeeded(x)), ['client'], 'best free');
  // 2 · extras: new staff first, then the next best, then "only if needed"
  pass(ids.filter(isNew), ['extra'], 'new · extra to train');
  pass(ids.filter((x) => !onlyIfNeeded(x)), ['client', 'extra'], 'next best');
  pass(ids, ['client', 'extra'], 'only if needed');
  return { rows, why, held: [...held].filter((x) => !used.has(x)), flags };
}
