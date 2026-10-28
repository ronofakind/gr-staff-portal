import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { allStaff, type AStaff } from './api';

type T = 'A' | 'B' | 'C' | null;
const COLS: { t: T; label: string }[] = [{ t: 'A', label: 'Tier A' }, { t: 'B', label: 'Tier B' }, { t: 'C', label: 'Tier C' }, { t: null, label: 'Not in a tier' }];

/** Admin only: drag to rank, drag between columns to change tier. Saves on drop. */
export function Tiers() {
  const [list, setList] = useState<AStaff[] | null>(null);
  const [dept, setDept] = useState<'floor' | 'bar'>('floor');
  const [q, setQ] = useState('');
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ t: T; i: number } | null>(null);
  const [saving, setSaving] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { allStaff().then(setList); }, []);

  const tierOf = (s: AStaff): T => s.staff_private?.tier ?? null;
  const rank = (s: AStaff) => s.staff_private?.ranking ?? 9999;
  const people = useMemo(() => (list ?? []).filter((s) => s.active && (dept === 'bar' ? s.department === 'bar' : s.department !== 'bar'))
    .sort((a, b) => rank(a) - rank(b) || a.full_name.localeCompare(b.full_name)), [list, dept]);
  const cols = COLS.map((c) => ({ ...c, rows: people.filter((s) => tierOf(s) === c.t) }));

  /** Rewrite tier + ranking for everyone in this department, in on-screen order (A, B, C, none). */
  const save = async (order: { s: AStaff; t: T }[]) => {
    setSaving(true); setErr('');
    const rows = order.map((o, i) => ({ staff_id: o.s.id, tier: o.t, ranking: i + 1, notes: o.s.staff_private?.notes ?? null }));
    const { error } = await supabase.from('staff_private').upsert(rows);
    if (error) setErr(error.message);
    setList((l) => (l ?? []).map((s) => { const r = rows.find((x) => x.staff_id === s.id); return r ? { ...s, staff_private: { ranking: r.ranking, notes: r.notes, tier: r.tier } } : s; }));
    setSaving(false);
  };

  const drop = (t: T, i: number) => {
    if (!drag) return;
    const moving = people.find((s) => s.id === drag)!;
    const flat = cols.map((c) => ({ t: c.t, rows: c.rows.filter((s) => s.id !== drag) }));
    flat.find((c) => c.t === t)!.rows.splice(i, 0, moving);
    save(flat.flatMap((c) => c.rows.map((s) => ({ s, t: c.t }))));
    setDrag(null); setOver(null);
  };
  const move = (s: AStaff, t: T, dir: -1 | 1 | 0) => {
    const c = cols.find((x) => x.t === tierOf(s))!; const i = c.rows.indexOf(s);
    if (dir === 0) {
      const flat = cols.map((x) => ({ t: x.t, rows: x.rows.filter((r) => r.id !== s.id) }));
      flat.find((x) => x.t === t)!.rows.push(s);
      save(flat.flatMap((x) => x.rows.map((r) => ({ s: r, t: x.t }))));
      return;
    }
    const j = i + dir; if (j < 0 || j >= c.rows.length) return;
    const flat = cols.map((x) => ({ t: x.t, rows: [...x.rows] })); const col = flat.find((x) => x.t === c.t)!;
    [col.rows[i], col.rows[j]] = [col.rows[j], col.rows[i]];
    save(flat.flatMap((x) => x.rows.map((r) => ({ s: r, t: x.t }))));
  };
  const quickSplit = () => {
    const n = people.length; const a = Math.round(n / 3), b = Math.round((2 * n) / 3);
    save(people.map((s, i) => ({ s, t: (i < a ? 'A' : i < b ? 'B' : 'C') as T })));
  };

  const match = (s: AStaff) => !q || s.full_name.toLowerCase().includes(q.toLowerCase());
  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="muted sm strong">ADMIN ONLY</div><h1>Tiers &amp; ranking</h1></div>
        <div className="row">
          <div className="seg-a">{(['floor', 'bar'] as const).map((d) => <button key={d} className={dept === d ? 'on' : ''} onClick={() => setDept(d)}>{d === 'floor' ? 'Floor' : 'Bar'}</button>)}</div>
          <input className="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          {saving ? <span className="muted sm">Saving…</span> : <span className="muted sm">Saved</span>}
        </div>
      </div>
      <p className="muted sm" style={{ margin: 0 }}>Drag a name up or down to rank. Drag it to another column to change tier. Rank 1 is asked first. Saves as you drop.</p>
      {err && <p className="error">{err}</p>}
      {list && people.length > 0 && people.every((s) => !tierOf(s)) && (
        <div className="pending"><div className="grow"><b>Nobody is in a tier yet.</b><div className="sm muted">Start by splitting your current ranking in three (top third A, middle B, rest C), then adjust by dragging.</div></div>
          <button className="btn primary" onClick={quickSplit}>Split by ranking</button></div>
      )}
      {!list && <div className="muted">Loading…</div>}
      <div className="tier-cols">
        {cols.map((c) => (
          <section key={String(c.t)} className={'tier-col t-' + (c.t ?? 'none')}
            onDragOver={(e) => { e.preventDefault(); if (!over || over.t !== c.t) setOver({ t: c.t, i: c.rows.length }); }}
            onDrop={() => drop(c.t, over?.t === c.t ? over.i : c.rows.length)}>
            <header><span className="tier-badge">{c.t ?? '–'}</span><b>{c.label}</b><span className="muted sm">{c.rows.length} people</span></header>
            {c.rows.map((s, i) => (
              <div key={s.id} className={'tier-row' + (drag === s.id ? ' dragging' : '') + (over?.t === c.t && over.i === i && drag ? ' over' : '') + (match(s) ? '' : ' dim')}
                draggable onDragStart={() => setDrag(s.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver({ t: c.t, i }); }}
                onDrop={(e) => { e.stopPropagation(); drop(c.t, i); }}>
                <span className="grip">⋮⋮</span><span className="n">{i + 1}</span>
                <div className="grow"><b>{s.full_name}</b><small>{s.positions.join(', ') || s.role}</small></div>
                <div className="tier-mini">
                  <button aria-label="Up" onClick={() => move(s, c.t, -1)}>↑</button>
                  <button aria-label="Down" onClick={() => move(s, c.t, 1)}>↓</button>
                  <select aria-label="Tier" value={c.t ?? ''} onChange={(e) => move(s, (e.target.value || null) as T, 0)}>
                    <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="">–</option>
                  </select>
                </div>
              </div>
            ))}
            {!c.rows.length && <div className="muted sm" style={{ padding: 12 }}>Drop names here</div>}
          </section>
        ))}
      </div>
    </div>
  );
}
