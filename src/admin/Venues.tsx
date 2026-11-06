import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PinEditor, type Pin } from '../components/VenuePin';
import { supabase } from '../lib/supabase';
import { setting, useSettings } from '../lib/settings';
import { dLabel, isoDay, type Venue, type Client } from './api';
import { AddressInput, type AddressParts } from '../components/AddressInput';
import { PhotoViewer } from '../components/Avatar';
import { UniDept, itemsOf, uniName } from './EventForm';
import type { UniItems, UniItemsMap, UniLineKey } from '../components/Uniform';

/*
 * Push 32a · Admin → More → Venues & clients. Everything New event pre-fills comes from here.
 * Edits apply to new events only: New event copies these values into the event when it is saved.
 */
type Tab = 'venues' | 'clients' | 'homes';
type RateSet = Client['rate_sets'][number];
type V = Venue & { staff_notes?: string | null; venue_notes?: string | null; photos?: string[] | null; always_offer_rides?: boolean; no_outside_food?: boolean; archived_at?: string | null };
type C = Client & { qb_customer?: string | null; extras_billing?: 'gr' | 'client'; transport_billing?: 'client' | 'gr'; admin_fee_pct?: number | null };
type Count = { n: number; last: string | null; next: string | null; bar: boolean; floor: boolean };

const V_COLS = 'id,name,address,street,unit,city,province,postal_code,usual_client_id,staff_notes,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items,always_offer_rides,no_outside_food,pin_lat,pin_lng,pin_label,archived_at';
const C_COLS = 'id,name,qb_customer,rate_sets,kind,address,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items,drive_folder_default,extras_billing';
/** 038 columns; read in a second pass so the page works before the migration is applied. */
const V_038 = ',venue_notes,photos'; const C_038 = ',admin_fee_pct,transport_billing';

/** QuickBooks customer names from the invoice-builder naming table (text match only, no QuickBooks call). */
export const QB_NAMES: [string, string][] = [
  ['Beatrice', 'Daniel Bilodeau'], ['Power Corp', 'CHRISTOPHE BOURRAT'], ['BMO', 'Diane Piche'],
  ['Bitton', 'Danielle Bitton'], ['Brera', 'Traiteur Brera Inc.'], ['La Nesra', 'La Nesra'],
];
const low = (x: string | null | undefined) => (x ?? '').trim().toLowerCase();
export function qbCheck(name: string, qb: string | null | undefined): { state: 'linked' | 'differs' | 'unknown' | 'empty'; expected?: string } {
  const hit = QB_NAMES.find(([k, v]) => low(name).includes(low(k)) || low(name).includes(low(v)) || (low(qb) && low(qb) === low(v)));
  if (!low(qb)) return { state: 'empty', expected: hit?.[1] };
  if (!hit) return { state: 'unknown' };
  return low(qb) === low(hit[1]) ? { state: 'linked', expected: hit[1] } : { state: 'differs', expected: hit[1] };
}

/** "550 Avenue Richmond, Montréal, QC H3J 1V3" → "550 Av. Richmond" · keeps a suburb ("…, Mont-Royal"). */
const shortAddr = (a: string | null | undefined) => { const p = (a ?? '').split(',').map((x) => x.trim()); return [p[0], p[1] && !/montr[ée]al|\bQC\b|\d/i.test(p[1]) ? p[1] : ''].filter(Boolean).join(', ').replace(/\bAvenue\b/, 'Av.'); };
const lastLabel = (c?: Count) => !c?.n ? 'no events yet' : `${c.n} event${c.n === 1 ? '' : 's'}`;
const UNI_DEF = { floor_m: 'white_shirt', floor_w: 'white_shirt', bar_m: 'black_shirt', bar_w: 'dress' };

