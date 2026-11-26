import { AREAS, AREA_HINT, areaFromPostal } from './rules';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PinEditor, type Pin } from '../components/VenuePin';
import { LinksEditor, asLinks, type HLink } from '../components/Links';
import { supabase } from '../lib/supabase';
import { setting, useSettings } from '../lib/settings';
import { dLabel, isoDay, type Venue, type Client } from './api';
import { AddressInput, type AddressParts } from '../components/AddressInput';
import { PhotoViewer } from '../components/Avatar';
import { itemsOf } from './EventForm';
import { UniPick } from '../components/UniPick';
import type { UniItemsMap } from '../components/Uniform';

/*
 * Push 32a · Admin → More → Venues & clients. Everything New event pre-fills comes from here.
 * Edits apply to new events only: New event copies these values into the event when it is saved.
 */
type Tab = 'venues' | 'clients' | 'homes';
type RateSet = Client['rate_sets'][number];
type V = Venue & { staff_notes?: string | null; venue_notes?: string | null; photos?: string[] | null; always_offer_rides?: boolean; far?: boolean; no_outside_food?: boolean; archived_at?: string | null };
type C = Client & { qb_customer?: string | null; extras_billing?: 'gr' | 'client'; transport_billing?: 'client' | 'gr'; admin_fee_pct?: number | null; archived_at?: string | null };
type Count = { n: number; last: string | null; next: string | null; bar: boolean; floor: boolean };

