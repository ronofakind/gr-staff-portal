// push 78 · App colours: Classic (default) or Dark. Each person picks; never follows the phone's dark mode.
import { supabase } from './supabase';
export type Theme = 'classic' | 'dark';
const KEY = 'gr-theme';
const read = (): Theme => { try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'classic'; } catch { return 'classic'; } };
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#121110' : '#F6F2EC');
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
}
export const currentTheme = read;
/** Saved theme on the person's profile wins (so it follows them to a new phone). Before migration 103 → ignore. */
export async function loadTheme(staffId: string) {
  const { data, error } = await supabase.from('staff').select('theme').eq('id', staffId).maybeSingle();
  if (!error && data && (data as { theme: string | null }).theme) applyTheme((data as { theme: Theme }).theme);
}
export async function saveTheme(staffId: string, t: Theme) {
  applyTheme(t);
  const { error } = await supabase.from('staff').update({ theme: t }).eq('id', staffId);
  if (error) console.warn('[theme]', error.message);
}
