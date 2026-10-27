import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, allStaff, addDays, isoDay, hhmm, startIso, sortShifts, type AEvent, type AStaff, type AShift } from './api';

type Drag = { kind: 'shift'; shift: AShift } | { kind: 'staff'; staff: AStaff };

export function Day() {
  const [params, setParams] = useSearchParams();
  const day = params.get('d') ?? isoDay(new Date());
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [avail, setAvail] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    const [evs, st, av] = await Promise.all([
      eventsBetween(day, day), staff.length ? Promise.resolve(staff) : allStaff(),
      supabase.from('availability').select('staff_id,status').eq('for_date', day),
    ]);
    setEvents(evs); setStaff(st);
    setAvail(Object.fromEntries((av.data ?? []).map((a) => [a.staff_id, a.status])));
  };
  useEffect(() => { setEvents(null); load(); }, [day]);

  const act = async (p: PromiseLike<{ error: unknown }>) => {
    setErr(''); const { error } = await p; if (error) setErr((error as Error).message); await load();
  };

  const bookedIds = useMemo(() => new Set((events ?? []).flatMap((e) => e.shifts.map((s) => s.staff_id))), [events]);
  const pool = useMemo(() => staff
    .filter((s) => s.active && s.department === 'floor' && !bookedIds.has(s.id) && avail[s.id] !== 'no')
    .filter((s) => (q ? s.full_name.toLowerCase().includes(q.toLowerCase()) : avail[s.id] === 'yes' || avail[s.id] === 'maybe'))
    .sort((a, b) => (avail[a.id] === 'yes' ? 0 : 1) - (avail[b.id] === 'yes' ? 0 : 1)
      || (a.staff_private?.ranking ?? 999) - (b.staff_private?.ranking ?? 999)), [staff, bookedIds, avail, q]);

  const addTo = (e: AEvent, s: AStaff) => act(supabase.from('shifts').insert({
    event_id: e.id, staff_id: s.id, planned_start: startIso(e.event_date, e.start_time),
    position_code: s.positions.includes('MD') && !e.shifts.some((x) => x.position_code === 'MD') ? 'MD' : null,
  }));
  const moveTo = (e: AEvent, sh: AShift) => sh.event_id === e.id ? Promise.resolve() :
    act(supabase.from('shifts').update({ event_id: e.id, planned_start: startIso(e.event_date, e.start_time), position_code: null }).eq('id', sh.id));
  const remove = (sh: AShift) => act(supabase.from('shifts').delete().eq('id', sh.id));
  const setCode = (sh: AShift, code: string) => act(supabase.from('shifts').update({ position_code: code || null }).eq('id', sh.id));

  const onDrop = (e: AEvent) => {
    if (!drag || e.department === 'bar') return;
    if (drag.kind === 'staff') addTo(e, drag.staff); else moveTo(e, drag.shift);
    setDrag(null);
  };

  const floorEvents = (events ?? []).filter((e) => e.department !== 'bar');
  const pending = floorEvents.flatMap((e) => e.shifts).filter((s) => !s.notified_at || s.changed_at > s.notified_at);
  const markSent = () => act(supabase.from('shifts').update({ notified_at: new Date().toISOString() }).in('id', pending.map((p) => p.id)));
  const long = new Date(day + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' });
  const totalBooked = floorEvents.reduce((n, e) => n + e.shifts.length, 0);
  const totalNeeded = floorEvents.reduce((n, e) => n + e.staff_needed, 0);

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="row">
          <button className="sq" aria-label="Previous day" onClick={() => setParams({ d: addDays(day, -1) })}>‹</button>
          <div>
            <h1>{long}</h1>
            <div className="muted sm">{(events ?? []).length} events · {totalBooked} booked · <span className={totalNeeded > totalBooked ? 'accent strong' : ''}>{Math.max(0, totalNeeded - totalBooked)} short</span></div>
          </div>
          <button className="sq" aria-label="Next day" onClick={() => setParams({ d: addDays(day, 1) })}>›</button>
          <input type="date" className="date" value={day} onChange={(e) => e.target.value && setParams({ d: e.target.value })} aria-label="Pick a date" />
        </div>
        <Link className="btn primary" to={`/admin/event/new?d=${day}`}>+ New event</Link>
      </div>

      {err && <p className="error">{err}</p>}

      {pending.length > 0 && (
        <div className="pending">
          <div className="grow"><b>{pending.length} change{pending.length > 1 ? 's' : ''} not sent to staff yet</b>
            <div className="sm muted">{pending.map((p) => p.staff?.full_name).join(', ')}</div></div>
          <button className="btn primary" onClick={markSent}>Send updated details</button>
        </div>
      )}

      <section className="pool">
        <div className="row wrap">
          <b>Available, not booked</b><span className="muted sm">drag onto an event</span>
          <div className="grow" />
          <input className="search" placeholder="Search any staff…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chips">
          {pool.slice(0, 40).map((s) => (
            <div key={s.id} className={'chip ' + (avail[s.id] ?? 'none')} draggable
              onDragStart={() => setDrag({ kind: 'staff', staff: s })} onDragEnd={() => setDrag(null)}>
              {s.staff_private?.ranking != null && <small>#{s.staff_private.ranking}</small>} {s.full_name}
              {avail[s.id] === 'maybe' && <small> · not sure</small>}
              <select aria-label={`Add ${s.full_name} to`} value="" onChange={(ev) => { const e = floorEvents.find((x) => x.id === ev.target.value); if (e) addTo(e, s); }}>
                <option value="">+</option>
                {floorEvents.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
            </div>
          ))}
          {!pool.length && <span className="muted sm">{q ? 'No match.' : 'Nobody has said yes for this day yet. Search to add anyone.'}</span>}
        </div>
      </section>

      {!events && <div className="muted">Loading…</div>}
      <div className="columns">
        {(events ?? []).map((e) => {
          const locked = e.department === 'bar';
          const shifts = [...e.shifts].sort(sortShifts);
          const short = e.staff_needed - shifts.length;
          return (
            <section key={e.id} className={'col' + (drag && !locked ? ' droppable' : '') + (locked ? ' locked' : '')}
              onDragOver={(ev) => { if (!locked) ev.preventDefault(); }} onDrop={() => onDrop(e)}>
              <header className="col-head">
                <div className="spread">
                  <div><div className="strong">{e.title}</div>
                    <div className="muted sm">{locked ? 'Bar · from the sheet' : 'Floor'} · {hhmm(e.start_time) || 'TBC'}{e.end_time ? ` – ${hhmm(e.end_time)}` : ''}</div></div>
                  <span className={'pill ' + (short > 0 ? 'accent' : 'ok')}>{shifts.length} / {e.staff_needed}</span>
                </div>
                <div className="row">
                  <Link className="btn sm" to={`/admin/event/${e.id}`}>Details</Link>
                  {!locked && <Link className="btn sm" to={`/manage/${e.id}`}>Run shift</Link>}
                  {e.event_private && <span className="muted sm">Punch code <b>{e.event_private.punch_code}</b></span>}
                </div>
              </header>
              {shifts.map((s) => (
                <div key={s.id} className="roster-row" draggable={!locked}
                  onDragStart={() => setDrag({ kind: 'shift', shift: s })} onDragEnd={() => setDrag(null)}>
                  <input className="code" defaultValue={s.position_code ?? ''} disabled={locked} aria-label="Position"
                    onBlur={(ev) => ev.target.value !== (s.position_code ?? '') && setCode(s, ev.target.value.trim().toUpperCase())} />
                  <span className="grow">{s.staff?.full_name}</span>
                  <span className={'dot ' + s.status} title={s.status} />
                  {!locked && (
                    <>
                      <select aria-label="Move to" value="" onChange={(ev) => { const t = floorEvents.find((x) => x.id === ev.target.value); if (t) moveTo(t, s); }}>
                        <option value="">⇄</option>
                        {floorEvents.filter((x) => x.id !== e.id).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                      </select>
                      <button className="x" aria-label={`Remove ${s.staff?.full_name}`} onClick={() => remove(s)}>×</button>
                    </>
                  )}
                </div>
              ))}
              {!locked && short > 0 && <div className="open-spots">{short} open spot{short > 1 ? 's' : ''}</div>}
              {drag && !locked && <div className="drop-hint">Drop here</div>}
            </section>
          );
        })}
      </div>
      {events && !events.length && <p className="muted">No events this day.</p>}
    </div>
  );
}