const V_COLS = 'id,name,address,usual_caterer_id,street,unit,city,province,postal_code,area,usual_client_id,staff_notes,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items,always_offer_rides,far,no_outside_food,pin_lat,pin_lng,pin_label,archived_at,links';
const C_COLS = 'id,name,qb_customer,rate_sets,kind,address,area,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items,drive_folder_default,extras_billing,archived_at,is_caterer,caterer_label,uniform_special';
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
const UNI_DEF = { floor_m: 'black_shirt', floor_w: 'black_shirt', bar_m: 'black_shirt', bar_w: 'dress' };

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

  const homesAll = (clients ?? []).filter((c) => c.kind === 'private_home'); const plainAll = (clients ?? []).filter((c) => c.kind !== 'private_home');
  const vis = (c: C) => showArch || !c.archived_at || c.id === sel;
  const homes = homesAll.filter(vis); const plain = plainAll.filter(vis);
  const list = useMemo(() => {
    const w = low(q);
    if (tab === 'venues') return (venues ?? []).filter((x) => (showArch || !x.archived_at || x.id === sel) && (!w || low(x.name + ' ' + (x.address ?? '')).includes(w))).sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at));
    return (tab === 'homes' ? homes : plain).filter((x) => !w || low(x.name + ' ' + (x.address ?? '') + ' ' + (x.qb_customer ?? '')).includes(w));
  }, [tab, q, venues, clients, showArch, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const clientName = (id: string | null | undefined) => (clients ?? []).find((c) => c.id === id)?.name ?? null;

  const cur = sel === 'new' ? null : tab === 'venues' ? (venues ?? []).find((x) => x.id === sel) ?? null : (clients ?? []).find((x) => x.id === sel) ?? null;
  const openClient = (id: string) => { setTabK((clients ?? []).find((c) => c.id === id)?.kind === 'private_home' ? 'homes' : 'clients'); setSel(id); };

  const arch = (tab === 'venues' ? venues ?? [] : tab === 'homes' ? homesAll : plainAll).filter((x: { archived_at?: string | null }) => x.archived_at).length;
  return (
    <div className="vc vc2">
      <h1 className="serif-h vc2-h">Venues &amp; clients</h1>
      <div className={'vc2-grid' + (sel ? ' has-sel' : '')}>
        <div className="vc2-list">
          <div className="vc2-tabs">
            {([['venues', 'Venues'], ['clients', 'Clients'], ['homes', 'Private homes']] as [Tab, string][]).map(([k, l]) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTabK(k)}>{l}</button>
            ))}
          </div>
          <div className="vc2-sr"><input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /><button className="abtn dark" onClick={() => setSel('new')}>+ New</button></div>
          {venues === null && <div className="muted sm">Loading…</div>}
          {tab === 'venues' ? (list as V[]).map((x) => (
            <button key={x.id} className={'vc2-row' + (sel === x.id ? ' on' : '') + (x.archived_at ? ' arch' : '')} onClick={() => setSel(x.id)}>
              <span><b>{x.name}</b><i>{counts.v[x.id]?.n ?? 0}</i></span>
              <small>{[x.address ? shortAddr(x.address) : 'Address missing', clientName(x.usual_client_id)].filter(Boolean).join(' · ')}</small>
            </button>
          )) : (list as C[]).map((x) => (
            <button key={x.id} className={'vc2-row' + (sel === x.id ? ' on' : '') + (x.archived_at ? ' arch' : '')} onClick={() => setSel(x.id)}>
              <span><b>{x.name}</b><i>{counts.c[x.id]?.n ?? 0}</i></span>
              <small>{tab === 'homes' ? (x.address ? shortAddr(x.address) : 'Address missing')
                : [x.is_caterer ? 'Caterer' : '', x.uniform_special ? 'Own uniform' : '', x.kind === 'roaming' ? 'Changes each time' : '', qbCheck(x.name, x.qb_customer).state === 'linked' ? 'QB ✓' : '', (x.admin_fee_pct ?? 10) !== 10 ? `fee ${x.admin_fee_pct}%` : ''].filter(Boolean).join(' · ') || 'Client'}</small>
            </button>
          ))}
          {list.length === 0 && venues !== null && <div className="muted sm vc2-none">Nothing matches.</div>}
          {arch > 0 && <button className="vc2-arch" onClick={() => setShowArch(!showArch)}>{showArch ? 'Hide archived' : `Archived · ${arch}`}</button>}
        </div>

        <div className="vc2-card">
          {sel && <button className="abtn sm back-btn vc2-back" onClick={() => setSel(null)}>‹ All</button>}
          {!sel && <div className="ne-card vc2-empty">Pick one on the left, or + New.</div>}
          {sel && tab === 'venues' && venues && clients && <VenueCard key={sel} v={cur as V | null} clients={clients} count={cur ? counts.v[cur.id] : undefined} has038={has038} all={venues}
            onSaved={async (id) => { await load(); setSel(id); }} onGone={async () => { await load(); setSel(null); }} onClient={openClient} />}
          {sel && tab !== 'venues' && clients && venues && <ClientCard key={sel + tab} c={cur as C | null} home={tab === 'homes'} venues={venues} all={(clients ?? []).filter((x) => (x.kind === 'private_home') === (tab === 'homes'))} onGone={async () => { await load(); setSel(null); }} count={cur ? counts.c[cur.id] : undefined} has038={has038}
            onSaved={async (id) => { await load(); const k = (await supabase.from('clients').select('kind').eq('id', id).maybeSingle()).data?.kind; if ((k === 'private_home') !== (tab === 'homes')) setTabK(k === 'private_home' ? 'homes' : 'clients'); setSel(id); }} />}
        </div>
      </div>
    </div>
  );
}

