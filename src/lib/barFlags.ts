import { totals, usedOf, q, type BItem, type BMove, type BSupply } from './barCount';

/* Push 69 · basic guard rails on a bar count (shown to Ronnie; the obvious ones also to the person counting). */
export type BFlag = { level: 'red' | 'amber'; text: string };
export function barFlags(items: BItem[], moves: BMove[], supplies: BSupply[], submittedAt: string | null, history?: Record<string, number[]>): BFlag[] {
  const f: BFlag[] = []; const t = totals(moves); const nm = (id: string) => { const i = items.find((x) => x.id === id); return i ? `${i.name}${i.size ? ' ' + i.size : ''}` : 'a bottle'; };
  const live = moves.filter((m) => !m.undone_at && m.step !== 'item');
  if (!live.some((m) => m.step === 'start') && live.length) f.push({ level: 'red', text: 'No start count: bottles were taken out or brought back without one.' });
  for (const [id, x] of Object.entries(t)) if (x.back > x.out + 1e-9) f.push({ level: 'red', text: `${nm(id)}: more came back (${q(x.back)}) than went out (${q(x.out)}).` });
  if (submittedAt && live.some((m) => m.step !== 'back') && !live.some((m) => m.step === 'back')) f.push({ level: 'red', text: 'Submitted with nothing brought back.' });
  for (const m of live) for (const i of m.items) {
    const it = items.find((x) => x.id === i.item_id); const n = Number(i.qty) || 0;
    if ((m.step === 'more') && ((it?.kind === 'spirit' && n >= 4) || (it?.kind !== 'spirit' && n >= 24))) f.push({ level: 'amber', text: `Big take-out: ${nm(i.item_id)} +${q(n)} at ${new Date(m.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })} by ${m.by?.split(' ')[0] ?? '?'}.` });
  }
  const undone = moves.filter((m) => m.undone_at).length; if (undone >= 3) f.push({ level: 'amber', text: `${undone} moves were undone.` });
  if (submittedAt) { const after = moves.filter((m) => m.at > submittedAt && m.step !== 'item'); if (after.length) f.push({ level: 'amber', text: `${after.length} change${after.length === 1 ? '' : 's'} after the count was submitted.` }); }
  const outItems = Object.entries(t).filter(([, x]) => x.out > 0);
  if (submittedAt && outItems.length && outItems.every(([, x]) => x.back === 0)) f.push({ level: 'amber', text: 'Nothing at all came back: was the end count done?' });
  if (history) for (const [id, x] of Object.entries(t)) { const h = history[id]; if (!h || h.length < 3) continue; const avg = h.reduce((a, b) => a + b, 0) / h.length; const u = usedOf(x);
    if (avg > 0 && u > avg * 2 && u - avg >= 2) f.push({ level: 'amber', text: `${nm(id)}: ${q(u)} used, about ${q(Math.round(avg * 4) / 4)} usually here.` }); }
  for (const s of supplies) if (s.level === 'Out' || s.level === '¼') f.push({ level: 'amber', text: `Supplies low: ${s.name} ${s.level}.` });
  return f;
}
