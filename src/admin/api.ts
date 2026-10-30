import { supabase } from '../lib/supabase';

export type AStaff = {
  id: string; full_name: string; nickname?: string | null; created_at?: string; sex?: 'm' | 'f' | null; email: string | null; phone: string | null; language: 'fr' | 'en';
  department: 'floor' | 'bar' | 'kitchen'; role: 'staff' | 'manager' | 'admin'; positions: string[];
  active: boolean; photo_url: string | null; staff_private: { ranking: number | null; notes: string | null; tier: 'A' | 'B' | 'C' | null } | null;
};

export type AShift = {
  id: string; event_id: string; staff_id: string; position_code: string | null; position_detail: string | null;
  planned_start: string; status: 'booked' | 'confirmed' | 'declined'; changed_at: string; notified_at: string | null; attendance: 'no_show' | 'cancelled' | null; leave_by: string | null;
  punches: { punch_in: string | null; punch_out: string | null } | null; manager_note?: string | null; note_archived_at?: string | null; note_archived_by?: string | null;
  staff: { full_name: string; phone?: string | null } | null;
};

export type AEvent = {
  id: string; event_date: string; title: string; address: string | null; department: 'floor' | 'bar' | 'kitchen';
  description: string | null; dress_code: string | null; bring: string | null;
  start_time: string | null; end_time: string | null; staff_needed: number; manager_id: string | null; hours_submitted_at: string | null;
  venue_id: string | null; ends_label?: string | null; staffing?: Line[]; notes?: string | null; uniform_floor?: string; uniform_bar?: string; uniform_floor_w?: string | null; uniform_bar_w?: string | null; drive_folder_url?: string | null; timeline: { time: string; label: string }[];
  event_private: { client: string | null; punch_code: string } | null;
  shifts: AShift[];
};

export const EVENT_SELECT = `id,event_date,title,address,department,description,dress_code,bring,start_time,end_time,
  staff_needed,manager_id,hours_submitted_at,venue_id,timeline,event_private(client,punch_code),ends_label,staffing,notes,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,drive_folder_url,
  shifts(id,event_id,staff_id,position_code,position_detail,planned_start,status,changed_at,notified_at,attendance,leave_by,manager_note,note_archived_at,note_archived_by,punches(punch_in,punch_out),staff:staff!shifts_staff_id_fkey(full_name,phone))`;

export async function eventsBetween(from: string, to: string) {
  const { data, error } = await supabase.from('events').select(EVENT_SELECT)
    .gte('event_date', from).lte('event_date', to).order('event_date').order('start_time');
  if (error) throw error;
  return (data ?? []) as unknown as AEvent[];
}

export async function allStaff() {
  const { data, error } = await supabase.from('staff')
    .select('id,full_name,nickname,email,phone,language,department,role,positions,active,photo_url,created_at,sex,staff_private(ranking,notes,tier)')
    .order('full_name');
  if (error) throw error;
  return (data ?? []) as unknown as AStaff[];
}

/** Event date + "HH:MM" in Montreal time → ISO timestamp. Shifts after midnight belong to the next day. */
export function startIso(date: string, time: string | null) {
  const t = (time ?? '17:00').slice(0, 5);
  const guess = new Date(`${date}T${t}:00Z`);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName')!.value; // e.g. GMT-4
  const off = Number(tz.replace('GMT', '') || 0);
  return new Date(guess.getTime() - off * 3600e3).toISOString();
}

export function endIso(date: string, start: string | null, end: string | null) {
  if (!end) return null;
  const s = startIso(date, start); let e = startIso(date, end);
  if (e <= s) e = new Date(new Date(e).getTime() + 24 * 3600e3).toISOString();
  return e;
}

export const sortShifts = (a: AShift, b: AShift) => {
  const rank = (c: string | null) => (c === 'MD' ? -1 : c && /^\d+$/.test(c) ? Number(c) : 999);
  return a.planned_start.localeCompare(b.planned_start) || rank(a.position_code) - rank(b.position_code)
    || (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? '');
};

export const isoDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDay(d);
};
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/** Flags computed from a shift: no-show / cancelled / late (>10 min after call) / early start (started before call on purpose). */
export type Flag = 'no_show' | 'cancelled' | 'late' | 'early';
export const FLAG_LABEL: Record<Flag, string> = { no_show: 'NO-SHOW', cancelled: 'CANCELLED', late: 'LATE', early: 'EARLY START' };
export function flagsOf(s: { attendance: string | null; planned_start: string; punches: { punch_in: string | null } | null }): { flag: Flag; min?: number }[] {
  if (s.attendance === 'no_show') return [{ flag: 'no_show' }];
  if (s.attendance === 'cancelled') return [{ flag: 'cancelled' }];
  const pin = s.punches?.punch_in; if (!pin) return [];
  const diff = Math.round((new Date(pin).getTime() - new Date(s.planned_start).getTime()) / 60000);
  if (diff > 10) return [{ flag: 'late', min: diff }];
  if (diff < -1) return [{ flag: 'early', min: -diff }];
  return [];
}
export const flagText = (f: { flag: Flag; min?: number }) => f.flag === 'late' ? `LATE ${f.min} MIN` : FLAG_LABEL[f.flag];

