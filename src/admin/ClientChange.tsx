import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { setting } from '../lib/settings';
import { dayShort } from '../lib/shiftAsks';
import { replaceUrl } from './Changes';
import { ReplaceSheet, candidatesFor, initials, isTired, loadPool, minOf, tiredText, type Pool } from './Replace';
import { ENDS, addDays, ap12, bookingChange, endIso, isoDay, startIso, tTime, type AEvent, type AShift, type AStaff, type Line } from './api';

/* Push 47 §C · Client changes after booking (admin event page → "Client change").
   1 one screen: floor staff · start · ends · address · notes (old → new), ‹ Prev / Next › through events in date order.
   2 fewer people → Suggested who comes off (rule-based: training extras, maybes, lowest rank on the event, most shifts this week;
     MDs / managers never). "Keep as overbook" = nobody removed.
   3 more people → Suggested from Yes / Maybe for that date, ranked, fits the new start. "Ask more people" = the Bookings ask flow.
   4 times changed → people whose answered time no longer fits: Keep / Swap (Swap opens Find replacement after saving).
   5 Save → before confirmations went out: silent. After: only the people it touches, one private message each.
   Every change is written to the event history (change_log). */

const TZ = 'America/Toronto';
const hmOf = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const t12 = (hm: string | null | undefined) => (hm ? ap12(hm.slice(0, 5)) : '—');
const lead = (s: AShift, st?: AStaff) => ['MD', 'BM'].includes(s.position_code ?? '') || st?.role === 'manager' || !!st?.positions.some((p) => p.toUpperCase() === 'MD');
const addHm = (hm: string, d: number) => { const [h, m] = hm.split(':').map(Number); const t = (((h * 60 + m + d) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const TIER_I: Record<string, number> = { A: 0, B: 1, C: 2 };

type Draft = { count: number; start: string; ends: string; address: string; notes: string };
type Page = { id: string; date: string; title: string };
const endsOf = (e: AEvent) => e.ends_label ?? (ENDS.find(([, t]) => t && e.end_time?.startsWith(t))?.[0] ?? (e.end_time ? `~ ${ap12(e.end_time.slice(0, 5))}` : 'late'));
const endT = (label: string, e?: AEvent) => (ENDS.find(([l]) => l === label)?.[1] ?? (label === endsOf(e ?? ({} as AEvent)) ? e?.end_time?.slice(0, 5) ?? null : null));
const draftOf = (f: AEvent): Draft => ({ count: f.staff_needed, start: (f.start_time ?? (f.staffing ?? []).map((l) => l.start).sort()[0] ?? '17:00').slice(0, 5), ends: endsOf(f), address: f.address ?? '', notes: f.notes ?? '' });

export function ClientChange() {
  const { id } = useParams(); const nav = useNavigate();
  const today = isoDay(new Date());
  const [pages, setPages] = useState<Page[] | null>(null);
  const [pool, setPool] = useState<Pool | null>(null); const [title, setTitle] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number>>({});
  const [d, setD] = useState<Draft | null>(null);
  const [rm, setRm] = useState<string[] | null>(null); const [add, setAdd] = useState<string[] | null>(null);
  const [overbook, setOverbook] = useState(false); const [swap, setSwap] = useState<Record<string, boolean>>({});
  const [ask, setAsk] = useState<string | null>(null); // unsaved → Save / Discard before going to this page
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const [swapQ, setSwapQ] = useState<string[]>([]); const [tick, setTick] = useState(0);

  useEffect(() => {
    setPool(null); setD(null); setRm(null); setAdd(null); setOverbook(false); setSwap({}); setErr('');
    (async () => {
      const { data: one } = await supabase.from('events').select('event_date,title').eq('id', id!).maybeSingle();
      if (!one) { setTitle(''); return; }
      const o = one as { event_date: string; title: string }; setTitle(o.title);
      const p = await loadPool(o.event_date); setPool(p);
      const f = p.evs.filter((e) => e.title === o.title).sort((a) => (a.department === 'floor' ? -1 : 1))[0];
      if (f) setD(draftOf(f));
      const from = o.event_date < today ? o.event_date : today;
      const { data: ls } = await supabase.from('events').select('id,event_date,title,department,start_time').gte('event_date', from).lte('event_date', addDays(today, 180)).order('event_date').order('start_time');
      const m = new Map<string, Page & { floor: boolean }>();
      for (const e of (ls ?? []) as { id: string; event_date: string; title: string; department: string }[]) {
        const k = e.event_date + '|' + e.title; const cur = m.get(k);
        if (!cur || (!cur.floor && e.department === 'floor')) m.set(k, { id: e.id, date: e.event_date, title: e.title, floor: e.department === 'floor' });
      }
      setPages([...m.values()].filter((x) => x.date >= today || x.date === o.event_date));
    })();
    supabase.rpc('staff_shift_counts').then(({ data, error }) => { if (!error && Array.isArray(data)) setDone(Object.fromEntries((data as { staff_id: string; done: number }[]).map((x) => [x.staff_id, x.done]))); });
  }, [id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const evs = useMemo(() => (pool && title ? pool.evs.filter((e) => e.title === title).sort((a) => (a.department === 'floor' ? -1 : 1)) : []), [pool, title]);
  const f = evs[0]; const bar = evs.find((e) => e.department === 'bar' && e.id !== f?.id);
  const old = f ? draftOf(f) : null;
  const byId = useMemo(() => Object.fromEntries((pool?.staff ?? []).map((s) => [s.id, s])), [pool]);

  // ── what changes ──
  const cut = old && d ? Math.max(0, old.count - d.count) : 0;
  const more = old && d ? Math.max(0, d.count - old.count) : 0;
  const startD = old && d ? (minOf(d.start) ?? 0) - (minOf(old.start) ?? 0) : 0;
  const endChanged = !!old && !!d && d.ends !== old.ends;
  const team = (f?.shifts ?? []).filter((s) => s.status !== 'declined' && !s.attendance && !s.punches?.punch_in);
  const newUnder = setting('bookings.new_tag_shifts');

  // step 2 · who comes off (Suggested)
  const offList = useMemo(() => {
    if (!pool || !f) return [];
    const rankKey = (s: AStaff | undefined) => (TIER_I[s?.staff_private?.tier ?? ''] ?? 3) * 1000 + (s?.staff_private?.ranking ?? 999);
    const rows = team.map((s) => {
      const st = byId[s.staff_id]; const locked = lead(s, st);
      return { s, st, locked, isNew: (done[s.staff_id] ?? 0) < newUnder, maybe: pool.av[s.staff_id]?.status === 'maybe', rk: rankKey(st), nth: pool.week[s.staff_id] ?? 1 };
    });
    const free = rows.filter((r) => !r.locked).sort((a, b) => Number(b.isNew) - Number(a.isNew) || Number(b.maybe) - Number(a.maybe) || b.rk - a.rk || b.nth - a.nth);
    const lowest = free.filter((r) => !r.isNew && !r.maybe)[0]?.s.id;
    return [...free.map((r) => ({ ...r, why: r.isNew ? 'training extra' : r.maybe ? 'still a maybe' : r.s.id === lowest ? 'lowest rank on this event' : `${r.st?.staff_private?.ranking ? `#${r.st.staff_private.ranking} · ` : ''}${ord(r.nth)} shift this week` })),
      ...rows.filter((r) => r.locked).map((r) => ({ ...r, why: 'MD / manager · never removed' }))];
  }, [pool, f, team.length, done, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sugOff = offList.filter((r) => !r.locked).slice(0, cut).map((r) => r.s.id);
  const offIds = overbook ? [] : rm ?? sugOff;

  // step 3 · who comes on (Suggested from Yes / Maybe, fits the new start)
  const newStartIso = f && d ? startIso(f.event_date, d.start) : '';
  const onRes = useMemo(() => (pool && f && d && more ? candidatesFor(pool, { eventId: f.id, start: newStartIso, bar: false }) : null), [pool, f, more, newStartIso]); // eslint-disable-line react-hooks/exhaustive-deps
  const sugOn = (onRes?.list ?? []).filter((c) => !isTired(c.nth)).slice(0, more).map((c) => c.s.id);
  const onIds = more ? add ?? sugOn : [];

  // step 4 · answered time no longer fits
  const endHm = d && f ? endT(d.ends, f) : null;
  const noFit = useMemo(() => {
    if (!pool || !d || (!startD && !endChanged)) return [];
    const ns = minOf(d.start); const ne = minOf(endHm);
    return team.filter((s) => !offIds.includes(s.id)).map((s) => {
      const a = pool.av[s.staff_id]; const fr = minOf(a?.from_time); const un = minOf(a?.until_time);
      const why = fr != null && ns != null && fr > ns ? `said from ${t12(a!.from_time)} · start now ${t12(d.start)}` : un != null && ne != null && un < ne ? `said until ${t12(a!.until_time)} · now ${d.ends}` : '';
      return { s, why };
    }).filter((x) => x.why);
  }, [pool, d?.start, d?.ends, offIds.join(), team.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // step 5 · who hears about it
  const sent = !!f?.shifts.some((s) => s.notified_at);
  const touched = (s: AShift) => !!s.notified_at;
  const floorLeft = team.filter((s) => !offIds.includes(s.id));
  const timeTeam = [...(startD || endChanged ? floorLeft : []), ...(endChanged && bar ? bar.shifts.filter((s) => s.status !== 'declined' && !s.attendance && !s.punches?.punch_in) : [])];
  const nTime = timeTeam.length;
  const addrChanged = !!old && !!d && d.address.trim() !== old.address.trim();
  const notesChanged = !!old && !!d && d.notes.trim() !== old.notes.trim();
  const dirty = !!old && !!d && (d.count !== old.count || startD !== 0 || endChanged || addrChanged || notesChanged);
  const nAddr = addrChanged ? evs.flatMap((e) => e.shifts).filter((s) => s.status === 'confirmed' && !s.attendance).length : 0;

  const idx = pages && f ? pages.findIndex((p) => p.id === f.id || evs.some((e) => e.id === p.id)) : -1;
  const go = (p?: Page) => { if (!p) return; if (dirty) { setAsk(p.id); return; } nav(`/admin/event/${p.id}/change`); };

  const save = async (): Promise<boolean> => {
    if (!f || !d || !old) return false;
    setBusy(true); setErr('');
    try {
      const venue = f.title; const day = dayShort(f.event_date);
      const newEnd = endT(d.ends, f);
      // event (floor): count, start, ends, address, notes · staffing lines follow the start and the count
      const lines: Line[] = (f.staffing ?? []).map((l) => ({ ...l, start: startD ? addHm(l.start, startD) : l.start, end: endChanged && l.end === (old.ends ? endT(old.ends, f) : null) ? newEnd : l.end }));
      if (d.count !== old.count) {
        const ws = lines.filter((l) => l.code === 'W').sort((a, b) => b.count - a.count);
        if (ws[0]) ws[0].count = Math.max(0, ws[0].count + d.count - old.count);
      }
      const row = { staff_needed: d.count, start_time: d.start, end_time: newEnd, ends_label: d.ends, address: d.address.trim() || null, notes: d.notes.trim() || null, ...(f.staffing ? { staffing: lines } : {}) };
      const up = await supabase.from('events').update(row).eq('id', f.id); if (up.error) throw up.error;
      if (bar && (endChanged || addrChanged || notesChanged)) {
        const ub = await supabase.from('events').update({ ...(endChanged ? { end_time: newEnd, ends_label: d.ends } : {}), ...(addrChanged ? { address: d.address.trim() || null } : {}), ...(notesChanged && (bar.notes ?? '') === old.notes ? { notes: d.notes.trim() || null } : {}) }).eq('id', bar.id);
        if (ub.error) throw ub.error;
      }
      // 2 · removed (no reliability hit: the shift is deleted, logged as removed · client change)
      for (const sid of offIds) {
        const s = team.find((x) => x.id === sid); if (!s) continue;
        const del = await supabase.from('shifts').delete().eq('id', s.id); if (del.error) throw del.error;
        await supabase.from('change_log').insert({ entity: 'shift', entity_id: s.id, change: { kind: 'removed', staff: s.staff_id, from: f.id, to: null, start: s.planned_start, reason: 'client_change' } });
        if (sent && touched(s)) {
          await supabase.from('staff_alerts').insert({ staff_id: s.staff_id, kind: 'removed', title: `You're no longer needed ${day}`, body: `${venue} · Sorry for the change.`, event_id: null });
          const r = await supabase.rpc('admin_off_note', { p_staff: s.staff_id, p_date: f.event_date, p_venue: venue, p_line: `You’re no longer needed ${day}. Sorry for the change.`, p_title: `🗓 You’re no longer needed ${day}` });
          if (r.error) await supabase.rpc('admin_shift_note', { p_staff: s.staff_id, p_kind: 'removed', p_shift: null, p_alert: null, p_meta: { date: f.event_date, venue } }).then(() => {}, () => {}); // 054 not applied
        }
      }
      // time updates: start moves everyone on the floor by the same amount; ends change floor + bar
      for (const s of timeTeam) {
        const isF = s.event_id === f.id;
        const ns = isF && startD ? new Date(new Date(s.planned_start).getTime() + startD * 60000).toISOString() : new Date(s.planned_start).toISOString();
        const ev = isF ? f : bar!;
        const pe = newEnd ? endIso(ev.event_date, hmOf(ns), newEnd) : null;
        const u = await supabase.from('shifts').update({ planned_start: ns, planned_end: endChanged ? pe : s.planned_end ?? pe }).eq('id', s.id); if (u.error) throw u.error;
        const ls: { label: string; old: string | null; new: string | null }[] = [];
        if (ns !== new Date(s.planned_start).toISOString()) ls.push({ label: 'Start', old: tTime(s.planned_start), new: tTime(ns) });
        if (endChanged) ls.push({ label: 'Ends', old: old.ends, new: d.ends });
        await supabase.from('change_log').insert({ entity: 'shift', entity_id: s.id, change: { kind: 'client_time', staff: s.staff_id, event: ev.id, lines: ls } });
        if (sent && touched(s) && ls.length) {
          const { data: al } = await supabase.from('staff_alerts').insert({ staff_id: s.staff_id, kind: 'moved', title: 'Your shift changed', body: `${day} · ${venue} · ${ls.map((l) => `${l.label.toLowerCase()} ${l.new} (was ${l.old})`).join(' · ')}`, event_id: ev.id }).select('id').maybeSingle();
          await supabase.rpc('admin_shift_note', { p_staff: s.staff_id, p_kind: 'changed', p_shift: s.id, p_alert: (al as { id: string } | null)?.id ?? null, p_meta: { date: f.event_date, venue, start: ns, lines: ls } }).then(() => {}, () => {});
        }
      }
      // 3 · added: after confirmations = their confirmation (sent now → confirm window + "You're booked"); before = just on the list
      for (const sid of onIds) {
        const ps = startIso(f.event_date, d.start); const pe = newEnd ? endIso(f.event_date, d.start, newEnd) : null;
        const ins = await supabase.from('shifts').insert({ event_id: f.id, staff_id: sid, position_code: 'W', position_detail: 'Waiter', planned_start: ps, planned_end: pe, status: 'booked', ...(sent ? { notified_at: new Date().toISOString() } : {}) }).select('id').single();
        if (ins.error) throw new Error(ins.error.message.includes('duplicate') ? `${byId[sid]?.full_name ?? 'Someone'} is already on this event.` : ins.error.message);
        await bookingChange('booked', { staff_id: sid, shift_id: ins.data.id, to: { id: f.id, event_date: f.event_date, title: venue, sent, start: ps } });
      }
      await supabase.from('change_log').insert({ entity: 'event', entity_id: f.id, change: {
        kind: 'client_change', old, new: d, silent: !sent, overbook, removed: offIds.map((x) => team.find((s) => s.id === x)?.staff_id), added: onIds, time_updates: nTime,
        swaps: noFit.filter((x) => swap[x.s.id]).map((x) => x.s.staff_id) } });
      setMsg(`Saved${sent ? '' : ' quietly'} · ${[offIds.length && `${offIds.length} removed`, onIds.length && `${onIds.length} added`, nTime && `${nTime} time update${nTime > 1 ? 's' : ''}`, addrChanged && 'new address'].filter(Boolean).join(' · ') || 'details updated'}.`);
      setSwapQ(noFit.filter((x) => swap[x.s.id]).map((x) => x.s.id));
      setTick((t) => t + 1);
      setBusy(false); return true;
    } catch (e) { setErr((e as Error).message); setBusy(false); return false; }
  };

  if (title === '') return <div className="adm-card">This event doesn't exist anymore. <Link to="/admin/week">Back to the calendar</Link></div>;
  if (!pool || !f || !d || !old) return <div className="muted">Loading…</div>;
  const set = (k: keyof Draft, v: string | number) => setD({ ...d, [k]: v });
  const prev = idx > 0 ? pages![idx - 1] : undefined; const next = idx >= 0 && pages ? pages[idx + 1] : undefined;
  const swapShift = swapQ[0] ? f.shifts.find((s) => s.id === swapQ[0]) : undefined;
  const tag = (o: string, n: string, kind: 'num' | 'time' | 'text') => {
    if (o === n) return <span className="cc-tag">same</span>;
    if (kind === 'num') { const x = Number(n) - Number(o); return <span className={'cc-tag ' + (x < 0 ? 'minus' : 'plus')}>{x > 0 ? '+' : '−'}{Math.abs(x)}</span>; }
    if (kind === 'time') { const x = (minOf(n) ?? 0) - (minOf(o) ?? 0); return <span className="cc-tag chg">{x > 0 ? 'later' : x < 0 ? 'earlier' : 'changed'}</span>; }
    return <span className="cc-tag chg">changed</span>;
  };
  const endsChoices = [...new Set([old.ends, ...ENDS.map(([l]) => l)])];
  const startChoices = Array.from({ length: 4 * 24 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
  if (!startChoices.includes(old.start)) startChoices.push(old.start);
  let n = 1;

  return (
    <div className="stack-lg cc">
      <div className="toolbar">
        <div><Link to={`/admin/event/${f.id}`} className="muted sm strong">‹ Event page</Link><div className="kick" style={{ marginTop: 6 }}>CLIENT CHANGE · AFTER BOOKING</div><h1 className="serif-h">Client change</h1></div>
        <span className={'tag ' + (sent ? 'amber' : '')}>{sent ? 'Confirmations sent · people it touches are told' : 'Before confirmations · saved quietly'}</span>
      </div>

      <div className="adm-card cc-nav">
        <button className="abtn sm" disabled={!prev} onClick={() => go(prev)}>‹ Prev</button>
        {prev && <span className="muted sm">{prev.title} · {dayShort(prev.date)}</span>}
        <div className="grow"><small>{dayShort(f.event_date).toUpperCase()}{pages && idx >= 0 ? ` · ${idx + 1} OF ${pages.length}` : ''}</small><b>{f.title}</b></div>
        {next && <span className="muted sm">{next.title} · {dayShort(next.date)}</span>}
        <button className="abtn sm" disabled={!next} onClick={() => go(next)}>Next ›</button>
      </div>

      <section className="adm-card cc-step">
        <div className="kick"><span className="cc-n">{n++}</span>THE CHANGE · CHANGE ONLY WHAT CHANGED</div>
        <div className="cc-f"><small>Floor staff</small><span className="old">{old.count}</span>
          <span className="num"><button className="sq" aria-label="One less" onClick={() => set('count', Math.max(0, d.count - 1))}>−</button><input type="number" min={0} value={d.count} onChange={(e) => set('count', Math.max(0, Number(e.target.value) || 0))} aria-label="Floor staff" /><button className="sq" aria-label="One more" onClick={() => set('count', d.count + 1)}>+</button></span>
          {tag(String(old.count), String(d.count), 'num')}</div>
        <div className="cc-f"><small>Start</small><span className="old">{t12(old.start)}</span>
          <select value={d.start} onChange={(e) => set('start', e.target.value)} aria-label="Start">{startChoices.map((t) => <option key={t} value={t}>{t12(t)}</option>)}</select>{tag(old.start, d.start, 'time')}</div>
        <div className="cc-f"><small>Ends</small><span className="old">{old.ends}</span>
          <select value={d.ends} onChange={(e) => set('ends', e.target.value)} aria-label="Ends">{endsChoices.map((l) => <option key={l} value={l}>{l}</option>)}</select>{tag(old.ends, d.ends, 'text')}</div>
        <div className="cc-f"><small>Address</small><span className="old">{old.address || '—'}</span>
          <input value={d.address} onChange={(e) => set('address', e.target.value)} aria-label="Address" />{tag(old.address.trim(), d.address.trim(), 'text')}</div>
        <div className="cc-f"><small>Notes for staff</small><span className="old">{old.notes || '—'}</span>
          <textarea value={d.notes} onChange={(e) => set('notes', e.target.value)} aria-label="Notes for staff" />{tag(old.notes.trim(), d.notes.trim(), 'text')}</div>
      </section>

      {cut > 0 && <section className="adm-card cc-step">
        <div className="kick"><span className="cc-n">{n++}</span>FEWER PEOPLE · WHO COMES OFF <span className="cc-sug">SUGGESTED {Math.min(cut, sugOff.length)}</span></div>
        <div className="spread"><b>Remove {overbook ? 0 : offIds.length} of {team.length}</b>{!overbook && offIds.length !== cut && <span className="accent sm">The client cut {cut}. You ticked {offIds.length}.</span>}</div>
        <div className="cc-list">
          {offList.map((r) => {
            const on = offIds.includes(r.s.id);
            return (
              <button key={r.s.id} className={'cc-p' + (on ? ' on' : '') + (r.locked ? ' locked' : '')} disabled={r.locked || overbook} aria-pressed={on}
                onClick={() => setRm(on ? offIds.filter((x) => x !== r.s.id) : [...offIds, r.s.id])}>
                <i aria-hidden="true">{on ? '✓' : ''}</i><span className="tierb">{r.locked ? 'MD' : r.st?.staff_private?.tier ?? '–'}</span>
                <span className="grow"><b>{r.s.staff?.full_name ?? '?'} {r.isNew && !r.locked && <span className="newb">NEW</span>}</b><small>{r.why}{!r.locked && r.maybe && r.why !== 'still a maybe' ? ' · maybe' : ''}</small></span>
                {sugOff.includes(r.s.id) && !overbook && <span className="cc-sug">SUGGESTED</span>}
              </button>);
          })}
          {!offList.length && <div className="muted sm">Nobody on the floor list yet.</div>}
        </div>
        <small className="muted">MDs and managers are never picked. Tick someone else to swap.</small>
        <label className="ca-sw"><input type="checkbox" checked={overbook} onChange={(e) => setOverbook(e.target.checked)} /><span><b>Keep them as overbook</b><small>nobody is removed · the list stays {team.length}, you release people later one at a time</small></span></label>
      </section>}

      {more > 0 && <section className="adm-card cc-step">
        <div className="kick"><span className="cc-n">{n++}</span>MORE PEOPLE · WHO COMES ON <span className="cc-sug">SUGGESTED {Math.min(more, sugOn.length)}</span></div>
        <div className="spread"><b>Add {onIds.length} of {more}</b><span className="muted sm">said Yes / Maybe for {dayShort(f.event_date)} · free at {t12(d.start)}</span></div>
        <div className="cc-list">
          {(onRes?.list ?? []).slice(0, 20).map((c) => {
            const on = onIds.includes(c.s.id);
            return (
              <button key={c.s.id} className={'cc-p' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setAdd(on ? onIds.filter((x) => x !== c.s.id) : [...onIds, c.s.id])}>
                <i aria-hidden="true">{on ? '✓' : ''}</i><span className="tierb">{c.tier ?? '–'}</span>
                <span className="grow"><b>{c.s.full_name}</b><small>{c.line.replace(/^[ABC–] · /, '')}{tiredText(c.nth) ? ` · ${tiredText(c.nth)}` : ''}</small></span>
                {sugOn.includes(c.s.id) && <span className="cc-sug">SUGGESTED</span>}
              </button>);
          })}
          {onRes && !onRes.list.length && <div className="muted sm">Nobody who said Yes or Maybe is free at {t12(d.start)}.</div>}
        </div>
        {onIds.length < more && <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}><span className="sm">Not enough yes?</span><Link className="abtn sm dark" to={replaceUrl(f, { spots: more - onIds.length })}>Ask more people · {more - onIds.length} spot{more - onIds.length > 1 ? 's' : ''} ›</Link><span className="muted sm">Save first, then ask.</span></div>}
      </section>}

      {(startD !== 0 || endChanged) && <section className="adm-card cc-step">
        <div className="kick"><span className="cc-n">{n++}</span>TIMES CHANGED · WHO NO LONGER FITS</div>
        {noFit.length ? <>
          <b>{noFit.length} {noFit.length === 1 ? 'person’s time doesn’t' : 'people’s times don’t'} fit</b>
          {noFit.map(({ s, why }) => (
            <div key={s.id} className="cc-fit"><span className="nx-av" aria-hidden="true">{initials(s.staff?.full_name)}</span><span className="grow"><b>{s.staff?.full_name}</b><small>{why}</small></span>
              <div className="seg3"><button className={!swap[s.id] ? 'on' : ''} onClick={() => setSwap({ ...swap, [s.id]: false })}>Keep</button><button className={swap[s.id] ? 'on' : ''} onClick={() => setSwap({ ...swap, [s.id]: true })}>Swap</button></div></div>
          ))}
          <small className="muted">Everyone else’s time still fits. Swap opens Find replacement after you save; they stay on until someone says yes.</small>
        </> : <small className="muted">Everyone’s answered time still fits.</small>}
      </section>}

      <section className="adm-card cc-step cc-save">
        <div className="kick"><span className="cc-n">{n++}</span>SAVE · WHO HEARS ABOUT IT</div>
        {sent ? <div className="cc-who"><b>After confirmations went out</b><span>Only the people it touches, one private message each:</span>
          {offIds.length > 0 && <span>· removed → “You’re no longer needed {dayShort(f.event_date)}. Sorry for the change.” (no reliability hit)</span>}
          {onIds.length > 0 && <span>· added → their confirmation</span>}
          {nTime > 0 && <span>· time → “Your start changed” / “Your shift changed”</span>}
          {addrChanged && <span>· address → “Your shift changed” for the {nAddr} confirmed</span>}</div>
          : <div className="cc-who"><b>Before confirmations</b><span>Saved quietly. Nobody gets anything. Removed people just aren’t booked; added people go on the list.</span></div>}
        <div className="cc-prev">Preview: {[`${offIds.length} removed`, `${onIds.length} added`, `${nTime} time update${nTime === 1 ? '' : 's'}`, addrChanged ? 'new address' : '', notesChanged ? 'new notes' : ''].filter(Boolean).join(' · ')}</div>
        {err && <div className="accent sm">{err}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="abtn" disabled={!dirty || busy} onClick={() => { setD(old); setRm(null); setAdd(null); setOverbook(false); setSwap({}); }}>Discard</button>
          <button className="abtn dark grow" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save change'}</button>
        </div>
        <small className="muted">Every change is written to the event’s history (who, what, when). Suggestions are rules (rank, answers, this week), not a guess.</small>
      </section>

      {ask && <div className="bk-modal" onClick={() => setAsk(null)}><div className="adm-card" onClick={(x) => x.stopPropagation()} role="dialog" aria-label="Unsaved change">
        <div className="serif ca-h">Save the change to {f.title} first?</div>
        <span className="muted sm">You changed {[d.count !== old.count && 'floor staff', startD && 'start', endChanged && 'ends', addrChanged && 'address', notesChanged && 'notes'].filter(Boolean).join(', ')}.</span>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="abtn" onClick={() => setAsk(null)}>Keep editing</button>
          <button className="abtn danger" onClick={() => { const to = ask; setAsk(null); nav(`/admin/event/${to}/change`); }}>Discard</button>
          <button className="abtn dark" disabled={busy} onClick={async () => { const to = ask; if (await save()) { setAsk(null); nav(`/admin/event/${to}/change`); } }}>Save</button>
        </div>
      </div></div>}
      {swapShift && <ReplaceSheet shift={swapShift} ev={f} onClose={() => setSwapQ((q) => q.slice(1))} onDone={(m) => { setMsg(m); setSwapQ((q) => q.slice(1)); setTick((t) => t + 1); }} />}
      {msg && <div className="undo-bar" role="status"><span className="grow">{msg}</span><button className="lnk" onClick={() => setMsg(null)}>OK</button></div>}
    </div>
  );
}
