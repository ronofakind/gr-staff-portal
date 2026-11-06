import { supabase } from './supabase';

/** Nov 6 · a note from G&R on one shift (migration 068). Staff must tap Got it. Errors (no migration yet) → nothing. */
export type ShiftNote = { shift_id: string; body: string; seen_at: string | null };

export async function shiftNotes(ids: string[]): Promise<Record<string, ShiftNote>> {
  if (!ids.length) return {};
  const { data, error } = await supabase.from('shift_staff_notes').select('shift_id,body,seen_at').in('shift_id', ids);
  if (error || !Array.isArray(data)) return {};
  return Object.fromEntries((data as ShiftNote[]).map((n) => [n.shift_id, n]));
}

export async function noteSeen(shiftId: string) {
  await supabase.rpc('staff_note_seen', { p_shift: shiftId });
}
