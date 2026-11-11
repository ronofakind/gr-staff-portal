// push 97 · Day pool (boards DayPoolV1 + DayPoolNov27V1, mapping "event readiness" #4).
// Multi-event days: everyone who said yes stays in the day's pool until Ronnie places them on an event and locks them.
// A placed person is a "pool" shift (shifts.pool_hold): staff don't see it. Locked (padlock, 055) = final: staff see
// "You're on · time to come", no Confirm. ~4 days out, one tap: one confirmation each + the rest of the pool released
// (gone from their app, no message) and kept here as backups.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { allStaff, addDays, dLabel, isoDay, roleName, startIso, type AStaff } from './api';

type Ev = { id: string; title: string; start_time: string | null; staff_needed: number; staffing: { dept: string; code: string; start: string; count: number }[] | null;
  details_pending: boolean | null; start_tbc: boolean | null; tentative: boolean | null; caterer_name?: string | null; venues: { name: string } | null };
type Sh = { id: string; event_id: string; staff_id: string; position_code: string | null; status: string; pool_hold: boolean; locked: boolean | null; notified_at: string | null };
type Av = { staff_id: string; status: string; from_time: string | null; answered_at: string | null; released_at: string | null };
const TORD: Record<string, number> = { A: 0, B: 1, C: 2 };

