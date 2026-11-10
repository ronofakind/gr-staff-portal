import { supabase } from '../lib/supabase';
import { hoursBetween, type AEvent, type AShift } from './api';

/** Nov 8 · push 54 (migration 081) · pay rates with history, staff cost, sent invoices → profit. Admin only. */
export type RateRow = { id: string; staff_id: string; rate: number; from_date: string; reason: string | null; source: string | null; created_at: string };
export type Invoice = { qb_id: string; doc_number: string | null; event_id: string | null; customer: string | null; txn_date: string | null; sent_at: string | null; subtotal: number | null; total: number | null };

export async function loadRates(): Promise<RateRow[] | null> {
  const { data, error } = await supabase.from('staff_rates').select('id,staff_id,rate,from_date,reason,source,created_at').order('from_date', { ascending: false }).limit(10000);
  if (error) return null; // before 081
  return (data ?? []).map((r) => ({ ...(r as RateRow), rate: Number((r as RateRow).rate) }));
}
/** staff_id → rows newest first */
export const byStaff = (rows: RateRow[]) => rows.reduce<Record<string, RateRow[]>>((m, r) => { (m[r.staff_id] ??= []).push(r); return m; }, {});
export const rateOn = (hist: RateRow[] | undefined, date: string) => hist?.find((r) => r.from_date <= date)?.rate ?? hist?.[hist.length - 1]?.rate ?? null;

const isMgr = (s: AShift) => s.position_code === 'MD' || s.position_code === 'BM';
const planned = (s: AShift) => (s.planned_end ? hoursBetween(s.planned_start, s.planned_end) : 4);

export type Cost = { hours: number; cost: number; floor: number; bar: number; mgr: number; gas: number; travel: number; noRate: string[]; missing: number };
/** Staff cost of one event: worked shifts (paid hours incl. the minimum) × rate on that day + paid travel + gas to drivers.
 *  ahead=true → booked shifts not worked yet, by planned hours. */
export function eventCost(e: AEvent, rates: Record<string, RateRow[]>, drivers = 0, ahead = false): Cost {
  const c: Cost = { hours: 0, cost: 0, floor: 0, bar: 0, mgr: 0, gas: 0, travel: 0, noRate: [], missing: 0 };
  const trav = (e.paid_travel_min ?? 0) / 60;
  for (const s of e.shifts) {
    if (s.status === 'declined' || s.attendance) continue;
    let h: number;
    if (ahead) h = planned(s);
    else { if (!s.punches?.punch_in) continue; if (!s.punches.punch_out) { c.missing++; continue; } h = hoursBetween(s.punches.punch_in, s.punches.punch_out, !!s.left_early); }
    const r = rateOn(rates[s.staff_id], e.event_date);
    if (r == null) { c.noRate.push(s.staff?.full_name ?? '?'); continue; }
    const amt = h * r; const tr = e.transport && trav ? trav * r : 0;
    c.hours += h; c.cost += amt + tr; c.travel += tr;
    if (isMgr(s)) c.mgr += amt; else if (e.department === 'bar') c.bar += amt; else c.floor += amt;
  }
  if (e.transport && drivers && e.gas_per_car) { c.gas = drivers * Number(e.gas_per_car); c.cost += c.gas; }
  return c;
}
export const sumCost = (list: Cost[]): Cost => list.reduce((a, c) => ({ hours: a.hours + c.hours, cost: a.cost + c.cost, floor: a.floor + c.floor, bar: a.bar + c.bar, mgr: a.mgr + c.mgr, gas: a.gas + c.gas, travel: a.travel + c.travel, noRate: [...a.noRate, ...c.noRate], missing: a.missing + c.missing }),
  { hours: 0, cost: 0, floor: 0, bar: 0, mgr: 0, gas: 0, travel: 0, noRate: [], missing: 0 });

export async function driversBy(eventIds: string[]): Promise<Record<string, number>> {
  if (!eventIds.length) return {};
  const { data, error } = await supabase.from('ride_offers').select('event_id,kind').in('event_id', eventIds).eq('kind', 'driver');
  if (error) return {};
  return (data as { event_id: string }[]).reduce<Record<string, number>>((m, r) => { m[r.event_id] = (m[r.event_id] ?? 0) + 1; return m; }, {});
}
export async function invoicesFor(eventIds: string[]): Promise<Invoice[]> {
  if (!eventIds.length) return [];
  const { data, error } = await supabase.from('event_invoices').select('qb_id,doc_number,event_id,customer,txn_date,sent_at,subtotal,total').in('event_id', eventIds).not('sent_at', 'is', null);
  if (error) return [];
  return (data as Invoice[]).map((i) => ({ ...i, subtotal: i.subtotal == null ? null : Number(i.subtotal), total: i.total == null ? null : Number(i.total) }));
}
export const money = (n: number) => '$' + Math.round(n).toLocaleString('en-CA');
export const money2 = (n: number) => '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Start of the next pay period (raises default to it). */
export function nextPeriodStart(today: string) {
  const [y, m, d] = today.split('-').map(Number);
  if (d <= 15) return `${y}-${String(m).padStart(2, '0')}-16`;
  const nm = m === 12 ? 1 : m + 1; const ny = m === 12 ? y + 1 : y;
  return `${ny}-${String(nm).padStart(2, '0')}-01`;
}
