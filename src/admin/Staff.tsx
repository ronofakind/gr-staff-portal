import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { allStaff, dLabel, type AStaff } from './api';
import { uploadPhoto } from '../lib/photo';
import { PhotoPicker, Avatar } from '../components/Avatar';
import { StaffProfile } from './StaffProfile';

type Off = { id: string; staff_id: string; from_date: string; to_date: string; every_dow: number | null };
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
type Sort = 'first' | 'last' | 'rank' | 'tier' | 'shifts' | 'newest';
const firstName = (s: AStaff) => (s.full_name.split(' ')[0] ?? '');
const lastName = (s: AStaff) => s.full_name.split(' ').slice(1).join(' ') || s.full_name;

export function Staff() {
  const [list, setList] = useState<AStaff[] | null>(null);
  const [q, setQ] = useState(''); const [inactive, setInactive] = useState(false);
  const [tier, setTier] = useState<'all' | 'A' | 'B' | 'C' | 'none'>('all');
  const [dept, setDept] = useState<'all' | 'floor' | 'bar' | 'md'>('all');
  const [sort, setSort] = useState<Sort>('first');
  const [open, setOpen] = useState<string | null>(null);
  const [prof, setProf] = useState<AStaff | null>(null);
  const [month, setMonth] = useState<Record<string, number>>({});
  const [off, setOff] = useState<Off[]>([]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const load = () => {
    allStaff().then(setList);
    supabase.from('shifts').select('staff_id,events!inner(event_date)').neq('status', 'declined').gte('events.event_date', today.slice(0, 8) + '01').lte('events.event_date', today.slice(0, 8) + '31')
      .then(({ data }) => { const m: Record<string, number> = {}; for (const r of (data ?? []) as { staff_id: string }[]) m[r.staff_id] = (m[r.staff_id] ?? 0) + 1; setMonth(m); });
    supabase.from('days_off').select('id,staff_id,from_date,to_date,every_dow').gte('to_date', today).order('from_date').then(({ data }) => setOff((data ?? []) as Off[]));
  };
  useEffect(() => { load(); }, []);

  const isMd = (s: AStaff) => s.positions.includes('MD') || s.positions.includes('BM') || s.role === 'manager';
  const base = (list ?? []).filter((s) => inactive || s.active)
    .filter((s) => dept === 'all' || (dept === 'md' ? isMd(s) : dept === 'bar' ? s.department === 'bar' : s.department !== 'bar'));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const digits = q.replace(/\D/g, '');
  const searched = base.filter((s) => words.every((w) => (s.full_name + ' ' + (s.nickname ?? '')).toLowerCase().includes(w)) || (digits.length >= 3 && (s.phone ?? '').replace(/\D/g, '').includes(digits)));
  const tOf = (s: AStaff) => s.staff_private?.tier ?? null;
  const count = (t: string) => searched.filter((s) => (t === 'none' ? !tOf(s) : tOf(s) === t)).length;
  const rows = searched.filter((s) => tier === 'all' || (tier === 'none' ? !tOf(s) : tOf(s) === tier)).sort((a, b) => {
    const r = (x: AStaff) => x.staff_private?.ranking ?? 9999;
    switch (sort) {
      case 'last': return lastName(a).localeCompare(lastName(b), 'fr');
      case 'rank': return r(a) - r(b);
      case 'tier': return (tOf(a) ?? 'Z').localeCompare(tOf(b) ?? 'Z') || r(a) - r(b);
      case 'shifts': return (month[b.id] ?? 0) - (month[a.id] ?? 0);
      case 'newest': return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      default: return a.full_name.localeCompare(b.full_name, 'fr', { sensitivity: 'base' });
    }
  });
  const letters = sort === 'first' || sort === 'last';
  const letterOf = (s: AStaff) => (sort === 'last' ? lastName(s) : firstName(s)).charAt(0).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const offText = (sid: string) => {
    const o = off.filter((x) => x.staff_id === sid); if (!o.length) return null;
    const w = o.find((x) => x.every_dow != null); if (w) return `every ${DOWS[w.every_dow!]}`;
    const f = o[0]; return f.from_date === f.to_date ? `off ${dLabel(f.from_date, { month: 'short', day: 'numeric' })}` : `off ${dLabel(f.from_date, { month: 'short', day: 'numeric' })} – ${f.from_date.slice(5, 7) === f.to_date.slice(5, 7) ? Number(f.to_date.slice(8)) : dLabel(f.to_date, { month: 'short', day: 'numeric' })}`;
  };
  const mName = new Date().toLocaleDateString('en-CA', { month: 'short', timeZone: 'America/Toronto' }).replace('.', '').toUpperCase();

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <h1>Staff <span className="muted" style={{ fontFamily: 'Inter', fontSize: 15 }}>{rows.length} {inactive ? '' : 'active'}</span></h1>
        <div className="row wrap"><span className="lock-pill">🔒 Tiers, ranks & notes: admin only</span><button className="abtn dark" onClick={() => setOpen('new')}>+ Add</button></div>
      </div>
      <div className="adm-card st-bar">
        <input className="search st-q" placeholder="Search name, nickname, phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          <button className={tier === 'all' ? 'on' : ''} onClick={() => setTier('all')}>All · {searched.length}</button>
          {(['A', 'B', 'C'] as const).map((t) => <button key={t} className={tier === t ? 'on' : ''} onClick={() => setTier(t)}><i className={'tier-dot ' + t}>{t}</i> {count(t)}</button>)}
          <button className={tier === 'none' ? 'on' : ''} onClick={() => setTier('none')}><i className="tier-q">?</i> Unranked {count('none')}</button>
        </div>
        <label className="row sm muted" style={{ gap: 6 }}>Sort <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="first">A → Z (first name)</option><option value="last">A → Z (last name)</option><option value="rank">Rank</option><option value="tier">Tier, then rank</option><option value="shifts">Most shifts this month</option><option value="newest">Newest</option></select></label>
        <div className="seg">{([['all', 'All'], ['floor', 'Floor'], ['bar', 'Bar'], ['md', 'MD']] as const).map(([k, l]) => <button key={k} className={dept === k ? 'on' : ''} onClick={() => setDept(k)}>{l}</button>)}</div>
        <label className="row sm" style={{ gap: 6 }}><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} /> Show inactive</label>
      </div>
      {open === 'new' && <Editor onDone={() => { setOpen(null); load(); }} />}
      <div className="adm-card" style={{ padding: 0 }}>
        <div className="st-row st-head"><span>NAME</span><span>TIER · RANK</span><span className="hide-sm">{mName}</span><span className="hide-sm">TIME OFF</span><span /></div>
        {rows.map((s, k) => {
          const L = letters && (k === 0 || letterOf(rows[k - 1]) !== letterOf(s)) ? letterOf(s) : null;
          const tr = tOf(s); const o = offText(s.id);
          return (
            <Fragment key={s.id}>
              {L && <div className="st-letter">{L}</div>}
              <div className={'st-row' + (s.active ? '' : ' inactive') + (prof?.id === s.id ? ' sel' : '')} onClick={() => setProf(s)}>
                <span className="st-name"><Avatar name={s.full_name} url={s.photo_url} size={34} /><span><b>{s.full_name}{!tr && <i className="new-tag">NEW</i>}</b><small>{s.nickname ? `"${s.nickname}" · ` : ''}{s.positions.map((p) => p.toLowerCase()).join(', ') || s.role}{s.role !== 'staff' ? ` · ${s.role}` : ''}</small></span></span>
                <span>{tr ? <><i className={'tier-dot ' + tr}>{tr}</i> <span className="muted">#{s.staff_private?.ranking ?? '–'}</span></> : <><i className="tier-q">?</i> <Link to="/admin/tiers" className="accent strong sm" onClick={(e) => e.stopPropagation()}>Rank ›</Link></>}</span>
                <span className="hide-sm">{month[s.id] ?? 0}</span>
                <span className="hide-sm">{o ? <span className="tag" style={{ height: 24 }}>{o}</span> : <span className="muted">—</span>}</span>
                <span className="st-open">{prof?.id === s.id ? <b className="accent sm">Selected</b> : <span className="sm strong">Open ›</span>}</span>
              </div>
              {open === s.id && <div style={{ padding: '0 16px 16px' }}><Editor s={s} onDone={() => { setOpen(null); load(); }} /></div>}
            </Fragment>
          );
        })}
        {list && !rows.length && <div className="muted sm" style={{ padding: 18 }}>Nobody matches.</div>}
        {!list && <div className="muted" style={{ padding: 18 }}>Loading…</div>}
      </div>
      <div className="st-who"><b>WHO SEES RANKINGS</b><span>✓ Admin accounts only · ✕ Managers and MDs: names and roles only · ✕ Staff: never their own or anyone's tier. Enforced in the database, not only hidden on screen.</span></div>
      {prof && <StaffProfile s={prof} onClose={() => { setProf(null); load(); }} onEdit={() => { setOpen(prof.id); setProf(null); }} />}
    </div>
  );
}

