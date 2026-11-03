import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { addDays, isoDay, dLabel, startIso, endIso, bookingChange, roleName, ap12, ROLES } from './api';
import { AlsoWorking, otherShifts } from './alsoWorking';
import { diff, norm, mtlHm, dateOf, type Change, type DEvent, type DStaff, type SheetEvent } from './sheetDiff';

/**
 * Push 44 · Today → "Sheet changes": what the Events sheet says that the app doesn't (yet).
 * One card per difference, Approve / Ignore. Nothing changes in the app until Ronnie taps Approve.
 * Ignore = admin_archive (same key + signature as Needs you): the card comes back if that cell changes again.
 */
type Arch = { key: string; sig: string };
const EV_COLS = 'id,event_date,title,department,address,venue_id,sheet_ref,end_time,event_private(client),shifts(id,event_id,staff_id,position_code,planned_start,planned_end,status,attendance,notified_at,cancelled_at,punches(punch_in))';
const DAYS = 60;
const TAG: Record<Change['kind'], [string, string]> = {
  added: ['STAFF ADDED', 'ok'], removed: ['STAFF REMOVED', 'red'], time: ['TIME', 'amber'], new_event: ['NEW EVENT', 'blue'], check_name: ['CHECK NAME', 'purple'],
};

export function SheetChanges({ arch, onArchived }: { arch: Arch[]; onArchived: () => void }) {
  const today = isoDay(new Date());
  const [data, setData] = useState<{ sheet: SheetEvent[]; app: (DEvent & { end_time: string | null })[]; staff: DStaff[]; aliases: { alias: string; staff_id: string }[]; ran: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [more, setMore] = useState(false);
  const [busyAll, setBusyAll] = useState(false);

  useEffect(() => {
    (async () => {
      const to = addDays(today, DAYS);
      const [sh, ev, st, al, run] = await Promise.all([
        supabase.from('sheet_events').select('id,event_date,department,title,venue,address,details,lines,staff,sheet_row').gte('event_date', today).lte('event_date', to).order('event_date'),
        supabase.from('events').select(EV_COLS).gte('event_date', today).lte('event_date', to),
        supabase.from('staff').select('id,full_name,nickname,active'),
        supabase.from('sheet_name_alias').select('alias,staff_id'),
        supabase.from('sheet_sync_runs').select('posted_at').order('posted_at', { ascending: false }).limit(1),
      ]);
      if (sh.error) { setErr(/does not exist|schema cache/i.test(sh.error.message) ? 'off' : sh.error.message); return; }
      if (ev.error) { setErr(ev.error.message); return; }
      setData({ sheet: (sh.data ?? []) as SheetEvent[], app: (ev.data ?? []) as unknown as (DEvent & { end_time: string | null })[], staff: (st.data ?? []) as DStaff[],
        aliases: (al.data ?? []) as { alias: string; staff_id: string }[], ran: (run.data?.[0] as { posted_at: string } | undefined)?.posted_at ?? null });
    })();
  }, [tick, today]);

  const changes = useMemo(() => (data ? diff(data.sheet, data.app, data.staff, data.aliases) : []), [data]);
  const hidden = (c: Change) => arch.some((a) => a.key === c.key && a.sig === c.sig);
  const shown = changes.filter((c) => !hidden(c));

  if (err === 'off') return null; // migration 050 not applied yet
  if (err) return <div className="adm-card muted sm">Sheet changes: {err}</div>;
  if (!data || (!data.ran && !data.sheet.length)) return null; // sheet script not turned on yet

  const reload = () => setTick((t) => t + 1);
  const ignore = async (list: Change[]) => {
    await supabase.from('admin_archive').upsert(list.map((c) => ({ key: c.key, sig: c.sig, label: 'Sheet · ' + label(c), archived_at: new Date().toISOString() })));
    onArchived();
  };
  const approveAll = async () => {
    const list = shown.filter((c) => c.kind !== 'check_name');
    if (!list.length || !confirm(`Approve ${list.length} sheet change${list.length === 1 ? '' : 's'}?\n\n${sendsLine(list)}`)) return;
    setBusyAll(true);
    try { for (const c of list) await approve(c, data.app, data.staff); } catch (e) { alert((e as Error).message); }
    setBusyAll(false); reload();
  };
  const ago = data.ran ? Math.max(0, Math.round((Date.now() - new Date(data.ran).getTime()) / 60000)) : null;
  const list = more ? shown : shown.slice(0, 8);

  return (
    <>
      <div className="sec"><span className="serif">Sheet changes <b className="accent sm">{shown.length || ''}</b></span>
        {shown.some((c) => c.kind !== 'check_name') && <button className="abtn sm dark" disabled={busyAll} onClick={approveAll}>{busyAll ? 'Approving…' : `Approve all ${shown.filter((c) => c.kind !== 'check_name').length}`}</button>}</div>
      <div className="adm-card sc-box">
        {!shown.length && <div className="muted sm" style={{ padding: '8px 0' }}>The app matches the Events sheet.</div>}
        {list.map((c) => <Card key={c.key} c={c} app={data.app} staff={data.staff} onDone={reload} onIgnore={() => ignore([c])} />)}
        {shown.length > 8 && <button className="arch-toggle" onClick={() => setMore(!more)}>{more ? '▴ Show less' : `▾ Show all ${shown.length}`}</button>}
        <div className="muted sm sc-foot">Events sheet · next {DAYS} days{ago !== null ? ` · checked ${ago < 1 ? 'just now' : ago + ' min ago'}` : ''}. Nothing changes in the app until you approve.</div>
      </div>
    </>
  );
}

function label(c: Change) {
  const ev = 'e' in c && c.e ? c.e.title : (c as { se: SheetEvent }).se.venue || (c as { se: SheetEvent }).se.title;
  const d = dLabel(dateOf(c));
  if (c.kind === 'added') return `${c.name} added · ${ev} · ${d}`;
  if (c.kind === 'removed') return `${c.name} removed · ${ev} · ${d}`;
  if (c.kind === 'time') return `Start ${ap12(c.old)} → ${ap12(c.new)} · ${ev} · ${d}`;
  if (c.kind === 'new_event') return `New event · ${ev} · ${d}`;
  return `"${c.name}" · ${ev} · ${d}`;
}

const sent = (e: DEvent) => e.shifts.some((s) => s.notified_at);
/** How many people approving this sends a message to (same rules as the rest of the app). */
function sends(c: Change) {
  if (c.kind === 'added') return sent(c.e) || (c.from && sent(c.from.e)) ? 1 : 0;
  if (c.kind === 'removed') return sent(c.e) ? 1 : 0;
  if (c.kind === 'time') return sent(c.e) ? c.people.length : 0;
  return 0;
}
const sendsLine = (list: Change[]) => { const n = list.reduce((k, c) => k + sends(c), 0); return n ? `This sends ${n} ${n === 1 ? 'person' : 'people'} a message.` : 'Confirmations not sent yet → nobody gets a message.'; };

function Card({ c, app, staff, onDone, onIgnore }: { c: Change; app: (DEvent & { end_time: string | null })[]; staff: DStaff[]; onDone: () => void; onIgnore: () => void }) {
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(c.kind === 'check_name' ? c.suggest[0]?.id ?? '' : '');
  const [tag, cls] = TAG[c.kind];
  const ev = 'e' in c && c.e ? c.e : null;
  const evName = ev ? ev.title : (c as { se: SheetEvent }).se.venue || (c as { se: SheetEvent }).se.title;
  const weekN = (id: string, d: string) => app.filter((e) => e.event_date > addDays(d, -7) && e.event_date <= addDays(d, 6)).reduce((n, e) => n + e.shifts.filter((s) => s.staff_id === id && s.status !== 'declined' && !s.attendance).length, 0);
  let what: React.ReactNode = null; let sub = ''; let btn = 'Approve';
  if (c.kind === 'added') {
    what = <><b>{c.name}</b> · {roleName(c.code)} · {ap12(c.start)}</>;
    const n = weekN(c.staffId, c.e.event_date);
    sub = [c.from ? `Moves from ${c.from.e.title} (${ap12(mtlHm(c.from.s.planned_start))})` : null, n >= 4 ? `${n + 1}th shift around this week` : null,
      sends(c) ? 'Confirmations already sent → they get a message' : 'Confirmations not sent yet → they get nothing'].filter(Boolean).join(' · ');
    if (c.from) btn = 'Approve move';
  } else if (c.kind === 'removed') {
    what = <><b>{c.name}</b> · not in the sheet any more</>;
    sub = sends(c) ? 'Confirmations already sent → they get "You\'re no longer on…"' : 'Confirmations not sent yet → they get nothing';
  } else if (c.kind === 'time') {
    what = <>Start <s className="muted">{ap12(c.old)}</s> → <b>{ap12(c.new)}</b> · {c.people.length} {c.people.length === 1 ? 'person' : 'people'}</>;
    sub = c.people.slice(0, 4).map((p) => p.name.split(' ')[0]).join(', ') + (c.people.length > 4 ? ` +${c.people.length - 4}` : '') + ' · ' +
      (sends(c) ? `${c.people.length} get "Your start changed"` : 'confirmations not sent yet → nobody gets a message');
  } else if (c.kind === 'new_event') {
    const se = c.se; const total = se.lines.reduce((n, l) => n + l.count, 0);
    what = <>In the sheet, not in the app · {total || se.staff.length} {se.department === 'bar' ? 'bar' : 'floor'}{se.venue ? '' : ' · no venue in the sheet'}</>;
    sub = `${se.title}${se.venue ? ' · ' + se.venue : ''} · ${c.staff.length} name${c.staff.length === 1 ? '' : 's'} found${c.unmatched.length ? `, ${c.unmatched.length} to check` : ''} · Approve creates it quietly`;
    btn = 'Create event';
  } else {
    what = <>"{c.name}" in the sheet · {roleName(c.code)}{c.start ? ' · ' + ap12(c.start) : ''}</>;
    sub = c.e ? 'Not matched to anyone in the app' : 'On a new event';
    btn = 'Use';
  }
  const go = async () => {
    if (c.kind === 'check_name' && !pick) return;
    setBusy(true);
    try { await approve(c, app, staff, pick); onDone(); } catch (e) { alert((e as Error).message); setBusy(false); }
  };
  return (
    <div className="sc-card">
      <div className="sc-top"><span className={'sc-tag ' + cls}>{tag}</span><b className="sm">{evName} · {dLabel(dateOf(c))}</b><span className="grow" />{ev && <Link className="sm" to={`/admin/event/${ev.id}`}>Event ›</Link>}</div>
      <div className="sc-what">{what}</div>
      <div className="muted sm">{sub}</div>
      {c.kind === 'added' && <AlsoWorking others={otherShifts(app, c.staffId, c.e.id, c.e.event_date).filter((o) => !c.from || o.start !== c.from.s.planned_start)} start={startIso(c.e.event_date, c.start)} />}
      <div className="sc-act">
        {c.kind === 'check_name' && (
          <select className="sc-pick" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Who is this?">
            <option value="">Who is this?</option>
            {c.suggest.length > 0 && <optgroup label="Best matches">{c.suggest.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</optgroup>}
            <optgroup label="Everyone">{staff.filter((s) => s.active).sort((a, b) => a.full_name.localeCompare(b.full_name)).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</optgroup>
          </select>
        )}
        <button className="abtn sm dark" disabled={busy || (c.kind === 'check_name' && !pick)} onClick={go}>{busy ? 'Saving…' : c.kind === 'check_name' && pick ? `Use ${staff.find((s) => s.id === pick)?.full_name.split(' ')[0] ?? ''}` : btn}</button>
        <button className="abtn sm" disabled={busy} onClick={onIgnore}>Ignore</button>
      </div>
    </div>
  );
}

const evRef = (e: DEvent, sentNow: boolean, start: string) => ({ id: e.id, event_date: e.event_date, title: e.title, sent: sentNow, start: startIso(e.event_date, start) });

/** Apply one sheet change through the same helpers the event form uses (change_log + alerts only when confirmations went out). */
async function approve(c: Change, app: (DEvent & { end_time: string | null })[], staff: DStaff[], pick?: string) {
  if (c.kind === 'added') {
    const label = ROLES.find((r) => r.code === c.code)?.label ?? c.code;
    const end = (app.find((e) => e.id === c.e.id)?.end_time ?? null);
    const row = { event_id: c.e.id, position_code: c.code, position_detail: label, planned_start: startIso(c.e.event_date, c.start), planned_end: endIso(c.e.event_date, c.start, end), status: 'booked' };
    if (c.from) {
      const up = await supabase.from('shifts').update(row).eq('id', c.from.s.id);
      if (up.error) throw up.error;
      await bookingChange('moved', { staff_id: c.staffId, shift_id: c.from.s.id, from: evRef(c.from.e, sent(c.from.e), mtlHm(c.from.s.planned_start)), to: evRef(c.e, sent(c.e), c.start) });
    } else {
      const ins = await supabase.from('shifts').insert({ ...row, staff_id: c.staffId }).select('id').single();
      if (ins.error) throw ins.error;
      await bookingChange('booked', { staff_id: c.staffId, shift_id: ins.data.id, to: evRef(c.e, sent(c.e), c.start) });
    }
  } else if (c.kind === 'removed') {
    if (c.s.punches?.punch_in) throw new Error(`${c.name} already started; not removed.`);
    const del = await supabase.from('shifts').delete().eq('id', c.s.id);
    if (del.error) throw del.error;
    await bookingChange('removed', { staff_id: c.s.staff_id, shift_id: c.s.id, from: evRef(c.e, sent(c.e), mtlHm(c.s.planned_start)) });
  } else if (c.kind === 'time') {
    const end = app.find((e) => e.id === c.e.id)?.end_time ?? null;
    for (const p of c.people) {
      const up = await supabase.from('shifts').update({ planned_start: startIso(c.e.event_date, c.new), planned_end: endIso(c.e.event_date, c.new, end) }).eq('id', p.s.id);
      if (up.error) throw up.error;
      await bookingChange('moved', { staff_id: p.s.staff_id, shift_id: p.s.id, from: evRef(c.e, sent(c.e), c.old), to: evRef(c.e, sent(c.e), c.new) });
    }
  } else if (c.kind === 'new_event') {
    const se = c.se;
    const { data: vs } = await supabase.from('venues').select('id,name,address,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items');
    const venue = ((vs ?? []) as { id: string; name: string; address: string | null; [k: string]: unknown }[])
      .map((v) => ({ v, s: Math.max(simWords(se.venue, v.name), simWords(se.title, v.name)) })).sort((a, b) => b.s - a.s).find((x) => x.s >= 0.5)?.v;
    const lines = se.lines.filter((l) => l.count > 0);
    const start = lines.map((l) => l.start).filter(Boolean).sort()[0] ?? c.staff.map((s) => s.start).filter(Boolean).sort()[0] ?? '17:00';
    const lead = c.staff.find((s) => s.code === (se.department === 'bar' ? 'BM' : 'MD'));
    const { name: _n, id: _i, address: vAddr, ...uni } = venue ?? ({} as { name?: string; id?: string; address?: string | null });
    void _n; void _i;
    const row = {
      event_date: se.event_date, title: venue?.name ?? se.venue ?? 'Details to come', venue_id: venue?.id ?? null, address: se.address || (vAddr as string | null) || null,
      department: se.department, start_time: start, staff_needed: lines.reduce((n, l) => n + l.count, 0) || c.staff.length,
      manager_id: lead?.staffId ?? null, staffing: lines.map((l) => ({ dept: se.department, code: l.code, start: l.start ?? start, end: null, count: l.count })),
      sheet_ref: se.sheet_row ? `EVENTS!A${se.sheet_row}` : null, ...(venue ? uni : {}),
    };
    const ins = await supabase.from('events').insert(row).select('id').single();
    if (ins.error) throw ins.error;
    const id = ins.data.id as string;
    await supabase.from('event_private').upsert({ event_id: id, client: se.title }, { onConflict: 'event_id' });
    for (const s of c.staff) {
      const st = s.start ?? start; const label = ROLES.find((r) => r.code === s.code)?.label ?? s.code;
      const sh = await supabase.from('shifts').insert({ event_id: id, staff_id: s.staffId, position_code: s.code, position_detail: label, planned_start: startIso(se.event_date, st), status: 'booked' }).select('id').single();
      if (sh.error) throw sh.error;
      await bookingChange('booked', { staff_id: s.staffId, shift_id: sh.data.id, to: { id, event_date: se.event_date, title: row.title, sent: false, start: startIso(se.event_date, st) } });
    }
  } else if (c.kind === 'check_name' && pick) {
    const r = await supabase.from('sheet_name_alias').upsert({ alias: norm(c.name), staff_id: pick });
    if (r.error) throw r.error;
    void staff;
  }
}

const simWords = (a: string | null | undefined, b: string | null | undefined) => {
  const A = norm(a).split(' ').filter((t) => t.length > 2); const B = norm(b).split(' ').filter((t) => t.length > 2);
  if (!A.length || !B.length) return 0;
  return A.filter((x) => B.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))).length / Math.max(A.length, B.length);
};
