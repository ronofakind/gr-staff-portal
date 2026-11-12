import { useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

/** Nov 8 · Today v4 · ✎ Edit layout: order, 📌 pin, Open / Folded / Hidden. Saved per admin in admin_prefs (080),
 *  so desktop and phone match. Before 080 (or offline) it falls back to this browser only. */
export type SecKey = 'needs' | 'messages' | 'ai' | 'tonight' | 'debriefs' | 'ratings' | 'late' | 'month' | 'meetings' | 'sheet' | 'pay' | 'hiring';
export type Mode = 'open' | 'folded' | 'hidden';
export type Col = 'L' | 'R';
export type Layout = { order: SecKey[]; pinned: SecKey[]; mode: Partial<Record<SecKey, Mode>>; col?: Partial<Record<SecKey, Col>> };
export const SEC_LABEL: Record<SecKey, string> = {
  needs: 'Needs you', messages: 'Messages', ai: 'AI · to review', tonight: 'Tonight', debriefs: 'Last night · debriefs', ratings: 'New staff ratings',
  late: 'Late 30 min +', month: 'This month', meetings: 'Meetings', sheet: 'Sheet changes', pay: 'Pay period', hiring: 'Hiring',
};
/** Full width on desktop (the rest fill 2 columns in order). */
export const WIDE: SecKey[] = ['sheet']; // Nov 8 · Tonight is half width (push 60: beside This month; Next 7 days dropped)
export const DEFAULT_LAYOUT: Layout = {
  order: ['needs', 'messages', 'ai', 'tonight', 'month', 'hiring', 'debriefs', 'ratings', 'pay', 'late', 'meetings', 'sheet'],
  pinned: ['needs', 'messages', 'ai'],
  mode: { late: 'folded', meetings: 'folded', sheet: 'folded' },
};
const KEY = 'today_layout'; const LS = 'gr_today_layout';
function clean(v: unknown): Layout {
  const all = DEFAULT_LAYOUT.order;
  const x = (v && typeof v === 'object' ? v : {}) as Partial<Layout>;
  const hadMsgs = Array.isArray(x.order) && x.order.includes('messages' as SecKey);
  const order = (Array.isArray(x.order) ? x.order.filter((k): k is SecKey => all.includes(k as SecKey)) : []).filter((k, i, a) => a.indexOf(k) === i);
  // A section added later (e.g. Hiring, push 55) goes right after the one before it in the default order, not at the bottom.
  all.forEach((k, i) => { if (order.includes(k)) return; const prev = all.slice(0, i).reverse().find((p) => order.includes(p)); order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k); });
  const pinned = Array.isArray(x.pinned) ? x.pinned.filter((k): k is SecKey => all.includes(k as SecKey)) : DEFAULT_LAYOUT.pinned;
  // Nov 11 · Messages is new: pinned right under Needs you the first time (Ronnie can move it after)
  if (Array.isArray(x.pinned) && !hadMsgs && !pinned.includes('messages')) pinned.splice(pinned.includes('needs') ? pinned.indexOf('needs') + 1 : 0, 0, 'messages');
  const mode = { ...DEFAULT_LAYOUT.mode, ...(x.mode && typeof x.mode === 'object' ? x.mode : {}) };
  // Nov 11 · desktop: two free columns. A section without a column gets the side it had in the old 2-across grid.
  const shown = [...pinned, ...order.filter((k) => !pinned.includes(k))];
  const col: Partial<Record<SecKey, Col>> = {};
  shown.forEach((k, i) => { const c = (x.col as Record<string, unknown> | undefined)?.[k]; col[k] = c === 'L' || c === 'R' ? c : i % 2 === 0 ? 'L' : 'R'; });
  return { order, pinned, mode, col };
}
export function useTodayLayout() {
  const [lay, setLay] = useState<Layout>(() => { try { const r = localStorage.getItem(LS); return r ? clean(JSON.parse(r)) : DEFAULT_LAYOUT; } catch { return DEFAULT_LAYOUT; } });
  useEffect(() => {
    supabase.from('admin_prefs').select('value').eq('key', KEY).maybeSingle().then(({ data, error }) => { if (!error && data?.value) setLay(clean(data.value)); });
  }, []);
  const save = async (l: Layout) => {
    setLay(l);
    try { localStorage.setItem(LS, JSON.stringify(l)); } catch { /* private mode */ }
    const { data: u } = await supabase.auth.getUser();
    if (u.user) await supabase.from('admin_prefs').upsert({ user_id: u.user.id, key: KEY, value: l, updated_at: new Date().toISOString() });
  };
  /** Pinned first (in pin order), then the rest in order. Hidden ones dropped. */
  const sorted = [...lay.pinned, ...lay.order.filter((k) => !lay.pinned.includes(k))].filter((k) => lay.mode[k] !== 'hidden');
  const hidden = lay.order.filter((k) => lay.mode[k] === 'hidden');
  return { lay, save, sorted, hidden };
}

