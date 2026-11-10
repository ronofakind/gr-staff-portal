import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Nov 6 · "Remind me next time I book her" (migration 068). Only Ronnie sees these. */
export type Reminder = { id: string; staff_id: string; note: string; status: 'open' | 'told' | 'sent'; created_at: string; shift_id: string | null; resolved_at: string | null };
export const REM_COLS = 'id,staff_id,note,status,created_at,shift_id,resolved_at';

export async function openReminders(staffIds?: string[]): Promise<Record<string, Reminder[]>> {
  let q = supabase.from('staff_reminders').select(REM_COLS).eq('status', 'open').order('created_at');
  if (staffIds) { if (!staffIds.length) return {}; q = q.in('staff_id', staffIds); }
  const { data, error } = await q; if (error || !Array.isArray(data)) return {};
  const m: Record<string, Reminder[]> = {}; for (const r of data as Reminder[]) (m[r.staff_id] ??= []).push(r); return m;
}
export const resolveReminder = (id: string, status: 'told' | 'open') =>
  supabase.from('staff_reminders').update({ status, resolved_at: status === 'open' ? null : new Date().toISOString() }).eq('id', id);
/** what she'd read: the note without "(Isaac, Nov 5)" */
export const friendly = (note: string) => { const s = note.replace(/\s*\([^)]*\)\s*$/, '').trim(); return /^please\b/i.test(s) ? s : `Please note: ${s}`; };

export function RemindForm({ staffId, staffName, preset = '', convId, onClose, onSaved }: { staffId: string; staffName: string; preset?: string; convId?: string; onClose: () => void; onSaved?: () => void }) {
  const [txt, setTxt] = useState(preset); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!txt.trim()) return; setBusy(true);
    const { error } = await supabase.from('staff_reminders').insert({ staff_id: staffId, note: txt.trim(), conversation_id: convId ?? null });
    setBusy(false); if (error) { setErr(/staff_reminders/.test(error.message) ? 'Needs the database update (068) first.' : error.message); return; }
    onSaved?.(); onClose();
  };
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card bk-menu" onClick={(e) => e.stopPropagation()} style={{ gap: 10 }}>
      <b className="serif" style={{ fontSize: 22 }}>Reminder for {staffName.split(' ')[0]}</b>
      <textarea rows={3} autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Black shoes, not brown (Isaac, Nov 5)" />
      <span className="muted sm">Shows the next time you book {staffName.split(' ')[0]}. Only you see it.</span>
      {err && <span className="accent sm">{err}</span>}
      <div className="row" style={{ gap: 8 }}><button className="abtn dark grow" disabled={busy || !txt.trim()} onClick={save}>Save reminder</button><button className="abtn" onClick={onClose}>Cancel</button></div>
    </div></div>
  );
}

/** Profile · Admin only: open reminders + add one; sent ones show whether she tapped Got it */
export function ReminderList({ staffId, staffName }: { staffId: string; staffName: string }) {
  const [rows, setRows] = useState<(Reminder & { seen?: string | null })[] | null>(null); const [add, setAdd] = useState(false); const [tick, setTick] = useState(0);
  useEffect(() => {
    supabase.from('staff_reminders').select(REM_COLS).eq('staff_id', staffId).order('created_at', { ascending: false }).limit(6).then(async ({ data, error }) => {
      if (error || !Array.isArray(data)) { setRows([]); return; }
      const rs = data as Reminder[]; const sIds = rs.map((r) => r.shift_id).filter(Boolean) as string[];
      const seen: Record<string, string | null> = {};
      if (sIds.length) { const { data: n } = await supabase.from('shift_staff_notes').select('shift_id,seen_at').in('shift_id', sIds); for (const x of (n ?? []) as { shift_id: string; seen_at: string | null }[]) seen[x.shift_id] = x.seen_at; }
      setRows(rs.map((r) => ({ ...r, seen: r.shift_id ? seen[r.shift_id] ?? null : null })));
    });
  }, [staffId, tick]);
  const first = staffName.split(' ')[0];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b className="sm">📌 Reminders for next booking</b><button className="lnk sm accent" onClick={() => setAdd(true)}>+ Add</button></div>
      {rows?.length ? rows.map((r) => (
        <div key={r.id} className="sm row" style={{ gap: 8, alignItems: 'flex-start' }}>
          <span className="grow">{r.note}</span>
          <span className="muted nowrap">{r.status === 'open' ? 'waiting for next booking' : r.status === 'told' ? '✓ told' : r.seen ? <b className="okc">✓ {first} got it</b> : 'added to shift · not seen yet'}</span>
          {r.status === 'open' && <button className="lnk sm" onClick={async () => { await resolveReminder(r.id, 'told'); setTick((t) => t + 1); }}>Done</button>}
        </div>)) : <span className="muted sm">None.</span>}
      {add && <RemindForm staffId={staffId} staffName={staffName} onClose={() => setAdd(false)} onSaved={() => setTick((t) => t + 1)} />}
    </div>
  );
}
