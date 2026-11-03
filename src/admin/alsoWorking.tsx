/* Push 46 · Two shifts the same day (admin side). When a person is picked for an event and already works another
   G&R event that day, a gold/cream info note under their name. Never blocks; no gap rule. */
import { endIso } from './api';

/** The other shift: venue (event title) + planned start / end (ISO). */
export type OtherShift = { venue: string; start: string; end: string | null };

const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });

type EvLike = { id: string; event_date: string; title: string; end_time?: string | null; shifts: { staff_id: string; planned_start: string; planned_end?: string | null; status: string; attendance?: string | null }[] };

/** The person's shifts on other events of the same day (not declined / cancelled), earliest first. */
export function otherShifts(evs: EvLike[], staffId: string, exceptEventId: string | null, day?: string): OtherShift[] {
  return evs.filter((e) => e.id !== exceptEventId && (!day || e.event_date === day))
    .flatMap((e) => e.shifts.filter((s) => s.staff_id === staffId && s.status !== 'declined' && !s.attendance)
      .map((s) => ({ venue: e.title, start: s.planned_start, end: s.planned_end ?? (e.end_time ? endIso(e.event_date, hmOf(s.planned_start), e.end_time.slice(0, 5)) : null) })))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** The note text. `start` = this shift's planned start (ISO), when known. */
export function alsoText(o: OtherShift, start: string | null) {
  const s = start ? new Date(start).getTime() : null; const os = new Date(o.start).getTime(); const oe = o.end ? new Date(o.end).getTime() : null;
  if (s != null && os < s && oe != null && oe > s) return `Also working ${o.venue} until about ${t12(o.end!)} · may arrive a bit after ${t12(start!)}`;
  const span = o.end ? `${t12(o.start)} – ${t12(o.end)}` : `from ${t12(o.start)}`;
  if (s != null && os > s) return `Also working ${o.venue} ${span} · heads there after this one`;
  return `Also working ${o.venue} ${span} · heads over when it's done`;
}

export function AlsoWorking({ others, start, compact = false }: { others: OtherShift[]; start: string | null; compact?: boolean }) {
  if (!others.length) return null;
  return <>{others.map((o, i) => { const head = `Also working ${o.venue}`; return <span key={i} className={'also-note' + (compact ? ' sm' : '')}>🕐 <b>{head}</b>{alsoText(o, start).slice(head.length)}</span>; })}</>;
}
