import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DeleteEvent } from './DeleteEvent';
import { DeptTag } from './DeptTag';
import { needsSend, eventsBetween, addDays, isoDay, hhmm, countOf, type AEvent, type AShift } from './api';
import { meetingsBetween, MeetingLine, type AMeeting } from './Meetings';
import { dayOfMtl } from '../lib/meetings';

const monday = (iso: string) => {
  const d = new Date(iso + 'T12:00:00'); const dow = (d.getDay() + 6) % 7; return addDays(iso, -dow);
};

export function Week() {
  // push 47 · ?d= keeps the week when switching Week ↔ Day in Calendar
  const [params, setParams] = useSearchParams();
  const [start, setStart0] = useState(() => monday(/^\d{4}-\d{2}-\d{2}$/.test(params.get('d') ?? '') ? params.get('d')! : isoDay(new Date())));
  const setStart = (d: string) => { setStart0(d); const p = new URLSearchParams(params); p.set('d', d); setParams(p, { replace: true }); };
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [meetings, setMeetings] = useState<AMeeting[]>([]); // push 38
  useEffect(() => { setEvents(null); eventsBetween(start, addDays(start, 6)).then(setEvents); meetingsBetween(start, addDays(start, 6)).then(setMeetings); }, [start]);

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const all = events ?? [];
  const floor = all.filter((e) => e.department !== 'bar');
  // Nov 4 · same client count as Bookings (events with no count use their staffing lines)
  const booked = floor.reduce((n, e) => n + countOf(e).booked, 0);
  const needed = floor.reduce((n, e) => n + countOf(e).need, 0);
  const shortSum = floor.reduce((n, e) => n + countOf(e).short, 0);
  const pending = floor.reduce((n, e) => n + e.shifts.filter((s) => s.status === 'booked').length, 0);
  const label = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso + 'T12:00:00').toLocaleDateString('en-CA', o);

  // push 48 · Calendar week grid: sent pill + "to confirm" counts per event, day and week
  const [dept, setDept] = useState<'all' | 'floor' | 'bar'>('all');
  const [showWait, setShowWait] = useState(false);
  const today = isoDay(new Date());
  const shown = all.filter((e) => dept === 'all' || (dept === 'bar') === (e.department === 'bar'));
  const toSend = shown.filter((e) => sendState(e, today) === 'ready').length;
  const waitList = shown.flatMap((e) => waiting(e).map((s) => ({ e, s })));

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="row">
          <button className="sq" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}>‹</button>
          <button className="btn sm" onClick={() => setStart(monday(today))}>Today</button>
          <h1>Week of {label(start, { month: 'short', day: 'numeric' })} – {label(addDays(start, 6), { month: 'short', day: 'numeric' })}</h1>
          <button className="sq" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}>›</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg3" role="tablist" aria-label="Department">{(['all', 'floor', 'bar'] as const).map((k) => <button key={k} role="tab" aria-selected={dept === k} className={dept === k ? 'on' : ''} onClick={() => setDept(k)}>{k === 'all' ? 'All' : k === 'floor' ? 'Floor' : 'Bar'}</button>)}</div>
          <Link className="btn" to="/admin/meeting/new">+ New meeting</Link><Link className="btn primary" to="/admin/event/new">+ New event</Link>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><small>Events</small><b>{all.length}</b></div>
        <div className="kpi"><small>Floor booked</small><b>{booked}<span> / {needed}</span></b></div>
        <div className={'kpi' + (shortSum > 0 ? ' warn' : '')}><small>Still short</small><b>{shortSum}</b></div>
        <div className="kpi"><small>Not confirmed</small><b>{pending}</b></div>
      </div>
      {events && (toSend > 0 || waitList.length > 0) && (
        <div className="row wrap" style={{ gap: 8 }}>
          {toSend > 0 && <span className="wk-pill send">{toSend} to send</span>}
          {waitList.length > 0 && <button className="wk-pill wait" onClick={() => setShowWait(!showWait)}>⏳ {waitList.length} waiting to confirm {showWait ? '▴' : '›'}</button>}
        </div>
      )}
      {showWait && waitList.length > 0 && (
        <div className="adm-card" style={{ padding: '6px 16px' }}>
          {waitList.map(({ e, s }) => (
            <Link key={s.id} to={`/admin/event/${e.id}`} className="wk-wait-row"><b>{s.staff?.full_name ?? '?'}</b><span className="muted sm">{label(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' })} · {e.title}{e.department === 'bar' ? ' · bar' : ''}</span><span className="muted sm">sent {sinceText(s.notified_at)}</span></Link>
          ))}
        </div>
      )}

      {!events && <div className="muted">Loading…</div>}
      {events && (
        <div className="wk-grid">
          {days.map((d) => {
            const evs = shown.filter((e) => e.event_date === d);
            const mts = meetings.filter((m) => dayOfMtl(m.starts_at) === d);
            const w = evs.reduce((n, e) => n + waiting(e).length, 0);
            return (
              <section key={d} className={'wk-day' + (d === today ? ' today' : '')}>
                <div className="wk-dh">
                  <Link to={`/admin/day?d=${d}`} className={'wk-dn' + (d === today ? ' accent' : '')}>{label(d, { weekday: 'short', day: 'numeric' }).toUpperCase()}{d === today ? ' · TODAY' : ''}</Link>
                  {w > 0 && <span className="wk-pill wait sm" title={`${w} waiting to confirm`}>⏳ {w}</span>}
                  <Link to={`/admin/day?d=${d}`} className="wk-daylink">Day ›</Link>
                </div>
                {mts.map((m) => <div key={m.id} className="wk-meet"><MeetingLine m={m} showDay={false} /></div>)}
                {evs.map((e) => <EventCard key={e.id} e={e} today={today} onDeleted={(ids) => setEvents((v) => (v ?? []).filter((x) => !ids.includes(x.id)))} />)}
                {!evs.length && !mts.length && <div className="muted sm wk-none">—</div>}
                <Link className="wk-add" to={`/admin/event/new?d=${d}`}>+ event</Link>
              </section>
            );
          })}
        </div>
      )}
      {events && (
        <div className="row wrap muted sm" style={{ gap: 12 }}>
          <span><span className="wk-pill sent sm">✓ SENT</span> confirmations went out</span>
          <span><span className="wk-pill send sm">SEND ›</span> 4 days or less, not sent</span>
          <span><span className="wk-pill later sm">not sent</span> later</span>
          <span><span className="wk-pill wait sm">⏳ 3 to confirm</span> sent, waiting on their tap</span>
        </div>
      )}
    </div>
  );
}