/** One Today section: title row (caret folds it) + body. Folded = closed until clicked (not saved). */
export function Section({ k, mode, title, right, children, cls = '', empty }: { k: SecKey; mode?: Mode; title: ReactNode; right?: ReactNode; children: ReactNode; cls?: string; empty?: string | null }) {
  const [open, setOpen] = useState(mode !== 'folded');
  useEffect(() => setOpen(mode !== 'folded'), [mode]);
  const [peek, setPeek] = useState(false);
  // Nov 11 · nothing in it (or folded) → one thin line in place; opens back by itself when something comes in
  if ((empty && !peek) || !open) return (
    <section className={'t4-sec t4-thin t4-' + k + ' ' + cls}>
      <button type="button" className="t4-thinb" onClick={() => (empty ? setPeek(true) : setOpen(true))} aria-expanded={false}>
        <span className="t4-caret" aria-hidden="true">▸</span><span className="serif">{title}</span>{empty && <span className="muted"> · {empty}</span>}<span className="grow" /><span className="muted">›</span></button>
    </section>);
  return (
    <section className={'t4-sec t4-' + k + ' ' + cls}>
      <div className="sec t4-h">
        <button type="button" className="t4-fold" onClick={() => setOpen(!open)} aria-expanded={open}><span className="t4-caret" aria-hidden="true">{open ? '▾' : '▸'}</span><span className="serif">{title}</span></button>
        {right}
      </div>
      {open && children}
    </section>
  );
}

export function EditLayout({ lay, onSave, onClose }: { lay: Layout; onSave: (l: Layout) => void; onClose: () => void }) {
  const [l, setL] = useState<Layout>(lay);
  const [drag, setDrag] = useState<SecKey | null>(null);
  const list = [...l.pinned, ...l.order.filter((k) => !l.pinned.includes(k))];
  const setList = (next: SecKey[]) => setL((x) => ({ ...x, order: next, pinned: next.filter((k) => x.pinned.includes(k)) }));
  const move = (k: SecKey, d: -1 | 1) => { const a = [...list]; const i = a.indexOf(k); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setList(a); };
  const dropOn = (target: SecKey) => { if (!drag || drag === target) return; const a = list.filter((x) => x !== drag); a.splice(a.indexOf(target), 0, drag); setList(a); };
  const pin = (k: SecKey) => setL((x) => {
    const pinned = x.pinned.includes(k) ? x.pinned.filter((y) => y !== k) : [...x.pinned, k];
    const rest = list.filter((y) => !pinned.includes(y));
    return { ...x, pinned, order: [...pinned, ...rest] };
  });
  const setMode = (k: SecKey, m: Mode) => setL((x) => ({ ...x, mode: { ...x.mode, [k]: m } }));
  return (
    <div className="t4-edit-wrap" role="dialog" aria-label="Edit layout" onClick={onClose}>
      <div className="t4-edit" onClick={(ev) => ev.stopPropagation()}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}><span className="serif" style={{ fontSize: 22 }}>Edit layout</span><span className="grow" />
          <button className="lnk muted" onClick={() => setL(DEFAULT_LAYOUT)}>Reset</button>
          <button className="abtn sm dark" onClick={() => { onSave(l); onClose(); }}>Done</button></div>
        <div className="muted sm">Drag ⋮⋮ or tap ▲ ▼ to move · 📌 pinned stay on top · L / R = left or right column on the computer (phone: one list, this order)</div>
        {list.map((k) => {
          const m = l.mode[k] ?? 'open'; const pinned = l.pinned.includes(k);
          return (
            <div key={k} className={'t4-er' + (pinned ? ' pinned' : '') + (m === 'hidden' ? ' hid' : '') + (drag === k ? ' drag' : '')}
              draggable onDragStart={() => setDrag(k)} onDragEnd={() => setDrag(null)} onDragOver={(ev) => { ev.preventDefault(); dropOn(k); }}>
              <span className="t4-grip" aria-hidden="true">⋮⋮</span>
              <span className="t4-arrows"><button aria-label={'Move ' + SEC_LABEL[k] + ' up'} onClick={() => move(k, -1)}>▲</button><button aria-label={'Move ' + SEC_LABEL[k] + ' down'} onClick={() => move(k, 1)}>▼</button></span>
              <b className="grow">{SEC_LABEL[k]}</b>
              <span className="t4-seg t4-colseg">{(['L', 'R'] as Col[]).map((c) => <button key={c} className={(l.col?.[k] ?? 'L') === c ? 'on' : ''} onClick={() => setL((x) => ({ ...x, col: { ...x.col, [k]: c } }))} title={c === 'L' ? 'Left column' : 'Right column'}>{c}</button>)}</span>
              <button className={'t4-pin' + (pinned ? ' on' : '')} aria-pressed={pinned} aria-label={'Pin ' + SEC_LABEL[k]} onClick={() => pin(k)}>📌</button>
              <span className="t4-seg">{(['open', 'folded', 'hidden'] as Mode[]).map((x) => <button key={x} className={m === x ? 'on' : ''} onClick={() => setMode(k, x)}>{x === 'open' ? 'Open' : x === 'folded' ? 'Folded' : 'Hidden'}</button>)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
