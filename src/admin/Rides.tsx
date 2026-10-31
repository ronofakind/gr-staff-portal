import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ap12, type AEvent } from './api';

type Offer = { id: string; event_id: string; staff_id: string; kind: 'driver' | 'rider' | 'own'; pickup_spot: string | null; leave_at: string | null; seats: number | null;
  coming_from: string | null; car_driver_id: string | null; placed_at: string | null; sent_at: string | null; staff: { full_name: string; phone: string | null } | null };
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).replace(/\./g, '') : '');
const hrs = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;

/** Admin event page → Rides (push 25d): cars, riders to place, auto-fill, send the plan (in-app cards). */
export function RidesAdmin({ evs }: { evs: AEvent[] }) {
  const e = evs.find((x) => x.transport) ?? evs[0];
  const [offers, setOffers] = useState<Offer[] | null>(null); const [links, setLinks] = useState<[string, string][]>([]);
  const [drag, setDrag] = useState<string | null>(null); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const load = () => supabase.from('ride_offers').select('id,event_id,staff_id,kind,pickup_spot,leave_at,seats,coming_from,car_driver_id,placed_at,sent_at,staff:staff!ride_offers_staff_id_fkey(full_name,phone)')
    .in('event_id', evs.map((x) => x.id)).then(({ data }) => setOffers((data ?? []) as unknown as Offer[]));
  useEffect(() => { load(); supabase.from('staff_links').select('staff_a,staff_b').then(({ data }) => setLinks(((data ?? []) as { staff_a: string; staff_b: string }[]).map((l) => [l.staff_a, l.staff_b]))); }, [evs.map((x) => x.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!offers) return <div className="muted sm">Loading…</div>;
  const drivers = offers.filter((o) => o.kind === 'driver'); const riders = offers.filter((o) => o.kind === 'rider'); const own = offers.filter((o) => o.kind === 'own');
  const team = evs.flatMap((x) => x.shifts.filter((s) => s.status !== 'declined' && !s.attendance));
  const noAnswer = team.filter((s) => !offers.some((o) => o.staff_id === s.staff_id));
  const inCar = (d: string) => riders.filter((r) => r.car_driver_id === d);
  const name = (o: Offer) => o.staff?.full_name ?? '?';
  const place = async (riderId: string, driver: string | null) => {
    await supabase.from('ride_offers').update({ car_driver_id: driver, placed_at: driver ? new Date().toISOString() : null, sent_at: null }).eq('id', riderId); load();
  };
  const autoFill = async () => {
    setBusy(true);
    const left = new Map(drivers.map((d) => [d.staff_id, (d.seats ?? 3) - inCar(d.staff_id).length]));
    const near = (r: Offer, d: Offer) => { const a = (r.coming_from ?? '').toLowerCase(); const b = (d.pickup_spot ?? '').toLowerCase(); return a && b && (b.includes(a) || a.includes(b.split(/[ ,]/)[0])) ? 0 : 1; };
    const todo = riders.filter((r) => !r.car_driver_id);
    const done = new Set<string>();
    for (const r of todo) {
      if (done.has(r.id)) continue;
      const partner = todo.find((x) => x.id !== r.id && !done.has(x.id) && links.some((l) => l.includes(r.staff_id) && l.includes(x.staff_id)));
      const need = partner ? 2 : 1;
      const pick = [...drivers].filter((d) => (left.get(d.staff_id) ?? 0) >= need).sort((a, b) => near(r, a) - near(r, b) || (left.get(b.staff_id)! - left.get(a.staff_id)!))[0]
        ?? [...drivers].filter((d) => (left.get(d.staff_id) ?? 0) >= 1).sort((a, b) => near(r, a) - near(r, b))[0];
      if (!pick) continue;
      for (const x of [r, ...(partner && (left.get(pick.staff_id) ?? 0) >= 2 ? [partner] : [])]) {
        await supabase.from('ride_offers').update({ car_driver_id: pick.staff_id, placed_at: new Date().toISOString(), sent_at: null }).eq('id', x.id);
        left.set(pick.staff_id, (left.get(pick.staff_id) ?? 0) - 1); done.add(x.id);
      }
    }
    setBusy(false); load();
  };
  const toSend = [...drivers.filter((d) => inCar(d.staff_id).length && !d.sent_at), ...riders.filter((r) => r.car_driver_id && !r.sent_at)];
  const send = async () => {
    setBusy(true); setMsg('');
    const now = new Date().toISOString();
    for (const o of toSend) {
      await supabase.from('ride_offers').update({ sent_at: now }).eq('id', o.id);
      const d = drivers.find((x) => x.staff_id === (o.kind === 'driver' ? o.staff_id : o.car_driver_id));
      const body = o.kind === 'driver'
        ? `You're driving · ${inCar(o.staff_id).map(name).join(', ')} · pick up ${d?.pickup_spot ?? ''} ${tm(d?.leave_at ?? null)} · gas covered`
        : `With ${d ? name(d) : 'your driver'} · pick-up ${d?.pickup_spot ?? ''} at ${tm(d?.leave_at ?? null)}. Running late? Text ${d ? name(d).split(' ')[0] : 'your driver'} first.`;
      await supabase.from('staff_alerts').insert({ staff_id: o.staff_id, kind: 'changed', title: o.kind === 'driver' ? `Your car for ${e.title}` : `Your ride to ${e.title}`, body, event_id: o.event_id });
    }
    setBusy(false); setMsg(`Ride plan sent to ${toSend.length} people (in the app: event page + red card on Home).`); load();
  };
  const cars = drivers.length; const travelStaff = team.length; const paid = e.paid_travel_min ?? 0;
  return (
    <div className="rides">
      <div className="rides-side">
        <div className="kick">TRANSPORT</div>
        <div className="sm">One way <b>{e.travel_min ? hrs(e.travel_min) : '—'}</b> · paid travel <b>{paid ? hrs(paid) : '—'}</b> each · gas <b>${e.gas_per_car ?? 20}</b> per car · {e.transport_billing === 'gr' ? 'on G&R' : 'client pays'}</div>
        <div className="kick" style={{ marginTop: 10 }}>WHAT IT COSTS</div>
        <div className="rides-cost"><span>Gas · {cars} car{cars === 1 ? '' : 's'} × ${e.gas_per_car ?? 20}</span><b>${(cars * Number(e.gas_per_car ?? 20)).toFixed(0)}</b></div>
        <div className="rides-cost"><span>Travel · {travelStaff} staff × {hrs(paid)}</span><b>{((travelStaff * paid) / 60).toFixed(2)} h</b></div>
        <small className="muted">Pay staff: travel hours go into each person’s hours; drivers get the gas. {e.transport_billing === 'gr' ? 'Not on the invoice.' : 'Bill the client: “Transport · travel time” and “Transport · gas (n cars)” lines.'}</small>
      </div>
      <div className="rides-main">
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <span className="tag">{drivers.length} driver{drivers.length === 1 ? '' : 's'} offered</span><span className="tag">{riders.length} asked for a ride</span><span className="tag">{own.length} on their own</span>{noAnswer.length > 0 && <span className="tag amber">{noAnswer.length} no answer</span>}
          <span className="grow" />
          <button className="abtn sm" disabled={busy || !drivers.length} onClick={autoFill}>Auto-fill rides</button>
          <button className="abtn sm dark" disabled={busy || !toSend.length} onClick={send}>Send ride plan{toSend.length ? ` (${toSend.length})` : ''}</button>
        </div>
        {msg && <div className="okc sm">{msg}</div>}
        <div className="rides-cars">
          {drivers.map((d) => { const rs = inCar(d.staff_id); const seats = d.seats ?? 3; return (
            <div key={d.id} className="ride-car" onDragOver={(ev) => ev.preventDefault()} onDrop={() => { if (drag && rs.length < seats) place(drag, d.staff_id); setDrag(null); }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><b>🚗 {name(d)}</b><span className="muted sm">{rs.length} / {seats}</span></div>
              <div className="muted sm">picks up {d.pickup_spot || '—'} · {tm(d.leave_at) || 'time ?'}{d.sent_at ? ' · ✓ sent' : ''}</div>
              {rs.map((r) => <div key={r.id} className="ride-p" draggable onDragStart={() => setDrag(r.id)}>{name(r)}{r.coming_from && <small> · from {r.coming_from}</small>}{r.sent_at && <small className="okc"> ✓</small>}<button onClick={() => place(r.id, null)}>×</button></div>)}
              {rs.length < seats && <div className="bk-open">{seats - rs.length} open seat{seats - rs.length === 1 ? '' : 's'} · drop here</div>}
            </div>); })}
          {!drivers.length && <div className="muted sm">No drivers yet. Staff offer their car from the event page (“I’m driving · I can take people”).</div>}
        </div>
        <div className="kick">NEED A RIDE · NOT PLACED · {riders.filter((r) => !r.car_driver_id).length}</div>
        <div className="row wrap" style={{ gap: 6 }} onDragOver={(ev) => ev.preventDefault()} onDrop={() => { if (drag) place(drag, null); setDrag(null); }}>
          {riders.filter((r) => !r.car_driver_id).map((r) => (
            <span key={r.id} className="ride-p loose" draggable onDragStart={() => setDrag(r.id)}>{name(r)}{r.coming_from && <small> · from {r.coming_from}</small>}
              {drivers.length > 0 && <select value="" onChange={(ev) => ev.target.value && place(r.id, ev.target.value)}><option value="">car…</option>{drivers.map((d) => <option key={d.staff_id} value={d.staff_id}>{name(d)}</option>)}</select>}</span>))}
          {!riders.filter((r) => !r.car_driver_id).length && <span className="muted sm">Everyone who asked is in a car.</span>}
        </div>
        <div className="kick">GETTING THERE ON THEIR OWN · {own.length}</div>
        <div className="muted sm">{own.map(name).join(', ') || '—'} · they still get travel time.</div>
        {noAnswer.length > 0 && <><div className="kick">NO ANSWER YET · {noAnswer.length}</div><div className="muted sm">{noAnswer.map((s) => s.staff?.full_name).join(', ')}</div></>}
        <small className="muted">First start {ap12((e.staffing ?? []).map((l) => l.start).sort()[0] ?? e.start_time?.slice(0, 5))}. Riders and drivers see their car on the event page once you send the plan.</small>
      </div>
    </div>
  );
}
