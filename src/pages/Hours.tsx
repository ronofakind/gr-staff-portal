import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { TabBar } from '../components/TabBar';
import { AskHours, todayIso } from './Home';
import { payPeriod, shiftPeriod, payDay, payDayLabel, periodLabel, paidHours, workedHours } from '../lib/hours';

type P = { punch_in: string | null; punch_out: string | null } | null;
type Row = { id: string; planned_start: string; attendance: string | null; left_early: boolean | null; punches: P;
  events: { id: string; title: string; event_date: string; hours_submitted_at: string | null; manager_id: string | null; transport?: boolean; paid_travel_min?: number | null } };
type Q = { id: string; shift_id: string; kind: 'start' | 'end' | 'other'; claimed_at: string | null; note: string | null; status: 'open' | 'fixed' | 'correct'; answer_note: string | null; created_at: string };
type Team = { id: string; title: string; event_date: string; hours_submitted_at: string | null; shifts: { attendance: string | null; left_early: boolean | null; punches: P; staff: { full_name: string } | null }[] };

const D = (iso: string) => new Date(iso + 'T12:00:00');
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const one = (p: P | P[]) => (Array.isArray(p) ? p[0] ?? null : p);
const fmtH = (h: number) => String(Math.round(h * 100) / 100);

/** Staff / manager: hours per pay period (push 22). Approved = the manager submitted the team's hours. */
export function Hours({ me }: { me: Staff }) {
  const today = todayIso();
  const [per, setPer] = useState(payPeriod(today));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [qs, setQs] = useState<Record<string, Q>>({});
  const [view, setView] = useState<'mine' | 'past' | 'teams'>('mine');
  const [open, setOpen] = useState<Row | null>(null); const [ask, setAsk] = useState<Row | null>(null);
  const [teams, setTeams] = useState<Team[] | null>(null); const [team, setTeam] = useState<Team | null>(null);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const isMgr = me.role === 'manager' || me.role === 'admin';

  const load = async () => {
    const from = per.start < yearStart ? per.start : yearStart;
    const { data } = await supabase.from('shifts').select('id,planned_start,attendance,left_early,punches(punch_in,punch_out),events!inner(id,title,event_date,hours_submitted_at,manager_id,transport,paid_travel_min)')
      .eq('staff_id', me.id).neq('status', 'declined').gte('events.event_date', from).lte('events.event_date', today);
    const list = ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, punches: one(r.punches as P | P[]) }));
    setRows(list);
    const ids = list.map((r) => r.id);
    if (ids.length) {
      const { data: q } = await supabase.from('hours_questions').select('id,shift_id,kind,claimed_at,note,status,answer_note,created_at').in('shift_id', ids).order('created_at');
      setQs(Object.fromEntries(((q ?? []) as Q[]).map((x) => [x.shift_id, x])));
    }
  };
  useEffect(() => { load(); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (view !== 'teams') return;
    setTeams(null);
    supabase.from('events').select('id,title,event_date,hours_submitted_at,shifts(attendance,left_early,punches(punch_in,punch_out),staff:staff!shifts_staff_id_fkey(full_name))')
      .eq('manager_id', me.id).gte('event_date', per.start).lte('event_date', per.end < today ? per.end : today).order('event_date', { ascending: false })
      .then(({ data }) => setTeams(((data ?? []) as unknown as Team[]).map((t) => ({ ...t, shifts: t.shifts.map((s) => ({ ...s, punches: one(s.punches as P | P[]) })) }))));
  }, [view, per.start, me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = (r: Row) => !r.attendance && !!r.punches?.punch_in && !!r.punches.punch_out && new Date(r.punches.punch_out).getTime() <= Date.now();
  const travelOf = (r: Row) => (r.events.transport ? (r.events.paid_travel_min ?? 0) / 60 : 0);
  const hoursOf = (r: Row) => paidHours(r.punches!.punch_in!, r.punches!.punch_out!, !!r.left_early) + travelOf(r);
  const inPer = (p: { start: string; end: string }) => (rows ?? []).filter((r) => r.events.event_date >= p.start && r.events.event_date <= p.end && done(r)).sort((a, b) => b.planned_start.localeCompare(a.planned_start));
  const shifts = inPer(per);
  const total = shifts.reduce((n, r) => n + hoursOf(r), 0);
  const approved = shifts.filter((r) => r.events.hours_submitted_at).length;
  const questions = shifts.filter((r) => qs[r.id]?.status === 'open').length;
  const isCurrent = per.start === payPeriod(today).start;
  const past = useMemo(() => { const out: { p: { start: string; end: string }; h: number; n: number }[] = []; let p = payPeriod(today);
    for (let i = 0; i < 24 && p.end >= yearStart; i++) { const l = inPer(p); out.push({ p, h: l.reduce((n, r) => n + hoursOf(r), 0), n: l.length }); p = shiftPeriod(p, -1); }
    return out; }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const year = past.reduce((n, x) => n + x.h, 0); const yearN = past.reduce((n, x) => n + x.n, 0);
  const maxH = Math.max(1, ...past.slice(0, 8).map((x) => x.h));

  const tag = (r: Row) => { const q = qs[r.id];
    if (q?.status === 'open') return <span className="hz-tag red">QUESTION SENT</span>;
    if (q?.status === 'fixed') return <span className="hz-tag ok">✓ FIXED</span>;
    if (q?.status === 'correct') return <span className="hz-tag grey">CHECKED</span>;
    return r.events.hours_submitted_at ? <span className="hz-tag ok">APPROVED</span> : <span className="hz-tag gold">WAITING</span>; };
  const special = (r: Row) => { const w = workedHours(r.punches!.punch_in!, r.punches!.punch_out!);
    if (travelOf(r)) return `+${fmtH(travelOf(r))} h travel${r.left_early ? ' · left early' : w < 4 ? ' · 4-hour minimum' : ''}`;
    if (r.left_early) return 'Left early · real hours';
    if (w < 4) return `4-hour minimum (worked ${fmtH(w)} h)`;
    if (!r.events.hours_submitted_at) return 'Manager hasn’t submitted yet';
    return ''; };
  const qLine = (r: Row) => { const q = qs[r.id]; if (!q) return null;
    const said = q.kind === 'other' ? (q.note ?? '') : `You said you ${q.kind === 'start' ? 'started' : 'ended'} at ${q.claimed_at ? t12(q.claimed_at) : '?'}${q.note ? ` · “${q.note}”` : ''}`;
    if (q.status === 'open') return <div className="hz-q red">{said}<small>Sent {t12(q.created_at)} · Ronnie will check</small></div>;
    return <div className={'hz-q ' + (q.status === 'fixed' ? 'ok' : 'grey')}>{q.status === 'fixed' ? '✓ Fixed by Ronnie' : 'Checked · your hours are correct as recorded.'}{q.answer_note && <i>“{q.answer_note}”</i>}</div>; };
  const dow = (iso: string) => D(iso).toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '').toUpperCase();

  return (
    <main className="page v2 hz">
      <div style={{ padding: '18px 6px 0' }}>
        <div className="kicker">My hours{view === 'teams' ? ' · manager' : ''}</div>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05 }}>{view === 'past' ? 'Past pay periods' : 'Hours'}</div>
        {view === 'past' && <div className="muted sm">{today.slice(0, 4)} so far · {fmtH(year)} h · {yearN} shifts</div>}
      </div>
      {isMgr && view !== 'past' && <div className="seg"><button className={view === 'mine' ? 'on' : ''} onClick={() => setView('mine')}>My hours</button><button className={view === 'teams' ? 'on' : ''} onClick={() => setView('teams')}>Teams I managed</button></div>}

      {view !== 'past' && <div className="hz-per">
        <button className="round" aria-label="Previous pay period" onClick={() => setPer(shiftPeriod(per, -1))}>‹</button>
        <div className="grow"><b>{periodLabel(per)}</b><small>{isCurrent ? 'current pay period' : `paid ${payDayLabel(per)}`}</small></div>
        <button className="round" aria-label="Next pay period" disabled={isCurrent} onClick={() => setPer(shiftPeriod(per, 1))}>›</button>
      </div>}

      {rows === null ? <div className="loading" style={{ minHeight: 200 }} /> : view === 'mine' ? <>
        <section className="hz-big">
          <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div><small>HOURS THIS PAY PERIOD</small><div className="serif hz-num">{fmtH(total)}<span> h</span></div></div>
            <div style={{ textAlign: 'right' }}><div><b>{shifts.length}</b> shift{shifts.length === 1 ? '' : 's'}</div><div className="hz-paid">{payDay(per) <= today ? '✓ Paid' : 'Paid'} {payDayLabel(per)}</div></div>
          </div>
          {shifts.length > 0 && <div className="row wrap" style={{ gap: 6 }}>
            {approved > 0 && <span className="hz-chip ok">✓ {approved} approved</span>}
            {shifts.length - approved > 0 && <span className="hz-chip gold">⏳ {shifts.length - approved} waiting</span>}
            {questions > 0 && <span className="hz-chip red">? {questions} question{questions > 1 ? 's' : ''}</span>}
          </div>}
        </section>
        <div className="sec-head"><span className="serif">Shifts</span><span className="muted sm">{shifts.length}</span></div>
        <section className="stack" style={{ gap: 8 }}>
          {!shifts.length && <div className="card muted sm">No hours in this pay period yet.</div>}
          {shifts.map((r) => (
            <button key={r.id} className={'hz-row' + (qs[r.id]?.status === 'open' ? ' asked' : '')} onClick={() => setOpen(r)}>
              <div className="hz-d"><small>{dow(r.events.event_date)}</small><b className="serif">{D(r.events.event_date).getDate()}</b></div>
              <div className="grow" style={{ minWidth: 0, textAlign: 'left' }}><b>{r.events.title}</b><span>{t12(r.punches!.punch_in!)} – {t12(r.punches!.punch_out!)}</span>{special(r) && !qs[r.id] && <em>{special(r)}</em>}</div>
              <div style={{ textAlign: 'right' }}><div className="serif hz-h">{fmtH(hoursOf(r))}<span> h</span></div>{tag(r)}</div>
              {qLine(r) && <div className="hz-qwrap">{qLine(r)}</div>}
            </button>
          ))}
        </section>
        <p className="muted sm" style={{ margin: '4px 6px' }}>Hours are rounded to 15 min · minimum 4 h per shift (except left early) · paid start = call time · paid on the 1st and the 16th.</p>
        <button className="link-btn" style={{ alignSelf: 'flex-start', margin: '0 6px' }} onClick={() => setView('past')}>Past pay periods ›</button>
      </> : view === 'past' ? <>
        <section className="card hz-chart">{past.slice(0, 8).reverse().map((x) => (
          <button key={x.p.start} onClick={() => { setPer(x.p); setView('mine'); }}><i style={{ height: `${Math.max(4, (x.h / maxH) * 90)}px` }} className={x.p.start === payPeriod(today).start ? 'cur' : ''} /><small>{D(x.p.start).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }).replace('.', '')}</small></button>
        ))}</section>
        <section className="stack" style={{ gap: 8 }}>
          {past.filter((x) => x.n > 0 || x.p.start === payPeriod(today).start).map((x) => { const cur = x.p.start === payPeriod(today).start; const paid = payDay(x.p) <= today; return (
            <button key={x.p.start} className="hz-row" onClick={() => { setPer(x.p); setView('mine'); }}>
              <div className="grow" style={{ textAlign: 'left' }}><b>{periodLabel(x.p)}</b><span>{x.n} shift{x.n === 1 ? '' : 's'} · paid {payDayLabel(x.p)}</span></div>
              <div className="serif hz-h">{fmtH(x.h)}<span> h</span></div>
              <span className={'hz-tag ' + (cur ? 'gold' : paid ? 'ok' : 'gold')}>{cur ? 'IN PROGRESS' : paid ? '✓ PAID' : 'NOT PAID YET'}</span>
            </button>); })}
        </section>
        <button className="link-btn" style={{ alignSelf: 'flex-start', margin: '0 6px' }} onClick={() => setView('mine')}>‹ Back to this pay period</button>
      </> : <>
        <section className="stack" style={{ gap: 8 }}>
          {teams === null ? <div className="loading" style={{ minHeight: 120 }} /> : !teams.length ? <div className="card muted sm">No teams you managed in this pay period.</div> : teams.map((t) => {
            const crew = t.shifts.filter((s) => !s.attendance && s.punches?.punch_in);
            const endedN = crew.filter((s) => s.punches?.punch_out && new Date(s.punches.punch_out).getTime() <= Date.now()).length;
            const h = crew.filter((s) => s.punches?.punch_out).reduce((n, s) => n + paidHours(s.punches!.punch_in!, s.punches!.punch_out!, !!s.left_early), 0);
            return (
              <button key={t.id} className="hz-row" onClick={() => setTeam(t)}>
                <div className="hz-d"><small>{dow(t.event_date)}</small><b className="serif">{D(t.event_date).getDate()}</b></div>
                <div className="grow" style={{ textAlign: 'left' }}><b>{t.title}</b><span>{crew.length} people · {fmtH(h)} h · {t.hours_submitted_at ? `submitted ${t12(t.hours_submitted_at)}` : `${endedN} ended${crew.length - endedN ? ` · ${crew.length - endedN} still working` : ''}`}</span></div>
                {t.hours_submitted_at ? <span className="hz-tag ok">✓ SENT</span> : <span className="hz-tag red">SUBMIT</span>}
              </button>); })}
        </section>
        <p className="muted sm" style={{ margin: '4px 6px' }}>Tap a team to see the hours per person. Once sent, changes go through Ronnie.</p>
      </>}

      {open && (() => { const r = open; const w = workedHours(r.punches!.punch_in!, r.punches!.punch_out!); const q = qs[r.id]; return (<>
        <div className="scrim" onClick={() => setOpen(null)} />
        <div className="sheet swipe" role="dialog" aria-label="Shift hours">
          <button className="sheet-x" aria-label="Close" onClick={() => setOpen(null)}>✕</button>
          <div><div className="kicker">{D(r.events.event_date).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '').toUpperCase()} · {r.events.title.toUpperCase()}</div>
            <div className="serif" style={{ fontSize: 26 }}>{fmtH(hoursOf(r))} hours</div></div>
          <div className="card hz-break">
            <div><span>Call time</span><b>{t12(r.planned_start)}</b></div>
            <div><span>Started</span><b>{t12(r.punches!.punch_in!)}</b></div>
            <div><span>Ended</span><b>{t12(r.punches!.punch_out!)}</b></div>
            <div><span>Worked</span><b>{Math.floor(w)} h {Math.round((w % 1) * 60)} min</b></div>
            {travelOf(r) > 0 && <div><span>Travel time (paid)</span><b>+{fmtH(travelOf(r))} h</b></div>}
            <div><span>Paid hours</span><b className="okc">{fmtH(hoursOf(r))} h{r.left_early ? ' · left early' : w < 4 ? ' · 4-hour minimum' : ''}</b></div>
          </div>
          {!r.events.hours_submitted_at && <div className="hz-wait">⏳ Waiting for your manager to submit the team’s hours. They lock once submitted.</div>}
          {qLine(r)}
          {!q || q.status !== 'open' ? <button className="btn-ghost" style={{ height: 48 }} onClick={() => { setAsk(r); setOpen(null); }}>Something wrong with these hours?</button> : null}
          <div className="muted sm" style={{ textAlign: 'center' }}>Goes to Ronnie.</div>
        </div>
      </>); })()}

      {team && (<>
        <div className="scrim" onClick={() => setTeam(null)} />
        <div className="sheet swipe" role="dialog" aria-label="Team hours">
          <button className="sheet-x" aria-label="Close" onClick={() => setTeam(null)}>✕</button>
          <div><div className="kicker">{D(team.event_date).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '').toUpperCase()}</div><div className="serif" style={{ fontSize: 26, paddingRight: 44 }}>{team.title}</div></div>
          <div className="card hz-break">{team.shifts.filter((s) => !s.attendance && s.punches?.punch_in).sort((a, b) => (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? '')).map((s, i) => (
            <div key={i}><span>{s.staff?.full_name}</span><b>{s.punches?.punch_out ? `${t12(s.punches.punch_in!)} – ${t12(s.punches.punch_out)} · ${fmtH(paidHours(s.punches.punch_in!, s.punches.punch_out, !!s.left_early))} h` : 'still working'}</b></div>))}</div>
          {team.hours_submitted_at ? <div className="muted sm">Submitted {t12(team.hours_submitted_at)}. Changes go through Ronnie.</div>
            : <Link className="btn-ink" style={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }} to={`/manage/${team.id}`}>Open the team · submit hours ›</Link>}
        </div>
      </>)}

      {ask && <AskHours s={{ id: ask.id, events: { title: ask.events.title }, punches: ask.punches }} onClose={() => setAsk(null)} onSent={() => { setAsk(null); load(); }} />}
      <TabBar />
    </main>
  );
}
