import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, SHIFT_SELECT, type ShiftRow, type Staff } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { time, longDate, dayBadge, minus } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { TabBar } from '../components/TabBar';
import { UniformIcon, uniformFor, UNIFORM_LABEL } from '../components/Uniform';

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
  const [month, setMonth] = useState<{ n: number; h: number } | null>(null);
  const [askQ, setAskQ] = useState<ShiftRow | null>(null);

  const load = async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const { data } = await supabase.from('shifts').select(SHIFT_SELECT + ',punches(punch_in,punch_out)')
      .eq('staff_id', me.id).neq('status', 'declined').gte('planned_start', since)
      .order('planned_start').limit(30);
    const rows = (data as unknown as ShiftRow[]) ?? [];
    setShifts(rows);
    if (rows.length) supabase.from('hours_questions').select('shift_id,status').in('shift_id', rows.map((r) => r.id)).order('created_at')
      .then(({ data: q }) => setQs(Object.fromEntries(((q ?? []) as Q[]).map((x) => [x.shift_id, x.status]))));
    const m0 = todayIso().slice(0, 8) + '01';
    supabase.from('shifts').select('punches(punch_in,punch_out),events!inner(event_date)').eq('staff_id', me.id).neq('status', 'declined')
      .gte('events.event_date', m0).lte('events.event_date', todayIso()).then(({ data: ms }) => {
        const done = ((ms ?? []) as unknown as { punches: { punch_in: string | null; punch_out: string | null } | null }[]).filter((x) => x.punches?.punch_in && x.punches.punch_out && new Date(x.punches.punch_out).getTime() <= Date.now());
        setMonth({ n: done.length, h: done.reduce((n, x) => n + hrs(x.punches!.punch_in!, x.punches!.punch_out!), 0) });
      });
    const managed = rows.filter((r) => r.events.manager_id === me.id).map((r) => r.events.id);
    if (managed.length) {
      const { data: crew, error: cErr } = await supabase.from('shifts').select('event_id,position_code,position_detail,attendance,staff:staff!shifts_staff_id_fkey(full_name,photo_url),punches(punch_in,punch_out)')
        .in('event_id', managed).neq('status', 'declined').order('planned_start');
      if (cErr) console.warn('[team]', cErr.message);
      const map: typeof teams = {};
      for (const c of (crew ?? []) as unknown as { event_id: string; position_code: string | null; position_detail: string | null; attendance: string | null; staff: { full_name: string; photo_url: string | null }; punches: Mate['punches'] }[]) {
        if (c.attendance) continue;
        (map[c.event_id] ??= []).push({ ...c.staff, position_code: c.position_code, position_detail: c.position_detail, punches: c.punches });
      }
      setTeams(map);
    }
  };
  useEffect(() => { load(); }, []);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    supabase.from('availability').select('id', { count: 'exact', head: true }).eq('staff_id', me.id).eq('status', 'asked')
      .not('ask_id', 'is', null).gte('for_date', todayIso()).then(({ count }) => setAsked(count ?? 0));
  }, [me.id]);

  const respond = async (id: string, r: 'confirmed' | 'declined') => {
    if (preview) return;
    await supabase.rpc('respond_to_shift', { p_shift: id, p_response: r });
    load();
  };

  if (!shifts) return <div className="loading" />;
  const isDone = (s: ShiftRow) => !!s.punches?.punch_in && !!s.punches.punch_out && new Date(s.punches.punch_out).getTime() <= Date.now();
  const doneToday = shifts.filter((s) => isDone(s) && s.events.event_date === todayIso());
  const [next, ...rest] = shifts.filter((s) => !isDone(s));
  const pending = shifts.filter((s) => s.status === 'booked');
  const first = me.full_name.split(' ')[0];
  const today = todayIso();

  const whenLabel = (s: ShiftRow) => {
    const d = s.events.event_date;
    const day = d === today ? 'Today' : d === addDay(today, 1) ? 'Tomorrow' : new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long' });
    const h = Math.round((new Date(minus(s.planned_start, s.arrive_before_min)).getTime() - Date.now()) / 3600e3);
    return `${day}${h > 0 && h < 48 ? ` · in ${h} h` : ''}`;
  };
  const role = (s: ShiftRow) => s.position_code === 'MD' ? 'MD' : s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : isBar(s.position_code, null) ? 'Bar' : 'Waiter';

  return (
    <main className="page v2">
      <header className="v2-head">
        <img className="logo" src="/logo-full.png" alt="G&R" />
        <div className="hello"><b>Hi {first}</b><span>{longDate(today, lang)}</span></div>
        {!preview ? <Link to="/profile" aria-label="My profile"><Avatar name={me.full_name} url={me.photo_url} size={38} /></Link> : <Avatar name={me.full_name} url={me.photo_url} size={38} />}
      </header>

      {asked > 0 && (
        <Link to={preview ? '#' : '/availability'} className="todo">
          <div className="grow"><b>Are you available?</b><span>{asked} date{asked > 1 ? 's' : ''} waiting for your answer</span></div>
          <span className="pill-red" style={{ display: 'inline-flex', alignItems: 'center' }}>Answer ›</span>
        </Link>
      )}

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
          const total = team.reduce((n, m) => n + (m.punches?.punch_in && m.punches.punch_out ? hrs(q15(m.punches.punch_in), q15(m.punches.punch_out)) : 0), 0);
          const sub = s.events.hours_submitted_at;
          return sub ? (
            <div key={s.id} className="done-card mgr">
              <span className="ck">✓</span>
              <div className="grow"><small>YOU MANAGED · {s.events.title.toUpperCase()}</small><b>Hours submitted {t12(sub)}</b><span>{team.length} people · {total} h · you {hrs(q15(s.punches!.punch_in!), q15(s.punches!.punch_out!))} h</span>
                <Link to={`/manage/${s.events.id}`} className="done-link">Open team · fix &amp; resubmit ›</Link></div>
            </div>
          ) : (
            <Link key={s.id} to={`/manage/${s.events.id}`} className="done-card warn">
              <span className="ck">!</span>
              <div className="grow"><b>{ended ? 'Hours not submitted yet' : 'Your team is still working'}</b><span>{s.events.title}{ended ? ` · ${team.length} people · ${total} h` : ''}</span></div>
              <span className="pill-ink">{ended ? 'Submit ›' : 'Open ›'}</span>
            </Link>
          );
        }
        const st = qs[s.id];
        return (
          <div key={s.id} className="done-card">
            <span className="ck">✓</span>
            <div className="grow">
              <small>DONE {s.events.event_date === todayIso() ? 'TONIGHT' : ''} · {s.events.title.toUpperCase()}</small>
              <div className="ln"><span className="serif">{range(s.punches!.punch_in!, s.punches!.punch_out!)}</span><b>{hrs(q15(s.punches!.punch_in!), q15(s.punches!.punch_out!))} h</b></div>
              <div className="ln sm"><span>Thanks, {first}!</span>
                {st === 'open' ? <span className="gold">Question sent ✓ · waiting</span>
                  : st === 'fixed' ? <span className="okc">Fixed ✓</span>
                  : st === 'correct' ? <span className="muted">Checked, it’s correct</span>
                  : <button className="done-link" onClick={() => !preview && setAskQ(s)}>Something wrong? ›</button>}</div>
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
        return (
          <section className="next" style={{ gap: 14, padding: 18 }}>
            <div className="top-line">
              <span>{dayWord.toUpperCase()} · {role(next).toUpperCase()}</span>
              {!next.time_tbc && <Countdown iso={minus(next.planned_start, next.arrive_before_min)} start={next.planned_start} />}
            </div>
            <div className="spread" style={{ alignItems: 'flex-end' }}>
              <div style={{ minWidth: 0 }}>
                <div className="venue serif">{next.events.title}</div>
                {addr && <div className="sub" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr.split(',').slice(0, 2).join(' ·')}</div>}
              </div>
              <span className="wear-tile" style={{ width: 52, height: 52, borderRadius: 14 }} title={UNIFORM_LABEL[uniformFor(next)]}><UniformIcon kind={uniformFor(next)} size={38} /></span>
            </div>
            <div className="row2">
              <div className="tbox"><small>Be there</small>{next.time_tbc ? <span className="big serif sm-big">TBC</span> : <BigTime iso={minus(next.planned_start, next.arrive_before_min)} small />}</div>
              <div className="tbox"><small>Shift starts</small>{next.time_tbc ? <span className="big serif sm-big">TBC</span> : <BigTime iso={next.planned_start} small />}</div>
            </div>
            <div className="row2">
              <Link className="light-btn" style={{ height: 46, borderRadius: 14 }} to={`${base}/shift/${next.id}`}>Details</Link>
              {team && !preview
                ? <Link className="team-btn" to={`/manage/${next.events.id}`}>My team · {team.length} ›</Link>
                : next.status === 'confirmed' ? <span className="light-btn" style={{ height: 46, borderRadius: 14, background: '#2A2521', color: '#9FD8B8' }}>✓ Confirmed</span>
                : <button className="team-btn" style={{ border: 'none' }} onClick={() => respond(next.id, 'confirmed')}>Confirm</button>}
            </div>
          </section>
        );
      })()}

      {month && month.n > 0 && (
        <Link to={`${base}/schedule`} className="month-card">
          <div className="grow"><small>{new Date().toLocaleDateString('en-CA', { month: 'long', timeZone: 'America/Toronto' }).toUpperCase()} SO FAR</small>
            <div className="row" style={{ gap: 18 }}><span><b className="serif">{month.n}</b> shift{month.n > 1 ? 's' : ''}</span><span><b className="serif">{month.h}</b> hours</span></div></div>
          <span className="muted sm">Schedule ›</span>
        </Link>
      )}

      {rest.length > 0 && (
        <>
          <div className="sec-head"><span className="serif">Coming up</span><Link to={`${base}/schedule`}>Full schedule ›</Link></div>
          <section className="agenda">
            {rest.slice(0, 5).map((s) => {
              const b = dayBadge(s.events.event_date, lang);
              return (
                <Link key={s.id} to={teams[s.events.id] && !preview ? `/manage/${s.events.id}` : `${base}/shift/${s.id}`} className="agenda-row" style={{ minHeight: 64 }}>
                  <div className="d" style={{ width: 40, alignItems: 'center' }}><small>{b.dow}</small><b>{b.day}</b></div>
                  <div className="what" style={{ gap: 1 }}><b>{s.events.title}</b><span>{s.time_tbc ? 'Time TBC' : `Be there ${time(minus(s.planned_start, s.arrive_before_min), lang).replace(/\s?[ap]\.?m\.?/i, '')}`} · {role(s)}{teams[s.events.id] && !preview ? ` · team ${teams[s.events.id].length}` : ''}</span></div>
                  <span className="wear-mini" style={{ width: 32, height: 32, borderRadius: 9 }} title={UNIFORM_LABEL[uniformFor(s)]}><UniformIcon kind={uniformFor(s)} size={24} /></span>
                  {s.status === 'confirmed' ? <span className="ok-dot" aria-label="Confirmed" /> : <span className="tag-ask" style={{ height: 26, fontSize: 11 }}>Confirm</span>}
                </Link>
              );
            })}
          </section>
        </>
      )}
      {askQ && <AskHours s={askQ} onClose={() => setAskQ(null)} onSent={() => { setQs({ ...qs, [askQ.id]: 'open' }); setAskQ(null); }} />}
      <TabBar base={base} />
    </main>
  );
}

function AskHours({ s, onClose, onSent }: { s: ShiftRow; onClose: () => void; onSent: () => void }) {
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
        <div className="grab" />
        <div><div className="kicker">{s.events.title} · {range(pin, pout)}</div><div className="serif" style={{ fontSize: 24, lineHeight: 1.15 }}>What’s wrong with your hours?</div></div>
        <div className="starts-from"><div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(['start', 'end', 'other'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k === 'start' ? 'Start time' : k === 'end' ? 'End time' : 'Other'}</button>)}
        </div></div>
        {kind !== 'other' && <div className="times-box"><label>{kind === 'start' ? 'I started at' : 'I ended at'}<input type="time" value={t} onChange={(e) => setT(e.target.value)} /></label></div>}
        <textarea className="sheet-note" rows={2} value={note} placeholder={kind === 'other' ? 'What happened?' : 'Note (optional) · e.g. my manager asked me to help set up'} onChange={(e) => setNote(e.target.value)} />
        <div className="muted sm">Goes to Ronnie and your manager. Your hours stay as they are until they check.</div>
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
