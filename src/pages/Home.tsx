import { QuarterTime } from '../components/QuarterTime';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, SHIFT_SELECT, isSetup, type ShiftRow, type Staff } from '../lib/supabase';
import { setting, useSettings } from '../lib/settings';
import { useLang } from '../lib/i18n';
import { time, longDate, dayBadge, minus, mapsUrl } from '../lib/format';
import { ProfileButton } from '../components/ProfileMenu';
import { TabBar } from '../components/TabBar';
import { useMyDates, toAnswer, latestKnows, dayLabel } from '../lib/myDates';
import { KnowsSheet } from './MyDates';
import { ConfirmThanks, CalIcon } from '../components/ConfirmThanks';
import { useMyCalendar } from '../lib/calendar';
import { callName } from '../lib/nickname';
import { UniformIcon, uniformFor, uniformLabel } from '../components/Uniform';
import { MessageCard, MessageRonnieLink, MgrRepliesLine } from '../components/MessageCard';
import { useCheckup } from '../lib/checkup';
import { EmergencyForm, UsualWeekScreen } from './Checkup';
import { SwipeSheet } from '../components/SwipeSheet';
import { NeedChange, CancelSheet, ChangeSheet, LateSheet, LateBlock, ChangeCard, CancelledCard, useShiftChanges, t12 as t12c, type LateNotice } from '../components/ShiftChange';

type MgrLate = { id: string; shift_id: string; event_id: string; name: string; eta: string; reason: string | null; note?: string | null };
type Gone = { id: string; title: string; date: string; late: boolean };
const OK_KEY = 'gr-cancel-ok';
const readOk = (): string[] => { try { return JSON.parse(localStorage.getItem(OK_KEY) || '[]'); } catch { return []; } };

