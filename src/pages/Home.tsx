import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, SHIFT_SELECT, type ShiftRow, type Staff } from '../lib/supabase';
import { useT, useLang } from '../lib/i18n';
import { time, longDate, dayBadge, minus } from '../lib/format';
import { Avatar } from '../components/Avatar';

export function Home({ me, base = '', preview = false }: { me: Staff; base?: string; preview?: boolean }) {
  const t = useT(); const lang = useLang();
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [teams, setTeams] = useState<Record<string, { full_name: string; photo_url: string | null }[]>>({});

  const load = async () => {
    const since = new Date(Date.now() - 12 * 3600e3).toISOString();
    const { data } = await supabase.from('shifts').select(SHIFT_SELECT)
      .eq('staff_id', me.id).neq('status', 'declined').gte('planned_start', since)
      .order('planned_start').limit(30);
    const rows = (data as unknown as ShiftRow[]) ?? [];
    setShifts(rows);
    // Events this person manages: load the team so it shows right on the shift card.
    const managed = rows.filter((r) => r.events.manager_id === me.id).map((r) => r.events.id);
    if (managed.length) {
      const { data: crew } = await supabase.from('shifts').select('event_id,staff(full_name,photo_url)')
        .in('event_id', managed).neq('status', 'declined').order('planned_start');
      const map: typeof teams = {};
      for (const c of (crew ?? []) as unknown as { event_id: string; staff: { full_name: string; photo_url: string | null } }[]) {
        (map[c.event_id] ??= []).push(c.staff);
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

  return (
    <main className="page">
      <header className="top">
        <div>
          <div className="muted">{longDate(new Date().toISOString().slice(0, 10), lang)}</div>
          <h1>{t('hi')} {first}</h1>
        </div>
        {!preview ? <Link to="/profile" aria-label="My profile" style={{ marginLeft: 'auto' }}><Avatar name={me.full_name} url={me.photo_url} /></Link> : <span style={{ marginLeft: 'auto' }}><Avatar name={me.full_name} url={me.photo_url} /></span>}
      </header>


      {pending.map((s) => (
        <section key={s.id} className="card confirm stack">
          <div className="eyebrow accent">{t('newShift')}</div>
          <div className="h2">{longDate(s.events.event_date, lang)} · {time(s.planned_start, lang)}</div>
          <div className="muted">{s.events.title}{s.position_code ? ` · ${s.position_code}` : ''} · {t('beThereAt').toLowerCase()} {time(minus(s.planned_start, s.arrive_before_min), lang)}</div>
          <div className="row2">
            <button className="btn ok" onClick={() => respond(s.id, 'confirmed')}>{t('confirm')}</button>
            <button className="btn" onClick={() => respond(s.id, 'declined')}>{t('cantMake')}</button>
          </div>
          <p className="hint">{t('confirmHint')}</p>
        </section>
      ))}

      {!next && <p className="muted">{t('nothing')}</p>}

      {next && (
        <>
          <div className="eyebrow">{t('nextShift')}</div>
          <section className="card stack">
            <div className="spread">
              <div>
                <div className="h2">{next.events.title}</div>
                <div className="muted">{longDate(next.events.event_date, lang)}{next.position_code ? ` · ${next.position_code}` : ''}</div>
              </div>
              <Status s={next.status} />
            </div>
            <div className="row3">
              <Tile label={t('beThereAt')} v={time(minus(next.planned_start, next.arrive_before_min), lang)} />
              <Tile label={t('start')} v={time(next.planned_start, lang)} />
              <Tile label={t('ends')} v={next.planned_end ? time(next.planned_end, lang) : '—'} />
            </div>
            <Link className="btn primary" to={`${base}/shift/${next.id}`}>{t('details')}</Link>
            {teams[next.events.id] && <TeamStrip eventId={next.events.id} team={teams[next.events.id]} base={base} />}
          </section>
        </>
      )}


      {rest.length > 0 && (
        <>
          <div className="eyebrow">{t('comingUp')}</div>
          <section className="card list">
            {rest.map((s) => {
              const b = dayBadge(s.events.event_date, lang);
              return (
                <Link key={s.id} to={`${base}/shift/${s.id}`} className="list-row">
                  <div className="badge-date"><small>{b.dow}</small><b>{b.day}</b></div>
                  <div className="grow">
                    <div className="strong">{s.events.title}</div>
                    <div className="muted sm">{time(s.planned_start, lang)}{s.planned_end ? ` – ${time(s.planned_end, lang)}` : ''}</div>
                  </div>
                  {teams[s.events.id] ? <span className="pill dark">Team {teams[s.events.id].length}</span> : <Status s={s.status} />}
                </Link>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}

function Tile({ label, v }: { label: string; v: string }) {
  return <div className="tile"><small>{label}</small><b>{v}</b></div>;
}

export function Status({ s }: { s: ShiftRow['status'] }) {
  const t = useT();
  const map = { booked: ['pill accent', t('toConfirm')], confirmed: ['pill ok', t('confirmed')], declined: ['pill', t('declined')] } as const;
  const [cls, label] = map[s];
  return <span className={cls}>{label}</span>;
}

function TeamStrip({ eventId, team, base }: { eventId: string; team: { full_name: string; photo_url: string | null }[]; base: string }) {
  return (
    <Link to={base ? `${base}` : `/manage/${eventId}`} className="team-strip">
      <div className="grow">
        <div className="eyebrow accent">You're managing · team of {team.length}</div>
        <div className="faces">{team.slice(0, 6).map((p, i) => <Avatar key={i} name={p.full_name} url={p.photo_url} size={34} />)}
          {team.length > 6 && <span className="more">+{team.length - 6}</span>}</div>
      </div>
      <span className="btn sm">Team ›</span>
    </Link>
  );
}
