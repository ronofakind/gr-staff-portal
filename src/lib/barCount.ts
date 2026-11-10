/* Push 69 · bar count helpers (migration 094, boards BarCountV2 + V3). Every out / back is a confirmed, logged move. */
export type BKind = 'spirit' | 'wine' | 'bubbles' | 'beer' | 'other' | 'supply';
export type BItem = { id: string; kind: BKind; name: string; size: string | null };
export type BMove = { id: string; step: 'start' | 'more' | 'back' | 'fix' | 'item'; items: { item_id: string; qty?: number; out?: number; back?: number; from?: string | null; to?: string }[];
  at: string; by: string | null; by_id: string | null; undone_at: string | null; undone_by: string | null; undo_reason: string | null };
export type BSupply = { item_id: string; name: string; level: string | null };
export type Tot = { out: number; back: number };
export const LEVELS = ['Full', '¾', '½', '¼', 'Out'];
export const KIND_LABEL: Record<string, string> = { spirit: 'Spirits · in quarters', wine: 'Wine · by the bottle', bubbles: 'Champagne · prosecco · by the bottle', beer: 'Beer · by the unit', other: 'Other · by the unit' };
export const KINDS: Exclude<BKind, 'supply'>[] = ['spirit', 'wine', 'bubbles', 'beer', 'other'];
export const SIZES = ['750 ml', '1.14 L', 'Magnum 1.5 L', '341 ml', '355 ml can', '473 ml can'];
export const stepOf = (k: BKind) => (k === 'spirit' ? 0.25 : 1);
/** out = start + more (+ fixes) · back = everything brought back · used = out − back */
export function totals(moves: BMove[]) {
  const t: Record<string, Tot> = {};
  for (const m of moves) {
    if (m.undone_at || m.step === 'item') continue;
    for (const i of m.items) {
      const x = (t[i.item_id] ??= { out: 0, back: 0 });
      if (m.step === 'start' || m.step === 'more') x.out += Number(i.qty) || 0;
      else if (m.step === 'back') x.back += Number(i.qty) || 0;
      else if (m.step === 'fix') { x.out += Number(i.out) || 0; x.back += Number(i.back) || 0; }
    }
  }
  return t;
}
export const usedOf = (x?: Tot) => Math.max(0, (x?.out ?? 0) - (x?.back ?? 0));
/** 2.75 → "2 ¾" · 0.5 → "½" */
export function q(n: number) {
  const w = Math.floor(n + 1e-9); const f = Math.round((n - w) * 4);
  const fr = ['', '¼', '½', '¾'][f] ?? '';
  return w === 0 && fr ? fr : `${w}${fr ? ' ' + fr : ''}`;
}
const tm = (iso: string) => new Date(iso).toLocaleString('en-CA', { hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric', timeZone: 'America/Toronto' });
export function moveText(m: BMove, items: BItem[]) {
  const nm = (id: string) => { const i = items.find((x) => x.id === id); return i ? `${i.name}${i.size ? ' ' + i.size : ''}` : 'a bottle'; };
  if (m.step === 'item') return m.items.map((i) => (i.from ? `changed ${i.from} → ${i.to}` : `added ${i.to}`)).join(', ');
  const list = m.items.map((i) => (m.step === 'fix' ? `${nm(i.item_id)} ${i.out ? `out ${i.out > 0 ? '+' : ''}${q(Math.abs(i.out))}` : ''}${i.back ? ` back ${q(i.back)}` : ''}` : `${nm(i.item_id)} ${m.step === 'back' ? '' : '+'}${q(Number(i.qty) || 0)}`)).join(', ');
  return m.step === 'start' ? `start count · ${list}` : m.step === 'more' ? `took out ${list}` : m.step === 'back' ? `brought back ${list}` : `fixed ${list}`;
}
export function toCsv(title: string, date: string, items: BItem[], moves: BMove[], supplies: BSupply[]) {
  const esc = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const t = totals(moves);
  const rows: (string | number)[][] = [['Event', 'Date', 'Type', 'Product', 'Size', 'Total out', 'Brought back', 'Used']];
  for (const i of items.filter((x) => x.kind !== 'supply')) { const x = t[i.id]; if (!x) continue; rows.push([title, date, i.kind, i.name, i.size ?? '', x.out, x.back, usedOf(x)]); }
  for (const s of supplies) rows.push([title, date, 'supply', s.name, '', '', s.level ?? '', '']);
  rows.push([]); rows.push(['Log', 'When', 'Who', 'What', '', '', '', '']);
  for (const m of moves) rows.push(['', tm(m.at), m.by ?? '', moveText(m, items) + (m.undone_at ? ` · UNDONE by ${m.undone_by ?? ''} (${m.undo_reason ?? ''})` : ''), '', '', '', '']);
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}
export function download(name: string, text: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
