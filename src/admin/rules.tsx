import { supabase } from '../lib/supabase';
import type { AEvent, Client, Venue } from './api';

/* Push 27a · booking rules (admin only, never shown to staff). The app owns them now (no write-back to the Hub). */
export type LinkKind = 'together' | 'apart';
export type SLink = { staff_a: string; staff_b: string; kind: LinkKind; reason: string | null };
export type CondKind = 'not_venue' | 'private_only' | 'big_dates_only' | 'only_if_needed' | 'not_weekday' | 'min_guests' | 'areas';
export type SCond = { id: string; staff_id: string; kind: CondKind; value: string | null; reason: string | null };
/** Push 63 · Montreal areas (board StaffAreaV1). A venue's area is set once (auto from the postal code when we can); private homes: on the client. */
export const AREAS = ['Downtown', 'Old Montreal / Old Port', 'Plateau / Mile End', 'Westmount', 'Outremont / TMR', 'NDG / Côte-des-Neiges', 'Saint-Laurent / Dorval', 'West Island', 'East end', 'Laval', 'South Shore', 'Far'] as const;
export const AREA_HINT: Record<string, string> = { Far: 'Laurentians, Townships, 45+ min' };
const FSA: [RegExp, string][] = [
  [/^H2Y/, 'Old Montreal / Old Port'], [/^H(3A|3B|3G|3H|2Z|3C|2X)/, 'Downtown'], [/^H(2L|2J|2T|2W|2S|2R|2H|2K|2G)/, 'Plateau / Mile End'],
  [/^H(2V|3P|3R|3N)/, 'Outremont / TMR'], [/^H(3Y|3Z|4C|3J|3K)/, 'Westmount'], [/^H(4A|4B|3S|3T|3V|3W|4V|4W|3X|4X)/, 'NDG / Côte-des-Neiges'],
  [/^H(4L|4M|4N|4R|4S|4T|2M|2N|2C|2B|3L|3M|4J|4K|9P|9S)/, 'Saint-Laurent / Dorval'], [/^H(9[A-HJKRW]|8Y|8Z)/, 'West Island'], [/^H1/, 'East end'], [/^H7/, 'Laval'], [/^J4/, 'South Shore'], [/^J/, 'Far'],
];
export const areaFromPostal = (pc?: string | null) => { const x = (pc ?? '').replace(/\s/g, '').toUpperCase(); if (x.length < 3) return null; return FSA.find(([r]) => r.test(x))?.[1] ?? null; };
type VArea = { id: string; area?: string | null; postal_code?: string | null };
type CArea = { id: string; name: string; area?: string | null; kind?: string | null };
/** The event's area: its venue (set, else guessed from the postal code), else the client's (private homes). null = unknown → never filters. */
export function areaOf(e: AEvent, venues: VArea[], clients: CArea[]): string | null {
  const v = venues.find((x) => x.id === e.venue_id);
  if (v) return v.area || areaFromPostal(v.postal_code) || null;
  const cid = (e.event_private as { client_id?: string | null } | null)?.client_id;
  const cl = cid ? clients.find((c) => c.id === cid) : clients.find((c) => c.name === e.event_private?.client);
  return cl?.area ?? null;
}
export const areasOf = (conds: SCond[], sid: string) => { const c = conds.find((x) => x.staff_id === sid && x.kind === 'areas'); return c?.value ? c.value.split('|').filter(Boolean) : null; };
/** Out of their areas, and more than 3 days out (inside 3 days they're fair game again, Ronnie Nov 9). Unknown area = fine. */
export function outOfArea(sid: string, e: AEvent, ctx: { conds: SCond[]; venues: VArea[]; clients: CArea[] }, today = new Date().toISOString().slice(0, 10)) {
  const list = areasOf(ctx.conds, sid); if (!list) return false;
  const a = areaOf(e, ctx.venues, ctx.clients); if (!a || list.includes(a)) return false;
  const days = (new Date(e.event_date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 864e5;
  return days > 3;
}
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
    case 'areas': return `Only in ${(c.value ?? '').split('|').filter(Boolean).join(', ')}`;
  }
}
export const condShort = (c: SCond) => c.kind === 'areas' ? `⌖ ${(c.value ?? '').split('|').filter(Boolean).join(', ')}` : c.kind === 'not_venue' ? `no ${c.value}` : c.kind === 'min_guests' ? `${c.value}+ guests` : c.kind === 'big_dates_only' ? 'big dates only' : c.kind === 'only_if_needed' ? 'only if needed' : c.kind === 'private_only' ? 'private houses only' : `not ${c.value}`;

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
    if (k.kind === 'areas' && k.value) { const a = areaOf(e, ctx.venues as VArea[], ctx.clients as CArea[]); const list = k.value.split('|'); if (a && !list.includes(a)) out.push({ kind: k.kind, text: `works ${list.join(', ')} only · this is ${a}` }); }
  }
  return out;
}

/** ♥ n · ⊘ n · ⌂ n next to names in Staff and Bookings lists. */
export function RuleIcons({ sid, links, conds }: { sid: string; links: SLink[]; conds: SCond[] }) {
  const t = linksOf(links, sid, 'together').length; const a = linksOf(links, sid, 'apart').length; const c = conds.filter((x) => x.staff_id === sid && x.kind !== 'areas').length;
  const ar = areasOf(conds, sid);
  if (!t && !a && !c && !ar) return null;
  return (
    <span className="ru-icons" title={`${t} works well with · ${a} keep apart · ${c} when-to-book rule${c === 1 ? '' : 's'}${ar ? ` · only in ${ar.join(', ')}` : ''}`}>
      {t > 0 && <i className="ru-i ok">♥ {t}</i>}{a > 0 && <i className="ru-i red">⊘ {a}</i>}{c > 0 && <i className="ru-i gold">⌂ {c}</i>}{ar && <i className="ru-i gold">⌖ {ar.length > 2 ? `${ar.length} areas` : ar.join(', ')}</i>}
    </span>
  );
}
