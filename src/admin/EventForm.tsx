import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  allStaff, isoDay, startIso, endIso, addDays, dLabel, parseTime, ap12, roleOfShift, ROLES, UNIFORMS, ENDS,
  type AStaff, type Line, type Venue, type Client,
} from './api';
import { tiersFor } from './Availability';
import { AddressInput, type AddressParts } from '../components/AddressInput';

type Tier = 'A' | 'B' | 'C';
type Ev = { id: string; department: 'floor' | 'bar' | 'kitchen'; staffing: Omit<Line, 'names'>[] | null; manager_id: string | null };
type Sh = { id: string; event_id: string; staff_id: string; position_code: string | null; planned_start: string; attendance: string | null; punches: { punch_in: string | null } | null };
type DayInfo = {
  avail: Record<string, { status: string; from: string | null; until: string | null }>;
  booked: Record<string, string>;   // staff_id → other event title
  off: Set<string>;
  weeklyNo: Set<string>;
};

const blankLine = (dept: 'floor' | 'bar' = 'floor', code = 'W', start = '17:00'): Line => ({ dept, code, start, count: 1, names: [] });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
const tierOf = (s: AStaff) => s.staff_private?.tier ?? null;
const rankOf = (s: AStaff) => s.staff_private?.ranking ?? 9999;

/** Rebuild the grid from an event's saved lines, or from its shifts when it has none (events made before the grid existed). */
function linesFor(ev: Ev, shifts: Sh[]): Line[] {
  const mine = shifts.filter((s) => s.event_id === ev.id && !s.attendance);
  const dept = ev.department === 'bar' ? 'bar' : 'floor';
  if (ev.staffing?.length) {
    const lines = ev.staffing.map((l) => ({ ...l, dept: l.dept ?? dept, names: [] as string[] }));
    for (const s of mine) {
      const code = roleOfShift(s.position_code); const st = hm(s.planned_start);
      const l = lines.find((x) => x.code === code && x.start === st && x.names.length < x.count) ?? lines.find((x) => x.code === code && x.start === st)
        ?? lines.find((x) => x.code === code && x.names.length < x.count);
      if (l) l.names.push(s.staff_id); else lines.push({ dept, code, start: st, count: 1, names: [s.staff_id] });
    }
    for (const l of lines) l.count = Math.max(l.count, l.names.length);
    return lines;
  }
  const m = new Map<string, Line>();
  for (const s of mine) {
    const code = roleOfShift(s.position_code); const st = hm(s.planned_start); const k = code + st;
    if (!m.has(k)) m.set(k, { dept, code, start: st, count: 0, names: [] });
    const l = m.get(k)!; l.count++; l.names.push(s.staff_id);
  }
  const order = (c: string) => ROLES.findIndex((r) => r.code === c);
  return [...m.values()].sort((a, b) => order(a.code) - order(b.code) || a.start.localeCompare(b.start));
}

