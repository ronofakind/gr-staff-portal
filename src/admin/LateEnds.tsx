import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/** Nov 6 · end times sent later by staff (071) → a gold card in Needs you until Ronnie taps OK. */
type L = { shift_id: string; punch_in: string; punch_out: string; late_entry_at: string; late_reason: string | null; late_ok_at: string | null;
  shifts: { staff: { full_name: string } | null; events: { id: string; title: string; event_date: string } | null } | null };
const tm = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

export function LateEnds() {
  const [rows, setRows] = useState<L[]>([]); const [tick, setTick] = useState(0);
  useEffect(() => {
    supabase.from('punches').select('shift_id,punch_in,punch_out,late_entry_at,late_reason,late_ok_at,shifts(staff:staff!shifts_staff_id_fkey(full_name),events(id,title,event_date))')
      .not('late_entry_at', 'is', null).is('late_admin_seen_at', null).order('late_entry_at', { ascending: false }).limit(20)
      .then(({ data, error }) => setRows(error ? [] : ((data ?? []) as unknown as L[])));
  }, [tick]);
  return <>{rows.map((r) => (
    <div key={r.shift_id} className="nsr-gold">
      <div className="grow"><b>{r.shifts?.staff?.full_name?.split(' ')[0] ?? 'Someone'} entered their end time later</b>
        <span>{r.shifts?.events?.title} · ended {tm(r.punch_out)}{r.late_reason ? ` · “${r.late_reason}”` : ''} · sent {tm(r.late_entry_at)}{r.late_ok_at ? ' · manager: ✓ looks right' : ' · manager hasn’t checked'}</span></div>
      {r.shifts?.events && <Link className="abtn sm" to={`/manage/${r.shifts.events.id}`}>Team</Link>}
      <button className="abtn sm dark" onClick={async () => { await supabase.from('punches').update({ late_admin_seen_at: new Date().toISOString() }).eq('shift_id', r.shift_id); setTick((t) => t + 1); }}>OK</button>
    </div>))}</>;
}
