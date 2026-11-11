// push 85 (board BarCountPickV1, migration 109) · Admin → G&R bottle list: search, add, edit (name / size / type / SAQ price), remove.
// Bottles staff typed on a bar count show on top in gold ("NEW · by …") until a price is added. Remove = gone for new nights; past counts keep the name.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { KINDS, KIND_SHORT, sizesFor } from '../lib/barCount';

type Row = { id: string; kind: string; name: string; size: string | null; price: number | null; added_by: string | null; created_at: string; staff: { full_name: string } | null };
type Ed = { id: string | null; kind: string; name: string; size: string; price: string };
const money = (n: number | null) => (n == null ? '' : `$${Number(n).toFixed(2)}`);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });

export function Bottles() {
  const [rows, setRows] = useState<Row[] | null>(null); const [t, setT] = useState(''); const [ed, setEd] = useState<Ed | null>(null); const [err, setErr] = useState(''); const [tick, setTick] = useState(0);
  useEffect(() => { supabase.from('bar_catalog').select('id,kind,name,size,price,added_by,created_at,staff:staff!bar_catalog_added_by_fkey(full_name)').is('archived_at', null).order('kind').order('name')
    .then(({ data, error }) => { if (error) setErr(error.message); setRows((data ?? []) as unknown as Row[]); }); }, [tick]);
  const list = useMemo(() => { const w = t.toLowerCase().trim(); const r = (rows ?? []).filter((x) => !w || `${x.name} ${x.size ?? ''} ${x.kind}`.toLowerCase().includes(w));
    const isNew = (x: Row) => !!x.added_by && x.price == null; return [...r.filter(isNew), ...r.filter((x) => !isNew(x))]; }, [rows, t]);
  const save = async () => { if (!ed) return; setErr('');
    const v = { kind: ed.kind, name: ed.name.trim(), size: ed.size.trim() || null, price: ed.price.trim() ? Number(ed.price.replace(',', '.').replace('$', '')) : null };
    if (!v.name) return setErr('Give it a name.'); if (v.price != null && !(v.price >= 0)) return setErr('Price: a number, e.g. 54.75');
    const { error } = ed.id ? await supabase.from('bar_catalog').update(v).eq('id', ed.id) : await supabase.from('bar_catalog').insert(v);
    if (error) setErr(/duplicate|unique/i.test(error.message) ? 'That bottle and size is already on the list.' : error.message); else { setEd(null); setTick((x) => x + 1); } };
  const remove = async (r: Row) => { if (!window.confirm(`Remove ${r.name}${r.size ? ' · ' + r.size : ''} from the G&R list? Past counts keep it.`)) return;
    const { error } = await supabase.from('bar_catalog').update({ archived_at: new Date().toISOString() }).eq('id', r.id); if (error) setErr(error.message); else setTick((x) => x + 1); };
  const form = (e: Ed) => (
    <tr className="bt-ed"><td colSpan={5}><div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
      <input value={e.name} onChange={(x) => setEd({ ...e, name: x.target.value })} placeholder="Name (e.g. Tito's Vodka)" autoFocus style={{ minWidth: 220 }} />
      <select value={e.kind} onChange={(x) => setEd({ ...e, kind: x.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_SHORT[k]}</option>)}</select>
      <input list="bt-sizes" value={e.size} onChange={(x) => setEd({ ...e, size: x.target.value })} placeholder="Size" style={{ width: 120 }} />
      <datalist id="bt-sizes">{sizesFor(e.kind).map((s) => <option key={s} value={s} />)}</datalist>
      <input inputMode="decimal" value={e.price} onChange={(x) => setEd({ ...e, price: x.target.value })} placeholder="SAQ price" style={{ width: 110 }} />
      <button className="abtn sm dark" onClick={save}>Save</button><button className="lnk" onClick={() => setEd(null)}>Cancel</button></div></td></tr>);
  return (
    <div className="stack-lg">
      <div className="toolbar"><div><div className="kick">BAR</div><h1 className="serif-h">G&amp;R bottle list</h1>
        <span className="muted sm">What bar managers pick for tonight’s bottles at every venue. Prices are only seen by you.</span></div></div>
      <div className="row wrap" style={{ gap: 8 }}><input className="bt-q" value={t} onChange={(e) => setT(e.target.value)} placeholder={`🔍 Search ${rows?.length ?? ''} bottles`} />
        <button className="abtn dark" onClick={() => setEd({ id: null, kind: 'spirit', name: '', size: '750 ml', price: '' })}>+ Add a bottle</button></div>
      {err && <p className="error">{err}</p>}
      <div className="adm-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="bt-t"><thead><tr><th>BOTTLE</th><th>SIZE</th><th>TYPE</th><th>SAQ PRICE</th><th /></tr></thead><tbody>
          {ed && !ed.id && form(ed)}
          {rows === null ? <tr><td colSpan={5} className="muted">Loading…</td></tr> : list.map((r) => ed?.id === r.id ? <Fragment key={r.id}>{form(ed)}</Fragment> : (
            <tr key={r.id} className={r.added_by && r.price == null ? 'new' : ''}>
              <td><b>{r.name}</b>{r.added_by && r.price == null && <i className="bt-new">NEW · BY {(r.staff?.full_name ?? '').split(' ')[0].toUpperCase()} {day(r.created_at).toUpperCase()}</i>}</td>
              <td>{r.size}</td><td>{KIND_SHORT[r.kind] ?? r.kind}</td><td>{r.price == null ? <span className="accent">add price</span> : money(r.price)}</td>
              <td className="bt-act"><button className="lnk" onClick={() => setEd({ id: r.id, kind: r.kind, name: r.name, size: r.size ?? '', price: r.price == null ? '' : String(r.price) })}>Edit</button> · <button className="lnk red" onClick={() => remove(r)}>Remove</button></td>
            </tr>))}
        </tbody></table>
      </div>
    </div>);
}
