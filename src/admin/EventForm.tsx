import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { allStaff, isoDay, type AStaff } from './api';

type F = {
  event_date: string; title: string; client: string; address: string; department: 'floor' | 'bar' | 'kitchen';
  start_time: string; end_time: string; staff_needed: number; manager_id: string;
  description: string; dress_code: string; bring: string; timeline: string;
  uniform_floor: string; uniform_bar: string;
};

const empty = (d: string): F => ({
  event_date: d, title: '', client: '', address: '', department: 'floor', start_time: '17:00', end_time: '',
  staff_needed: 0, manager_id: '', description: '', dress_code: 'Black dress pants, Black shoes, Black belt', bring: '', timeline: '',
  uniform_floor: 'white_shirt', uniform_bar: 'black_shirt',
});

export function EventForm() {
  const { id } = useParams(); const [params] = useSearchParams(); const nav = useNavigate();
  const isNew = id === 'new';
  const [f, setF] = useState<F | null>(isNew ? empty(params.get('d') ?? isoDay(new Date())) : null);
  const [code, setCode] = useState('');
  const [managers, setManagers] = useState<AStaff[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    allStaff().then((s) => setManagers(s.filter((x) => x.active && (x.role !== 'staff' || x.positions.includes('MD')))));
    if (isNew) return;
    supabase.from('events').select('*,event_private(client,punch_code)').eq('id', id!).single().then(({ data: e }) => {
      if (!e) return;
      setCode(e.event_private?.punch_code ?? '');
      setF({
        event_date: e.event_date, title: e.title, client: e.event_private?.client ?? '', address: e.address ?? '',
        department: e.department, start_time: (e.start_time ?? '').slice(0, 5), end_time: (e.end_time ?? '').slice(0, 5),
        staff_needed: e.staff_needed, manager_id: e.manager_id ?? '', description: e.description ?? '',
        dress_code: e.dress_code ?? '', bring: e.bring ?? '', uniform_floor: e.uniform_floor ?? 'white_shirt', uniform_bar: e.uniform_bar ?? 'black_shirt',
        timeline: (e.timeline ?? []).map((t: { time: string; label: string }) => `${t.time} ${t.label}`).join('\n'),
      });
    });
  }, [id]);

  if (!f) return <div className="muted">Loading…</div>;
  const set = (k: keyof F) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: k === 'staff_needed' ? Number(ev.target.value) : ev.target.value });

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setErr(''); setBusy(true);
    const row = {
      event_date: f.event_date, title: f.title.trim(), address: f.address || null, department: f.department,
      start_time: f.start_time || null, end_time: f.end_time || null, staff_needed: f.staff_needed,
      manager_id: f.manager_id || null, description: f.description || null, dress_code: f.dress_code || null, bring: f.bring || null,
      uniform_floor: f.uniform_floor, uniform_bar: f.uniform_bar,
      timeline: f.timeline.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = l.match(/^(\S+)\s+(.*)$/); return m ? { time: m[1], label: m[2] } : { time: '', label: l };
      }),
    };
    const res = isNew ? await supabase.from('events').insert(row).select('id').single()
      : await supabase.from('events').update(row).eq('id', id!).select('id').single();
    if (res.error) { setErr(res.error.message); setBusy(false); return; }
    const evId = res.data.id;
    const priv = await supabase.from('event_private').upsert({ event_id: evId, client: f.client || null }, { onConflict: 'event_id' });
    setBusy(false);
    if (priv.error) { setErr(priv.error.message); return; }
    nav(`/admin/day?d=${f.event_date}`);
  };

  const del = async () => {
    if (!confirm('Delete this event and its bookings?')) return;
    await supabase.from('events').delete().eq('id', id!); nav(`/admin/day?d=${f.event_date}`);
  };

  return (
    <form className="form card stack" onSubmit={save}>
      <div className="spread"><h1>{isNew ? 'New event' : 'Edit event'}</h1>{code && <span className="pill">Punch code {code}</span>}</div>
      <div className="grid2">
        <label className="field">Date<input type="date" required value={f.event_date} onChange={set('event_date')} /></label>
        <label className="field">Department
          <select value={f.department} onChange={set('department')}><option value="floor">Floor</option><option value="bar">Bar</option><option value="kitchen">Kitchen</option></select>
        </label>
        <label className="field">Title staff see (venue, never the client)<input required value={f.title} onChange={set('title')} placeholder="Salon Richmond" /></label>
        <label className="field">Client (admin only)<input value={f.client} onChange={set('client')} placeholder="Bitton" /></label>
        <label className="field span2">Address<input value={f.address} onChange={set('address')} placeholder="Full address, suite / floor" /></label>
        <label className="field">Start<input type="time" value={f.start_time} onChange={set('start_time')} /></label>
        <label className="field">Ends about<input type="time" value={f.end_time} onChange={set('end_time')} /></label>
        <label className="field">Staff needed<input type="number" min={0} value={f.staff_needed} onChange={set('staff_needed')} /></label>
        <label className="field">Manager on site
          <select value={f.manager_id} onChange={set('manager_id')}><option value="">—</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select>
        </label>
        <label className="field span2">What the event is (staff see this)<textarea rows={2} value={f.description} onChange={set('description')} placeholder="Seated dinner for 120, three courses, wine service." /></label>
        <label className="field">Floor wears<select value={f.uniform_floor} onChange={set('uniform_floor')}><option value="white_shirt">White dress shirt + tie</option><option value="black_shirt">Black dress shirt + tie</option><option value="dress">Black cocktail dress</option><option value="black_tshirt">Black T-shirt</option></select></label>
        <label className="field">Bar wears<select value={f.uniform_bar} onChange={set('uniform_bar')}><option value="black_shirt">Black dress shirt + tie</option><option value="white_shirt">White dress shirt + tie</option><option value="dress">Black cocktail dress</option><option value="black_tshirt">Black T-shirt</option></select></label>
        <label className="field">Rest of the uniform (comma or one per line)<textarea rows={2} value={f.dress_code} onChange={set('dress_code')} /></label>
        <label className="field">Bring (one per line)<textarea rows={3} value={f.bring} onChange={set('bring')} placeholder="Wine key" /></label>
        <label className="field span2">Timeline (one per line: time then label)<textarea rows={3} value={f.timeline} onChange={set('timeline')} placeholder={'18:30 Guests arrive, cocktail\n19:30 Dinner'} /></label>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy}>{isNew ? 'Create event' : 'Save'}</button>
        <button type="button" className="btn" onClick={() => nav(-1)}>Cancel</button>
        <div className="grow" />
        {!isNew && <button type="button" className="btn danger" onClick={del}>Delete</button>}
      </div>
    </form>
  );
}