export function Venues() {
  useSettings();
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem('gr-vc-tab') as Tab) || 'venues'; } catch { return 'venues'; } });
  const [venues, setVenues] = useState<V[] | null>(null); const [clients, setClients] = useState<C[] | null>(null);
  const [has038, setHas038] = useState(true);
  const [counts, setCounts] = useState<{ v: Record<string, Count>; c: Record<string, Count> }>({ v: {}, c: {} });
  const [q, setQ] = useState(''); const [sel, setSel] = useState<string | null>(null); const [showArch, setShowArch] = useState(false);
  const setTabK = (t: Tab) => { setTab(t); setSel(null); setQ(''); try { localStorage.setItem('gr-vc-tab', t); } catch { /* private mode */ } };

  const load = async () => {
    const vq = (x: string) => supabase.from('venues').select(V_COLS + x).order('name');
    const cq = (x: string) => supabase.from('clients').select(C_COLS + x).order('name');
    let [v, c] = await Promise.all([vq(V_038), cq(C_038)]);
    const ok = !v.error && !c.error; setHas038(ok);
    if (v.error) v = await vq(''); if (c.error) c = await cq('');
    setVenues((v.data ?? []) as unknown as V[]); setClients((c.data ?? []) as unknown as C[]);
  };
  useEffect(() => {
    load();
    // "n events · last <date>": one row per date (floor + bar of the same event count once)
    supabase.from('events').select('venue_id,event_date,department,event_private(client_id)').then(({ data }) => {
      const today = isoDay(new Date()); const v: Record<string, Count> = {}; const c: Record<string, Count> = {};
      const seen = new Set<string>();
      const add = (m: Record<string, Count>, k: string, d: string, dept: string) => {
        const x = (m[k] ??= { n: 0, last: null, next: null, bar: false, floor: false });
        if (dept === 'bar') x.bar = true; else x.floor = true;
        if (seen.has(k + d)) return; seen.add(k + d); x.n++;
        if (d <= today && (!x.last || d > x.last)) x.last = d;
        if (d > today && (!x.next || d < x.next)) x.next = d;
      };
      for (const r of (Array.isArray(data) ? data : []) as unknown as { venue_id: string | null; event_date: string; department: string; event_private: { client_id: string | null } | { client_id: string | null }[] | null }[]) {
        if (!r || typeof r.event_date !== 'string') continue;
        const ep = Array.isArray(r.event_private) ? r.event_private[0] : r.event_private;
        if (r.venue_id) add(v, 'v' + r.venue_id, r.event_date, r.department);
        if (ep?.client_id) add(c, 'c' + ep.client_id, r.event_date, r.department);
      }
      const strip = (m: Record<string, Count>) => Object.fromEntries(Object.entries(m).map(([k, x]) => [k.slice(1), x]));
      setCounts({ v: strip(v), c: strip(c) });
    });
  }, []);

  const homes = (clients ?? []).filter((c) => c.kind === 'private_home');
  const plain = (clients ?? []).filter((c) => c.kind !== 'private_home');
  const list = useMemo(() => {
    const w = low(q);
    if (tab === 'venues') return (venues ?? []).filter((x) => (showArch || !x.archived_at || x.id === sel) && (!w || low(x.name + ' ' + (x.address ?? '')).includes(w))).sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at));
    return (tab === 'homes' ? homes : plain).filter((x) => !w || low(x.name + ' ' + (x.address ?? '') + ' ' + (x.qb_customer ?? '')).includes(w));
  }, [tab, q, venues, clients, showArch, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const clientName = (id: string | null | undefined) => (clients ?? []).find((c) => c.id === id)?.name ?? null;

  const cur = sel === 'new' ? null : tab === 'venues' ? (venues ?? []).find((x) => x.id === sel) ?? null : (clients ?? []).find((x) => x.id === sel) ?? null;
  const openClient = (id: string) => { setTabK((clients ?? []).find((c) => c.id === id)?.kind === 'private_home' ? 'homes' : 'clients'); setSel(id); };

  return (
    <div className="stack-lg vc">
      <div className="vc-top"><h1 className="serif-h">Venues &amp; clients</h1><span className="muted sm">Admin → More → Venues &amp; clients · everything New event pre-fills comes from here · changes apply to new events only</span></div>
      {!has038 && <p className="tag amber" style={{ height: 'auto', padding: '8px 12px', whiteSpace: 'normal' }}>Migration 038 isn’t applied yet: venue notes, photos, admin fee and transport billing are read-only until it is.</p>}
      <div className={'vc-grid' + (sel ? ' has-sel' : '')}>
        <div className="vc-list">
          <div className="seg3 vc-tabs">
            {([['venues', 'Venues', venues?.filter((x) => !x.archived_at).length], ['clients', 'Clients', plain.length], ['homes', 'Private homes', homes.length]] as [Tab, string, number | undefined][]).map(([k, l, n]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTabK(k)}>{l}{n != null ? ` · ${n}` : ''}</button>
            ))}
          </div>
          <input className="vc-search" placeholder={tab === 'venues' ? 'Search venues…' : tab === 'homes' ? 'Search private homes…' : 'Search clients…'} value={q} onChange={(e) => setQ(e.target.value)} />
          {venues === null && <div className="muted sm">Loading…</div>}
          {tab === 'venues' ? (list as V[]).map((x) => {
            const c = counts.v[x.id];
            const bits = [lastLabel(c), c?.bar && c?.floor ? 'floor + bar' : c?.bar ? 'bar' : '', x.always_offer_rides ? '🚗 rides' : '', x.no_outside_food ? 'no outside food' : ''].filter(Boolean).join(' · ');
            return (
              <button key={x.id} className={'vc-row' + (sel === x.id ? ' on' : '')} onClick={() => setSel(x.id)}>
                <span className="spread"><b>{x.name}{x.archived_at && <em className="vc-arch"> · archived</em>}</b><small>{bits}</small></span>
                <small>{x.address ? [shortAddr(x.address), clientName(x.usual_client_id)].filter(Boolean).join(' · ') : <span className="vc-miss">address missing</span>}</small>
              </button>
            );
          }) : (list as C[]).map((x) => {
            const c = counts.c[x.id]; const qb = qbCheck(x.name, x.qb_customer);
            return (
              <button key={x.id} className={'vc-row' + (sel === x.id ? ' on' : '')} onClick={() => setSel(x.id)}>
                <span className="spread"><b>{x.name}</b><small>{lastLabel(c)}{qb.state === 'linked' ? ' · ✓ QB' : ''}</small></span>
                <small>{tab === 'homes' ? (x.address ? shortAddr(x.address) : <span className="vc-miss">address missing</span>)
                  : [x.kind === 'roaming' ? 'venue changes each time' : '', x.qb_customer ? `QB: ${x.qb_customer}` : 'no QuickBooks name', (x.admin_fee_pct ?? 10) !== 10 ? `admin fee ${x.admin_fee_pct}%` : ''].filter(Boolean).join(' · ')}</small>
              </button>
            );
          })}
          {list.length === 0 && venues !== null && <div className="muted sm" style={{ padding: '6px 2px' }}>Nothing matches “{q}”.</div>}
          {tab === 'venues' && (venues ?? []).some((x) => x.archived_at) && <button className="lnk sm vc-archt" onClick={() => setShowArch(!showArch)}>{showArch ? '▾ Hide archived' : `▸ Archived (${(venues ?? []).filter((x) => x.archived_at).length}) · tap to see / bring back`}</button>}
          <button className="vc-new" onClick={() => setSel('new')}>+ New {tab === 'venues' ? 'venue' : tab === 'homes' ? 'private home' : 'client'}</button>
        </div>

        <div className="vc-card">
          {sel && <button className="vc-back muted sm strong" onClick={() => setSel(null)}>‹ All {tab === 'venues' ? 'venues' : tab === 'homes' ? 'private homes' : 'clients'}</button>}
          {!sel && <div className="adm-card vc-empty muted">Pick a {tab === 'venues' ? 'venue' : tab === 'homes' ? 'private home' : 'client'} on the left, or add a new one.</div>}
          {sel && tab === 'venues' && venues && clients && <VenueCard key={sel} v={cur as V | null} clients={clients} count={cur ? counts.v[cur.id] : undefined} has038={has038} all={venues}
            onSaved={async (id) => { await load(); setSel(id); }} onGone={async () => { await load(); setSel(null); }} onClient={openClient} />}
          {sel && tab !== 'venues' && clients && venues && <ClientCard key={sel + tab} c={cur as C | null} home={tab === 'homes'} venues={venues} count={cur ? counts.c[cur.id] : undefined} has038={has038}
            onSaved={async (id) => { await load(); const k = (await supabase.from('clients').select('kind').eq('id', id).maybeSingle()).data?.kind; if ((k === 'private_home') !== (tab === 'homes')) setTabK(k === 'private_home' ? 'homes' : 'clients'); setSel(id); }} />}
        </div>
      </div>
    </div>
  );
}

