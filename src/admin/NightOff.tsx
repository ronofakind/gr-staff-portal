import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { locksBetween } from './locks';
import { ap12, type AEvent } from './api';

/* Push 66 · Overbooked → "Want the night off?" (board NightOffV1, migration 092).
   One person at a time · never MDs / managers · never locked · 2 h to answer · yes = released right away, MD not told. */

type NAsk = { id: string; event_id: string; staff_id: string; asked_at: string; due_at: string; answer: 'yes' | 'no' | null; answered_at: string | null; cancelled_at: string | null };
const active = (s: AEvent['shifts'][number]) => s.status !== 'declined' && !s.attendance;
export const overBy = (e: AEvent) => Math.max(0, e.shifts.filter(active).length - (e.staff_needed || 0));
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });

export function NightOff({ evs, onChange }: { evs: AEvent[]; onChange: () => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const list = evs.filter((e) => e.event_date >= today && overBy(e) > 0);
  if (!list.length) return null;
  return <>{list.map((e) => <One key={e.id} e={e} onChange={onChange} />)}</>;
}

function One({ e, onChange }: { e: AEvent; onChange: () => void }) {
  const [open, setOpen] = useState(false); const [asks, setAsks] = useState<NAsk[] | null>(null);
  const [locked, setLocked] = useState<Set<string>>(new Set()); const [info, setInfo] = useState<Record<string, { rank: number | null; tier: string | null; nights: number }>>({});
  const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [tick, setTick] = useState(0);
  const by = overBy(e); const act = e.shifts.filter(active);
  useEffect(() => {
    supabase.from('night_off_asks').select('id,event_id,staff_id,asked_at,due_at,answer,answered_at,cancelled_at').eq('event_id', e.id).order('asked_at')
      .then(({ data, error }) => setAsks(error ? [] : (data as NAsk[])));
  }, [e.id, tick]);
  useEffect(() => {
    if (!open) return;
    locksBetween(e.event_date, e.event_date, [e as never]).then((l) => setLocked(l.ids));
    const ids = act.map((s) => s.staff_id);
    const from = new Date(new Date(e.event_date + 'T12:00:00').getTime() - 6 * 864e5).toLocaleDateString('en-CA');
    Promise.all([
      supabase.from('staff_private').select('staff_id,ranking,tier').in('staff_id', ids),
      supabase.from('shifts').select('staff_id,status,attendance,events!inner(event_date)').in('staff_id', ids).gte('events.event_date', from).lte('events.event_date', e.event_date),
    ]).then(([p, h]) => {
      const m: Record<string, { rank: number | null; tier: string | null; nights: number }> = {};
      for (const r of (p.data ?? []) as { staff_id: string; ranking: number | null; tier: string | null }[]) m[r.staff_id] = { rank: r.ranking, tier: r.tier, nights: 0 };
      const days: Record<string, Set<string>> = {};
      for (const r of (h.data ?? []) as unknown as { staff_id: string; status: string; attendance: string | null; events: { event_date: string } }[]) if (r.status !== 'declined' && r.attendance !== 'cancelled') (days[r.staff_id] ??= new Set()).add(r.events.event_date);
      for (const sid of ids) m[sid] = { ...(m[sid] ?? { rank: null, tier: null, nights: 0 }), nights: days[sid]?.size ?? 0 };
      setInfo(m);
    });
  }, [open, e.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = (asks ?? []).find((a) => !a.answer && !a.cancelled_at && new Date(a.due_at) > new Date());
  const askedIds = new Set((asks ?? []).map((a) => a.staff_id));
  const nameOf = (sid: string) => e.shifts.find((s) => s.staff_id === sid)?.staff?.full_name ?? (asks?.find((a) => a.staff_id === sid) ? 'Released' : '—');
  const pool = act.filter((s) => !['MD', 'BM'].includes(s.position_code ?? '') && !locked.has(s.id) && s.staff_id !== e.manager_id)
    .sort((a, b) => (info[b.staff_id]?.rank ?? 0) - (info[a.staff_id]?.rank ?? 0));
  const suggested = pool.find((s) => !askedIds.has(s.staff_id))?.id;
  const ask = async (shiftId: string) => {
    setBusy(shiftId); setErr('');
    const { error } = await supabase.rpc('admin_night_off_ask', { p_shift: shiftId, p_minutes: 120 });
    setBusy(''); if (error) setErr(error.message); else { setTick((t) => t + 1); }
  };
  const cancel = async (id: string) => { setBusy(id); await supabase.rpc('admin_night_off_cancel', { p_id: id }); setBusy(''); setTick((t) => t + 1); };
  const state = (a: NAsk) => a.answer === 'yes' ? ['NIGHT OFF ✓', 'ok'] : a.answer === 'no' ? ['KEEPS SHIFT', ''] : a.cancelled_at ? ['CANCELLED', ''] : new Date(a.due_at) <= new Date() ? ['NO ANSWER · KEEPS IT', ''] : ['WAITING', 'gold'];
  return (
    <div className="adm-card no-card">
      <div className="no-bar"><b className="grow">{e.title}: overbooked by {by} · {act.length} booked for {e.staff_needed}</b>
        <button className="abtn dark sm" onClick={() => { setOpen(!open); onChange(); }}>{open ? 'Close' : 'Ask someone to take the night off'}</button></div>
      {asks && asks.length > 0 && <div className="no-list">
        {asks.map((a) => { const [t, c] = state(a); return (
          <div key={a.id} className="no-row"><b>{nameOf(a.staff_id)}</b><span className="muted sm grow">asked {t12(a.asked_at)}{a.answered_at ? ` · answered ${t12(a.answered_at)}` : !a.cancelled_at && !a.answer ? ` · answer by ${t12(a.due_at)}` : ''}</span>
            <i className={'no-tag ' + c}>{t}</i>{t === 'WAITING' && <button className="abtn sm" disabled={busy === a.id} onClick={() => cancel(a.id)}>Cancel ask</button>}</div>); })}
      </div>}
      {open && <div className="no-pick">
        <span className="muted sm">Pick one person · only they see it · 2 h to answer · {waiting ? <b>wait for {nameOf(waiting.staff_id).split(' ')[0]} first</b> : 'lowest ranked is suggested'}</span>
        {pool.map((s) => { const i = info[s.staff_id]; const done = askedIds.has(s.staff_id); return (
          <div key={s.id} className="no-row"><b>{s.staff?.full_name}</b>
            <span className="muted sm grow">{[i?.tier, i?.rank ? `rank ${i.rank}` : null, i && i.nights >= 4 ? `${i.nights} nights this week` : null].filter(Boolean).join(' · ')}</span>
            {s.id === suggested && <i className="no-tag gold">SUGGESTED</i>}{i && i.nights >= 4 && <i className="no-tag ok">MAY NEED A BREAK</i>}{done && <i className="no-tag">ASKED</i>}
            <button className={'abtn sm' + (s.id === suggested ? ' dark' : '')} disabled={!!waiting || !!busy || done} onClick={() => ask(s.id)}>{busy === s.id ? '…' : 'Ask'}</button></div>); })}
        <span className="muted sm">MDs, managers and locked people are never asked. Yes = released right away, no reliability hit, the MD isn’t told.{e.start_time ? ` Starts ${ap12(e.start_time.slice(0, 5))}.` : ''}</span>
        {err && <p className="error">{err}</p>}
      </div>}
    </div>
  );
}
