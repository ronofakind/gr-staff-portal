import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { QuarterTime } from './QuarterTime';

type Mine = { id: string; kind: 'driver' | 'rider' | 'own'; pickup_spot: string | null; leave_at: string | null; seats: number | null; coming_from: string | null; car_driver_id: string | null; sent_at: string | null } | null;
type Ride = { role: 'driver' | 'rider'; driver: { name: string; phone: string | null; photo: string | null }; pickup_spot: string | null; leave_at: string | null; riders: { name: string; phone: string | null }[] } | null;
const hrs = (min: number) => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60}` : ''}`;
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : '');
const tel = (p: string | null) => (p ?? '').replace(/[^\d+]/g, '');

/** Staff event page · Getting there (push 25d). Driver chooses the pick-up spot; Ronnie places riders and sends the plan. */
export function GettingThere({ eventId, eventDate, firstStart, travelMin, paidMin, preview = false }: { eventId: string; eventDate: string; firstStart: string; travelMin: number; paidMin: number; preview?: boolean }) {
  const [mine, setMine] = useState<Mine | undefined>(undefined); const [ride, setRide] = useState<Ride>(null);
  const [sheet, setSheet] = useState<null | 'driver' | 'rider'>(null);
  const suggested = (() => { const d = new Date(new Date(firstStart).getTime() - travelMin * 60000 - 15 * 60000); const m = Math.round(d.getTime() / 900000) * 900000; return new Date(m).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }); })();
  const [f, setF] = useState({ spot: '', leave: suggested, seats: 3, from: '' }); const [err, setErr] = useState('');
  const load = async () => {
    if (preview) { setMine(null); return; }
    const { data } = await supabase.from('ride_offers').select('id,kind,pickup_spot,leave_at,seats,coming_from,car_driver_id,sent_at').eq('event_id', eventId).maybeSingle();
    setMine((data as Mine) ?? null);
    const r = await supabase.rpc('my_ride', { p_event: eventId }); const rd = r.data as Ride; setRide(rd && rd.driver && rd.driver.name ? rd : null);
  };
  useEffect(() => { load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toIso = (t: string) => { const [h, m] = t.split(':').map(Number); const ref = new Date(firstStart); const local = new Date(ref.toLocaleString('en-US', { timeZone: 'America/Toronto' })); const diff = ref.getTime() - local.getTime(); local.setHours(h, m, 0, 0); return new Date(local.getTime() + diff).toISOString(); };
  const save = async (kind: 'driver' | 'rider' | 'own') => {
    if (preview) return; setErr('');
    const { data: me } = await supabase.rpc('me');
    const row = { event_id: eventId, staff_id: me, kind, pickup_spot: kind === 'driver' ? f.spot.trim() || null : null, leave_at: kind === 'driver' ? toIso(f.leave) : null,
      seats: kind === 'driver' ? f.seats : null, coming_from: kind === 'rider' ? f.from.trim() || null : null, car_driver_id: null, placed_at: null, sent_at: null };
    const { error } = await supabase.from('ride_offers').upsert(row, { onConflict: 'event_id,staff_id' });
    if (error) { setErr(error.message); return; }
    setSheet(null); load();
  };
  if (mine === undefined) return null;
  return (
    <>
      <section className="gt">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><b className="gt-kick">GETTING THERE</b><span className="gt-away">{hrs(travelMin).toUpperCase()} AWAY</span></div>
        <div className="sm">+{hrs(paidMin)} travel time paid{mine?.kind === 'driver' ? ' · gas covered' : ''}</div>
        {ride ? (
          <div className="gt-ride">
            <small>{ride.role === 'driver' ? 'YOU’RE DRIVING' : 'YOUR RIDE'}</small>
            {ride.role === 'driver' ? <b>{ride.riders.length} {ride.riders.length === 1 ? 'person' : 'people'} with you · gas covered</b> : <b>With {ride.driver.name} · driver</b>}
            <div className="gt-pick"><span>PICK-UP</span><b>{ride.pickup_spot ?? '—'}</b><span>{tm(ride.leave_at)}</span></div>
            {ride.role === 'rider' && tel(ride.driver.phone) && <div className="row" style={{ gap: 8 }}><a className="big-btn dark" href={`tel:${tel(ride.driver.phone)}`}>Call</a><a className="big-btn" href={`sms:${tel(ride.driver.phone)}`}>Message</a></div>}
            {ride.riders.length > 0 && <div className="sm">{ride.role === 'driver' ? 'Picking up: ' : 'Also in the car: '}{ride.riders.map((r, i) => <span key={i}>{i ? ', ' : ''}{tel(r.phone) ? <a href={`tel:${tel(r.phone)}`}>{r.name}</a> : r.name}</span>)}</div>}
            {ride.role === 'rider' && <div className="muted sm">Running late? Text {ride.driver.name.split(' ')[0]} first.</div>}
          </div>
        ) : <>
          <div className="gt-btns">
            <button className={'gt-b need' + (mine?.kind === 'rider' ? ' on' : '')} onClick={() => setSheet('rider')}>{mine?.kind === 'rider' ? '✓ ' : ''}I need a ride</button>
            <button className={'gt-b drive' + (mine?.kind === 'driver' ? ' on' : '')} onClick={() => setSheet('driver')}>{mine?.kind === 'driver' ? '✓ ' : ''}I’m driving · I can take people</button>
            <button className={'gt-b own' + (mine?.kind === 'own' ? ' on' : '')} onClick={() => save('own')}>{mine?.kind === 'own' ? '✓ ' : ''}I’ll get there on my own</button>
          </div>
          {mine?.kind === 'rider' && <div className="muted sm">Asked for a ride{mine.coming_from ? ` from ${mine.coming_from}` : ''}. Ronnie puts you in a car and sends you where and when.</div>}
          {mine?.kind === 'driver' && <div className="muted sm">Offered your car: {mine.pickup_spot ?? '—'} · {tm(mine.leave_at)} · {mine.seats} seats. Ronnie sends you who you’re taking.</div>}
        </>}
        {err && <p className="error">{err}</p>}
      </section>
      {sheet && (<>
        <div className="scrim" onClick={() => setSheet(null)} />
        <div className="sheet swipe" role="dialog" aria-label={sheet === 'driver' ? 'Offer your car' : 'Ask for a ride'}>
          <button className="sheet-x" aria-label="Close" onClick={() => setSheet(null)}>✕</button>
          <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{sheet === 'driver' ? 'Where can you pick people up?' : 'Ask for a ride'}</div>
          {sheet === 'driver' ? <>
            <label className="gt-f"><span>PICK-UP SPOT</span><input value={f.spot} onChange={(e) => setF({ ...f, spot: e.target.value })} placeholder="e.g. Metro Lionel-Groulx, St-Jacques exit" /></label>
            <div className="times-box"><label>Leaving at<QuarterTime value={f.leave} onChange={(v) => setF({ ...f, leave: v })} /></label></div>
            <div className="gt-f"><span>SEATS FREE</span><div className="row" style={{ gap: 6 }}>{[1, 2, 3, 4, 5, 6].map((n) => <button key={n} className={'gt-seat' + (f.seats === n ? ' on' : '')} onClick={() => setF({ ...f, seats: n })}>{n}</button>)}</div></div>
            <div className="muted sm">Gas is covered.</div>
            <button className="btn-ink" disabled={!f.spot.trim()} onClick={() => save('driver')}>Offer my car</button>
          </> : <>
            <label className="gt-f"><span>COMING FROM (optional)</span><input value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="e.g. Verdun" /></label>
            <div className="muted sm">Drivers choose their pick-up spot. Ronnie puts you in a car and sends you where and when. Not guaranteed until then.</div>
            <button className="btn-ink" onClick={() => save('rider')}>Ask for a ride</button>
          </>}
        </div>
      </>)}
      {void eventDate}
    </>
  );
}
