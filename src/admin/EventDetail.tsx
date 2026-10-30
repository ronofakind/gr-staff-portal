import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DriveFiles } from '../components/DriveFiles';
import { DeleteEvent } from './DeleteEvent';
import { EVENT_SELECT, allStaff, ap12, dLabel, addDays, roleName, roleOfShift, UNIFORMS, type AEvent, type AShift, type AStaff } from './api';

type Avail = { staff_id: string; status: string; tier: string | null };
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });

/** Landing page after saving an event: facts, team by start time, availability, confirmations, same-day events. */
export function EventDetail() {
  const { id } = useParams();
  const [evs, setEvs] = useState<AEvent[] | null>(null);
  const [staff, setStaff] = useState<Record<string, AStaff>>({});
  const [avail, setAvail] = useState<Avail[]>([]); const [asks, setAsks] = useState<{ department: string; tiers_sent: string[]; created_at: string }[]>([]);
  const [same, setSame] = useState<AEvent[]>([]);
  const [venueAddr, setVenueAddr] = useState<string | null>(null); const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: one } = await supabase.from('events').select('event_date,title,venue_id').eq('id', id!).single();
      if (!one) { setEvs([]); return; }
      const { data } = await supabase.from('events').select(EVENT_SELECT).eq('event_date', one.event_date).order('department');
      const all = (data ?? []) as unknown as AEvent[];
      const mine = all.filter((e) => e.title === one.title).sort((a) => (a.department === 'floor' ? -1 : 1));
      setEvs(mine); setSame(all.filter((e) => e.title !== one.title));
      if (one.venue_id) supabase.from('venues').select('address').eq('id', one.venue_id).single().then(({ data: v }) => setVenueAddr(v?.address ?? null));
      const [st, av, ak] = await Promise.all([
        allStaff(),
        supabase.from('availability').select('staff_id,status,tier').eq('for_date', one.event_date).not('ask_id', 'is', null),
        supabase.from('avail_asks').select('department,tiers_sent,created_at').eq('for_date', one.event_date),
      ]);
      setStaff(Object.fromEntries(st.map((s) => [s.id, s]))); setAvail((av.data ?? []) as Avail[]); setAsks((ak.data ?? []) as typeof asks);
    })();
  }, [id, tick]);
  const load = () => setTick((t) => t + 1);

  if (!evs) return <div className="muted">Loading…</div>;
  if (!evs.length) return <div className="adm-card">This event doesn't exist anymore. <Link to="/admin/week">Back to the week</Link></div>;
  const e = evs.find((x) => x.id === id) ?? evs[0];
  const all = evs.flatMap((x) => x.shifts.filter((s) => s.status !== 'declined' && !s.attendance).map((s) => ({ ...s, ev: x })));
  const needed = evs.reduce((n, x) => n + x.staff_needed, 0);
  const short = Math.max(0, needed - all.length);
  const lead = (dept: string) => all.find((s) => s.ev.department === dept && (s.position_code === 'MD' || s.position_code === 'BM'));
  const md = lead('floor'); const bm = lead('bar');
  const tierOf = (sid: string) => staff[sid]?.staff_private?.tier ?? null;
  const rankOf = (sid: string) => staff[sid]?.staff_private?.ranking ?? null;
  const ranks = all.map((s) => rankOf(s.staff_id)).filter((r): r is number => r != null);
  const tierCount = (t: string) => all.filter((s) => tierOf(s.staff_id) === t).length;
  const floorAsk = asks.find((a) => a.department === 'floor');
  const dept = (d: string) => evs.some((x) => x.department === d);
  const unif = (k?: string | null) => (k?.startsWith('custom:') ? k.slice(7) : UNIFORMS.find(([u]) => u === k)?.[1]) ?? '—';
  const docs = ((e as AEvent & { plan?: { documents?: { name: string; url: string }[] } }).plan?.documents) ?? [];
  const firstStart = all.map((s) => s.planned_start).sort()[0];
  const confirmed = all.filter((s) => s.status === 'confirmed').length;
  const unsent = all.filter((s) => !s.notified_at || s.changed_at > s.notified_at).length;

  // Groups by start time (per department), with open spots from the staffing grid
  type G = { key: string; label: string; people: (AShift & { ev: AEvent })[]; need: number; dept: string };
  const groups: G[] = [];
  for (const x of evs) {
    const lines = x.staffing ?? [];
    const starts = [...new Set([...lines.map((l) => l.start), ...x.shifts.filter((s) => s.status !== 'declined' && !s.attendance).map((s) => hm(s.planned_start))])].sort();
    for (const st of starts) {
      const people = all.filter((s) => s.ev.id === x.id && hm(s.planned_start) === st).sort((a, b) => Number(b.position_code === 'MD' || b.position_code === 'BM') - Number(a.position_code === 'MD' || a.position_code === 'BM') || (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? ''));
      const need = lines.filter((l) => l.start === st).reduce((n, l) => n + l.count, 0);
      groups.push({ key: x.id + st, label: `${ap12(st)}${x.department === 'bar' ? ' · BAR' : ''}`, people, need: Math.max(need, people.length), dept: x.department });
    }
  }
  const tally = { yes: avail.filter((a) => a.status === 'yes').length, no: avail.filter((a) => a.status === 'no').length, wait: avail.filter((a) => a.status === 'asked' || a.status === 'maybe').length };

  return (
    <div className="stack-lg ed">
      <div className="toolbar">
        <div>
          <Link to={`/admin/day?d=${e.event_date}`} className="muted sm strong">‹ {dLabel(e.event_date, { weekday: 'long', month: 'short', day: 'numeric' })}</Link>
          <div className="row wrap" style={{ alignItems: 'baseline', gap: 10 }}><h1 className="serif-h">{e.title}</h1>{(e.event_private?.client || e.description) && <span className="muted">· {[e.event_private?.client, e.description].filter(Boolean).join(' · ')}</span>}</div>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <span className={'tag ' + (short ? 'amber' : 'ok')}>{all.length} / {needed}{short ? ` · short ${short}` : ' · full'}</span>
            {dept('floor') && <span className="tag">Floor</span>}{dept('bar') && <span className="tag">Bar</span>}
            {floorAsk ? <span className="tag">Availability asked · {floorAsk.tiers_sent.join(' + ') || 'bar team'}</span> : <span className="tag">Availability not asked</span>}
          </div>
        </div>
        <div className="row wrap">
          <Link className="abtn" to={`/admin/event/${e.id}/edit`}>Edit</Link>
          <Link className="abtn" to={`/admin/free?d=${e.event_date}`}>Who's available {dLabel(e.event_date, { month: 'short', day: 'numeric' })}{tally.yes ? ` · ${tally.yes}` : ''}</Link>
          <Link className="abtn dark" to={`/manage/${e.id}`}>Open team (live)</Link>
          <DeleteEvent id={e.id} />
        </div>
      </div>

      <div className="ed-grid">
        <div className="stack" style={{ gap: 16 }}>
          <div className="ed-facts">
            <div><small>DATE</small><b>{dLabel(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' })}</b></div>
            <div><small>SHIFT STARTS</small><b>{firstStart ? ap12(hm(firstStart)) : ap12(e.start_time?.slice(0, 5)) || 'TBC'}</b></div>
            <div><small>ENDS · APPROX.</small><b>{e.ends_label ?? (e.end_time ? '~ ' + ap12(e.end_time.slice(0, 5)) : 'TBC')}</b></div>
            {(e.guests || e.event_type) && <div><small>{e.guests ? 'GUESTS' : 'TYPE'}</small><b>{e.guests ?? e.event_type}</b>{e.guests && e.event_type && <span>{e.event_type}</span>}</div>}
            {evs.map((x) => { const ls = x.staffing ?? []; const n = x.staff_needed; return (
              <div key={x.id}><small>{x.department === 'bar' ? 'BAR' : 'FLOOR'}</small><b>{n}</b><span>{ls.map((l) => `${l.count} ${roleName(l.code)}${l.count > 1 && !['MD', 'BM'].includes(l.code) ? 's' : ''} at ${ap12(l.start).replace(':00', '')}`).join(' · ')}</span></div>
            ); })}
          </div>

          <div className="adm-card ed-info">
            <div><small>Client</small><b>{e.event_private?.client ?? '—'}</b></div>
            <div><small>Address</small><b>{e.address ?? venueAddr ?? '—'}</b></div>
            {dept('floor') && <div><small>MD</small>{md ? <b>{md.staff?.full_name}</b> : <b className="accent">Not set · pick one</b>}</div>}
            {dept('bar') && <div><small>Bar manager</small>{bm ? <b>{bm.staff?.full_name}</b> : <b className="accent">Not set</b>}</div>}
            <div><small>Uniform · men / women</small><b>{[dept('floor') ? `Floor: ${unif(e.uniform_floor)} / ${unif(e.uniform_floor_w ?? e.uniform_floor)}` : '', dept('bar') ? `Bar: ${unif(evs.find((x) => x.department === 'bar')?.uniform_bar)} / ${unif(evs.find((x) => x.department === 'bar')?.uniform_bar_w ?? evs.find((x) => x.department === 'bar')?.uniform_bar)}` : ''].filter(Boolean).join(' · ')}</b></div>
            {evs.find((x) => x.drive_folder_url)?.drive_folder_url && <div className="full"><small>Event folder · managers see it</small><a className="tag" style={{ alignSelf: 'flex-start' }} href={evs.find((x) => x.drive_folder_url)!.drive_folder_url!} target="_blank" rel="noreferrer">Open the Drive folder ›</a></div>}
            <Billing evs={evs} onChange={load} />
            {e.notes && <div className="full"><small>Note for staff</small><b>{e.notes}</b></div>}
            <DriveFiles eventId={e.id} />
            {docs.length > 0 && <div className="full"><small>Documents</small><div className="row wrap" style={{ gap: 6 }}>{docs.map((d) => <a key={d.url} className="tag" href={d.url} target="_blank" rel="noreferrer">{d.name}</a>)}</div></div>}
          </div>

          <div className="adm-card" style={{ padding: 0 }}>
            <div className="row" style={{ padding: '16px 18px', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', gap: 8 }}>
              <span className="serif" style={{ fontSize: 22 }}>Team · {all.length}</span>
              <span className="muted sm">A {tierCount('A')} · B {tierCount('B')} · C {tierCount('C')}{ranks.length ? ` · avg rank ${Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length)}` : ''}</span>
            </div>
            {!groups.length && <div className="muted sm" style={{ padding: 18 }}>Nobody booked yet.</div>}
            {groups.map((g) => (
              <div key={g.key} className="ed-grp">
                <div className="kick" style={{ fontSize: 11 }}>{g.label} · {g.people.length} of {g.need}</div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {g.people.map((s) => { const t = tierOf(s.staff_id); return (
                    <span key={s.id} className="tchipn">{['MD', 'BM'].includes(s.position_code ?? '') ? <i className="lead">{s.position_code}</i> : <i className={'t' + (t ?? 'x')}>{t ?? '?'}</i>}{s.staff?.full_name}{roleOfShift(s.position_code) !== 'W' && !['MD', 'BM'].includes(s.position_code ?? '') ? <small> {s.position_code}</small> : null}</span>
                  ); })}
                  {g.need > g.people.length && <Link to={`/admin/free?d=${e.event_date}&e=${g.people[0]?.ev.id ?? evs.find((x) => x.department === g.dept)?.id ?? ''}`} className="open-add">{g.need - g.people.length} open · add</Link>}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <div className="adm-card stack" style={{ gap: 12 }}>
            <div className="sec" style={{ padding: 0 }}><span className="serif">Availability</span>{floorAsk && <span className="muted sm">asked {dLabel(floorAsk.created_at.slice(0, 10), { month: 'short', day: 'numeric' })}</span>}</div>
            {!avail.length ? <div className="muted sm">Nobody asked for this date yet.</div> : <>
              <div className="cnt3"><div className="ok"><b>{tally.yes}</b><small>available</small></div><div className="red"><b>{tally.no}</b><small>can't</small></div><div><b>{tally.wait}</b><small>no answer</small></div></div>
              {['A', 'B', 'C'].map((t) => { const r = avail.filter((a) => a.tier === t); if (!r.length) return null; return (
                <div key={t} className="row sm" style={{ justifyContent: 'space-between' }}><span className="muted">Tier {t} · {r.length} asked</span><b>{r.filter((a) => a.status === 'yes').length} yes · {r.filter((a) => a.status === 'no').length} no · {r.filter((a) => a.status !== 'yes' && a.status !== 'no').length} waiting</b></div>
              ); })}
            </>}
            <Link className="abtn dark" to={`/admin/free?d=${e.event_date}`}>See who and at what time</Link>
            <Link className="abtn" to="/admin/availability">Waves, nudges & next tier ›</Link>
          </div>

          <div className="adm-card stack" style={{ gap: 10 }}>
            <span className="serif" style={{ fontSize: 22 }}>Confirmations</span>
            <span className="muted sm">{confirmed} of {all.length} confirmed{unsent ? ` · ${unsent} not sent details yet` : ' · everyone has the details'}{short ? ` · team is short ${short}` : ''}{dept('floor') && !md ? ' · MD missing' : ''}</span>
            <Link className="abtn" to={`/admin/day?d=${e.event_date}`}>Send from the day view ›</Link>
          </div>

          <div className="adm-card stack" style={{ gap: 8 }}>
            <span className="serif" style={{ fontSize: 22 }}>Same day</span>
            {!same.length && <span className="muted sm">No other events that day.</span>}
            {same.map((x) => { const b = x.shifts.filter((s) => s.status !== 'declined' && !s.attendance).length; return (
              <Link key={x.id} to={`/admin/event/${x.id}`} className="same-row"><b>{x.title}{x.department === 'bar' ? ' · bar' : ''}</b><span className={b >= x.staff_needed ? 'okc' : 'accent'}>{b} / {x.staff_needed}</span></Link>
            ); })}
            <Link to={`/admin/free?d=${e.event_date}`} className="sm strong" style={{ color: 'var(--ink)' }}>Open the day · balance teams ›</Link>
            <div className="row" style={{ gap: 6 }}><Link className="abtn sm" to={`/admin/event/new?d=${addDays(e.event_date, 0)}`}>+ Another event this day</Link></div>
          </div>
        </div>
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
  return (
    <div className="full"><small>Billing · only you see it</small>
      <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
        <b>{cash ? 'Cash · no GST / QST' : 'Invoice · QuickBooks'}{doc ? ` · ${doc}` : ''}</b>
        {cash && !p.cash_received_at && <button className="abtn sm dark" onClick={markCash}>Mark cash received</button>}
        {cash && p.cash_received_at && <span className="tag">✓ Cash received {new Date(p.cash_received_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}</span>}
        {cash && p.cash_received_at && p.qb_doc_type === 'estimate' && p.qb_doc_number && !p.qb_removed_at && <button className="abtn sm" onClick={removed}>I removed Estimate #{p.qb_doc_number} in QuickBooks</button>}
      </div>
    </div>
  );
}

