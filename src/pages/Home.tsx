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
  const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Toronto' }));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const managedNext = shifts.find((s) => teams[s.events.id]);

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
        <div className="hello"><b>{greet}, {first}</b><span>{longDate(today, lang)}</span></div>
        {!preview ? <Link to="/profile" aria-label="My profile"><Avatar name={me.full_name} url={me.photo_url} size={38} /></Link> : <Avatar name={me.full_name} url={me.photo_url} size={38} />}
      </header>

      {pending.map((s) => (
        <div key={s.id} className="todo">
          <div className="grow">
            <b>{pending.length > 1 ? 'Shift needs your answer' : '1 shift needs your answer'}</b>
            <span>{dayBadge(s.events.event_date, lang).dow} {dayBadge(s.events.event_date, lang).day} · {s.events.title} · {time(s.planned_start, lang)} · {role(s)}</span>
          </div>
          <div className="row">
            <button className="pill-line" onClick={() => respond(s.id, 'declined')}>Can't</button>
            <button className="pill-red" onClick={() => respond(s.id, 'confirmed')}>Confirm</button>
          </div>
        </div>
      ))}

      {!next && <div className="card"><p className="muted" style={{ margin: 0 }}>No shifts booked yet.</p></div>}

      {next && (
        <section className="next">
          <div className="top-line">
            <span>{whenLabel(next).toUpperCase()} · {role(next).toUpperCase()}</span>
            {next.status === 'confirmed' ? <span className="state"><i />Confirmed</span> : <span className="state wait"><i />To confirm</span>}
          </div>
          <div>
            <div className="venue serif">{next.events.title}</div>
            <div className="sub">{longDate(next.events.event_date, lang)}{next.events.venues?.name && next.events.venues.name !== next.events.title ? ` · ${next.events.venues.name}` : ''}</div>
          </div>
          <div className="times">
            <div><small>Be there</small><BigTime iso={minus(next.planned_start, next.arrive_before_min)} /></div>
            <div className="grow" />
            <div style={{ textAlign: 'right' }}><small>Shift</small><b style={{ fontSize: 15 }}>{time(next.planned_start, lang)}{next.planned_end ? ` – ${time(next.planned_end, lang)}` : ''}</b></div>
          </div>
          <div className="wear-row">
            <span className="wear-tile"><UniformIcon kind={uniformFor(next)} size={34} /></span>
            <div><small>Wear</small><b>{UNIFORM_LABEL[uniformFor(next)]}</b></div>
          </div>
          <Link className="light-btn" to={`${base}/shift/${next.id}`}>View details</Link>
        </section>
      )}

      {managedNext && !preview && (() => {
        const team = teams[managedNext.events.id];
        const bar = team.filter((m) => isBar(m.position_code, m.position_detail)).length;
        return (
          <Link to={`/manage/${managedNext.events.id}`} className="managing">
            <div className="grow">
              <div className="kicker red">You're managing{managedNext.id !== next?.id ? ` · ${managedNext.events.title}` : ''}</div>
              <div className="faces2">
                {team.slice(0, 5).map((p, i) => <Avatar key={i} name={p.full_name} url={p.photo_url} size={34} />)}
                <span className="cnt">{team.length > 5 ? `+${team.length - 5} · ` : ''}{team.length - bar} floor · {bar} bar</span>
              </div>
            </div>
            <span className="go">›</span>
          </Link>
        );
      })()}

      {rest.length > 0 && (
        <>
          <div className="sec-head"><span className="serif">Coming up</span><Link to={`${base}/schedule`}>Full schedule ›</Link></div>
          <section className="agenda">
            {rest.slice(0, 5).map((s) => {
              const b = dayBadge(s.events.event_date, lang);
              return (
                <Link key={s.id} to={`${base}/shift/${s.id}`} className="agenda-row">
                  <div className="d"><small>{b.dow}</small><b>{b.day}</b></div>
                  <div className="what"><b>{s.events.title}</b><span>{time(s.planned_start, lang)} · {role(s)}</span></div>
                  <span className="wear-mini" title={UNIFORM_LABEL[uniformFor(s)]}><UniformIcon kind={uniformFor(s)} size={26} /></span>
                  {teams[s.events.id] && !preview
                    ? <button className="tag-dark" onClick={(e) => { e.preventDefault(); nav(`/manage/${s.events.id}`); }}>Team {teams[s.events.id].length} ›</button>
                    : s.status === 'confirmed' ? <span className="tag-ok">✓ Confirmed</span> : <span className="tag-ask">To confirm</span>}
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

export function BigTime({ iso }: { iso: string }) {
  const t = time(iso, 'en'); const m = t.match(/^(.*?)\s*([ap])\.?\s?m\.?$/i);
  return <span className="big serif">{m ? m[1] : t}{m && <em> {m[2].toUpperCase()}M</em>}</span>;
}

export function Status({ s }: { s: ShiftRow['status'] }) {
  return s === 'confirmed' ? <span className="tag-ok">✓ Confirmed</span> : s === 'booked' ? <span className="tag-ask">To confirm</span> : <span className="tag-done">Declined</span>;
}
