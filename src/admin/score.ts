import { supabase } from '../lib/supabase';
import { addDays, isoDay, flagsOf, type AStaff } from './api';
import { setting, loadSettings } from '../lib/settings';

/* Push 27c · one score per person (admin only). Computed on load from the app data.
   Push 32: the weights come from Settings → Ranking weights (app_settings); the defaults are Ronnie's Oct 31 values. */
export function weights() {
  const t = setting('rank.tier'); const r = setting('rank.reliability'); const e = setting('rank.experience'); const f = setting('rank.feedback'); const x = setting('rank.extras');
  return {
    tier: { A: t.A, B: t.B, C: t.C } as Record<string, number>,
    reliability: { start: r.start, no_show: r.no_show, late_cancel: r.late_cancel, late: r.late, late_change: r.late_change, min: 0, days: r.days },
    // push 28: late cancel = cancelled after they confirmed (plain cancels before confirming don't count); "late" doesn't count when they
    // started by the ETA they gave in I'm running late; late_change = a time change Ronnie accepted with "Count it in reliability" on.
    experience: { SENIOR: e.SENIOR, MID: e.MID, JUNIOR: e.JUNIOR } as Record<string, number>,
    // push 30: overall stars 5 +1 · 4 +0.5 · 3 0 · 2 −1 · 1 −2; each detail star rating ≥4 +0.5, ≤2 −0.5.
    // Rows from before push 30 (overall_stars null) keep the push-27 points: vote A +1 · B 0 · C −2, ▲ +0.5 · ▼ −0.5.
    feedback: { last: 10, stars: { 5: f.s5, 4: f.s4, 3: f.s3, 2: f.s2, 1: f.s1 } as Record<number, number>, hi: 0.5, lo: -0.5,
      vote: { A: 1, B: 0, C: -2 } as Record<string, number>, up: 0.5, down: -0.5, cap: f.cap },
    extras: { bmo: x.bmo, newStaff: x.newStaff, priority: x.priority },
    newUnder: setting('bookings.new_tag_shifts'), // fewer than 3 finished shifts = new
  };
}

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
export type Priv = { staff_id: string; experience: string | null; bmo_fit: boolean | null; priority_until: string | null; veteran: boolean | null; rel_seed?: string | null; shifts_seed?: number | null };
type Sh = { id?: string; staff_id: string; attendance: string | null; planned_start: string; status: string; punches: { punch_in: string | null; punch_out: string | null } | null; events: { event_date: string } | null;
  cancel_self?: boolean; cancel_late?: boolean; late_eta?: string | null; cancelled_at?: string | null };
/** Nov 5 · Ranking v3: date asks (Says yes / Saves the day) */
type Av = { staff_id: string; status: string; for_date: string; asked_at: string | null; answered_at: string | null };

export type ScoreData = { priv: Record<string, Priv>; shifts: Sh[]; feedback: Feedback[]; done: Record<string, number>; lateChanges?: Record<string, number>; asks?: Av[] };
/** Nov 5 · Ranking v3 parts (shown in Why this score) */
export type Part = { key: string; label: string; pts: number; max: number; sub: string; counted: boolean };
export type Score = {
  total: number; tier: number; reliability: number; experience: number; feedback: number; extras: number;
  rel: { no_show: number; cancelled: number; late: number; late_change: number; free: number };
  /** stars = overall stars of the push-30 rows (newest first), hi / lo = detail stars ≥4 / ≤2, old = push-27 rows (A/B/C + ▲●▼ points) */
  fb: { n: number; votes: { A: number; B: number; C: number }; up: number; ok: number; down: number; stars: number[]; hi: number; lo: number; old: number };
  isNew: boolean; done: number; bmo: boolean; priority: string | null; exp: string | null;
  /** Ranking v3 · form score 0–100 (sorts people inside their tier) + its parts */
  form: number; parts: Part[];
  suggest: { to: 'A' | 'B' | 'C'; why: string } | null;
};

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = <T,>(x: unknown, ok: (y: Record<string, unknown>) => boolean): T[] => (Array.isArray(x) ? x.filter((y) => isObj(y) && ok(y)) as T[] : []);