export function DayPool() {
  const { date = isoDay(new Date()) } = useParams();
  const [evs, setEvs] = useState<Ev[]>([]); const [sh, setSh] = useState<Sh[]>([]); const [av, setAv] = useState<Av[]>([]);
  const [staff, setStaff] = useState<AStaff[]>([]); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { (async () => {
    const { data: e, error } = await supabase.from('events').select('id,title,start_time,staff_needed,staffing,details_pending,start_tbc,tentative,caterer_name,venues(name)').eq('event_date', date).neq('department', 'bar').order('start_time');
    if (error) { setErr(error.message); return; }
    const es = (e ?? []) as unknown as Ev[]; setEvs(es);
    const [s, a, st] = await Promise.all([
      supabase.from('shifts').select('id,event_id,staff_id,position_code,status,pool_hold,locked,notified_at').in('event_id', es.length ? es.map((x) => x.id) : ['00000000-0000-0000-0000-000000000000']).neq('status', 'declined'),
      supabase.from('availability').select('staff_id,status,from_time,answered_at,released_at').eq('for_date', date).not('ask_id', 'is', null),
      staff.length ? Promise.resolve(staff) : allStaff(),
    ]);
    if (s.error) setErr(s.error.message);
    setSh((s.data ?? []) as Sh[]); setAv((a.data ?? []) as Av[]); setStaff(st);
  })(); }, [date, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const tier = (id: string) => byId[id]?.staff_private?.tier ?? null;
  const rank = (id: string) => byId[id]?.staff_private?.ranking ?? 9999;
  const onDay = new Set(sh.map((s) => s.staff_id));
  const sortP = (a: string, b: string) => (TORD[tier(a) ?? ''] ?? 9) - (TORD[tier(b) ?? ''] ?? 9) || rank(a) - rank(b);
  const pool = av.filter((a) => (a.status === 'yes') && !a.released_at && !onDay.has(a.staff_id)).sort((a, b) => sortP(a.staff_id, b.staff_id));
  const maybes = av.filter((a) => a.status === 'maybe' && !a.released_at && !onDay.has(a.staff_id));
  const backups = av.filter((a) => a.released_at && !onDay.has(a.staff_id)).sort((a, b) => sortP(a.staff_id, b.staff_id));
  const lockedOf = (s: Sh) => s.locked ?? ['MD', 'BM'].includes(s.position_code ?? '');
  const needOf = (e: Ev) => (e.staffing ?? []).filter((l) => l.dept !== 'bar').reduce((n, l) => n + (l.count || 0), 0) || e.staff_needed;
  const placedOf = (e: Ev) => sh.filter((s) => s.event_id === e.id);
  const openOf = (e: Ev) => Math.max(0, needOf(e) - placedOf(e).length);
  const waiterStart = (e: Ev) => (e.staffing ?? []).find((l) => !['MD', 'BM'].includes(l.code) && l.dept !== 'bar')?.start ?? e.start_time ?? '17:00';
  const holds = sh.filter((s) => s.pool_hold);
  const fourOut = addDays(date, -4); const today = isoDay(new Date());
  const missing = evs.filter((e) => e.details_pending || e.start_tbc).map((e) => e.venues?.name ?? e.title);

  const run = async (f: () => Promise<string | void>) => { setBusy(true); setErr(''); setMsg(''); try { const m = await f(); if (m) setMsg(m); } catch (x) { setErr((x as Error).message); } setBusy(false); setTick((t) => t + 1); };
  const place = (staffId: string, e: Ev) => run(async () => {
    const { error } = await supabase.from('shifts').insert({ event_id: e.id, staff_id: staffId, position_code: 'W', position_detail: roleName('W'), planned_start: startIso(date, waiterStart(e)), status: 'booked', pool_hold: true, time_tbc: !!(e.start_tbc || e.details_pending) });
    if (error) throw error;
  });
  const unplace = (s: Sh) => run(async () => { const { error } = await supabase.from('shifts').delete().eq('id', s.id).eq('pool_hold', true); if (error) throw error; });
  const lock = (s: Sh, on: boolean) => run(async () => { const { error } = await supabase.from('shifts').update({ locked: on }).eq('id', s.id); if (error) throw error; });
  /** ✦ fill the open spots from the pool: best first, spread so the strongest people don't all land on one event. Never touches anyone already placed. */
  const suggest = () => run(async () => {
    const opens = evs.map((e) => ({ e, n: openOf(e) })).filter((x) => x.n > 0);
    const rows: Record<string, unknown>[] = []; let i = 0;
    for (const p of pool) {
      const live = opens.filter((x) => x.n > 0); if (!live.length) break;
      const x = live[i % live.length]; i++; x.n--;
      rows.push({ event_id: x.e.id, staff_id: p.staff_id, position_code: 'W', position_detail: roleName('W'), planned_start: startIso(date, waiterStart(x.e)), status: 'booked', pool_hold: true, time_tbc: !!(x.e.start_tbc || x.e.details_pending) });
    }
    if (!rows.length) return 'Nothing to place: no open spots, or nobody left in the pool.';
    const { error } = await supabase.from('shifts').insert(rows); if (error) throw error;
    return `Placed ${rows.length}. Check the teams, move anyone, lock the final ones. Staff see nothing yet.`;
  });
  const confirmAll = () => run(async () => {
    if (missing.length && !confirm(`Start time / venue still missing: ${missing.join(', ')}. Send the confirmations anyway?`)) return;
    if (!confirm(`Send ${holds.length} confirmation${holds.length === 1 ? '' : 's'} and release the ${pool.length + maybes.length} still in the pool (they see nothing, they stay here as backups)?`)) return;
    const { data, error } = await supabase.rpc('admin_pool_confirm', { p_date: date }); if (error) throw error;
    const r = data as { confirmed: number; released: number }; return `✓ ${r.confirmed} confirmations sent · ${r.released} released (kept below as backups).`;
  });

  const P = ({ id, right, note }: { id: string; right?: React.ReactNode; note?: string }) => <div className="dp-p">
    <i className={'tier-dot ' + (tier(id) ?? '')}>{tier(id) ?? '–'}</i><span className="grow">{byId[id]?.full_name ?? '…'}{note && <small className="muted"> · {note}</small>}</span>{right}</div>;
  return (
    <div className="stack-lg dp">
      <div className="toolbar"><div>
        <div className="kick"><Link to={`/admin/bookings?date=${date}`}>‹ Bookings</Link> · DAY POOL</div>
        <h1 className="serif-h">{dLabel(date, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
        <div className="muted sm">{evs.length} events · {pool.length} in the pool · {holds.length} placed, not confirmed yet · confirm ~{dLabel(fourOut, { weekday: 'short', month: 'short', day: 'numeric' })}</div></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="abtn dark" disabled={busy || !pool.length || !evs.some((e) => openOf(e) > 0)} onClick={suggest}>✦ Place the pool</button>
          <button className={'abtn' + (today >= fourOut ? ' dark' : '')} disabled={busy || (!holds.length && !pool.length)} onClick={confirmAll}>Confirm {holds.length} &amp; release the rest</button>
        </div></div>
      {msg && <div className="adm-card okc sm">{msg}</div>}{err && <div className="adm-card err sm">{err}</div>}
      <div className="dp-cols">
        <section className="adm-card dp-pool">
          <div className="spread"><b>Pool · said yes</b><small className="muted">{pool.length}</small></div>
          <small className="muted">Best first (A → B → C, then ranking). Tap an event to place someone. Staff see nothing until you confirm.</small>
          {!pool.length && <span className="muted sm">Nobody waiting. Send the dates from Availability.</span>}
          {pool.map((a) => <P key={a.staff_id} id={a.staff_id} note={a.from_time ? `from ${a.from_time.slice(0, 5)}` : undefined}
            right={<span className="dp-go">{evs.map((e) => <button key={e.id} className="abtn sm" disabled={busy} onClick={() => place(a.staff_id, e)}>→ {(e.venues?.name ?? e.title).split(' ')[0]}</button>)}</span>} />)}
          {maybes.length > 0 && <small className="muted">Maybe ({maybes.length}): {maybes.map((m) => byId[m.staff_id]?.full_name).join(' · ')}</small>}
          {backups.length > 0 && <>
            <div className="spread" style={{ marginTop: 10 }}><b>Backups</b><small className="muted">released · not in their app</small></div>
            {backups.map((a) => <P key={a.staff_id} id={a.staff_id} right={<Link className="abtn sm" to={`/admin/messages?staff=${a.staff_id}`}>Ask ›</Link>} />)}
          </>}
        </section>
        {evs.map((e) => { const ps = placedOf(e).sort((a, b) => Number(['MD', 'BM'].includes(b.position_code ?? '')) - Number(['MD', 'BM'].includes(a.position_code ?? '')) || sortP(a.staff_id, b.staff_id)); return (
          <section key={e.id} className="adm-card dp-ev">
            <div className="spread"><b>{e.venues?.name ?? e.title}</b><Link className="lnk sm" to={`/admin/event/${e.id}`}>Event ›</Link></div>
            <small className="muted">{[e.caterer_name ? `Food by ${e.caterer_name}` : null, e.tentative ? 'client to confirm' : null, e.start_tbc || e.details_pending ? 'start to come' : e.start_time?.slice(0, 5), `need ${needOf(e)}`, openOf(e) ? `${openOf(e)} open` : 'full'].filter(Boolean).join(' · ')}</small>
            {ps.map((s) => <P key={s.id} id={s.staff_id} note={s.position_code && s.position_code !== 'W' ? s.position_code : undefined}
              right={<span className="dp-go">
                {!s.pool_hold ? <small className="okc">{s.status === 'confirmed' ? '✓ confirmed' : s.notified_at ? 'sent' : 'booked'}</small> : <>
                  <button className={'abtn sm' + (lockedOf(s) ? ' dark' : '')} disabled={busy} onClick={() => lock(s, !lockedOf(s))} title={lockedOf(s) ? 'Locked: final, they see “You’re on”' : 'Lock: final placement'}>{lockedOf(s) ? '🔒' : '🔓'}</button>
                  {!lockedOf(s) && <button className="lnk sm" disabled={busy} onClick={() => unplace(s)}>back to pool</button>}</>}
              </span>} />)}
            {openOf(e) > 0 && <span className="dp-open">○ {openOf(e)} open</span>}
          </section>); })}
      </div>
      <small className="muted">🔓 placed: staff see nothing. 🔒 locked: final, never moved by ✦, they see “You’re on · time to come” (no Confirm, no alert). Confirm &amp; release sends one confirmation each and quietly releases everyone still in the pool.</small>
    </div>);
}
