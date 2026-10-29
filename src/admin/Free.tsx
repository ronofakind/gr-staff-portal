import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, allStaff, isoDay, addDays, dLabel, ap12, startIso, type AEvent, type AStaff } from './api';

type Av = { staff_id: string; status: string; from_time: string | null; until_time: string | null };
type Tab = 'yes' | 'placed' | 'no' | 'wait';
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
const short = (t: string) => t.replace(/^(Salon|Maison|Le|La)\s+/i, '');
const t12 = (t: string | null) => (t ? ap12(t.slice(0, 5)).replace(':00', '') : '');

/** Who said yes for a date, grouped by tier and sorted by rank, with one-tap add to an event. */
export function Free() {
  const [params, setParams] = useSearchParams();
  const d = params.get('d') ?? isoDay(new Date());
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [av, setAv] = useState<Av[]>([]);
  const [tab, setTab] = useState<Tab>('yes');
  const [target, setTarget] = useState<string>(params.get('e') ?? '');
  const [menu, setMenu] = useState<string | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [ev, st, a] = await Promise.all([
      eventsBetween(d, d), staff.length ? Promise.resolve(staff) : allStaff(),
      supabase.from('availability').select('staff_id,status,from_time,until_time').eq('for_date', d).not('ask_id', 'is', null),
    ]);
    setEvents(ev); setStaff(st); setAv((a.data ?? []) as Av[]);
  };
  useEffect(() => { setEvents(null); load(); }, [d]);

  const floorEvs = (events ?? []).filter((e) => e.department !== 'bar');
  const booked = (e: AEvent) => e.shifts.filter((s) => s.status !== 'declined' && !s.attendance);
  const openOf = (e: AEvent) => Math.max(0, e.staff_needed - booked(e).length);
  const defaultTarget = floorEvs.find((e) => e.id === target) ?? [...floorEvs].sort((a, b) => openOf(b) - openOf(a))[0];
  const placedAt = (sid: string) => (events ?? []).find((e) => booked(e).some((s) => s.staff_id === sid));
  const byId = Object.fromEntries(staff.map((s) => [s.id, s]));
  const tierOf = (sid: string) => byId[sid]?.staff_private?.tier ?? null;
  const rankOf = (sid: string) => byId[sid]?.staff_private?.ranking ?? 9999;

  const rows = av.filter((a) => byId[a.staff_id]?.active && byId[a.staff_id]?.department !== 'bar');
  const groups: Record<Tab, Av[]> = {
    yes: rows.filter((a) => a.status === 'yes'),
    placed: rows.filter((a) => placedAt(a.staff_id)),
    no: rows.filter((a) => a.status === 'no'),
    wait: rows.filter((a) => a.status === 'asked' || a.status === 'maybe'),
  };
  const list = groups[tab].sort((a, b) => rankOf(a.staff_id) - rankOf(b.staff_id));
  const timeText = (a: Av) => a.from_time && a.until_time ? `${t12(a.from_time)} – ${t12(a.until_time)}` : a.from_time ? `From ${t12(a.from_time)}` : a.until_time ? `Until ${t12(a.until_time)}` : 'All evening';

  /** The start time this person can take on an event: first waiter line at/after their "from" time. */
  const slotFor = (e: AEvent, a: Av) => {
    const lines = (e.staffing ?? []).filter((l) => l.code !== 'MD').map((l) => l.start).sort();
    const starts = lines.length ? lines : [e.start_time?.slice(0, 5) ?? '17:00'];
    if (!a.from_time) return { start: starts[0], late: false };
    const ok = starts.find((s) => s >= a.from_time!.slice(0, 5));
    return ok ? { start: ok, late: false } : { start: starts[starts.length - 1], late: true };
  };
  const tooShort = (e: AEvent, a: Av) => !!a.until_time && !!e.end_time && e.end_time.slice(0, 5) > '06:00' && a.until_time.slice(0, 5) < e.end_time.slice(0, 5);

  const add = async (a: Av, e: AEvent) => {
    setErr(''); setBusy(a.staff_id); setMenu(null);
    const slot = slotFor(e, a);
    const { error } = await supabase.from('shifts').insert({ event_id: e.id, staff_id: a.staff_id, position_code: 'W', position_detail: 'Waiter', planned_start: startIso(e.event_date, slot.start), status: 'booked' });
    if (error) setErr(error.message.includes('duplicate') ? 'Already on that event.' : error.message);
    else await supabase.from('change_log').insert({ entity: 'shift', change: { kind: 'booked', event: e.id, staff: a.staff_id, date: d, start: slot.start } });
    setBusy(null); load();
  };
  const move = async (a: Av, e: AEvent) => {
    const from = placedAt(a.staff_id); const sh = from && booked(from).find((s) => s.staff_id === a.staff_id); if (!sh) return;
    setErr(''); setBusy(a.staff_id); setMenu(null);
    if (sh.punches?.punch_in) { setErr('Already started. Change it from the event.'); setBusy(null); return; }
    const slot = slotFor(e, a);
    const { error } = await supabase.from('shifts').update({ event_id: e.id, planned_start: startIso(e.event_date, slot.start) }).eq('id', sh.id);
    if (error) setErr(error.message); else await supabase.from('change_log').insert({ entity: 'shift', entity_id: sh.id, change: { kind: 'moved', from: from!.id, to: e.id, date: d } });
    setBusy(null); load();
  };

  const avgRank = (e: AEvent) => { const r = booked(e).map((s) => byId[s.staff_id]?.staff_private?.ranking).filter((x): x is number => x != null); return r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length) : null; };
  const ranksAll = floorEvs.map(avgRank).filter((x): x is number => x != null);

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="row" style={{ gap: 10 }}>
          <button className="sq" aria-label="Previous day" onClick={() => setParams({ d: addDays(d, -1) })}>‹</button>
          <h1 className="serif-h">Who's free · {dLabel(d, { weekday: 'short', month: 'short', day: 'numeric' })}</h1>
          <button className="sq" aria-label="Next day" onClick={() => setParams({ d: addDays(d, 1) })}>›</button>
        </div>
        <div className="row wrap">
          <span className="sm"><b className="okc">{groups.yes.filter((a) => !placedAt(a.staff_id)).length}</b> available · <b>{floorEvs.reduce((n, e) => n + booked(e).length, 0)}</b> / {floorEvs.reduce((n, e) => n + e.staff_needed, 0)} placed · <b style={{ color: 'var(--amber)' }}>{floorEvs.reduce((n, e) => n + openOf(e), 0)}</b> open · <b>{groups.wait.length}</b> no answer</span>
          <Link className="abtn" to="/admin/availability">Ask more people</Link>
          <Link className="abtn dark" to={`/admin/day?d=${d}`}>Open day view</Link>
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      {events === null ? <div className="muted">Loading…</div> : (
        <div className="fr-grid">
          <div className="adm-card" style={{ padding: 0 }}>
            <div className="row wrap" style={{ padding: 14, gap: 10, justifyContent: 'space-between', borderBottom: '1px solid var(--line)' }}>
              <div className="seg">
                {([['yes', 'Available', groups.yes.filter((a) => !placedAt(a.staff_id)).length], ['placed', 'Placed', groups.placed.length], ['no', "Can't", groups.no.length], ['wait', 'No answer', groups.wait.length]] as const).map(([k, l, n]) => (
                  <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l} · {n}</button>
                ))}
              </div>
              {floorEvs.length > 1 && <label className="sm muted row" style={{ gap: 6 }}>Add to <select value={defaultTarget?.id ?? ''} onChange={(e) => setTarget(e.target.value)}>{floorEvs.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>}
              <span className="muted sm">sorted by rank · time is what they typed</span>
            </div>
            {!floorEvs.length && <div className="muted sm" style={{ padding: 18 }}>No floor event on this day yet. <Link to={`/admin/event/new?d=${d}`}>Create one ›</Link></div>}
            {!list.length && <div className="muted sm" style={{ padding: 18 }}>Nobody here.</div>}
            {(['A', 'B', 'C', null] as const).map((t) => {
              const g = list.filter((a) => tierOf(a.staff_id) === t); if (!g.length) return null;
              return (
                <div key={t ?? 'u'} className="fr-tier">
                  <div className={'kick t' + (t ?? 'x')}>{t ? `TIER ${t}` : 'UNRANKED'} · {g.length}</div>
                  {g.map((a) => {
                    const s = byId[a.staff_id]; const at = placedAt(a.staff_id); const ev = defaultTarget; const slot = ev ? slotFor(ev, a) : null;
                    const fits = ev && !tooShort(ev, a);
                    return (
                      <div key={a.staff_id} className={'fr-row' + (at && tab !== 'placed' ? ' placed' : '')}>
                        <span className="muted sm fr-rank">#{s?.staff_private?.ranking ?? '–'}</span>
                        <b className="grow">{s?.full_name}</b>
                        <span className={'sm strong ' + (a.status === 'yes' ? (a.from_time || a.until_time ? 'amberc' : 'okc') : 'muted')}>{a.status === 'yes' ? timeText(a) : a.status === 'no' ? "can't" : 'no answer yet'}</span>
                        <div className="fr-act">
                          {at ? <>
                            <span className="muted sm">placed · {short(at.title)}</span>
                            {floorEvs.length > 1 && <button className="lnk" onClick={() => setMenu(menu === a.staff_id ? null : a.staff_id)}>move</button>}
                          </> : a.status === 'yes' && ev ? (
                            fits ? <>
                              <button className="abtn sm" disabled={busy === a.staff_id} onClick={() => add(a, ev)}>+ {short(ev.title)}{slot && (slot.late || (ev.staffing ?? []).length > 1) ? ' ' + t12(slot.start + ':00') : ''}</button>
                              {floorEvs.length > 1 && <button className="abtn sm" aria-label="Other event" onClick={() => setMenu(menu === a.staff_id ? null : a.staff_id)}>▾</button>}
                              {slot?.late && <span className="accent sm">starts after call</span>}
                            </> : <span className="accent sm">too short for {short(ev.title)}{floorEvs.length > 1 ? <button className="lnk" onClick={() => setMenu(menu === a.staff_id ? null : a.staff_id)}> other ▾</button> : null}</span>
                          ) : null}
                          {menu === a.staff_id && (
                            <div className="fr-menu">{floorEvs.filter((e) => e.id !== at?.id).map((e) => <button key={e.id} onClick={() => (at ? move(a, e) : add(a, e))}>{at ? 'Move to' : 'Add to'} {e.title} <small>{booked(e).length} / {e.staff_needed}</small></button>)}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div className="adm-card stack" style={{ gap: 10 }}>
            <span className="serif" style={{ fontSize: 22 }}>Teams today</span>
            {(events ?? []).map((e) => {
              const b = booked(e); const n = Math.max(e.staff_needed, b.length, 1);
              const tc = (t: string) => b.filter((s) => tierOf(s.staff_id) === t).length;
              const r = avgRank(e); const weak = r != null && ranksAll.length > 1 && r > Math.min(...ranksAll) + 4;
              return (
                <Link key={e.id} to={`/admin/event/${e.id}`} className={'fr-team' + (e.id === defaultTarget?.id ? ' on' : '')}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><b>{e.title}{e.department === 'bar' ? ' · bar' : ''} · {ap12(e.start_time?.slice(0, 5)).replace(':00', '')}</b><b className={b.length >= e.staff_needed ? 'okc' : 'amberc'}>{b.length} / {e.staff_needed}</b></div>
                  {e.department !== 'bar' && <div className="fr-bar"><i style={{ width: `${(tc('A') / n) * 100}%`, background: '#5E8B6E' }} /><i style={{ width: `${(tc('B') / n) * 100}%`, background: '#C9A74A' }} /><i style={{ width: `${(tc('C') / n) * 100}%`, background: '#B5675E' }} /></div>}
                  <span className="muted sm">{e.department === 'bar' ? 'bar team · not balanced here' : `A ${tc('A')} · B ${tc('B')} · C ${tc('C')}${r != null ? ` · avg rank ${r}` : ''}${weak ? ' · weaker than the others' : ''}`}</span>
                </Link>
              );
            })}
            {!(events ?? []).length && <span className="muted sm">No events this day.</span>}
            <span className="muted sm">Lower average rank = stronger team. Bars: green A · gold B · red C.</span>
          </div>
        </div>
      )}
    </div>
  );
}
