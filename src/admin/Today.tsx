import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, addDays, isoDay, flagsOf, flagText, periodOf, dLabel, type AEvent } from './api';

type Need = { key: string; title: string; sub: string; action: string; to: string; red?: boolean };

export function Today() {
  const today = isoDay(new Date());
  const [week, setWeek] = useState<AEvent[] | null>(null);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [answers, setAnswers] = useState(0);
  const [missing, setMissing] = useState(0);

  useEffect(() => {
    (async () => {
      const mon = addDays(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7));
      const [evs, ahead, ans] = await Promise.all([
        eventsBetween(mon, addDays(mon, 6)),
        eventsBetween(today, addDays(today, 14)),
        supabase.from('availability').select('id', { count: 'exact', head: true }).eq('status', 'yes').not('ask_id', 'is', null).gte('for_date', today),
      ]);
      setWeek(evs); setAnswers(ans.count ?? 0);
      // Missing end times in this + last pay period
      const cur = periodOf(today); const prev = periodOf(addDays(cur.start, -1));
      const past = await eventsBetween(prev.start, addDays(today, -1));
      const miss = past.flatMap((e) => e.shifts.filter((s) => !s.attendance && s.punches?.punch_in && !s.punches.punch_out).map((s) => ({ e, s })));
      setMissing(miss.length);

      const n: Need[] = [];
      // Flags from today and yesterday
      const recent = [...evs, ...past].filter((e) => e.event_date >= addDays(today, -1) && e.event_date <= today);
      const seen = new Set<string>();
      for (const e of recent) for (const s of e.shifts) {
        if (seen.has(s.id)) continue; seen.add(s.id);
        for (const f of flagsOf(s)) n.push({ key: s.id + f.flag, red: true, title: `⚑ ${s.staff?.full_name ?? '?'} · ${flagText(f).toLowerCase()}`, sub: `${e.event_date === today ? 'Today' : 'Yesterday'} · ${e.title}`, action: 'View', to: '/admin/reliability' });
      }
      for (const e of ahead.filter((x) => x.department !== 'bar')) {
        const booked = e.shifts.filter((s) => s.status !== 'declined').length;
        if (booked < e.staff_needed) n.push({ key: e.id + 'short', title: `${e.title} · ${dLabel(e.event_date)}`, sub: `Short ${e.staff_needed - booked} · ${booked} / ${e.staff_needed} booked`, action: 'Assign', to: `/admin/day?d=${e.event_date}` });
        const unsent = e.shifts.filter((s) => !s.notified_at || s.changed_at > s.notified_at).length;
        if (booked && unsent && e.event_date <= addDays(today, 7)) n.push({ key: e.id + 'send', title: `${e.title} · ${dLabel(e.event_date)}`, sub: `${unsent} not sent details yet`, action: 'Send', to: `/admin/day?d=${e.event_date}` });
      }
      if (miss.length) n.push({ key: 'miss', title: `Pay period ${dLabel(cur.start, { month: 'short', day: 'numeric' })} – ${dLabel(cur.end, { day: 'numeric' })}`, sub: `${miss.length} missing end time${miss.length > 1 ? 's' : ''}`, action: 'Fix', to: '/admin/hours' });
      const { data: hq } = await supabase.from('hours_questions').select('id,kind,claimed_at,shifts!inner(staff:staff!shifts_staff_id_fkey(full_name),events(title))').eq('status', 'open');
      for (const q of (hq ?? []) as unknown as { id: string; kind: string; shifts: { staff: { full_name: string }; events: { title: string } } }[])
        n.unshift({ key: 'q' + q.id, red: true, title: `Hours question · ${q.shifts.staff.full_name}`, sub: `${q.shifts.events.title} · about ${q.kind === 'other' ? 'something else' : q.kind + ' time'}`, action: 'Check', to: '/admin/hours' });
      setNeeds(n);
    })();
  }, []);

  const tonight = (week ?? []).filter((e) => e.event_date === today);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const mon = addDays(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const floorShort = (week ?? []).filter((e) => e.department !== 'bar' && e.event_date >= today).reduce((n, e) => n + Math.max(0, e.staff_needed - e.shifts.filter((s) => s.status !== 'declined').length), 0);

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="kick">{dLabel(today, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</div><h1 className="serif-h">{hello}, Ronnie</h1></div>
        <div className="row wrap"><Link className="abtn" to="/admin/availability">Ask availability</Link><Link className="abtn dark" to="/admin/week">Open the week</Link></div>
      </div>

      <div className="kpi4">
        <div className="k dark"><small>TONIGHT</small><b>{tonight.length} <span>events · {tonight.reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0)} staff</span></b></div>
        <div className={'k' + (floorShort ? ' amber' : '')}><small>STILL SHORT THIS WEEK</small><b>{floorShort} <span>shifts</span></b></div>
        <Link to="/admin/availability" className="k"><small>AVAILABILITY ANSWERS</small><b>{answers} <span>said yes</span></b></Link>
        <Link to="/admin/hours" className={'k' + (missing ? ' amber' : '')}><small>HOURS TO REVIEW</small><b>{missing} <span>missing end times</span></b></Link>
      </div>

      <div className="two-col">
        <section className="stack">
          <div className="sec"><span className="serif">Tonight</span><Link to={`/admin/day?d=${today}`}>Open day view ›</Link></div>
          {week === null && <div className="muted">Loading…</div>}
          {week && !tonight.length && <div className="adm-card muted">No events today.</div>}
          {tonight.map((e) => <Live key={e.id} e={e} />)}
        </section>
        <section className="stack">
          <div className="sec"><span className="serif">Needs you</span><b className="accent">{needs.length || ''}</b></div>
          <div className="adm-card" style={{ padding: '4px 16px' }}>
            {!needs.length && <div className="muted sm" style={{ padding: '12px 0' }}>All clear.</div>}
            {needs.slice(0, 10).map((x) => (
              <div key={x.key} className="need">
                <span className="dotr" />
                <div className="grow"><b className={x.red ? 'accent' : ''}>{x.title}</b><span>{x.sub}</span></div>
                <Link to={x.to} className="abtn sm">{x.action} ›</Link>
              </div>
            ))}
          </div>
          <div className="sec"><span className="serif">This week</span><Link to="/admin/week">Week ›</Link></div>
          <div className="strip">
            {weekDays.map((d) => {
              const evs = (week ?? []).filter((e) => e.event_date === d);
              const staff = evs.reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0);
              const short = evs.some((e) => e.department !== 'bar' && e.shifts.filter((s) => s.status !== 'declined').length < e.staff_needed);
              return (
                <Link key={d} to={`/admin/day?d=${d}`} className={'sd' + (d === today ? ' on' : '') + (short && d >= today ? ' short' : '')}>
                  <small>{dLabel(d, { weekday: 'short' }).toUpperCase()}</small><b>{Number(d.slice(8))}</b><span>{evs.length ? `${evs.length} · ${staff}` : '–'}</span>
                </Link>
              );
            })}
          </div>
          <div className="muted sm">events · staff booked. Amber = still short.</div>
        </section>
      </div>
    </div>
  );
}

