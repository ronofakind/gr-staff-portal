import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/* Push 66 · "Want the night off?" (migration 092). Only the person asked sees it. Yes = off the shift right away. */
type NO = { id: string; due_at: string; card: { venue?: string; date?: string; start?: string; position?: string } };
const TZ = 'America/Toronto';
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const day = (ymd?: string) => (ymd ? new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '') : '');
const by = (iso: string) => { const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); const t = new Date().toLocaleDateString('en-CA', { timeZone: TZ }); return `${d === t ? 'today' : new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })} ${t12(iso)}`; };

export function NightOffCards({ onDone, preview = false }: { onDone?: () => void; preview?: boolean }) {
  const [list, setList] = useState<NO[]>([]); const [done, setDone] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  useEffect(() => { if (preview) return; supabase.rpc('my_night_off').then(({ data, error }) => { if (!error && Array.isArray(data)) setList(data as NO[]); }); }, [preview]);
  const answer = async (a: NO, yes: boolean) => {
    setBusy(a.id); setErr('');
    const { data, error } = await supabase.rpc('night_off_answer', { p_id: a.id, p_yes: yes });
    setBusy(''); if (error) { setErr(error.message); return; }
    setDone((m) => ({ ...m, [a.id]: String(data) })); if (yes) setTimeout(() => onDone?.(), 1200);
  };
  return <>{list.map((a) => {
    const st = done[a.id]; const c = a.card;
    if (st === 'yes') return <div key={a.id} className="sn no-done ok">✓ <b>Night off.</b> You’re off {c.venue} on {day(c.date)}. Thanks!</div>;
    if (st === 'no') return <div key={a.id} className="sn no-done">👍 <b>You keep your shift.</b> See you at {c.start ? t12(c.start) : 'the event'}.</div>;
    if (st === 'closed') return <div key={a.id} className="sn no-done">This ask is closed · your shift stays as it is.</div>;
    return (
      <div key={a.id} className="sn sn-ask home no-ask">
        <small className="sn-k" style={{ color: '#9B2226' }}>WANT THE NIGHT OFF?</small>
        <div className="serif sn-venue">{c.venue}</div>
        <span className="sn-sub">{day(c.date)} · <b>{c.position} · {c.start ? t12(c.start) : ''}</b></span>
        <span className="sn-dim">We have one more person than we need that night. If you’d like the night off, tap yes. <b>No effect on your reliability.</b></span>
        <span className="sn-by">Answer by {by(a.due_at)}</span>
        <div className="sn-btns">
          <button className="sn-yes dark" disabled={!!busy} onClick={() => answer(a, true)}>{busy === a.id ? '…' : 'Yes, I’ll take the night off'}</button>
          <button className="sn-no" disabled={!!busy} onClick={() => answer(a, false)}>No, I’ll work it</button>
        </div>
        <span className="sn-dim">No answer = you keep your shift.</span>
        {err && <p className="error">{err}</p>}
      </div>);
  })}</>;
}
