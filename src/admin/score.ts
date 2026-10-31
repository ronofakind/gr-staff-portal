import { supabase } from '../lib/supabase';
import { addDays, isoDay, flagsOf, type AStaff } from './api';

/* Push 27c · one score per person (admin only). Computed on load from the app data.
   Weights live here so they can be changed in one place (Ronnie, Oct 31: final defaults). */
export const WEIGHTS = {
  tier: { A: 100, B: 60, C: 30 } as Record<string, number>,
  reliability: { start: 6, no_show: -3, late_cancel: -2, late: -1, min: 0, days: 90 },
  experience: { SENIOR: 3, MID: 2, JUNIOR: 1 } as Record<string, number>,
  feedback: { last: 10, vote: { A: 1, B: 0, C: -2 } as Record<string, number>, up: 0.5, down: -0.5, cap: 10 },
  extras: { bmo: 2, newStaff: -3, priority: 20 },
  newUnder: 3, // fewer than 3 finished shifts = new
};

export const AREAS: { key: string; label: string; sub?: string }[] = [
  { key: 'punctuality', label: 'Punctuality', sub: 'on time, ready at call' },
  { key: 'attitude', label: 'Attitude' },
  { key: 'presentation', label: 'Presentation', sub: 'uniform, grooming' },
  { key: 'experience', label: 'Experience', sub: 'service, wine, plating' },
  { key: 'teamwork', label: 'Teamwork', sub: 'helps others' },
  { key: 'guest', label: 'Guest service', sub: 'polite, attentive' },
];
export type Rating = 'up' | 'ok' | 'down';
export const RATING_ICON: Record<Rating, string> = { up: '▲', ok: '●', down: '▼' };

export type Feedback = { id: string; staff_id: string; event_id: string; by_staff_id: string; tier_vote: 'A' | 'B' | 'C' | null; ratings: Record<string, Rating>; note: string | null; created_at: string; archived_at: string | null;
  by?: { full_name: string } | null; events?: { title: string; event_date: string } | null };
export type Priv = { staff_id: string; experience: string | null; bmo_fit: boolean | null; priority_until: string | null; veteran: boolean | null };
type Sh = { staff_id: string; attendance: string | null; planned_start: string; status: string; punches: { punch_in: string | null; punch_out: string | null } | null; events: { event_date: string } | null };

