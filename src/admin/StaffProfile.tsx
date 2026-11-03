import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { isoDay, flagsOf, hoursBetween, dLabel, allStaff, type AStaff, type Flag, type Venue } from './api';
import { loadRules, linksOf, other, condLabel, DOW3, type SLink, type SCond, type LinkKind, type CondKind } from './rules';
import { loadScoreData, scoreOf, AREAS, avgStars, isStar, type ScoreData } from './score';
import { ScoreWhy } from './Ranking';
import { appStatus, loadInviteStatus, InviteModal, AppChip, type InviteRow } from './Invite';

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
type Sh = { id: string; planned_start: string; attendance: string | null; left_early?: boolean; punches: { punch_in: string | null; punch_out: string | null } | null; events: { event_date: string; title: string } };

/** Side panel (desktop) / full screen (phone) with everything about one person. */
export function StaffProfile({ s, onClose, onEdit, all }: { s: AStaff; onClose: () => void; onEdit: () => void; all?: AStaff[] }) {
  const today = isoDay(new Date());
  const [week, setWeek] = useState<Record<number, { status: string; from_time: string | null }>>({});
  const [off, setOff] = useState<{ id: string; from_date: string; to_date: string; reason: string | null; every_dow: number | null; added_by_admin: boolean; created_at: string; days_off_private: { note: string | null } | null }[]>([]);
  const [toff, setToff] = useState<{ mode: 'day' | 'range' | 'week'; from: string; to: string; dow: number; note: string }>({ mode: 'day', from: today, to: today, dow: 0, note: '' });
  const [toffMsg, setToffMsg] = useState('');
  const [sex, setSex] = useState<'m' | 'f' | null>(s.sex ?? null);
  useEffect(() => setSex(s.sex ?? null), [s.id]);
  const [shifts, setShifts] = useState<Sh[]>([]);
  // push 34a · Invite / Resend (same pop-up as the Staff list)
  const [inv, setInv] = useState<InviteRow | null | undefined>(undefined); const [inviting, setInviting] = useState(false);
  const loadInv = () => loadInviteStatus().then((m) => setInv(typeof m === 'string' ? null : m[s.id] ?? null));
  useEffect(() => { loadInv(); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [notes, setNotes] = useState(s.staff_private?.notes ?? ''); const [saved, setSaved] = useState(true);
  const [people, setPeople] = useState<AStaff[]>(all ?? []); const [venues, setVenues] = useState<Venue[]>([]);
  const [links, setLinks] = useState<SLink[]>([]); const [conds, setConds] = useState<SCond[]>([]); const [adding, setAdding] = useState(false);
  const [sd, setSd] = useState<ScoreData | null>(null); const [tierNow, setTierNow] = useState(s.staff_private?.tier ?? null);
  const reloadRules = () => loadRules().then((r) => { setLinks(r.links); setConds(r.conds); });
  useEffect(() => {
    reloadRules(); loadScoreData().then(setSd); setTierNow(s.staff_private?.tier ?? null);
    if (!all?.length) allStaff().then(setPeople);
    supabase.from('venues').select('id,name').order('name').then(({ data }) => setVenues(Array.isArray(data) ? (data as Venue[]) : []));
  }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="grid-3btn" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
          {tel ? <a className="abtn ok" href={`tel:${tel}`}>Call</a> : <span className="abtn" aria-disabled>No phone</span>}
          {tel ? <a className="abtn dark" href={`sms:${tel}`}>Text</a> : <span />}
          <Link className="abtn dark" to={`/admin/messages?staff=${s.id}`}>✉ Message</Link>
          <Link className="abtn" to={`/admin/view/${s.id}`}>View as</Link>
        </div>
        {inv !== undefined && (() => { const ap = appStatus(s, inv); return (
          <div className="row sm sp-app" style={{ gap: 8 }}><span className="muted">App</span><AppChip st={ap} />
            {ap.action && <button className={'abtn sm' + (ap.action === 'Invite' ? ' dark' : '')} style={{ marginLeft: 'auto' }} onClick={() => (ap.action === 'Invite' || ap.action === 'Resend' ? setInviting(true) : onEdit())}>{ap.action}</button>}</div>); })()}
        <div className="pcard"><div className="kick">THIS MONTH</div><div className="row" style={{ gap: 20 }}><b className="big">{month.length} <small>shifts</small></b><b className="big">{monthHours} <small>hrs</small></b></div></div>
        {sd && <div className="pcard"><div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">SCORE</span><Link to="/admin/ranking" className="sm accent strong">Ranking ›</Link></div>
          <ScoreWhy compact s={{ ...s, staff_private: s.staff_private ? { ...s.staff_private, tier: tierNow } : s.staff_private }} sc={scoreOf({ ...s, staff_private: s.staff_private ? { ...s.staff_private, tier: tierNow } : s.staff_private }, sd)}
            onTier={() => supabase.from('staff_private').select('tier').eq('staff_id', s.id).maybeSingle().then(({ data }) => setTierNow(((data as { tier?: 'A' | 'B' | 'C' | null } | null)?.tier) ?? null))} /></div>}
        {sd && <MgrFeedback sid={s.id} d={sd} />}
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
        <div className="pcard ru-card">
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">BOOKING RULES · NEVER SHOWN TO STAFF</span><button className="lnk accent" style={{ textDecoration: 'none', fontSize: 13, whiteSpace: 'nowrap', marginLeft: 8 }} onClick={() => setAdding(true)}>+ Add</button></div>
          {(['together', 'apart'] as LinkKind[]).map((k) => { const ls = linksOf(links, s.id, k); if (!ls.length) return null; return (
            <div key={k} className="ru-grp"><div className={'ru-h ' + (k === 'together' ? 'okc' : 'accent')}>{k === 'together' ? 'WORKS WELL WITH' : 'KEEP APART FROM'} · {ls.length}</div>
              {ls.map((l) => { const o = people.find((p) => p.id === other(l, s.id)); return (
                <div key={l.staff_a + l.staff_b} className={'ru-row ' + k}><Avatar name={o?.full_name ?? '?'} url={o?.photo_url} size={30} />
                  <div className="grow"><b>{o?.full_name ?? 'Someone'}</b><small>{l.reason || (k === 'apart' ? 'not on the same event' : 'book together when you can')}</small></div>
                  <button className="ru-x" aria-label="Remove rule" onClick={async () => { if (!confirm(`Remove this rule for ${s.full_name.split(' ')[0]} and ${o?.full_name.split(' ')[0] ?? 'them'}?`)) return; await supabase.from('staff_links').delete().eq('staff_a', l.staff_a).eq('staff_b', l.staff_b); reloadRules(); }}>×</button></div>); })}
            </div>); })}
          {conds.some((c) => c.staff_id === s.id) && <div className="ru-grp"><div className="ru-h gold">WHEN TO BOOK · {conds.filter((c) => c.staff_id === s.id).length}</div>
            {conds.filter((c) => c.staff_id === s.id).map((c) => (
              <div key={c.id} className="ru-row when"><span className="ru-ic">{c.kind === 'not_venue' || c.kind === 'private_only' ? '⌂' : c.kind === 'big_dates_only' ? '◆' : c.kind === 'only_if_needed' ? '…' : c.kind === 'not_weekday' ? '◷' : '#'}</span>
                <div className="grow"><b>{condLabel(c)}</b>{c.reason && <small>{c.reason}</small>}</div>
                {c.kind !== 'min_guests' ? <button className="ru-x" aria-label="Remove rule" onClick={async () => { await supabase.from('staff_conditions').delete().eq('id', c.id); reloadRules(); }}>×</button> : <small className="muted">read-only</small>}</div>))}
          </div>}
          {!linksOf(links, s.id).length && !conds.some((c) => c.staff_id === s.id) && <div className="muted sm">No rules. + Add to set who they work well with, who to keep apart, or when to book them.</div>}
          <div className="muted sm">Bookings and Auto-fill follow these. Changes save right away.</div>
        </div>
        <EmergencyCard key={'em' + s.id} s={s} />
        <AboutCard key={s.id} s={s} people={people} />
        <div className="pcard">
          <div className="kick">ADMIN NOTES · NEVER SHOWN TO STAFF</div>
          <textarea rows={3} value={notes} onChange={(e) => { setNotes(e.target.value); setSaved(false); }} onBlur={() => !saved && saveNotes()} placeholder="Great with VIP tables…" />
          {!saved && <button className="abtn sm dark" onClick={saveNotes}>Save note</button>}
        </div>
        <div className="row wrap"><button className="abtn" onClick={onEdit}>Edit details</button><Link className="abtn" to="/admin/tiers">Change tier</Link></div>
        {s.active && <button className="lnk accent" style={{ alignSelf: 'flex-start' }} onClick={async () => { if (confirm(`Mark ${s.full_name} inactive? They stay in the history.`)) { await supabase.from('staff').update({ active: false }).eq('id', s.id); onClose(); } }}>Mark inactive</button>}
      </aside>
      {inviting && <InviteModal queue={[s]} onClose={() => { setInviting(false); loadInv(); }} onChanged={loadInv} onFix={() => { setInviting(false); onEdit(); }} />}
      {adding && <AddRule s={s} people={people} venues={venues} links={links} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reloadRules(); }} />}
    </>
  );
}