function Live({ e }: { e: AEvent }) {
  const team = e.shifts.filter((s) => s.status !== 'declined');
  const working = team.filter((s) => s.punches?.punch_in && !s.punches.punch_out).length;
  const done = team.filter((s) => s.punches?.punch_out).length;
  const late = team.filter((s) => !s.attendance && !s.punches?.punch_in && new Date(s.planned_start).getTime() < Date.now()).length;
  const flags = team.filter((s) => s.attendance).length;
  const md = team.find((s) => s.position_code === 'MD');
  const startsIn = Math.round((new Date(team[0]?.planned_start ?? 0).getTime() - Date.now()) / 60000);
  return (
    <div className="adm-card stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <div className="grow" style={{ minWidth: 180 }}><div className="serif" style={{ fontSize: 22 }}>{e.title}</div>
          <div className="muted sm">{e.department === 'bar' ? 'Bar' : 'Floor'} · {ap(e.start_time) || 'TBC'}{e.end_time ? ` · ends ~ ${ap(e.end_time)}` : ''}{md ? ` · MD ${md.staff?.full_name.split(' ')[0]}` : ''}</div></div>
        <span className={'tag ' + (team.length >= e.staff_needed ? 'ok' : 'amber')}>{team.length} / {e.staff_needed} booked</span>
        {startsIn > 0 ? <span className="tag">starts in {Math.floor(startsIn / 60)} h {startsIn % 60} min</span>
          : <span className="tag ok">● {working} working{done ? ` · ${done} done` : ''}</span>}
        {late > 0 && <span className="tag red">{late} late</span>}
        {flags > 0 && <span className="tag red">{flags} no-show / cancel</span>}
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {[...team].sort((a, b) => (a.position_code === 'MD' ? -1 : 0) - (b.position_code === 'MD' ? -1 : 0)).slice(0, 10).map((s) => {
          const st = s.attendance ? 'x' : s.punches?.punch_out ? 'done' : s.punches?.punch_in ? 'in' : new Date(s.planned_start).getTime() < Date.now() ? 'late' : '';
          return <span key={s.id} className={'pchip ' + st}><i>{s.position_code === 'MD' ? 'MD' : s.position_code ?? '·'}</i>{s.staff?.full_name}</span>;
        })}
        {team.length > 10 && <span className="muted sm">+ {team.length - 10} more</span>}
      </div>
      <div className="row"><Link className="abtn sm" to={`/manage/${e.id}`}>Open event</Link><Link className="abtn sm" to={`/admin/event/${e.id}`}>Details</Link></div>
    </div>
  );
}

const ap = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
