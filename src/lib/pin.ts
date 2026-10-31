import { supabase } from './supabase';

/**
 * Push 31d · 4- or 6-digit sign-in code.
 *
 * Supabase Auth needs a password of at least 6 characters, so a 4-digit code is "stretched" app-side before it is
 * sent to signInWithPassword / updateUser: password = code + PIN4_SUFFIX. Staff never see or type the suffix.
 *   - 6-digit codes are sent exactly as typed (unchanged from before push 31), so every existing code keeps working.
 *   - The suffix contains letters, so a stretched 4-digit code can never equal any 6-digit code.
 *   - NEVER change PIN4_SUFFIX: every 4-digit code already saved would stop working (they'd need "Forgot your code?").
 */
export const PIN4_SUFFIX = '#gr4-code';
export type PinLen = 4 | 6;

/** The password actually sent to Supabase Auth for a typed code. */
export const pinPassword = (code: string) => (code.length === 4 ? code + PIN4_SUFFIX : code);

const key = (email: string) => 'gr_pin_len:' + email.trim().toLowerCase();

/** Length remembered on this device (null = never signed in here with a known length). */
export function localPinLen(email: string): PinLen | null {
  try { const v = localStorage.getItem(key(email)); return v === '4' ? 4 : v === '6' ? 6 : null; } catch { return null; }
}
export function rememberPinLen(email: string, len: PinLen) {
  try { localStorage.setItem(key(email), String(len)); } catch { /* private mode */ }
}

/**
 * How many dots to show. Device memory first, then the public pin_length(email) RPC (4 | 6; 6 for unknown emails).
 * known = false when we can't tell a real 6 from "unknown" → the sign-in screen offers "I use a 4-digit code".
 */
export async function resolvePinLen(email: string): Promise<{ len: PinLen; known: boolean }> {
  const local = localPinLen(email);
  if (local) return { len: local, known: true };
  try {
    const { data, error } = await supabase.rpc('pin_length', { p_email: email.trim() });
    if (!error && Number(data) === 4) return { len: 4, known: true };
  } catch { /* offline / migration 036 not applied */ }
  return { len: 6, known: false };
}

/** After choosing or changing the code: save the length on the staff row (036) and on this device. */
export async function saveMyPinLen(email: string | null | undefined, len: PinLen) {
  if (email) rememberPinLen(email, len);
  try { await supabase.rpc('set_my_pin_length', { p_len: len }); } catch { /* migration 036 not applied yet */ }
}
