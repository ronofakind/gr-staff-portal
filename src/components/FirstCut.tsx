import { useState } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Push 64 · "Ask to be first cut" on a booked shift (board AvailUntilV1).
 * Staff can ask, and Undo, until the shift starts. The MD and Ronnie only see a tag: no yes / no, no alert.
 */
export function FirstCut({ shiftId, at, start, mgr, preview = false, compact = false }:
  { shiftId: string; at: string | null | undefined; start: string; mgr?: string | null; preview?: boolean; compact?: boolean }) {
  const [asked, setAsked] = useState<string | null>(at ?? null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  if (Date.now() >= new Date(start).getTime()) return null;
  const who = [mgr ? mgr.split(' ')[0] : null, 'Ronnie'].filter(Boolean).join(' and ');
  const set = async (on: boolean) => {
    setErr(''); const prev = asked; setAsked(on ? new Date().toISOString() : null);
    if (preview) return;
    setBusy(true);
    const { error } = await supabase.rpc('cut_first', { p_shift: shiftId, p_on: on });
    setBusy(false);
    if (error) { setAsked(prev); setErr(/started/.test(error.message) ? 'Your shift has started: talk to your manager.' : error.message); }
  };
  if (asked) return (
    <div className={'fc-done' + (compact ? ' compact' : '')}>
      <span className="grow">✓ <b>Asked to be first cut.</b> {who} can see it. Not a promise.</span>
      <button type="button" disabled={busy} onClick={() => set(false)}>Undo</button>
      {err && <small className="err">{err}</small>}
    </div>
  );
  return compact ? (
    <button type="button" className="fc-link" disabled={busy} onClick={() => set(true)}>✋ Want to leave early? <b>Ask to be first cut</b>{err && <small className="err"> · {err}</small>}</button>
  ) : (
    <div className="fc-card">
      <b>Want to leave early that night?</b>
      <span>Ask to be first cut. Your manager decides on the night, depending on the event.</span>
      <button type="button" disabled={busy} onClick={() => set(true)}>Ask to be first cut</button>
      {err && <small className="err">{err}</small>}
    </div>
  );
}
