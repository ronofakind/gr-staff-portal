import { supabase } from '../lib/supabase';

export type AStaff = {
  id: string; full_name: string; email: string | null; phone: string | null; language: 'fr' | 'en';
  department: 'floor' | 'bar' | 'kitchen'; role: 'staff' | 'manager' | 'admin'; positions: string[];
  active: boolean; photo_url: string | null; staff_private: { ranking: number | null; notes: string | null } | null;
};

export type AShift = {
  id: string; event_id: string; staff_id: string; position_code: string | null; position_detail: string | null;
  planned_start: string; status: 'booked' | 'confirmed' | 'declined'; changed_at: string; notified_at: string | null; attendance: 'no_show' | 'cancelled' | null;
  staff: { full_name: string } | null;
};

export type AEvent = {
  id: string; event_date: string; title: string; address: string | null; department: 'floor' | 'bar' | 'kitchen';
  description: string | null; dress_code: string | null; bring: string | null;
  start_time: string | null; end_time: string | null; staff_needed: number; manager_id: string | null;
  venue_id: string | null; timeline: { time: string; label: string }[];
  event_private: { client: string | null; punch_code: string } | null;
  shifts: AShift[];
};

export const EVENT_SELECT = `id,event_date,title,address,department,description,dress_code,bring,start_time,end_time,
  staff_needed,manager_id,venue_id,timeline,event_private(client,punch_code),
  shifts(id,event_id,staff_id,position_code,position_detail,planned_start,status,changed_at,notified_at,attendance,staff:staff!shifts_staff_id_fkey(full_name))`;

export async function eventsBetween(from: string, to: string) {
  const { data, error } = await supabase.from('events').select(EVENT_SELECT)
    .gte('event_date', from).lte('event_date', to).order('event_date').order('start_time');
  if (error) throw error;
  return (data ?? []) as unknown as AEvent[];
}

export async function allStaff() {
  const { data, error } = await supabase.from('staff')
    .select('id,full_name,email,phone,language,department,role,positions,active,photo_url,staff_private(ranking,notes)')
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
