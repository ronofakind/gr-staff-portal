import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, SHIFT_SELECT, type ShiftRow, type Staff } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { time, longDate, dayBadge, minus } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { TabBar } from '../components/TabBar';
import { UniformIcon, uniformFor, UNIFORM_LABEL } from '../components/Uniform';

type Mate = { full_name: string; photo_url: string | null; position_code: string | null; position_detail: string | null };
export const isBar = (code: string | null, detail: string | null) => /^(BM|BT|BB)$/.test(code ?? '') || /^bar\b/i.test(detail ?? '');
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
const addDay = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export function Home({ me, base = '', preview = false }: { me: Staff; base?: string; preview?: boolean }) {
  const lang = useLang(); const nav = useNavigate();
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [teams, setTeams] = useState<Record<string, Mate[]>>({});

  const load = async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const { data } = await supabase.from('shifts').select(SHIFT_SELECT)
      .eq('staff_id', me.id).neq('status', 'declined').gte('planned_start', since)
      .order('planned_start').limit(30);
    const rows = (data as unknown as ShiftRow[]) ?? [];
    setShifts(rows);
    const managed = rows.filter((r) => r.events.manager_id === me.id).map((r) => r.events.id);
    if (managed.length) {
      const { data: crew, error: cErr } = await supabase.from('shifts').select('event_id,position_code,position_detail,staff:staff!shifts_staff_id_fkey(full_name,photo_url)')
        .in('event_id', managed).neq('status', 'declined').order('planned_start');
      if (cErr) console.warn('[team]', cErr.message);
      const map: typeof teams = {};
      for (const c of (crew ?? []) as unknown as { event_id: string; position_code: string | null; position_detail: string | null; staff: { full_name: string; photo_url: string | null } }[]) {
        (map[c.event_id] ??= []).push({ ...c.staff, position_code: c.position_code, position_detail: c.position_detail });
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
  const [next, ...rest] = shifts;
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

      {!next && <div className="card"><p className="muted" style={{ margin: 0 }}>No shifts booked yet.</p></div>}

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
      <TabBar base={base} />
    </main>
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
