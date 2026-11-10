import { useState } from 'react';
import { supabase, type ShiftRow } from '../lib/supabase';

/** Nov 6 · they end their own shift (070) · phone died / forgot → send the end time later (071). */
const t12 = (ms: number) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const REASONS = ['My phone died', 'No phone with me', 'Forgot'];

export function OwnClose({ s, onDone }: { s: ShiftRow; onDone: () => void }) {
  const pin = new Date(s.punches!.punch_in!).getTime();
  const stale = Date.now() - pin > 14 * 3600e3; // the night is over → only "I finished at…"
  const [pick, setPick] = useState(false); const [at, setAt] = useState(''); const [why, setWhy] = useState(''); const [busy, setBusy] = useState(false);
  const opts: number[] = []; const q = 15 * 60e3; const max = Math.min(Date.now(), pin + 20 * 3600e3);
  for (let x = Math.ceil((pin + q) / q) * q; x <= max; x += q) opts.push(x);
  opts.reverse();
  const hrs = (ms: number) => { const m = Math.round((ms - pin) / 60000); return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
  return (
    <div className="own-close">
      <span>🔑 {stale ? <><b>No end time yet.</b> Your phone died? No problem. Tell us when you finished.</> : <><b>You’re closing tonight.</b> When you’re done, end your shift here.</>}</span>
      {!stale && !pick && <button onClick={async () => { if (!confirm('End your shift now?')) return; const { error } = await supabase.rpc('staff_end_own', { p_shift: s.id }); if (error) { alert(error.message); return; } onDone(); }}>End my shift</button>}
      {!pick ? <button className={stale ? '' : 'own-later'} onClick={() => { setPick(true); setAt(String(opts[0] ?? '')); }}>{stale ? 'I finished at…' : 'I already finished · enter my time'}</button> : <>
        <b className="sm">When did you finish?</b>
        <select className="own-sel" value={at} onChange={(e) => setAt(e.target.value)}>{opts.map((x) => <option key={x} value={x}>{t12(x)} · {hrs(x)}</option>)}</select>
        <div className="own-why">{REASONS.map((r) => <button key={r} type="button" className={why === r ? 'on' : ''} onClick={() => setWhy(why === r ? '' : r)}>{r}</button>)}</div>
        <button disabled={!at || busy} onClick={async () => { setBusy(true); const { error } = await supabase.rpc('staff_end_later', { p_shift: s.id, p_out: new Date(Number(at)).toISOString(), p_reason: why || null }); setBusy(false); if (error) { alert(error.message); return; } onDone(); }}>Send my end time</button>
        <small>Your manager and Ronnie check it.</small></>}
      {!pick && !stale && <small>End my shift counts the time you tap, rounded up to 15 min.</small>}
    </div>
  );
}
