import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AnnounceComposer, AnnounceSent, type Target } from '../components/Announce';
import { eventsBetween, allStaff, isoDay, addDays, dLabel, ap12, type AEvent, type AStaff } from './api';

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });

/** Admin → Messages (push 25e): one-way announcements to everyone / a day / an event / a start group / one person. */
export function Messages() {
  const today = isoDay(new Date());
  const [evs, setEvs] = useState<AEvent[]>([]); const [staff, setStaff] = useState<AStaff[]>([]);
  const [kind, setKind] = useState<'event' | 'group' | 'day' | 'person' | 'all'>('event');
  const [evId, setEvId] = useState(''); const [start, setStart] = useState(''); const [day, setDay] = useState(today); const [person, setPerson] = useState('');
  const [compose, setCompose] = useState(false); const [tick, setTick] = useState(0);
  useEffect(() => { eventsBetween(today, addDays(today, 14)).then((e) => { setEvs(e); setEvId(e[0]?.id ?? ''); }); allStaff().then(setStaff); }, [today]);
  const ev = evs.find((e) => e.id === evId);
  const team = ev ? ev.shifts.filter((s) => s.status !== 'declined' && !s.attendance) : [];
  const groups = [...new Set(team.map((s) => s.planned_start))].sort();
  const dayN = evs.filter((e) => e.event_date === day).reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0);
  const p = staff.find((s) => s.full_name === person);
  const target: Target | null = kind === 'event' && ev ? { key: 'e', label: `${ev.title} · whole team`, n: team.length, audience: { kind: 'event' }, event_id: ev.id }
    : kind === 'group' && ev && start ? { key: 'g', label: `${ev.title} · ${ap12(hm(start))}`, n: team.filter((s) => s.planned_start === start).length, audience: { kind: 'group', start }, event_id: ev.id }
    : kind === 'day' ? { key: 'd', label: dLabel(day), n: dayN, audience: { kind: 'day', date: day }, event_id: null }
    : kind === 'person' && p ? { key: 'p', label: p.full_name, n: 1, audience: { kind: 'people', ids: [p.id] }, event_id: null }
    : kind === 'all' ? { key: 'a', label: 'Everyone', n: staff.filter((s) => s.active).length, audience: { kind: 'all' }, event_id: null } : null;
  return (
    <div className="stack-lg">
      <div className="toolbar"><div><div className="kick">ONE-WAY · THEY CAN’T REPLY</div><h1 className="serif-h">Messages</h1></div></div>
      <div className="adm-card stack" style={{ gap: 12, maxWidth: 640 }}>
        <div className="seg3">{([['event', 'An event'], ['group', 'A start group'], ['day', 'A day'], ['person', 'One person'], ['all', 'Everyone']] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
        {(kind === 'event' || kind === 'group') && <select value={evId} onChange={(e) => { setEvId(e.target.value); setStart(''); }} className="msg-in">{evs.map((e) => <option key={e.id} value={e.id}>{dLabel(e.event_date)} · {e.title}{e.department === 'bar' ? ' · BAR' : ''}</option>)}</select>}
        {kind === 'group' && <select value={start} onChange={(e) => setStart(e.target.value)} className="msg-in"><option value="">Pick a start time…</option>{groups.map((g) => <option key={g} value={g}>{ap12(hm(g))} · {team.filter((s) => s.planned_start === g).length} people</option>)}</select>}
        {kind === 'day' && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="msg-in" />}
        {kind === 'person' && <><input list="msg-people" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Search staff…" className="msg-in" /><datalist id="msg-people">{staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.full_name} />)}</datalist></>}
        <button className="abtn dark" disabled={!target || !target.n} onClick={() => setCompose(true)}>Write to {target ? `${target.label} · ${target.n}` : '…'}</button>
        <small className="muted">They see a red card on Home until they open it, and tap “Got it ✓”. Phone buzz comes with app notifications (push 24).</small>
      </div>
      <div className="sec"><span className="serif">Sent</span></div>
      <div className="adm-card" style={{ maxWidth: 760 }}><AnnounceSent reload={tick} /></div>
      {compose && target && (
        <div className="bk-modal" onClick={() => setCompose(false)}><div className="adm-card" onClick={(e) => e.stopPropagation()}>
          <AnnounceComposer targets={[target]} folder={target.event_id ?? 'all'} onClose={() => setCompose(false)} onSent={() => { setCompose(false); setTick((t) => t + 1); }} />
        </div></div>
      )}
      {void supabase}
    </div>
  );
}