export function EventForm() {
  const { id } = useParams(); const [params] = useSearchParams(); const nav = useNavigate();
  const isNew = !id || id === 'new';
  const [date, setDate] = useState(params.get('d') ?? isoDay(new Date()));
  const [venues, setVenues] = useState<Venue[]>([]); const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [venueId, setVenueId] = useState<string | null>(null); const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState<string>(''); const [newClient, setNewClient] = useState<string | null>(null);
  const [address, setAddress] = useState(''); const [ends, setEnds] = useState('~ midnight');
  const [parts, setParts] = useState<AddressParts | null>(null);
  const [uFloor, setUFloor] = useState('white_shirt'); const [uBar, setUBar] = useState('black_shirt');
  const [note, setNote] = useState(''); const [staffNote, setStaffNote] = useState(''); const [showStaffNote, setShowStaffNote] = useState(false);
  const [rateSet, setRateSet] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([blankLine('floor', 'MD', '17:00'), blankLine('floor', 'W', '17:00')]);
  const [existing, setExisting] = useState<Ev[]>([]); const [oldShifts, setOldShifts] = useState<Sh[]>([]);
  const [askTiers, setAskTiers] = useState<Tier[] | null>(null); const [askBar, setAskBar] = useState<'georges' | 'team'>('georges');
  const [askWhen, setAskWhen] = useState<'save' | 'later'>(isNew ? 'save' : 'later');
  const [day, setDay] = useState<DayInfo>({ avail: {}, booked: {}, off: new Set(), weeklyNo: new Set() });
  const [dup, setDup] = useState<{ dates: string[]; pick: string; names: 'none' | 'leads' | 'all' } | null>(null);
  const [lastAt, setLastAt] = useState<{ date: string; lines: Line[] } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(isNew);

  // Lists
  useEffect(() => {
    supabase.from('venues').select('id,name,address,usual_client_id,uniform_floor,uniform_bar').order('name').then(({ data }) => setVenues((data ?? []) as Venue[]));
    supabase.from('clients').select('id,name,rate_sets').order('name').then(({ data }) => setClients((data ?? []) as Client[]));
    allStaff().then((s) => setStaff(s.filter((x) => x.active)));
  }, []);

  // Editing: load this event + its floor/bar sibling
  useEffect(() => {
    if (isNew) return;
    (async () => {
      const { data: e } = await supabase.from('events').select('*,event_private(client,client_id,rate_set)').eq('id', id!).single();
      if (!e) return;
      const { data: sib } = await supabase.from('events').select('id,department,staffing,manager_id').eq('event_date', e.event_date).eq('title', e.title);
      const evs = (sib ?? []) as Ev[];
      const { data: sh } = await supabase.from('shifts').select('id,event_id,staff_id,position_code,planned_start,attendance,punches(punch_in)').in('event_id', evs.map((x) => x.id)).neq('status', 'declined');
      const shifts = (sh ?? []) as unknown as Sh[];
      setExisting(evs); setOldShifts(shifts);
      setDate(e.event_date); setTitle(e.title); setVenueId(e.venue_id); setAddress(e.address ?? '');
      setClientId(e.event_private?.client_id ?? ''); setRateSet(e.event_private?.rate_set ?? null);
      setEnds(e.ends_label ?? (ENDS.find(([, t]) => t && e.end_time?.startsWith(t))?.[0] ?? '~ midnight'));
      setUFloor(e.uniform_floor ?? 'white_shirt'); setUBar(e.uniform_bar ?? 'black_shirt');
      setNote(e.description ?? ''); setStaffNote(e.notes ?? ''); setShowStaffNote(!!e.notes);
      const ordered = [...evs].sort((a) => (a.department === 'floor' ? -1 : 1));
      setLines(ordered.flatMap((x) => linesFor(x, shifts)));
      setLoaded(true);
    })();
  }, [id]);

  // Who's free / booked / off on this date
  useEffect(() => {
    if (!date) return;
    const dow = (new Date(date + 'T12:00:00').getDay() + 6) % 7;
    Promise.all([
      supabase.from('availability').select('staff_id,status,from_time,until_time').eq('for_date', date),
      supabase.from('shifts').select('staff_id,event_id,events!inner(title,event_date)').eq('events.event_date', date).neq('status', 'declined'),
      supabase.from('days_off').select('staff_id,from_date,to_date,every_dow').lte('from_date', date).gte('to_date', date),
      supabase.from('staff_weekly').select('staff_id,status').eq('dow', dow).eq('status', 'no'),
      supabase.from('avail_exceptions').select('staff_id').eq('for_date', date),
    ]).then(([a, b, o, w, x]) => {
      const avail: DayInfo['avail'] = {};
      for (const r of (a.data ?? []) as { staff_id: string; status: string; from_time: string | null; until_time: string | null }[]) {
        const cur = avail[r.staff_id]; if (!cur || r.status === 'yes') avail[r.staff_id] = { status: r.status, from: r.from_time, until: r.until_time };
      }
      const mine = new Set(existing.map((e) => e.id)); const booked: Record<string, string> = {};
      for (const r of (b.data ?? []) as unknown as { staff_id: string; event_id: string; events: { title: string } }[]) if (!mine.has(r.event_id)) booked[r.staff_id] = r.events.title;
      const off = new Set(((o.data ?? []) as { staff_id: string; every_dow: number | null }[]).filter((r) => r.every_dow == null || r.every_dow === dow).map((r) => r.staff_id));
      const opened = new Set(((x.data ?? []) as { staff_id: string }[]).map((r) => r.staff_id));
      setDay({ avail, booked, off, weeklyNo: new Set(((w.data ?? []) as { staff_id: string }[]).map((r) => r.staff_id).filter((s) => !opened.has(s))) });
    });
  }, [date, existing]);

  // "Copy last [venue]"
  useEffect(() => {
    if (!title) { setLastAt(null); return; }
    (async () => {
      const { data } = await supabase.from('events').select('id,event_date,department,staffing,manager_id').eq('title', title).lt('event_date', date).order('event_date', { ascending: false }).limit(4);
      const evs = (data ?? []) as (Ev & { event_date: string })[];
      if (!evs.length) { setLastAt(null); return; }
      const d = evs[0].event_date; const same = evs.filter((e) => e.event_date === d);
      const { data: sh } = await supabase.from('shifts').select('id,event_id,staff_id,position_code,planned_start,attendance,punches(punch_in)').in('event_id', same.map((e) => e.id)).neq('status', 'declined');
      const ls = [...same].sort((a) => (a.department === 'floor' ? -1 : 1)).flatMap((e) => linesFor(e, (sh ?? []) as unknown as Sh[])).map((l) => ({ ...l, names: [] }));
      setLastAt(ls.length ? { date: d, lines: ls } : null);
    })();
  }, [title, date]);

  const venue = venues.find((v) => v.id === venueId) ?? null;
  useEffect(() => { if (venue?.address && !address) setAddress(venue.address); }, [venue?.id]);
  const client = clients.find((c) => c.id === clientId) ?? null;
  const pickVenue = (v: Venue) => {
    setVenueId(v.id); setTitle(v.name); setAddress(v.address ?? '');
    if (v.usual_client_id) setClientId(v.usual_client_id);
    if (v.uniform_floor) setUFloor(v.uniform_floor); if (v.uniform_bar) setUBar(v.uniform_bar);
  };

  const floorN = lines.filter((l) => l.dept === 'floor').reduce((n, l) => n + l.count, 0);
  const tiers = askTiers ?? tiersFor(floorN || 1);
  const named = (l: Line) => staff.filter((s) => l.names.includes(s.id));

  // ── Save ──
  const saveAll = async (forDate: string, asNew: boolean, namesMode: 'all' | 'leads' | 'none') => {
    // venue + client lists
    let vId = venueId; let cId = clientId || null;
    if (newClient?.trim()) {
      const { data: c, error } = await supabase.from('clients').insert({ name: newClient.trim() }).select('id').single();
      if (error) throw error; cId = c.id; setClientId(c.id); setNewClient(null);
      setClients([...clients, { id: c.id, name: newClient.trim(), rate_sets: [] }]);
    }
    if (!vId && title.trim()) {
      const { data: v, error } = await supabase.from('venues').insert({ name: title.trim(), address: address || null, ...(parts ? { street: parts.street, unit: parts.unit || null, city: parts.city, province: parts.province, postal_code: parts.postal_code } : {}), usual_client_id: cId, uniform_floor: uFloor, uniform_bar: uBar }).select('id').single();
      if (error && !error.message.includes('duplicate')) throw error;
      vId = v?.id ?? (await supabase.from('venues').select('id').eq('name', title.trim()).single()).data?.id ?? null; setVenueId(vId);
    } else if (vId) {
      await supabase.from('venues').update({ uniform_floor: uFloor, uniform_bar: uBar, ...(venue && !venue.address && address ? { address } : {}), ...(venue && !venue.usual_client_id && cId ? { usual_client_id: cId } : {}) }).eq('id', vId);
    }
    const endT = ENDS.find(([l]) => l === ends)?.[1] ?? null;
    let firstId: string | null = null;
    for (const dept of ['floor', 'bar'] as const) {
      const ls = lines.filter((l) => l.dept === dept && l.count > 0);
      const old = asNew ? undefined : existing.find((e) => e.department === dept);
      if (!ls.length && !old) continue;
      const keep = (l: Line) => namesMode === 'all' ? l.names : namesMode === 'leads' && (l.code === 'MD' || l.code === 'BM') ? l.names : [];
      const lead = ls.find((l) => l.code === (dept === 'floor' ? 'MD' : 'BM'));
      const start = ls.map((l) => l.start).sort()[0] ?? '17:00';
      const row = {
        event_date: forDate, title: title.trim(), venue_id: vId, address: address || null, department: dept,
        start_time: start, end_time: endT, ends_label: ends, staff_needed: ls.reduce((n, l) => n + l.count, 0),
        manager_id: lead ? keep(lead)[0] ?? null : null, description: note || null, notes: staffNote || null,
        uniform_floor: uFloor, uniform_bar: uBar, staffing: ls.map(({ dept: d, code, start: s, count }) => ({ dept: d, code, start: s, count })),
      };
      const res = old ? await supabase.from('events').update(row).eq('id', old.id).select('id').single() : await supabase.from('events').insert(row).select('id').single();
      if (res.error) throw res.error;
      const evId = res.data.id as string; firstId ??= evId;
      const priv = await supabase.from('event_private').upsert({ event_id: evId, client: client?.name ?? (newClient || null), client_id: cId, rate_set: rateSet }, { onConflict: 'event_id' });
      if (priv.error) throw priv.error;

      // Shifts: book new names, move changed ones, remove dropped ones (never anyone who already punched in).
      const want = ls.flatMap((l) => keep(l).map((sid) => ({ sid, l })));
      const have = old ? oldShifts.filter((s) => s.event_id === old.id) : [];
      const log: { by_staff: null; entity: string; entity_id: string; change: object }[] = [];
      for (const { sid, l } of want) {
        const ps = startIso(forDate, l.start); const pe = endT ? endIso(forDate, l.start, endT) : null;
        const label = ROLES.find((r) => r.code === l.code)?.label ?? l.code;
        const cur = have.find((s) => s.staff_id === sid);
        if (!cur) {
          const ins = await supabase.from('shifts').insert({ event_id: evId, staff_id: sid, position_code: l.code, position_detail: label, planned_start: ps, planned_end: pe, status: 'booked' }).select('id').single();
          if (ins.error) throw ins.error;
          log.push({ by_staff: null, entity: 'shift', entity_id: ins.data.id, change: { kind: 'booked', event: evId, date: forDate, start: l.start, code: l.code } });
        } else if (hm(cur.planned_start) !== l.start || roleOfShift(cur.position_code) !== l.code || cur.attendance) {
          const up = await supabase.from('shifts').update({ planned_start: ps, planned_end: pe, position_code: /^\d+$/.test(cur.position_code ?? '') && l.code === 'W' ? cur.position_code : l.code, position_detail: label, attendance: null }).eq('id', cur.id);
          if (up.error) throw up.error;
          log.push({ by_staff: null, entity: 'shift', entity_id: cur.id, change: { kind: 'moved', from: hm(cur.planned_start), to: l.start, code: l.code } });
        }
      }
      for (const s of have) if (!want.some((w) => w.sid === s.staff_id) && !s.punches?.punch_in) {
        await supabase.from('shifts').delete().eq('id', s.id);
        log.push({ by_staff: null, entity: 'shift', entity_id: s.id, change: { kind: 'removed', staff: s.staff_id, event: evId, date: forDate } });
      }
      if (log.length) await supabase.from('change_log').insert(log);
      if (!ls.length && old && !have.some((s) => s.punches?.punch_in)) await supabase.from('events').delete().eq('id', old.id);

      // Ask availability (staff only see the date)
      if (askWhen === 'save' && (dept === 'floor' || askBar === 'team')) await ask(forDate, dept, row.staff_needed, start);
    }
    return firstId;
  };

  const ask = async (d: string, dept: 'floor' | 'bar', needed: number, start: string) => {
    const pool = staff.filter((s) => (dept === 'bar' ? s.department === 'bar' : s.department !== 'bar'))
      .filter((s) => dept === 'bar' || (tierOf(s) && tiers.includes(tierOf(s)!)))
      .filter((s) => !day.avail[s.id] && !day.booked[s.id] && !day.off.has(s.id) && !day.weeklyNo.has(s.id) && !lines.some((l) => l.names.includes(s.id)));
    const { data: prev } = await supabase.from('avail_asks').select('tiers_sent').eq('for_date', d).eq('department', dept).maybeSingle();
    const { data: a, error } = await supabase.from('avail_asks').upsert({
      for_date: d, department: dept, label: 'Evening event', approx_start: start, staff_needed: needed,
      tiers_sent: Array.from(new Set([...((prev?.tiers_sent as string[]) ?? []), ...(dept === 'bar' ? [] : tiers)])).sort(),
    }, { onConflict: 'for_date,department' }).select('id').single();
    if (error || !a) throw error ?? new Error('Could not ask');
    if (pool.length) {
      const r = await supabase.from('availability').upsert(pool.map((s) => ({ staff_id: s.id, for_date: d, part: 'evening', status: 'asked', ask_id: a.id, tier: tierOf(s), asked_at: new Date().toISOString() })), { onConflict: 'staff_id,for_date,part', ignoreDuplicates: true });
      if (r.error) throw r.error;
    }
  };

  const save = async (ev?: React.FormEvent) => {
    ev?.preventDefault(); setErr('');
    if (!title.trim()) return setErr('Pick or type a venue first.');
    if (!lines.some((l) => l.count > 0)) return setErr('Add at least one staffing line.');
    setBusy(true);
    try { const evId = await saveAll(date, isNew, 'all'); setBusy(false); if (evId) nav(`/admin/event/${evId}`); }
    catch (e) { setBusy(false); setErr((e as Error).message); }
  };

  const duplicate = async () => {
    if (!dup?.dates.length) return; setErr(''); setBusy(true);
    try { for (const d of dup.dates) await saveAll(d, true, dup.names); setBusy(false); setDup(null); nav(`/admin/week`); }
    catch (e) { setBusy(false); setErr((e as Error).message); }
  };

  const del = async () => {
    if (!confirm('Delete this event (floor and bar) and its bookings?')) return;
    for (const e of existing) await supabase.from('events').delete().eq('id', e.id);
    nav(`/admin/day?d=${date}`);
  };

  if (!loaded) return <div className="muted">Loading…</div>;

  return (
    <form className="stack-lg ef" onSubmit={save}>
      <div className="toolbar">
        <div><Link to={isNew ? '/admin/week' : `/admin/event/${id}`} className="muted sm strong">‹ {isNew ? 'Back to week' : 'Back to event'}</Link><h1 className="serif-h">{isNew ? 'New event' : `Edit · ${title}`}</h1></div>
        <div className="row wrap" style={{ position: 'relative' }}>
          {lastAt && <button type="button" className="abtn" onClick={() => setLines(lastAt.lines.map((l) => ({ ...l, names: [] })))}>Copy last {title} ({dLabel(lastAt.date, { month: 'short', day: 'numeric' })})</button>}
          <button type="button" className="abtn" style={{ borderColor: 'var(--ink)' }} onClick={() => setDup(dup ? null : { dates: [], pick: addDays(date, 1), names: 'none' })}>Duplicate to another day…</button>
          <button className="abtn dark" disabled={busy}>{busy ? 'Saving…' : 'Save event'}</button>
          {dup && (
            <div className="ef-pop">
              <b>Duplicate this event</b>
              <span className="muted sm">Venue, client, address, uniform, times and the staffing grid are copied.</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {dup.dates.map((d) => <button type="button" key={d} className="tag-dark" onClick={() => setDup({ ...dup, dates: dup.dates.filter((x) => x !== d) })}>{dLabel(d)} ×</button>)}
                <input type="date" className="date" value={dup.pick} onChange={(e) => setDup({ ...dup, pick: e.target.value })} />
                <button type="button" className="abtn sm" onClick={() => dup.pick && !dup.dates.includes(dup.pick) && setDup({ ...dup, dates: [...dup.dates, dup.pick].sort() })}>+ date</button>
              </div>
              <b className="sm">Names on the lines</b>
              {([['none', "Leave empty, I'll fill or ask availability"], ['leads', 'Keep MD / BM only'], ['all', 'Keep everyone']] as const).map(([k, l]) => (
                <label key={k} className="radio"><input type="radio" checked={dup.names === k} onChange={() => setDup({ ...dup, names: k })} /> {l}</label>
              ))}
              <div className="row" style={{ justifyContent: 'flex-end' }}><button type="button" className="abtn sm" onClick={() => setDup(null)}>Cancel</button><button type="button" className="abtn sm dark" disabled={!dup.dates.length || busy} onClick={duplicate}>Create {dup.dates.length || ''} event{dup.dates.length === 1 ? '' : 's'}</button></div>
            </div>
          )}
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="adm-card ef-top">
        <label className="ef-f"><span>DATE</span><input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="ef-f ef-venue"><span>VENUE · this is the title staff see</span><VenuePicker venues={venues} value={title} venue={venue} onPick={pickVenue} onNew={(name) => { setVenueId(null); setTitle(name); }} /></div>
        <label className="ef-f"><span>CLIENT · only you see it</span>
          {newClient !== null ? <div className="row"><input autoFocus value={newClient} onChange={(e) => setNewClient(e.target.value)} placeholder="New client name" /><button type="button" className="abtn sm" onClick={() => setNewClient(null)}>×</button></div>
            : <select value={clientId} onChange={(e) => { if (e.target.value === '__new') { setNewClient(''); setClientId(''); } else { setClientId(e.target.value); setRateSet(null); } }}>
              <option value="">—</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new">+ New client…</option>
            </select>}
          {venue?.usual_client_id && venue.usual_client_id === clientId && <small className="okc">Filled from the venue · change if needed</small>}
        </label>
        <label className="ef-f"><span>ENDS · approx.</span><select value={ends} onChange={(e) => setEnds(e.target.value)}>{ENDS.map(([l]) => <option key={l}>{l}</option>)}</select></label>
        <div className="ef-f ef-wide"><span>ADDRESS · {venue?.address ? 'auto' : 'start typing, pick from the list'}</span><AddressInput value={address} onChange={(v) => { setAddress(v); setParts(null); }} onPick={setParts} placeholder="Start typing the address…" /><small className="muted">Add the suite, floor or entrance at the end if needed.</small></div>
        <label className="ef-f"><span>FLOOR UNIFORM</span><select value={uFloor} onChange={(e) => setUFloor(e.target.value)}>{UNIFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="ef-f"><span>BAR UNIFORM</span><select value={uBar} onChange={(e) => setUBar(e.target.value)}>{UNIFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><small className="muted">Remembered per venue</small></label>
        <label className="ef-f ef-wide"><span>EVENT NOTE (optional)</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sit-down dinner · 250 guests" /></label>
      </div>

      <Grid lines={lines} setLines={setLines} staff={staff} day={day} />

      <div className="ef-2">
        <div className="adm-card stack" style={{ gap: 12 }}>
          <div className="sec" style={{ padding: 0 }}><span className="serif">Ask availability</span><span className="muted sm">staff only see the date</span></div>
          <div className="row wrap" style={{ gap: 8 }}><b className="sm" style={{ width: 40 }}>Floor</b>
            {(['A', 'B', 'C'] as Tier[]).map((t) => <button type="button" key={t} className={'tchip t' + t + (tiers.includes(t) ? ' on' : '')} onClick={() => setAskTiers(tiers.includes(t) ? tiers.filter((x) => x !== t) : [...tiers, t].sort() as Tier[])}>{tiers.includes(t) ? '✓ ' : ''}{t}</button>)}
            <span className="muted sm">{floorN} needed{askTiers ? '' : ' → suggested'}</span></div>
          <div className="row wrap" style={{ gap: 8 }}><b className="sm" style={{ width: 40 }}>Bar</b>
            <button type="button" className={'abtn sm' + (askBar === 'team' ? ' dark' : '')} onClick={() => setAskBar('team')}>Bar team</button>
            <button type="button" className={'abtn sm' + (askBar === 'georges' ? ' dark' : '')} onClick={() => setAskBar('georges')}>Georges books it</button></div>
          <div className="row" style={{ gap: 18 }}>
            <label className="radio"><input type="radio" checked={askWhen === 'save'} onChange={() => setAskWhen('save')} /> Ask when I save</label>
            <label className="radio"><input type="radio" checked={askWhen === 'later'} onChange={() => setAskWhen('later')} /> Later</label></div>
        </div>
        <div className="stack" style={{ gap: 14 }}>
          {client && client.rate_sets.length >= 2 && (
            <div className="adm-card stack" style={{ gap: 10 }}>
              <div className="sec" style={{ padding: 0 }}><span className="serif">Billing</span><span className="muted sm">only you see it</span></div>
              {client.rate_sets.map((r, i) => (
                <label key={r.key} className={'bill' + ((rateSet ?? client.rate_sets[0].key) === r.key ? ' on' : '')}>
                  <input type="radio" checked={(rateSet ?? client.rate_sets[0].key) === r.key} onChange={() => setRateSet(r.key)} />
                  <span><b>{r.label}{i === 0 && !r.label.includes('default') ? ' (default)' : ''}</b><small>{Object.entries(r.rates).map(([k, v]) => `${k} $${v}`).join(' · ')} / h</small></span>
                </label>
              ))}
              <span className="muted sm">Goes with the event to the invoice builder.</span>
            </div>
          )}
          <div className="adm-card stack" style={{ gap: 10 }}>
            <span className="serif" style={{ fontSize: 22 }}>More (optional)</span>
            {!showStaffNote ? <div><button type="button" className="abtn sm" onClick={() => setShowStaffNote(true)}>+ Note for staff</button></div>
              : <label className="ef-f"><span>NOTE FOR STAFF · shows in their event details</span><textarea rows={2} value={staffNote} onChange={(e) => setStaffNote(e.target.value)} placeholder="Enter by the loading dock on Cathcart." /></label>}
          </div>
          {!isNew && <div><button type="button" className="abtn" style={{ color: 'var(--accent)' }} onClick={del}>Delete event</button></div>}
        </div>
      </div>
      <div className="muted sm">Save only saves. Booked / moved / removed people are recorded; nothing is sent to staff yet.</div>
    </form>
  );
}

/** Searchable venue dropdown with "+ New venue". */
function VenuePicker({ venues, value, venue, onPick, onNew }: { venues: Venue[]; value: string; venue: Venue | null; onPick: (v: Venue) => void; onNew: (name: string) => void }) {
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const list = venues.filter((v) => v.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="vp" ref={ref}>
      <button type="button" className={'vp-btn' + (open ? ' on' : '')} onClick={() => { setOpen(!open); setQ(''); }}>{value || <span className="muted">Pick a venue…</span>}{value && !venue && <small className="tag amber" style={{ height: 20 }}>new</small>}<span className="grow" />▾</button>
      {open && (
        <div className="vp-list">
          <input autoFocus placeholder="Type to search venues…" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (list[0]) { onPick(list[0]); setOpen(false); } else if (q.trim()) { onNew(q.trim()); setOpen(false); } } }} />
          <div className="vp-scroll">
            {list.map((v) => (
              <button type="button" key={v.id} className={'vp-opt' + (venue?.id === v.id ? ' on' : '')} onClick={() => { onPick(v); setOpen(false); }}>
                <b>{v.name}{venue?.id === v.id ? ' ✓' : ''}</b><small>{v.address ?? <span className="accent">address missing</span>}</small>
              </button>
            ))}
          </div>
          <button type="button" className="vp-new" onClick={() => { const n = q.trim() || prompt('New venue name') || ''; if (n) { onNew(n); setOpen(false); } }}>+ New venue{q.trim() ? ` "${q.trim()}"` : ''} (saved for next time)</button>
        </div>
      )}
    </div>
  );
}

