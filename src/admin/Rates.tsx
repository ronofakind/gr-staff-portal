import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { allStaff, isoDay, dLabel, type AStaff } from './api';
import { loadRates, byStaff, nextPeriodStart, money2, type RateRow } from './pay';

/** Nov 8 · push 54 (081) · pay rates with history. Only Ronnie (admin) sees any of this. */
const fmt = (n: number) => '$' + (Number.isInteger(n) ? n : n.toFixed(2));
export function RateEditor({ staffId, name, current, onClose, onSaved }: { staffId: string; name: string; current: number | null; onClose: () => void; onSaved: () => void }) {
  const today = isoDay(new Date());
  const [rate, setRate] = useState(current != null ? String(current) : ''); const [from, setFrom] = useState(nextPeriodStart(today)); const [why, setWhy] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    const r = Number(rate.replace(',', '.')); if (!(r >= 0) || !rate) { setErr('Enter a rate'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('staff_rates').upsert({ staff_id: staffId, rate: r, from_date: from, reason: why.trim() || null, source: 'app' }, { onConflict: 'staff_id,from_date' });
    setBusy(false); if (error) { setErr(error.message); return; } onSaved();
  };
  return (
    <div className="t4-edit-wrap" onClick={onClose}><div className="t4-edit" onClick={(e) => e.stopPropagation()} style={{ gap: 12 }}>
      <div className="row" style={{ alignItems: 'center' }}><span className="serif" style={{ fontSize: 22 }}>Change rate · {name.split(' ')[0]}</span><span className="grow" /><button className="lnk muted" onClick={onClose}>Cancel</button></div>
      <label className="rt-f">New rate ($/h)<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={current != null ? String(current) : '20'} autoFocus /></label>
      <label className="rt-f">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><small className="muted">Default: start of the next pay period. Hours before this date keep the old rate.</small></label>
      <label className="rt-f">Reason (optional)<input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Raise · 1 year + A tier" maxLength={120} /></label>
      {err && <p className="error">{err}</p>}
      <button className="abtn dark" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rate'}</button>
    </div></div>
  );
}

/** Staff profile card: current rate + history + Change rate. */
export function RateCard({ s }: { s: AStaff }) {
  const [hist, setHist] = useState<RateRow[] | null>(null); const [edit, setEdit] = useState(false);
  const load = () => supabase.from('staff_rates').select('id,staff_id,rate,from_date,reason,source,created_at').eq('staff_id', s.id).order('from_date', { ascending: false })
    .then(({ data, error }) => setHist(error ? null : ((data ?? []) as RateRow[]).map((r) => ({ ...r, rate: Number(r.rate) }))));
  useEffect(() => { load(); }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (hist === null) return null;
  const today = isoDay(new Date()); const cur = hist.find((r) => r.from_date <= today) ?? null; const next = hist.find((r) => r.from_date > today);
  const raises = hist.filter((r, i) => hist[i + 1] && r.rate > hist[i + 1].rate).length;
  return (
    <div className="adm-card stack rt-card" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><span className="kick">PAY RATE · ONLY YOU SEE THIS</span><button className="abtn sm dark" onClick={() => setEdit(true)}>Change rate</button></div>
      <div className="row" style={{ alignItems: 'baseline', gap: 10 }}><span className="serif" style={{ fontSize: 30 }}>{cur ? fmt(cur.rate) : '—'}<span className="muted" style={{ fontSize: 14 }}>/h</span></span>
        <span className="muted sm">{cur ? `since ${dLabel(cur.from_date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'no rate yet'}{raises ? ` · ${raises} raise${raises > 1 ? 's' : ''}` : ''}</span></div>
      {next && <div className="sm"><b className="gold">{fmt(next.rate)}</b> from {dLabel(next.from_date, { month: 'short', day: 'numeric' })}{next.reason ? ` · ${next.reason}` : ''}</div>}
      {hist.length > 0 && <div className="rt-hist">{hist.map((r, i) => { const prev = hist[i + 1]; return (
        <div key={r.id}><span className="muted">{dLabel(r.from_date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><b>{prev ? `${fmt(prev.rate)} → ${fmt(r.rate)}` : fmt(r.rate)}</b><span className="grow muted">{r.reason ?? (r.source === 'sheet' ? (prev ? 'from the payroll sheet' : 'start · from the payroll sheet') : '')}</span></div>); })}</div>}
      {edit && <RateEditor staffId={s.id} name={s.full_name} current={cur?.rate ?? null} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); load(); }} />}
    </div>
  );
}

/** /admin/rates · averages by role, latest increases, everyone A–Z. */
export function Rates() {
  const [rows, setRows] = useState<RateRow[] | null>(null); const [staff, setStaff] = useState<AStaff[]>([]);
  const [tab, setTab] = useState<'inc' | 'az'>('inc'); const [q, setQ] = useState(''); const [edit, setEdit] = useState<AStaff | null>(null); const [tick, setTick] = useState(0);
  useEffect(() => { Promise.all([loadRates(), allStaff()]).then(([r, s]) => { setRows(r ?? []); setStaff(s.filter((x) => x.active)); }); }, [tick]);
  const today = isoDay(new Date()); const by = useMemo(() => byStaff(rows ?? []), [rows]);
  const curOf = (id: string) => by[id]?.find((r) => r.from_date <= today) ?? null;
  const roleOf = (s: AStaff) => (s.role === 'manager' || s.md_rank ? 'MD' : s.department === 'bar' ? 'Bar' : 'Floor');
  const roles = ['Floor', 'Bar', 'MD'].map((k) => { const v = staff.filter((s) => roleOf(s) === k).map((s) => curOf(s.id)?.rate).filter((x): x is number => x != null && x > 0); return { k, n: v.length, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0 }; });
  const name = Object.fromEntries(staff.map((s) => [s.id, s]));
  const incs = (rows ?? []).flatMap((r) => { const h = by[r.staff_id]; const i = h.indexOf(r); const prev = h[i + 1]; return prev && r.rate !== prev.rate && name[r.staff_id] ? [{ r, prev }] : []; }).sort((a, b) => b.r.from_date.localeCompare(a.r.from_date));
  const year = today.slice(0, 4); const raisesYr = incs.filter((x) => x.r.from_date.startsWith(year) && x.r.rate > x.prev.rate);
  const list = staff.filter((s) => !q || s.full_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="stack-lg">
      <div className="toolbar"><div><div className="kick"><Link to="/admin/staff">‹ Staff</Link></div><h1 className="serif-h">Pay rates</h1></div>
        <div className="muted sm">{year} · {raisesYr.length} raise{raisesYr.length === 1 ? '' : 's'}{raisesYr.length ? ` · avg +${money2(raisesYr.reduce((n, x) => n + x.r.rate - x.prev.rate, 0) / raisesYr.length)}/h` : ''} · only you see this</div></div>
      {rows === null ? <div className="muted">Loading…</div> : <>
        <div className="rt-roles">{roles.map((r) => <div key={r.k} className="adm-card"><small>{r.k.toUpperCase()}</small><b>{r.n ? money2(r.avg) : '—'}</b><span className="muted sm">avg · {r.n ? `${fmt(r.min)}–${fmt(r.max)} · ${r.n} people` : 'no rates'}</span></div>)}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          <button className={'abtn sm' + (tab === 'inc' ? ' dark' : '')} onClick={() => setTab('inc')}>Latest changes</button>
          <button className={'abtn sm' + (tab === 'az' ? ' dark' : '')} onClick={() => setTab('az')}>Everyone A–Z</button>
          {tab === 'az' && <input className="t4-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search a name" />}
        </div>
        {tab === 'inc' ? (
          <div className="adm-card t4-card">{!incs.length && <div className="muted sm" style={{ padding: '10px 0' }}>No rate changes yet.</div>}
            {incs.slice(0, 80).map(({ r, prev }) => <div key={r.id} className="rt-row"><span className="muted rt-d">{dLabel(r.from_date, { month: 'short', day: 'numeric', year: 'numeric' })}</span><b className="grow">{name[r.staff_id].full_name}</b><span>{fmt(prev.rate)} → {fmt(r.rate)}</span><span className={'tag ' + (r.rate > prev.rate ? 'ok' : 'amber')}>{r.rate > prev.rate ? '+' : ''}{fmt(r.rate - prev.rate)}</span></div>)}</div>
        ) : (
          <div className="adm-card t4-card">{list.map((s) => { const c = curOf(s.id); return (
            <div key={s.id} className="rt-row"><b className="grow">{s.full_name}</b><span className="muted sm">{roleOf(s)}</span><span className="rt-r">{c ? fmt(c.rate) : '—'}</span><span className="muted sm rt-d">{c ? `since ${dLabel(c.from_date, { month: 'short', year: 'numeric' })}` : ''}</span><button className="abtn sm" onClick={() => setEdit(s)}>Change</button></div>); })}</div>
        )}
      </>}
      {edit && <RateEditor staffId={edit.id} name={edit.full_name} current={curOf(edit.id)?.rate ?? null} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); setTick((t) => t + 1); }} />}
    </div>
  );
}
