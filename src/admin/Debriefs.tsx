import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DebriefCard, DEBRIEF_COLS, type DebriefRow } from '../components/Debrief';
import { useNewStaffRatings, RatingRow } from './NewStaffRatings';
import { StaffProfile } from './StaffProfile';
import type { AStaff } from './api';

/** Nov 8 · Today v4 (080) · Past debriefs + Past ratings. Every debrief is kept here forever, archived or not. */
const ROUGH = (r: DebriefRow) => r.night === 'rough' || r.night === 'issues' || r.client === 'no' || r.client === 'mixed';
export function Debriefs() {
  const [params, setParams] = useSearchParams(); const tab = params.get('tab') === 'ratings' ? 'ratings' : 'debriefs';
  const [rows, setRows] = useState<DebriefRow[] | null>(null);
  const [f, setF] = useState<'all' | 'rough'>('all'); const [who, setWho] = useState(''); const [q, setQ] = useState('');
  const cols = DEBRIEF_COLS + 'night,client,difficulty,team_size,issues,what,note,created_at,staff:staff!event_debriefs_by_staff_fkey(full_name,nickname),events(title,event_date)';
  useEffect(() => { supabase.from('event_debriefs').select(cols).order('created_at', { ascending: false }).limit(1000).then(({ data, error }) => setRows(error ? [] : ((data ?? []) as unknown as DebriefRow[]))); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mds = useMemo(() => [...new Set((rows ?? []).map((r) => r.staff?.full_name).filter(Boolean))].sort() as string[], [rows]);
  const list = (rows ?? []).filter((r) => (f === 'all' || ROUGH(r)) && (!who || r.staff?.full_name === who)
    && (!q || [r.events?.title, r.what, r.note, ...(r.issues ?? [])].join(' ').toLowerCase().includes(q.toLowerCase())));
  const nsr = useNewStaffRatings(0, 365); const [prof, setProf] = useState<AStaff | null>(null);
  const setTab = (t: string) => { const p = new URLSearchParams(params); if (t === 'ratings') p.set('tab', 'ratings'); else p.delete('tab'); setParams(p, { replace: true }); };
  return (
    <div className="stack-lg">
      <div className="toolbar"><div><div className="kick"><Link to="/admin">‹ Today</Link></div><h1 className="serif-h">{tab === 'ratings' ? 'Past ratings' : 'Past debriefs'}</h1></div></div>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className={'abtn sm' + (tab === 'debriefs' ? ' dark' : '')} onClick={() => setTab('debriefs')}>Debriefs</button>
        <button className={'abtn sm' + (tab === 'ratings' ? ' dark' : '')} onClick={() => setTab('ratings')}>New staff ratings</button>
      </div>
      {tab === 'debriefs' ? <>
        <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
          <button className={'abtn sm' + (f === 'all' ? ' dark' : '')} onClick={() => setF('all')}>All</button>
          <button className={'abtn sm' + (f === 'rough' ? ' dark' : '')} onClick={() => setF('rough')}>Rough + issues only</button>
          <select className="abtn sm" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Manager"><option value="">Manager: any</option>{mds.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <input className="t4-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search event, notes" />
        </div>
        <div className="muted sm">Every debrief, kept forever · newest first{rows ? ` · ${list.length}` : ''}</div>
        {rows === null && <div className="muted">Loading…</div>}
        {rows && !list.length && <div className="adm-card muted">No debriefs{f === 'rough' || who || q ? ' for this filter' : ' yet'}.</div>}
        {list.length > 0 && <div className="adm-card t4-card">{list.map((r) => <div key={r.id}><DebriefCard r={r} withEvent />{r.event_id && <Link className="lnk sm t4-evlink" to={`/admin/event/${r.event_id}`}>Event ›</Link>}</div>)}</div>}
      </> : <>
        <div className="muted sm">New staff (first shifts) · last 12 months · archived ones included</div>
        {!nsr.rows.length && <div className="adm-card muted">No ratings yet.</div>}
        {nsr.rows.length > 0 && <div className="adm-card t4-card">{nsr.rows.map((r) => <RatingRow key={r.f.id} r={r} onOpen={() => setProf(r.s)} archivedAt={nsr.arch[r.f.id]} />)}</div>}
        {prof && <StaffProfile s={prof} all={nsr.staff} onClose={() => setProf(null)} onEdit={() => { window.location.href = `/admin/staff?open=${prof.id}`; }} />}
      </>}
    </div>
  );
}

/** Event page · earlier debriefs for the same event name (venue / client), so the next one starts with what went wrong. */
export function PastDebriefsFor({ title, eventId }: { title: string; eventId: string }) {
  const [rows, setRows] = useState<DebriefRow[]>([]);
  useEffect(() => {
    supabase.from('event_debriefs').select(DEBRIEF_COLS + 'night,client,difficulty,team_size,issues,what,note,created_at,staff:staff!event_debriefs_by_staff_fkey(full_name,nickname),events!inner(title,event_date)')
      .eq('events.title', title).neq('event_id', eventId).order('created_at', { ascending: false }).limit(6)
      .then(({ data, error }) => { if (!error) setRows((data ?? []) as unknown as DebriefRow[]); });
  }, [title, eventId]);
  if (!rows.length) return null;
  return (
    <div className="adm-card stack" style={{ gap: 6 }}>
      <div className="row"><b className="serif" style={{ fontSize: 18 }}>Past debriefs · {title}</b><span className="grow" /><Link className="lnk sm" to="/admin/debriefs">All ›</Link></div>
      <div className="t4-card" style={{ padding: 0 }}>{rows.map((r) => <DebriefCard key={r.id} r={r} withEvent />)}</div>
    </div>
  );
}