const ROLE_KEYS: Record<string, string> = { md: 'MD', w: 'W', waiter: 'W', waiters: 'W', bus: 'BUS', busboy: 'BUS', bm: 'BM', 'bar manager': 'BM', bt: 'BT', bartender: 'BT', bartenders: 'BT', bb: 'BB', barback: 'BB', barbacks: 'BB' };

/** The staffing grid: one line per role + start time. */
function Grid({ lines, setLines, staff, day }: { lines: Line[]; setLines: (l: Line[]) => void; staff: AStaff[]; day: DayInfo }) {
  const wrap = useRef<HTMLDivElement>(null);
  const upd = (i: number, p: Partial<Line>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const focusRow = (i: number) => setTimeout(() => wrap.current?.querySelector<HTMLElement>(`[data-row="${i}"] select`)?.focus(), 0);
  const addAfter = (i: number, copy = false) => {
    const src = lines[i]; const nl = copy ? { ...src, names: [] } : blankLine(src?.dept ?? 'floor', src?.code === 'MD' ? 'W' : src?.code === 'BM' ? 'BT' : src?.code ?? 'W', src?.start ?? '17:00');
    const next = [...lines]; next.splice(i + 1, 0, nl); setLines(next); focusRow(i + 1);
  };
  const keys = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target as HTMLElement).closest('.np')) { e.preventDefault(); addAfter(i); }
    if (e.key.toLowerCase() === 'd' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addAfter(i, true); }
  };
  const paste = (i: number) => (e: React.ClipboardEvent) => {
    const txt = e.clipboardData.getData('text'); if (!txt.includes('\t') && !txt.includes('\n')) return;
    e.preventDefault();
    const rows = txt.trim().split(/\r?\n/).map((r) => r.split('\t').map((c) => c.trim()));
    const parsed: Line[] = [];
    for (const r of rows) {
      let dept: 'floor' | 'bar' | null = null; let code: string | null = null; let start: string | null = null; let count = 1;
      for (const c of r) {
        const lc = c.toLowerCase();
        if (!dept && /^(f|floor|b|bar)$/.test(lc)) { dept = lc.startsWith('b') ? 'bar' : 'floor'; continue; }
        if (!code && ROLE_KEYS[lc]) { code = ROLE_KEYS[lc]; continue; }
        if (!start && parseTime(c) && /[:apm]|^\d{3,4}$/.test(lc)) { start = parseTime(c); continue; }
        if (/^\d{1,3}$/.test(c)) count = Number(c);
      }
      if (!code && !start) continue;
      code ??= 'W'; dept ??= ['BM', 'BT', 'BB'].includes(code) ? 'bar' : 'floor';
      parsed.push({ dept, code, start: start ?? lines[i]?.start ?? '17:00', count, names: [] });
    }
    if (!parsed.length) return;
    const next = [...lines]; const blank = !lines[i]?.names.length && lines[i]?.count <= 1;
    next.splice(blank ? i : i + 1, blank ? 1 : 0, ...parsed); setLines(next);
  };

  const floor = lines.filter((l) => l.dept === 'floor'); const bar = lines.filter((l) => l.dept === 'bar');
  const n = (ls: Line[]) => ls.reduce((a, l) => a + l.count, 0);
  const floorBits = [...new Set(floor.map((l) => l.start))].sort().map((st) => { const c = floor.filter((l) => l.start === st && l.code !== 'MD'); return c.length ? `${n(c)} at ${ap12(st).replace(':00', '')}` : ''; }).filter(Boolean);
  const barBits = ['BM', 'BT', 'BB'].map((c) => { const k = n(bar.filter((l) => l.code === c)); return k ? `${k} ${c}` : ''; }).filter(Boolean);
  const md = n(floor.filter((l) => l.code === 'MD'));

  return (
    <div className="adm-card grid-card" ref={wrap}>
      <div className="sec" style={{ padding: '4px 4px 10px' }}><span className="serif">Staffing · one line per start time</span><span className="muted sm hide-sm">Tab → next cell · Enter → new line · ⌘D duplicate line · paste rows from the sheet</span></div>
      <div className="sg">
        <div className="sg-h"><span>DEPT</span><span>ROLE</span><span>START</span><span>HOW MANY</span><span>NAMES</span><span /></div>
        {lines.map((l, i) => (
          <div key={i} className={'sg-r ' + (l.dept === 'bar' ? 'is-bar' : 'is-floor')} data-row={i} onKeyDown={keys(i)} onPaste={paste(i)}>
            <select aria-label="Department" value={l.dept} onChange={(e) => { const d = e.target.value as 'floor' | 'bar'; upd(i, { dept: d, code: d === 'bar' ? 'BT' : 'W', names: [] }); }}><option value="floor">● Floor</option><option value="bar">● Bar</option></select>
            <select aria-label="Role" value={l.code} onChange={(e) => upd(i, { code: e.target.value, names: [] })} className={l.code === 'MD' || l.code === 'BM' ? 'strong' : ''}>{ROLES.filter((r) => r.dept === l.dept).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select>
            <TimeCell value={l.start} onChange={(v) => upd(i, { start: v })} />
            <input aria-label="How many" type="number" min={0} value={l.count} onChange={(e) => upd(i, { count: Math.max(0, Number(e.target.value)) })} className={l.count >= 10 ? 'strong' : ''} />
            <NamePicker line={l} staff={staff} day={day} taken={lines.flatMap((x, k) => (k === i ? [] : x.names))} onChange={(names) => upd(i, { names, count: Math.max(l.count, names.length) })} />
            <button type="button" className="sg-x" aria-label="Remove line" onClick={() => setLines(lines.filter((_, k) => k !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="sg-add" onClick={() => addAfter(lines.length - 1)}>+ new line <span className="muted">· times like "545" → 5:45 PM</span></button>
      </div>
      <div className="sg-tot">
        <span><b>{n(floor)}</b> floor <small>({[md ? `${md} MD` : '', ...floorBits].filter(Boolean).join(' · ') || '—'})</small></span>
        <span><b>{n(bar)}</b> bar <small>({barBits.join(' · ') || '—'})</small></span>
        <span className="grow" /><span><b>{n(lines)}</b> total</span>
      </div>
    </div>
  );
}

function TimeCell({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [txt, setTxt] = useState(ap12(value)); const [bad, setBad] = useState(false);
  useEffect(() => { setTxt(ap12(value)); }, [value]);
  return <input aria-label="Start" className={bad ? 'bad' : ''} value={txt} onChange={(e) => { setTxt(e.target.value); setBad(false); }}
    onFocus={(e) => e.target.select()}
    onBlur={() => { const t = parseTime(txt.replace(/\s*(am|pm)$/i, (m) => m.trim())); if (t) { onChange(t); setTxt(ap12(t)); } else setBad(true); }} />;
}

/** Type-to-add names; MD and BM lines only list people who can lead. */
function NamePicker({ line, staff, day, taken, onChange }: { line: Line; staff: AStaff[]; day: DayInfo; taken: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [hi, setHi] = useState(0);
  const isBar = line.dept === 'bar';
  const pool = useMemo(() => staff.filter((s) => {
    if (line.code === 'MD') return s.positions.includes('MD') || (s.role !== 'staff' && s.department !== 'bar');
    if (line.code === 'BM') return s.positions.includes('BM') || (s.role !== 'staff' && s.department === 'bar');
    return isBar ? s.department === 'bar' : s.department !== 'bar';
  }), [staff, line.code, isBar]);
  const info = (s: AStaff) => {
    if (day.off.has(s.id)) return { t: 'off that day', cls: 'grey', block: true };
    if (day.booked[s.id]) return { t: `booked at ${day.booked[s.id]} that day`, cls: 'grey', block: true };
    if (taken.includes(s.id)) return { t: 'on another line', cls: 'grey', block: true };
    const a = day.avail[s.id];
    if (a?.status === 'yes') return { t: 'said yes' + (a.from ? ` · from ${ap12(a.from.slice(0, 5)).replace(':00', '')}` : '') + (a.until ? ` · until ${ap12(a.until.slice(0, 5)).replace(':00', '')}` : ''), cls: 'ok', block: false, w: 0 };
    if (a?.status === 'no') return { t: 'said no', cls: 'red', block: false, w: 3 };
    if (a) return { t: 'asked · no answer', cls: '', block: false, w: 1 };
    if (day.weeklyNo.has(s.id)) return { t: 'usually not this day', cls: 'amber', block: false, w: 2 };
    return { t: 'not asked', cls: '', block: false, w: 1 };
  };
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = pool.filter((s) => !line.names.includes(s.id) && words.every((w) => (s.full_name + ' ' + (s.nickname ?? '')).toLowerCase().includes(w)))
    .map((s) => ({ s, i: info(s) }))
    .sort((a, b) => Number(a.i.block) - Number(b.i.block) || (q ? Number(!a.s.full_name.toLowerCase().startsWith(words[0] ?? '')) - Number(!b.s.full_name.toLowerCase().startsWith(words[0] ?? '')) : 0) || (a.i.w ?? 9) - (b.i.w ?? 9) || (tierOf(a.s) ?? 'Z').localeCompare(tierOf(b.s) ?? 'Z') || rankOf(a.s) - rankOf(b.s))
    .slice(0, 8);
  const add = (id: string) => { onChange([...line.names, id]); setQ(''); setHi(0); };
  const lead = line.code === 'MD' || line.code === 'BM';
  return (
    <div className="np" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <div className="np-box">
        {line.names.map((id) => { const s = staff.find((x) => x.id === id); return <span key={id} className={'np-chip' + (lead ? ' lead' : '')}>{lead && <i>{line.code}</i>}{s?.full_name ?? '?'}<button type="button" aria-label="Remove" onClick={() => onChange(line.names.filter((x) => x !== id))}>×</button></span>; })}
        <input value={q} placeholder={line.names.length ? '' : lead ? `▾ ${line.code} list` : 'type a name…'} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, matches.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); const m = matches[hi]; if (m && !m.i.block && (q || open)) add(m.s.id); }
            if (e.key === 'Backspace' && !q && line.names.length) onChange(line.names.slice(0, -1));
          }} />
        {line.count > 0 && !lead && <small className="np-n">{line.names.length} of {line.count} named</small>}
      </div>
      {open && matches.length > 0 && (
        <div className="np-list">
          {matches.map(({ s, i }, k) => (
            <button type="button" key={s.id} disabled={i.block} className={'np-opt' + (k === hi ? ' hi' : '') + (i.block ? ' off' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.id)}>
              <b>{s.full_name}</b>{tierOf(s) && <i className={'tier-dot ' + tierOf(s)}>{tierOf(s)}</i>}<span className={'np-st ' + i.cls}>{i.t}</span>
            </button>
          ))}
          <div className="np-hint">Enter adds · type more letters to narrow · people who are off or booked that day are greyed out</div>
        </div>
      )}
    </div>
  );
}
