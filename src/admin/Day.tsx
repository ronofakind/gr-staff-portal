import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  eventsBetween, allStaff, addDays, isoDay, startIso, endIso, flagsOf, flagText, ap12, bookingChange, confirmationsSent, UNIFORMS,
  type AEvent, type AStaff, type AShift,
} from './api';

type Av = { status: string; from: string | null; until: string | null };
type Drag = { kind: 'shift'; shift: AShift; from: AEvent } | { kind: 'staff'; staff: AStaff };
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
const lead = (c: string | null) => c === 'MD' || c === 'BM';
const isBar = (e: AEvent) => e.department === 'bar';
const t12 = (t: string | null) => (t ? ap12(t.slice(0, 5)).replace(':00', '') : '');
const FOLD = 8;

/** Start times of an event: its staffing lines, plus anything people are booked at. */
function startsOf(e: AEvent) {
  const s = new Set<string>([...(e.staffing ?? []).map((l) => l.start), ...e.shifts.filter((x) => x.status !== 'declined').map((x) => hm(x.planned_start))]);
  if (!s.size && e.start_time) s.add(e.start_time.slice(0, 5));
  return [...s].sort();
}
/** Where a newcomer lands: first non-lead line with open spots, else the earliest start. */
function landing(e: AEvent, from?: string | null) {
  const lines = (e.staffing ?? []).filter((l) => !lead(l.code));
  const team = e.shifts.filter((s) => s.status !== 'declined' && !s.attendance);
  const open = lines.find((l) => (!from || l.start >= from.slice(0, 5)) && team.filter((s) => hm(s.planned_start) === l.start && !lead(s.position_code)).length < l.count);
  return open?.start ?? lines.find((l) => !from || l.start >= from.slice(0, 5))?.start ?? startsOf(e)[0] ?? '17:00';
}

