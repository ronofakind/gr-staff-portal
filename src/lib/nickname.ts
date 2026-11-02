/**
 * Push 33d · "Name we call you". Used on Home ("Hi …"), the thank-you pop-up and team / section lists only.
 * Payroll, invoices, QuickBooks, sheets and exports always use full_name.
 * Same rule as nickname_ok() in migration 039: letters (accents OK), spaces, hyphens, apostrophes · 2–15 · starts with a letter.
 */
const L = 'A-Za-zÀ-ÖØ-öø-ÿĀ-ž';
export const NICK_RE = new RegExp(`^[${L}][${L}' ’-]{1,14}$`);
const ALLOWED = new RegExp(`^[${L}' ’-]*$`);
export const NICK_ERROR = 'Please use a real name you go by, letters only (no numbers, symbols or emojis).';

export const cleanNick = (v: string) => v.trim().replace(/\s+/g, ' ');
/** 'ok' · 'empty' · 'short' (keep typing) · 'bad' (show the error). */
export function nickState(raw: string): 'ok' | 'empty' | 'short' | 'bad' {
  const v = cleanNick(raw);
  if (!v) return 'empty';
  if (!ALLOWED.test(v) || !new RegExp(`^[${L}]`).test(v)) return 'bad';
  return NICK_RE.test(v) ? 'ok' : v.length < 2 ? 'short' : 'bad';
}

type P = { full_name: string; nickname?: string | null };
/** What we call them: nickname, else the first name. */
export const callName = (p: P) => p.nickname || p.full_name.split(' ')[0];
/** Team / section lists: "Mo C." when they set a nickname, else the full name as before. */
export const teamName = (p: P) => {
  if (!p.nickname) return p.full_name;
  const last = p.full_name.trim().split(/\s+/).slice(1).pop();
  return last ? `${p.nickname} ${last[0].toUpperCase()}.` : p.nickname;
};
