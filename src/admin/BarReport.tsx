import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { KINDS, KIND_LABEL, q, used, toCsv, download, type BKind, type BLine, type BSupply } from '../lib/barCount';
import type { AEvent } from './api';

/* Push 69 · admin event page → Bar count (only Ronnie): out / more / back / used, supplies, who, CSV, edit the list. */
type Count = { lines: BLine[]; supplies: BSupply[]; out_at: string | null; more_at: string | null; submitted_at: string | null; edited_at: string | null;
  out_by: { full_name: string } | null; back_by: { full_name: string } | null; submitted_by: { full_name: string } | null; handed_to: { full_name: string } | null; handed_by: { full_name: string } | null };
type Item = { id: string; venue_id: string | null; client_id: string | null; kind: BKind | 'supply'; name: string; size: string | null; sort: number };
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : '');
const fn = (x: { full_name: string } | null) => x?.full_name.split(' ')[0] ?? '';

export function BarReport({ e }: { e: AEvent }) {
  const [c, setC] = useState<Count | null | undefined>(undefined); const [edit, setEdit] = useState(false);
  const load = () => supabase.from('bar_counts').select('lines,supplies,out_at,more_at,submitted_at,edited_at,out_by:staff!bar_counts_out_by_fkey(full_name),back_by:staff!bar_counts_back_by_fkey(full_name),submitted_by:staff!bar_counts_submitted_by_fkey(full_name),handed_to:staff!bar_counts_handed_to_fkey(full_name),handed_by:staff!bar_counts_handed_by_fkey(full_name)')
    .eq('event_id', e.id).maybeSingle().then(({ data, error }) => setC(error ? null : (data as unknown as Count) ?? null));
  useEffect(() => { load(); }, [e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c === undefined) return <div className="muted sm">Loading…</div>;
  const lines = (c?.lines ?? []).filter((l) => (l.out || 0) + (l.more || 0) + (l.back || 0) > 0);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {!c ? <div className="muted sm">No count yet. The bar manager (BM) or MD of this event does it from their shift (🍸 Bar count).</div> : <>
        <div className="muted sm">{[c.out_at && `Out ${tm(c.out_at)}${c.out_by ? ` (${fn(c.out_by)})` : ''}`, c.more_at && `more out ${tm(c.more_at)}`, c.back_by && `back by ${fn(c.back_by)}`, c.handed_to && `handed to ${fn(c.handed_to)}${c.handed_by ? ` by ${fn(c.handed_by)}` : ''}`,
          c.submitted_at ? `submitted ${tm(c.submitted_at)}${c.submitted_by ? ` by ${fn(c.submitted_by)}` : ''}` : 'not submitted yet', c.edited_at && `edited ${tm(c.edited_at)}`].filter(Boolean).join(' · ')}</div>
        <div className="br-grid br-h"><span>PRODUCT</span><span>OUT</span><span>+ MORE</span><span>BACK</span><span>USED</span></div>
        {KINDS.map((k) => { const ls = lines.filter((l) => l.kind === k); if (!ls.length) return null; return (<div key={k}><small className="kick">{KIND_LABEL[k].toUpperCase()}</small>
          {ls.map((l) => <div key={l.key} className="br-grid"><b>{l.name}{l.size ? <small className="muted"> · {l.size}</small> : null}</b><span>{q(l.out || 0)}</span><span>{l.more ? q(l.more) : '—'}</span><span>{q(l.back || 0)}</span><b>{q(used(l))}</b></div>)}</div>); })}
        {(c.supplies ?? []).length > 0 && <div><small className="kick">SUPPLIES</small><div className="row wrap" style={{ gap: 6 }}>{c.supplies.map((s) => <span key={s.key} className={'tag' + (s.level === 'Out' || s.level === '¼' ? ' amber' : '')}>{s.name} · {s.level ?? '—'}</span>)}</div></div>}
      </>}
      <div className="row" style={{ gap: 8 }}>
        {c && <button className="abtn sm dark" onClick={() => download(`bar-count-${e.event_date}-${e.title.replace(/\W+/g, '-')}.csv`, toCsv(e.title, e.event_date, c.lines ?? [], c.supplies ?? []))}>Download CSV</button>}
        <button className="abtn sm" onClick={() => setEdit(!edit)}>{edit ? 'Close the list' : 'Edit the list for this venue / client'}</button>
        <Link className="abtn sm" to={`/bar/${e.id}`}>Open the count</Link>
      </div>
      {edit && <BarItems e={e} />}
    </div>
  );
}