const KINDS: { k: LinkKind | CondKind; label: string; ic: string; cls: string }[] = [
  { k: 'together', label: 'Works well with', ic: '♥', cls: 'ok' }, { k: 'apart', label: 'Keep apart from', ic: '⊘', cls: 'red' },
  { k: 'not_venue', label: 'Not at a venue', ic: '⌂', cls: 'gold' }, { k: 'private_only', label: 'Private houses only', ic: '⌂', cls: 'gold' },
  { k: 'big_dates_only', label: 'Big dates only', ic: '◆', cls: 'gold' }, { k: 'only_if_needed', label: 'Only if needed', ic: '…', cls: 'gold' },
  { k: 'not_weekday', label: 'Not on certain days', ic: '◷', cls: 'gold' },
];

/** + Add a booking rule: kind → who / venue / days → optional reason → Save. Pairs are one row (shows on both profiles). */
function AddRule({ s, people, venues, links, onClose, onSaved }: { s: AStaff; people: AStaff[]; venues: Venue[]; links: SLink[]; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<LinkKind | CondKind>('together');
  const [q, setQ] = useState(''); const [who, setWho] = useState<AStaff | null>(null);
  const [venue, setVenue] = useState(''); const [days, setDays] = useState<string[]>([]); const [reason, setReason] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const pair = kind === 'together' || kind === 'apart';
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = q.trim().length < 2 ? [] : people.filter((p) => p.active && p.id !== s.id && norm(p.full_name + ' ' + (p.nickname ?? '')).includes(norm(q.trim()))).slice(0, 6);
  const f = (n: string) => n.split(' ')[0];
  const save = async () => {
    setErr('');
    if (pair && !who) return setErr('Pick who.');
    if (kind === 'not_venue' && !venue) return setErr('Pick the venue.');
    if (kind === 'not_weekday' && !days.length) return setErr('Pick at least one day.');
    setBusy(true);
    let error;
    if (pair) {
      const [a, b] = [s.id, who!.id].sort();
      const had = links.find((l) => l.staff_a === a && l.staff_b === b);
      if (had && had.kind !== kind && !confirm(`They already have a "${had.kind === 'together' ? 'works well with' : 'keep apart'}" rule. Replace it?`)) { setBusy(false); return; }
      ({ error } = await supabase.from('staff_links').upsert({ staff_a: a, staff_b: b, kind, reason: reason.trim() || null }, { onConflict: 'staff_a,staff_b' }));
    } else {
      const value = kind === 'not_venue' ? venue : kind === 'not_weekday' ? DOW3.filter((d) => days.includes(d)).join(',') : null;
      ({ error } = await supabase.from('staff_conditions').insert({ staff_id: s.id, kind, value, reason: reason.trim() || null }));
    }
    setBusy(false);
    if (error) return setErr(error.message);
    onSaved();
  };
  return (
    <div className="bk-modal ru-modal" onClick={onClose}><div className="adm-card ru-add" onClick={(e) => e.stopPropagation()}>
      <div className="spread"><b className="serif" style={{ fontSize: 22 }}>Add a rule · {f(s.full_name)}</b><button className="sq" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="kick">WHAT KIND</div>
      <div className="ru-kinds">{KINDS.map((x) => <button key={x.k} className={'ru-kind ' + x.cls + (kind === x.k ? ' on' : '')} onClick={() => { setKind(x.k); setErr(''); }}><span className="ru-ic">{x.ic}</span><b className="grow">{x.label}</b>{kind === x.k && <span className="okc">✓</span>}</button>)}</div>
      {pair && <>
        <div className="kick">WHO</div>
        {who ? <div className="ru-row"><Avatar name={who.full_name} url={who.photo_url} size={30} /><div className="grow"><b>{who.full_name}</b><small>{who.positions.join(', ').toLowerCase() || who.role}{who.staff_private?.tier ? ` · ${who.staff_private.tier}` : ''}</small></div><button className="ru-x" onClick={() => { setWho(null); setQ(''); }}>×</button></div>
          : <><input className="search" autoFocus placeholder="Search a name…" value={q} onChange={(e) => setQ(e.target.value)} />
            {list.map((p) => <button key={p.id} className="ru-opt" onClick={() => setWho(p)}><Avatar name={p.full_name} url={p.photo_url} size={28} /><b className="grow">{p.full_name}</b><span className="muted">›</span></button>)}</>}
      </>}
      {kind === 'not_venue' && <><div className="kick">WHICH VENUE</div>
        <select value={venue} onChange={(e) => setVenue(e.target.value)}><option value="">Pick a venue…</option>{venues.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}</select></>}
      {kind === 'not_weekday' && <><div className="kick">WHICH DAYS</div>
        <div className="row wrap" style={{ gap: 6 }}>{DOW3.map((d) => <button key={d} className={'chipb' + (days.includes(d) ? ' on' : '')} onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>{d}</button>)}</div></>}
      <input className="search" placeholder={pair ? 'Why? (optional · e.g. friend, carpool)' : 'Why? (optional)'} value={reason} onChange={(e) => setReason(e.target.value)} />
      {pair && who && <div className="muted sm">✓ Also shows on {f(who.full_name)}’s profile (one rule for the pair).</div>}
      {err && <p className="error">{err}</p>}
      <button className="abtn dark" style={{ height: 46 }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rule'}</button>
    </div></div>
  );
}

/** Read-only 5 stars (admin). */
const StarRow = ({ v, size = 'sm' }: { v: number; size?: 'xs' | 'sm' }) => <span className={'stars ' + size} role="img" aria-label={`${v} of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= Math.round(v) ? 'on' : ''}>★</i>)}</span>;

/** MANAGER FEEDBACK card (push 30): average overall stars + count, average stars per area, tier votes, recent items with stars, manager + comment.
 *  Older rows (before stars) show their A/B/C and ▲ ▼ as before. */
function MgrFeedback({ sid, d }: { sid: string; d: ScoreData }) {
  const mine = d.feedback.filter((f) => f.staff_id === sid);
  if (!mine.length) return <div className="pcard"><div className="kick">MANAGER FEEDBACK</div><div className="muted sm">No feedback yet.</div></div>;
  const votes = { A: 0, B: 0, C: 0 }; for (const f of mine) if (f.tier_vote) votes[f.tier_vote]++;
  const rated = mine.filter((f) => f.overall_stars).map((f) => f.overall_stars as number); const avg = avgStars(rated);
  const area = AREAS.map((a) => { const v = mine.filter((f) => f.overall_stars).map((f) => f.ratings?.[a.key]).filter(isStar); return { a, n: v.length, m: avgStars(v) }; });
  return (
    <div className="pcard">
      <div className="kick">MANAGER FEEDBACK · {mine.length}</div>
      <div className="fb-overall">
        {rated.length ? <><b className="serif">{avg.toFixed(1)}</b><div><StarRow v={avg} /><small className="muted">overall · {rated.length} rating{rated.length > 1 ? 's' : ''}</small></div></>
          : <small className="muted">No star ratings yet (older feedback below).</small>}
        <div className="fb-votes-sm">{(['A', 'B', 'C'] as const).map((t) => <span key={t} className={'fbv-sm ' + t}>{t} <b>{votes[t]}</b></span>)}<small className="muted">worked like</small></div>
      </div>
      <div className="fb-avg">{area.map(({ a, n, m }) => <div key={a.key}><span>{a.label}</span>{n ? <><StarRow v={m} size="xs" /><b className={m >= 4 ? 'okc' : m <= 2 ? 'accent' : ''}>{m.toFixed(1)}</b></> : <b className="muted">–</b>}<small className="muted">{n ? `${n}` : ''}</small></div>)}</div>
      {mine.slice(0, 5).map((f) => {
        const st = f.overall_stars;
        const det = st ? AREAS.filter((a) => isStar(f.ratings?.[a.key])).map((a) => `${a.label} ${f.ratings[a.key]}★`)
          : AREAS.filter((a) => f.ratings?.[a.key] === 'up').map((a) => a.label + ' ▲').concat(AREAS.filter((a) => f.ratings?.[a.key] === 'down').map((a) => a.label + ' ▼'));
        return (
          <div key={f.id} className="fb-item"><div className="spread"><b>{f.by?.full_name?.split(' ')[0] ?? 'Manager'} · {f.events?.title ?? ''}{f.events?.event_date ? ` · ${dLabel(f.events.event_date)}` : ''}</b>
            <span className="fb-it-r">{st ? <StarRow v={st} /> : <small className="muted">before stars</small>}{f.tier_vote && <i className={'tier-dot ' + f.tier_vote}>{f.tier_vote}</i>}</span></div>
            {det.length > 0 && <small>{det.join(' · ')}</small>}
            {f.note && <span>“{f.note}”</span>}</div>); })}
    </div>
  );
}

/** EMERGENCY CONTACT · admin only (push 31): from the profile check-up, + neighbourhood and when the check-up was done. */
function EmergencyCard({ s }: { s: AStaff }) {
  type Em = { emergency_name: string | null; emergency_relation: string | null; emergency_phone: string | null; neighbourhood: string | null; checkup_done_at: string | null; checkup_step: number | null; emergency_snooze_until?: string | null; emergency_declined_at?: string | null };
  const [e, setE] = useState<Em | null>(null); const [err, setErr] = useState('');
  useEffect(() => {
    const cols = 'emergency_name,emergency_relation,emergency_phone,neighbourhood,checkup_done_at,checkup_step';
    (async () => { const r = await supabase.from('staff_private').select(cols + ',emergency_snooze_until,emergency_declined_at').eq('staff_id', s.id).maybeSingle();
      return r.error ? await supabase.from('staff_private').select(cols).eq('staff_id', s.id).maybeSingle() : r; })().then(({ data, error }: { data: unknown; error: { message: string } | null }) => {
      if (error) { setErr(/column|schema/i.test(error.message) ? 'Needs migration 036 (not applied yet).' : error.message); return; }
      setE((data ?? { emergency_name: null, emergency_relation: null, emergency_phone: null, neighbourhood: null, checkup_done_at: null, checkup_step: null }) as Em);
    });
  }, [s.id]);
  const tel = e?.emergency_phone?.replace(/[^\d+]/g, '');
  const done = e?.checkup_done_at ? new Date(e.checkup_done_at) : null;
  return (
    <div className="pcard em-pcard">
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">EMERGENCY CONTACT · ADMIN ONLY</span>
        {e && <span className={'sm ' + (done ? 'okc' : 'muted')}>{done ? `Check-up done ${dLabel(isoDay(done), { month: 'short', day: 'numeric' })}, ${done.toLocaleTimeString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' })}` : `Check-up not done${(e.checkup_step ?? 1) > 1 ? ` · at step ${Math.min(6, e.checkup_step ?? 1)}` : ''}`}</span>}</div>
      {!e ? <div className="muted sm">{err || 'Loading…'}</div> : <>
        {e.emergency_phone ? (
          <div className="row" style={{ gap: 10 }}>
            <div className="grow"><b>{e.emergency_name ?? '—'}</b>{e.emergency_relation && <span className="muted"> · {e.emergency_relation}</span>}<div className="sm">{e.emergency_phone}</div></div>
            {tel && <a className="abtn sm ok" href={`tel:${tel}`}>Call</a>}
          </div>
        ) : <div className="muted sm">{e.emergency_declined_at ? `No emergency contact · chose not to add (${dLabel(isoDay(new Date(e.emergency_declined_at)), { month: 'short', day: 'numeric' })})`
          : e.emergency_snooze_until && new Date(e.emergency_snooze_until).getTime() > Date.now() ? `No emergency contact · asked to be reminded later (back ${dLabel(isoDay(new Date(e.emergency_snooze_until)), { month: 'short', day: 'numeric' })})`
          : done ? 'Skipped in the check-up · they see a reminder on their Home.' : 'Not given yet.'}</div>}
        <div className="sm"><span className="muted">Neighbourhood </span><b>{e.neighbourhood ?? '—'}</b></div>
        <div className="muted sm">Never shown to managers or other staff.</div>
      </>}
    </div>
  );
}

type About = { veteran: boolean | null; experience: 'SENIOR' | 'MID' | 'JUNIOR' | null; experience_note: string | null; knows_staff_id: string | null; knows_text: string | null; languages: Record<string, number> | null; manager_note: string | null };
const EXP: ['JUNIOR' | 'MID' | 'SENIOR', string][] = [['JUNIOR', 'Junior'], ['MID', 'Mid'], ['SENIOR', 'Senior']];
const LV: [number, string][] = [[1, 'Basic'], [2, 'Good'], [3, 'Fluent']];

/** ABOUT · managers see this (push 29): experience (1 tap) + note, knows (from application), languages (from onboarding), note for managers. */
function AboutCard({ s, people }: { s: AStaff; people: AStaff[] }) {
  const [a, setA] = useState<About | null>(null); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [q, setQ] = useState(''); const [pickOpen, setPickOpen] = useState(false);
  const [expNote, setExpNote] = useState(''); const [rel, setRel] = useState(''); const [mnote, setMnote] = useState('');
  useEffect(() => {
    supabase.from('staff_private').select('veteran,experience,experience_note,knows_staff_id,knows_text,languages,manager_note').eq('staff_id', s.id).maybeSingle().then(({ data, error }) => {
      if (error) { setErr(/column|schema/i.test(error.message) ? 'Needs migration 032 (not applied yet).' : error.message); return; }
      const d = (data ?? {}) as Partial<About>;
      const v: About = { veteran: d.veteran ?? null, experience: d.experience ?? null, experience_note: d.experience_note ?? null, knows_staff_id: d.knows_staff_id ?? null, knows_text: d.knows_text ?? null,
        languages: d.languages && typeof d.languages === 'object' && !Array.isArray(d.languages) ? d.languages : {}, manager_note: d.manager_note ?? null };
      setA(v); setExpNote(v.experience_note ?? ''); setRel(v.knows_text ?? ''); setMnote(v.manager_note ?? '');
    });
  }, [s.id]);
  const save = async (patch: Partial<About>) => {
    if (!a) return; setErr(''); setOk('');
    const prev = a; setA({ ...a, ...patch });
    const { error } = await supabase.from('staff_private').upsert({ staff_id: s.id, ...patch });
    if (error) { setA(prev); setErr(error.message); } else setOk('✓ Saved');
  };
  const norm = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = q.trim().length < 2 ? [] : people.filter((p) => p.active && p.id !== s.id && norm(p.full_name + ' ' + (p.nickname ?? '')).includes(norm(q.trim()))).slice(0, 6);
  const who = a?.knows_staff_id ? people.find((p) => p.id === a.knows_staff_id) : null;
  const blurSave = (k: 'experience_note' | 'knows_text' | 'manager_note', v: string) => { const t = v.trim() || null; if (a && (a[k] ?? null) !== t) save({ [k]: t }); };
  return (
    <div className="pcard ab-card">
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick">ABOUT · MANAGERS SEE THIS</span>{ok && <span className="ab-saved">{ok}</span>}</div>
      {!a ? <div className="muted sm">{err || 'Loading…'}</div> : <>
        <div className="ab-sec">
          <div className="ab-h"><span>EXPERIENCE</span><i className="ab-badge you">YOU · 1 TAP</i></div>
          <div className="seg">{EXP.map(([k, l]) => <button key={k} className={a.experience === k ? 'on' : ''} onClick={() => save({ experience: a.experience === k ? null : k })}>{l}</button>)}</div>
          <input placeholder="Short note (optional · e.g. 2 yrs restaurant)" maxLength={60} value={expNote} onChange={(e) => setExpNote(e.target.value)} onBlur={() => blurSave('experience_note', expNote)} />
        </div>
        <div className="ab-sec">
          <div className="ab-h"><span>KNOWS</span><i className="ab-badge app">FROM APPLICATION</i></div>
          {who || (a.knows_staff_id && !who) ? <div className="ru-row"><Avatar name={who?.full_name ?? '?'} url={who?.photo_url} size={30} /><div className="grow"><b>{who?.full_name ?? 'Someone (inactive)'}</b></div>
            <button className="ru-x" aria-label="Clear" onClick={() => { save({ knows_staff_id: null }); setPickOpen(false); }}>×</button></div>
            : pickOpen ? <><input autoFocus placeholder="Search an active staff member…" value={q} onChange={(e) => setQ(e.target.value)} />
              {list.map((p) => <button key={p.id} className="ru-opt" onClick={() => { save({ knows_staff_id: p.id }); setQ(''); setPickOpen(false); }}><Avatar name={p.full_name} url={p.photo_url} size={28} /><b className="grow">{p.full_name}</b><span className="muted">›</span></button>)}
              {q.trim().length >= 2 && !list.length && <span className="muted sm">No active staff by that name. Write it below instead.</span>}</>
            : <button className="lnk accent" style={{ alignSelf: 'flex-start', textDecoration: 'none', fontSize: 13 }} onClick={() => setPickOpen(true)}>+ Link a staff member</button>}
          <div className="row" style={{ gap: 6 }}>
            <input placeholder={a.knows_staff_id ? 'Relation (e.g. cousin, friend)' : 'Relation or name (e.g. referred by …)'} maxLength={60} value={rel} onChange={(e) => setRel(e.target.value)} onBlur={() => blurSave('knows_text', rel)} />
            {rel && <button className="ru-x" aria-label="Clear relation" onClick={() => { setRel(''); save({ knows_text: null }); }}>×</button>}
          </div>
        </div>
        <div className="ab-sec">
          <div className="ab-h"><span>LANGUAGES</span><i className="ab-badge onb">FROM ONBOARDING</i></div>
          {(['fr', 'en'] as const).map((k) => { const v = Number(a.languages?.[k] ?? 0); return (
            <div key={k} className="ab-lang"><b>{k.toUpperCase()}</b>
              <div className="seg">{LV.map(([n, l]) => <button key={n} className={v === n ? 'on' : ''} onClick={() => { const nx = { ...(a.languages ?? {}) }; if (v === n) delete nx[k]; else nx[k] = n; save({ languages: nx }); }}>{l}</button>)}</div></div>); })}
          {!Object.keys(a.languages ?? {}).length && <span className="muted sm">Not set · hidden from managers until set.</span>}
        </div>
        <div className="ab-sec">
          <div className="ab-h"><span>NOTE FOR MANAGERS</span></div>
          <input placeholder="One line (optional · e.g. strong on wine service)" maxLength={120} value={mnote} onChange={(e) => setMnote(e.target.value)} onBlur={() => blurSave('manager_note', mnote)} />
        </div>
        {err && <p className="error">{err}</p>}
        <div className="ab-foot">Managers never see tiers, rankings, ratings, rates or admin notes.</div>
      </>}
    </div>
  );
}
