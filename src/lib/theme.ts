// push 78 · App colours: Classic (default) or Dark. Each person picks; never follows the phone's dark mode.
import { supabase } from './supabase';
export type Theme = 'classic' | 'dark' | 'terra'; // terra = Terracotta & Sage, admin only (push 81)
const KEY = 'gr-theme';
const read = (): Theme => { try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'terra' ? v : 'classic'; } catch { return 'classic'; } };
export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#121110' : t === 'terra' ? '#EEF0E8' : '#F6F2EC');
  try { localStorage.setItem(KEY, t); } catch { /* private mode */ }
}
export const currentTheme = read;
/** Saved theme on the person's profile wins (so it follows them to a new phone). Before migration 103 → ignore. */
export async function loadTheme(staffId: string, admin = false) {
  const { data, error } = await supabase.from('staff').select('theme').eq('id', staffId).maybeSingle();
  const t = !error && data ? (data as { theme: Theme | null }).theme : null;
  if (t === 'terra' && !admin) applyTheme('classic');
  else if (t) applyTheme(t);
  else if (admin) applyTheme('terra'); // push 81 · admin default look, still choosable in Settings
}
export async function saveTheme(staffId: string, t: Theme) {
  applyTheme(t);
  const { error } = await supabase.from('staff').update({ theme: t }).eq('id', staffId);
  if (error) console.warn('[theme]', error.message);
}
