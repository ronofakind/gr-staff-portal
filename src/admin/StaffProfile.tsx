import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { isoDay, flagsOf, hoursBetween, dLabel, type AStaff, type Flag } from './api';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
type Sh = { id: string; planned_start: string; attendance: string | null; punches: { punch_in: string | null; punch_out: string | null } | null; events: { event_date: string; title: string } };

/** Side panel (desktop) / full screen (phone) with everything about one person. */
export function StaffProfile({ s, onClose, onEdit }: { s: AStaff; onClose: () => void; onEdit: () => void }) {
  const today = isoDay(new Date());
  const [week, setWeek] = useState<Record<number, { status: string; from_time: string | null }>>({});
  const [off, setOff] = useState<{ from_date: string; to_date: string; reason: string | null }[]>([]);
  const [shifts, setShifts] = useState<Sh[]>([]);
  const [notes, setNotes] = useState(s.staff_private?.notes ?? ''); const [saved, setSaved] = useState(true);

  useEffect(() => {
    setNotes(s.staff_private?.notes ?? ''); setSaved(true);
    Promise.all([
      supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', s.id),
      supabase.from('days_off').select('from_date,to_date,reason').eq('staff_id', s.id).gte('to_date', today).order('from_date'),
      supabase.from('shifts').select('id,planned_start,attendance,punches(punch_in,punch_out),events!inner(event_date,title)').eq('staff_id', s.id).neq('status', 'declined')
        .gte('events.event_date', today.slice(0, 4) + '-01-01'),
    ]).then(([w, o, sh]) => {
      setWeek(Object.fromEntries(((w.data ?? []) as { dow: number; status: string; from_time: string | null }[]).map((x) => [x.dow, x])));
      setOff((o.data ?? []) as typeof off);
      setShifts(((sh.data ?? []) as unknown as Sh[]).sort((a, b) => b.events.event_date.localeCompare(a.events.event_date)));
    });
  }, [s.id]);

  const month = shifts.filter((x) => x.events.event_date.slice(0, 7) === today.slice(0, 7));
  const monthHours = month.reduce((n, x) => n + hoursBetween(x.punches?.punch_in ?? null, x.punches?.punch_out ?? null), 0);
  const count = (f: Flag) => shifts.filter((x) => flagsOf(x).some((y) => y.flag === f)).length;
  const last = shifts.find((x) => flagsOf(x).length);
  const tel = s.phone?.replace(/[^\d+]/g, '');
  const saveNotes = async () => { await supabase.from('staff_private').upsert({ staff_id: s.id, notes: notes || null }); setSaved(true); };
  const ampm = (t: string | null) => { if (!t) return ''; const h = Number(t.slice(0, 2)); return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`; };

  return (
    <>
      <div className="adm-scrim" onClick={onClose} />
      <aside className="adm-panel" aria-label={s.full_name}>
        <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">STAFF PROFILE</span><button className="sq" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="row" style={{ gap: 14 }}>
          <span className={'ringt t-' + (s.staff_private?.tier ?? 'none')}><Avatar name={s.full_name} url={s.photo_url} size={64} /></span>
          <div className="grow"><div className="serif" style={{ fontSize: 24, lineHeight: 1.1 }}>{s.full_name}</div>
            <div className="muted sm">{s.positions.join(', ') || s.role}{s.role !== 'staff' ? ` · ${s.role}` : ''}</div>
            <div className="row sm" style={{ gap: 6, marginTop: 4 }}>{s.staff_private?.tier && <i className={'tier-dot ' + s.staff_private.tier}>{s.staff_private.tier}</i>}{s.staff_private?.ranking != null && <b>#{s.staff_private.ranking}</b>}<span className="muted">· {s.language.toUpperCase()}</span></div></div>
        </div>
        <div className="grid-3btn">
          {tel ? <a className="abtn ok" href={`tel:${tel}`}>Call</a> : <span className="abtn" aria-disabled>No phone</span>}
          {tel ? <a className="abtn dark" href={`sms:${tel}`}>Text</a> : <span />}
          <Link className="abtn" to={`/admin/view/${s.id}`}>View as</Link>
        </div>
        <div className="pcard"><div className="kick">THIS MONTH</div><div className="row" style={{ gap: 20 }}><b className="big">{month.length} <small>shifts</small></b><b className="big">{monthHours} <small>hrs</small></b></div></div>
        <div className="pcard">
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">RELIABILITY · {today.slice(0, 4)}</span><Link to="/admin/reliability" className="sm accent strong">Full log ›</Link></div>
          <div className="rel4">
            <div className={count('no_show') ? 'r' : 'g'}><b>{count('no_show')}</b><small>no-shows</small></div>
            <div className={count('cancelled') ? 'r' : 'g'}><b>{count('cancelled')}</b><small>cancels</small></div>
            <div className={count('late') ? 'r' : 'g'}><b>{count('late')}</b><small>late</small></div>
            <div className={count('early') ? 'y' : 'g'}><b>{count('early')}</b><small>early starts</small></div>
          </div>
          {last && <div className="muted sm">Last: {flagsOf(last).map((f) => f.flag.replace('_', '-')).join(', ')} · {dLabel(last.events.event_date)} · {last.events.title}</div>}
        </div>
        <div className="pcard">
          <div className="kick">USUAL WEEK</div>
          <div className="wk7">{DOW.map((d, i) => { const w = week[i]; return <span key={i} className={w?.status ?? 'unset'} title={w?.status === 'from' ? `from ${ampm(w.from_time)}` : ''}>{d}{w?.status === 'from' ? <small>{ampm(w.from_time).replace(' ', '')}</small> : null}</span>; })}</div>
          {off.length > 0 && <div className="muted sm">Days off: {off.map((o) => o.from_date === o.to_date ? dLabel(o.from_date) : `${dLabel(o.from_date)} – ${dLabel(o.to_date)}`).join(' · ')}</div>}
          {!Object.keys(week).length && <div className="muted sm">Not set yet.</div>}
        </div>
        <div className="pcard">
          <div className="kick">ADMIN NOTES · NEVER SHOWN TO STAFF</div>
          <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} onBlur={() => !saved && saveNotes()} placeholder="Great with VIP tables…" />
          {!saved && <button className="abtn sm dark" onClick={saveNotes}>Save note</button>}
        </div>
        <div className="row wrap"><button className="abtn" onClick={onEdit}>Edit details</button><Link className="abtn" to="/admin/tiers">Change tier</Link></div>
      </aside>
    </>
  );
}