// ───────── shared bits ─────────
function Sec({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <section className="adm-card vc-sec"><div className="vc-sec-h"><span>{title}</span>{sub && <small>{sub}</small>}</div>{children}</section>;
}
function Sw({ on, set, label, sub, disabled }: { on: boolean; set: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) {
  return (
    <div className="sw-row vc-sw">
      <button type="button" role="switch" aria-checked={on} disabled={disabled} className={'sw' + (on ? ' on' : '')} onClick={() => set(!on)}><span className="sw-track"><span className="sw-knob" /></span><span className="sw-lbl">{on ? 'ON' : 'OFF'}</span></button>
      <span className="vc-sw-t"><b>{label}</b>{sub && <small className="muted">{sub}</small>}</span>
    </div>
  );
}
function Head({ name, count, busy, saved, onSave, isNew }: { name: string; count?: Count; busy: boolean; saved: string | null; onSave: () => void; isNew: boolean }) {
  const yr = new Date().getFullYear();
  return (
    <div className="vc-head">
      <div className="grow" style={{ minWidth: 0 }}>
        <span className="serif vc-name">{name || (isNew ? 'New' : '—')}</span>
        <span className="muted sm">{isNew ? 'not saved yet' : !count?.n ? 'no events yet' : `${count.n} event${count.n === 1 ? '' : 's'}${count.last?.startsWith(String(yr)) ? ` in ${yr}` : ''}${count.last ? ` · last ${dLabel(count.last)}` : ''}${count.next ? ` · next ${dLabel(count.next)}` : ''}`}</span>
      </div>
      {saved && <span className="okc sm strong">✓ Saved {saved}</span>}
      <button className="abtn dark" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  );
}
const nowLabel = () => new Date().toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).replace(/\./g, '').toUpperCase();

/** Floor + bar uniform lines (same piece chips as the event form, uniform_items format). */
type Uni = { floor_m: string; floor_w: string; bar_m: string; bar_w: string; items: UniItemsMap };
const uniOf = (x: { uniform_floor?: string | null; uniform_floor_w?: string | null; uniform_bar?: string | null; uniform_bar_w?: string | null; uniform_items?: UniItemsMap | null } | null): Uni => ({
  floor_m: x?.uniform_floor ?? UNI_DEF.floor_m, floor_w: x?.uniform_floor_w ?? x?.uniform_floor ?? UNI_DEF.floor_w,
  bar_m: x?.uniform_bar ?? UNI_DEF.bar_m, bar_w: x?.uniform_bar_w ?? UNI_DEF.bar_w, items: (x?.uniform_items ?? {}) as UniItemsMap,
});
const uniRow = (u: Uni) => ({
  uniform_floor: u.floor_m, uniform_floor_w: u.floor_w, uniform_bar: u.bar_m, uniform_bar_w: u.bar_w,
  uniform_items: { floor_m: itemsOf(u.items, 'floor_m', u.floor_m), floor_w: itemsOf(u.items, 'floor_w', u.floor_w), bar_m: itemsOf(u.items, 'bar_m', u.bar_m), bar_w: itemsOf(u.items, 'bar_w', u.bar_w) },
});
function Uniforms({ u, set }: { u: Uni; set: (u: Uni) => void }) {
  const si = (k: UniLineKey, i: UniItems) => set({ ...u, items: { ...u.items, [k]: i } });
  return (
    <div className="uni-card vc-uni">
      <UniDept label="Floor" sub="MD · waiters · busboys" bar={false} men={u.floor_m} women={u.floor_w} setMen={(v) => set({ ...u, floor_m: v })} setWomen={(v) => set({ ...u, floor_w: v })} items={u.items} setItems={si} />
      <UniDept label="Bar" sub="BM · bartenders · barbacks" bar men={u.bar_m} women={u.bar_w} setMen={(v) => set({ ...u, bar_m: v })} setWomen={(v) => set({ ...u, bar_w: v })} items={u.items} setItems={si} />
    </div>
  );
}
const uniSummary = (u: Uni) => `Floor · men ${uniName(u.floor_m)} · women ${uniName(u.floor_w)} — Bar · men ${uniName(u.bar_m)} · women ${uniName(u.bar_w)}`;

// ───────── venue card ─────────
function VenueCard({ v, clients, count, has038, all, onSaved, onGone, onClient }: { v: V | null; clients: C[]; count?: Count; has038: boolean; all: V[]; onSaved: (id: string) => void; onGone: () => void; onClient: (id: string) => void }) {
  const [name, setName] = useState(v?.name ?? ''); const [clientId, setClientId] = useState(v?.usual_client_id ?? '');
  const [address, setAddress] = useState(v?.address ?? ''); const [parts, setParts] = useState<AddressParts | null>(null);
  const [parking, setParking] = useState(v?.staff_notes ?? ''); const [notes, setNotes] = useState(v?.venue_notes ?? '');
  const [pin, setPin] = useState<Pin | null>(() => { const x = v as unknown as { pin_lat?: number | null; pin_lng?: number | null; pin_label?: string | null } | null; return x?.pin_lat != null && x?.pin_lng != null ? { lat: x.pin_lat, lng: x.pin_lng, label: x.pin_label ?? '' } : null; });
  const [rides, setRides] = useState(!!v?.always_offer_rides); const [noFood, setNoFood] = useState(!!v?.no_outside_food); const [u, setU] = useState<Uni>(() => uniOf(v));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [saved, setSaved] = useState<string | null>(null);
  const client = clients.find((c) => c.id === clientId) ?? null;
  const far = setting('transport.far_min');

  const save = async () => {
    if (!name.trim()) return setErr('Give the venue a name (what staff see).');
    setBusy(true); setErr('');
    const row: Record<string, unknown> = {
      name: name.trim(), usual_client_id: clientId || null, address: address.trim() || null, staff_notes: parking.trim() || null, always_offer_rides: rides, no_outside_food: noFood, ...uniRow(u),
      ...(parts ? { street: parts.street, unit: parts.unit || null, city: parts.city, province: parts.province, postal_code: parts.postal_code } : {}),
      ...(has038 ? { venue_notes: notes.trim() || null } : {}),
      pin_lat: pin?.lat ?? null, pin_lng: pin?.lng ?? null, pin_label: pin?.label?.trim() || null,
    };
    const r = v ? await supabase.from('venues').update(row).eq('id', v.id).select('id').single() : await supabase.from('venues').insert(row).select('id').single();
    setBusy(false);
    if (r.error) return setErr(/duplicate|unique/i.test(r.error.message) ? `There is already a venue called “${name.trim()}”.` : r.error.message);
    setSaved(nowLabel()); onSaved(r.data.id as string);
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Head name={name} count={count} busy={busy} saved={saved} onSave={save} isNew={!v} />
      {err && <p className="error">{err}</p>}
      <div className="vc-cols">
        <div className="stack" style={{ gap: 12 }}>
          <Sec title="BASICS">
            <div className="vc-2">
              <label className="ef-f"><span>NAME · WHAT STAFF SEE</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Salon Richmond" /></label>
              <label className="ef-f"><span>USUAL CLIENT</span>
                <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">—</option>
                  {clients.filter((c) => c.kind !== 'private_home').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select><small className="muted">fills the client on New event</small></label>
            </div>
            <div className="ef-f"><span>ADDRESS</span><AddressInput value={address} onChange={(x) => { setAddress(x); setParts(null); }} onPick={setParts} placeholder="Start typing the address…" />
              <small className="muted">Google autocomplete once the Maps key is set · plain text until then{!address.trim() && <b className="accent"> · address missing</b>}</small></div>
            <PinEditor pin={pin} set={setPin} />
          </Sec>
          <Sec title="FOR STAFF" sub="shown on their event page">
            <label className="ef-f"><span>PARKING &amp; ENTRANCE</span><textarea rows={3} value={parking} onChange={(e) => setParking(e.target.value)} placeholder="Street parking after 6 PM… Staff entrance: side door." />
              <small className="muted">under Where, and in “I’m running late” (same field as the venue staff notes)</small></label>
            <label className="ef-f"><span>VENUE NOTES</span><textarea rows={3} value={notes} disabled={!has038} onChange={(e) => setNotes(e.target.value)} placeholder="Coats and bags in the room behind the kitchen. No phones on the floor." />
              <small className="muted">under Notes on their event page</small></label>
            <VenuePhotos venue={v} disabled={!has038} />
          </Sec>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <Sec title="USUAL UNIFORMS" sub="pre-filled on New event"><Uniforms u={u} set={setU} /></Sec>
          <Sec title="TRANSPORT">
            <Sw on={rides} set={setRides} label="Always offer rides" sub="turn on for hard-to-reach venues (e.g. Le Andover) · New event suggests Transport ON" />
            <Sw on={noFood} set={setNoFood} label="No outside food" sub="synagogues / Chabad · staff see the no-outside-food icon on every event here" />
            <small className="muted">Far event = {far} min+ drive from the office (<Link to="/admin/settings">Settings</Link>). Drive time from the office isn’t stored on venues yet (needs the Google Maps key), so it isn’t shown here.</small>
          </Sec>
          <Sec title="FROM THE CLIENT" sub={client ? undefined : 'pick a usual client'}>
            {client ? <>
              <div className="spread"><b>{client.name}</b><button className="link-btn" onClick={() => onClient(client.id)}>edit in Clients ›</button></div>
              <div className="vc-facts">
                <span><small>Extras</small><b>{client.extras_billing === 'client' ? 'Client pays' : 'On G&R'}</b></span>
                <span><small>Transport</small><b>{(client.transport_billing ?? (setting('transport.client_pays') ? 'client' : 'gr')) === 'client' ? 'Client pays' : 'On G&R'}</b></span>
                <span><small>Drive folder on Save</small><b>{client.drive_folder_default === false ? 'OFF' : 'ON'}</b></span>
                <span><small>Admin fee</small><b>{client.admin_fee_pct ?? 10}%</b></span>
                <span><small>Rates</small><b>{client.rate_sets?.length ? client.rate_sets.map((r) => r.label).join(' / ') : 'Standard'}</b></span>
              </div>
            </> : <small className="muted">The client’s billing (extras, transport, admin fee, rates) shows here.</small>}
          </Sec>
          {v && <VenueRemove v={v} all={all} onSaved={onSaved} onGone={onGone} />}
        </div>
      </div>
    </div>
  );
}

/** 074 · archive / delete a venue · move its events to the right one (duplicates). */
type VEv = { id: string; title: string; event_date: string; department: string };
function VenueRemove({ v, all, onSaved, onGone }: { v: V; all: V[]; onSaved: (id: string) => void; onGone: () => void }) {
  const [open, setOpen] = useState(false); const [evs, setEvs] = useState<VEv[] | null>(null); const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [sure, setSure] = useState(false);
  const today = isoDay(new Date());
  const show = async () => {
    setOpen(true); setErr(''); setSure(false);
    const { data, error } = await supabase.from('events').select('id,title,event_date,department').eq('venue_id', v.id).order('event_date', { ascending: false });
    if (error) setErr(error.message); setEvs((data ?? []) as VEv[]);
  };
  const archive = async (on: boolean) => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('venues').update({ archived_at: on ? new Date().toISOString() : null }).eq('id', v.id);
    setBusy(false); if (error) return setErr(error.message); setOpen(false); onSaved(v.id);
  };
  const remove = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_venue_remove', { p_venue: v.id, p_move_to: to || null });
    setBusy(false); if (error) return setErr(error.message); onGone();
  };
  const n = evs?.length ?? 0; const up = (evs ?? []).filter((e) => e.event_date >= today).length;
  const others = all.filter((x) => x.id !== v.id && !x.archived_at);
  return (
    <section className="adm-card vc-sec vc-rm">
      <div className="vc-sec-h"><span>{v.archived_at ? '🗄️ ARCHIVED' : 'REMOVE THIS VENUE'}</span><small>{v.archived_at ? 'hidden from the list and the venue picker' : 'duplicates, old names'}</small></div>
      {!open && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {v.archived_at ? <button className="abtn sm dark" disabled={busy} onClick={() => archive(false)}>Bring it back</button>
          : <button className="abtn sm" disabled={busy} onClick={() => archive(true)}>🗄️ Archive</button>}
        <button className="abtn sm vc-del" onClick={show}>🔀 Move its events / 🗑 Delete</button></div>}
      {open && evs === null && <small className="muted">Looking for its events…</small>}
      {open && evs && <div className="stack" style={{ gap: 10 }}>
        {n > 0 ? <>
          <b className="vc-warn">⚠️ {n} event{n === 1 ? '' : 's'} use “{v.name}”{up ? ` · ${up} upcoming` : ''}</b>
          <div className="vc-evs">{evs.map((e) => (
            <Link key={e.id} className="vc-ev" to={`/admin/bookings?date=${e.event_date}&view=board&ev=${e.id}`}>
              <span className="vc-ev-d">{dLabel(e.event_date)}</span><span className="grow">{e.title}{e.department === 'bar' ? ' · bar' : ''}</span>
              <small className={e.event_date >= today ? 'accent' : 'muted'}>{e.event_date >= today ? 'UPCOMING' : 'PAST'}</small><b>Open ›</b></Link>))}</div>
          <label className="ef-f"><span>MOVE THESE EVENTS TO</span>
            <select value={to} onChange={(e) => { setTo(e.target.value); setSure(false); }}><option value="">Pick the right venue…</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}{x.address ? ` · ${shortAddr(x.address)}` : ''}</option>)}</select>
            <small className="muted">Events switch to that venue (address, 📍 spot, photos). Staff only get a “shift changed” note if the address is different. Anything the right venue is missing (spot, photos, notes) is copied over.</small></label>
          {!sure ? <button className="abtn dark" disabled={!to || busy} onClick={() => setSure(true)}>Move {n} event{n === 1 ? '' : 's'} + delete this one</button>
            : <button className="abtn vc-delb" disabled={busy} onClick={remove}>{busy ? 'Moving…' : `Yes, move ${n} and delete “${v.name}”`}</button>}
          <div className="row" style={{ gap: 8 }}>{!v.archived_at && <button className="abtn sm" disabled={busy} onClick={() => archive(true)}>Archive instead</button>}<button className="abtn sm" onClick={() => setOpen(false)}>Cancel</button></div>
        </> : <>
          <b>Delete “{v.name}”?</b><small className="muted">No events use it. This can’t be undone.</small>
          <div className="row" style={{ gap: 8 }}>{!sure ? <button className="abtn vc-delb" onClick={() => setSure(true)}>🗑 Delete</button> : <button className="abtn vc-delb" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Yes, delete it'}</button>}<button className="abtn sm" onClick={() => setOpen(false)}>Cancel</button></div>
        </>}
      </div>}
      {err && <p className="error">{err}</p>}
    </section>
  );
}

