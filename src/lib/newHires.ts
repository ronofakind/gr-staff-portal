// push 71 · onboarding extras: who is a new hire, Junior = cocktail only, what's missing before pay.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type NewHire = {
  staff_id: string; level: string | null; paid_by: 'payroll' | 'cash'; created_at: string;
  hb_seen: string[]; hb_total: number | null; hb_done_at: string | null; tax_done_at: string | null;
  table_ok_at: string | null; firstgig_at: string | null; payroll_status: 'sending' | 'done' | 'error' | null; payroll_for: string | null; payroll_note: string | null;
  has_tax: boolean; qb_status: string | null;
};

const COLS = 'staff_id,level,paid_by,created_at,hb_seen,hb_total,hb_done_at,tax_done_at,table_ok_at,firstgig_at,payroll_status,payroll_for,payroll_note';

export async function loadNewHires(): Promise<Record<string, NewHire>> {
  const { data, error } = await supabase.from('staff_onboarding').select(COLS).limit(500);
  if (error || !data) return {};
  const ids = data.map((r) => (r as { staff_id: string }).staff_id);
  const { data: tx } = ids.length ? await supabase.from('staff_tax').select('staff_id,qb_status').in('staff_id', ids) : { data: [] };
  const tax = new Map(((tx ?? []) as { staff_id: string; qb_status: string | null }[]).map((t) => [t.staff_id, t.qb_status]));
  return Object.fromEntries((data as unknown as Omit<NewHire, 'has_tax' | 'qb_status'>[]).map((r) => [r.staff_id, { ...r, has_tax: tax.has(r.staff_id), qb_status: tax.get(r.staff_id) ?? null }]));
}

export function useNewHires(tick = 0) {
  const [m, setM] = useState<Record<string, NewHire>>({});
  useEffect(() => { loadNewHires().then(setM); }, [tick]);
  return m;
}

/** Cocktail dînatoire or canapés (Ronnie, Nov 10). */
export const isCocktailType = (t?: string | null) => !!t && /cocktail|canap/i.test(t);
/** Junior who hasn't been opened to table service yet. */
export const juniorOnly = (h?: NewHire | null) => !!h && (h.level ?? '').toUpperCase() === 'JUNIOR' && !h.table_ok_at;
/** A Junior on this event type: 'no' = not cocktail, 'unknown' = type not set, null = fine. */
export const juniorClash = (h: NewHire | null | undefined, type?: string | null): 'no' | 'unknown' | null =>
  !juniorOnly(h) ? null : !type ? 'unknown' : isCocktailType(type) ? null : 'no';

/** What we still don't have for this person (shown on bookings, the profile and before pay). */
export function missingFor(h?: NewHire | null): string[] {
  if (!h) return [];
  const out: string[] = [];
  if (h.paid_by === 'payroll' && !h.has_tax) out.push('SIN', 'void cheque / PayPal', 'address');
  if (!h.hb_done_at) out.push('handbook');
  return out;
}
export const missingText = (l: string[]) => (l.length ? 'no ' + l.join(', no ').replace('no handbook', 'handbook not done') : '');

/** Days since Accept and how far they are (0–1): handbook cards + tax & pay. */
export function progressOf(h: NewHire, cards: number) {
  const n = Math.max(1, cards); const read = h.hb_done_at ? n : Math.min(h.hb_seen?.length ?? 0, n);
  const steps = h.paid_by === 'payroll' ? n + 2 : n; // tax & pay counts as 2 cards' worth
  const done = read + (h.paid_by === 'payroll' && h.tax_done_at ? 2 : 0);
  return { read, n, pct: Math.min(1, done / steps), days: Math.floor((Date.now() - +new Date(h.created_at)) / 864e5),
    open: !h.hb_done_at || (h.paid_by === 'payroll' && !h.tax_done_at) };
}
