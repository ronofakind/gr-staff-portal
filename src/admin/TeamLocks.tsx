import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { doesBar, allStaff, ap12, bookingChange, confirmationsSent, roleName, ROLES, startIso, type AEvent, type AStaff } from './api';
import { locksBetween, setLock, lockTitle, NO_LOCKS, type Locks } from './locks';

/* Push 50 · event page → Team: everyone booked, with the padlock (admin only, staff never see it).
   Locked = suggestions never move or remove them (auto-fill, client change, sheet Approve all, find replacement).
   MDs / managers start locked; tap to unlock. "+ Lock someone in" = booked + locked, not asked: a quiet booking
   like any booking made before confirmations go out (Send / Outbox rules unchanged). */

const TZ = 'America/Toronto';
const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function TeamLocks({ evs, onChange }: { evs: AEvent[]; onChange: () => void }) {
  const date = evs[0]?.event_date;
  const [locks, setLocks] = useState<Locks>(NO_LOCKS);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const ids = evs.map((e) => e.id + e.shifts.length).join(',');
  useEffect(() => { if (date) locksBetween(date, date, evs).then(setLocks); }, [date, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const both = evs.some((e) => e.department === 'bar') && evs.some((e) => e.department !== 'bar');
  const rows = evs.flatMap((e) => e.shifts.filter((s) => s.status !== 'declined' && !s.attendance && !s.cancelled_at).map((s) => ({ s, e })))
    .sort((a, b) => Number(a.e.department === 'bar') - Number(b.e.department === 'bar') || Number(!locks.ids.has(a.s.id)) - Number(!locks.ids.has(b.s.id))
      || a.s.planned_start.localeCompare(b.s.planned_start) || (a.s.staff?.full_name ?? '').localeCompare(b.s.staff?.full_name ?? ''));
  const nLocked = rows.filter((r) => locks.ids.has(r.s.id)).length;

  const toggle = async (id: string) => {
    setErr('');
    if (!locks.ready) { setErr('The padlock needs migration 055. MDs and managers already count as locked.'); return; }
    try {
      const now = await setLock(id, !locks.ids.has(id));
      setLocks((l) => { const x = new Set(l.ids); const bd = new Set(l.byDefault); bd.delete(id); if (now) x.add(id); else x.delete(id); return { ...l, ids: x, byDefault: bd }; });
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread"><b>{rows.length} booked</b><span className="muted sm">🔒 {nLocked} locked</span></div>
      {rows.map(({ s, e }) => {
        const on = locks.ids.has(s.id); const def = locks.byDefault.has(s.id);
        return (
          <div key={s.id} className={'lk-row' + (on ? ' on' : '')}>
            <b className="grow">{s.staff?.full_name ?? '?'}</b>
            <span className="muted sm">{both ? (e.department === 'bar' ? 'Bar · ' : 'Floor · ') : ''}{roleName(s.position_code)} · {ap12(hmOf(s.planned_start))}{on && def && !['MD', 'BM'].includes(s.position_code ?? '') ? ' · manager' : ''}</span>
            <button className={'lk-lock' + (on ? ' on' : '')} title={lockTitle(on, def)} aria-pressed={on} aria-label={on ? `Unlock ${s.staff?.full_name}` : `Lock ${s.staff?.full_name}`} onClick={() => toggle(s.id)}>{on ? '🔒' : '🔓'}</button>
          </div>
        );
      })}
      {!rows.length && <div className="muted sm">Nobody booked yet.</div>}
      {err && <div className="accent sm">{err}</div>}
      {open ? <LockIn evs={evs} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onChange(); }} />
        : <button className="lnk sm no-print" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setOpen(true)}>+ Lock someone in</button>}
      <div className="muted sm">Locked people are never moved or removed by suggestions (auto-fill, client change, sheet changes, find replacement). Only you see the padlock.</div>
    </div>
  );
}

