import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { allStaff, type AStaff } from './api';
import { uploadPhoto } from '../lib/photo';
import { PhotoPicker } from '../components/Avatar';

export function Staff() {
  const [list, setList] = useState<AStaff[] | null>(null);
  const [q, setQ] = useState(''); const [show, setShow] = useState<'active' | 'all'>('active');
  const [open, setOpen] = useState<string | null>(null);
  const load = () => allStaff().then(setList);
  useEffect(() => { load(); }, []);

  const rows = (list ?? []).filter((s) => (show === 'all' || s.active) && s.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack-lg">
      <div className="toolbar">
        <h1>Staff <span className="muted">· {rows.length}</span></h1>
        <div className="row">
          <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={show} onChange={(e) => setShow(e.target.value as 'active' | 'all')}><option value="active">Active</option><option value="all">Everyone</option></select>
          <button className="btn primary" onClick={() => setOpen('new')}>+ Add</button>
        </div>
      </div>
      {open === 'new' && <Editor onDone={() => { setOpen(null); load(); }} />}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Name</th><th>Role</th><th>Positions</th><th>Phone</th><th>Email</th><th>Rank</th><th /></tr></thead>
          <tbody>
            {rows.map((s) => (
              <Fragment key={s.id}>
                <tr className={s.active ? '' : 'inactive'}>
                  <td className="strong">{s.full_name}</td>
                  <td>{s.role}{s.department !== 'floor' ? ` · ${s.department}` : ''}</td>
                  <td>{s.positions.join(', ')}</td>
                  <td>{s.phone}</td>
                  <td>{s.email ?? <span className="muted">—</span>}</td>
                  <td>{s.staff_private?.ranking ?? ''}</td>
                  <td><div className="row"><Link className="btn sm" to={`/admin/view/${s.id}`}>View as</Link><button className="btn sm" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Close' : 'Edit'}</button></div></td>
                </tr>
                {open === s.id && <tr><td colSpan={7}><Editor s={s} onDone={() => { setOpen(null); load(); }} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!list && <div className="muted">Loading…</div>}
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
