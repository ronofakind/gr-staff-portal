import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { KINDS, KIND_LABEL, SIZES, q, totals, usedOf, moveText, toCsv, download, type BItem, type BKind, type BMove, type BSupply } from '../lib/barCount';
import { barFlags } from '../lib/barFlags';
import type { AEvent } from './api';

/* Push 69 · admin event page → Bar count (only Ronnie): totals, guard-rail flags, the log, CSV, the list per venue / client. */
type Data = { event: { id: string; title: string; date: string; supplies: boolean }; items: BItem[]; moves: BMove[];
  count: { supplies: BSupply[]; handed_to_name: string | null; handed_by_name: string | null; submitted_at: string | null; submitted_by_name: string | null } | null };
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : '');

export function BarReport({ e }: { e: AEvent }) {
  const [d, setD] = useState<Data | null | undefined>(undefined); const [edit, setEdit] = useState(false); const [hist, setHist] = useState<Record<string, number[]>>({}); const [log, setLog] = useState(false);
  const load = () => supabase.rpc('bar_count_get', { p_event: e.id }).then(({ data, error }) => setD(error ? null : (data as Data)));
  useEffect(() => { load(); }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // usual use of the same bottles at other events (last 90 days)
  useEffect(() => {
    if (!d?.items.length) return;
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    supabase.from('bar_moves').select('event_id,step,items,undone_at').neq('event_id', e.id).gte('at', since).then(({ data }) => {
      const byEv: Record<string, BMove[]> = {};
      for (const m of (data ?? []) as unknown as (BMove & { event_id: string })[]) (byEv[m.event_id] ??= []).push(m);
      const h: Record<string, number[]> = {};
      for (const ms of Object.values(byEv)) { const t = totals(ms); for (const [id, x] of Object.entries(t)) if (d.items.some((i) => i.id === id)) (h[id] ??= []).push(usedOf(x)); }
      setHist(h);
    });
  }, [d?.items.length, e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (d === undefined) return <div className="muted sm">Loading…</div>;
  if (!d) return <div className="muted sm">Couldn’t load the bar count.</div>;
  const t = totals(d.moves); const c = d.count; const sup = c?.supplies ?? [];
  const flags = barFlags(d.items, d.moves, sup, c?.submitted_at ?? null, hist);
  const bottles = d.items.filter((i) => i.kind !== 'supply' && t[i.id]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {!d.moves.length ? <div className="muted sm">No count yet. The bar manager (BM) or MD does it from their shift or My teams (🍸 Bar count).</div> : <>
        <div className="muted sm">{[c?.submitted_at ? `Submitted ${tm(c.submitted_at)}${c.submitted_by_name ? ` by ${c.submitted_by_name.split(' ')[0]}` : ''}` : 'Not submitted yet', c?.handed_to_name && `handed to ${c.handed_to_name.split(' ')[0]}${c.handed_by_name ? ` by ${c.handed_by_name.split(' ')[0]}` : ''}`, `${d.moves.length} moves logged`].filter(Boolean).join(' · ')}</div>
        {flags.length > 0 && <div className="br-flags">{flags.map((f, k) => <div key={k} className={'br-flag ' + f.level}>{f.level === 'red' ? '⛔' : '⚠'} {f.text}</div>)}</div>}
        <div className="br-grid br-h"><span>PRODUCT</span><span>OUT</span><span>BACK</span><span>USED</span></div>
        {KINDS.map((k) => { const ls = bottles.filter((i) => i.kind === k); if (!ls.length) return null; return (<div key={k}><small className="kick">{KIND_LABEL[k].toUpperCase()}</small>
          {ls.map((i) => <div key={i.id} className="br-grid"><b>{i.name}{i.size ? <small className="muted"> · {i.size}</small> : null}</b><span>{q(t[i.id].out)}</span><span>{q(t[i.id].back)}</span><b>{q(usedOf(t[i.id]))}</b></div>)}</div>); })}
        {sup.length > 0 && <div><small className="kick">SUPPLIES</small><div className="row wrap" style={{ gap: 6 }}>{sup.map((s) => <span key={s.item_id} className={'tag' + (s.level === 'Out' || s.level === '¼' ? ' amber' : '')}>{s.name} · {s.level ?? '—'}</span>)}</div></div>}
        <button className="lnk" onClick={() => setLog(!log)}>{log ? 'Hide the log' : `See the log · ${d.moves.length}`}</button>
        {log && <div>{d.moves.map((m) => <div key={m.id} className={'bc-log' + (m.undone_at ? ' undone' : '')}><b>{tm(m.at)}</b><span className="grow"><b>{m.by?.split(' ')[0] ?? '—'}</b> {moveText(m, d.items)}{m.undone_at && <em> · undone by {m.undone_by?.split(' ')[0]} (“{m.undo_reason}”)</em>}</span></div>)}</div>}
      </>}
      <div className="row" style={{ gap: 8 }}>
        {d.moves.length > 0 && <button className="abtn sm dark" onClick={() => download(`bar-count-${e.event_date}-${e.title.replace(/\W+/g, '-')}.csv`, toCsv(e.title, e.event_date, d.items, d.moves, sup))}>Download CSV</button>}
        <button className="abtn sm" onClick={() => setEdit(!edit)}>{edit ? 'Close the list' : 'Edit the list for this venue / client'}</button>
        <Link className="abtn sm" to={`/bar/${e.id}`}>Open the count</Link>
      </div>
      {edit && <BarList venueId={e.venue_id ?? null} clientId={e.event_private?.client_id ?? null} onChange={load} />}
    </div>
  );
}

type Item = { id: string; kind: BKind; name: string; size: string | null };
/** The bar list (bottles + supplies) of a venue, or of a client used without a venue. Also on Venues & clients (push 69b). */
export function BarList({ venueId, clientId, onChange = () => {} }: { venueId: string | null; clientId: string | null; onChange?: () => void }) {
  const [scope, setScope] = useState<'venue' | 'client'>(venueId ? 'venue' : 'client'); const [items, setItems] = useState<Item[]>([]); const [sup, setSup] = useState(false);
  const [f, setF] = useState<{ name: string; size: string; kind: BKind }>({ name: '', size: '750 ml', kind: 'spirit' }); const [err, setErr] = useState('');
  const key = scope === 'venue' ? venueId : clientId;
  const load = () => { if (!key) { setItems([]); return; } supabase.from('bar_items').select('id,kind,name,size').eq(scope === 'venue' ? 'venue_id' : 'client_id', key).is('archived_at', null).order('kind').order('sort').order('name').then(({ data }) => setItems((data ?? []) as Item[])); };
  useEffect(() => { load(); if (venueId) supabase.from('venues').select('bar_supplies').eq('id', venueId).maybeSingle().then(({ data }) => setSup(!!(data as { bar_supplies?: boolean } | null)?.bar_supplies)); }, [scope, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const addItem = async () => { setErr(''); const { error } = await supabase.from('bar_items').insert({ [scope === 'venue' ? 'venue_id' : 'client_id']: key, kind: f.kind, name: f.name.trim(), size: f.kind === 'supply' ? null : f.size.trim() || null, sort: items.length });
    if (error) setErr(error.message); else { setF({ ...f, name: '' }); load(); onChange(); } };
  const remove = async (id: string) => { await supabase.from('bar_items').update({ archived_at: new Date().toISOString() }).eq('id', id); load(); onChange(); };
  const toggleSup = async () => { if (!venueId) return; await supabase.from('venues').update({ bar_supplies: !sup }).eq('id', venueId); setSup(!sup); onChange(); };
  return (
    <div className="adm-card br-items">
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <b>Bar list for</b>
        {venueId && <button className={'abtn sm' + (scope === 'venue' ? ' dark' : '')} onClick={() => setScope('venue')}>this venue</button>}
        {clientId && !venueId && <button className={'abtn sm' + (scope === 'client' ? ' dark' : '')} onClick={() => setScope('client')}>this client</button>}
        <span className="grow" />{venueId && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={sup} onChange={toggleSup} /> Supplies at this venue</label>}
      </div>
      {!key && <p className="muted sm">This event has no venue or client to attach a list to.</p>}
      {[...KINDS, 'supply' as const].map((k) => { const ls = items.filter((i) => i.kind === k); if (!ls.length) return null; return <div key={k}><small className="kick">{k === 'supply' ? 'SUPPLIES' : KIND_LABEL[k].toUpperCase()}</small>
        <div className="row wrap" style={{ gap: 6 }}>{ls.map((i) => <span key={i.id} className="tag">{i.name}{i.size ? ` · ${i.size}` : ''} <button className="lnk" onClick={() => remove(i.id)}>×</button></span>)}</div></div>; })}
      {key && <div className="row wrap" style={{ gap: 6 }}>
        <select value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value as BKind })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}<option value="supply">Supply (straws, lime juice…)</option></select>
        <input value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} placeholder="Name (e.g. Grey Goose)" onKeyDown={(ev) => { if (ev.key === 'Enter' && f.name.trim()) addItem(); }} />
        {f.kind !== 'supply' && <select value={f.size} onChange={(ev) => setF({ ...f, size: ev.target.value })}>{SIZES.map((x) => <option key={x}>{x}</option>)}</select>}
        <button className="abtn sm dark" disabled={!f.name.trim()} onClick={addItem}>Add</button></div>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
