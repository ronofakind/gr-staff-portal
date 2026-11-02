import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { isAndroid, isIOS } from './install';

/**
 * Push 33b · the person's G&R calendar: one private subscription feed (/api/feed?t=<token>), added once.
 * Token + "added" live in staff_calendar (migration 039), read through my_calendar().
 */
export type MyCal = { token: string; added_at: string | null; prompt_seen_at: string | null };
export type CalOs = 'ios' | 'android';

/** null = unknown (RPC missing / not signed in) → every calendar prompt stays hidden. */
export async function loadMyCalendar(): Promise<MyCal | null> {
  try {
    const { data, error } = await supabase.rpc('my_calendar');
    if (error || !data || typeof data !== 'object') return null;
    const d = data as Partial<MyCal>;
    return typeof d.token === 'string' ? { token: d.token, added_at: d.added_at ?? null, prompt_seen_at: d.prompt_seen_at ?? null } : null;
  } catch { return null; }
}
export function useMyCalendar(skip = false) {
  const [cal, setCal] = useState<MyCal | null | undefined>(skip ? null : undefined);
  const reload = () => loadMyCalendar().then(setCal);
  useEffect(() => { if (!skip) reload(); }, [skip]); // eslint-disable-line react-hooks/exhaustive-deps
  return { cal, setCal, reload };
}

export const defaultCalOs = (): CalOs => (isAndroid() && !isIOS() ? 'android' : 'ios');
export function feedUrls(token: string) {
  const host = window.location.host;
  const webcal = `webcal://${host}/api/feed?t=${token}`;
  return { webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`, https: `${window.location.origin}/api/feed?t=${token}` };
}

/** Records the tap (we can't see the phone's calendar) and opens the phone's subscribe screen. */
export async function addCalendar(cal: MyCal, os: CalOs): Promise<MyCal> {
  const u = feedUrls(cal.token);
  try { await supabase.rpc('calendar_added'); } catch { /* still open it */ }
  if (os === 'android') window.open(u.google, '_blank', 'noopener');
  else window.location.href = u.webcal;
  return { ...cal, added_at: new Date().toISOString(), prompt_seen_at: cal.prompt_seen_at ?? new Date().toISOString() };
}
export const calendarPromptSeen = () => supabase.rpc('calendar_prompt_seen').then(() => {}, () => {});
