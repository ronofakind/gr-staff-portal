// push 108 · Bookings revamp, part 1: the Day sheet (board BookingDaySheetV1, doc "G&R staff app booking day sheet (mapping)").
// One screen shaped like the Events sheet: each event = a block (MD / bar manager at the head, one row per staff line with its
// count, time and slots, + an extras line), "Free this day" on the right. Tap a slot → pick; drag a name to another slot / event /
// back to Free; × → back to Free; ↶ Undo = last move. New placements are pool shifts (staff see nothing until you confirm).
// Part 2 = ✦ Fill, part 3 = click a name (person card, note, lock, confirm), part 4 = phone swap + retire Bookings / Day pool.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { allStaff, addDays, dLabel, isoDay, roleName, startIso, type AStaff } from './api';

type Line = { dept?: string; code: string; start: string | null; count: number };
type Ev = { id: string; title: string; department: string; start_time: string | null; staff_needed: number; guests: number | null; staffing: Line[] | null;
  details_pending: boolean | null; start_tbc: boolean | null; caterer_name?: string | null; venues: { name: string } | null };
type Sh = { id: string; event_id: string; staff_id: string; position_code: string | null; position_detail?: string | null; status: string; pool_hold: boolean; locked: boolean | null;
  notified_at: string | null; planned_start: string | null; time_tbc?: boolean | null };
