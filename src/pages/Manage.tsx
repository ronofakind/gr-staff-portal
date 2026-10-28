import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { time } from '../lib/format';
import { Avatar } from '../components/Avatar';

type Row = {
  id: string; position_code: string | null; position_detail: string | null; planned_start: string; planned_end: string | null;
  staff: { full_name: string; photo_url: string | null } | null; punches: { punch_in: string | null; punch_out: string | null } | null;
};
type Ev = { id: string; title: string; event_date: string };

const L = {
  fr: { team: 'Équipe', notIn: 'Pas commencé', start: 'Commencer', end: 'Terminer', startAll: 'Commencer tous', endAll: 'Terminer tous',
    edit: 'Modifier', save: 'Enregistrer', cancel: 'Annuler', in: 'Début', out: 'Fin', started: 'commencés', back: 'Retour', hours: 'h' },
  en: { team: 'Team', notIn: 'Not started', start: 'Start', end: 'End', startAll: 'Start all', endAll: 'End all',
    edit: 'Edit', save: 'Save', cancel: 'Cancel', in: 'Start', out: 'End', started: 'started', back: 'Back', hours: 'h' },
};

/** "HH:MM" on the event date (Montreal); times far before the planned start roll to the next day (after midnight). */
function toIso(date: string, hm: string, ref: string) {
  const guess = new Date(`${date}T${hm}:00Z`);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName')!.value;
  let d = new Date(guess.getTime() - Number(tz.replace('GMT', '') || 0) * 3600e3);
  if (d.getTime() < new Date(ref).getTime() - 6 * 3600e3) d = new Date(d.getTime() + 24 * 3600e3);
  return d.toISOString();
}
const isBar = (code: string | null, detail: string | null) =>
  /^(BM|BT|BB)$/.test(code ?? '') || /^bar\b/i.test(detail ?? '');

/** What the person does tonight: the detail set on the shift, else a label from the position code. */
function roleLabel(code: string | null, detail: string | null) {
  if (detail) return detail;
  const map: Record<string, string> = { MD: 'MD', BM: 'Bar - Bar manager', BT: 'Bar - Bartender', BB: 'Bar - Barback', BUS: 'Busboy' };
  return code ? (map[code] ?? (/^\d+$/.test(code) ? 'Waiter' : code)) : 'Waiter';
}
const hm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }) : '';
const hours = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 900000) / 4;

