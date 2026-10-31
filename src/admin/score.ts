import { supabase } from '../lib/supabase';
import { addDays, isoDay, flagsOf, type AStaff } from './api';

/* Push 27c · one score per person (admin only). Computed on load from the app data.
   Weights live here so they can be changed in one place (Ronnie, Oct 31: final defaults). */
export const WEIGHTS = {
  tier: { A: 100, B: 60, C: 30 } as Record<string, number>,
  reliability: { start: 6, no_show: -3, late_cancel: -2, late: -1, min: 0, days: 90 },
  experience: { SENIOR: 3, MID: 2, JUNIOR: 1 } as Record<string, number>,
  // push 30: overall stars 5 +1 · 4 +0.5 · 3 0 · 2 −1 · 1 −2; each detail star rating ≥4 +0.5, ≤2 −0.5.
  // Rows from before push 30 (overall_stars null) keep the push-27 points: vote A +1 · B 0 · C −2, ▲ +0.5 · ▼ −0.5.
  feedback: { last: 10, stars: { 5: 1, 4: 0.5, 3: 0, 2: -1, 1: -2 } as Record<number, number>, hi: 0.5, lo: -0.5,
    vote: { A: 1, B: 0, C: -2 } as Record<string, number>, up: 0.5, down: -0.5, cap: 10 },
  extras: { bmo: 2, newStaff: -3, priority: 20 },
  newUnder: 3, // fewer than 3 finished shifts = new
};

export const AREAS: { key: string; label: string; sub?: string }[] = [
  { key: 'punctuality', label: 'Punctuality', sub: 'on time, ready at call' },
  { key: 'attitude', label: 'Attitude' },
  { key: 'presentation', label: 'Presentation', sub: 'uniform, grooming' },
  { key: 'experience', label: 'Experience', sub: 'service, wine, plating' },
  { key: 'teamwork', label: 'Teamwork' },
  { key: 'guest', label: 'Guest service' },
];
/** push-27 ratings ("up"/"ok"/"down") or push-30 stars (1–5). Tell rows apart by overall_stars (null = push 27). */
export type Rating = 'up' | 'ok' | 'down' | number;
export const isStar = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
export const RATING_ICON: Record<Rating, string> = { up: '▲', ok: '●', down: '▼' };

export type Feedback = { id: string; staff_id: string; event_id: string; by_staff_id: string; tier_vote: 'A' | 'B' | 'C' | null; overall_stars: number | null; ratings: Record<string, Rating>; note: string | null; created_at: string; archived_at: string | null;
  by?: { full_name: string } | null; events?: { title: string; event_date: string } | null };
export type Priv = { staff_id: string; experience: string | null; bmo_fit: boolean | null; priority_until: string | null; veteran: boolean | null };
type Sh = { staff_id: string; attendance: string | null; planned_start: string; status: string; punches: { punch_in: string | null; punch_out: string | null } | null; events: { event_date: string } | null };

export type ScoreData = { priv: Record<string, Priv>; shifts: Sh[]; feedback: Feedback[]; done: Record<string, number> };
export type Score = {
  total: number; tier: number; reliability: number; experience: number; feedback: number; extras: number;
  rel: { no_show: number; cancelled: number; late: number };
  /** stars = overall stars of the push-30 rows (newest first), hi / lo = detail stars ≥4 / ≤2, old = push-27 rows (A/B/C + ▲●▼ points) */
  fb: { n: number; votes: { A: number; B: number; C: number }; up: number; ok: number; down: number; stars: number[]; hi: number; lo: number; old: number };
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
    loadFeedback(),
    supabase.rpc('staff_shift_counts'),
  ]);
  const priv: Record<string, Priv> = {};
  for (const r of arr<Priv>(p.data, (y) => typeof y.staff_id === 'string')) priv[r.staff_id] = r;
  const done: Record<string, number> = {};
  for (const r of arr<{ staff_id: string; done: number }>(c.data, (y) => typeof y.staff_id === 'string' && typeof y.done === 'number')) done[r.staff_id] = r.done;
  const feedback = arr<Feedback>(f.data, (y) => typeof y.staff_id === 'string' && typeof y.created_at === 'string').map((x) => ({ ...x, overall_stars: isStar(x.overall_stars) ? x.overall_stars : null, ratings: isObj(x.ratings) ? x.ratings : {} }));
  const shifts = arr<Sh>(s.data, (y) => typeof y.staff_id === 'string' && typeof y.planned_start === 'string');
  return { priv, shifts, feedback, done };
}

const FB_COLS = 'id,staff_id,event_id,by_staff_id,tier_vote,ratings,note,created_at,archived_at,by:staff!staff_feedback_by_staff_id_fkey(full_name),events(title,event_date)';
/** Feedback rows, newest first. Falls back to the push-27 columns while migration 033 (overall_stars) isn't applied. */
async function loadFeedback() {
  const q = (cols: string) => supabase.from('staff_feedback').select(cols).order('created_at', { ascending: false }).limit(2000);
  const r = await q(FB_COLS + ',overall_stars');
  return r.error && /overall_stars/.test(r.error.message) ? q(FB_COLS) : r;
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
  const fb: Score['fb'] = { n: mine.length, votes: { A: 0, B: 0, C: 0 }, up: 0, ok: 0, down: 0, stars: [], hi: 0, lo: 0, old: 0 };
  let fRaw = 0;
  for (const f of mine) {
    if (f.tier_vote) fb.votes[f.tier_vote]++; // votes always drive the tier suggestion
    if (f.overall_stars) {
      // push 30: stars score, the tier vote adds no points
      fb.stars.push(f.overall_stars); fRaw += W.feedback.stars[f.overall_stars] ?? 0;
      for (const v of Object.values(f.ratings ?? {})) if (isStar(v)) { if (v >= 4) { fb.hi++; fRaw += W.feedback.hi; } else if (v <= 2) { fb.lo++; fRaw += W.feedback.lo; } }
    } else {
      fb.old++;
      if (f.tier_vote) fRaw += W.feedback.vote[f.tier_vote] ?? 0;
      for (const v of Object.values(f.ratings ?? {})) { if (v === 'up') { fb.up++; fRaw += W.feedback.up; } else if (v === 'down') { fb.down++; fRaw += W.feedback.down; } else if (v === 'ok') fb.ok++; }
    }
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

/** Average of star values, 1 decimal (0 when none). */
export const avgStars = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : 0);
/** "Why this score" text for manager feedback (push 30 stars + any push-27 rows). */
export function fbWhy(fb: Score['fb']) {
  if (!fb.n) return 'no feedback yet';
  const parts: string[] = [];
  if (fb.stars.length) parts.push(`overall ${avgStars(fb.stars)}★ avg (${fb.stars.map((x) => x + '★').join(' ')})`);
  if (fb.hi || fb.lo) parts.push(`details ≥4★ ${fb.hi} · ≤2★ ${fb.lo}`);
  if (fb.old) parts.push(`${fb.old} older A/B/C row${fb.old > 1 ? 's' : ''}${fb.up || fb.down ? ` · ▲${fb.up} ▼${fb.down}` : ''}`);
  parts.push(`votes A ${fb.votes.A} · B ${fb.votes.B} · C ${fb.votes.C}${fb.stars.length ? (fb.old ? ' (points only on older rows)' : ' (tier suggestion only)') : ''}`);
  return `last ${fb.n}: ${parts.join(' · ')}`;
}

export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
