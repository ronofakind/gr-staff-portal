import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { isoDay, flagsOf, hoursBetween, dLabel, type AStaff, type Flag } from './api';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
type Sh = { id: string; planned_start: string; attendance: string | null; left_early?: boolean; punches: { punch_in: string | null; punch_out: string | null } | null; events: { event_date: string; title: string } };

/** Side panel (desktop) / full screen (phone) with everything about one person. */
export function StaffProfile({ s, onClose, onEdit }: { s: AStaff; onClose: () => void; onEdit: () => void }) {
  const today = isoDay(new Date());
  const [week, setWeek] = useState<Record<number, { status: string; from_time: string | null }>>({});
  const [off, setOff] = useState<{ id: string; from_date: string; to_date: string; reason: string | null; every_dow: number | null; added_by_admin: boolean; created_at: string; days_off_private: { note: string | null } | null }[]>([]);
  const [toff, setToff] = useState<{ mode: 'day' | 'range' | 'week'; from: string; to: string; dow: number; note: string }>({ mode: 'day', from: today, to: today, dow: 0, note: '' });
  const [toffMsg, setToffMsg] = useState('');
  const [sex, setSex] = useState<'m' | 'f' | null>(s.sex ?? null);
  useEffect(() => setSex(s.sex ?? null), [s.id]);
  const [shifts, setShifts] = useState<Sh[]>([]);
  const [notes, setNotes] = useState(s.staff_private?.notes ?? ''); const [saved, setSaved] = useState(true);

  useEffect(() => {
    setNotes(s.staff_private?.notes ?? ''); setSaved(true);
    Promise.all([
      supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', s.id),
      supabase.from('days_off').select('id,from_date,to_date,reason,every_dow,added_by_admin,created_at,days_off_private(note)').eq('staff_id', s.id).gte('to_date', today).order('from_date'),
      supabase.from('shifts').select('id,planned_start,attendance,left_early,punches(punch_in,punch_out),events!inner(event_date,title)').eq('staff_id', s.id).neq('status', 'declined')
        .gte('events.event_date', today.slice(0, 4) + '-01-01'),
    ]).then(([w, o, sh]) => {
      setWeek(Object.fromEntries(((w.data ?? []) as { dow: number; status: string; from_time: string | null }[]).map((x) => [x.dow, x])));
      setOff((o.data ?? []) as unknown as typeof off);
      setShifts(((sh.data ?? []) as unknown as Sh[]).sort((a, b) => b.events.event_date.localeCompare(a.events.event_date)));
    });
  }, [s.id]);

  const reloadOff = () => supabase.from('days_off').select('id,from_date,to_date,reason,every_dow,added_by_admin,created_at,days_off_private(note)').eq('staff_id', s.id).gte('to_date', today).order('from_date').then(({ data }) => setOff((data ?? []) as unknown as typeof off));
  const DOWL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const addOff = async () => {
    setToffMsg('');
    const from = toff.mode === 'week' ? today : toff.from; const to = toff.mode === 'day' ? toff.from : toff.mode === 'week' ? `${Number(today.slice(0, 4)) + 1}${today.slice(4)}` : toff.to;
    if (!from || !to || to < from) return setToffMsg('Check the dates.');
    const clash = shifts.filter((x) => x.events.event_date >= from && x.events.event_date <= to && (toff.mode !== 'week' || (new Date(x.events.event_date + 'T12:00:00').getDay() + 6) % 7 === toff.dow));
    // Every week = one row per date for a year (the staff calendar already shows single days correctly).
    const dates: string[] = [];
    if (toff.mode === 'week') { for (let d = new Date(from + 'T12:00:00'); dates.length < 53 && isoDay(d) <= to; d.setDate(d.getDate() + 1)) if ((d.getDay() + 6) % 7 === toff.dow) dates.push(isoDay(d)); }
    const rowsIn = toff.mode === 'week' ? dates.map((d) => ({ staff_id: s.id, from_date: d, to_date: d, every_dow: toff.dow, added_by_admin: true })) : [{ staff_id: s.id, from_date: from, to_date: to, every_dow: null, added_by_admin: true }];
    const { data, error } = await supabase.from('days_off').insert(rowsIn).select('id');
    if (error) return setToffMsg(error.message);
    if (toff.note.trim()) await supabase.from('days_off_private').insert((data ?? []).map((r: { id: string }) => ({ day_off_id: r.id, note: toff.note.trim() })));
    setToff({ ...toff, note: '' }); reloadOff();
    setToffMsg(clash.length ? `Saved. ⚠ Already booked: ${clash.map((x) => `${dLabel(x.events.event_date)} ${x.events.title}`).join(', ')}` : 'Saved.');
  };
  const removeOff = async (o: (typeof off)[number]) => {
    if (o.every_dow != null) await supabase.from('days_off').delete().eq('staff_id', s.id).eq('every_dow', o.every_dow).gte('from_date', today);
    else await supabase.from('days_off').delete().eq('id', o.id);
    reloadOff();
  };
  const offShown = off.filter((o, i) => o.every_dow == null || off.findIndex((x) => x.every_dow === o.every_dow) === i);
  const month = shifts.filter((x) => x.events.event_date.slice(0, 7) === today.slice(0, 7));
  const monthHours = month.reduce((n, x) => n + hoursBetween(x.punches?.punch_in ?? null, x.punches?.punch_out ?? null, x.left_early), 0);
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
            <div className="muted sm">{s.nickname ? `"${s.nickname}" · ` : ''}{s.positions.join(', ') || s.role}{s.role !== 'staff' ? ` · ${s.role}` : ''}</div>
            <div className="row sm" style={{ gap: 6, marginTop: 4 }}>{s.staff_private?.tier && <i className={'tier-dot ' + s.staff_private.tier}>{s.staff_private.tier}</i>}{s.staff_private?.ranking != null && <b>#{s.staff_private.ranking}</b>}<span className="muted">· {s.language.toUpperCase()}</span></div></div>
        </div>
        <div className="row sm" style={{ gap: 8 }}><span className="muted">Uniform line</span>
          <div className="seg">{([['m', 'Men'], ['f', 'Women']] as const).map(([k, l]) => <button key={k} className={sex === k ? 'on' : ''} onClick={async () => { setSex(k); await supabase.from('staff').update({ sex: k }).eq('id', s.id); }}>{l}</button>)}</div>
          {!sex && <span className="accent">not set · they see the men's line</span>}</div>
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
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">TIME OFF</span><span className="muted sm">on their calendar as days off</span></div>
          {offShown.map((o) => (
            <div key={o.id} className="toff-row"><div className="grow"><b>{o.every_dow != null ? `Every ${DOWL[o.every_dow]}` : o.from_date === o.to_date ? dLabel(o.from_date) : `${dLabel(o.from_date)} – ${dLabel(o.to_date)}`}{o.days_off_private?.note ? ` · ${o.days_off_private.note}` : o.reason ? ` · ${o.reason}` : ''}</b>
              <small>{o.added_by_admin ? 'added by G&R' : 'they added it'} · {dLabel(o.created_at.slice(0, 10))}</small></div><button className="sq" aria-label="Remove time off" onClick={() => removeOff(o)}>×</button></div>
          ))}
          {!offShown.length && <div className="muted sm">None coming up.</div>}
          <div className="toff-add">
            <b className="sm">+ Add time off</b>
            <div className="seg">{([['day', 'One day'], ['range', 'Date range'], ['week', 'Every week']] as const).map(([k, l]) => <button key={k} className={toff.mode === k ? 'on' : ''} onClick={() => setToff({ ...toff, mode: k })}>{l}</button>)}</div>
            {toff.mode === 'week' ? <select value={toff.dow} onChange={(e) => setToff({ ...toff, dow: Number(e.target.value) })}>{DOWL.map((d, i) => <option key={d} value={i}>Every {d}</option>)}</select>
              : <div className="row" style={{ gap: 8 }}><input type="date" value={toff.from} onChange={(e) => setToff({ ...toff, from: e.target.value, to: toff.to < e.target.value ? e.target.value : toff.to })} />{toff.mode === 'range' && <input type="date" value={toff.to} min={toff.from} onChange={(e) => setToff({ ...toff, to: e.target.value })} />}</div>}
            <input placeholder="Reason (optional, only you see it)" value={toff.note} onChange={(e) => setToff({ ...toff, note: e.target.value })} />
            <button className="abtn dark" onClick={addOff}>Save time off</button>
            {toffMsg && <span className={'sm ' + (toffMsg.startsWith('Saved.') && !toffMsg.includes('⚠') ? 'okc' : 'accent')}>{toffMsg}</span>}
            <span className="muted sm">They're skipped in availability asks for those dates. If they're already booked, you get a warning.</span>
          </div>
        </div>
        <div className="pcard">
          <div className="kick">USUAL WEEK</div>
          <div className="wk7">{DOW.map((d, i) => { const w = week[i]; return <span key={i} className={w?.status ?? 'unset'} title={w && w.status !== 'no' && w.from_time ? `from ${ampm(w.from_time)}` : ''}>{d}{w && w.status !== 'no' && w.from_time ? <small>{ampm(w.from_time).replace(' ', '')}</small> : null}</span>; })}</div>
          {!Object.keys(week).length && <div className="muted sm">Not set yet.</div>}
        </div>
        <div className="pcard">
          <div className="kick">ADMIN NOTES · NEVER SHOWN TO STAFF</div>
          <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} onBlur={() => !saved && saveNotes()} placeholder="Great with VIP tables…" />
          {!saved && <button className="abtn sm dark" onClick={saveNotes}>Save note</button>}
        </div>
        <div className="row wrap"><button className="abtn" onClick={onEdit}>Edit details</button><Link className="abtn" to="/admin/tiers">Change tier</Link></div>
        {s.active && <button className="lnk accent" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (confirm(`Mark ${s.full_name} inactive? They stay in the history.`)) { await supabase.from('staff').update({ active: false }).eq('id', s.id); onClose(); } }}>Mark inactive</button>}
      </aside>
    </>
  );
}
