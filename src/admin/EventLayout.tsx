import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Push 61 · Event page ✎ Edit layout (board EventPageV3): order, 📌 pin, Open / Folded. Same storage as Today (admin_prefs),
 *  so desktop and phone match; falls back to this browser. No Hidden: every block holds something the event needs. */
export type BlockKey = 'event' | 'place' | 'staff' | 'uni' | 'bill' | 'more';
export type BMode = 'open' | 'folded';
export type ELayout = { order: BlockKey[]; pinned: BlockKey[]; mode: Partial<Record<BlockKey, BMode>> };
export const BLOCK_LABEL: Record<BlockKey, string> = { event: 'The event', place: 'Place & time', staff: 'Staffing', uni: 'Uniforms', bill: 'Billing & extras', more: 'Folder, transport & notes' };
export const DEFAULT_ELAYOUT: ELayout = { order: ['event', 'place', 'staff', 'uni', 'bill', 'more'], pinned: [], mode: { more: 'folded' } };
const KEY = 'event_layout'; const LS = 'gr_event_layout';
function clean(v: unknown): ELayout {
  const all = DEFAULT_ELAYOUT.order;
  const x = (v && typeof v === 'object' ? v : {}) as Partial<ELayout>;
  const order = (Array.isArray(x.order) ? x.order.filter((k): k is BlockKey => all.includes(k as BlockKey)) : []).filter((k, i, a) => a.indexOf(k) === i);
  all.forEach((k, i) => { if (order.includes(k)) return; const prev = all.slice(0, i).reverse().find((p) => order.includes(p)); order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, k); });
  const pinned = Array.isArray(x.pinned) ? x.pinned.filter((k): k is BlockKey => all.includes(k as BlockKey)) : [];
  const mode: ELayout['mode'] = { ...DEFAULT_ELAYOUT.mode };
  if (x.mode && typeof x.mode === 'object') for (const [k, m] of Object.entries(x.mode)) if (all.includes(k as BlockKey) && (m === 'open' || m === 'folded')) mode[k as BlockKey] = m;
  return { order, pinned, mode };
}
export function useEventLayout() {
  const [lay, setLay] = useState<ELayout>(() => { try { const r = localStorage.getItem(LS); return r ? clean(JSON.parse(r)) : DEFAULT_ELAYOUT; } catch { return DEFAULT_ELAYOUT; } });
  useEffect(() => { supabase.from('admin_prefs').select('value').eq('key', KEY).maybeSingle().then(({ data, error }) => { if (!error && data?.value) setLay(clean(data.value)); }); }, []);
  const save = async (l: ELayout) => {
    setLay(l);
    try { localStorage.setItem(LS, JSON.stringify(l)); } catch { /* private mode */ }
    const { data: u } = await supabase.auth.getUser();
    if (u.user) await supabase.from('admin_prefs').upsert({ user_id: u.user.id, key: KEY, value: l, updated_at: new Date().toISOString() });
  };
  const sorted = [...lay.pinned, ...lay.order.filter((k) => !lay.pinned.includes(k))];
  return { lay, save, sorted };
}

export function EditEventLayout({ lay, onSave, onClose }: { lay: ELayout; onSave: (l: ELayout) => void; onClose: () => void }) {
  const [l, setL] = useState<ELayout>(lay);
  const [drag, setDrag] = useState<BlockKey | null>(null);
  const list = [...l.pinned, ...l.order.filter((k) => !l.pinned.includes(k))];
  const setList = (next: BlockKey[]) => setL((x) => ({ ...x, order: next, pinned: next.filter((k) => x.pinned.includes(k)) }));
  const move = (k: BlockKey, d: -1 | 1) => { const a = [...list]; const i = a.indexOf(k); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setList(a); };
  const dropOn = (target: BlockKey) => { if (!drag || drag === target) return; const a = list.filter((x) => x !== drag); a.splice(a.indexOf(target), 0, drag); setList(a); };
  const pin = (k: BlockKey) => setL((x) => { const pinned = x.pinned.includes(k) ? x.pinned.filter((y) => y !== k) : [...x.pinned, k]; return { ...x, pinned, order: [...pinned, ...list.filter((y) => !pinned.includes(y))] }; });
  return (
    <div className="t4-edit-wrap" role="dialog" aria-label="Edit layout" onClick={onClose}>
      <div className="t4-edit" onClick={(ev) => ev.stopPropagation()}>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}><span className="serif" style={{ fontSize: 22 }}>Edit layout</span><span className="grow" />
          <button type="button" className="lnk muted" onClick={() => setL(DEFAULT_ELAYOUT)}>Reset</button>
          <button type="button" className="abtn sm dark" onClick={() => { onSave(l); onClose(); }}>Done</button></div>
        <div className="muted sm">Drag ⋮⋮ or tap ▲ ▼ to move · 📌 pinned stay on top · Open / Folded = how it opens · every event, desktop and phone</div>
        {list.map((k) => {
          const m = l.mode[k] ?? 'open'; const pinned = l.pinned.includes(k);
          return (
            <div key={k} className={'t4-er' + (pinned ? ' pinned' : '') + (drag === k ? ' drag' : '')}
              draggable onDragStart={() => setDrag(k)} onDragEnd={() => setDrag(null)} onDragOver={(ev) => { ev.preventDefault(); dropOn(k); }}>
              <span className="t4-grip" aria-hidden="true">⋮⋮</span>
              <span className="t4-arrows"><button type="button" aria-label={'Move ' + BLOCK_LABEL[k] + ' up'} onClick={() => move(k, -1)}>▲</button><button type="button" aria-label={'Move ' + BLOCK_LABEL[k] + ' down'} onClick={() => move(k, 1)}>▼</button></span>
              <b className="grow">{BLOCK_LABEL[k]}</b>
              <button type="button" className={'t4-pin' + (pinned ? ' on' : '')} aria-pressed={pinned} aria-label={'Pin ' + BLOCK_LABEL[k]} onClick={() => pin(k)}>📌</button>
              <span className="t4-seg">{(['open', 'folded'] as BMode[]).map((x) => <button type="button" key={x} className={m === x ? 'on' : ''} onClick={() => setL((y) => ({ ...y, mode: { ...y.mode, [k]: x } }))}>{x === 'open' ? 'Open' : 'Folded'}</button>)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
