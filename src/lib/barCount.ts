/* Push 69 · bar count helpers (migration 094). */
export type BKind = 'spirit' | 'wine' | 'bubbles' | 'beer' | 'other' | 'supply';
export type BLine = { key: string; item_id: string | null; kind: BKind; name: string; size: string | null; out: number; more: number; back: number };
export type BSupply = { key: string; item_id: string | null; name: string; level: string | null };
export const LEVELS = ['Full', '¾', '½', '¼', 'Out'];
export const KIND_LABEL: Record<string, string> = { spirit: 'Spirits · in quarters', wine: 'Wine · by the bottle', bubbles: 'Champagne · prosecco · by the bottle', beer: 'Beer · by the unit', other: 'Other · by the unit' };
export const KINDS: BKind[] = ['spirit', 'wine', 'bubbles', 'beer', 'other'];
export const stepOf = (k: BKind) => (k === 'spirit' ? 0.25 : 1);
export const used = (l: BLine) => Math.max(0, (l.out || 0) + (l.more || 0) - (l.back || 0));
/** 2.75 → "2 ¾" · 0.5 → "½" */
export function q(n: number) {
  const w = Math.floor(n + 1e-9); const f = Math.round((n - w) * 4);
  const fr = ['', '¼', '½', '¾'][f] ?? '';
  return w === 0 && fr ? fr : `${w}${fr ? ' ' + fr : ''}`;
}
export function toCsv(title: string, date: string, lines: BLine[], supplies: BSupply[]) {
  const esc = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['Event', 'Date', 'Type', 'Product', 'Size', 'Out at start', 'More out', 'Total out', 'Brought back', 'Used']];
  for (const l of lines) rows.push([title, date, l.kind, l.name, l.size ?? '', String(l.out || 0), String(l.more || 0), String((l.out || 0) + (l.more || 0)), String(l.back || 0), String(used(l))]);
  for (const s of supplies) rows.push([title, date, 'supply', s.name, '', '', '', '', s.level ?? '', '']);
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
export function download(name: string, text: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
