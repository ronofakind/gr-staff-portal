import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, type ShiftRow } from '../lib/supabase';
import { DriveFiles } from '../components/DriveFiles';
import { DeleteEvent } from './DeleteEvent';
import { ShiftView } from '../pages/Shift';
import { UniformIcon, PantsIcon, ShoesIcon, ApronIcon, TieIcon, WineKeyIcon, PIECE, defaultItems, uniformLabel, type UniItemsMap, type UniLineKey, type UniformKind } from '../components/Uniform';
import { EVENT_SELECT, ap12, dLabel, roleName, type AEvent } from './api';

const FOLD_KEY = 'gr-ed-fold';
const readFold = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || '{}'); } catch { return {}; } };
type Extra = { uniform_items: UniItemsMap | null; venue: { name: string; address: string | null; staff_notes: string | null } | null; client_id: string | null; rate_set: string | null;
  client: { name: string; rate_sets: { key: string; label: string }[] } | null; md: { full_name: string; photo_url: string | null; phone: string | null } | null };

/** Event detail (push 20): read-only summary. Team building lives in the Day view. */
export function EventDetail() {
  const { id } = useParams();
  const [evs, setEvs] = useState<AEvent[] | null>(null);
  const [x, setX] = useState<Extra | null>(null);
  const [tick, setTick] = useState(0);
  const [fold, setFoldState] = useState<Record<string, boolean>>(readFold);
  const setFold = (k: string, open: boolean) => { const v = { ...fold, [k]: open }; setFoldState(v); try { localStorage.setItem(FOLD_KEY, JSON.stringify(v)); } catch { /* private mode */ } };
  const isOpen = (k: string) => fold[k] !== false;

  useEffect(() => {
    (async () => {
      const { data: one } = await supabase.from('events').select('event_date,title,venue_id,uniform_items,venues(name,address,staff_notes),event_private(client_id,rate_set)').eq('id', id!).single();
      if (!one) { setEvs([]); return; }
      const { data } = await supabase.from('events').select(EVENT_SELECT).eq('event_date', one.event_date).eq('title', one.title).order('department');
      const mine = ((data ?? []) as unknown as AEvent[]).sort((a) => (a.department === 'floor' ? -1 : 1));
      setEvs(mine);
      const o = one as unknown as { uniform_items: UniItemsMap | null; venues: Extra['venue']; event_private: { client_id: string | null; rate_set: string | null } | null };
      const cid = o.event_private?.client_id ?? null;
      const [c, m] = await Promise.all([
        cid ? supabase.from('clients').select('name,rate_sets').eq('id', cid).single() : Promise.resolve({ data: null }),
        supabase.rpc('event_md', { p_event: mine.find((e) => e.department === 'floor')?.id ?? id }),
      ]);
      setX({ uniform_items: o.uniform_items, venue: o.venues, client_id: cid, rate_set: o.event_private?.rate_set ?? null, client: (c.data as Extra['client']) ?? null, md: (Array.isArray(m.data) ? (m.data as Extra['md'][])[0] : null)?.full_name ? (m.data as Extra['md'][])[0] : null });
    })();
  }, [id, tick]);
  const load = () => setTick((t) => t + 1);

  if (!evs) return <div className="muted">Loading…</div>;
  if (!evs.length) return <div className="adm-card">This event doesn't exist anymore. <Link to="/admin/week">Back to the week</Link></div>;
  const e = evs.find((v) => v.id === id) ?? evs[0];
  const floor = evs.find((v) => v.department === 'floor'); const bar = evs.find((v) => v.department === 'bar');
  const lines = evs.flatMap((v) => (v.staffing ?? []).map((l) => ({ ...l, dept: v.department, ev: v }))).sort((a, b) => (a.dept === b.dept ? a.start.localeCompare(b.start) : a.dept === 'floor' ? -1 : 1));
  const nFloor = lines.filter((l) => l.dept !== 'bar').reduce((n, l) => n + l.count, 0) || (floor?.staff_needed ?? 0);
  const nBar = lines.filter((l) => l.dept === 'bar').reduce((n, l) => n + l.count, 0) || (bar?.staff_needed ?? 0);
  const leadName = (v: AEvent | undefined, code: string) => v?.shifts.find((s) => s.position_code === code && s.status !== 'declined' && !s.attendance)?.staff?.full_name;
  const firstOf = (v?: AEvent) => (v?.staffing ?? []).map((l) => l.start).sort()[0] ?? v?.start_time?.slice(0, 5);
  const p = evs.find((v) => v.event_private)?.event_private;
  const folder = evs.find((v) => v.drive_folder_url)?.drive_folder_url;
  const docLabel = p?.qb_doc_number ? `${p.qb_doc_type === 'invoice' ? 'Invoice' : 'Estimate'} #${p.qb_doc_number}` : null;
  const ends = e.ends_label ?? (e.end_time ? '~ ' + ap12(e.end_time.slice(0, 5)) : 'TBC');
  const uniRows = uniformRows(evs, x?.uniform_items ?? null);
  const fee = /brera/i.test(x?.client?.name ?? p?.client ?? '') ? 8 : 10;
  const rateLabel = x?.client && x.client.rate_sets.length >= 2 ? x.client.rate_sets.find((r) => r.key === (x.rate_set ?? x.client!.rate_sets[0].key))?.label : null;
  const keys = ['event', 'staffing', 'uniforms', 'folder', 'billing', 'lands'];

  return (
    <div className="stack-lg ed2">
      <div className="toolbar">
        <div>
          <Link to={`/admin/day?d=${e.event_date}`} className="muted sm strong">‹ Bookings · {dLabel(e.event_date, { weekday: 'long', month: 'short', day: 'numeric' })}</Link>
          <h1 className="serif-h">{x?.venue?.name ?? e.title}</h1>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <span className="tag">{dLabel(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
            {e.event_type && <span className="tag">{e.event_type}</span>}
            {e.guests ? <span className="tag">{e.guests} guests</span> : null}
            {floor && <span className="tag">Floor {nFloor}</span>}
            {bar && <span className="tag bar-tag">Bar {nBar}</span>}
          </div>
        </div>
        <div className="stack no-print" style={{ gap: 8, alignItems: 'flex-end' }}>
          <div className="row wrap" style={{ gap: 8, justifyContent: 'flex-end' }}>
            <Link className="abtn dark" to={`/admin/event/${e.id}/edit`}>Edit details</Link>
            <Link className="abtn" to={`/admin/event/${e.id}/edit?dup=1`}>Duplicate…</Link>
            <button className="abtn" onClick={() => window.print()}>Print / PDF</button>
            <DeleteEvent id={e.id} />
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="abtn sm" onClick={() => { const v = Object.fromEntries(keys.map((k) => [k, true])); setFoldState(v); try { localStorage.setItem(FOLD_KEY, JSON.stringify(v)); } catch { /* */ } }}>Expand all</button>
            <button className="abtn sm" onClick={() => { const v = Object.fromEntries(keys.map((k) => [k, false])); setFoldState(v); try { localStorage.setItem(FOLD_KEY, JSON.stringify(v)); } catch { /* */ } }}>Collapse all</button>
          </div>
        </div>
      </div>

      <div className="ed2-grid">
        <Sec k="event" title="Event" open={isOpen('event')} setOpen={setFold} summary={[dLabel(e.event_date, { month: 'short', day: 'numeric' }), x?.venue?.name ?? e.title, e.guests ? `${e.guests} guests` : null].filter(Boolean).join(' · ')}>
          <div className="ed2-facts">
            <F l="Date" v={dLabel(e.event_date, { weekday: 'long', month: 'long', day: 'numeric' })} />
            <F l="Venue" v={x?.venue?.name ?? e.title} />
            <F l={<>Client <i className="only">only you</i></>} v={p?.client ?? '—'} />
            <F l="Address" v={e.address ?? x?.venue?.address ?? '—'} />
            <F l="Event type" v={e.event_type ?? '—'} />
            <F l="Guests" v={e.guests ? String(e.guests) : '—'} />
            <F l="First start" v={floor && bar && firstOf(floor) !== firstOf(bar) ? `Floor ${ap12(firstOf(floor))} · Bar ${ap12(firstOf(bar))}` : ap12(firstOf(floor ?? bar)) || 'TBC'} />
            <F l="Ends" v={ends} />
          </div>
          {e.notes && <div className="ed2-note"><small>Note for staff</small>{e.notes}</div>}
        </Sec>

        <Sec k="staffing" title="Staffing" open={isOpen('staffing')} setOpen={setFold} summary={[floor ? `${nFloor} floor` : null, bar ? `${nBar} bar` : null, String(nFloor + nBar)].filter(Boolean).join(' · ')}>
          <div className="ed2-lines">
            {lines.map((l, i) => (
              <div key={i} className="ed2-line">
                <i className={'dot ' + (l.dept === 'bar' ? 'bar' : 'floor')} />
                <span className="grow"><b>{l.dept === 'bar' ? 'Bar' : 'Floor'} · {roleName(l.code)}</b>{['MD', 'BM'].includes(l.code) && leadName(l.ev, l.code) ? <span className="muted"> · {leadName(l.ev, l.code)}</span> : null}</span>
                <span>{ap12(l.start)}{l.end ? <span className="muted"> ~ {ap12(l.end)}</span> : null}</span>
                <b className="cnt">{l.count}</b>
              </div>
            ))}
            {!lines.length && <div className="muted sm">No staffing lines yet.</div>}
          </div>
          <div className="ed2-tot"><span>{floor ? `${nFloor} floor` : ''}{floor && bar ? ' · ' : ''}{bar ? `${nBar} bar` : ''}</span><b>{nFloor + nBar} total</b></div>
          <Link className="sm strong no-print" to={`/admin/day?d=${e.event_date}`}>Who's booked →</Link>
        </Sec>

        <Sec k="uniforms" title="Uniforms" open={isOpen('uniforms')} setOpen={setFold} summary={[floor ? 'Floor' : null, bar ? 'Bar' : null].filter(Boolean).join(' + ') + ' · men / women'}>
          <div className="ed2-uni">
            {uniRows.map((r) => (
              <div key={r.key} className="ed2-urow">
                <span className="kick">{r.label}</span>
                <div className="ed2-tiles">{r.tiles.map((t, i) => <div key={i} className={'ed2-tile' + (t.extra ? ' extra' : '')}><div className="ic">{t.icon}</div><small>{t.name}</small></div>)}</div>
              </div>
            ))}
          </div>
          <div className="muted sm">These are the exact icons each person gets on their phone for this event.</div>
        </Sec>

        <Sec k="folder" title="Event folder" open={isOpen('folder')} setOpen={setFold} summary={folder ? 'Drive folder linked' : 'No folder'}>
          {folder ? <a className="abtn" style={{ alignSelf: 'flex-start' }} href={folder} target="_blank" rel="noreferrer">Open the Drive folder ›</a> : <div className="muted sm">No folder yet. <Link to={`/admin/event/${e.id}/edit`}>Create or link one in Edit details</Link>.</div>}
          {folder && <DriveFiles eventId={e.id} />}
          {folder && <div className="muted sm">New files in the folder show up here and on the manager's screen.</div>}
        </Sec>

        {p && <Sec k="billing" title="Billing" open={isOpen('billing')} setOpen={setFold} summary={[p.pay_method === 'cash' ? 'Cash' : 'Invoice', docLabel].filter(Boolean).join(' · ')}>
          <div className="ed2-facts">
            <F l="Pays by" v={p.pay_method === 'cash' ? 'Cash · no GST / QST' : 'Invoice · QuickBooks'} />
            <F l="QuickBooks" v={docLabel ?? 'Automatic'} />
            {rateLabel && <F l="Rate set" v={rateLabel} />}
            <F l="Admin fee" v={`${fee}%`} />
          </div>
          <Billing evs={evs} onChange={load} />
        </Sec>}

        <Sec k="lands" title="How it lands in the app" wide open={isOpen('lands')} setOpen={setFold} summary="Staff event page">
          {x && <Lands evs={evs} lines={lines} items={x.uniform_items} venue={x.venue} md={x.md} />}
        </Sec>
      </div>
    </div>
  );
}

const F = ({ l, v }: { l: React.ReactNode; v: string }) => <div><small>{l}</small><b>{v}</b></div>;

function Sec({ k, title, summary, open, setOpen, wide, children }: { k: string; title: string; summary: string; open: boolean; setOpen: (k: string, o: boolean) => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={'ed2-sec' + (open ? ' open' : '') + (wide ? ' wide' : '') + (k === 'lands' ? ' lands' : '')}>
      <button type="button" className="ed2-h" onClick={() => setOpen(k, !open)} aria-expanded={open}>
        <span className="ed2-c">{open ? '▾' : '▸'}</span><b>{title}</b><span className="ed2-s">{summary}</span>
      </button>
      {open && <div className="ed2-b">{children}</div>}
    </section>
  );
}

type Tile = { icon: JSX.Element; name: string; extra?: boolean };
function tilesFor(kind: string, bar: boolean, women: boolean, items: { on: string[]; extra: string[] }): Tile[] {
  const dress = kind === 'dress';
  const piece: Record<string, Tile> = {
    [PIECE.tie]: { icon: <TieIcon size={40} />, name: 'Tie' }, [PIECE.pants]: { icon: <PantsIcon size={40} />, name: 'Pants' },
    [PIECE.shoes]: { icon: <ShoesIcon size={40} who={women || dress ? 'women' : 'men'} />, name: 'Shoes' },
    [PIECE.apron]: { icon: <ApronIcon size={40} />, name: 'Apron' }, [PIECE.key]: { icon: <WineKeyIcon size={40} />, name: 'Wine key' },
  };
  const order = [PIECE.tie, PIECE.pants, PIECE.shoes, PIECE.apron, PIECE.key] as string[];
  return [
    { icon: <UniformIcon kind={kind as UniformKind} size={40} />, name: uniformLabel(kind).replace(' + tie', '') },
    ...order.filter((x) => items.on.includes(x)).map((x) => piece[x]),
    ...[...items.on.filter((x) => !order.includes(x)), ...items.extra].map((x) => ({ icon: <span className="plus">+</span>, name: x, extra: true })),
  ];
}
function uniformRows(evs: AEvent[], map: UniItemsMap | null) {
  const f = evs.find((v) => v.department === 'floor'); const b = evs.find((v) => v.department === 'bar');
  const rows: { key: UniLineKey; label: string; tiles: Tile[] }[] = [];
  const add = (key: UniLineKey, label: string, kind: string, bar: boolean, women: boolean) => rows.push({ key, label, tiles: tilesFor(kind, bar, women, map?.[key] ?? defaultItems(kind, bar)) });
  if (f) { add('floor_m', 'FLOOR · MEN', f.uniform_floor ?? 'white_shirt', false, false); add('floor_w', 'FLOOR · WOMEN', f.uniform_floor_w ?? f.uniform_floor ?? 'white_shirt', false, true); }
  if (b) { add('bar_m', 'BAR · MEN', b.uniform_bar ?? 'black_shirt', true, false); add('bar_w', 'BAR · WOMEN', b.uniform_bar_w ?? 'dress', true, true); }
  return rows;
}

type L = { code: string; start: string; end?: string | null; count: number; dept: string; ev: AEvent };
/** The real staff event page, fed with this event and a pretend shift. Nothing is sent. */
function Lands({ evs, lines, items, venue, md }: { evs: AEvent[]; lines: L[]; items: UniItemsMap | null; venue: Extra['venue']; md: Extra['md'] }) {
  const roles = useMemo(() => { const seen = new Map<string, L>(); for (const l of lines) if (!['MD', 'BM'].includes(l.code) && !seen.has(l.code)) seen.set(l.code, l); return [...seen.values()]; }, [lines]);
  const [role, setRole] = useState(roles[0]?.code ?? 'W'); const [sex, setSex] = useState<'m' | 'f'>('m');
  const line = roles.find((l) => l.code === role) ?? lines[0];
  if (!line) return <div className="muted sm">Add a staffing line to see the preview.</div>;
  const ev = line.ev; const bar = line.dept === 'bar';
  const iso = new Date(`${ev.event_date}T${line.start}:00`).toISOString();
  const s: ShiftRow = {
    id: 'preview', status: 'confirmed', position_code: line.code, position_detail: line.code === 'W' ? null : roleName(line.code),
    planned_start: iso, planned_end: null, arrive_before_min: 15, uniform: null, me: { sex }, time_tbc: false,
    events: { id: ev.id, event_date: ev.event_date, title: venue?.name ?? ev.title, address: ev.address, department: ev.department, manager_id: ev.manager_id, description: ev.description,
      dress_code: ev.dress_code, bring: ev.bring, notes: ev.notes ?? null, timeline: ev.timeline ?? [], uniform_floor: evs.find((v) => v.department === 'floor')?.uniform_floor ?? null,
      uniform_bar: evs.find((v) => v.department === 'bar')?.uniform_bar ?? null, uniform_floor_w: evs.find((v) => v.department === 'floor')?.uniform_floor_w ?? null,
      uniform_bar_w: evs.find((v) => v.department === 'bar')?.uniform_bar_w ?? null, uniform_items: items, event_type: ev.event_type ?? null, guests: ev.guests ?? null,
      venues: venue, manager: null },
  };
  void bar;
  return (
    <div className="lands-one">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <span className="kick">Preview as</span>
          <div className="seg3">{roles.map((l) => <button key={l.code} className={role === l.code ? 'on' : ''} onClick={() => setRole(l.code)}>{roleName(l.code)}</button>)}</div>
          <div className="seg3"><button className={sex === 'm' ? 'on' : ''} onClick={() => setSex('m')}>Men</button><button className={sex === 'f' ? 'on' : ''} onClick={() => setSex('f')}>Women</button></div>
        </div>
        <div className="phone-frame"><div className="phone-screen"><ShiftView s={s} lead={md} preview /></div></div>
      </div>
    </div>
  );
}

/** How the client pays + QuickBooks link + cash received (admin only). */
function Billing({ evs, onChange }: { evs: AEvent[]; onChange: () => void }) {
  const p = evs.find((x) => x.event_private)?.event_private; if (!p) return null;
  const cash = p.pay_method === 'cash'; const doc = p.qb_doc_number ? `${p.qb_doc_type === 'invoice' ? 'Invoice' : 'Estimate'} #${p.qb_doc_number}` : null;
  const markCash = async () => { for (const x of evs) await supabase.from('event_private').update({ cash_received_at: new Date().toISOString() }).eq('event_id', x.id); onChange(); };
  const removed = async () => { for (const x of evs) await supabase.from('event_private').update({ qb_removed_at: new Date().toISOString() }).eq('event_id', x.id); onChange(); };
  void doc; if (!cash) return null;
  return (
    <div>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        {cash && !p.cash_received_at && <button className="abtn sm dark" onClick={markCash}>Mark cash received</button>}
        {cash && p.cash_received_at && <span className="tag">✓ Cash received {new Date(p.cash_received_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>}
        {cash && p.cash_received_at && p.qb_doc_type === 'estimate' && p.qb_doc_number && !p.qb_removed_at && <button className="abtn sm" onClick={removed}>I removed Estimate #{p.qb_doc_number} in QuickBooks</button>}
      </div>
    </div>
  );
}

