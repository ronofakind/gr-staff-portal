import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/* Push 38 · Meetings (Teams / Zoom / office meetings that aren't shifts) + meeting notes. Migration 043. */

export const TEAMS = '#5B5FC7';
const TZ = 'America/Toronto';

export type PlaceKind = 'teams' | 'zoom' | 'in_person';
export type Answer = 'coming' | 'cant' | null;
export type MyMeeting = {
  id: string; title: string; starts_at: string; duration_min: number; place_kind: PlaceKind; link: string | null; address: string | null;
  about: string | null; answer: Answer; cancelled_at: string | null; n_invited: number;
};
export type MeetingRow = Omit<MyMeeting, 'answer' | 'n_invited'> & { notes_visibility: 'managers' | 'team'; created_at: string; updated_at: string;
  md_id?: string | null; clock_started_at?: string | null }; // push 80
export type Invitee = {
  staff_id: string; full_name: string; nickname: string | null; photo_url: string | null; phone: string | null; answer: Answer; answered_at: string | null;
  paid: boolean | null; paid_in: string | null; paid_out: string | null;
};
export type MNote = {
  id: string; author_id: string | null; author: string | null; author_nickname: string | null; author_photo: string | null; body: string;
  pinned: boolean; edited_at: string | null; deleted_at: string | null; created_at: string;
  parent_id?: string | null; same?: string[]; same_me?: boolean; done_at?: string | null; apply_status?: 'sending' | 'done' | 'error' | null; // push 80
};
export type LinkedEvent = { id: string; title: string; event_date: string; department: string; venue: string };
export type MeetingPage = {
  meeting: MeetingRow; me: string | null; is_admin: boolean; is_md?: boolean; my_answer: Answer;
  organizer: { id: string; full_name: string; photo_url: string | null } | null;
  invites: Invitee[]; events: LinkedEvent[]; notes: MNote[];
};
export type MeetingHours = {
  meeting_id: string; staff_id: string; full_name: string; title: string; meeting_date: string; starts_at: string; duration_min: number;
  answer: Answer; paid: boolean; auto: boolean; paid_in: string; paid_out: string; hours: number; ended: boolean; edited_at: string | null;
};
export type EventMeetingNote = { meeting_id: string; meeting_title: string; starts_at: string; can_open: boolean; note_id: string; body: string; author: string | null; created_at: string };

export const LENGTHS: { min: number; label: string }[] = [{ min: 30, label: '30 min' }, { min: 60, label: '1 h' }, { min: 90, label: '1 h 30' }, { min: 120, label: '2 h' }];
export const PLACES: { k: PlaceKind; label: string }[] = [{ k: 'teams', label: 'Teams' }, { k: 'zoom', label: 'Zoom' }, { k: 'in_person', label: 'In person' }];

export const endOf = (m: { starts_at: string; duration_min: number }) => new Date(new Date(m.starts_at).getTime() + m.duration_min * 60000);
export const isOver = (m: { starts_at: string; duration_min: number }, now = Date.now()) => endOf(m).getTime() <= now;
/** Join button: active from 10 min before the start until the end. */
export const joinOpen = (m: { starts_at: string; duration_min: number }, now = Date.now()) =>
  now >= new Date(m.starts_at).getTime() - 10 * 60000 && now < endOf(m).getTime();
export const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export const dayOfMtl = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
export const todayMtl = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
/** "THU, NOV 12" */
export const dayCaps = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ }).toUpperCase();
/** "Thu Nov 12" */
export const dayShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ }).replace(',', '');
/** "Nov 12" */
export const monDayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: TZ });
/** "1 hour" · "30 min" · "1 h 30" · "2 hours" */
export const lengthLabel = (min: number) => min % 60 === 0 ? `${min / 60} hour${min === 60 ? '' : 's'}` : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60}`;
export const placeName = (m: { place_kind: PlaceKind; address: string | null }) =>
  m.place_kind === 'teams' ? 'Microsoft Teams' : m.place_kind === 'zoom' ? 'Zoom' : (m.address?.split(',')[0] ?? 'In person');
export const joinLabel = (k: PlaceKind) => (k === 'zoom' ? 'Join on Zoom' : 'Join on Teams');
export const placeLetter = (k: PlaceKind) => (k === 'teams' ? 'T' : k === 'zoom' ? 'Z' : '');
/** "IN 10 DAYS" · "TOMORROW" · "TODAY" · "NOW" */
export function whenWord(m: { starts_at: string; duration_min: number }, now = Date.now()) {
  const d = dayOfMtl(m.starts_at); const t = todayMtl();
  if (now >= new Date(m.starts_at).getTime() && now < endOf(m).getTime()) return 'NOW';
  if (d === t) return 'TODAY';
  const days = Math.round((new Date(d + 'T12:00:00').getTime() - new Date(t + 'T12:00:00').getTime()) / 864e5);
  if (days === 1) return 'TOMORROW';
  if (days > 1) return `IN ${days} DAYS`;
  return '';
}
export const directionsUrl = (a: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`;
/** Only http(s) links are opened. */
export const safeLink = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

/** Who can be invited (same rule as can_meet() in 043): managers, MDs, bar managers, 2ICs. Never the admin. */
export const canMeet = (s: { role: string; active?: boolean; md_rank?: number | null; positions?: string[] | null }) =>
  s.active !== false && s.role !== 'admin' && (s.role === 'manager' || s.md_rank != null || (s.positions ?? []).some((p) => ['MD', 'BM', '2IC'].includes(p.toUpperCase())));

/** Montreal date + "HH:MM" → ISO instant. */
export function mtlIso(date: string, hm: string) {
  const guess = new Date(`${date}T${hm}:00Z`);
  const local = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (utc.getTime() - local.getTime())).toISOString();
}
export const hm24 = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

/** My meetings not over yet (Home, My dates). [] until migration 043 is applied. */
export function useMyMeetings(meId: string, preview = false) {
  const [list, setList] = useState<MyMeeting[] | null>(null);
  const load = () => supabase.rpc('my_meetings', preview ? { p_staff: meId } : {})
    .then(({ data, error }) => setList(error ? [] : ((data ?? []) as MyMeeting[])));
  useEffect(() => { load(); }, [meId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { meetings: list, reload: load, setMeetings: setList };
}

export async function answerMeeting(id: string, answer: 'coming' | 'cant') {
  const { error } = await supabase.rpc('answer_meeting', { p_meeting: id, p_answer: answer });
  return error?.message ?? null;
}

/** Morning of a meeting: writes the "Today · 11:00 AM" update in Messages (once per day per device is enough). */
let checkedOn = '';
export function meetingMorningCheck() {
  const t = todayMtl();
  const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ })) % 24;
  if (checkedOn === t || hour < 6) return Promise.resolve(); // the server writes it from 6 AM only
  checkedOn = t;
  return Promise.resolve(supabase.rpc('meeting_morning_check')).then(() => {}, () => {});
}