function Editor({ s, onDone }: { s?: AStaff; onDone: () => void }) {
  const [f, setF] = useState({
    full_name: s?.full_name ?? '', email: s?.email ?? '', phone: s?.phone ?? '', language: s?.language ?? 'fr',
    department: s?.department ?? 'floor', role: s?.role ?? 'staff', positions: (s?.positions ?? []).join(', '),
    active: s?.active ?? true, ranking: s?.staff_private?.ranking?.toString() ?? '', notes: s?.staff_private?.notes ?? '',
  });
  const [err, setErr] = useState('');
  const [photo, setPhoto] = useState(s?.photo_url ?? null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    const row = {
      full_name: f.full_name.trim(), email: f.email.trim().toLowerCase() || null, phone: f.phone || null, language: f.language,
      department: f.department, role: f.role, active: f.active,
      positions: f.positions.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean),
    };
    const res = s ? await supabase.from('staff').update(row).eq('id', s.id).select('id').single()
      : await supabase.from('staff').insert(row).select('id').single();
    if (res.error) return setErr(res.error.message);
    const p = await supabase.from('staff_private').upsert({ staff_id: res.data.id, ranking: f.ranking ? Number(f.ranking) : null, notes: f.notes || null });
    if (p.error) return setErr(p.error.message);
    onDone();
  };

  return (
    <form className="editor" onSubmit={save}>
      {s && <PhotoPicker name={s.full_name} url={photo} onPick={async (file) => { try { setPhoto(await uploadPhoto(s.id, file)); } catch (e) { setErr((e as Error).message); } }} />}
      <div className="grid3">
        <label className="field">Name (as on the Events sheet)<input required value={f.full_name} onChange={set('full_name')} /></label>
        <label className="field">Email (for login)<input type="email" value={f.email} onChange={set('email')} /></label>
        <label className="field">Phone<input value={f.phone} onChange={set('phone')} /></label>
        <label className="field">Role<select value={f.role} onChange={set('role')}><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Admin</option></select></label>
        <label className="field">Department<select value={f.department} onChange={set('department')}><option value="floor">Floor</option><option value="bar">Bar</option><option value="kitchen">Kitchen</option></select></label>
        <label className="field">Language<select value={f.language} onChange={set('language')}><option value="fr">Français</option><option value="en">English</option></select></label>
        <label className="field">Positions (comma separated)<input value={f.positions} onChange={set('positions')} placeholder="MD, WAITER" /></label>
        <label className="field">Ranking (admin only)<input type="number" value={f.ranking} onChange={set('ranking')} /></label>
        <label className="field check-field"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
        <label className="field span3">Notes (admin only)<textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row"><button className="btn primary sm">Save</button><button type="button" className="btn sm" onClick={onDone}>Cancel</button></div>
    </form>
  );
}
