import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Nov 25 · one uniform dropdown everywhere: No uniform · usual · added (migration 139) · + New uniform. */
const MEN: [string, string][] = [['white_shirt', 'White dress shirt'], ['black_shirt', 'Black dress shirt'], ['black_tshirt', 'Black T-shirt']];
const WOMEN: [string, string][] = [...MEN.slice(0, 2), ['dress', 'Black cocktail dress'], MEN[2]];

let cache: Promise<string[]> | null = null;
const loadList = () => (cache ??= Promise.resolve(supabase.from('uniform_types').select('name').order('name')).then(({ data }) => ((data ?? []) as { name: string }[]).map((x) => x.name)));
const listeners = new Set<(l: string[]) => void>();

export function UniPick({ label, value, onChange, women = false }: { label: string; value: string; onChange: (v: string) => void; women?: boolean }) {
  const [added, setAdded] = useState<string[]>([]); const [nw, setNw] = useState<string | null>(null); const [err, setErr] = useState('');
  useEffect(() => { loadList().then(setAdded); listeners.add(setAdded); return () => { listeners.delete(setAdded); }; }, []);
  const base = women ? WOMEN : MEN;
  const cust = [...new Set([...added, ...(value.startsWith('custom:') && value.length > 7 ? [value.slice(7)] : [])])];
  const add = async () => {
    const n = (nw ?? '').trim(); if (!n) return;
    const { error } = await supabase.from('uniform_types').upsert({ name: n }, { onConflict: 'name', ignoreDuplicates: true });
    if (error) { setErr(error.message); return; }
    const next = [...new Set([...added, n])].sort(); cache = Promise.resolve(next); listeners.forEach((f) => f(next));
    onChange('custom:' + n); setNw(null); setErr('');
  };
  return (
    <div className="ne-f uni-pick">
      <span>{label}</span>
      <select value={value} onChange={(e) => { const v = e.target.value; if (v === '__new') setNw(''); else onChange(v); }}>
        {value === '' && <option value="">—</option>}
        <option value="none">No uniform</option>
        <optgroup label="Usual">{base.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
        {cust.length > 0 && <optgroup label="Added">{cust.map((n) => <option key={n} value={'custom:' + n}>{n}</option>)}</optgroup>}
        {value !== '' && value !== 'none' && !value.startsWith('custom:') && !base.some(([k]) => k === value) && <option value={value}>{value}</option>}
        <option value="__new">+ New uniform</option>
      </select>
      {nw !== null && <div className="uni-new">
        <input autoFocus value={nw} placeholder="New uniform" onChange={(e) => setNw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } if (e.key === 'Escape') setNw(null); }} />
        <button type="button" className="abtn dark" disabled={!nw.trim()} onClick={add}>Add</button>
        <button type="button" className="abtn" onClick={() => setNw(null)}>Cancel</button>
      </div>}
      {err && <small className="error">{err}</small>}
    </div>
  );
}
