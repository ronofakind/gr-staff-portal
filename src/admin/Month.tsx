import { Fragment, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { eventsBetween, addDays, isoDay, countOf, sendStateOf, ap12, type AEvent } from './api';
import { meetingsBetween, type AMeeting } from './Meetings';
import { dayOfMtl } from '../lib/meetings';

/* Nov 25 · Calendar V2 (board AdminCalendarMonthV2): month only. One line per event (floor + bar merged),
   coloured bar = state (green ok · amber short · grey not sent · purple client not confirmed), +n extras kept,
   meetings stay, hover card with Open in Bookings / Send, tap a date → Bookings. */

const monday = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };
const firstOf = (iso: string) => iso.slice(0, 8) + '01';
const addMonths = (iso: string, n: number) => { const d = new Date(firstOf(iso) + 'T12:00:00'); d.setMonth(d.getMonth() + n); return isoDay(d); };
const tShort = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const first = (n?: string | null) => (n ?? '').split(' ')[0];
type Filter = 'all' | 'short' | 'send' | 'tbc';
type G = { key: string; date: string; title: string; evs: AEvent[]; booked: number; need: number; short: number; extra: number; send: boolean; tbc: boolean; est: boolean; st: 'ok' | 'short' | 'send' | 'tbc' };

function group(evs: AEvent[], today: string): G[] {
  const m = new Map<string, AEvent[]>();
  for (const e of evs) { const k = e.event_date + '|' + e.title.trim().toLowerCase(); m.set(k, [...(m.get(k) ?? []), e]); }
  return [...m.entries()].map(([key, es]) => {
    const c = es.map(countOf); const sum = (f: (x: ReturnType<typeof countOf>) => number) => c.reduce((a, x) => a + f(x), 0);
    const need = sum((x) => x.need); const booked = need ? sum((x) => x.booked) : sum((x) => x.n);
    const short = sum((x) => x.short); const extra = sum((x) => x.extra);
    const send = es[0].event_date >= today && es.some((e) => sendStateOf(e, today) === 'ready');
    const tbc = es.some((e) => e.tentative); const est = es.some((e) => (e as AEvent & { staff_estimate?: boolean }).staff_estimate);
    const st = tbc ? 'tbc' : short > 0 ? 'short' : send ? 'send' : 'ok';
    return { key, date: es[0].event_date, title: es[0].title, evs: [...es].sort((a) => (a.department === 'bar' ? 1 : -1)), booked, need, short, extra, send, tbc, est, st } as G;
  }).sort((a, b) => (a.evs[0].start_time ?? '').localeCompare(b.evs[0].start_time ?? ''));
}

function Hover({ g }: { g: G }) {
  const e0 = g.evs[0] as AEvent & { caterer_name?: string | null };
  const lead = (e: AEvent, code: string) => first(e.shifts.find((s) => s.position_code === code && s.status !== 'declined' && !s.attendance)?.staff?.full_name);
  const conf = g.evs.reduce((n, e) => n + e.shifts.filter((s) => s.status === 'confirmed' && !s.attendance).length, 0);
  const live = g.evs.reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined' && !s.attendance).length, 0);
  return (
    <div className="mo2-pop" onClick={(ev) => ev.stopPropagation()}>
      <b className="serif">{g.title}</b>
      <span className="muted">{[new Date(g.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }), e0.start_time ? ap12(e0.start_time.slice(0, 5)) : 'Time TBC', e0.guests ? `${e0.guests} guests` : '', e0.caterer_name ? `Food by ${e0.caterer_name}` : ''].filter(Boolean).join(' · ')}</span>
      <div className="mo2-kv">
        {g.evs.map((e) => { const c = countOf(e); const l = lead(e, e.department === 'bar' ? 'BM' : 'MD'); return <Fragment key={e.id}><span>{e.department === 'bar' ? 'Bar' : 'Floor'}{l ? ` · ${e.department === 'bar' ? 'BM' : 'MD'} ${l}` : ''}</span><b className={c.short ? 'amb' : ''}>{c.need ? `${c.booked}/${c.need}` : c.n}{c.extra ? ` +${c.extra}` : ''}</b></Fragment>; })}
        <span>Confirmed</span><b>{conf} of {live}</b>
      </div>
      <div className="mo2-pb">
        <Link className="abtn dark" to={`/admin/bookings?date=${g.date}&view=board&ev=${g.evs[0].id}`}>Open in Bookings</Link>
        {g.send && <Link className="abtn" to={`/admin/day?d=${g.date}`}>Send</Link>}
      </div>
    </div>
  );
}