const live = (s: AShift) => s.status !== 'declined' && !s.attendance && !s.cancelled_at;
const unsent = (s: AShift) => live(s) && needsSend(s);
/** Sent, not confirmed yet. */
const waiting = (e: AEvent) => e.shifts.filter((s) => live(s) && !!s.notified_at && s.status === 'booked');
function sendState(e: AEvent, today: string): 'sent' | 'ready' | 'later' | 'none' {
  const ls = e.shifts.filter(live); if (!ls.length) return 'none';
  if (!ls.some(unsent)) return 'sent';
  const days = Math.round((new Date(e.event_date + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 864e5);
  return days <= 4 ? 'ready' : 'later';
}
const sinceText = (iso: string | null) => { if (!iso) return ''; const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5); return h < 1 ? 'just now' : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`; };

function EventCard({ e, today, onDeleted }: { e: AEvent; today: string; onDeleted: (ids: string[]) => void }) {
  const c = countOf(e); const n = c.booked; const short = c.short;
  const st = sendState(e, today); const w = waiting(e).length;
  return (
    <div className={'wk-ev' + (e.department === 'bar' ? ' is-bar' : '') + (short > 0 && e.department !== 'bar' ? ' short' : '')}>
      <Link to={`/admin/event/${e.id}`} className="wk-ev-main">
        <b>{e.title}</b>
        <span className="muted sm">{hhmm(e.start_time) || 'TBC'}{e.department === 'bar' ? ' · bar' : ''}</span>
      </Link>
      <div className="wk-ev-row">
        <span className={'sm strong ' + (short > 0 && e.department !== 'bar' ? 'amber-t' : 'ok-t')}>{c.need ? `${n}/${c.need}` : `${c.n} · no count`}{c.extra ? ` +${c.extra} ex` : ''}{short > 0 && e.department !== 'bar' ? ' · short' : ''}</span>
        {st === 'sent' && <span className="wk-pill sent sm">✓ SENT</span>}
        {st === 'ready' && <Link className="wk-pill send sm" to={`/admin/day?d=${e.event_date}`}>SEND ›</Link>}
        {st === 'later' && <span className="wk-pill later sm">not sent</span>}
      </div>
      {st === 'sent' && <div>{w ? <Link className="wk-pill wait sm" to={`/admin/event/${e.id}`}>⏳ {w} to confirm</Link> : <span className="ok-t sm strong">all confirmed</span>}</div>}
      <div className="wk-ev-act"><DeleteEvent id={e.id} label="Delete" small onDone={onDeleted} /></div>
    </div>
  );
}
