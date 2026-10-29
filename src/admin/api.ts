import { supabase } from '../lib/supabase';

export type AStaff = {
  id: string; full_name: string; email: string | null; phone: string | null; language: 'fr' | 'en';
  department: 'floor' | 'bar' | 'kitchen'; role: 'staff' | 'manager' | 'admin'; positions: string[];
  active: boolean; photo_url: string | null; staff_private: { ranking: number | null; notes: string | null; tier: 'A' | 'B' | 'C' | null } | null;
};

export type AShift = {
  id: string; event_id: string; staff_id: string; position_code: string | null; position_detail: string | null;
  planned_start: string; status: 'booked' | 'confirmed' | 'declined'; changed_at: string; notified_at: string | null; attendance: 'no_show' | 'cancelled' | null; leave_by: string | null;
  punches: { punch_in: string | null; punch_out: string | null } | null; manager_note?: string | null;
  staff: { full_name: string } | null;
};

export type AEvent = {
  id: string; event_date: string; title: string; address: string | null; department: 'floor' | 'bar' | 'kitchen';
  description: string | null; dress_code: string | null; bring: string | null;
  start_time: string | null; end_time: string | null; staff_needed: number; manager_id: string | null; hours_submitted_at: string | null;
  venue_id: string | null; timeline: { time: string; label: string }[];
  event_private: { client: string | null; punch_code: string } | null;
  shifts: AShift[];
};

export const EVENT_SELECT = `id,event_date,title,address,department,description,dress_code,bring,start_time,end_time,
  staff_needed,manager_id,hours_submitted_at,venue_id,timeline,event_private(client,punch_code),
  shifts(id,event_id,staff_id,position_code,position_detail,planned_start,status,changed_at,notified_at,attendance,leave_by,manager_note,punches(punch_in,punch_out),staff:staff!shifts_staff_id_fkey(full_name))`;

export async function eventsBetween(from: string, to: string) {
  const { data, error } = await supabase.from('events').select(EVENT_SELECT)
    .gte('event_date', from).lte('event_date', to).order('event_date').order('start_time');
  if (error) throw error;
  return (data ?? []) as unknown as AEvent[];
}

export async function allStaff() {
  const { data, error } = await supabase.from('staff')
    .select('id,full_name,email,phone,language,department,role,positions,active,photo_url,staff_private(ranking,notes,tier)')
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
export const hoursBetween = (a: string | null, b: string | null) => a && b ? Math.round((new Date(b).getTime() - new Date(a).getTime()) / 900000) * 0.25 : 0;
export const tTime = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' }).replace(/\./g, '') : '';
export const dLabel = (iso: string, o: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', o).replace(/\./g, '');
