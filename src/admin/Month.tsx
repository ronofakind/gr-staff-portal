import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { eventsBetween, addDays, isoDay, countOf, sendStateOf, type AEvent } from './api';
import { meetingsBetween, type AMeeting } from './Meetings';
import { dayOfMtl } from '../lib/meetings';

/* Nov 4 · Calendar → Month (mapping "G&R staff app week strip + month view").
   Up to 4 events a day (venue · booked/needed · SEND / ✓), red "n short", "▾ +n more" opens the whole day in place.
   Click a day → Day view; click an event → Bookings on that event. All / Floor / Bar filters events and the 4 totals. */

const monday = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };
const firstOf = (iso: string) => iso.slice(0, 8) + '01';
const addMonths = (iso: string, n: number) => { const d = new Date(firstOf(iso) + 'T12:00:00'); d.setMonth(d.getMonth() + n); return isoDay(d); };
const title = (e: AEvent & { venues?: { name: string } | null }) => e.venues?.name ?? e.title;
const tShort = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).replace(':00', '').replace(' ', ' ');

export function Month() {
  const [params, setParams] = useSearchParams(); const nav = useNavigate();
  const today = isoDay(new Date());
  const [first, setFirst0] = useState(() => firstOf(/^\d{4}-\d{2}-\d{2}$/.test(params.get('d') ?? '') ? params.get('d')! : today));
  const setFirst = (d: string) => { setFirst0(d); const p = new URLSearchParams(params); p.set('d', d); setParams(p, { replace: true }); };
  const [dept, setDept] = useState<'all' | 'floor' | 'bar'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const gridStart = monday(first);
  const lastDay = addDays(addMonths(first, 1), -1);
  const weeks = Math.ceil((new Date(lastDay + 'T12:00:00').getTime() - new Date(gridStart + 'T12:00:00').getTime()) / (7 * 864e5) + 1 / 7);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [meetings, setMeetings] = useState<AMeeting[]>([]);
  useEffect(() => { setEvents(null); eventsBetween(gridStart, gridEnd).then(setEvents); meetingsBetween(gridStart, gridEnd).then(setMeetings); }, [gridStart, gridEnd]);

  const shown = (events ?? []).filter((e) => dept === 'all' || (dept === 'bar') === (e.department === 'bar'));
  const inMonth = shown.filter((e) => e.event_date >= first && e.event_date <= lastDay);
  const tot = inMonth.reduce((a, e) => { const c = countOf(e); return { b: a.b + c.booked, n: a.n + c.need, s: a.s + c.short }; }, { b: 0, n: 0, s: 0 });
  const toSend = inMonth.filter((e) => e.event_date >= today && sendStateOf(e, today) === 'ready').length;
  const thisWeek = monday(today);
  const label = new Date(first + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="row">
          <button className="sq" aria-label="Previous month" onClick={() => { setOpen(null); setFirst(addMonths(first, -1)); }}>‹</button>
          <button className="btn sm" onClick={() => { setOpen(null); setFirst(firstOf(today)); }}>Today</button>
          <h1 style={{ textTransform: 'capitalize' }}>{label}</h1>
          <button className="sq" aria-label="Next month" onClick={() => { setOpen(null); setFirst(addMonths(first, 1)); }}>›</button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg3" role="tablist" aria-label="Department">{(['all', 'floor', 'bar'] as const).map((k) => <button key={k} role="tab" aria-selected={dept === k} className={dept === k ? 'on' : ''} onClick={() => setDept(k)}>{k === 'all' ? 'All' : k === 'floor' ? 'Floor' : 'Bar'}</button>)}</div>
          <Link className="btn" to="/admin/meeting/new">+ New meeting</Link><Link className="btn primary" to="/admin/event/new">+ New event</Link>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi"><small>Events this month</small><b>{inMonth.length}</b></div>
        <div className="kpi"><small>Staff booked</small><b>{tot.b}<span> / {tot.n}</span></b></div>
        <div className={'kpi' + (tot.s > 0 ? ' warn' : '')}><small>Still short</small><b>{tot.s}</b></div>
        <div className="kpi"><small>To send (≤ 4 days)</small><b>{toSend}</b></div>
      </div>
      {!events && <div className="muted">Loading…</div>}
      {events && (
        <div className="mo">
          {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => <div key={d} className="mo-h">{d}</div>)}
          {days.map((d) => {
            const out = d < first || d > lastDay; const evs = shown.filter((e) => e.event_date === d);
            const mts = meetings.filter((m) => dayOfMtl(m.starts_at) === d);
            const short = evs.reduce((n, e) => n + countOf(e).short, 0); const isOpen = open === d;
            const list = isOpen ? evs : evs.slice(0, 4);
            return (
              <div key={d} className={'mo-d' + (out ? ' out' : '') + (d === today ? ' today' : '') + (monday(d) === thisWeek ? ' wk' : '') + (isOpen ? ' open' : '')} onClick={() => nav(`/admin/day?d=${d}`)}>
                <div className="mo-dh"><b>{Number(d.slice(8))}</b>{d === today && <span className="mo-today">TODAY</span>}<span className="grow" />{short > 0 && <span className="mo-short">{short} short</span>}</div>
                {mts.map((m) => <div key={m.id} className="mo-m">Meeting · {tShort(m.starts_at)}</div>)}
                {list.map((e) => { const c = countOf(e); const st = sendStateOf(e, today); return (
                  <Link key={e.id} to={`/admin/bookings?date=${d}&view=board&dept=${e.department === 'bar' ? 'bar' : 'floor'}&ev=${e.id}`} className={'mo-e' + (e.department === 'bar' ? ' bar' : '')} onClick={(ev) => ev.stopPropagation()}>
                    <span className="mo-et">{title(e)}</span>
                    <b className={c.need && c.short ? 'amber-t' : 'ok-t'}>{c.need ? `${c.booked}/${c.need}` : `${c.n}`}{c.extra ? <i className="mo-x"> +{c.extra}</i> : null}</b>
                    {st === 'ready' && d >= today && <span className="mo-send">SEND</span>}{st === 'sent' && <span className="mo-sent">✓</span>}
                  </Link>); })}
                {evs.length > 4 && <button type="button" className="mo-more" onClick={(ev) => { ev.stopPropagation(); setOpen(isOpen ? null : d); }}>{isOpen ? '▴ less' : `▾ +${evs.length - 4} more`}</button>}
              </div>);
          })}
        </div>
      )}
    </div>
  );
}