/** Venue photos: private bucket venue-photos, paths saved in venues.photos. Upload / remove save right away. */
function VenuePhotos({ venue, disabled }: { venue: V | null; disabled: boolean }) {
  const [paths, setPaths] = useState<string[]>(Array.isArray(venue?.photos) ? venue!.photos!.filter((p) => typeof p === 'string') : []);
  const [urls, setUrls] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [view, setView] = useState<number | null>(null);
  useEffect(() => {
    const need = paths.filter((p) => !urls[p]); if (!need.length) return;
    supabase.storage.from('venue-photos').createSignedUrls(need, 3600).then(({ data }) => {
      const m = { ...urls }; (data ?? []).forEach((d, i) => { if (d.signedUrl) m[need[i]] = d.signedUrl; }); setUrls(m);
    });
  }, [paths.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const store = async (next: string[]) => { const { error } = await supabase.from('venues').update({ photos: next }).eq('id', venue!.id); if (error) throw error; setPaths(next); };
  const add = async (files: FileList | null) => {
    if (!files?.length || !venue) return; setBusy(true); setErr('');
    try {
      const added: string[] = [];
      for (const f of Array.from(files)) {
        const blob = await shrink(f); const p = `${venue.id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        const up = await supabase.storage.from('venue-photos').upload(p, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error; added.push(p);
      }
      await store([...paths, ...added]);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const remove = async (p: string) => {
    if (!confirm('Remove this photo? Staff stop seeing it.')) return;
    try { await store(paths.filter((x) => x !== p)); await supabase.storage.from('venue-photos').remove([p]); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      {paths.length > 0 && <div className="vc-photos">{paths.map((p, i) => (
        <span key={p} className="vc-ph">{urls[p] ? <button type="button" onClick={() => setView(i)} aria-label={`Open photo ${i + 1}`}><img src={urls[p]} alt="" /></button> : <i />}
          <button type="button" className="vc-ph-x" aria-label="Remove photo" onClick={() => remove(p)}>×</button></span>
      ))}</div>}
      {!venue ? <small className="muted">Save the venue first, then add photos.</small>
        : <label className={'vc-addph' + (disabled || busy ? ' off' : '')}>{busy ? 'Uploading…' : '+ Add photos'} <small className="muted">(entrance, coat room · staff tap to see full screen)</small>
          <input type="file" accept="image/*" multiple hidden disabled={disabled || busy} onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>}
      {err && <p className="error">{err}</p>}
      {view !== null && urls[paths[view]] && <PhotoViewer wide name={venue?.name ?? ''} url={urls[paths[view]]} sub={`Photo ${view + 1} of ${paths.length}`} onClose={() => setView(null)} />}
    </div>
  );
}
/** Longest side 1600 px JPEG (phone photos are 4–8 MB). */
async function shrink(f: File): Promise<Blob> {
  try {
    const img = await createImageBitmap(f); const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((r) => c.toBlob((b) => r(b ?? f), 'image/jpeg', 0.85));
  } catch { return f; }
}

// ───────── client card (also private homes) ─────────
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'set';
function ClientCard({ c, home, venues, count, has038, onSaved }: { c: C | null; home: boolean; venues: V[]; count?: Count; has038: boolean; onSaved: (id: string) => void }) {
  const [name, setName] = useState(c?.name ?? ''); const [kind, setKind] = useState<'' | 'private_home' | 'roaming'>(c?.kind ?? (home ? 'private_home' : ''));
  const [qb, setQb] = useState(c?.qb_customer ?? ''); const [fee, setFee] = useState(String(c?.admin_fee_pct ?? (/brera/i.test(c?.name ?? '') ? 8 : 10)));
  const [drive, setDrive] = useState(c ? c.drive_folder_default !== false : true);
  const [extras, setExtras] = useState<'gr' | 'client'>(c?.extras_billing ?? setting('extras.default_billing'));
  const [transport, setTransport] = useState<'client' | 'gr'>(c?.transport_billing ?? (setting('transport.client_pays') ? 'client' : 'gr'));
  const [rates, setRates] = useState<RateSet[]>(Array.isArray(c?.rate_sets) ? c!.rate_sets : []);
  const [address, setAddress] = useState(c?.address ?? ''); const [u, setU] = useState<Uni>(() => uniOf(c));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [saved, setSaved] = useState<string | null>(null);
  const isHome = kind === 'private_home';
  const check = qbCheck(name, qb);
  const usedBy = c ? venues.filter((v) => v.usual_client_id === c.id) : [];
  const roles = Array.from(new Set(rates.flatMap((r) => Object.keys(r.rates ?? {})))); const roleCols = roles.length ? roles : ['BM', 'BT', 'BB'];

  const save = async () => {
    if (!name.trim()) return setErr('Give the client a name.');
    const pct = Number(fee); if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setErr('Admin fee is a percent between 0 and 100.');
    const keys = rates.map((r) => r.key); if (new Set(keys).size !== keys.length) return setErr('Two rate sets have the same name.');
    setBusy(true); setErr('');
    const row: Record<string, unknown> = {
      name: name.trim(), kind: kind || null, qb_customer: qb.trim() || null, drive_folder_default: drive, extras_billing: extras, rate_sets: rates,
      ...(has038 ? { admin_fee_pct: pct, transport_billing: transport } : {}),
      ...(isHome ? { address: address.trim() || null, ...uniRow(u) } : {}),
    };
    const r = c ? await supabase.from('clients').update(row).eq('id', c.id).select('id').single() : await supabase.from('clients').insert(row).select('id').single();
    setBusy(false);
    if (r.error) return setErr(/duplicate|unique/i.test(r.error.message) ? `There is already a client called “${name.trim()}”.` : r.error.message);
    setSaved(nowLabel()); onSaved(r.data.id as string);
  };
  const setRate = (i: number, p: Partial<RateSet>) => setRates(rates.map((r, k) => (k === i ? { ...r, ...p } : r)));

  return (
    <div className="stack" style={{ gap: 12 }}>
      <Head name={name} count={count} busy={busy} saved={saved} onSave={save} isNew={!c} />
      {err && <p className="error">{err}</p>}
      <div className="vc-cols">
        <div className="stack" style={{ gap: 12 }}>
          <Sec title={isHome ? 'PRIVATE HOME' : 'CLIENT'} sub={isHome ? 'the client is the venue' : 'only you see it'}>
            <label className="ef-f"><span>{isHome ? 'NAME · WHAT STAFF SEE' : 'NAME'}</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={isHome ? 'e.g. Bitton residence' : 'e.g. Danielle Bitton'} /></label>
            <div className="ef-f"><span>KIND</span>
              <div className="seg3">{([['', 'Client'], ['private_home', 'Private home'], ['roaming', 'Changes each time']] as const).map(([k, l]) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div></div>
            {!isHome && usedBy.length > 0 && <small className="muted">Usual client of: {usedBy.map((v) => v.name).join(', ')}</small>}
          </Sec>
          <Sec title="BILLING" sub="pre-filled on New event">
            <div className="vc-2">
              <label className="ef-f"><span>QUICKBOOKS CUSTOMER</span><input value={qb} onChange={(e) => setQb(e.target.value)} placeholder={check.expected ?? 'Name as in QuickBooks'} />
                {check.state === 'linked' ? <small className="okc strong">✓ linked · matches the invoice-builder table</small>
                  : check.state === 'differs' ? <small className="amberc strong">Invoice builder uses “{check.expected}” <button type="button" className="link-btn" onClick={() => setQb(check.expected!)}>use it</button></small>
                  : check.state === 'empty' ? <small className="muted">{check.expected ? <>Invoice builder uses “{check.expected}” <button type="button" className="link-btn" onClick={() => setQb(check.expected!)}>use it</button></> : 'empty = the invoice builder looks it up by name'}</small>
                  : <small className="muted">not in the invoice-builder table · text only, QuickBooks isn’t checked</small>}</label>
              <label className="ef-f"><span>ADMIN FEE %</span><input inputMode="decimal" value={fee} disabled={!has038} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))} /><small className="muted">of the labour subtotal · default 10 (Brera 8)</small></label>
            </div>
            <Sw on={drive} set={setDrive} label="Create Drive folder on Save" sub="New event → Event folder starts ON / OFF" />
            <Sw on={extras === 'client'} set={(x) => setExtras(x ? 'client' : 'gr')} label="Client pays extras" sub="off = extras on G&R (off the invoice unless one replaces a no-show)" />
            <Sw on={transport === 'client'} set={(x) => setTransport(x ? 'client' : 'gr')} disabled={!has038} label="Client pays transport" sub="far events · paid travel + gas on the invoice" />
          </Sec>
        </div>
        <div className="stack" style={{ gap: 12 }}>
          <Sec title="RATE SETS" sub="2+ sets → billing choice on the event form">
            {rates.length === 0 && <small className="muted">Standard rates. Add sets when a client has more than one (e.g. La Nesra No tips / Tips).</small>}
            {rates.length > 0 && <div className="vc-rates" style={{ gridTemplateColumns: `minmax(120px, 1.6fr) repeat(${roleCols.length}, minmax(56px, 1fr)) 28px` }}>
              <span className="vc-rh">SET</span>{roleCols.map((k) => <span key={k} className="vc-rh">{k} $/h</span>)}<span />
              {rates.map((r, i) => <RateRow key={r.key + i} r={r} cols={roleCols} onChange={(p) => setRate(i, p)} onRemove={() => setRates(rates.filter((_, k) => k !== i))} />)}
            </div>}
            <div><button type="button" className="abtn sm" onClick={() => { const n = rates.length ? `Set ${rates.length + 1}` : 'Standard'; setRates([...rates, { key: slug(n) + (rates.some((x) => x.key === slug(n)) ? '_' + rates.length : ''), label: n, rates: Object.fromEntries(roleCols.map((k) => [k, rates[0]?.rates?.[k] ?? 0])) }]); }}>+ add rate set</button></div>
            {rates.length > 0 && <small className="muted">The first set is the default.</small>}
          </Sec>
          {isHome && <>
            <Sec title="ADDRESS" sub="private home · fills the event address">
              <AddressInput value={address} onChange={setAddress} placeholder="Start typing the address…" />
              {!address.trim() && <small className="accent strong">address missing</small>}
            </Sec>
            <Sec title="USUAL UNIFORMS" sub="pre-filled on New event"><Uniforms u={u} set={setU} /></Sec>
          </>}
          {!isHome && <small className="muted" style={{ padding: '0 4px' }}>Private homes use this same card, plus the address and uniforms (they live on the client).</small>}
          {isHome && <small className="muted" style={{ padding: '0 4px' }}>{uniSummary(u)}</small>}
        </div>
      </div>
    </div>
  );
}
/** The key never changes once made: saved events point at it (event_private.rate_set). */
function RateRow({ r, cols, onChange, onRemove }: { r: RateSet; cols: string[]; onChange: (p: Partial<RateSet>) => void; onRemove: () => void }) {
  return <>
    <input aria-label="Rate set name" value={r.label} onChange={(e) => onChange({ label: e.target.value })} />
    {cols.map((k) => <input key={k} aria-label={`${r.label} ${k} rate`} inputMode="decimal" value={String(r.rates?.[k] ?? '')} onChange={(e) => onChange({ rates: { ...r.rates, [k]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } })} />)}
    <button type="button" className="sg-x" aria-label={`Remove ${r.label}`} onClick={onRemove}>×</button>
  </>;
}
