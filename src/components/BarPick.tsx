// push 85 (board BarCountPickV1, migration 109) · Tonight's bottles from the G&R list: tick what's at the bar
// (last time at this venue pre-ticked), search the whole list. Staff never see prices.
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { KINDS, KIND_SHORT } from '../lib/barCount';

export type Cat = { id: string; kind: string; name: string; size: string | null; on: boolean };
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const catMatch = (list: Cat[], t: string) => { const w = norm(t.trim()).split(/\s+/).filter(Boolean); return w.length ? list.filter((c) => w.every((x) => norm(`${c.name} ${c.size ?? ''}`).includes(x))) : []; };

export function useCatalog(eventId: string, tick = 0) {
  const [c, setC] = useState<{ picked: boolean; list: Cat[] } | null>(null);
  useEffect(() => { supabase.rpc('bar_catalog_pick', { p_event: eventId }).then(({ data, error }) => setC(error || !data ? { picked: true, list: [] } : (data as { picked: boolean; list: Cat[] }))); }, [eventId, tick]);
  return c;
}

/** Full screen picker before the start count (and "Change tonight's bottles"). */
export function TonightsBottles({ eventId, list, onDone, onAddNew, onCancel }: { eventId: string; list: Cat[]; onDone: () => void; onAddNew: () => void; onCancel?: () => void }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(list.filter((c) => c.on).map((c) => c.id)));
  const [t, setT] = useState(''); const [open, setOpen] = useState<Record<string, boolean>>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const hits = useMemo(() => catMatch(list, t), [list, t]);
  const seen = useRef(new Set(list.map((c) => c.id))); // a bottle added from here comes back ticked
  useEffect(() => { const fresh = list.filter((c) => !seen.current.has(c.id)); fresh.forEach((c) => seen.current.add(c.id)); if (fresh.length) { setOn((s) => new Set([...s, ...fresh.map((c) => c.id)])); setT(''); } }, [list]);
  const flip = (id: string) => setOn((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = async () => { setBusy(true); setErr(''); const { error } = await supabase.rpc('bar_pick', { p_event: eventId, p_catalog: [...on], p_add: false }); setBusy(false); if (error) setErr(error.message); else onDone(); };
  const row = (c: Cat) => (
    <button key={c.id} type="button" className={'bp-row' + (on.has(c.id) ? ' on' : '')} onClick={() => flip(c.id)}>
      <span className="bp-box">{on.has(c.id) ? '✓' : ''}</span><span className="grow"><b>{c.name}</b> <small>{c.size}</small></span>{c.on && <i className="bp-last">LAST TIME</i>}
    </button>);
  return (
    <div className="bp">
      <h1 className="serif" style={{ margin: '4px 0 2px' }}>Tonight’s bottles</h1>
      <p className="muted sm" style={{ margin: 0 }}>Tick what’s at the bar tonight.{list.some((c) => c.on) ? ' What you had last time here is already ticked.' : ''}</p>
      <input className="bp-search" value={t} onChange={(e) => setT(e.target.value)} placeholder="🔍 Search the G&R list" />
      {t.trim() ? <section className="bc-group">{hits.map(row)}
        {!hits.length && <p className="muted sm">Not on the list.</p>}
        <button className="lnk" onClick={onAddNew}>+ Add “{t.trim()}” as a new bottle</button></section>
      : KINDS.map((k) => { const ls = list.filter((c) => c.kind === k); if (!ls.length) return null; const n = ls.filter((c) => on.has(c.id)).length;
          const show = open[k] || ls.length <= 10 ? ls : [...ls.filter((c) => on.has(c.id)), ...ls.filter((c) => !on.has(c.id))].slice(0, 9);
          return <section key={k} className="bc-group"><div className="spread"><small className="gt-kick">{KIND_SHORT[k].toUpperCase()}</small><small className="muted">{n} of {ls.length}</small></div>
            {show.map(row)}{show.length < ls.length && <button className="lnk" onClick={() => setOpen({ ...open, [k]: true })}>+ {ls.length - show.length} more</button>}</section>; })}
      {err && <p className="error">{err}</p>}
      <button className="big-btn dark" disabled={busy || !on.size} onClick={save}>{busy ? '…' : `Start with ${on.size} bottle${on.size === 1 ? '' : 's'}`}</button>
      <button className="lnk" onClick={onAddNew}>Not on the list? Add a bottle</button>
      {onCancel && <button className="lnk" onClick={onCancel}>Cancel</button>}
    </div>);
}

/** Search on the count screen (+ More out / Start): adds a G&R bottle to tonight. */
export function BarSearchAdd({ eventId, list, have, onAdded, onAddNew }: { eventId: string; list: Cat[]; have: Set<string>; onAdded: () => void; onAddNew: (name: string) => void }) {
  const [t, setT] = useState(''); const [busy, setBusy] = useState(false);
  const hits = catMatch(list, t).slice(0, 6);
  const add = async (id: string) => { setBusy(true); const { error } = await supabase.rpc('bar_pick', { p_event: eventId, p_catalog: [id], p_add: true }); setBusy(false); if (!error) { setT(''); onAdded(); } };
  return (
    <div className="bp-find">
      <input className="bp-search" value={t} onChange={(e) => setT(e.target.value)} placeholder="🔍 Add a bottle from the G&R list" />
      {t.trim() && <div className="bp-sug">
        {hits.map((c) => <div key={c.id} className="bp-s"><span className="grow"><b>{c.name}</b> <small>{c.size}</small></span>
          {have.has(c.id) ? <span className="okc sm">✓ On</span> : <button className="lnk" disabled={busy} onClick={() => add(c.id)}>+ Add</button>}</div>)}
        <div className="bp-s"><span className="muted sm">Not there?</span> <button className="lnk" onClick={() => { onAddNew(t.trim()); setT(''); }}>+ Add “{t.trim()}” as a new bottle</button></div>
      </div>}
    </div>);
}