type Av = { staff_id: string; status: string; from_time: string | null; released_at: string | null };
type Op = { label: string; undo: () => PromiseLike<unknown> };
const TORD: Record<string, number> = { A: 0, B: 1, C: 2 };
const LEAD = ['MD', 'BM'];
const hm = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }) : '';
const ap = (t: string | null | undefined) => { if (!t) return 'TBC'; const h = Number(t.slice(0, 2)); return `${h % 12 || 12}${t.slice(2, 5) !== ':00' ? t.slice(2, 5) : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const plural = (code: string, n: number) => { const r = roleName(code) || code; return n === 1 ? r : r.endsWith('s') ? r : r + 's'; };
const short = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : n; };
const isBar = (e: Ev) => e.department === 'bar';
const monday = (d: string) => { const x = new Date(d + 'T12:00:00'); const k = (x.getDay() + 6) % 7; return addDays(d, -k); };

/** Place each shift on a line (same code + same time, up to its count). Leftovers go to the extras line, then "also placed". */
function layout(e: Ev, shifts: Sh[]) {
  const lines = (e.staffing ?? []).filter((l) => !LEAD.includes(l.code) && l.count > 0).map((l, i) => ({ key: `${i}`, code: l.code, start: l.start ?? e.start_time?.slice(0, 5) ?? null, count: l.count, people: [] as Sh[] }));
  const leadNeed = (e.staffing ?? []).filter((l) => LEAD.includes(l.code)).reduce((n, l) => n + l.count, 0);
  const leads = shifts.filter((s) => LEAD.includes(s.position_code ?? ''));
  const rest = shifts.filter((s) => !LEAD.includes(s.position_code ?? '')).sort((a, b) => (a.planned_start ?? '').localeCompare(b.planned_start ?? ''));
  const left: Sh[] = [];
  for (const s of rest) { const t = hm(s.planned_start); const L = lines.find((l) => l.code === (s.position_code ?? 'W') && l.start === t && l.people.length < l.count)
      ?? lines.find((l) => l.start === t && l.people.length < l.count); if (L) L.people.push(s); else left.push(s); }
  const client = lines.reduce((n, l) => n + l.count, 0) + leadNeed;
  const exN = !isBar(e) && client > 7 ? Math.ceil(client * 0.1) : 0;
  const lastStart = lines.length ? lines[lines.length - 1].start : e.start_time?.slice(0, 5) ?? null;
  const extras = { key: 'x', code: isBar(e) ? 'BT' : 'W', start: lastStart, count: exN, people: left.splice(0, exN) };
  return { lines, leads, leadNeed: Math.max(leadNeed, isBar(e) ? 1 : 1), client, extras, over: left };
}

export function DaySheet() {
  const { date = isoDay(new Date()) } = useParams(); const nav = useNavigate();
  const [dept, setDept] = useState<'floor' | 'bar' | 'both'>(() => { try { return (localStorage.getItem('gr_ds_dept') as 'floor' | 'bar' | 'both') || 'both'; } catch { return 'both'; } });
  const [evs, setEvs] = useState<Ev[]>([]); const [sh, setSh] = useState<Sh[]>([]); const [av, setAv] = useState<Av[]>([]); const [off, setOff] = useState<Set<string>>(new Set());
  const [staff, setStaff] = useState<AStaff[]>([]); const [week, setWeek] = useState<{ d: string; need: number; have: number; n: number; free: number }[]>([]);
  const [tick, setTick] = useState(0); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [ops, setOps] = useState<Op[]>([]); const [pick, setPick] = useState<{ e: Ev; code: string; start: string | null } | null>(null);
  const [drag, setDrag] = useState<Sh | { staff_id: string } | null>(null); const [tab, setTab] = useState<'yes' | 'maybe'>('yes');
  useEffect(() => { try { localStorage.setItem('gr_ds_dept', dept); } catch { /* */ } }, [dept]);
  const wk0 = monday(date);

  useEffect(() => { (async () => {
    const [e, a, o, st] = await Promise.all([
      supabase.from('events').select('id,title,department,start_time,staff_needed,guests,staffing,details_pending,start_tbc,caterer_name,venues(name)').eq('event_date', date).order('start_time'),
      supabase.from('availability').select('staff_id,status,from_time,released_at').eq('for_date', date).not('ask_id', 'is', null),
      supabase.from('days_off').select('staff_id').lte('from_date', date).gte('to_date', date),
      staff.length ? Promise.resolve(staff) : allStaff(),
    ]);
    if (e.error) { setErr(e.error.message); return; }
    const es = (e.data ?? []) as unknown as Ev[]; setEvs(es); setAv((a.data ?? []) as Av[]); setOff(new Set(((o.data ?? []) as { staff_id: string }[]).map((x) => x.staff_id))); setStaff(st);
    const s = await supabase.from('shifts').select('id,event_id,staff_id,position_code,position_detail,status,pool_hold,locked,notified_at,planned_start,time_tbc,attendance')
      .in('event_id', es.length ? es.map((x) => x.id) : ['00000000-0000-0000-0000-000000000000']).neq('status', 'declined');
    setSh(((s.data ?? []) as Sh[]).filter((x) => (x as unknown as { attendance?: string }).attendance !== 'cancelled'));
  })(); }, [date, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // week strip
  useEffect(() => { (async () => {
    const to = addDays(wk0, 6);
    const { data: we } = await supabase.from('events').select('id,event_date,department,staffing,staff_needed').gte('event_date', wk0).lte('event_date', to);
    const ids = ((we ?? []) as { id: string }[]).map((x) => x.id);
    const [{ data: ws }, { data: wa }] = await Promise.all([
      supabase.from('shifts').select('event_id').in('event_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']).neq('status', 'declined'),
      supabase.from('availability').select('for_date,staff_id,status,released_at').gte('for_date', wk0).lte('for_date', to).eq('status', 'yes').is('released_at', null)]);
    const byEv: Record<string, number> = {}; for (const r of (ws ?? []) as { event_id: string }[]) byEv[r.event_id] = (byEv[r.event_id] ?? 0) + 1;
    const out = [...Array(7)].map((_, i) => { const d = addDays(wk0, i); const de = ((we ?? []) as { id: string; event_date: string; staffing: Line[] | null; staff_needed: number }[]).filter((x) => x.event_date === d);
      const need = de.reduce((n, x) => n + ((x.staffing ?? []).reduce((m, l) => m + (l.count || 0), 0) || x.staff_needed || 0), 0);
      const have = de.reduce((n, x) => n + (byEv[x.id] ?? 0), 0); return { d, need, have, n: de.length, free: ((wa ?? []) as { for_date: string }[]).filter((x) => x.for_date === d).length }; });
    setWeek(out);
  })(); }, [wk0, tick]);

  const byId = useMemo(() => Object.fromEntries(staff.map((s) => [s.id, s])), [staff]);
  const tier = (id: string) => byId[id]?.staff_private?.tier ?? null;
  const rank = (id: string) => byId[id]?.staff_private?.ranking ?? 9999;
  const sortP = (a: string, b: string) => (TORD[tier(a) ?? ''] ?? 9) - (TORD[tier(b) ?? ''] ?? 9) || rank(a) - rank(b);
  const onDay = new Set(sh.map((s) => s.staff_id));
  const shown = evs.filter((e) => dept === 'both' || (dept === 'bar') === isBar(e));
  const free = av.filter((a) => a.status === tab && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).sort((a, b) => sortP(a.staff_id, b.staff_id));
  const nYes = av.filter((a) => a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).length;
  const nMaybe = av.filter((a) => a.status === 'maybe' && !a.released_at && !onDay.has(a.staff_id)).length;
  const lays = useMemo(() => Object.fromEntries(evs.map((e) => [e.id, layout(e, sh.filter((s) => s.event_id === e.id))])), [evs, sh]);
  const tot = (b: boolean) => evs.filter((e) => isBar(e) === b).reduce((acc, e) => { const L = lays[e.id]; const need = L.client + L.extras.count; const have = sh.filter((s) => s.event_id === e.id).length; return [acc[0] + have, acc[1] + need]; }, [0, 0]);
  const [fl, br] = [tot(false), tot(true)];
  const removable = (s: Sh) => s.pool_hold && !s.locked;

  const run = async (f: () => Promise<Op | string | void>) => { setBusy(true); setErr(''); setMsg('');
    try { const r = await f(); if (r && typeof r === 'object') setOps((o) => [...o.slice(-29), r]); else if (typeof r === 'string') setMsg(r); } catch (x) { setErr((x as Error).message); }
    setBusy(false); setTick((t) => t + 1); };
  const place = (staffId: string, e: Ev, code: string, start: string | null) => run(async () => {
    const t = start ?? e.start_time?.slice(0, 5) ?? '17:00';
    const { data, error } = await supabase.from('shifts').insert({ event_id: e.id, staff_id: staffId, position_code: code, position_detail: roleName(code), planned_start: startIso(date, t), status: 'booked', pool_hold: true,
      time_tbc: !!(e.start_tbc || e.details_pending) }).select('id').single(); if (error) throw error;
    const id = (data as { id: string }).id; return { label: `placed ${byId[staffId]?.full_name ?? ''}`, undo: () => supabase.from('shifts').delete().eq('id', id).eq('pool_hold', true).then() };
  });
  const remove = (s: Sh) => run(async () => {
    if (!removable(s)) throw new Error('Only placed (not locked, not sent) people go back to Free here.');
    const { data: row } = await supabase.from('shifts').select('*').eq('id', s.id).single();
    const { error } = await supabase.from('shifts').delete().eq('id', s.id).eq('pool_hold', true); if (error) throw error;
    return { label: `removed ${byId[s.staff_id]?.full_name ?? ''}`, undo: () => supabase.from('shifts').insert(row as Record<string, unknown>).then() };
  });
  const move = (s: Sh, e: Ev, code: string, start: string | null) => run(async () => {
    if (!removable(s)) throw new Error('Locked or already sent: change it from the event.');
    const before = { event_id: s.event_id, position_code: s.position_code, position_detail: s.position_detail ?? null, planned_start: s.planned_start };
    const t = start ?? e.start_time?.slice(0, 5) ?? '17:00';
    const { error } = await supabase.from('shifts').update({ event_id: e.id, position_code: code, position_detail: roleName(code), planned_start: startIso(date, t) }).eq('id', s.id); if (error) throw error;
    return { label: `moved ${byId[s.staff_id]?.full_name ?? ''}`, undo: () => supabase.from('shifts').update(before).eq('id', s.id).then() };
  });
  const undo = () => { const last = ops[ops.length - 1]; if (!last) return; setOps((o) => o.slice(0, -1)); run(async () => { await last.undo(); return `Undone: ${last.label}.`; }); };
  const dropOn = (e: Ev, code: string, start: string | null) => { const d = drag; setDrag(null); if (!d) return; if ('id' in d) move(d, e, code, start); else place(d.staff_id, e, code, start); };

  const Chip = ({ s }: { s: Sh }) => { const nm = byId[s.staff_id]?.full_name ?? '…'; const t = tier(s.staff_id); const can = removable(s);
    const a = av.find((x) => x.staff_id === s.staff_id); const late = a?.from_time && s.planned_start && a.from_time.slice(0, 5) > hm(s.planned_start);
    return <span className={'ds-chip' + (can ? '' : ' fixed')} draggable={can} onDragStart={() => setDrag(s)} onDragEnd={() => setDrag(null)}
      title={`${nm}${t ? ` · ${t}` : ''}${a?.from_time ? ` · free from ${ap(a.from_time)}` : ''}${s.locked ? ' · locked' : ''}${!s.pool_hold ? ` · ${s.status === 'confirmed' ? 'confirmed' : s.notified_at ? 'sent' : 'booked'}` : ''}`}>
      <i className={'ds-t ' + (t ?? '')} />{short(nm)}{s.locked ? ' 🔒' : ''}{!s.pool_hold && s.status === 'confirmed' ? ' ✓' : ''}{late ? <small className="gold"> from {ap(a!.from_time)}</small> : null}
      {can && <button className="ds-x" disabled={busy} onClick={() => remove(s)} aria-label={`Back to free: ${nm}`}>×</button>}</span>; };
  const Slot = ({ e, code, start }: { e: Ev; code: string; start: string | null }) =>
    <button className="ds-slot" onClick={() => setPick({ e, code, start })} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>+ tap to fill</button>;
  const Row = ({ e, label, code, start, count, people, extra }: { e: Ev; label: React.ReactNode; code: string; start: string | null; count: number; people: Sh[]; extra?: boolean }) => (
    <div className={'ds-line' + (extra ? ' ex' : '')} onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, code, start)}>
      <b className="ds-lbl">{label}</b><span className="ds-time">{e.start_tbc || e.details_pending ? 'TBC' : ap(start)}</span>
      <span className="ds-cells">{people.map((s) => <Chip key={s.id} s={s} />)}{[...Array(Math.max(0, count - people.length))].map((_, i) => <Slot key={i} e={e} code={code} start={start} />)}</span>
      <span className={'ds-n' + (people.length >= count ? ' ok' : '')}>{people.length}/{count}{people.length >= count ? ' ✓' : ''}</span>
    </div>);

  return (
    <div className="stack-lg ds">
      <div className="ds-week">{week.map((w) => <Link key={w.d} to={`/admin/day-sheet/${w.d}`} className={'ds-wd' + (w.d === date ? ' on' : '') + (!w.n ? ' none' : w.have >= w.need ? ' done' : ' short')}>
        <small>{dLabel(w.d, { weekday: 'short', day: 'numeric' })}</small><b>{w.n ? `${w.have}/${w.need}` : '—'}</b><small>{w.n ? `${w.n} event${w.n > 1 ? 's' : ''}${w.free ? ` · ${w.free} free` : ''}` : 'no events'}</small></Link>)}</div>
      <div className="ds-top">
        <span className="serif-h ds-day"><Link to={`/admin/day-sheet/${addDays(date, -1)}`}>‹</Link> {dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} <Link to={`/admin/day-sheet/${addDays(date, 1)}`}>›</Link></span>
        <span className="grow" />
        <span className="seg3">{(['floor', 'bar', 'both'] as const).map((d) => <button key={d} className={dept === d ? 'on' : ''} onClick={() => setDept(d)}>{d === 'both' ? 'Both' : d === 'floor' ? 'Floor' : 'Bar'}</button>)}</span>
        <button className="abtn" disabled={busy || !ops.length} onClick={undo} title={ops.length ? `Undo: ${ops[ops.length - 1].label}` : 'Nothing to undo'}>↶ Undo{ops.length ? ` (${ops.length})` : ''}</button>
        <Link className="abtn" to={`/admin/pool/${date}`}>Confirm in Day pool ›</Link>
      </div>
      <div className="ds-sum"><b>{evs.length} event{evs.length === 1 ? '' : 's'}</b><span>Floor <b className={fl[0] >= fl[1] ? 'okc' : 'accent'}>{fl[0]}/{fl[1]}</b></span><span>Bar <b className={br[0] >= br[1] ? 'okc' : 'accent'}>{br[0]}/{br[1]}</b></span><span>Free <b>{nYes}</b></span>
        <span className="muted">Tap a slot to fill · drag a name to move it · × = back to Free · staff see nothing until you confirm</span></div>
      {msg && <div className="adm-card okc sm">{msg}</div>}{err && <div className="adm-card err sm">{err}</div>}
      <div className="ds-cols">
        <div className="ds-blocks">
          {!shown.length && <div className="adm-card muted">No {dept === 'both' ? '' : dept + ' '}events this day.</div>}
          {shown.map((e) => { const L = lays[e.id]; const have = sh.filter((s) => s.event_id === e.id).length; const need = L.client + L.extras.count;
            return (
              <section key={e.id} className={'ds-block' + (isBar(e) ? ' bar' : '')}>
                <div className="ds-bh"><span className="serif ds-title">{e.venues?.name ?? e.title}{isBar(e) ? ' · bar' : ''}</span>
                  <small className="muted">{[e.caterer_name ? `Food by ${e.caterer_name}` : null, e.guests ? `${e.guests} guests` : null].filter(Boolean).join(' · ')}</small>
                  <span className="grow" /><span className="ds-count">Client {L.client}{L.extras.count ? ` · +${L.extras.count} extra${L.extras.count > 1 ? 's' : ''} = ${need}` : isBar(e) ? '' : ' · no extras'} · <b className={have >= need ? 'okc' : 'accent'}>{have} placed</b></span>
                  <Link className="lnk sm" to={`/admin/event/${e.id}`}>Event ›</Link></div>
                <div className="ds-lead" onDragOver={(ev) => ev.preventDefault()} onDrop={() => dropOn(e, isBar(e) ? 'BM' : 'MD', e.start_time?.slice(0, 5) ?? null)}>
                  <small>{isBar(e) ? 'BAR MANAGER' : 'MD'}</small>{L.leads.map((s) => <Chip key={s.id} s={s} />)}
                  {L.leads.length < L.leadNeed && <Slot e={e} code={isBar(e) ? 'BM' : 'MD'} start={e.start_time?.slice(0, 5) ?? null} />}</div>
                {L.lines.map((l) => <Row key={l.key} e={e} label={`${l.count} ${plural(l.code, l.count)}`} code={l.code} start={l.start} count={l.count} people={l.people} />)}
                {!L.lines.length && <div className="muted sm" style={{ padding: '8px 0' }}>No staff lines yet: <Link to={`/admin/event/${e.id}/edit`}>add them on the event ›</Link></div>}
                {L.extras.count > 0 && <Row e={e} extra label={<>+{L.extras.count} Extras <small>(10%)</small></>} code={L.extras.code} start={L.extras.start} count={L.extras.count} people={L.extras.people} />}
                {L.over.length > 0 && <div className="ds-line over"><b className="ds-lbl">Also placed</b><span className="ds-time" /><span className="ds-cells">{L.over.map((s) => <Chip key={s.id} s={s} />)}</span><span className="ds-n">over</span></div>}
              </section>); })}
        </div>
        <aside className="ds-free" onDragOver={(ev) => ev.preventDefault()} onDrop={() => { const d = drag; setDrag(null); if (d && 'id' in d) remove(d); }}>
          <b className="serif">Free this day · {nYes}</b>
          <small className="muted">said yes, not placed · best first · drag onto a slot, or tap a slot · drop a name here = back to free</small>
          <span className="seg3"><button className={tab === 'yes' ? 'on' : ''} onClick={() => setTab('yes')}>Yes {nYes}</button><button className={tab === 'maybe' ? 'on' : ''} onClick={() => setTab('maybe')}>Maybe {nMaybe}</button></span>
          {!free.length && <span className="muted sm">{tab === 'yes' ? 'Nobody left. Ask more from Bookings → Ask more people.' : 'No maybes.'}</span>}
          {free.map((a) => <div key={a.staff_id} className="ds-fp" draggable onDragStart={() => setDrag({ staff_id: a.staff_id })} onDragEnd={() => setDrag(null)}>
            <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{byId[a.staff_id]?.full_name ?? '…'}</b><small className="muted">{a.from_time ? `from ${ap(a.from_time)}` : 'any time'}</small></div>)}
          {(() => { const open = shown.reduce((n, e) => { const L = lays[e.id]; return n + Math.max(0, L.client + L.extras.count - sh.filter((s) => s.event_id === e.id).length); }, 0);
            return <div className="ds-after">{open > 0 ? <><b>{open} open</b> slot{open > 1 ? 's' : ''} · {nYes} free</> : <><b>All slots filled.</b> {nYes} left = backups (not booked, released when you confirm)</>}</div>; })()}
        </aside>
      </div>
      {pick && <PickSheet date={date} e={pick.e} code={pick.code} start={pick.start} staff={staff} av={av} onDay={onDay} off={off} sortP={sortP} tier={tier}
        onClose={() => setPick(null)} onPick={(id) => { const p = pick; setPick(null); place(id, p.e, p.code, p.start); }} onAsk={() => nav(`/admin/bookings?date=${date}&ask=1`)} />}
    </div>
  );
}

function PickSheet({ date, e, code, start, staff, av, onDay, off, sortP, tier, onClose, onPick, onAsk }: { date: string; e: Ev; code: string; start: string | null; staff: AStaff[]; av: Av[]; onDay: Set<string>; off: Set<string>;
  sortP: (a: string, b: string) => number; tier: (id: string) => string | null; onClose: () => void; onPick: (id: string) => void; onAsk: () => void }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const fits = (a: Av) => !a.from_time || !start || a.from_time.slice(0, 5) <= start;
  const yes = av.filter((a) => a.status === 'yes' && !a.released_at && !onDay.has(a.staff_id) && !off.has(a.staff_id)).sort((a, b) => Number(!fits(a)) - Number(!fits(b)) || sortP(a.staff_id, b.staff_id));
  const maybe = av.filter((a) => a.status === 'maybe' && !a.released_at && !onDay.has(a.staff_id));
  const nm = (id: string) => staff.find((s) => s.id === id)?.full_name ?? '…';
  const others = ql.length >= 2 ? staff.filter((s) => s.active && !onDay.has(s.id) && (s.full_name.toLowerCase().includes(ql) || (s.nickname ?? '').toLowerCase().includes(ql)) && !yes.some((a) => a.staff_id === s.id)).slice(0, 8) : [];
  const match = (id: string) => !ql || nm(id).toLowerCase().includes(ql);
  return (
    <div className="ds-pick-wrap" onClick={onClose}><div className="ds-pick" onClick={(ev) => ev.stopPropagation()}>
      <div className="row" style={{ gap: 8 }}><b className="grow">{e.venues?.name ?? e.title} · {plural(code, 2)} {ap(start)}</b><button className="lnk muted" onClick={onClose}>✕</button></div>
      <small className="muted">{dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' })} · placed, not sent: they see nothing until you confirm</small>
      <input autoFocus placeholder="🔍 Search a name…" value={q} onChange={(ev) => setQ(ev.target.value)} />
      <small className="kick">FREE · SAID YES</small>
      {!yes.filter((a) => match(a.staff_id)).length && <span className="muted sm">Nobody free{ql ? ' with that name' : ''}.</span>}
      {yes.filter((a) => match(a.staff_id)).map((a) => <button key={a.staff_id} className="ds-pp" onClick={() => onPick(a.staff_id)}>
        <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{nm(a.staff_id)}</b><small className={fits(a) ? 'muted' : 'gold'}>{a.from_time ? `from ${ap(a.from_time)}${fits(a) ? '' : ' · after the start'}` : 'any time'}</small></button>)}
      {maybe.filter((a) => match(a.staff_id)).length > 0 && <><small className="kick">MAYBE</small>{maybe.filter((a) => match(a.staff_id)).map((a) => <button key={a.staff_id} className="ds-pp" onClick={() => onPick(a.staff_id)}>
        <i className={'ds-t ' + (tier(a.staff_id) ?? '')} /><b className="grow">{nm(a.staff_id)}</b><small className="gold">maybe</small></button>)}</>}
      {others.length > 0 && <><small className="kick">OTHERS · NOT ASKED FOR THIS DAY</small>{others.map((s) => <button key={s.id} className="ds-pp" onClick={() => onPick(s.id)}>
        <i className={'ds-t ' + (s.staff_private?.tier ?? '')} /><b className="grow">{s.full_name}</b><small className="gold">not asked · placing = you’ll ask them</small></button>)}</>}
      <button className="lnk sm" onClick={onAsk}>Ask more people for this day ›</button>
    </div></div>);
}
