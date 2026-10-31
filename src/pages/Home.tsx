import { QuarterTime } from '../components/QuarterTime';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, SHIFT_SELECT, isSetup, type ShiftRow, type Staff } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { time, longDate, dayBadge, minus } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { TabBar } from '../components/TabBar';
import { AskCards, useAsks } from '../components/AskCards';
import { UniformIcon, uniformFor, uniformLabel } from '../components/Uniform';
import { AnnounceCards } from '../components/Announce';
import { NeedChange, CancelSheet, ChangeSheet, LateSheet, LateBlock, ChangeCard, CancelledCard, useShiftChanges, t12 as t12c, type LateNotice } from '../components/ShiftChange';

type MgrLate = { id: string; shift_id: string; event_id: string; name: string; eta: string; reason: string | null; note?: string | null };
type Gone = { id: string; title: string; date: string; late: boolean };
const OK_KEY = 'gr-cancel-ok';
const readOk = (): string[] => { try { return JSON.parse(localStorage.getItem(OK_KEY) || '[]'); } catch { return []; } };

type Mate = { full_name: string; photo_url: string | null; position_code: string | null; position_detail: string | null; punches: { punch_in: string | null; punch_out: string | null } | null };
type Q = { shift_id: string; status: 'open' | 'fixed' | 'correct' };
const q15 = (iso: string) => new Date(Math.round(new Date(iso).getTime() / 900000) * 900000).toISOString();
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const range = (a: string, b: string) => { const x = t12(q15(a)), y = t12(q15(b)); return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)} – ${y}` : `${x} – ${y}`; };
const hrs = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 900000) / 4;
export const isBar = (code: string | null, detail: string | null) => /^(BM|BT|BB)$/.test(code ?? '') || /^bar\b/i.test(detail ?? '');
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const addDay = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export function Home({ me, base = '', preview = false }: { me: Staff; base?: string; preview?: boolean }) {
  const lang = useLang(); const nav = useNavigate();
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [teams, setTeams] = useState<Record<string, Mate[]>>({});
  const [qs, setQs] = useState<Record<string, Q['status']>>({});
  const [askQ, setAskQ] = useState<ShiftRow | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; kind: string; title: string; body: string | null; event_id: string | null }[]>([]);
  // push 28
  const [sheet, setSheet] = useState<{ kind: 'cancel' | 'change' | 'late'; s: ShiftRow } | null>(null);
  const [gone, setGone] = useState<Gone[]>([]); const [okd, setOkd] = useState<string[]>(readOk);
  const [mgrLate, setMgrLate] = useState<MgrLate[]>([]);

  const load = async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const { data } = await supabase.from('shifts').select(SHIFT_SELECT + ',punches(punch_in,punch_out)')
      .eq('staff_id', me.id).neq('status', 'declined').gte('planned_start', since)
      .order('planned_start').limit(30);
    const all = (data as unknown as ShiftRow[]) ?? [];
    const rows = all.filter((r) => r.attendance !== 'cancelled'); // push 28: a cancelled shift is off Home
    setShifts(rows);
    // push 28 · "Shift cancelled · Ronnie has been told" for 24 h (cancelled_at is new in 034: errors → none)
    const cut = new Date(Date.now() - 24 * 3600e3).toISOString();
    supabase.from('shifts').select('id,cancelled_at,cancel_late,events(title,event_date)').eq('staff_id', me.id).eq('cancel_self', true).gte('cancelled_at', cut)
      .then(({ data: g, error }) => { if (!error && Array.isArray(g)) setGone((g as unknown as { id: string; cancel_late: boolean; events: { title: string; event_date: string } | null }[]).filter((x) => x?.events).map((x) => ({ id: x.id, title: x.events!.title, date: x.events!.event_date, late: !!x.cancel_late }))); });
    if (rows.length) supabase.from('hours_questions').select('shift_id,status').in('shift_id', rows.map((r) => r.id)).order('created_at')
      .then(({ data: q }) => setQs(Object.fromEntries(((q ?? []) as Q[]).map((x) => [x.shift_id, x.status]))));
    const managed = [...new Set(rows.filter((r) => r.events.manager_id === me.id || r.position_code === 'MD' || r.position_code === 'BM').map((r) => r.events.id))];
    if (managed.length) {
      const { data: crew, error: cErr } = await supabase.from('shifts').select('id,event_id,position_code,position_detail,attendance,staff:staff!shifts_staff_id_fkey(full_name,photo_url),punches(punch_in,punch_out)')
        .in('event_id', managed).neq('status', 'declined').order('planned_start');
      if (cErr) console.warn('[team]', cErr.message);
      const map: typeof teams = {};
      const crewRows = (crew ?? []) as unknown as { id: string; event_id: string; position_code: string | null; position_detail: string | null; attendance: string | null; staff: { full_name: string; photo_url: string | null }; punches: Mate['punches'] }[];
      for (const c of crewRows) {
        if (c.attendance) continue;
        (map[c.event_id] ??= []).push({ ...c.staff, position_code: c.position_code, position_detail: c.position_detail, punches: c.punches });
      }
      setTeams(map);
      // push 28e · running-late alerts land on the manager Home (Working now card) until Got it
      const waiting = crewRows.filter((c) => !c.attendance && !c.punches?.punch_in);
      if (waiting.length) supabase.from('late_notices').select('id,shift_id,eta,reason,note,seen_at').in('shift_id', waiting.map((c) => c.id)).is('seen_at', null)
        .then(({ data: ln, error }) => { if (error || !Array.isArray(ln)) return; setMgrLate((ln as { id: string; shift_id: string; eta: string; reason: string | null; note?: string | null }[]).map((n) => { const c = waiting.find((x) => x.id === n.shift_id)!; return { ...n, event_id: c.event_id, name: c.staff.full_name }; })); });
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    supabase.from('staff_alerts').select('id,kind,title,body,event_id').eq('staff_id', me.id).is('seen_at', null).order('created_at')
      .then(({ data }) => setAlerts((data ?? []) as typeof alerts));
  }, [me.id]);
  const gotIt = async (id: string) => { setAlerts(alerts.filter((a) => a.id !== id)); if (!preview) await supabase.rpc('alert_seen', { p_id: id }); };
  const { asks, week: usualWeek, reload: reloadAsks } = useAsks(me.id);
  const upcomingIds = (shifts ?? []).filter((s) => !(s.punches?.punch_out && new Date(s.punches.punch_out).getTime() <= Date.now())).map((s) => s.id);
  const chg = useShiftChanges(preview ? [] : upcomingIds);
  const mgrGotIt = async (id: string) => { setMgrLate((v) => v.filter((x) => x.id !== id)); if (!preview) await supabase.rpc('late_notice_seen', { p_id: id }); };
  const okGone = (id: string) => { const v = [...okd, id]; setOkd(v); try { localStorage.setItem(OK_KEY, JSON.stringify(v.slice(-50))); } catch { /* private mode */ } };

  const respond = async (id: string, r: 'confirmed' | 'declined') => {
    if (preview) return;
    await supabase.rpc('respond_to_shift', { p_shift: id, p_response: r });
    load();
  };

  if (!shifts) return <div className="loading" />;
  const isDone = (s: ShiftRow) => !!s.punches?.punch_in && !!s.punches.punch_out && new Date(s.punches.punch_out).getTime() <= Date.now();
  const doneToday = shifts.filter((s) => isDone(s) && s.events.event_date === todayIso());
  const [next, ...rest] = shifts.filter((s) => !isDone(s));
  const pending = shifts.filter((s) => s.status === 'booked' && !s.events.details_pending);
  const soon = (s: ShiftRow) => !!s.events.details_pending;
  // Dates they said yes to that G&R hasn't booked (yet)
  const bookedDates = new Set(shifts.map((s) => s.events.event_date));
  const saidYes = (asks ?? []).filter((a) => a.status === 'yes' && a.for_date >= todayIso() && !bookedDates.has(a.for_date));
  const first = me.nickname || me.full_name.split(' ')[0];
  const today = todayIso();

  const whenLabel = (s: ShiftRow) => {
    const d = s.events.event_date;
    const day = d === today ? 'Today' : d === addDay(today, 1) ? 'Tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long' });
    const h = Math.round((new Date(minus(s.planned_start, s.arrive_before_min)).getTime() - Date.now()) / 3600e3);
    return `${day}${h > 0 && h < 48 ? ` · in ${h} h` : ''}`;
  };
  const isLead = (s: ShiftRow) => s.position_code === 'MD' || s.position_code === 'BM';
  const role = (s: ShiftRow) => s.position_code === 'MD' ? 'MD' : s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : isBar(s.position_code, null) ? 'Bar' : 'Waiter';

  return (
    <main className="page v2">
      <header className="v2-head">
        <img className="logo" src="/logo-mark.png" alt="G&R" />
        <div className="hello"><b>Hi {first}</b><span>{longDate(today, lang)}</span></div>
        {!preview ? <Link to="/profile" aria-label="My profile"><Avatar name={me.full_name} url={me.photo_url} size={38} /></Link> : <Avatar name={me.full_name} url={me.photo_url} size={38} />}
      </header>

      {alerts.map((a) => (
        <div key={a.id} className="alert-card">
          <div className="grow"><small>{a.kind === 'removed' ? 'SCHEDULE CHANGE' : a.kind === 'booked' ? 'NEW SHIFT' : 'SHIFT CHANGED'}</small><b>{a.title}</b>{a.body && <span>{a.body}</span>}</div>
          <button className="pill-red" onClick={() => gotIt(a.id)}>Got it</button>
        </div>
      ))}

      {gone.filter((g) => !okd.includes(g.id)).map((g) => <CancelledCard key={g.id} title={g.title} date={g.date} late={g.late} onOk={() => okGone(g.id)} />)}

      {!preview && <AnnounceCards meId={me.id} />}

      <AskCards asks={asks} week={usualWeek} preview={preview} onlyWaiting onAnswered={reloadAsks} />

      {pending.map((s) => (
        <div key={s.id} className="todo">
          <div className="grow">
            <b>{pending.length > 1 ? 'Shift needs your answer' : '1 shift needs your answer'}</b>
            <span>{dayBadge(s.events.event_date, lang).dow} {dayBadge(s.events.event_date, lang).day} · {s.events.title} · {s.time_tbc ? 'time TBC' : time(s.planned_start, lang)} · {role(s)}</span>
          </div>
          <div className="row">
            <button className="pill-line" onClick={() => respond(s.id, 'declined')}>Can't</button>
            <button className="pill-red" onClick={() => respond(s.id, 'confirmed')}>Confirm</button>
          </div>
        </div>
      ))}

      {doneToday.map((s) => {
        const team = teams[s.events.id];
        if (team && !preview) {
          const ended = team.every((m) => m.punches?.punch_out && new Date(m.punches.punch_out).getTime() <= Date.now());
          const total = team.reduce((n, m) => n + (m.punches?.punch_in && m.punches.punch_out ? hrs(m.punches.punch_in, m.punches.punch_out) : 0), 0);
          const sub = s.events.hours_submitted_at;
          return sub ? (
            <div key={s.id} className="done-card mgr">
              <span className="ck">✓</span>
              <div className="grow"><small>YOU MANAGED · {s.events.title.toUpperCase()}</small><b>Hours submitted {t12(sub)}</b><span>{team.length} people · {total} h · you {hrs(s.punches!.punch_in!, s.punches!.punch_out!)} h</span>
                <span className="row" style={{ gap: 14 }}><Link to={`/manage/${s.events.id}`} className="done-link">Open team · fix &amp; resubmit ›</Link><Link to={`${base}/shift/${s.id}`} className="done-link">Details ›</Link></span></div>
            </div>
          ) : (
            <div key={s.id} className="done-card warn mgr-pending">
              <div className="grow"><small>TODAY · YOU MANAGE</small><b className="serif" style={{ fontSize: 24, fontWeight: 500 }}>{s.events.title}</b>
                <span>You ended {time(s.punches!.punch_out!, lang)} · {ended ? `${team.length} people · ${total} h · hours not submitted` : `${team.filter((m) => !(m.punches?.punch_out && new Date(m.punches.punch_out).getTime() <= Date.now())).length} still working · hours not submitted`}</span>
                <div className="row2" style={{ marginTop: 10 }}><Link className="light-btn" style={{ height: 44, borderRadius: 14, background: '#fff' }} to={`${base}/shift/${s.id}`}>Details</Link><Link className="team-btn" style={{ height: 44 }} to={`/manage/${s.events.id}`}>Team · submit ›</Link></div></div>
            </div>
          );
        }
        const st = qs[s.id];
        return (
          <div key={s.id} className="done-card">
            <span className="ck">✓</span>
            <div className="grow">
              <small>DONE {s.events.event_date === todayIso() ? 'TONIGHT' : ''} · {s.events.title.toUpperCase()}</small>
              <div className="ln"><span className="serif">{range(s.punches!.punch_in!, s.punches!.punch_out!)}</span><b>{hrs(s.punches!.punch_in!, s.punches!.punch_out!)} h</b></div>
              <div className="ln sm"><span>Thanks, {first}!</span>
                {st === 'open' ? <span className="gold">Question sent ✓ · waiting</span>
                  : st === 'fixed' ? <span className="okc">Fixed ✓</span>
                  : st === 'correct' ? <span className="muted">Checked, it’s correct</span>
                  : <button className="done-link" onClick={() => !preview && setAskQ(s)}>Something wrong? ›</button>}
                <Link to={`${base}/shift/${s.id}`} className="done-link">Details ›</Link></div>
            </div>
          </div>
        );
      })}

      {!next && !doneToday.length && <div className="card"><p className="muted" style={{ margin: 0 }}>No shifts booked yet.</p></div>}

      {next && (() => {
        const addr = next.events.address || next.events.venues?.address || '';
        const team = teams[next.events.id];
        const dayWord = next.events.event_date === today ? 'Today' : next.events.event_date === addDay(today, 1) ? 'Tomorrow'
          : new Date(next.events.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' });
        const working = !!next.punches?.punch_in && new Date(next.punches.punch_in).getTime() <= Date.now();
        // push 28 · bubbles until the shift starts; running late all day on the event day until they're started
        const started = !!next.punches?.punch_in || Date.now() >= new Date(next.planned_start).getTime();
        const managesIt = !!team && !preview;
        const lateOn = next.events.event_date === today && !next.punches?.punch_in && !managesIt && !next.time_tbc;
        const req = chg.reqs[next.id];
        const mgrName = next.events.manager?.full_name ?? null;
        const myAlerts = mgrLate.filter((x) => x.event_id === next.events.id);
        if (soon(next)) return (
          <section className="next soon" style={{ gap: 12, padding: 18 }}>
            <div className="top-line"><span className="day-word">NEXT · {dayWord.toUpperCase()}</span><span className="soon-tag">DETAILS COMING</span></div>
            <div><div className="venue serif" style={{ fontSize: 26 }}>You’re on for {dayWord === 'Today' || dayWord === 'Tomorrow' ? dayWord.toLowerCase() : dayWord.split(',')[0]}</div>
              <div className="sub" style={{ whiteSpace: 'normal' }}>G&R has you that day as <b>{role(next)}</b>. The place and time are coming — you’ll get a notice to confirm once they’re set.</div></div>
            <div className="row2">
              <div className="tbox start"><small>Where</small><span className="big serif sm-big">To come</span></div>
              <div className="tbox"><small>Shift starts</small><span className="big serif sm-big">To come</span></div>
            </div>
            <div className="sub" style={{ textAlign: 'center' }}>Keep the day free · nothing to do for now</div>
          </section>
        );
        return (
          <section className={'next' + (working ? ' working' : '')} style={{ gap: 14, padding: 18 }}>
            <div className="top-line">
              <span className="day-word">{working ? '● WORKING NOW' : dayWord.toUpperCase()}</span>
              {working ? <span className="countdown">started {time(next.punches!.punch_in!, lang)}</span> : !next.time_tbc && <Countdown iso={minus(next.planned_start, next.arrive_before_min)} start={next.planned_start} />}
            </div>
            <div className="spread" style={{ alignItems: 'flex-end' }}>
              <div style={{ minWidth: 0 }}>
                <div className="venue serif">{next.events.title}</div>
                {addr && <div className="sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr.split(',').slice(0, 2).join(' ·')}</div>}
              </div>
              {!isSetup(next.events) && <span className="wear-tile" style={{ width: 52, height: 52, borderRadius: 14 }} title={uniformLabel(uniformFor(next))}><UniformIcon kind={uniformFor(next)} size={38} /></span>}
            </div>
            <div className="pos-line"><small>Your position</small><span className="pos-pill-lg">{role(next)}</span></div>
            <div className="row2">
              <div className="tbox start"><small>Shift starts</small>{next.time_tbc ? <span className="big serif sm-big">TBC</span> : <BigTime iso={next.planned_start} small />}</div>
              {!isSetup(next.events) && <div className="tbox"><small>Be there</small>{next.time_tbc ? <span className="big serif sm-big">TBC</span> : <><BigTime iso={minus(next.planned_start, next.arrive_before_min)} small /><span className="tb-note">{next.arrive_before_min} min before</span></>}</div>}
            </div>
            {myAlerts.map((a) => (
              <div key={a.id} className="mgr-late"><span className="grow">⏱ <b>{a.name.split(' ')[0]} running late</b> · ~{t12c(a.eta).replace(/\s?[AP]M$/, '')}{a.reason ? ` · ${a.reason.toLowerCase()}` : ''}{a.note ? ` · “${a.note}”` : ''}</span>
                <button onClick={() => mgrGotIt(a.id)}>Got it ✓</button></div>
            ))}
            {lateOn && <LateBlock notice={chg.late[next.id] ?? null} mgr={mgrName} mgrPhone={next.events.manager?.phone} onOpen={() => setSheet({ kind: 'late', s: next })} />}
            <div className="row2">
              <Link className="light-btn" style={{ height: 46, borderRadius: 14 }} to={`${base}/shift/${next.id}`}>Details</Link>
              {team && !preview
                ? <Link className="team-btn" to={`/manage/${next.events.id}`}>My team · {team.length} ›</Link>
                : next.status === 'confirmed' ? <span className="light-btn" style={{ height: 46, borderRadius: 14, background: '#2A2521', color: '#9FD8B8' }}>✓ Confirmed</span>
                : <button className="team-btn" style={{ border: 'none' }} onClick={() => respond(next.id, 'confirmed')}>Confirm</button>}
            </div>
            {!started && !managesIt && <NeedChange canSchedule={!(req?.status === 'pending' || (req?.status === 'keep' && !req.keep_reply))} onSchedule={() => setSheet({ kind: 'change', s: next })} onCancel={() => setSheet({ kind: 'cancel', s: next })} />}
          </section>
        );
      })()}
      {[next, ...rest].filter((s) => s && chg.reqs[s.id]).map((s) => <ChangeCard key={s!.id} r={chg.reqs[s!.id]} s={s!} where={s === next ? null : `${dayBadge(s!.events.event_date, lang).dow} ${dayBadge(s!.events.event_date, lang).day} · ${s!.events.title}`} preview={preview} onChanged={() => { chg.reload(); load(); }} />)}

      {/* Pay-period hours card removed from Home (Oct 31) — it lives in the Hours tab. */}

      {rest.length > 0 && (
        <>
          <div className="sec-head"><span className="serif">Coming up</span><Link to={`${base}/schedule`}>Full schedule ›</Link></div>
          <section className="agenda">
            {rest.slice(0, 5).map((s) => {
              const b = dayBadge(s.events.event_date, lang);
              return (
                <Link key={s.id} to={teams[s.events.id] && !preview ? `/manage/${s.events.id}` : `${base}/shift/${s.id}`} className="agenda-row" style={{ minHeight: 64 }}>
                  <div className="d" style={{ width: 40, alignItems: 'center' }}><small>{b.dow}</small><b>{b.day}</b></div>
                  <div className="what" style={{ gap: 5 }}><b className={soon(s) ? 'muted' : ''}>{soon(s) ? 'Place to come' : s.events.title}</b>
                    <span className="pos-row2"><span className={'pos-pill' + (isLead(s) ? ' lead' : '')}>{role(s)}</span>{teams[s.events.id] && !preview ? <span>team {teams[s.events.id].length}</span> : null}</span></div>
                  <span className="row-wear" title={uniformLabel(uniformFor(s))}><UniformIcon kind={uniformFor(s)} size={30} /></span>
                  <div className="row-time"><small>Starts</small>{soon(s) ? <b className="tbc">To come</b> : s.time_tbc ? <b className="tbc">Time TBC</b> : <b><span className="serif">{time(s.planned_start, lang).replace(/\s?[ap]\.?\s?m\.?/i, '')}</span><i>{/p\.?\s?m/i.test(time(s.planned_start, lang)) ? ' PM' : ' AM'}</i></b>}</div>
                  {soon(s) ? <span className="tag-soon">Details coming</span> : s.status === 'confirmed' ? <span className="ok-dot" aria-label="Confirmed" /> : <span className="tag-ask" style={{ height: 26, fontSize: 11 }}>Confirm</span>}
                </Link>
              );
            })}
          </section>
        </>
      )}
      {sheet?.kind === 'cancel' && <CancelSheet s={sheet.s} preview={preview} onClose={() => setSheet(null)} onDone={(late) => { setGone((g) => [...g, { id: sheet.s.id, title: sheet.s.events.title, date: sheet.s.events.event_date, late }]); setSheet(null); load(); }} />}
      {sheet?.kind === 'change' && <ChangeSheet s={sheet.s} preview={preview} onClose={() => setSheet(null)} onSent={() => { setSheet(null); chg.reload(); }} />}
      {sheet?.kind === 'late' && <LateSheet s={sheet.s} mgr={sheet.s.events.manager?.full_name ?? null} again={chg.late[sheet.s.id] ?? null} preview={preview} onClose={() => setSheet(null)}
        onSent={(n: LateNotice) => { chg.setLate({ ...chg.late, [n.shift_id]: n }); setSheet(null); if (!preview) chg.reload(); }} />}
      {saidYes.length > 0 && (
        <Link to={`${base}/schedule`} className="said-yes">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
          <span className="grow"><b>You said yes to {saidYes.length} date{saidYes.length > 1 ? 's' : ''}</b> · {saidYes.slice(0, 3).map((a) => new Date(a.for_date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })).join(', ')}{saidYes.length > 3 ? '…' : ''} · waiting for G&R to book</span>
          <span>›</span>
        </Link>
      )}
      {askQ && <AskHours s={askQ} onClose={() => setAskQ(null)} onSent={() => { setQs({ ...qs, [askQ.id]: 'open' }); setAskQ(null); }} />}
      <TabBar base={base} />
    </main>
  );
}

export function AskHours({ s, onClose, onSent }: { s: { id: string; events: { title: string }; punches?: { punch_in: string | null; punch_out: string | null } | null }; onClose: () => void; onSent: () => void }) {
  const lang = useLang();
  const [kind, setKind] = useState<'start' | 'end' | 'other'>('start');
  const [t, setT] = useState(''); const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const pin = s.punches!.punch_in!, pout = s.punches!.punch_out!;
  const send = async () => {
    setBusy(true); setErr('');
    let at: string | null = null;
    if (t && kind !== 'other') {
      const ref = kind === 'start' ? pin : pout;
      const d = new Date(ref); const [h, m] = t.split(':').map(Number);
      const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/Toronto' })); const diff = d.getTime() - local.getTime();
      local.setHours(h, m, 0, 0); let x = local.getTime() + diff;
      if (x - new Date(ref).getTime() > 12 * 3600e3) x -= 24 * 3600e3; if (new Date(ref).getTime() - x > 12 * 3600e3) x += 24 * 3600e3;
      at = new Date(x).toISOString();
    }
    const { error } = await supabase.rpc('ask_hours', { p_shift: s.id, p_kind: kind, p_at: at, p_note: note });
    setBusy(false); if (error) setErr(error.message); else onSent();
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Something wrong with your hours">
        <button className="sheet-x" aria-label="Close" onClick={onClose}>✕</button>
        <div><div className="kicker">{s.events.title} · {range(pin, pout)}</div><div className="serif" style={{ fontSize: 24, lineHeight: 1.15, paddingRight: 44 }}>What’s wrong with your hours?</div></div>
        <div className="starts-from"><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(['start', 'end', 'other'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'start' ? 'Start time' : k === 'end' ? 'End time' : 'Other'}</button>)}
        </div></div>
        {kind !== 'other' && <div className="times-box"><label>{kind === 'start' ? 'I started at' : 'I ended at'}<QuarterTime value={t} onChange={setT} /></label></div>}
        <textarea className="sheet-note" rows={2} value={note} placeholder={kind === 'other' ? 'What happened?' : 'Note (optional) · e.g. my manager asked me to help set up'} onChange={(e) => setNote(e.target.value)} />
        <div className="muted sm">Goes to Ronnie. Your hours stay as they are until he checks.</div>
        {err && <p className="error">{err}</p>}
        <button className="btn-ink" disabled={busy || (kind !== 'other' && !t) || (kind === 'other' && !note.trim())} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </>
  );
}

export function BigTime({ iso, small = false }: { iso: string; small?: boolean }) {
  const t = time(iso, 'en'); const m = t.match(/^(.*?)\s*([ap])\.?\s?m\.?$/i);
  return <span className={'big serif' + (small ? ' sm-big' : '')}>{m ? m[1] : t}{m && <em> {m[2].toUpperCase()}M</em>}</span>;
}

/** Small live countdown to "be there" time, only on the next event. */
function Countdown({ iso, start }: { iso: string; start: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const ms = new Date(iso).getTime() - now;
  let label: string;
  if (now >= new Date(start).getTime()) label = 'Started';
  else if (ms <= 0) label = 'Time to go';
  else {
    const m = Math.floor(ms / 60000); const d = Math.floor(m / 1440); const h = Math.floor((m % 1440) / 60); const mm = m % 60;
    label = d > 0 ? `in ${d} d ${h} h` : h > 0 ? `in ${h} h ${mm} min` : `in ${mm} min`;
  }
  return <span className="countdown"><i />{label}</span>;
}

export function Status({ s }: { s: ShiftRow['status'] }) {
  return s === 'confirmed' ? <span className="tag-ok">✓ Confirmed</span> : s === 'booked' ? <span className="tag-ask">To confirm</span> : <span className="tag-done">Declined</span>;
}