/** Semi-monthly pay period containing a date: 1–15 or 16–end. */
export function periodOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m, 0).getDate(); const mm = String(m).padStart(2, '0');
  return d <= 15 ? { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` } : { start: `${y}-${mm}-16`, end: `${y}-${mm}-${last}` };
}
/** Paid hours: real time rounded to 15 min, minimum 4 h per shift (Ronnie, Oct 29 2026: paid and billed). */
export const MIN_HOURS = 4;
export const hoursBetween = (a: string | null, b: string | null) => a && b ? Math.max(MIN_HOURS, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 900000) * 0.25) : 0;
export const tTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).replace(/\./g, '') : '';
export const dLabel = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', o).replace(/\./g, '');

/** One line of the staffing grid: one role at one start time. */
export type Line = { dept: 'floor' | 'bar'; code: string; start: string; count: number; names: string[] };
export const ROLES: { dept: 'floor' | 'bar'; code: string; label: string }[] = [
  { dept: 'floor', code: 'MD', label: 'MD' }, { dept: 'floor', code: 'W', label: 'Waiter' }, { dept: 'floor', code: 'BUS', label: 'Busboy' },
  { dept: 'bar', code: 'BM', label: 'Bar manager' }, { dept: 'bar', code: 'BT', label: 'Bartender' }, { dept: 'bar', code: 'BB', label: 'Barback' },
];
export const roleName = (code: string | null) => ROLES.find((r) => r.code === code)?.label ?? (code && /^\d+$/.test(code) ? 'Waiter' : code ?? '');
export const roleOfShift = (code: string | null) => (code && /^\d+$/.test(code) ? 'W' : code ?? 'W');
export type Venue = { id: string; name: string; address: string | null; usual_client_id: string | null; uniform_floor: string | null; uniform_bar: string | null; uniform_floor_w?: string | null; uniform_bar_w?: string | null };
export type Client = { id: string; name: string; rate_sets: { key: string; label: string; rates: Record<string, number> }[] };
export const UNIFORMS: [string, string][] = [['white_shirt', 'White dress shirt'], ['black_shirt', 'Black dress shirt'], ['dress', 'Black cocktail dress'], ['black_tshirt', 'Black T-shirt']];
export const ENDS: [string, string | null][] = [['~ 10 PM', '22:00'], ['~ 11 PM', '23:00'], ['~ midnight', '00:00'], ['~ 1 AM', '01:00'], ['~ 2 AM', '02:00'], ['late', null]];
/** "545" → "17:45", "5:45pm" → "17:45", "1130" → "11:30" (AM/PM guessed for evening events: 1–9 → PM). */
export function parseTime(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\s/g, ''); if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm|a|p)?$/); if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0); if (h > 23 || min > 59) return null;
  const ap = m[3]?.[0];
  if (ap === 'p' && h < 12) h += 12; else if (ap === 'a' && h === 12) h = 0; else if (!ap && h >= 1 && h <= 9) h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
export const ap12 = (t: string | null | undefined) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/** Confirmations for this event already went out (anyone on it was sent details). */
export const confirmationsSent = (e: { shifts: { notified_at: string | null }[] }) => e.shifts.some((s) => s.notified_at);
const aDate = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');
/**
 * Record a booking change and, if that event's confirmations were already sent, alert the person (Home card).
 * Not sent yet → silent; they get the details when confirmations go out.
 */
export async function bookingChange(kind: 'booked' | 'moved' | 'removed', p: {
  staff_id: string; shift_id?: string | null; to?: { id: string; event_date: string; title: string; sent: boolean; start: string };
  from?: { id: string; event_date: string; title: string; sent: boolean; start: string };
}) {
  await supabase.from('change_log').insert({ entity: 'shift', entity_id: p.shift_id ?? null, change: { kind, staff: p.staff_id, from: p.from?.id ?? null, to: p.to?.id ?? null, start: p.to?.start ?? null } });
  const t = (x: { start: string }) => tTime(x.start);
  let alert: { title: string; body: string; event_id: string | null } | null = null;
  if (kind === 'booked' && p.to?.sent) alert = { title: "You're booked", body: `${aDate(p.to.event_date)} · ${p.to.title} · starts ${t(p.to)}`, event_id: p.to.id };
  if (kind === 'moved' && p.to && (p.to.sent || p.from?.sent)) alert = { title: 'Your shift changed', body: `Now ${aDate(p.to.event_date)} · ${p.to.title} · starts ${t(p.to)}${p.from ? ` (was ${p.from.title} · ${t(p.from)})` : ''}`, event_id: p.to.id };
  if (kind === 'removed' && p.from?.sent) alert = { title: `You're no longer on ${aDate(p.from.event_date)}`, body: `${p.from.title} · that shift was removed. Questions? Text Ronnie.`, event_id: null };
  if (alert) await supabase.from('staff_alerts').insert({ staff_id: p.staff_id, kind, ...alert });
}
