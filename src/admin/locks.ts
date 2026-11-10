import { supabase } from '../lib/supabase';

/* Push 50 · Padlock (migration 055). A lock is per shift (one person on one event), admin only; staff never see it.
   Locked people are never moved or removed by suggestions (auto-fill, client change, sheet "Approve all", find replacement).
   MDs / managers (position MD or BM, the event lead, a co-manager) are locked by default; Ronnie can unlock them. */

export type Locks = {
  /** shift ids locked right now */ ids: Set<string>;
  /** of those, locked only because MD / manager (not tapped) */ byDefault: Set<string>;
  /** false = migration 055 not applied: MDs / leads still count as locked, the padlock can't be tapped */ ready: boolean;
};
export const NO_LOCKS: Locks = { ids: new Set(), byDefault: new Set(), ready: false };

type LEv = { id: string; manager_id: string | null; co_manager_ids?: string[] | null; shifts: { id: string; staff_id: string; position_code: string | null; status: string }[] };
/** The default without the database (055 not applied): MD / BM position, the lead or a co-manager. */
export const lockDefault = (s: { staff_id: string; position_code: string | null }, e: { manager_id: string | null; co_manager_ids?: string[] | null }) =>
  ['MD', 'BM'].includes(s.position_code ?? '') || s.staff_id === e.manager_id || !!e.co_manager_ids?.includes(s.staff_id);

/** Everyone locked on events between two dates. `evs` is only used when 055 isn't applied yet (default rule). */
export async function locksBetween(from: string, to: string, evs: LEv[] = []): Promise<Locks> {
  const { data, error } = await supabase.rpc('admin_locked_shifts', { p_from: from, p_to: to });
  if (!error && Array.isArray(data)) {
    const rows = data as { shift_id: string; by_default: boolean }[];
    return { ids: new Set(rows.map((r) => r.shift_id)), byDefault: new Set(rows.filter((r) => r.by_default).map((r) => r.shift_id)), ready: true };
  }
  const ids = new Set<string>();
  for (const e of evs) for (const s of e.shifts) if (s.status !== 'declined' && lockDefault(s, e)) ids.add(s.id);
  return { ids, byDefault: new Set(ids), ready: false };
}

/** Tap the padlock. Returns the lock as it is now. */
export async function setLock(shiftId: string, locked: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_set_lock', { p_shift: shiftId, p_locked: locked });
  if (error) throw new Error(/admin_set_lock|function|schema cache/i.test(error.message) && !/Only an admin|no longer/.test(error.message) ? 'The padlock needs migration 055.' : error.message);
  return !!data;
}

export const lockTitle = (on: boolean, byDefault: boolean) =>
  on ? (byDefault ? 'Locked · MD / manager (tap to unlock)' : 'Locked by you · suggestions never move them (tap to unlock)') : 'Tap to lock · suggestions never move them';