/** push 33 shift columns (migration 039), read on their own so Home still loads before it is applied. */
type Prev = { start?: string | null; position?: string | null; place?: string | null; address?: string | null };
type P33 = { confirm_sent_at: string | null; confirm_by: string | null; change_prev: Prev | null; change_seen_at: string | null };
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
  const lang = useLang(); const nav = useNavigate(); useSettings();
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [teams, setTeams] = useState<Record<string, Mate[]>>({});
  const [qs, setQs] = useState<Record<string, Q['status']>>({});
  const [askQ, setAskQ] = useState<ShiftRow | null>(null);
  const [alerts, setAlerts] = useState<{ id: string; kind: string; title: string; body: string | null; event_id: string | null }[]>([]);
  // push 28
  const [sheet, setSheet] = useState<{ kind: 'cancel' | 'change' | 'late'; s: ShiftRow } | null>(null);
  const [gone, setGone] = useState<Gone[]>([]); const [okd, setOkd] = useState<string[]>(readOk);
  const [mgrLate, setMgrLate] = useState<MgrLate[]>([]);
  // push 31 · emergency contact skipped in the check-up → small reminder until it's filled
  const { info: cu, reload: reloadCu } = useCheckup(); const [emOpen, setEmOpen] = useState(false);
  const [wkOpen, setWkOpen] = useState(false); // push 34d · usual week skipped in the check-up
  // push 33
  const [x33, setX33] = useState<Record<string, P33>>({});
  const [thanks, setThanks] = useState<ShiftRow | null>(null);
  const { cal, setCal } = useMyCalendar(preview);

  const load = async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const { data } = await supabase.from('shifts').select(SHIFT_SELECT + ',punches(punch_in,punch_out)')
      .eq('staff_id', me.id).neq('status', 'declined').gte('planned_start', since)
      .order('planned_start').limit(30);
    const all = (data as unknown as ShiftRow[]) ?? [];
    const rows = all.filter((r) => r.attendance !== 'cancelled'); // push 28: a cancelled shift is off Home
    setShifts(rows);
    if (rows.length) supabase.from('shifts').select('id,confirm_sent_at,confirm_by,change_prev,change_seen_at').in('id', rows.map((r) => r.id))
      .then(({ data: d, error }) => { if (!error && Array.isArray(d)) setX33(Object.fromEntries((d as (P33 & { id: string })[]).map((x) => [x.id, x]))); });
    // push 28 · "Shift cancelled · Ronnie has been told" for 24 h (cancelled_at is new in 034: errors → none)
    const cut = new Date(Date.now() - 24 * 3600e3).toISOString();
    supabase.from('shifts').select('id,cancelled_at,cancel_late,events(title,event_date)').eq('staff_id', me.id).eq('cancel_self', true).gte('cancelled_at', cut)
      .then(({ data: g, error }) => { if (!error && Array.isArray(g)) setGone((g as unknown as { id: string; cancel_late: boolean; events: { title: string; event_date: string } | null }[]).filter((x) => x?.events).map((x) => ({ id: x.id, title: x.events!.title, date: x.events!.event_date, late: !!x.cancel_late }))); });
    if (rows.length) supabase.from('hours_questions').select('shift_id,status').in('shift_id', rows.map((r) => r.id)).order('created_at')
      .then(({ data: q }) => setQs(Object.fromEntries(((q ?? []) as Q[]).map((x) => [x.shift_id, x.status]))));
    const managed = [...new Set(rows.filter((r) => r.events.manager_id === me.id || (r.events.co_manager_ids ?? []).includes(me.id) || r.position_code === 'MD' || r.position_code === 'BM').map((r) => r.events.id))];
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
  const { dates: myDates, reload: reloadDates } = useMyDates(me.id, preview); // push 35 · My dates (count, reminder, said yes)
  const [notSure, setNotSure] = useState(false);
  const upcomingIds = (shifts ?? []).filter((s) => !(s.punches?.punch_out && new Date(s.punches.punch_out).getTime() <= Date.now())).map((s) => s.id);
  const chg = useShiftChanges(preview ? [] : upcomingIds);
  const mgrGotIt = async (id: string) => { setMgrLate((v) => v.filter((x) => x.id !== id)); if (!preview) await supabase.rpc('late_notice_seen', { p_id: id }); };
  const okGone = (id: string) => { const v = [...okd, id]; setOkd(v); try { localStorage.setItem(OK_KEY, JSON.stringify(v.slice(-50))); } catch { /* private mode */ } };

  const respond = async (id: string, r: 'confirmed' | 'declined') => {
    if (preview) return;
    const { error } = await supabase.rpc('respond_to_shift', { p_shift: id, p_response: r });
    if (!error && r === 'confirmed') setThanks((shifts ?? []).find((x) => x.id === id) ?? null); // push 33a · thank-you pop-up
    load();
  };
  // push 33f · "Got it" on the gold box (also clears the matching "SHIFT CHANGED" alert card)
  const changeSeen = async (s: ShiftRow) => {
    setX33((m) => ({ ...m, [s.id]: { ...m[s.id], change_seen_at: new Date().toISOString() } }));
    const dup = alerts.filter((a) => a.kind === 'moved' && a.event_id === s.events.id);
    if (dup.length) setAlerts(alerts.filter((a) => !dup.includes(a)));
    if (preview) return;
    await supabase.rpc('shift_change_seen', { p_shift: s.id });
    for (const a of dup) await supabase.rpc('alert_seen', { p_id: a.id });
  };

  if (!shifts) return <div className="loading" />;
  const isDone = (s: ShiftRow) => !!s.punches?.punch_in && !!s.punches.punch_out && new Date(s.punches.punch_out).getTime() <= Date.now();
  const doneToday = shifts.filter((s) => isDone(s) && s.events.event_date === todayIso());
  const [next, ...rest] = shifts.filter((s) => !isDone(s));
  // push 33e · not final = details pending or time TBC: "Details coming", never a Confirm button
  const notFinal = (s: ShiftRow) => !!s.events.details_pending || !!s.time_tbc;
  const soon = (s: ShiftRow) => !!s.events.details_pending || (!!s.time_tbc && s.status === 'booked');
  const pending = shifts.filter((s) => s.status === 'booked' && !notFinal(s) && s !== next); // the next shift confirms on its own card
  const changed = (s: ShiftRow) => { const x = x33[s.id]; return s.status === 'confirmed' && x?.change_prev && !x.change_seen_at ? x.change_prev : null; };
  const toAns = (myDates ?? []).filter((d) => toAnswer(d));
  // push 35d · Maybe reminder: on (or after) the knows-by day, a gold card instead of the red bubble for those dates
  const dueMaybes = toAns.filter((d) => d.status === 'maybe');
  const waitingAsks = toAns.length - dueMaybes.length;
  // Dates they said yes to that G&R hasn't booked (yet)
  const bookedDates = new Set(shifts.map((s) => s.events.event_date));
  const saidYes = (myDates ?? []).filter((a) => a.status === 'yes' && !a.booked && a.for_date >= todayIso() && !bookedDates.has(a.for_date));
  const myDatesTo = (q: string) => `${preview ? base : ''}/my-dates?tab=${q}`;
  const first = callName(me);
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
        <ProfileButton me={me} preview={preview} />
      </header>

      {alerts.map((a) => (
        <div key={a.id} className="alert-card">
          <div className="grow"><small>{a.kind === 'removed' ? 'SCHEDULE CHANGE' : a.kind === 'booked' ? 'NEW SHIFT' : 'SHIFT CHANGED'}</small><b>{a.title}</b>{a.body && <span>{a.body}</span>}</div>
          <button className="pill-red" onClick={() => gotIt(a.id)}>Got it</button>
        </div>
      ))}

      {gone.filter((g) => !okd.includes(g.id)).map((g) => <CancelledCard key={g.id} title={g.title} date={g.date} late={g.late} onOk={() => okGone(g.id)} />)}

      {!preview && me.role !== 'admin' && <MessageCard meId={me.id} />}


      {!preview && cu?.done_at && !cu.emergency_phone && (
        <button className="em-card" onClick={() => setEmOpen(true)}>
          <span className="em-ic" aria-hidden="true">＋</span>
          <span className="grow"><b>Add an emergency contact · 1 min</b><span>Only Ronnie sees it. Used only if something happens at an event.</span></span>
          <span className="em-go">Add ›</span>
        </button>
      )}
      {!preview && cu?.done_at && cu.usual_week_skipped_at && (
        <button className="em-card wk-card" onClick={() => setWkOpen(true)}>
          <span className="em-ic" aria-hidden="true">🗓</span>
          <span className="grow"><b>Set your usual week</b><span>The days you can usually work. Ronnie only asks you for those.</span></span>
          <span className="em-go">›</span>
        </button>
      )}
      {wkOpen && <UsualWeekScreen me={me} onClose={() => { setWkOpen(false); reloadCu(); }} />}
      {emOpen && cu && <>
        <div className="scrim" onClick={() => setEmOpen(false)} />
        <SwipeSheet onClose={() => setEmOpen(false)} label="Emergency contact">
          <div><div className="kicker">ONLY RONNIE SEES THIS</div><div className="serif" style={{ fontSize: 26 }}>Emergency contact</div></div>
          <EmergencyForm info={{ ...cu }} saveLabel="Save" onSaved={() => { setEmOpen(false); reloadCu(); }} />
        </SwipeSheet>
      </>}

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
                  : <button className="done-link" onClick={() => !preview && nav(`/messages?hours=${s.id}`)}>Something wrong? ›</button>}
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
        const lateOn = setting('bookings.running_late') !== 'off' && next.events.event_date === today && !next.punches?.punch_in && !managesIt && !next.time_tbc; // Settings (push 32)
        const req = chg.reqs[next.id];
        const mgrName = next.events.manager?.full_name ?? null;
        const myAlerts = mgrLate.filter((x) => x.event_id === next.events.id);
        const needChange = !started && !managesIt && <NeedChange canSchedule={!(req?.status === 'pending' || (req?.status === 'keep' && !req.keep_reply))} onSchedule={() => setSheet({ kind: 'change', s: next })} onCancel={() => setSheet({ kind: 'cancel', s: next })} />;
        // push 33e · booked, details not final: no Confirm, the 24 h starts once they're set
        if (!working && soon(next)) {
          const d = new Date(next.events.event_date + 'T12:00:00');
          return (
            <section className="next details-coming" style={{ gap: 14, padding: 18 }}>
              <div className="top-line"><span className="day-word">{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}</span><span className="soon-pill">Details coming</span></div>
              <div className="venue serif">You’re booked</div>
              <StartPos start={null} role={role(next)} />
              <div className="sub dc-text">The time and place are coming. You’ll be asked to confirm once they’re set, and you’ll have 24 hours from then.</div>
              {needChange}
            </section>
          );
        }
        const waiting = !working && next.status === 'booked'; // push 33a · waiting for Confirm (details are final here)
        const confirmed = !working && next.status === 'confirmed';
        const by = x33[next.id]?.confirm_by ?? null;
        const prev = changed(next);
        return (
          <section className={'next' + (working ? ' working' : '') + (waiting ? ' to-confirm' : '') + (confirmed ? ' is-confirmed' : '')} style={{ gap: 14, padding: 18 }}>
            <div className="top-line">
              <span className="day-word">{working ? <><i className="live-dot" aria-hidden="true" />WORKING NOW</> : dayWord.toUpperCase()}</span>
              {working ? <span className="countdown">since {time(next.punches!.punch_in!, lang)}</span>
                : waiting ? <ConfirmPill by={by} />
                : !next.time_tbc && <Countdown iso={minus(next.planned_start, next.arrive_before_min)} start={next.planned_start} />}
            </div>
            <div className="spread" style={{ alignItems: 'flex-end' }}>
              <div style={{ minWidth: 0 }}>
                <div className="venue serif">{next.events.title}</div>
                {addr && <div className="sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr.split(',').slice(0, 2).join(' ·')}</div>}
                {confirmed && <div className="you-confirmed">✓ You confirmed</div>}
              </div>
              {!isSetup(next.events) && <span className="wear-tile" style={{ width: 52, height: 52, borderRadius: 14 }} title={uniformLabel(uniformFor(next))}><UniformIcon kind={uniformFor(next)} size={38} /></span>}
            </div>
            {working ? <>
              <div className="pos-line"><small>Your position</small><span className="pos-pill-lg">{role(next)}</span></div>
              <div className="row2">
                <div className="tbox"><small>Started</small><BigTime iso={next.punches!.punch_in!} small /></div>
                <div className="tbox"><small>On the clock</small><span className="big serif sm-big mint"><Elapsed iso={next.punches!.punch_in!} /></span></div>
              </div>
            </> : <StartPos start={next.time_tbc ? null : next.planned_start} role={role(next)} />}
            {prev && <ChangedBox prev={prev} s={next} role={role(next)} calOn={!!cal?.added_at} onSeen={() => changeSeen(next)} />}
            {myAlerts.map((a) => (
              <div key={a.id} className="mgr-late"><span className="grow">⏱ <b>{a.name.split(' ')[0]} running late</b> · ~{t12c(a.eta).replace(/\s?[AP]M$/, '')}{a.reason ? ` · ${a.reason.toLowerCase()}` : ''}{a.note ? ` · “${a.note}”` : ''}</span>
                <button onClick={() => mgrGotIt(a.id)}>Got it ✓</button></div>
            ))}
            {managesIt && <MgrRepliesLine eventId={next.events.id} />}
            {lateOn && <LateBlock notice={chg.late[next.id] ?? null} mgr={mgrName} mgrPhone={next.events.manager?.phone} onOpen={() => setSheet({ kind: 'late', s: next })} />}
            {waiting && <>
              <button className="confirm-glow" onClick={() => respond(next.id, 'confirmed')}>Confirm my shift</button>
              {by && <div className="confirm-by">{new Date(by).getTime() > Date.now() ? 'Confirm within 24 h' : 'Please confirm now'} · by {byLabel(by)}</div>}
            </>}
            <div className="row2">
              <Link className="light-btn" style={{ height: 46, borderRadius: 14 }} to={`${base}/shift/${next.id}`}>Details</Link>
              {team && !preview && !waiting
                ? <Link className="team-btn" to={`/manage/${next.events.id}`}>My team · {team.length} ›</Link>
                : addr ? <a className="dir-btn" href={mapsUrl(addr)} target="_blank" rel="noreferrer">Directions</a>
                : <span className="dir-btn" aria-disabled>Directions</span>}
            </div>
            {needChange}
          </section>
        );
      })()}
      {[next, ...rest].filter((s) => s && chg.reqs[s.id]).map((s) => <ChangeCard key={s!.id} r={chg.reqs[s!.id]} s={s!} where={s === next ? null : `${dayBadge(s!.events.event_date, lang).dow} ${dayBadge(s!.events.event_date, lang).day} · ${s!.events.title}`} preview={preview} onChanged={() => { chg.reload(); load(); }} />)}

      {/* Pay-period hours card removed from Home (Oct 31) — it lives in the Hours tab. */}

      {(() => {
        // push 33c · while on shift: the next shift shrinks to one line, then the red pill, then Coming up
        const working = !!next?.punches?.punch_in && new Date(next.punches.punch_in).getTime() <= Date.now();
        const mini = working ? rest[0] : undefined;
        const list = mini ? rest.slice(1) : rest;
        return <>
          {mini && (() => { const b = dayBadge(mini.events.event_date, lang); const ok = mini.status === 'confirmed'; return (
            <Link to={`${base}/shift/${mini.id}`} className={'next-mini' + (ok ? ' ok' : '')}>
              <div className="d"><small>{b.dow}</small><b>{b.day}</b></div>
              <div className="grow"><small>NEXT · {soon(mini) ? 'DETAILS COMING' : ok ? '✓ CONFIRMED' : 'TO CONFIRM'}</small><b>{soon(mini) ? 'You’re booked' : mini.events.title}</b>
                <span>{soon(mini) || mini.time_tbc ? 'Time TBC' : time(mini.planned_start, lang)} · {role(mini)} · {whenLabel(mini).split(' · ')[0].toLowerCase()}</span></div>
              <span className="row-wear"><UniformIcon kind={uniformFor(mini)} size={30} /></span>
            </Link>
          ); })()}
          {dueMaybes.length > 0 && (() => {
            const months = [...new Set(dueMaybes.map((d) => new Date(d.for_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' })))];
            const by = dueMaybes.map((d) => d.answer_by).filter(Boolean).sort()[0];
            const n = dueMaybes.length;
            return (
              <section className="md-remind">
                <small>TODAY · {dayLabel(today).toUpperCase()}</small>
                <div className="serif">Do you know your {months.length === 1 ? months[0] + ' ' : ''}schedule yet?</div>
                <span>{n} date{n > 1 ? 's are' : ' is'} waiting on you{by ? ` · answer by ${dayLabel(new Date(by).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }))}` : ''}</span>
                <Link to={myDatesTo('answer')} className="md-remind-go">Answer my {n === 1 ? 'date' : `${n} dates`} ›</Link>
                <button className="link-btn" onClick={() => setNotSure(true)}>Still not sure</button>
              </section>
            );
          })()}
          {waitingAsks > 0 && (
            <Link to={myDatesTo('answer')} className="dates-pill">
              <CalIcon /><b className="grow">{waitingAsks} date{waitingAsks > 1 ? 's' : ''} to answer</b><span className="dp-go">Answer ›</span>
            </Link>
          )}
          {list.filter((s) => s !== next && changed(s)).map((s) => <ChangedBox key={s.id} prev={changed(s)!} s={s} role={role(s)} calOn={!!cal?.added_at} onSeen={() => changeSeen(s)} standalone />)}
          {list.length > 0 && (
            <>
              <div className="sec-head"><span className="serif">Coming up</span><Link to={myDatesTo('booked')}>All my dates ›</Link></div>
              <section className="agenda">
                {list.slice(0, 5).map((s) => {
                  const b = dayBadge(s.events.event_date, lang);
                  const pend = !!s.events.details_pending;
                  return (
                    <Link key={s.id} to={teams[s.events.id] && !preview ? `/manage/${s.events.id}` : `${base}/shift/${s.id}`} className="agenda-row" style={{ minHeight: 64 }}>
                      <div className="d" style={{ width: 40, alignItems: 'center' }}><small>{b.dow}</small><b>{b.day}</b></div>
                      <div className="what" style={{ gap: 5 }}><b className={pend ? 'muted' : ''}>{pend ? 'Place to come' : s.events.title}</b>
                        <span className="pos-row2"><span className={'pos-pill' + (isLead(s) ? ' lead' : '')}>{role(s)}</span>{teams[s.events.id] && !preview ? <span>team {teams[s.events.id].length}</span> : null}</span></div>
                      <span className="row-wear" title={uniformLabel(uniformFor(s))}><UniformIcon kind={uniformFor(s)} size={30} /></span>
                      <div className="row-time"><small>Starts</small>{pend ? <b className="tbc">To come</b> : s.time_tbc ? <b className="tbc">Time TBC</b> : <b><span className="serif">{time(s.planned_start, lang).replace(/\s?[ap]\.?\s?m\.?/i, '')}</span><i>{/p\.?\s?m/i.test(time(s.planned_start, lang)) ? ' PM' : ' AM'}</i></b>}</div>
                      {soon(s) ? <span className="tag-soon">Details coming</span> : s.status === 'confirmed' ? <span className="ok-dot" aria-label="Confirmed" /> : notFinal(s) ? <span className="tag-soon">Details coming</span> : <span className="tag-ask" style={{ height: 26, fontSize: 11 }}>Confirm</span>}
                    </Link>
                  );
                })}
              </section>
            </>
          )}
        </>;
      })()}
      {sheet?.kind === 'cancel' && <CancelSheet s={sheet.s} preview={preview} onClose={() => setSheet(null)} onDone={(late) => { setGone((g) => [...g, { id: sheet.s.id, title: sheet.s.events.title, date: sheet.s.events.event_date, late }]); setSheet(null); load(); }} />}
      {sheet?.kind === 'change' && <ChangeSheet s={sheet.s} preview={preview} onClose={() => setSheet(null)} onSent={() => { setSheet(null); chg.reload(); }} />}
      {sheet?.kind === 'late' && <LateSheet s={sheet.s} mgr={sheet.s.events.manager?.full_name ?? null} again={chg.late[sheet.s.id] ?? null} preview={preview} onClose={() => setSheet(null)}
        onSent={(n: LateNotice) => { chg.setLate({ ...chg.late, [n.shift_id]: n }); setSheet(null); if (!preview) chg.reload(); }} />}
      {!preview && me.role !== 'admin' && <MessageRonnieLink />}
      {saidYes.length > 0 && (
        <Link to={myDatesTo('answered')} className="said-yes">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>
          <span className="grow"><b>You said yes to {saidYes.length} date{saidYes.length > 1 ? 's' : ''}</b> · {saidYes.slice(0, 3).map((a) => new Date(a.for_date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })).join(', ')}{saidYes.length > 3 ? '…' : ''} · waiting for G&R to book</span>
          <span>›</span>
        </Link>
      )}
      {askQ && <AskHours s={askQ} onClose={() => setAskQ(null)} onSent={() => { setQs({ ...qs, [askQ.id]: 'open' }); setAskQ(null); }} />}
      {thanks && <ConfirmThanks name={first} cal={preview ? null : cal} onCal={setCal} onClose={() => setThanks(null)}
        line={`${thanks.events.venues?.name ?? thanks.events.title} · ${new Date(thanks.events.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')} · ${t12(thanks.planned_start)}`} />}
      {notSure && <KnowsSheet title="When will you know?" latest={latestKnows(dueMaybes)} oneTap
        sub="Pick a new day. It can't be after the answer-by date." onClose={() => setNotSure(false)}
        onPick={async (by) => { setNotSure(false); if (preview) return; await supabase.rpc('dont_know_yet', { p_knows_by: by, p_note: null, p_ids: dueMaybes.map((d) => d.id) }); reloadDates(); }} />}
      <TabBar base={base} badge={toAns.length} />
    </main>
  );
}

/** push 33a · Shift starts + Your position in one light row (position centred under its label). */
export function StartPos({ start, role }: { start: string | null; role: string }) {
  return (
    <div className="start-pos">
      <div><small>Shift starts</small>{start ? <BigTime iso={start} small /> : <span className="big serif sm-big">TBC</span>}</div>
      <div className="sp-pos"><small>Your position</small><span className="pos-pill-dark">{role}</span></div>
    </div>
  );
}

const byLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).replace(',', '');
/** push 33a · red "Confirm · 21 h left" pill (stays red once overdue; nothing is auto-cancelled). */
function ConfirmPill({ by }: { by: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(id); }, []);
  if (!by) return <span className="confirm-pill"><i />Confirm</span>;
  const m = Math.floor((new Date(by).getTime() - now) / 60000);
  return <span className="confirm-pill"><i />{m <= 0 ? 'Confirm · overdue' : m < 60 ? `Confirm · ${m} min left` : `Confirm · ${Math.floor(m / 60)} h left`}</span>;
}

