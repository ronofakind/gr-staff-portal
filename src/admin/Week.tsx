import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { eventsBetween, addDays, isoDay, hhmm, type AEvent } from './api';

const monday = (iso: string) => {
  const d = new Date(iso + 'T12:00:00'); const dow = (d.getDay() + 6) % 7; return addDays(iso, -dow);
};

export function Week() {
  const [start, setStart] = useState(monday(isoDay(new Date())));
  const [events, setEvents] = useState<AEvent[] | null>(null);
  useEffect(() => { setEvents(null); eventsBetween(start, addDays(start, 6)).then(setEvents); }, [start]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const all = events ?? [];
  const floor = all.filter((e) => e.department !== 'bar');
  const booked = floor.reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0);
  const needed = floor.reduce((n, e) => n + e.staff_needed, 0);
  const pending = floor.reduce((n, e) => n + e.shifts.filter((s) => s.status === 'booked').length, 0);
  const label = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', o);

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="row">
          <button className="sq" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}>‹</button>
          <h1>Week of {label(start, { month: 'short', day: 'numeric' })} – {label(addDays(start, 6), { month: 'short', day: 'numeric' })}</h1>
          <button className="sq" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>›</button>
        </div>
        <Link className="btn primary" to="/admin/event/new">+ New event</Link>
      </div>

      <div className="kpis">
        <div className="kpi"><small>Events</small><b>{all.length}</b></div>
        <div className="kpi"><small>Floor booked</small><b>{booked}<span> / {needed}</span></b></div>
        <div className={'kpi' + (needed - booked > 0 ? ' warn' : '')}><small>Still short</small><b>{Math.max(0, needed - booked)}</b></div>
        <div className="kpi"><small>Not confirmed</small><b>{pending}</b></div>
      </div>

      {!events && <div className="muted">Loading…</div>}
      {events && days.map((d) => {
        const evs = all.filter((e) => e.event_date === d);
        if (!evs.length) return null;
        return (
          <section key={d} className="stack">
            <div className="row">
              <h2 className="h2">{label(d, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
              <span className="muted sm">{evs.length} event{evs.length > 1 ? 's' : ''}</span>
              <div className="grow" />
              <Link className="btn sm" to={`/admin/day?d=${d}`}>Open day view</Link>
            </div>
            {evs.map((e) => <EventCard key={e.id} e={e} />)}
          </section>
        );
      })}
      {events && !all.length && <p className="muted">No events this week yet. Add one with “New event”.</p>}
    </div>
  );
}

function EventCard({ e }: { e: AEvent }) {
  const n = e.shifts.filter((s) => s.status !== 'declined').length;
  const short = e.staff_needed - n;
  const pct = e.staff_needed ? Math.min(100, (n / e.staff_needed) * 100) : 0;
  return (
    <div className={'ev-card' + (short > 0 && e.department !== 'bar' ? ' short' : '')}>
      <div className="grow">
        <div className="strong">{e.title}</div>
        <div className="muted sm">{e.department === 'bar' ? 'Bar' : 'Floor'} · {hhmm(e.start_time) || 'TBC'}{e.end_time ? ` – ${hhmm(e.end_time)}` : ''}{e.event_private?.client ? ` · ${e.event_private.client}` : ''}</div>
      </div>
      <div className="meter">
        <div className="spread sm"><span className="muted">Booked</span><b>{n} / {e.staff_needed}</b></div>
        <div className="bar"><div style={{ width: `${pct}%` }} className={short > 0 ? 'fill warn' : 'fill'} /></div>
      </div>
      <div className="row">
        <Link className="btn sm" to={`/admin/event/${e.id}`}>Edit</Link>
        <Link className="btn sm primary" to={`/admin/day?d=${e.event_date}`}>Assign</Link>
      </div>
    </div>
  );
}