/** Pick a person → booked + locked, not asked. */
function LockIn({ evs, onClose, onDone }: { evs: AEvent[]; onClose: () => void; onDone: () => void }) {
  const [staff, setStaff] = useState<AStaff[] | null>(null);
  const [evId, setEvId] = useState((evs.find((e) => e.department !== 'bar') ?? evs[0]).id);
  const ev = evs.find((e) => e.id === evId) ?? evs[0];
  const bar = ev.department === 'bar';
  const codes = ROLES.filter((r) => r.dept === (bar ? 'bar' : 'floor'));
  const [code, setCode] = useState(bar ? 'BT' : 'W');
  const starts = [...new Set((ev.staffing ?? []).filter((l) => l.code === code || (!['MD', 'BM'].includes(code) && !['MD', 'BM'].includes(l.code))).map((l) => l.start))].sort();
  const [start, setStart] = useState('');
  const st = start || starts[0] || (ev.start_time ?? '17:00').slice(0, 5);
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { allStaff().then(setStaff).catch((e) => setErr((e as Error).message)); }, []);
  useEffect(() => { setCode(bar ? 'BT' : 'W'); setStart(''); }, [evId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onEv = new Set(ev.shifts.filter((s) => s.status !== 'declined' && !s.attendance && !s.cancelled_at).map((s) => s.staff_id));
  const list = useMemo(() => (staff ?? []).filter((s) => s.active && s.role !== 'admin' && !onEv.has(s.id) && (bar ? doesBar(s) : s.department !== 'bar'))
    .sort((a, b) => a.full_name.localeCompare(b.full_name)), [staff, evId, ev.shifts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = list.find((s) => s.full_name === q) ?? (q ? list.filter((s) => norm(s.full_name).includes(norm(q))).length === 1 ? list.find((s) => norm(s.full_name).includes(norm(q))) : undefined : undefined);

  const save = async () => {
    if (!pick) return;
    setBusy(true); setErr('');
    const ps = startIso(ev.event_date, st);
    const ins = await supabase.from('shifts').insert({ event_id: ev.id, staff_id: pick.id, position_code: code, position_detail: roleName(code), planned_start: ps, status: 'booked', locked: true }).select('id').single();
    if (ins.error) {
      setBusy(false);
      setErr(/locked/.test(ins.error.message) ? 'Lock someone in needs migration 055.' : /duplicate|unique/i.test(ins.error.message) ? `${pick.full_name} is already on this event.` : ins.error.message);
      return;
    }
    // same as any booking: quiet before confirmations go out; after, they get "You're booked" like a normal add
    await bookingChange('booked', { staff_id: pick.id, shift_id: (ins.data as { id: string }).id, to: { id: ev.id, event_date: ev.event_date, title: ev.title, sent: confirmationsSent(ev), start: ps }, position: roleName(code) });
    setBusy(false); onDone();
  };

  return (
    <div className="adm-card stack" style={{ gap: 8, marginTop: 6 }}>
      <b>Lock someone in</b>
      <span className="muted sm">Booked and locked, not asked. {confirmationsSent(ev) ? 'Confirmations already went out for this event, so they get “You’re booked” like any new booking.' : 'Nothing is sent now; they get the details when you send confirmations.'}</span>
      <div className="lk-add">
        {evs.length > 1 && <select value={evId} onChange={(e) => setEvId(e.target.value)} aria-label="Floor or bar">{evs.map((e) => <option key={e.id} value={e.id}>{e.department === 'bar' ? 'Bar' : 'Floor'}</option>)}</select>}
        <input list="lk-people" placeholder={staff ? 'Type a name…' : 'Loading…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Person" />
        <datalist id="lk-people">{list.map((s) => <option key={s.id} value={s.full_name} />)}</datalist>
        <select value={code} onChange={(e) => { setCode(e.target.value); setStart(''); }} aria-label="Position">{codes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select>
        <select value={st} onChange={(e) => setStart(e.target.value)} aria-label="Start">{[...new Set([...starts, st])].sort().map((t) => <option key={t} value={t}>{ap12(t)}</option>)}</select>
      </div>
      {err && <div className="accent sm">{err}</div>}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button className="abtn" onClick={onClose}>Cancel</button>
        <button className="abtn dark" disabled={!pick || busy} onClick={save}>{busy ? 'Saving…' : pick ? `🔒 Lock in ${pick.full_name.split(' ')[0]}` : 'Lock in'}</button>
      </div>
    </div>
  );
}