// ───────── shared bits ─────────
function Sec({ n, title, right, children }: { n?: number; title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return <section className="ne-card"><h2>{n != null && <i>{n}</i>}{title}<span className="grow" />{right}</h2>{children}</section>;
}
function Sw({ on, set, label, disabled }: { on: boolean; set: (v: boolean) => void; label: string; sub?: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} disabled={disabled} className={'ne-sw' + (on ? ' on' : '')} onClick={() => set(!on)}><i /><span>{label}</span></button>;
}
function Head({ name, count, busy, saved, onSave, isNew }: { name: string; count?: Count; busy: boolean; saved: string | null; onSave: () => void; isNew: boolean }) {
  return (
    <div className="vc2-head">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="serif vc2-name">{name || 'New'}</div>
        <span className="muted">{isNew ? '' : !count?.n ? 'No events yet' : [`${count.n} event${count.n === 1 ? '' : 's'}`, count.last ? `last ${dLabel(count.last, { month: 'short', day: 'numeric' })}` : '', count.next ? `next ${dLabel(count.next, { month: 'short', day: 'numeric' })}` : ''].filter(Boolean).join(' · ')}</span>
      </div>
      {saved && <span className="okc sm strong">Saved {saved}</span>}
      <button className="abtn ne-go vc2-save" disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Save'}</button>
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
/** Nov 6 fix: a chip tap sets the uniform AND its pieces in one go → functional updates, so the second doesn't undo the first. */
function Uniforms({ u, set }: { u: Uni; set: React.Dispatch<React.SetStateAction<Uni>> }) {
  const f = (k: 'floor_m' | 'floor_w' | 'bar_m' | 'bar_w') => (v: string) => set((x) => ({ ...x, [k]: v }));
  return <>
    <div className="ne-g2"><UniPick label="UNIFORM · MEN · FLOOR" value={u.floor_m} onChange={f('floor_m')} /><UniPick women label="UNIFORM · WOMEN · FLOOR" value={u.floor_w} onChange={f('floor_w')} /></div>
    <div className="ne-g2"><UniPick label="UNIFORM · MEN · BAR" value={u.bar_m} onChange={f('bar_m')} /><UniPick women label="UNIFORM · WOMEN · BAR" value={u.bar_w} onChange={f('bar_w')} /></div>
  </>;
}

// ───────── venue card ─────────
function VenueCard({ v, clients, count, has038, all, onSaved, onGone, onClient }: { v: V | null; clients: C[]; count?: Count; has038: boolean; all: V[]; onSaved: (id: string) => void; onGone: () => void; onClient: (id: string) => void }) {
  const [name, setName] = useState(v?.name ?? ''); const [clientId, setClientId] = useState(v?.usual_client_id ?? ''); const [catId, setCatId] = useState(v?.usual_caterer_id ?? ''); // push 95
  const [address, setAddress] = useState(v?.address ?? ''); const [parts, setParts] = useState<AddressParts | null>(null);
  const [parking, setParking] = useState(v?.staff_notes ?? ''); const [notes, setNotes] = useState(v?.venue_notes ?? '');
  const [pin, setPin] = useState<Pin | null>(() => { const x = v as unknown as { pin_lat?: number | null; pin_lng?: number | null; pin_label?: string | null } | null; return x?.pin_lat != null && x?.pin_lng != null ? { lat: x.pin_lat, lng: x.pin_lng, label: x.pin_label ?? '' } : null; });
  const [links, setLinks] = useState<HLink[]>(() => asLinks((v as unknown as { links?: unknown } | null)?.links));
  const [rides, setRides] = useState(!!v?.always_offer_rides); const [farV, setFarV] = useState(!!v?.far); const [noFood, setNoFood] = useState(!!v?.no_outside_food); const [u, setU] = useState<Uni>(() => uniOf(v));
  const vx = v as unknown as { area?: string | null; postal_code?: string | null } | null; const [area, setArea] = useState(vx?.area ?? areaFromPostal(vx?.postal_code) ?? ''); // push 63
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [saved, setSaved] = useState<string | null>(null);
  const client = clients.find((c) => c.id === clientId) ?? null;
  const far = setting('transport.far_min');

  const save = async () => {
    if (!name.trim()) return setErr('Give the venue a name (what staff see).');
    setBusy(true); setErr('');
    const row: Record<string, unknown> = {
      name: name.trim(), usual_client_id: clientId || null, usual_caterer_id: catId || null, address: address.trim() || null, staff_notes: parking.trim() || null, always_offer_rides: rides, far: farV, no_outside_food: noFood, ...uniRow(u), area: area || (parts ? areaFromPostal(parts.postal_code) : null) || null,
      ...(parts ? { street: parts.street, unit: parts.unit || null, city: parts.city, province: parts.province, postal_code: parts.postal_code } : {}),
      ...(has038 ? { venue_notes: notes.trim() || null } : {}),
      pin_lat: pin?.lat ?? null, pin_lng: pin?.lng ?? null, pin_label: pin?.label?.trim() || null, links,
    };
    const r = v ? await supabase.from('venues').update(row).eq('id', v.id).select('id').single() : await supabase.from('venues').insert(row).select('id').single();
    setBusy(false);
    if (r.error) return setErr(/duplicate|unique/i.test(r.error.message) ? `There is already a venue called “${name.trim()}”.` : r.error.message);
    setSaved(nowLabel()); onSaved(r.data.id as string);
  };

  return (
    <div className="vc2-body">
      <Head name={name} count={count} busy={busy} saved={saved} onSave={save} isNew={!v} />
      {err && <p className="error">{err}</p>}
      <Sec n={1} title="The venue">
        <div className="ne-g2">
          <label className="ne-f"><span>NAME</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="ne-f"><span>ADDRESS</span><AddressInput value={address} onChange={(x) => { setAddress(x); setParts(null); }} onPick={setParts} placeholder="Start typing the address" /></div>
        </div>
        <div className="ne-g2">
          <label className="ne-f"><span>USUAL CLIENT</span>
            <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="" />
              {clients.filter((c) => c.kind !== 'private_home' && (!c.archived_at || c.id === clientId)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          <label className="ne-f"><span>USUAL FOOD BY</span>
            <select value={catId} onChange={(e) => setCatId(e.target.value)}>
              <option value="" />
              {clients.filter((c) => c.is_caterer && (!c.archived_at || c.id === catId)).map((c) => <option key={c.id} value={c.id}>{c.caterer_label || c.name}</option>)}
            </select></label>
        </div>
      </Sec>
      <Sec n={2} title="For the staff">
        <div className="ne-g2">
          <label className="ne-f"><span>PARKING &amp; ENTRANCE</span><textarea rows={3} value={parking} onChange={(e) => setParking(e.target.value)} /></label>
          <label className="ne-f"><span>VENUE NOTES</span><textarea rows={3} value={notes} disabled={!has038} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        <div className="ne-f"><span>PHOTOS</span><VenuePhotos venue={v} disabled={!has038} /></div>
        <div className="ne-f"><span>LINKS</span><LinksEditor links={links} set={setLinks} /></div>
        <div className="ne-f"><span>STAFF ENTRANCE PIN</span><PinEditor pin={pin} set={setPin} /></div>
      </Sec>
      <Sec n={3} title="Defaults for new events">
        <Uniforms u={u} set={setU} />
        <div className="vc2-sws"><Sw on={farV} set={setFarV} label="Far venue" /><Sw on={rides} set={setRides} label="Always offer rides" /><Sw on={noFood} set={setNoFood} label="No outside food" /></div>
      </Sec>
      {v && <details className="ne-card ne-more"><summary><h2>More</h2></summary><Remove kind="venue" it={v} all={all} onSaved={onSaved} onGone={onGone} /></details>}
    </div>
  );
}

/** 074 · archive / delete a venue or a client · move its events to the right one (duplicates). */
type VEv = { id: string; title: string; event_date: string; department: string };
type RmItem = { id: string; name: string; address?: string | null; archived_at?: string | null };
function Remove({ kind, it, all, onSaved, onGone }: { kind: 'venue' | 'client' | 'home'; it: RmItem; all: RmItem[]; onSaved: (id: string) => void; onGone: () => void }) {
  const [open, setOpen] = useState(false); const [evs, setEvs] = useState<VEv[] | null>(null); const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [sure, setSure] = useState(false);
  const today = isoDay(new Date()); const word = kind === 'venue' ? 'venue' : kind === 'home' ? 'private home' : 'client';
  const table = kind === 'venue' ? 'venues' : 'clients';
  const show = async () => {
    setOpen(true); setErr(''); setSure(false); setEvs(null);
    if (kind === 'venue') {
      const { data, error } = await supabase.from('events').select('id,title,event_date,department').eq('venue_id', it.id).order('event_date', { ascending: false });
      if (error) setErr(error.message); setEvs((data ?? []) as VEv[]);
    } else {
      const { data, error } = await supabase.from('event_private').select('events(id,title,event_date,department)').eq('client_id', it.id);
      if (error) setErr(error.message);
      const x = ((data ?? []) as unknown as { events: VEv | VEv[] | null }[]).map((r) => (Array.isArray(r.events) ? r.events[0] : r.events)).filter((e): e is VEv => !!e);
      setEvs(x.sort((a, b) => b.event_date.localeCompare(a.event_date)));
    }
  };
  const archive = async (on: boolean) => {
    setBusy(true); setErr('');
    const { error } = await supabase.from(table).update({ archived_at: on ? new Date().toISOString() : null }).eq('id', it.id);
    setBusy(false); if (error) return setErr(error.message); setOpen(false); onSaved(it.id);
  };
  const remove = async () => {
    setBusy(true); setErr('');
    const { error } = kind === 'venue' ? await supabase.rpc('admin_venue_remove', { p_venue: it.id, p_move_to: to || null }) : await supabase.rpc('admin_client_remove', { p_client: it.id, p_move_to: to || null });
    setBusy(false); if (error) return setErr(error.message); onGone();
  };
  const n = evs?.length ?? 0; const up = (evs ?? []).filter((e) => e.event_date >= today).length;
  const others = all.filter((x) => x.id !== it.id && !x.archived_at);
  return (
    <section className="adm-card vc-sec vc-rm">
      <div className="vc-sec-h"><span>{it.archived_at ? 'ARCHIVED' : `REMOVE THIS ${word.toUpperCase()}`}</span><small>{it.archived_at ? 'hidden from the list and the pickers' : 'duplicates, old names'}</small></div>
      {!open && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {it.archived_at ? <button className="abtn sm dark" disabled={busy} onClick={() => archive(false)}>Bring it back</button>
          : <button className="abtn sm" disabled={busy} onClick={() => archive(true)}>Archive</button>}
        <button className="abtn sm vc-del" onClick={show}>Move its events · Delete</button></div>}
      {open && evs === null && !err && <small className="muted">Looking for its events…</small>}
      {open && evs && <div className="stack" style={{ gap: 10 }}>
        {n > 0 ? <>
          <b className="vc-warn">{n} event{n === 1 ? '' : 's'} use “{it.name}”{up ? ` · ${up} upcoming` : ''}</b>
          <div className="vc-evs">{evs.map((e) => (
            <Link key={e.id} className="vc-ev" to={`/admin/bookings?date=${e.event_date}&view=board&ev=${e.id}`}>
              <span className="vc-ev-d">{dLabel(e.event_date)}</span><span className="grow">{e.title}{e.department === 'bar' ? ' · bar' : ''}</span>
              <small className={e.event_date >= today ? 'accent' : 'muted'}>{e.event_date >= today ? 'UPCOMING' : 'PAST'}</small><b>Open ›</b></Link>))}</div>
          <label className="ef-f"><span>MOVE THESE EVENTS TO</span>
            <select value={to} onChange={(e) => { setTo(e.target.value); setSure(false); }}><option value="">Pick the right {word}…</option>{others.map((x) => <option key={x.id} value={x.id}>{x.name}{x.address ? ` · ${shortAddr(x.address)}` : ''}</option>)}</select>
            <small className="muted">{kind === 'venue' ? 'Events switch to that venue (address, 📍 spot, photos). Staff only get a “shift changed” note if the address is different. Anything the right venue is missing (spot, photos, notes) is copied over.'
              : 'Events (billing, invoices) switch to that client. Venues with this as usual client switch too. Rate sets the right client doesn’t have are copied over, so events keep their rates.'}</small></label>
          {!sure ? <button className="abtn dark" disabled={!to || busy} onClick={() => setSure(true)}>Move {n} event{n === 1 ? '' : 's'} + delete this one</button>
            : <button className="abtn vc-delb" disabled={busy} onClick={remove}>{busy ? 'Moving…' : `Yes, move ${n} and delete “${it.name}”`}</button>}
          <div className="row" style={{ gap: 8 }}>{!it.archived_at && <button className="abtn sm" disabled={busy} onClick={() => archive(true)}>Archive instead</button>}<button className="abtn sm" onClick={() => setOpen(false)}>Cancel</button></div>
        </> : <>
          <b>Delete “{it.name}”?</b><small className="muted">No events use it. This can’t be undone.</small>
          <div className="row" style={{ gap: 8 }}>{!sure ? <button className="abtn vc-delb" onClick={() => setSure(true)}>Delete</button> : <button className="abtn vc-delb" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Yes, delete it'}</button>}<button className="abtn sm" onClick={() => setOpen(false)}>Cancel</button></div>
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
function ClientCard({ c, home, venues, all, count, has038, onSaved, onGone }: { c: C | null; home: boolean; venues: V[]; all: C[]; count?: Count; has038: boolean; onSaved: (id: string) => void; onGone: () => void }) {
  const [name, setName] = useState(c?.name ?? ''); const [kind, setKind] = useState<'' | 'private_home' | 'roaming'>(c?.kind ?? (home ? 'private_home' : ''));
  const [qb, setQb] = useState(c?.qb_customer ?? ''); const [fee, setFee] = useState(String(c?.admin_fee_pct ?? (/brera/i.test(c?.name ?? '') ? 8 : 10)));
  const [drive, setDrive] = useState(c ? c.drive_folder_default !== false : true);
  const [extras, setExtras] = useState<'gr' | 'client'>(c?.extras_billing ?? setting('extras.default_billing'));
  const [transport, setTransport] = useState<'client' | 'gr'>(c?.transport_billing ?? (setting('transport.client_pays') ? 'client' : 'gr'));
  const [rates, setRates] = useState<RateSet[]>(Array.isArray(c?.rate_sets) ? c!.rate_sets : []);
  const [address, setAddress] = useState(c?.address ?? ''); const [u, setU] = useState<Uni>(() => uniOf(c));
  const [area, setArea] = useState((c as unknown as { area?: string | null } | null)?.area ?? ''); // push 63
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [saved, setSaved] = useState<string | null>(null);
  const [cat, setCat] = useState(!!c?.is_caterer); const [catLabel, setCatLabel] = useState(c?.caterer_label ?? ''); const [special, setSpecial] = useState(!!c?.uniform_special); // push 95
  const isHome = kind === 'private_home'; const ownUni = isHome || cat || special;
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
      ...(isHome ? { address: address.trim() || null, area: area || null } : {}), ...(ownUni ? uniRow(u) : {}),
      is_caterer: cat, caterer_label: cat ? catLabel.trim() || null : null, uniform_special: special, // push 95
    };
    const r = c ? await supabase.from('clients').update(row).eq('id', c.id).select('id').single() : await supabase.from('clients').insert(row).select('id').single();
    setBusy(false);
    if (r.error) return setErr(/duplicate|unique/i.test(r.error.message) ? `There is already a client called “${name.trim()}”.` : r.error.message);
    setSaved(nowLabel()); onSaved(r.data.id as string);
  };
  const setRate = (i: number, p: Partial<RateSet>) => setRates(rates.map((r, k) => (k === i ? { ...r, ...p } : r)));

  return (
    <div className="vc2-body">
      <Head name={name} count={count} busy={busy} saved={saved} onSave={save} isNew={!c} />
      {err && <p className="error">{err}</p>}
      <Sec n={1} title={isHome ? 'The private home' : 'The client'}>
        <div className="ne-g2">
          <label className="ne-f"><span>NAME</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <div className="ne-f"><span>KIND</span><span className="ne-seg">{([['', 'Client'], ['private_home', 'Private home'], ['roaming', 'Changes each time']] as const).map(([k, l]) => <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</span></div>
        </div>
        {isHome && <div className="ne-f"><span>ADDRESS</span><AddressInput value={address} onChange={setAddress} placeholder="Start typing the address" /></div>}
        {!isHome && <div className="vc2-sws vc2-cat">
          <Sw on={cat} set={setCat} label="Caterer" />
          {cat && <label className="ne-f"><span>NAME STAFF SEE</span><input value={catLabel} onChange={(e) => setCatLabel(e.target.value)} placeholder={name} /></label>}
          <Sw on={special} set={setSpecial} label="Own uniform rule" />
        </div>}
      </Sec>
      <Sec n={2} title="Billing">
        <div className="ne-g2">
          <label className="ne-f"><span>QUICKBOOKS CUSTOMER{check.state === 'linked' ? ' ✓' : ''}</span><input value={qb} onChange={(e) => setQb(e.target.value)} placeholder={check.expected ?? ''} />
            {(check.state === 'differs' || (check.state === 'empty' && check.expected)) && <button type="button" className="lnk sm vc2-use" onClick={() => setQb(check.expected!)}>Use “{check.expected}”</button>}</label>
          <label className="ne-f"><span>ADMIN FEE %</span><input inputMode="decimal" value={fee} disabled={!has038} onChange={(e) => setFee(e.target.value.replace(/[^\d.]/g, ''))} /></label>
        </div>
        <div className="vc2-sws"><Sw on={drive} set={setDrive} label="Drive folder" /><Sw on={extras === 'client'} set={(x) => setExtras(x ? 'client' : 'gr')} label="Client pays extras" /><Sw on={transport === 'client'} set={(x) => setTransport(x ? 'client' : 'gr')} disabled={!has038} label="Client pays transport" /></div>
      </Sec>
      <Sec n={3} title="Rates">
        {rates.length > 0 && <div className="vc2-rates" style={{ gridTemplateColumns: `minmax(120px, 1.6fr) repeat(${roleCols.length}, minmax(56px, 1fr)) 26px` }}>
          <span className="vc2-rh">SET</span>{roleCols.map((k) => <span key={k} className="vc2-rh">{k} $/H</span>)}<span />
          {rates.map((r, i) => <RateRow key={r.key + i} r={r} cols={roleCols} onChange={(p) => setRate(i, p)} onRemove={() => setRates(rates.filter((_, k) => k !== i))} />)}
        </div>}
        <button type="button" className="ne-plus" aria-label="Add a rate set" onClick={() => { const n = rates.length ? `Set ${rates.length + 1}` : 'Standard'; setRates([...rates, { key: slug(n) + (rates.some((x) => x.key === slug(n)) ? '_' + rates.length : ''), label: n, rates: Object.fromEntries(roleCols.map((k) => [k, rates[0]?.rates?.[k] ?? 0])) }]); }}>+</button>
      </Sec>
      {ownUni && <Sec n={4} title="Uniforms"><Uniforms u={u} set={setU} /></Sec>}
      {c && <details className="ne-card ne-more"><summary><h2>More</h2></summary><Remove kind={home ? 'home' : 'client'} it={c} all={all} onSaved={onSaved} onGone={onGone} /></details>}
    </div>
  );
}
/** The key never changes once made: saved events point at it (event_private.rate_set). */
function RateRow({ r, cols, onChange, onRemove }: { r: RateSet; cols: string[]; onChange: (p: Partial<RateSet>) => void; onRemove: () => void }) {
  return <>
    <input aria-label="Rate set name" value={r.label} onChange={(e) => onChange({ label: e.target.value })} />
    {cols.map((k) => <input key={k} aria-label={`${r.label} ${k} rate`} inputMode="decimal" value={String(r.rates?.[k] ?? '')} onChange={(e) => onChange({ rates: { ...r.rates, [k]: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } })} />)}
    <button type="button" className="ne-x" aria-label={`Remove ${r.label}`} onClick={onRemove}>×</button>
  </>;
}