/** push 33f · gold "Your shift changed" box until Got it. */
function ChangedBox({ prev, s, role, calOn, onSeen, standalone = false }: { prev: Prev; s: ShiftRow; role: string; calOn: boolean; onSeen: () => void; standalone?: boolean }) {
  const place = s.events.venues?.name ?? s.events.title;
  const bits: JSX.Element[] = [];
  if (prev.start && new Date(prev.start).getTime() !== new Date(s.planned_start).getTime() && !s.time_tbc) bits.push(<span key="t">Now starts <b>{t12(s.planned_start)}</b> <s>{t12(prev.start)}</s></span>);
  if (prev.place && prev.place !== place) bits.push(<span key="p">Now at <b>{place}</b> <s>{prev.place}</s></span>);
  else if (prev.address && prev.address !== (s.events.address || s.events.venues?.address || '')) bits.push(<span key="a">New address <b>{s.events.address || s.events.venues?.address}</b></span>);
  if (prev.position && prev.position.replace(/^bar\s*-\s*/i, '') !== role && !/^\d+$/.test(prev.position)) bits.push(<span key="r">Now <b>{role}</b> <s>{prev.position.replace(/^bar\s*-\s*/i, '')}</s></span>);
  if (!bits.length) bits.push(<span key="x">Some details changed. Check Details.</span>);
  return (
    <div className={'changed-box' + (standalone ? ' standalone' : '')}>
      <div className="grow">
        <b>Your shift changed{standalone ? ` · ${new Date(s.events.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''}</b>
        {bits}
        {calOn && <small>Your G&amp;R calendar updates by itself.</small>}
      </div>
      <button onClick={onSeen}>Got it</button>
    </div>
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
function Elapsed({ iso }: { iso: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  return <>{Math.floor(m / 60)} h {String(m % 60).padStart(2, '0')}</>;
}
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