export type ScoreData = { priv: Record<string, Priv>; shifts: Sh[]; feedback: Feedback[]; done: Record<string, number> };
export type Score = {
  total: number; tier: number; reliability: number; experience: number; feedback: number; extras: number;
  rel: { no_show: number; cancelled: number; late: number };
  fb: { n: number; votes: { A: number; B: number; C: number }; up: number; ok: number; down: number };
  isNew: boolean; done: number; bmo: boolean; priority: string | null; exp: string | null;
  suggest: { to: 'A' | 'B' | 'C'; why: string } | null;
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = <T,>(x: unknown, ok: (y: Record<string, unknown>) => boolean): T[] => (Array.isArray(x) ? x.filter((y) => isObj(y) && ok(y)) as T[] : []);

/** Everything the score needs, in 4 reads. Shapes are checked (the mock harness can return junk). */
export async function loadScoreData(): Promise<ScoreData> {
  const today = isoDay(new Date()); const since = addDays(today, -WEIGHTS.reliability.days);
  const [p, s, f, c] = await Promise.all([
    supabase.from('staff_private').select('staff_id,experience,bmo_fit,priority_until,veteran'),
    supabase.from('shifts').select('staff_id,attendance,planned_start,status,punches(punch_in,punch_out),events!inner(event_date)').neq('status', 'declined').gte('events.event_date', since).lte('events.event_date', today),
    supabase.from('staff_feedback').select('id,staff_id,event_id,by_staff_id,tier_vote,ratings,note,created_at,archived_at,by:staff!staff_feedback_by_staff_id_fkey(full_name),events(title,event_date)').order('created_at', { ascending: false }).limit(2000),
    supabase.rpc('staff_shift_counts'),
  ]);
  const priv: Record<string, Priv> = {};
  for (const r of arr<Priv>(p.data, (y) => typeof y.staff_id === 'string')) priv[r.staff_id] = r;
  const done: Record<string, number> = {};
  for (const r of arr<{ staff_id: string; done: number }>(c.data, (y) => typeof y.staff_id === 'string' && typeof y.done === 'number')) done[r.staff_id] = r.done;
  const feedback = arr<Feedback>(f.data, (y) => typeof y.staff_id === 'string' && typeof y.created_at === 'string').map((x) => ({ ...x, ratings: isObj(x.ratings) ? x.ratings : {} }));
  const shifts = arr<Sh>(s.data, (y) => typeof y.staff_id === 'string' && typeof y.planned_start === 'string');
  return { priv, shifts, feedback, done };
}

/** Score for one person. Tier comes from staff_private (set by Ronnie), the rest from the app. */
export function scoreOf(st: AStaff, d: ScoreData, today = isoDay(new Date())): Score {
  const W = WEIGHTS; const pv = d.priv[st.id]; const tierL = st.staff_private?.tier ?? null;
  const tier = tierL ? W.tier[tierL] ?? 0 : 0;
  const rel = { no_show: 0, cancelled: 0, late: 0 };
  for (const s of d.shifts) if (s.staff_id === st.id) for (const f of flagsOf(s)) if (f.flag in rel) rel[f.flag as keyof typeof rel]++;
  // Cancelled in the app = marked by the manager on the night, so it always counts as a late cancel (< 48 h).
  const reliability = Math.max(W.reliability.min, W.reliability.start + rel.no_show * W.reliability.no_show + rel.cancelled * W.reliability.late_cancel + rel.late * W.reliability.late);
  const exp = pv?.experience ?? null; const experience = exp ? W.experience[exp] ?? 0 : 0;
  const mine = d.feedback.filter((f) => f.staff_id === st.id).slice(0, W.feedback.last);
  const fb = { n: mine.length, votes: { A: 0, B: 0, C: 0 }, up: 0, ok: 0, down: 0 };
  let fRaw = 0;
  for (const f of mine) {
    if (f.tier_vote) { fb.votes[f.tier_vote]++; fRaw += W.feedback.vote[f.tier_vote] ?? 0; }
    for (const v of Object.values(f.ratings ?? {})) { if (v === 'up') { fb.up++; fRaw += W.feedback.up; } else if (v === 'down') { fb.down++; fRaw += W.feedback.down; } else if (v === 'ok') fb.ok++; }
  }
  const feedback = Math.max(-W.feedback.cap, Math.min(W.feedback.cap, fRaw));
  const done = d.done[st.id] ?? 0; const isNew = !pv?.veteran && done < W.newUnder;
  const bmo = !!pv?.bmo_fit; const priority = pv?.priority_until && pv.priority_until >= today ? pv.priority_until : null;
  const extras = (bmo ? W.extras.bmo : 0) + (isNew ? W.extras.newStaff : 0) + (priority ? W.extras.priority : 0);
  // Tiers never change on their own: only a suggestion.
  let suggest: Score['suggest'] = null;
  const up = (t: string) => (t === 'C' ? 'B' : 'A') as 'A' | 'B';
  const down = (t: string) => (t === 'A' ? 'B' : 'C') as 'B' | 'C';
  if (tierL) {
    const below = tierL === 'A' ? fb.votes.B + fb.votes.C : tierL === 'B' ? fb.votes.C : 0;
    const above = tierL === 'C' ? fb.votes.A + fb.votes.B : tierL === 'B' ? fb.votes.A : 0;
    if (tierL !== 'C' && below >= 3) suggest = { to: down(tierL), why: `${below} vote${below > 1 ? 's' : ''} below ${tierL} in the last ${fb.n}` };
    else if (tierL !== 'A' && above >= 4) suggest = { to: up(tierL), why: `${above} votes above ${tierL} in the last ${fb.n}` };
  }
  return { total: Math.round((tier + reliability + experience + feedback + extras) * 10) / 10, tier, reliability, experience, feedback, extras, rel, fb, isNew, done, bmo, priority, exp, suggest };
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