export function Month() {
  const [params, setParams] = useSearchParams(); const nav = useNavigate();
  const today = isoDay(new Date());
  const [firstD, setFirst0] = useState(() => firstOf(/^\d{4}-\d{2}-\d{2}$/.test(params.get('d') ?? '') ? params.get('d')! : today));
  const setFirst = (d: string) => { setFirst0(d); const p = new URLSearchParams(params); p.set('d', d); setParams(p, { replace: true }); };
  const [dept, setDept] = useState<'all' | 'floor' | 'bar'>('all');
  const [flt, setFlt] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null); const [newOpen, setNewOpen] = useState(false);
  const newRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (newRef.current && !newRef.current.contains(e.target as Node)) setNewOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const gridStart = monday(firstD);
  const lastDay = addDays(addMonths(firstD, 1), -1);
  const weeks = Math.ceil((new Date(lastDay + 'T12:00:00').getTime() - new Date(gridStart + 'T12:00:00').getTime()) / (7 * 864e5) + 1 / 7);
  const gridEnd = addDays(gridStart, weeks * 7 - 1);
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [meetings, setMeetings] = useState<AMeeting[]>([]);
  useEffect(() => { setEvents(null); eventsBetween(gridStart, gridEnd).then(setEvents); meetingsBetween(gridStart, gridEnd).then(setMeetings); }, [gridStart, gridEnd]);

  const real = (e: AEvent) => e.staff_needed > 0 || e.shifts.some((s) => s.status !== 'declined') || (e.staffing ?? []).length > 0;
  const shown = (events ?? []).filter((e) => real(e) && (dept === 'all' || (dept === 'bar') === (e.department === 'bar')));
  const groups = group(shown, today);
  const inMonth = groups.filter((g) => g.date >= firstD && g.date <= lastDay);
  const tot = inMonth.reduce((a, g) => ({ b: a.b + g.booked, n: a.n + g.need, s: a.s + (g.date >= today ? g.short : 0) }), { b: 0, n: 0, s: 0 });
  const toSend = inMonth.filter((g) => g.send).length;
  const pass = (g: G) => flt === 'all' || (flt === 'short' ? g.short > 0 && g.date >= today : flt === 'send' ? g.send : g.tbc);
  const thisWeek = monday(today);
  const label = new Date(firstD + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
  const pct = tot.n ? Math.round((tot.b / tot.n) * 100) : 0;
  const kpi = (l: string, v: React.ReactNode, sub: string, cls: string, f?: Filter) => (
    <button type="button" className={'t5-kpi ' + cls + (f && flt === f ? ' on' : '')} onClick={() => f && setFlt(flt === f ? 'all' : f)}><span>{l}</span><b>{v}</b><small>{sub}</small></button>);

  return (
    <div className="mo2">
      <div className="mo2-top">
        <button className="mo2-sq" aria-label="Previous month" onClick={() => { setOpen(null); setFirst(addMonths(firstD, -1)); }}>‹</button>
        <h1 className="serif-h">{label.replace(/^./, (c) => c.toUpperCase())}</h1>
        <button className="mo2-sq" aria-label="Next month" onClick={() => { setOpen(null); setFirst(addMonths(firstD, 1)); }}>›</button>
        <button className="abtn sm mo2-today" onClick={() => { setOpen(null); setFirst(firstOf(today)); }}>Today</button>
        <span className="grow" />
        <span className="ne-seg">{(['all', 'floor', 'bar'] as const).map((k) => <button key={k} type="button" className={dept === k ? 'on' : ''} onClick={() => setDept(k)}>{k === 'all' ? 'All' : k === 'floor' ? 'Floor' : 'Bar'}</button>)}</span>
        <span className="ne-seg">{([['all', 'All events'], ['short', 'Short'], ['send', 'To send'], ['tbc', 'Not confirmed']] as const).map(([k, l]) => <button key={k} type="button" className={flt === k ? 'on' : ''} onClick={() => setFlt(k)}>{l}</button>)}</span>
        <div className="mo2-new" ref={newRef}>
          <button type="button" className="abtn ne-go" onClick={() => setNewOpen(!newOpen)}>+ New</button>
          {newOpen && <div className="mo2-newm"><Link to="/admin/event/new">Event</Link><Link to="/admin/meeting/new">Meeting</Link></div>}
        </div>
      </div>
      <div className="t5-kpis">
        {kpi('EVENTS', inMonth.length, 'this month', '')}
        {kpi('STAFF BOOKED', `${tot.b} / ${tot.n}`, `${pct}%`, pct >= 95 ? 'ok' : '')}
        {kpi('SHORT', tot.s, 'staff still needed', tot.s ? 'amb' : 'ok', 'short')}
        {kpi('TO SEND', toSend, 'next 4 days', toSend ? 'amb' : '', 'send')}
      </div>
      <div className="mo2-leg">
        <span><i className="ok" />booked + confirmed</span><span><i className="short" />short</span><span><i className="send" />details not sent</span><span><i className="tbc" />client not confirmed</span>
      </div>
      {!events && <div className="muted">Loading…</div>}
      {events && (
        <div className="mo2-grid">
          {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => <div key={d} className="mo2-h">{d}</div>)}
          {days.map((d) => {
            const out = d < firstD || d > lastDay; const gs = groups.filter((g) => g.date === d && pass(g));
            const mts = flt === 'all' ? meetings.filter((m) => dayOfMtl(m.starts_at) === d) : [];
            const short = d >= today ? groups.filter((g) => g.date === d).reduce((n, g) => n + g.short, 0) : 0;
            const isOpen = open === d; const max = 4 - Math.min(mts.length, 2);
            const list = isOpen ? gs : gs.slice(0, max);
            const past = monday(d) < thisWeek;
            return (
              <div key={d} className={'mo2-d' + (out ? ' out' : '') + (past ? ' past' : '') + (d === today ? ' today' : '') + (isOpen ? ' open' : '')} onClick={() => nav(`/admin/bookings?date=${d}&view=board`)}>
                <div className="mo2-dh"><b>{Number(d.slice(8))}</b><span className="grow" />{short > 0 && <span className="mo2-short">{short} short</span>}</div>
                {mts.map((m) => <div key={m.id} className="mo2-e mt" onClick={(ev) => { ev.stopPropagation(); nav('/admin/meetings'); }}><i /><span className="mo2-et">Meeting</span><b>{tShort(m.starts_at)}</b></div>)}
                {list.map((g) => (
                  <div key={g.key} className={'mo2-e ' + g.st} onClick={(ev) => { ev.stopPropagation(); nav(`/admin/bookings?date=${d}&view=board&ev=${g.evs[0].id}`); }}>
                    <i /><span className="mo2-et">{g.title}</span>
                    <b className={g.est ? 'est' : ''}>{g.need ? `${g.booked}/${g.need}` : g.booked}{g.extra ? <em> +{g.extra}</em> : null}</b>
                    <Hover g={g} />
                  </div>))}
                {gs.length > max && <button type="button" className="mo2-more" onClick={(ev) => { ev.stopPropagation(); setOpen(isOpen ? null : d); }}>{isOpen ? 'Less' : `+ ${gs.length - max} more`}</button>}
              </div>);
          })}
        </div>
      )}
    </div>
  );
}
