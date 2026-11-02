import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/** Push 35 · one date G&R sent (my_dates() in migration 041). */
export type MyDate = {
  id: string; for_date: string; part: string; status: 'asked' | 'yes' | 'no' | 'maybe'; from_time: string | null;
  answer_by: string | null; knows_by: string | null; knows_note: string | null;
  label: string | null; approx_start: string | null; venue: string | null; n_events: number; booked: boolean;
};

const TZ = 'America/Toronto';
export const mtlToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const D = (iso: string) => new Date(iso + 'T12:00:00');
export const addDays = (iso: string, n: number) => { const d = D(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Montreal calendar day of a timestamp. */
export const dayOf = (ts: string) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });

export const ampm = (t: string | null) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number); const hh = h % 12 || 12;
  return `${hh}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`;
};
/** "Fri Nov 13" */
export const dayLabel = (iso: string) => D(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
/** "Nov 9" */
export const monDay = (iso: string) => D(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const clock = (ts: string) => new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** Answer-by still ahead (null = no limit). */
export const isOpen = (d: MyDate, now = Date.now()) => !d.answer_by || new Date(d.answer_by).getTime() > now;
/** Waiting on them: asked, or a Maybe whose knows-by day came. Never booked, never past answer-by. */
export const toAnswer = (d: MyDate, today = mtlToday()) =>
  !d.booked && isOpen(d) && (d.status === 'asked' || (d.status === 'maybe' && !!d.knows_by && d.knows_by <= today));
export const urgent = (d: MyDate) => !!d.answer_by && new Date(d.answer_by).getTime() - Date.now() < 24 * 3600e3;
/** Latest "knows by" day allowed for these dates = earliest answer-by day (or the day before the date). */
export const latestKnows = (list: MyDate[]) => list.map((d) => (d.answer_by ? dayOf(d.answer_by) : addDays(d.for_date, -1))).sort()[0] ?? null;

/** "Answer by Fri Nov 13" · "Answer by today 7:30 PM" · "Answer by tomorrow 9 AM" */
export const answerByText = (d: MyDate) => {
  if (!d.answer_by) return '';
  const day = dayOf(d.answer_by); const t = mtlToday();
  if (day === t) return `Answer by today ${clock(d.answer_by)}`;
  if (day === addDays(t, 1)) return `Answer by tomorrow ${clock(d.answer_by)}`;
  return `Answer by ${dayLabel(day)}`;
};
/** "Le Andover · evening" (venue, never the client) · "2 events · evening" · "Evening" */
export const whereText = (d: MyDate) => {
  const part = d.part === 'day' ? 'day' : d.part === 'all' ? 'all day' : 'evening';
  const what = d.venue ?? (d.n_events > 1 ? `${d.n_events} events` : null);
  return what ? `${what} · ${part}` : part[0].toUpperCase() + part.slice(1);
};

export function useMyDates(meId: string, preview = false) {
  const [dates, setDates] = useState<MyDate[] | null>(null);
  const load = () => supabase.rpc('my_dates', preview ? { p_staff: meId } : {})
    .then(({ data, error }) => { if (error) console.warn('[my_dates]', error.message); setDates(((data ?? []) as MyDate[])); });
  useEffect(() => { load(); }, [meId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { dates, setDates, reload: load };
}

/** Tab bar badge (own count, so every page shows it). */
export function useToAnswerCount(skip: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (skip) return;
    supabase.rpc('my_dates_to_answer').then(({ data, error }) => { if (!error && typeof data === 'number') setN(data); });
  }, [skip]);
  return n;
}

/** 35c · same rule as default_answer_by() in 041 (admin side shows / pre-fills it before sending). */
export function defaultAnswerBy(forDate: string, sent = new Date()): Date {
  const away = Math.round((D(forDate).getTime() - D(sent.toLocaleDateString('en-CA', { timeZone: TZ })).getTime()) / 864e5);
  const h = away <= 7 ? 24 : away <= 14 ? 48 : away <= 30 ? 168 : 336;
  const r = new Date(sent.getTime() + h * 3600e3);
  const cap = noonMtl(forDate);
  const min2h = new Date(Math.min(r.getTime(), sent.getTime() + 2 * 3600e3));
  return new Date(Math.max(Math.min(r.getTime(), cap.getTime()), min2h.getTime()));
}
/** Noon in Montreal on that day as an instant. */
function noonMtl(iso: string) {
  const guess = new Date(iso + 'T12:00:00Z');
  const local = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (utc.getTime() - local.getTime()));
}
/** <input type="datetime-local"> value in Montreal time, and back. */
export const toLocalInput = (ts: string | Date) => {
  const s = new Date(ts).toLocaleString('sv-SE', { timeZone: TZ }); // "2026-11-13 19:30:00"
  return s.slice(0, 16).replace(' ', 'T');
};
export const fromLocalInput = (v: string) => {
  const guess = new Date(v + ':00Z');
  const local = new Date(guess.toLocaleString('en-US', { timeZone: TZ }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (utc.getTime() - local.getTime())).toISOString();
};
