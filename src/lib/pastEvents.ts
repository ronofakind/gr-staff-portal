import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { setting } from './settings';
import { mtlToday, addDays } from './myDates';

/**
 * push 51 · "Managed" = the one rule used everywhere (Home strip, My dates → Past, Hours → Teams I managed, Manage on a past event):
 * the lead (events.manager_id), a co-manager (events.co_manager_ids), or whoever holds the MD / BM shift on that event.
 * Migration 056 gives manages() the same MD / BM clause, so RLS and the manager RPCs agree with the app.
 */
export const LEAD_CODES = ['MD', 'BM'];
export const managesShift = (s: { position_code: string | null; events: { manager_id: string | null; co_manager_ids?: string[] | null } }, meId: string) =>
  s.events.manager_id === meId || (s.events.co_manager_ids ?? []).includes(meId) || LEAD_CODES.includes(s.position_code ?? '');

type P = { punch_in: string | null; punch_out: string | null } | null;
const one = (p: P | P[]) => (Array.isArray(p) ? p[0] ?? null : p);

export type PastShift = {
  id: string; status: string; attendance: string | null; position_code: string | null; position_detail: string | null;
  planned_start: string; planned_end: string | null; punches: P;
  events: { id: string; event_date: string; title: string; manager_id: string | null; co_manager_ids?: string[] | null; hours_submitted_at: string | null; venues: { name: string } | null };
};
export type NewPerson = { staff_id: string; name: string; photo_url: string | null; role: string; done_before: number; stars: number | null };
export type TeamSum = { team: number; ended: number; noShow: number; worked: number; newStaff: NewPerson[]; toRate: number };

const ROLE: Record<string, string> = { MD: 'MD', W: 'Waiter', BM: 'Bar manager', BT: 'Bartender', BB: 'Bar back', BUS: 'Busboy' };
export const roleOf = (code: string | null, detail: string | null) =>
  detail ? detail.replace(/^bar\s*-\s*/i, '') : code ? (ROLE[code] ?? (/^\d+$/.test(code) ? 'Waiter' : code)) : 'Waiter';

/** A shift that's over: an earlier day, or today with the end punch passed. Declined / cancelled / no-show are left out. */
export const isPast = (s: PastShift, today = mtlToday()) =>
  s.events.event_date < today || (s.events.event_date === today && !!s.punches?.punch_out && new Date(s.punches.punch_out).getTime() <= Date.now());

const COLS = 'id,status,attendance,position_code,position_detail,planned_start,planned_end,punches(punch_in,punch_out),events!inner(id,event_date,title,manager_id,co_manager_ids,hours_submitted_at,venues(name))';

/** My own past shifts, last `days` days, newest first. */
export async function loadPastShifts(meId: string, days: number): Promise<PastShift[]> {
  const today = mtlToday();
  const { data, error } = await supabase.from('shifts').select(COLS).eq('staff_id', meId).neq('status', 'declined')
    .gte('events.event_date', addDays(today, -days)).lte('events.event_date', today);
  if (error) console.warn('[past · shifts]', error.message);
  return ((data ?? []) as unknown as PastShift[]).map((r) => ({ ...r, punches: one(r.punches as P | P[]) }))
    .filter((r) => !r.attendance && isPast(r, today))
    .sort((a, b) => b.planned_start.localeCompare(a.planned_start));
}

type Crew = { event_id: string; staff_id: string; attendance: string | null; position_code: string | null; position_detail: string | null;
  cancel_self?: boolean; cancel_sent_to_manager?: string | null; staff: { full_name: string; photo_url: string | null } | null; punches: P };
type TeamInfo = { staff_id: string; done_before: number; is_new: boolean; fb_stars: number | null };

/**
 * Team counts + new staff to rate for events I managed. withRating = the mgr.feedback setting is on for me (Manage.tsx feedbackOn).
 * "New" = the push 27 / 30 rule: manager_team_info.is_new and fewer than Settings → "new tag" shifts done before (3 by default).
 */