export function Day() {
  const [params, setParams] = useSearchParams();
  const day = params.get('d') ?? isoDay(new Date());
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [avail, setAvail] = useState<Record<string, Av>>({});
  const [drag, setDrag] = useState<Drag | null>(null); const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ shift: AShift; ev: AEvent } | { staff: AStaff } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const load = async () => {
    const [evs, st, av] = await Promise.all([
      eventsBetween(day, day), staff.length ? Promise.resolve(staff) : allStaff(),
      supabase.from('availability').select('staff_id,status,from_time,until_time').eq('for_date', day),
    ]);
    setEvents(evs); setStaff(st);
    setAvail(Object.fromEntries(((av.data ?? []) as { staff_id: string; status: string; from_time: string | null; until_time: string | null }[]).map((a) => [a.staff_id, { status: a.status, from: a.from_time, until: a.until_time }])));
  };
  useEffect(() => { setEvents(null); load(); }, [day]);

  const run = async (fn: () => Promise<unknown>) => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } setBusy(false); setMenu(null); await load(); };
  const info = (e: AEvent, start: string) => ({ id: e.id, event_date: e.event_date, title: e.title, sent: confirmationsSent(e), start: startIso(e.event_date, start) });

  const addTo = (e: AEvent, s: AStaff, start?: string) => run(async () => {
    const st = start ?? landing(e, avail[s.id]?.from);
    const code = isBar(e) ? (s.positions.find((p) => ['BT', 'BB', 'BM'].includes(p)) ?? 'BT') : 'W';
    const { data, error } = await supabase.from('shifts').insert({ event_id: e.id, staff_id: s.id, planned_start: startIso(e.event_date, st), planned_end: e.end_time ? endIso(e.event_date, st, e.end_time.slice(0, 5)) : null, position_code: code, position_detail: code === 'W' ? 'Waiter' : null, status: 'booked' }).select('id').single();
    if (error) throw new Error(error.message.includes('duplicate') ? 'Already on that event.' : error.message);
    await bookingChange('booked', { staff_id: s.id, shift_id: data.id, to: info(e, st) });
  });
  const moveTo = (to: AEvent, sh: AShift, from: AEvent, start?: string) => run(async () => {
    if (sh.punches?.punch_in) throw new Error(`${sh.staff?.full_name} already started. Change it from the event.`);
    const st = start ?? (to.id === from.id ? hm(sh.planned_start) : landing(to, avail[sh.staff_id]?.from));
    if (to.id === from.id && st === hm(sh.planned_start)) return;
    const keep = to.id === from.id || lead(sh.position_code) || isBar(to) === isBar(from);
    const { error } = await supabase.from('shifts').update({ event_id: to.id, planned_start: startIso(to.event_date, st), planned_end: to.end_time ? endIso(to.event_date, st, to.end_time.slice(0, 5)) : null, ...(keep && to.id === from.id ? {} : { position_code: isBar(to) ? 'BT' : 'W', position_detail: isBar(to) ? null : 'Waiter' }) }).eq('id', sh.id);
    if (error) throw error;
    await bookingChange('moved', { staff_id: sh.staff_id, shift_id: sh.id, from: info(from, hm(sh.planned_start)), to: info(to, st) });
  });
  const toBench = (sh: AShift, from: AEvent) => run(async () => {
    if (sh.punches?.punch_in) throw new Error(`${sh.staff?.full_name} already started. Change it from the event.`);
    const { error } = await supabase.from('shifts').delete().eq('id', sh.id); if (error) throw error;
    await bookingChange('removed', { staff_id: sh.staff_id, shift_id: sh.id, from: info(from, hm(sh.planned_start)) });
  });
  const setLeave = (e: AEvent, sh: AShift, t: string) => run(async () => { await supabase.from('shifts').update({ leave_by: t ? endIso(e.event_date, hm(sh.planned_start), t) : null }).eq('id', sh.id); });
  const sendFor = (list: AEvent[]) => run(async () => {
    const ids = list.flatMap((e) => e.shifts.filter((s) => s.status !== 'declined' && (!s.notified_at || s.changed_at > s.notified_at)).map((s) => s.id));
    if (ids.length) await supabase.from('shifts').update({ notified_at: new Date().toISOString() }).in('id', ids);
  });

  const drop = (e: AEvent, start?: string) => {
    const d = drag; setDrag(null); setOver(null); if (!d) return;
    if (d.kind === 'staff') addTo(e, d.staff, start);
    else if (isBar(d.from) === isBar(e)) moveTo(e, d.shift, d.from, start);
    else setErr('Floor and bar people stay in their department. Use the event form to change someone’s role.');
  };

  const evs = events ?? [];
  const team = (e: AEvent) => e.shifts.filter((s) => s.status !== 'declined');
  const placed = useMemo(() => new Set(evs.flatMap((e) => team(e).map((s) => s.staff_id))), [events]);
  const bench = useMemo(() => staff.filter((s) => s.active && s.department !== 'bar' && !placed.has(s.id))
    .filter((s) => (q ? s.full_name.toLowerCase().includes(q.toLowerCase()) : ['yes', 'maybe'].includes(avail[s.id]?.status ?? '')))
    .sort((a, b) => Number(avail[b.id]?.status === 'yes') - Number(avail[a.id]?.status === 'yes') || (a.staff_private?.ranking ?? 999) - (b.staff_private?.ranking ?? 999)), [staff, placed, avail, q]);
  const pending = (e: AEvent) => team(e).filter((s) => !s.notified_at || s.changed_at > s.notified_at).length;
  const booked = evs.reduce((n, e) => n + team(e).filter((s) => !s.attendance).length, 0);
  const needed = evs.reduce((n, e) => n + e.staff_needed, 0);
  const shortEvs = evs.filter((e) => team(e).filter((s) => !s.attendance).length < e.staff_needed);
  const shortN = shortEvs.reduce((n, e) => n + e.staff_needed - team(e).filter((s) => !s.attendance).length, 0);
  const mdMissing = evs.filter((e) => !isBar(e) && !team(e).some((s) => s.position_code === 'MD'));
  const readyToSend = evs.filter((e) => pending(e) > 0 && team(e).length >= e.staff_needed);
  const phones = evs.flatMap((e) => team(e).map((s) => s.staff?.phone?.replace(/[^\d+]/g, ''))).filter(Boolean);
  const long = new Date(day + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'short', day: 'numeric' }).replace(/\./g, '');
  const unif = (k?: string) => (k?.startsWith('custom:') ? k.slice(7) : UNIFORMS.find(([u]) => u === k)?.[1]?.toLowerCase() ?? '');

  return (
    <div className="stack-lg dv">
      <div className="toolbar">
        <div className="row" style={{ gap: 10 }}>
          <button className="sq" aria-label="Previous day" onClick={() => setParams({ d: addDays(day, -1) })}>‹</button>
          <h1 className="serif-h">{long}</h1>
          <button className="sq" aria-label="Next day" onClick={() => setParams({ d: addDays(day, 1) })}>›</button>
          <input type="date" className="date hide-sm" value={day} onChange={(e) => e.target.value && setParams({ d: e.target.value })} aria-label="Pick a date" />
        </div>
        <div className="row wrap">
          <button className="abtn" disabled={!readyToSend.length || busy} onClick={() => sendFor(readyToSend)}>Send confirmations{readyToSend.length ? ` · ${readyToSend.length}` : ''}</button>
          <a className="abtn dark" href={phones.length ? `sms:/open?addresses=${phones.join(',')}` : undefined}>Message everyone</a>
        </div>
      </div>

      <div className="dv-chips">
        <span><b>{evs.length}</b> events</span>
        <span><b>{booked} / {needed}</b> booked</span>
        {shortN > 0 && <span className="amber"><b>{shortN}</b> short{shortEvs.length === 1 ? ` · ${shortEvs[0].title}` : ''}</span>}
        {mdMissing.length > 0 && <span className="red"><b>{mdMissing.length}</b> MD missing</span>}
        <span className="ok"><b>{bench.filter((s) => avail[s.id]?.status === 'yes').length}</b> on the bench</span>
        <Link to={`/admin/event/new?d=${day}`} className="dv-new">+ New event</Link>
      </div>
      {err && <p className="error">{err}</p>}
      {!events && <div className="muted">Loading…</div>}

      <div className="dv-cols" style={{ gridTemplateColumns: `200px repeat(${Math.max(1, evs.length)}, minmax(250px, 1fr))` }}>
        <section className={'dv-col dv-bench' + (drag?.kind === 'shift' ? ' drop' : '') + (over === 'bench' ? ' over' : '')}
          onDragOver={(ev) => { if (drag?.kind === 'shift') { ev.preventDefault(); setOver('bench'); } }} onDragLeave={() => setOver(null)}
          onDrop={() => { const d = drag; setDrag(null); setOver(null); if (d?.kind === 'shift') toBench(d.shift, d.from); }}>
          <div className="dv-head"><span className="serif">Bench</span><small className="muted">Said yes, not placed. Drag onto an event.</small></div>
          <input className="search" placeholder="Search anyone…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="dv-body">
            {bench.slice(0, 40).map((s) => { const a = avail[s.id]; return (
              <button key={s.id} className="dv-bp" draggable onDragStart={() => setDrag({ kind: 'staff', staff: s })} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => setMenu({ staff: s })}>
                <b>{s.full_name}</b><small>{s.staff_private?.tier ?? '?'} · {a?.status === 'yes' ? (a.from ? `from ${t12(a.from)}` : a.until ? `until ${t12(a.until)}` : 'all evening') : a?.status === 'maybe' ? 'not sure' : 'not asked'}</small>
              </button>
            ); })}
            {!bench.length && <span className="muted sm">{q ? 'No match.' : 'Nobody waiting. Search to add anyone.'}</span>}
          </div>
          {drag?.kind === 'shift' && <div className="dv-hint">Drop here = back to bench</div>}
          <div className="dv-foot"><Link className="abtn sm" to={`/admin/bookings?date=${day}`}>Ask more people ›</Link></div>
        </section>

        {evs.map((e) => {
          const tm = team(e); const active = tm.filter((s) => !s.attendance); const pct = Math.min(100, (active.length / Math.max(1, e.staff_needed)) * 100);
          const md = tm.find((s) => s.position_code === (isBar(e) ? 'BM' : 'MD'));
          const short = Math.max(0, e.staff_needed - active.length); const p = pending(e);
          const canDrop = drag && (drag.kind === 'staff' ? !isBar(e) : isBar(drag.from) === isBar(e));
          return (
            <section key={e.id} className={'dv-col' + (canDrop ? ' drop' : '') + (over === e.id ? ' over' : '') + (short && !isBar(e) ? ' short' : '')}
              onDragOver={(ev) => { if (canDrop) { ev.preventDefault(); setOver(e.id); } }} onDragLeave={() => setOver(null)} onDrop={() => drop(e)}>
              <div className="dv-head">
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}><Link to={`/admin/event/${e.id}`} className="serif dv-title">{e.title}{isBar(e) ? <small className="muted"> · bar</small> : null}</Link><span className={'tag ' + (short ? 'amber' : 'ok')}>{active.length} / {e.staff_needed}</span></div>
                <div className="dv-prog"><i style={{ width: pct + '%' }} className={short ? 'amber' : ''} /></div>
                <small className="muted">{[e.event_private?.client, isBar(e) ? 'Bar' : 'Floor', `starts ${t12(startsOf(e)[0] ?? e.start_time)}`, e.ends_label ? `ends ${e.ends_label}` : ''].filter(Boolean).join(' · ')}</small>
                {md ? <small><b>{isBar(e) ? 'BM' : 'MD'} {md.staff?.full_name}</b> · in {t12(hm(md.planned_start))}</small> : <Link to={`/admin/event/${e.id}/edit`} className="accent sm strong">{isBar(e) ? 'Bar manager' : 'MD'} not set · pick one ›</Link>}
                <small className="muted">Uniform: {unif(isBar(e) ? e.uniform_bar : e.uniform_floor) || '—'}</small>
              </div>
              <div className="dv-body">
                {startsOf(e).map((st) => {
                  const ppl = tm.filter((s) => hm(s.planned_start) === st).sort((a, b) => Number(lead(b.position_code)) - Number(lead(a.position_code)) || (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? '', 'fr'));
                  const need = (e.staffing ?? []).filter((l) => l.start === st).reduce((n, l) => n + l.count, 0);
                  const k = e.id + st; const folded = ppl.length > FOLD && !open.has(k); const shown = folded ? ppl.slice(0, 3) : ppl;
                  let n = 0;
                  return (
                    <div key={st} className={'dv-grp' + (over === k ? ' over' : '')}
                      onDragOver={(ev) => { if (canDrop) { ev.preventDefault(); ev.stopPropagation(); setOver(k); } }}
                      onDrop={(ev) => { ev.stopPropagation(); drop(e, st); }}>
                      <div className="dv-gh"><span>START {t12(st)}</span><span>{ppl.filter((s) => !s.attendance).length}{need ? ` / ${need}` : ''}</span></div>
                      {shown.map((s) => { const L = lead(s.position_code); const num = L || isBar(e) ? null : ++n; return (
                        <button key={s.id} className={'dv-row' + (s.attendance ? ' gone' : '')} draggable onDragStart={() => setDrag({ kind: 'shift', shift: s, from: e })} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => setMenu({ shift: s, ev: e })}>
                          <i className={L ? 'lead' : isBar(e) ? 'role' : ''}>{L || isBar(e) ? s.position_code ?? '·' : num}</i>
                          <span className="dv-name">{s.staff?.full_name}</span>
                          {flagsOf(s).map((f) => <span key={f.flag} className={'ftag ' + f.flag}>{flagText(f)}</span>)}
                          {s.leave_by && <span className="dv-leave">leaves ~{t12(hm(s.leave_by))}</span>}
                          {s.status === 'confirmed' ? <span className="dv-dot ok" title="Confirmed" /> : <span className="dv-dot" title="Not confirmed yet" />}
                        </button>
                      ); })}
                      {folded && <button className="dv-more" onClick={() => setOpen(new Set([...open, k]))}>+ {ppl.length - 3} more at {t12(st)} <span>Show ›</span></button>}
                      {!folded && ppl.length > FOLD && <button className="dv-more" onClick={() => { const x = new Set(open); x.delete(k); setOpen(x); }}>Show less</button>}
                    </div>
                  );
                })}
                {short > 0 && !isBar(e) && <div className="dv-open">{drag ? '+ Drop here' : '+ Drag from the bench'} · {short} open spot{short > 1 ? 's' : ''}</div>}
              </div>
              <div className="dv-foot">
                {p ? <button className="abtn sm dark grow" disabled={busy || (short > 0 && !isBar(e))} onClick={() => sendFor([e])}>{short > 0 && !isBar(e) ? 'Confirmations · fill first' : `Send confirmations · ${p}`}</button>
                  : <span className="abtn sm grow" aria-disabled>✓ Confirmations sent</span>}
                <Link className="abtn sm" to={`/admin/event/${e.id}/edit`} aria-label="Edit event">✎</Link>
                <Link className="abtn sm" to={`/manage/${e.id}`}>Check-in</Link>
              </div>
            </section>
          );
        })}
      </div>
      {events && !evs.length && <p className="muted">No events this day. <Link to={`/admin/event/new?d=${day}`}>Create one ›</Link></p>}
      <div className="muted sm">Drag a name between events, from the bench, or back to the bench. On the phone, tap a name. If that event's confirmations were already sent, the person gets an alert on their Home screen; if not, it's silent until confirmations go out.</div>

      {menu && (
        <>
          <div className="scrim" onClick={() => setMenu(null)} />
          <div className="sheet" role="dialog" aria-label="Move">
            <div className="grab" />
            {'shift' in menu ? (() => { const { shift: s, ev } = menu; const others = evs.filter((x) => isBar(x) === isBar(ev)); return (
              <>
                <div><div className="kicker">{ev.title} · starts {t12(hm(s.planned_start))}</div><div className="serif" style={{ fontSize: 24 }}>{s.staff?.full_name}</div></div>
                <b className="sm">Move to…</b>
                {others.map((x) => x.id === ev.id ? startsOf(x).filter((st) => st !== hm(s.planned_start)).map((st) => (
                  <button key={x.id + st} className="opt" onClick={() => moveTo(x, s, ev, st)}><span><b>Same event · start {t12(st)}</b></span></button>
                )) : (
                  <button key={x.id} className="opt" onClick={() => moveTo(x, s, ev)}><span><b>{x.title}</b><small>{team(x).filter((y) => !y.attendance).length} / {x.staff_needed} · lands at {t12(landing(x, avail[s.staff_id]?.from))}</small></span></button>
                ))}
                <button className="opt" onClick={() => toBench(s, ev)}><span><b>Back to bench</b><small>Removes them from {ev.title}</small></span></button>
                <label className="row sm" style={{ gap: 8 }}>Needs to leave around <input type="time" step={900} defaultValue={s.leave_by ? hm(s.leave_by) : ''} onBlur={(x) => x.target.value !== (s.leave_by ? hm(s.leave_by) : '') && setLeave(ev, s, x.target.value)} /></label>
              </>
            ); })() : (
              <>
                <div><div className="kicker">Bench</div><div className="serif" style={{ fontSize: 24 }}>{menu.staff.full_name}</div></div>
                <b className="sm">Add to…</b>
                {evs.filter((x) => !isBar(x)).map((x) => <button key={x.id} className="opt" onClick={() => addTo(x, menu.staff)}><span><b>{x.title}</b><small>{team(x).filter((y) => !y.attendance).length} / {x.staff_needed} · starts {t12(landing(x, avail[menu.staff.id]?.from))}</small></span></button>)}
              </>
            )}
            <button className="abtn" onClick={() => setMenu(null)}>Close</button>
          </div>
        </>
      )}
    </div>
  );
}
