import { supabase } from '../lib/supabase';
import type { AEvent, Client, Venue } from './api';

/* Push 27a · booking rules (admin only, never shown to staff). The app owns them now (no write-back to the Hub). */
export type LinkKind = 'together' | 'apart';
export type SLink = { staff_a: string; staff_b: string; kind: LinkKind; reason: string | null };
export type CondKind = 'not_venue' | 'private_only' | 'big_dates_only' | 'only_if_needed' | 'not_weekday' | 'min_guests';
export type SCond = { id: string; staff_id: string; kind: CondKind; value: string | null; reason: string | null };
export const DOW3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
export async function loadRules(): Promise<{ links: SLink[]; conds: SCond[] }> {
  const [l, c] = await Promise.all([
    supabase.from('staff_links').select('staff_a,staff_b,kind,reason'),
    supabase.from('staff_conditions').select('id,staff_id,kind,value,reason'),
  ]);
  const links = (Array.isArray(l.data) ? l.data : []).filter((x) => isObj(x) && typeof x.staff_a === 'string' && typeof x.staff_b === 'string')
    .map((x) => ({ ...(x as SLink), kind: (x as SLink).kind === 'apart' ? 'apart' : 'together' } as SLink));
  const conds = (Array.isArray(c.data) ? c.data : []).filter((x) => isObj(x) && typeof x.staff_id === 'string' && typeof x.kind === 'string') as SCond[];
  return { links, conds };
}

export const other = (l: SLink, sid: string) => (l.staff_a === sid ? l.staff_b : l.staff_a);
export const linksOf = (links: SLink[], sid: string, kind?: LinkKind) => links.filter((l) => (l.staff_a === sid || l.staff_b === sid) && (!kind || l.kind === kind));

export function condLabel(c: SCond) {
  switch (c.kind) {
    case 'not_venue': return `Not at ${c.value ?? 'a venue'}`;
    case 'private_only': return 'Private houses only';
    case 'big_dates_only': return 'Big dates only';
    case 'only_if_needed': return 'Only if needed';
    case 'not_weekday': return `Not on ${(c.value ?? '').split(',').filter(Boolean).join(', ')}`;
    case 'min_guests': return `Only events over ${c.value} guests (old rule)`;
  }
}
export const condShort = (c: SCond) => c.kind === 'not_venue' ? `no ${c.value}` : c.kind === 'min_guests' ? `${c.value}+ guests` : c.kind === 'big_dates_only' ? 'big dates only' : c.kind === 'only_if_needed' ? 'only if needed' : c.kind === 'private_only' ? 'private houses only' : `not ${c.value}`;

/** Private house = the event's client is a private home (clients.kind), or the event has no venue (just an address) and isn't a roaming client. */
export function isPrivateEvent(e: AEvent, clients: Client[]) {
  const cid = (e.event_private as { client_id?: string | null } | null)?.client_id;
  const cl = cid ? clients.find((c) => c.id === cid) : clients.find((c) => c.name === e.event_private?.client);
  if (cl?.kind === 'private_home') return true;
  if (cl?.kind === 'roaming') return false;
  return !e.venue_id;
}
const dowOf = (iso: string) => (new Date(iso + 'T12:00:00').getDay() + 6) % 7;

/** Rules that don't fit this person on this event (never blocking). big = the date is big (25+ floor). */
export function misfits(sid: string, e: AEvent, ctx: { conds: SCond[]; clients: Client[]; venues: Venue[]; big: boolean }) {
  const out: { kind: CondKind; text: string }[] = [];
  const venue = ctx.venues.find((v) => v.id === e.venue_id)?.name ?? '';
  const hay = `${e.title} ${e.event_private?.client ?? ''} ${venue}`.toLowerCase();
  for (const k of ctx.conds.filter((c) => c.staff_id === sid)) {
    if (k.kind === 'not_venue' && k.value && hay.includes(k.value.toLowerCase())) out.push({ kind: k.kind, text: `doesn't do ${k.value}` });
    if (k.kind === 'private_only' && !isPrivateEvent(e, ctx.clients)) out.push({ kind: k.kind, text: 'does private houses only · this is a venue' });
    if (k.kind === 'big_dates_only' && !ctx.big) out.push({ kind: k.kind, text: 'big dates only · this date is not big' });
    if (k.kind === 'only_if_needed') out.push({ kind: k.kind, text: 'only if needed' });
    if (k.kind === 'not_weekday' && k.value && k.value.split(',').includes(DOW3[dowOf(e.event_date)])) out.push({ kind: k.kind, text: `not on ${DOW3[dowOf(e.event_date)]}` });
    if (k.kind === 'min_guests' && k.value && !((e.guests ?? 0) > Number(k.value))) out.push({ kind: k.kind, text: `only events over ${k.value} guests` });
  }
  return out;
}

/** ♥ n · ⊘ n · ⌂ n next to names in Staff and Bookings lists. */
export function RuleIcons({ sid, links, conds }: { sid: string; links: SLink[]; conds: SCond[] }) {
  const t = linksOf(links, sid, 'together').length; const a = linksOf(links, sid, 'apart').length; const c = conds.filter((x) => x.staff_id === sid).length;
  if (!t && !a && !c) return null;
  return (
    <span className="ru-icons" title={`${t} works well with · ${a} keep apart · ${c} when-to-book rule${c === 1 ? '' : 's'}`}>
      {t > 0 && <i className="ru-i ok">♥ {t}</i>}{a > 0 && <i className="ru-i red">⊘ {a}</i>}{c > 0 && <i className="ru-i gold">⌂ {c}</i>}
    </span>
  );
}