export async function loadTeamSums(eventIds: string[], withRating: boolean, meId?: string): Promise<Record<string, TeamSum>> {
  if (!eventIds.length) return {};
  const q = (cols: string) => supabase.from('shifts').select(cols).in('event_id', eventIds).neq('status', 'declined');
  const base = 'event_id,staff_id,attendance,position_code,position_detail,staff:staff!shifts_staff_id_fkey(full_name,photo_url),punches(punch_in,punch_out)';
  let r = await q(base + ',cancel_self,cancel_sent_to_manager');
  if (r.error) r = await q(base); // migration 034 not applied
  const crew = ((r.data ?? []) as unknown as Crew[]).map((c) => ({ ...c, punches: one(c.punches as P | P[]) }))
    .filter((c) => !(c.cancel_self && !c.cancel_sent_to_manager) && c.attendance !== 'cancelled');
  const newUnder = setting('bookings.new_tag_shifts');
  const infos: Record<string, Record<string, TeamInfo>> = {};
  if (withRating) await Promise.all(eventIds.map(async (id) => {
    const { data, error } = await supabase.rpc('manager_team_info', { p_event: id });
    if (error || !Array.isArray(data)) return;
    infos[id] = Object.fromEntries((data as TeamInfo[]).filter((x) => x && typeof x.staff_id === 'string')
      .map((x) => [x.staff_id, { ...x, done_before: typeof x.done_before === 'number' ? x.done_before : 0, fb_stars: typeof x.fb_stars === 'number' ? x.fb_stars : null }]));
  }));
  const out: Record<string, TeamSum> = {};
  for (const id of eventIds) {
    const list = crew.filter((c) => c.event_id === id);
    const worked = list.filter((c) => !c.attendance && c.punches?.punch_in);
    const ended = worked.filter((c) => c.punches?.punch_out && new Date(c.punches.punch_out).getTime() <= Date.now());
    const inf = infos[id] ?? {};
    const seen = new Set<string>();
    const newStaff: NewPerson[] = worked.filter((c) => { const i = inf[c.staff_id]; if (c.staff_id === meId || !i?.is_new || i.done_before >= newUnder || seen.has(c.staff_id)) return false; seen.add(c.staff_id); return true; })
      .map((c) => ({ staff_id: c.staff_id, name: c.staff?.full_name ?? '?', photo_url: c.staff?.photo_url ?? null, role: roleOf(c.position_code, c.position_detail), done_before: inf[c.staff_id].done_before, stars: inf[c.staff_id].fb_stars }));
    out[id] = { team: list.length, ended: ended.length, noShow: list.filter((c) => c.attendance === 'no_show').length, worked: worked.length, newStaff, toRate: newStaff.filter((n) => !n.stars).length };
  }
  return out;
}

/** Past shifts + team sums for the ones I managed (one load, reloads when the app comes back to the front). */
export function usePastEvents(meId: string, days: number, withRating: boolean, off = false) {
  const [shifts, setShifts] = useState<PastShift[] | null>(null);
  const [sums, setSums] = useState<Record<string, TeamSum>>({});
  const load = async () => {
    if (off) { setShifts([]); return; }
    const list = await loadPastShifts(meId, days);
    setShifts(list);
    const managed = [...new Set(list.filter((s) => managesShift(s, meId)).map((s) => s.events.id))];
    setSums(await loadTeamSums(managed, withRating, meId));
  };
  useEffect(() => {
    load();
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [meId, days, withRating, off]); // eslint-disable-line react-hooks/exhaustive-deps
  return { shifts, sums, reload: load };
}

/** "yesterday" · "Sun Nov 1" */
export const agoLabel = (iso: string, today = mtlToday()) =>
  iso === addDays(today, -1) ? 'yesterday' : iso === today ? 'today' : new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');

// ✕ on a Home strip = hidden until tomorrow on this device
const HIDE_KEY = 'gr-past-hide';
export const readHidden = (): Record<string, string> => { try { const v = JSON.parse(localStorage.getItem(HIDE_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
export const hideToday = (key: string) => { const v = readHidden(); v[key] = mtlToday(); try { localStorage.setItem(HIDE_KEY, JSON.stringify(Object.fromEntries(Object.entries(v).filter(([, d]) => d >= addDays(mtlToday(), -2))))); } catch { /* private mode */ } };