function BarItems({ e }: { e: AEvent }) {
  const venueId = e.venue_id ?? null; const clientId = e.event_private?.client_id ?? null;
  const [scope, setScope] = useState<'venue' | 'client'>(venueId ? 'venue' : 'client'); const [items, setItems] = useState<Item[]>([]); const [sup, setSup] = useState(false);
  const [f, setF] = useState<{ name: string; size: string; kind: BKind | 'supply' }>({ name: '', size: '750 ml', kind: 'spirit' }); const [err, setErr] = useState('');
  const key = scope === 'venue' ? venueId : clientId;
  const load = () => { if (!key) { setItems([]); return; } supabase.from('bar_items').select('id,venue_id,client_id,kind,name,size,sort').eq(scope === 'venue' ? 'venue_id' : 'client_id', key).is('archived_at', null).order('kind').order('sort').order('name').then(({ data }) => setItems((data ?? []) as Item[])); };
  useEffect(() => { load(); if (venueId) supabase.from('venues').select('bar_supplies').eq('id', venueId).maybeSingle().then(({ data }) => setSup(!!(data as { bar_supplies?: boolean } | null)?.bar_supplies)); }, [scope, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const addItem = async () => { setErr(''); const { error } = await supabase.from('bar_items').insert({ [scope === 'venue' ? 'venue_id' : 'client_id']: key, kind: f.kind, name: f.name.trim(), size: f.kind === 'supply' ? null : f.size.trim() || null, sort: items.length });
    if (error) setErr(error.message); else { setF({ ...f, name: '' }); load(); } };
  const remove = async (id: string) => { await supabase.from('bar_items').update({ archived_at: new Date().toISOString() }).eq('id', id); load(); };
  const toggleSup = async () => { if (!venueId) return; await supabase.from('venues').update({ bar_supplies: !sup }).eq('id', venueId); setSup(!sup); };
  return (
    <div className="adm-card br-items">
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <b>Bar list for</b>
        {venueId && <button className={'abtn sm' + (scope === 'venue' ? ' dark' : '')} onClick={() => setScope('venue')}>this venue</button>}
        {clientId && <button className={'abtn sm' + (scope === 'client' ? ' dark' : '')} onClick={() => setScope('client')}>this client</button>}
        <span className="grow" />{venueId && <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={sup} onChange={toggleSup} /> Supplies at this venue</label>}
      </div>
      {!key && <p className="muted sm">This event has no venue or client to attach a list to.</p>}
      {[...KINDS, 'supply' as const].map((k) => { const ls = items.filter((i) => i.kind === k); if (!ls.length) return null; return <div key={k}><small className="kick">{k === 'supply' ? 'SUPPLIES' : KIND_LABEL[k].toUpperCase()}</small>
        <div className="row wrap" style={{ gap: 6 }}>{ls.map((i) => <span key={i.id} className="tag">{i.name}{i.size ? ` · ${i.size}` : ''} <button className="lnk" onClick={() => remove(i.id)}>×</button></span>)}</div></div>; })}
      {key && <div className="row wrap" style={{ gap: 6 }}>
        <select value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value as BKind | 'supply' })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}<option value="supply">Supply (straws, lime juice…)</option></select>
        <input value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} placeholder="Name (e.g. Grey Goose)" onKeyDown={(ev) => { if (ev.key === 'Enter' && f.name.trim()) addItem(); }} />
        {f.kind !== 'supply' && <select value={f.size} onChange={(ev) => setF({ ...f, size: ev.target.value })}>{['750 ml', '1.14 L', 'Magnum 1.5 L', '341 ml', '355 ml can', '473 ml can'].map((x) => <option key={x}>{x}</option>)}</select>}
        <button className="abtn sm dark" disabled={!f.name.trim()} onClick={addItem}>Add</button></div>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
