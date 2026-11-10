// push 79 · admin side of staff expenses (migration 104): "Can add expenses" switch, "Allow expense for this shift",
// Needs you cards with the receipt → Approve (pay line in the open period) or Decline with a reason they see.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dLabel } from './api';

const KIND: Record<string, string> = { parking: 'Parking', uber: 'Uber', gas: 'Gas', other: 'Other' };

/** Staff profile → Can add expenses (always on). */
export function ExpenseSwitch({ staffId }: { staffId: string }) {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { supabase.from('staff').select('can_expense').eq('id', staffId).maybeSingle().then(({ data, error }) => setOn(error ? null : !!(data as { can_expense: boolean } | null)?.can_expense)); }, [staffId]);
  if (on === null) return null; // before migration 104
  const flip = async () => { const v = !on; setOn(v); const { error } = await supabase.from('staff').update({ can_expense: v }).eq('id', staffId); if (error) setOn(!v); };
  return (
    <div className="st-row exp-sw"><div className="st-l"><b>Can add expenses</b><small>Floating + on their Home, any day (Parking, Uber, Gas, Other). You approve each one.</small></div>
      <button type="button" role="switch" aria-checked={on} className={'sw' + (on ? ' on' : '')} onClick={flip}><span className="sw-track"><span className="sw-knob" /></span><span className="sw-lbl">{on ? 'ON' : 'OFF'}</span></button></div>);
}

/** Bookings / event page → Allow expense for this shift (closes 2 days after the event). */
export function ShiftExpenseToggle({ shiftId, eventDate, until }: { shiftId: string; eventDate: string; until?: string | null }) {
  const [u, setU] = useState<string | null>(until ?? null);
  useEffect(() => { if (until !== undefined) return; supabase.from('shifts').select('expense_until').eq('id', shiftId).maybeSingle().then(({ data }) => setU((data as { expense_until: string | null } | null)?.expense_until ?? null)); }, [shiftId, until]);
  const open = !!u && new Date(u) > new Date();
  const flip = async () => {
    const v = open ? null : new Date(new Date(eventDate + 'T23:59:00').getTime() + 2 * 864e5).toISOString();
    setU(v); const { error } = await supabase.from('shifts').update({ expense_until: v }).eq('id', shiftId); if (error) setU(u);
  };
  return <button type="button" className={'exp-allow' + (open ? ' on' : '')} onClick={flip} title="They get a quiet “shift is done · + Add an expense” card for 2 days">{open ? '✓ Expense allowed' : '+ Allow expense'}</button>;
}

type Row = { id: string; staff_id: string; kind: string; amount: number; exp_date: string; receipt_path: string | null; note: string | null; created_at: string; shift_id: string | null;
  staff: { full_name: string } | null; shifts: { events: { title: string } | null } | null };

/** Today → Needs you: one card per waiting expense. */
export function ExpenseNeeds({ tick, onCount }: { tick: number; onCount?: (n: number) => void }) {
  const [rows, setRows] = useState<Row[]>([]); const [urls, setUrls] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({}); const [no, setNo] = useState<string | null>(null); const [t, setT] = useState(0); const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    const { data, error } = await supabase.from('expenses').select('id,staff_id,kind,amount,exp_date,receipt_path,note,created_at,shift_id,staff:staff!expenses_staff_id_fkey(full_name),shifts(events(title))').eq('status', 'waiting').order('created_at');
    if (error) { setRows([]); return; }
    const r = (data ?? []) as unknown as Row[]; setRows(r);
    const paths = r.map((x) => x.receipt_path).filter(Boolean) as string[];
    if (paths.length) { const { data: s } = await supabase.storage.from('receipts').createSignedUrls(paths, 3600); setUrls(Object.fromEntries((s ?? []).map((d, i) => [paths[i], d.signedUrl ?? '']))); }
  })(); }, [tick, t]);
  useEffect(() => { onCount?.(rows.length); }, [rows.length]);
  const decide = async (id: string, ok: boolean) => { setErr(''); const { error } = await supabase.rpc('admin_decide_expense', { p_id: id, p_ok: ok, p_reason: why[id] ?? null }); if (error) setErr(error.message); else { setNo(null); setT((x) => x + 1); } };
  if (!rows.length) return null;
  return (
    <div className="nh-list">
      {rows.map((r) => (
        <div key={r.id} className="nh-card exp-card">
          <div className="nh-top"><b>{r.staff?.full_name ?? '?'} · {KIND[r.kind] ?? r.kind} ${Number(r.amount).toFixed(2)}</b><i className="nh-tag gold">EXPENSE</i></div>
          <span className="muted sm">{dLabel(r.exp_date)}{r.shifts?.events?.title ? ` · ${r.shifts.events.title}` : ' · not for an event'}{r.note ? ` · “${r.note}”` : ''}</span>
          {r.receipt_path && urls[r.receipt_path] && <a href={urls[r.receipt_path]} target="_blank" rel="noreferrer" className="exp-rc"><img src={urls[r.receipt_path]} alt="Receipt" /></a>}
          {no === r.id ? (
            <div className="nh-acts"><input className="hq-why" autoFocus placeholder="Short reason (they see it)" value={why[r.id] ?? ''} onChange={(e) => setWhy({ ...why, [r.id]: e.target.value })} />
              <button className="abtn sm red" onClick={() => decide(r.id, false)}>Decline</button><button className="lnk sm" onClick={() => setNo(null)}>Cancel</button></div>
          ) : (
            <div className="nh-acts"><button className="abtn sm dark" onClick={() => decide(r.id, true)}>Approve · add to pay</button><button className="abtn sm" onClick={() => setNo(r.id)}>Decline</button></div>)}
        </div>))}
      {err && <p className="error">{err}</p>}
    </div>);
}