/** Everything the score needs, in 4 reads. Shapes are checked (the mock harness can return junk). */
export async function loadScoreData(): Promise<ScoreData> {
  await loadSettings();
  const today = isoDay(new Date()); const since = addDays(today, -weights().reliability.days);
  const shq = (extra: string) => supabase.from('shifts').select('id,staff_id,attendance,planned_start,status,punches(punch_in,punch_out),events!inner(event_date)' + extra).neq('status', 'declined').gte('events.event_date', since).lte('events.event_date', today);
  const [p, s0, f, c, ln, cr, av] = await Promise.all([
    supabase.from('staff_private').select('staff_id,experience,bmo_fit,priority_until,veteran,rel_seed,shifts_seed').then((r) => (r.error ? supabase.from('staff_private').select('staff_id,experience,bmo_fit,priority_until,veteran') : r)),
    shq(',cancel_self,cancel_late,cancelled_at').then((r) => (r.error ? shq(',cancel_self,cancel_late') : r)),
    loadFeedback(),
    supabase.rpc('staff_shift_counts'),
    supabase.from('late_notices').select('shift_id,eta'), // push 28 · errors (034 not applied) → no notices
    supabase.from('shift_change_requests').select('staff_id,created_at').eq('count_reliability', true).eq('status', 'accepted').gte('created_at', since + 'T00:00:00Z'),
    supabase.from('availability').select('staff_id,status,for_date,asked_at,answered_at').not('ask_id', 'is', null).gte('for_date', since).lte('for_date', today),
  ]);
  const s = s0.error ? await shq('') : s0; // migration 034 not applied yet
  const eta: Record<string, string> = {};
  for (const r of arr<{ shift_id: string; eta: string }>(ln.error ? [] : ln.data, (y) => typeof y.shift_id === 'string' && typeof y.eta === 'string')) eta[r.shift_id] = r.eta;
  const lateChanges: Record<string, number> = {};
  for (const r of arr<{ staff_id: string }>(cr.error ? [] : cr.data, (y) => typeof y.staff_id === 'string')) lateChanges[r.staff_id] = (lateChanges[r.staff_id] ?? 0) + 1;
  const priv: Record<string, Priv> = {};
  for (const r of arr<Priv>(p.data, (y) => typeof y.staff_id === 'string')) priv[r.staff_id] = r;
  const done: Record<string, number> = {};
  for (const r of arr<{ staff_id: string; done: number }>(c.data, (y) => typeof y.staff_id === 'string' && typeof y.done === 'number')) done[r.staff_id] = r.done;
  const feedback = arr<Feedback>(f.data, (y) => typeof y.staff_id === 'string' && typeof y.created_at === 'string').map((x) => ({ ...x, overall_stars: isStar(x.overall_stars) ? x.overall_stars : null, ratings: isObj(x.ratings) ? x.ratings : {} }));
  const shifts = arr<Sh>(s.data, (y) => typeof y.staff_id === 'string' && typeof y.planned_start === 'string').map((x) => ({ ...x, late_eta: x.id ? eta[x.id] ?? null : null }));
  const asks = arr<Av>(av.error ? [] : av.data, (y) => typeof y.staff_id === 'string' && typeof y.status === 'string');
  return { priv, shifts, feedback, done, lateChanges, asks };
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
  const W = weights(); const pv = d.priv[st.id]; const tierL = st.staff_private?.tier ?? null;
  const tier = tierL ? W.tier[tierL] ?? 0 : 0;
  const rel = { no_show: 0, cancelled: 0, late: 0, late_change: d.lateChanges?.[st.id] ?? 0, free: 0 };
  for (const s of d.shifts) if (s.staff_id === st.id) for (const f of flagsOf(s)) {
    if (f.free) { rel.free++; continue; } // push 28: cancel before confirming / late but by the ETA they gave → not counted
    if (f.flag === 'no_show' || f.flag === 'cancelled' || f.flag === 'late') rel[f.flag]++;
  }
  // Cancelled = a staff cancel after confirming (push 28), or marked by the manager on the night → late cancel.
  const reliability = Math.max(W.reliability.min, W.reliability.start + rel.no_show * W.reliability.no_show + rel.cancelled * W.reliability.late_cancel + rel.late * W.reliability.late + rel.late_change * W.reliability.late_change);
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
  // ── Ranking v3 (Ronnie, Nov 5): tier first, then a form score out of 100. Parts with no data yet are left out and the rest is scaled to 100.
  const parts: Part[] = [];
  const EXP: Record<string, number> = { SENIOR: 25, MID: 15, JUNIOR: 5 };
  parts.push({ key: 'exp', label: 'Experience level', pts: exp ? EXP[exp] ?? 0 : 0, max: 25, sub: exp ? exp[0] + exp.slice(1).toLowerCase() : 'not set yet · set it on the profile', counted: true });
  const SEED: Record<string, number> = { VERY: 25, USUALLY: 19, NEEDS: 13, RISK: 8 };
  let r3 = SEED[pv?.rel_seed ?? ''] ?? 25; const why: string[] = [pv?.rel_seed ? `starts at ${r3} (Staff Hub: ${({ VERY: 'very reliable', USUALLY: 'usually reliable', NEEDS: 'needs confirmation', RISK: 'last-minute risk' } as Record<string, string>)[pv.rel_seed]})` : 'starts at 25'];
  for (const sh of d.shifts) if (sh.staff_id === st.id) for (const f of flagsOf(sh)) {
    if (f.free) continue;
    if (f.flag === 'no_show') { r3 -= 12; why.push('no-show −12'); }
    else if (f.flag === 'cancelled') { const h = sh.cancelled_at ? (new Date(sh.planned_start).getTime() - new Date(sh.cancelled_at).getTime()) / 36e5 : 0;
      const pen = h >= 168 ? 0 : h >= 48 ? 3 : 6; if (pen) { r3 -= pen; why.push(`cancel ${h >= 48 ? '2–7 days ahead' : 'under 48 h'} −${pen}`); } else why.push('cancel 7+ days ahead · free'); }
    else if (f.flag === 'late') { r3 -= 2; why.push('late −2'); }
  }
  if (rel.late_change) { r3 -= 2 * rel.late_change; why.push(`${rel.late_change} late change −${2 * rel.late_change}`); }
  parts.push({ key: 'rel', label: 'Reliability', pts: Math.max(0, r3), max: 25, sub: why.join(' · '), counted: true });
  const starsW = fb.stars.map((v, i) => ({ v, w: 1 - i * 0.05 })); // newest first, newer count more
  const avgW = starsW.length ? starsW.reduce((n, x) => n + x.v * x.w, 0) / starsW.reduce((n, x) => n + x.w, 0) : 0;
  parts.push({ key: 'fb', label: 'Manager feedback', pts: Math.round(20 * avgW / 5 * 10) / 10, max: 20, sub: fb.stars.length ? `★${avgW.toFixed(1)} · last ${fb.stars.length} rating${fb.stars.length > 1 ? 's' : ''}` : 'no ratings yet · not counted', counted: fb.stars.length > 0 });
  const asks = (d.asks ?? []).filter((a) => a.staff_id === st.id);
  const answered = asks.filter((a) => a.status === 'yes' || a.status === 'no'); const yes = answered.filter((a) => a.status === 'yes').length;
  parts.push({ key: 'yes', label: 'Says yes', pts: answered.length ? Math.round(15 * yes / answered.length * 10) / 10 : 0, max: 15, sub: answered.length ? `${yes} yes of ${answered.length} answered` : 'not enough answers yet · not counted', counted: answered.length >= 3 });
  const worked = new Set(d.shifts.filter((x) => x.staff_id === st.id && x.punches?.punch_in && x.events).map((x) => x.events!.event_date));
  const lastMin = asks.filter((a) => a.asked_at && new Date(a.for_date + 'T17:00:00').getTime() - new Date(a.asked_at).getTime() < 48 * 36e5);
  const saves = lastMin.filter((a) => a.status === 'yes' && worked.has(a.for_date)).length;
  parts.push({ key: 'save', label: 'Saves the day', pts: Math.min(10, saves * 5), max: 10, sub: lastMin.length ? `${saves} last-minute yes${saves === 1 ? '' : 'es'} worked` : 'no last-minute asks yet · not counted', counted: lastMin.length > 0 });
  const shiftsAll = (pv?.shifts_seed ?? 0) + done;
  parts.push({ key: 'time', label: 'Time with G&R', pts: Math.min(5, Math.round(shiftsAll / 10 * 10) / 10), max: 5, sub: `${shiftsAll} shift${shiftsAll === 1 ? '' : 's'}${pv?.shifts_seed ? ` (${pv.shifts_seed} on payroll this year)` : ''}`, counted: true });
  const inn = parts.filter((x) => x.counted); const got = inn.reduce((n, x) => n + x.pts, 0); const max = inn.reduce((n, x) => n + x.max, 0);
  const form = Math.min(100, Math.round((max ? got / max * 100 : 0) + (priority ? 10 : 0)));
  if (!suggest && tierL) {
    if (tierL !== 'A' && form >= 85 && shiftsAll >= 10) suggest = { to: up(tierL), why: `form ${form} over ${shiftsAll} shifts` };
    else if (tierL !== 'C' && form < 50) suggest = { to: down(tierL), why: `form ${form}` };
  }
  const band = tierL === 'A' ? 300 : tierL === 'B' ? 200 : tierL === 'C' ? 100 : 0;
  return { total: band + form, tier, reliability, experience, feedback, extras, rel, fb, isNew, done, bmo, priority, exp, suggest, form, parts };
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
