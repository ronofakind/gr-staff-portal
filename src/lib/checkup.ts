import { createContext, useContext } from 'react';
import { supabase } from './supabase';

/** What my_checkup() (migration 036) returns about the signed-in person. */
export type CheckupInfo = {
  step: number; done_at: string | null;
  emergency_name: string | null; emergency_relation: string | null; emergency_phone: string | null;
  neighbourhood: string | null; languages: Record<string, number>;
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
    };
  } catch { return null; }
}

export const saveMyProfile = (fields: Partial<Pick<CheckupInfo, 'neighbourhood' | 'emergency_name' | 'emergency_relation' | 'emergency_phone' | 'languages'>>) =>
  supabase.rpc('save_my_profile', { p_fields: fields });
export const setCheckupStep = (step: number, done = false) => supabase.rpc('set_checkup_step', { p_step: step, p_done: done });

/** Home reads it for the "Add an emergency contact" reminder. */
export const CheckupContext = createContext<{ info: CheckupInfo | null; reload: () => void }>({ info: null, reload: () => {} });
export const useCheckup = () => useContext(CheckupContext);