export function Manage() {
  const { eventId } = useParams(); const lang = useLang(); const t = L[lang];
  const [ev, setEv] = useState<Ev | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ in: '', out: '' });
  const [err, setErr] = useState('');

  const load = async () => {
    const [e, s] = await Promise.all([
      supabase.from('events').select('id,title,event_date').eq('id', eventId!).single(),
      supabase.from('shifts').select('id,position_code,position_detail,planned_start,planned_end,staff(full_name,photo_url),punches(punch_in,punch_out)')
        .eq('event_id', eventId!).neq('status', 'declined').order('planned_start'),
    ]);
    setEv(e.data as Ev);
    setRows(((s.data ?? []) as unknown as Row[]).sort((a, b) => a.planned_start.localeCompare(b.planned_start)
      || (a.position_code === 'MD' ? -1 : b.position_code === 'MD' ? 1 : Number(a.position_code) - Number(b.position_code))));
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [eventId]);

  const set = async (list: { id: string; in: string | null; out: string | null }[]) => {
    setErr('');
    for (const r of list) {
      const { error } = await supabase.rpc('manager_set_punch', { p_shift: r.id, p_in: r.in, p_out: r.out });
      if (error) { setErr(error.message); break; }
    }
    await load();
  };
  const now = () => new Date().toISOString();

  if (!ev) return <div className="loading" />;
  const groups = Array.from(new Set(rows.map((r) => r.planned_start)));
  const inCount = rows.filter((r) => r.punches?.punch_in).length;

  return (
    <main className="page">
      <header className="top">
        <Link to="/" className="icon-btn" aria-label={t.back}>‹</Link>
        <div className="grow">
          <h1>{ev.title}</h1>
          <div className="muted sm">{t.team} · {inCount}/{rows.length} {t.started}</div>
        </div>
      </header>
      {err && <p className="error">{err}</p>}

      {groups.map((g) => {
        const grp = rows.filter((r) => r.planned_start === g);
        const notIn = grp.filter((r) => !r.punches?.punch_in);
        const working = grp.filter((r) => r.punches?.punch_in && !r.punches?.punch_out);
        return (
          <section key={g} className="card list">
            <div className="group-head">
              <b>{time(g, lang)}</b><span className="muted sm">· {grp.length}</span>
              <div className="grow" />
              {notIn.length > 0 && <button className="btn sm ok" onClick={() => set(notIn.map((r) => ({ id: r.id, in: now(), out: null })))}>{t.startAll} ({notIn.length})</button>}
              {notIn.length === 0 && working.length > 0 && <button className="btn sm" onClick={() => set(working.map((r) => ({ id: r.id, in: r.punches!.punch_in, out: now() })))}>{t.endAll} ({working.length})</button>}
            </div>
            {grp.map((r) => {
              const p = r.punches; const pin = p?.punch_in ?? null; const pout = p?.punch_out ?? null;
              return (
                <div key={r.id} className="crew-row">
                  <div className="crew-main">
                    <div className="av-wrap"><Avatar name={r.staff?.full_name ?? '?'} url={r.staff?.photo_url} size={48} />{isBar(r.position_code, r.position_detail) ? <span className="dept-tag bar">BAR</span> : <span className="dept-tag floor">FLOOR</span>}</div>
                    <div className="grow">
                      <div className="strong">{r.staff?.full_name}</div>
                      <div className="sm role-line">{roleLabel(r.position_code, r.position_detail)}</div>
                      <div className="sm muted">
                        {!pin ? t.notIn : <>{time(pin, lang)} → {pout ? time(pout, lang) : '…'}{pout ? ` · ${hours(pin, pout)} ${t.hours}` : ''}</>}
                      </div>
                    </div>
                    {!pin && <button className="btn sm ok" onClick={() => set([{ id: r.id, in: now(), out: null }])}>{t.start}</button>}
                    {pin && !pout && <button className="btn sm" onClick={() => set([{ id: r.id, in: pin, out: now() }])}>{t.end}</button>}
                    <button className="btn sm link" onClick={() => { setEditing(editing === r.id ? null : r.id); setDraft({ in: hm(pin) || hm(r.planned_start), out: hm(pout) }); }}>{t.edit}</button>
                  </div>
                  {editing === r.id && (
                    <div className="crew-edit">
                      <label className="field">{t.in}<input type="time" value={draft.in} onChange={(e) => setDraft({ ...draft, in: e.target.value })} /></label>
                      <label className="field">{t.out}<input type="time" value={draft.out} onChange={(e) => setDraft({ ...draft, out: e.target.value })} /></label>
                      <button className="btn sm primary" onClick={async () => {
                        const i = draft.in ? toIso(ev.event_date, draft.in, r.planned_start) : null;
                        const o = draft.out ? toIso(ev.event_date, draft.out, i ?? r.planned_start) : null;
                        await set([{ id: r.id, in: i, out: o }]); setEditing(null);
                      }}>{t.save}</button>
                      <button className="btn sm" onClick={() => setEditing(null)}>{t.cancel}</button>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </main>
  );
}

/** Card on the Home screen for whoever manages an event today. */
export function ManagingToday({ meId, isAdmin }: { meId: string; isAdmin: boolean }) {
  const lang = useLang();
  const [evs, setEvs] = useState<Ev[]>([]);
  useEffect(() => {
    const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const week = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    let q = supabase.from('events').select('id,title,event_date').gte('event_date', yesterday).lte('event_date', week)
      .neq('department', 'bar').order('event_date');
    if (!isAdmin) q = q.eq('manager_id', meId);
    q.then(({ data }) => setEvs((data ?? []) as Ev[]));
  }, [meId]);
  if (!evs.length) return null;
  return (
    <>
      {evs.map((e) => (
        <Link key={e.id} to={`/manage/${e.id}`} className="card manage-card">
          <div className="grow">
            <div className="eyebrow accent">{lang === 'fr' ? 'Tu gères' : "You're managing"} · {e.event_date <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }) ? 'today' : new Date(e.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div className="h2">{e.title}</div>
          </div>
          <span className="btn primary sm">{lang === 'fr' ? 'Équipe' : 'Team'} ›</span>
        </Link>
      ))}
    </>
  );
}
