/** Pay periods and paid hours, same rules as the admin side (src/admin/api.ts). */
export function payPeriod(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const last = new Date(y, m, 0).getDate(); const mm = String(m).padStart(2, '0');
  return d <= 15 ? { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` } : { start: `${y}-${mm}-16`, end: `${y}-${mm}-${last}` };
}
export const shiftPeriod = (p: { start: string }, n: number) => {
  const [y, m, d] = p.start.split('-').map(Number);
  let idx = (y * 12 + (m - 1)) * 2 + (d === 1 ? 0 : 1) + n;
  const half = ((idx % 2) + 2) % 2; idx = (idx - half) / 2; const yy = Math.floor(idx / 12), mm = idx - yy * 12 + 1;
  return payPeriod(`${yy}-${String(mm).padStart(2, '0')}-${half ? '16' : '01'}`);
};
/** Paid on the 16th for 1–15; on the 1st of next month for 16–end. */
export const payDay = (p: { start: string }) => { const [y, m, d] = p.start.split('-').map(Number); if (d === 1) return `${y}-${String(m).padStart(2, '0')}-16`; const n = new Date(y, m, 1); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`; };
const D = (iso: string) => new Date(iso + 'T12:00:00');
export const payDayLabel = (p: { start: string }) => D(payDay(p)).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');
export const periodLabel = (p: { start: string; end: string }) => `${D(p.start).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }).replace('.', '')} – ${Number(p.end.slice(8))}`;
export const MIN_HOURS = 4;
export const workedHours = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 900000) * 0.25;
/** 15-min rounding, minimum 4 h per shift, except left early (real hours). */
export const paidHours = (a: string, b: string, leftEarly = false) => { const h = workedHours(a, b); return leftEarly ? h : Math.max(MIN_HOURS, h); };
