import { createContext, useContext } from 'react';
import { supabase } from './supabase';

/** What my_checkup() (migration 036) returns about the signed-in person. */
export type CheckupInfo = {
  step: number; done_at: string | null;
  emergency_name: string | null; emergency_relation: string | null; emergency_phone: string | null;
  neighbourhood: string | null; languages: Record<string, number>;
  /** push 34d · "Skip for now" on step 5 → gold "Set your usual week" card on Home until a day is set. */
  usual_week_skipped_at?: string | null;
};
export const RELATIONS = ['Parent', 'Partner', 'Sibling', 'Friend', 'Other'] as const;

/** null = can't tell (RPC missing / error) → the app never blocks on the check-up. */
export async function loadCheckup(): Promise<CheckupInfo | null> {
  try {
    const { data, error } = await supabase.rpc('my_checkup');
    if (error || !data || typeof data !== 'object') return null;
    const d = data as Partial<CheckupInfo>;
    return {
      step: Number(d.step) || 1, done_at: d.done_at ?? null,
      emergency_name: d.emergency_name ?? null, emergency_relation: d.emergency_relation ?? null, emergency_phone: d.emergency_phone ?? null,
      neighbourhood: d.neighbourhood ?? null,
      languages: d.languages && typeof d.languages === 'object' && !Array.isArray(d.languages) ? d.languages : {},
      usual_week_skipped_at: d.usual_week_skipped_at ?? null,
    };
  } catch { return null; }
}

export const saveMyProfile = (fields: Partial<Pick<CheckupInfo, 'neighbourhood' | 'emergency_name' | 'emergency_relation' | 'emergency_phone' | 'languages'>>) =>
  supabase.rpc('save_my_profile', { p_fields: fields });
/** push 34d · true = skipped (Skip for now) · false = answered (Next / Done, even with all days off). Migration 040. */
export const setUsualWeekSkipped = (skipped: boolean) =>
  supabase.rpc('set_usual_week_skipped', { p_skipped: skipped }).then(({ error }) => { if (error) console.warn('[usual week]', error.message); });
export const setCheckupStep = (step: number, done = false) => supabase.rpc('set_checkup_step', { p_step: step, p_done: done });

/** Home reads it for the "Add an emergency contact" reminder. */
export const CheckupContext = createContext<{ info: CheckupInfo | null; reload: () => void }>({ info: null, reload: () => {} });
export const useCheckup = () => useContext(CheckupContext);
