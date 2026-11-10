import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { QuarterTime } from './QuarterTime';

/* Getting there · push 25d (G&R plans rides on far events) + push 68 carpool between staff (migration 093).
   Always first names, never "driver": a carpool, not a service. Numbers + car chat only for the people in the car, until they all finish. */
type Mine = { id: string; kind: 'driver' | 'rider' | 'own'; pickup_spot: string | null; leave_at: string | null; seats: number | null; coming_from: string | null; car_driver_id: string | null; sent_at: string | null; request_to: string | null; lost_at: string | null } | null;
type Car = { driver_id: string; open: boolean; pickup_spot: string | null; leave_at: string | null; seats: number | null; late_eta: string | null; people: { id: string; name: string; driving: boolean; phone: string | null }[] } | null;
type Drv = { staff_id: string; name: string; pickup_spot: string | null; leave_at: string | null; seats: number; taken: number; asked: boolean };
type Req = { staff_id: string; name: string; coming_from: string | null };
type Msg = { id: string; sender_id: string | null; body: string; created_at: string };
const hrs = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : '');
const tel = (p: string | null) => (p ?? '').replace(/[^\d+]/g, '');
const first = (n: string) => n.split(' ')[0];

export function GettingThere({ eventId, eventDate, firstStart, travelMin, paidMin, transport = true, preview = false }: { eventId: string; eventDate: string; firstStart: string; travelMin: number; paidMin: number; transport?: boolean; preview?: boolean }) {
  const [mine, setMine] = useState<Mine | undefined>(undefined); const [car, setCar] = useState<Car>(null);
  const [drivers, setDrivers] = useState<Drv[]>([]); const [reqs, setReqs] = useState<Req[]>([]); const [meId, setMeId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'driver' | 'rider' | 'late'>(null); const [chat, setChat] = useState(false);
  const suggested = (() => { const d = new Date(new Date(firstStart).getTime() - (transport ? travelMin : 30) * 60000 - 15 * 60000); const m = Math.round(d.getTime() / 900000) * 900000; return new Date(m).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }); })();
  const [f, setF] = useState({ spot: '', leave: suggested, seats: 3, from: '', late: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = async () => {
    if (preview) { setMine(null); return; }
    const [{ data }, me] = await Promise.all([supabase.from('ride_offers').select('id,kind,pickup_spot,leave_at,seats,coming_from,car_driver_id,sent_at,request_to,lost_at').eq('event_id', eventId).maybeSingle(), supabase.rpc('me')]);
    setMeId((me.data as string) ?? null); const m = (data as Mine) ?? null; setMine(m);
    const c = await supabase.rpc('my_car', { p_event: eventId }); const cd = c.error ? null : (c.data as Car);
    // G&R-planned cars only show once Ronnie sent the plan; carpools agreed between staff are sent right away
    setCar(cd && cd.people && cd.people.length > 1 && (m?.sent_at || m?.kind === 'driver') ? cd : null);
    if (m?.kind === 'rider' && !m.car_driver_id) { const d = await supabase.rpc('ride_drivers', { p_event: eventId }); setDrivers(d.error ? [] : (d.data as Drv[])); } else setDrivers([]);
    if (m?.kind === 'driver') { const r = await supabase.rpc('ride_requests', { p_event: eventId }); setReqs(r.error ? [] : (r.data as Req[])); } else setReqs([]);
  };
  useEffect(() => { load(); const t = window.setInterval(load, 60_000); return () => window.clearInterval(t); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toIso = (t: string) => { const [h, m] = t.split(':').map(Number); const ref = new Date(firstStart); const local = new Date(ref.toLocaleString('en-US', { timeZone: 'America/Toronto' })); const diff = ref.getTime() - local.getTime(); local.setHours(h, m, 0, 0); return new Date(local.getTime() + diff).toISOString(); };
  const save = async (kind: 'driver' | 'rider' | 'own') => {
    if (preview) return; setErr('');
    const row = { event_id: eventId, staff_id: meId, kind, pickup_spot: kind === 'driver' ? f.spot.trim() || null : null, leave_at: kind === 'driver' ? toIso(f.leave) : null,
      seats: kind === 'driver' ? f.seats : null, coming_from: kind === 'rider' ? f.from.trim() || null : null, car_driver_id: null, placed_at: null, sent_at: null, request_to: null, request_at: null, lost_at: null };
    const { error } = await supabase.from('ride_offers').upsert(row, { onConflict: 'event_id,staff_id' });
    if (error) { setErr(error.message); return; }
    setSheet(null); load();
  };
  const rpc = async (fn: string, args: Record<string, unknown>) => { if (preview) return; setBusy(true); setErr(''); const { error } = await supabase.rpc(fn, args); setBusy(false); if (error) setErr(error.message); load(); };
  if (mine === undefined) return null;
  const others = car?.people.filter((p) => p.id !== meId) ?? []; const driving = car?.people.find((p) => p.driving);
  const smsAll = others.map((p) => tel(p.phone)).filter(Boolean).join(',');
  return (
    <>
      <section className="gt">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><b className="gt-kick">GETTING THERE</b>{transport && <span className="gt-away">{hrs(travelMin).toUpperCase()} AWAY</span>}</div>
        {transport ? <div className="sm">+{hrs(paidMin)} travel time paid{mine?.kind === 'driver' ? ' · gas covered' : ''}</div> : <div className="sm">Carpool with people working this event · only they see it.</div>}
        {mine?.lost_at && !mine.car_driver_id && <div className="gt-lost">🚗 <b>Your carpool is off.</b> We’re working on a solution. You can also ask someone else below.</div>}
        {car ? (
          <div className="gt-ride">
            <small>YOUR CARPOOL{car.late_eta ? ' · RUNNING LATE' : ''}</small>
            <b>{car.driver_id === meId ? `You’re driving · ${others.length} with you` : `Carpooling with ${driving ? first(driving.name) : '…'}`}{transport && car.driver_id === meId ? ' · gas covered' : ''}</b>
            <div className="gt-pick"><span>PICK-UP</span><b>{car.pickup_spot ?? '—'}</b><span>{car.late_eta ? <><s>{tm(car.leave_at)}</s> {tm(car.late_eta)}</> : tm(car.leave_at)}</span></div>
            {others.map((p) => (
              <div key={p.id} className="gt-person"><span className="grow"><b>{p.name}</b><small>{p.driving ? 'Driving' : 'In the car'}{p.phone ? ` · ${p.phone}` : ''}</small></span>
                {car.open && tel(p.phone) && <><a className="gt-ic" href={`tel:${tel(p.phone)}`} aria-label={`Call ${first(p.name)}`}>📞</a><a className="gt-ic" href={`sms:${tel(p.phone)}`} aria-label={`Text ${first(p.name)}`}>💬</a></>}</div>))}
            {car.open ? <div className="gt-acts">
              {driving && driving.id !== meId && tel(driving.phone) && <a className="big-btn dark" href={`tel:${tel(driving.phone)}`}>📞 Call {first(driving.name)}</a>}
              {smsAll && <a className="big-btn" href={`sms:${smsAll}`}>💬 Text the car</a>}
              <button className="big-btn" onClick={() => setChat(!chat)}>{chat ? 'Close car chat' : 'Car chat'}</button>
              {car.driver_id === meId && <button className="big-btn gold" onClick={() => { setF({ ...f, late: '' }); setSheet('late'); }}>⏱ We’re running late</button>}
            </div> : <div className="muted sm">Everyone in the car finished the event · numbers and chat are closed.</div>}
            <span className="muted sm gt-note">Call / Text open your phone, outside the app. “Text the car” = one group text.{car.driver_id === meId ? ' ' : ''}{car.driver_id === meId && <button className="lnk" onClick={() => { if (window.confirm('Stop driving? The people in your car will be told.')) save('own'); }}>Stop driving</button>}</span>
            {chat && car.open && <CarChat eventId={eventId} driverId={car.driver_id} meId={meId} people={car.people} />}
          </div>
        ) : <>
          <div className="gt-btns">
            <button className={'gt-b need' + (mine?.kind === 'rider' ? ' on' : '')} onClick={() => setSheet('rider')}>{mine?.kind === 'rider' ? '✓ ' : ''}I need a ride</button>
            <button className={'gt-b drive' + (mine?.kind === 'driver' ? ' on' : '')} onClick={() => setSheet('driver')}>{mine?.kind === 'driver' ? '✓ ' : ''}I can drive · I have seats</button>
            <button className={'gt-b own' + (mine?.kind === 'own' ? ' on' : '')} onClick={() => save('own')}>{mine?.kind === 'own' ? '✓ ' : ''}I’ll get there on my own</button>
          </div>
          {mine?.kind === 'rider' && <div className="gt-list">
            <small className="gt-kick">PEOPLE DRIVING TO THIS EVENT</small>
            {drivers.map((d) => (
              <div key={d.staff_id} className="gt-person"><span className="grow"><b>{d.name}</b><small>{[d.pickup_spot ? `from ${d.pickup_spot}` : null, d.leave_at ? `~${tm(d.leave_at)}` : null, `${Math.max(0, d.seats - d.taken)} of ${d.seats} seats left`].filter(Boolean).join(' · ')}</small></span>
                {d.asked ? <button className="abtn sm" disabled={busy} onClick={() => rpc('ride_ask_cancel', { p_event: eventId })}>Asked · cancel</button>
                  : <button className="abtn sm dark" disabled={busy || d.taken >= d.seats || !!mine.request_to} onClick={() => rpc('ride_ask', { p_event: eventId, p_driver: d.staff_id })}>Ask to carpool</button>}</div>))}
            {!drivers.length && <div className="muted sm">Nobody is driving yet. You’ll get an alert when someone offers seats.{transport ? ' Ronnie can also put you in a car.' : ''}</div>}
            {mine.request_to && <div className="muted sm">⏳ Waiting for an answer. You’ll get an alert.</div>}
          </div>}
          {mine?.kind === 'driver' && <>
            <div className="muted sm">Offering {mine.seats} seat{mine.seats === 1 ? '' : 's'} · {mine.pickup_spot ?? '—'} · {tm(mine.leave_at)}. People on this event can ask to carpool with you.</div>
          </>}
        </>}
        {mine?.kind === 'driver' && reqs.map((r) => (
          <div key={r.staff_id} className="gt-req"><small className="gt-kick gold">CARPOOL REQUEST</small><b>{r.name} would like to carpool{r.coming_from ? ` · from ${r.coming_from}` : ''}</b>
            <div className="row" style={{ gap: 8 }}><button className="big-btn dark" disabled={busy} onClick={() => rpc('ride_answer', { p_event: eventId, p_rider: r.staff_id, p_yes: true })}>✓ Yes</button><button className="big-btn" disabled={busy} onClick={() => rpc('ride_answer', { p_event: eventId, p_rider: r.staff_id, p_yes: false })}>No, sorry</button></div></div>))}
        {err && <p className="error">{err}</p>}
      </section>
      {sheet && (<>
        <div className="scrim" onClick={() => setSheet(null)} />
        <div className="sheet swipe" role="dialog" aria-label={sheet === 'driver' ? 'Offer seats' : sheet === 'late' ? 'Running late' : 'Ask for a ride'}>
          <button className="sheet-x" aria-label="Close" onClick={() => setSheet(null)}>✕</button>
          <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{sheet === 'driver' ? 'Where can you pick people up?' : sheet === 'late' ? 'New time you’ll leave' : 'I need a ride'}</div>
          {sheet === 'driver' ? <>
            <label className="gt-f"><span>PICK-UP SPOT</span><input value={f.spot} onChange={(e) => setF({ ...f, spot: e.target.value })} placeholder="e.g. Metro Lionel-Groulx, St-Jacques exit" /></label>
            <div className="times-box"><label>Leaving at<QuarterTime value={f.leave} onChange={(v) => setF({ ...f, leave: v })} /></label></div>
            <div className="gt-f"><span>SEATS FREE</span><div className="row" style={{ gap: 6 }}>{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} className={'gt-seat' + (f.seats === n ? ' on' : '')} onClick={() => setF({ ...f, seats: n })}>{n}</button>)}</div></div>
            {transport && <div className="muted sm">Gas is covered.</div>}
            <button className="btn-ink" disabled={!f.spot.trim()} onClick={() => save('driver')}>Offer my seats</button>
          </> : sheet === 'late' ? <>
            <div className="times-box"><label>Leaving at<QuarterTime value={f.late} onChange={(v) => setF({ ...f, late: v })} /></label></div>
            <div className="muted sm">Your carpool and the MD get the new time. The whole car counts as late.</div>
            <button className="btn-ink" disabled={!f.late} onClick={async () => { await rpc('ride_late', { p_event: eventId, p_eta: toIso(f.late) }); setSheet(null); }}>Send the new time</button>
          </> : <>
            <label className="gt-f"><span>COMING FROM (optional)</span><input value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="e.g. Verdun" /></label>
            <div className="muted sm">You’ll see who is driving to this event and can ask to carpool with them.{transport ? ' Ronnie can also put you in a car.' : ''}</div>
            <button className="btn-ink" onClick={() => save('rider')}>I need a ride</button>
          </>}
        </div>
      </>)}
      {void eventDate}
    </>
  );
}

/** Car chat: only the people in this car (+ Ronnie). Closes once everyone has finished the event. */
export function CarChat({ eventId, driverId, meId, people }: { eventId: string; driverId: string; meId: string | null; people: { id: string; name: string }[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]); const [txt, setTxt] = useState(''); const [err, setErr] = useState(''); const end = useRef<HTMLDivElement>(null);
  const load = () => supabase.from('ride_chat').select('id,sender_id,body,created_at').eq('event_id', eventId).eq('driver_id', driverId).order('created_at').limit(200)
    .then(({ data }) => { setMsgs((data ?? []) as Msg[]); setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 50); });
  useEffect(() => {
    load(); const t = window.setInterval(load, 15_000);
    const ch = supabase.channel('car-' + eventId + driverId).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_chat', filter: `event_id=eq.${eventId}` }, () => load()).subscribe();
    return () => { window.clearInterval(t); supabase.removeChannel(ch); };
  }, [eventId, driverId]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => { const b = txt.trim(); if (!b) return; setErr(''); setTxt(''); const { error } = await supabase.from('ride_chat').insert({ event_id: eventId, driver_id: driverId, body: b }); if (error) { setErr(error.message); setTxt(b); } else load(); };
  const who = (id: string | null) => (id === meId ? 'You' : id ? first(people.find((p) => p.id === id)?.name ?? 'Ronnie') : 'G&R');
  return (
    <div className="car-chat">
      <div className="car-msgs">{msgs.map((m) => <div key={m.id} className={'car-msg' + (m.sender_id === meId ? ' me' : '')}><b>{who(m.sender_id)}</b> {m.body}<small>{tm(m.created_at)}</small></div>)}
        {!msgs.length && <div className="muted sm">Only the people in this car see this chat.</div>}<div ref={end} /></div>
      <div className="row" style={{ gap: 6 }}><input className="car-in" value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Message the car…" /><button className="abtn sm dark" onClick={send}>Send</button></div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
