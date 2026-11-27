import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Nov 26 · Ronnie asks someone already sent to switch to another event (migration 143). Yes = moved + confirmed; No = nothing moves. */
type Ask = { id: string; to_start: string; from_label: string | null; to_label: string | null; shift_id: string };
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Toronto' });

export function SwitchAsks({ staffId }: { staffId: string }) {
  const [asks, setAsks] = useState<Ask[]>([]); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  const load = () => supabase.from('switch_asks').select('id,to_start,from_label,to_label,shift_id').eq('staff_id', staffId).eq('status', 'asked').order('created_at')
    .then(({ data, error }) => { if (!error) setAsks((data ?? []) as Ask[]); });
  useEffect(() => { void load(); }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps
  const answer = async (a: Ask, yes: boolean) => { setBusy(a.id); setErr('');
    const { error } = await supabase.rpc('answer_switch_ask', { p_id: a.id, p_yes: yes }); setBusy('');
    if (error) setErr(error.message); else { setAsks((x) => x.filter((y) => y.id !== a.id)); if (yes) setTimeout(() => window.location.reload(), 400); } };
  if (!asks.length) return null;
  return <>{asks.map((a) => <section key={a.id} className="sw-ask">
    <small className="sw-k">RONNIE ASKS</small>
    <b className="sw-q">Can you work at {a.to_label ?? 'another event'} instead?</b>
    <div className="sw-two"><div><small>Now</small><b>{a.from_label ?? ''}</b></div><div className="new"><small>Instead</small><b>{a.to_label ?? ''}</b><span>{day(a.to_start)} · {t12(a.to_start)}</span></div></div>
    <button className="sw-yes" disabled={!!busy} onClick={() => answer(a, true)}>Yes, switch</button>
    <button className="sw-no" disabled={!!busy} onClick={() => answer(a, false)}>No, keep {(a.from_label ?? '').split(' · ')[0] || 'my shift'}</button>
    {err && <small className="error">{err}</small>}
  </section>)}</>;
}
