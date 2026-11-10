import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { addDays, isoDay, dLabel, startIso, endIso, bookingChange, roleName, ap12, ROLES } from './api';
import { AlsoWorking, otherShifts } from './alsoWorking';
import { locksBetween, NO_LOCKS, type Locks } from './locks';
import { AddressInput, type AddressParts } from '../components/AddressInput';
import { diff, norm, mtlHm, dateOf, sim, type Change, type DEvent, type DStaff, type SheetEvent } from './sheetDiff';

/**
 * Push 44 · Today → "Sheet changes": what the Events sheet says that the app doesn't (yet).
 * Push 52 · v2: filters (type · when · would send a message), grouped by event (Approve this event / Ignore),
 * "Approve quietly" (default ON, per device: the app changes, nobody gets anything), + Add as new staff, Pick venue.
 * Nothing changes in the app until Ronnie taps Approve.
 * Ignore = admin_archive (same key + signature as Needs you): the card comes back if that cell changes again.
 */
type Arch = { key: string; sig: string };
type AppEv = DEvent & { end_time: string | null };
type Kind = Change['kind'];
type VenueRow = { id: string; name: string; address: string | null; no_outside_food?: boolean; [k: string]: unknown };
const EV_COLS = 'id,event_date,title,department,address,venue_id,sheet_ref,end_time,manager_id,event_private(client),shifts(id,event_id,staff_id,position_code,planned_start,planned_end,status,attendance,notified_at,cancelled_at,punches(punch_in))';
const V_COLS = 'id,name,address,city,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items,no_outside_food';
const DAYS = 60;
const FOLD = 6; // lines shown per event before "+ n more"
const TAG: Record<Kind, [string, string]> = {
  added: ['ADDED', 'ok'], removed: ['REMOVED', 'red'], time: ['TIME', 'amber'], new_event: ['NEW EVENT', 'blue'], check_name: ['CHECK NAME', 'purple'],
};
const TYPES: [Kind | 'all', string][] = [['all', 'All'], ['added', 'Added'], ['removed', 'Removed'], ['time', 'Time'], ['new_event', 'New event'], ['check_name', 'Check name']];

/* ── Approve quietly (remembered per device, default ON) ── */
const QUIET_KEY = 'gr.sheetChanges.quiet';
const readQuiet = () => { try { return localStorage.getItem(QUIET_KEY) !== '0'; } catch { return true; } };
const saveQuiet = (on: boolean) => { try { localStorage.setItem(QUIET_KEY, on ? '1' : '0'); } catch { /* private mode */ } };

/* ── When: ranges from today (weeks Mon → Sun) ── */
type When = 'this' | 'next' | 'rest' | 'nextm';
function whenRanges(today: string) {
  const dow = new Date(today + 'T12:00:00').getDay(); // 0 = Sun
  const sun = addDays(today, (7 - dow) % 7);
  const [y, m] = today.split('-').map(Number);
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  const monthEnd = iso(y, m + 1, 0); const nmStart = iso(y, m + 1, 1); const nmEnd = iso(y, m + 2, 0);
  const mon = (d: string, o: Intl.DateTimeFormatOptions) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', o).replace(/\./g, '');
  const out: { k: When; label: string; from: string; to: string }[] = [
    { k: 'this', label: 'This week', from: today, to: sun },
    { k: 'next', label: 'Next week', from: addDays(sun, 1), to: addDays(sun, 7) },
  ];
  if (addDays(sun, 8) <= monthEnd) out.push({ k: 'rest', label: `Rest of ${mon(today, { month: 'short' })}`, from: addDays(sun, 8), to: monthEnd });
  const nmFrom = addDays(sun, 8) > nmStart ? addDays(sun, 8) : nmStart;
  out.push({ k: 'nextm', label: mon(nmStart, { month: 'long' }), from: nmFrom, to: nmEnd });
  return out;
}

export function SheetChanges({ arch, onArchived }: { arch: Arch[]; onArchived: () => void }) {
  const today = isoDay(new Date());
  const [data, setData] = useState<{ sheet: SheetEvent[]; app: AppEv[]; staff: DStaff[]; aliases: { alias: string; staff_id: string }[]; ran: string | null; venues: VenueRow[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState<string | null>(null); // bulk progress line
  const [locks, setLocks] = useState<Locks>(NO_LOCKS); // push 50 · padlock
  const [quiet, setQuietS] = useState(readQuiet);
  const [type, setType] = useState<Kind | 'all'>('all');
  const [when, setWhen] = useState<When | null>(null);
  const [msgOnly, setMsgOnly] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [venuePick, setVenuePick] = useState<Record<string, string>>({}); // new_event card key → venue id
  const [quietDb, setQuietDb] = useState(true); // false = migration 058 missing (time changes on confirmed shifts still show their gold box)
  const setQuiet = (on: boolean) => { setQuietS(on); saveQuiet(on); };

  useEffect(() => {
    (async () => {
      const to = addDays(today, DAYS);
      const [sh, ev, st, al, run, vs] = await Promise.all([
        supabase.from('sheet_events').select('id,event_date,department,title,venue,address,details,lines,staff,sheet_row').gte('event_date', today).lte('event_date', to).order('event_date'),
        supabase.from('events').select(EV_COLS).gte('event_date', today).lte('event_date', to),
        supabase.from('staff').select('id,full_name,nickname,active'),
        supabase.from('sheet_name_alias').select('alias,staff_id'),
        supabase.from('sheet_sync_runs').select('posted_at').order('posted_at', { ascending: false }).limit(1),
        supabase.from('venues').select(V_COLS).order('name'),
      ]);
      if (sh.error) { setErr(/does not exist|schema cache/i.test(sh.error.message) ? 'off' : sh.error.message); return; }
      if (ev.error) { setErr(ev.error.message); return; }
      setLocks(await locksBetween(today, to, (ev.data ?? []) as unknown as (DEvent & { manager_id: string | null })[]));
      setData({ sheet: (sh.data ?? []) as SheetEvent[], app: (ev.data ?? []) as unknown as AppEv[], staff: (st.data ?? []) as DStaff[],
        aliases: (al.data ?? []) as { alias: string; staff_id: string }[], ran: (run.data?.[0] as { posted_at: string } | undefined)?.posted_at ?? null,
        venues: (vs.data ?? []) as VenueRow[] });
    })();
  }, [tick, today]);

  const changes = useMemo(() => (data ? diff(data.sheet, data.app, data.staff, data.aliases) : []), [data]);
  const ranges = useMemo(() => whenRanges(today), [today]);
  const shown = useMemo(() => changes.filter((c) => !arch.some((a) => a.key === c.key && a.sig === c.sig)), [changes, arch]);

  if (err === 'off') return null; // migration 050 not applied yet
  if (err) return <div className="adm-card muted sm">Sheet changes: {err}</div>;
  if (!data || (!data.ran && !data.sheet.length)) return null; // sheet script not turned on yet

  const reload = () => setTick((t) => t + 1);
  const inWhen = (c: Change, k: When | null) => { if (!k) return true; const r = ranges.find((x) => x.k === k)!; const d = dateOf(c); return d >= r.from && d <= r.to; };
  const pT = (c: Change) => type === 'all' || c.kind === type;
  const pW = (c: Change) => inWhen(c, when);
  const pM = (c: Change) => !msgOnly || sends(c) > 0;
  const visible = shown.filter((c) => pT(c) && pW(c) && pM(c));
  const typeN = (k: Kind | 'all') => shown.filter((c) => (k === 'all' || c.kind === k) && pW(c) && pM(c)).length;
  const whenN = (k: When) => shown.filter((c) => pT(c) && inWhen(c, k) && pM(c)).length;
  const msgN = shown.filter((c) => pT(c) && pW(c) && sends(c) > 0).length;

  const ctx: Ctx = { app: data.app, staff: data.staff, venues: data.venues, quiet, venuePick, onQuietDb: setQuietDb };
  const ignore = async (list: Change[]) => {
    if (!list.length) return;
    await supabase.from('admin_archive').upsert(list.map((c) => ({ key: c.key, sig: c.sig, label: 'Sheet · ' + label(c), archived_at: new Date().toISOString() })));
    onArchived();
  };
  /** Approve a list: skips CHECK NAME and locked people (push 50), one confirm with what it sends. */
  const approveList = async (list0: Change[], what: string) => {
    const names = list0.filter((c) => c.kind === 'check_name').length;
    const lockedL = list0.filter((c) => c.kind !== 'check_name' && lockedOf(c, locks));
    const list = list0.filter((c) => c.kind !== 'check_name' && !lockedOf(c, locks));
    if (!list.length) { alert(names ? `Only CHECK NAME cards here: pick who they are or add them as new staff first.` : 'Nothing to approve here.'); return; }
    const skip = [lockedL.length ? `${lockedL.length} locked ${lockedL.length === 1 ? 'person is' : 'people are'} skipped (approve one by one).` : '', names ? `${names} CHECK NAME skipped.` : ''].filter(Boolean).join('\n');
    if (!confirm(`Approve ${list.length} sheet change${list.length === 1 ? '' : 's'}${what}?${skip ? '\n\n' + skip : ''}\n\n${quiet ? 'Quietly: the app is updated, nobody gets a message or alert.' : sendsLine(list)}`)) return;
    let k = 0;
    try { for (const c of list) { setBusy(`Approving ${++k} of ${list.length}…`); await approve(c, ctx); } } catch (e) { alert((e as Error).message); }
    setBusy(null); reload();
  };
  const ignoreList = async (list0: Change[], what: string) => {
    const list = list0.filter((c) => c.kind !== 'check_name');
    const names = list0.length - list.length;
    if (!list.length) return;
    if (!confirm(`Ignore ${list.length} sheet change${list.length === 1 ? '' : 's'}${what}?${names ? `\n\n${names} CHECK NAME kept (pick who they are or add them as new staff).` : ''}\n\nThey come back if that line of the sheet changes again.`)) return;
    await ignore(list);
  };
  /** + Add all n missing as new staff (visible CHECK NAME cards, one person per name). */
  const missing = visible.filter((c): c is Extract<Change, { kind: 'check_name' }> => c.kind === 'check_name');
  const uniqMissing = [...new Map(missing.map((c) => [norm(c.name), c])).values()];
  const addAllMissing = async () => {
    if (!uniqMissing.length) return;
    if (!confirm(`Add ${uniqMissing.length} new staff (active, no invite sent)?\n\n${uniqMissing.map((c) => `· ${niceName(c.name)} · ${roleName(c.code)}`).join('\n')}${quiet ? '\n\nQuietly: they are also booked on their events, nobody gets a message.' : '\n\nTheir lines then show as ADDED, ready to approve.'}`)) return;
    let k = 0;
    try {
      for (const c of uniqMissing) {
        setBusy(`Adding ${++k} of ${uniqMissing.length}…`);
        const id = await addStaff(niceName(c.name), c, data.staff);
        if (quiet) for (const x of missing.filter((m) => norm(m.name) === norm(c.name))) await bookNew(x, id, ctx);
      }
    } catch (e) { alert((e as Error).message); }
    setBusy(null); reload();
  };

  // grouped by event, date order
  const groups: { key: string; title: string; date: string; e: AppEv | null; cards: Change[] }[] = [];
  for (const c of visible) {
    const e = ('e' in c && c.e ? c.e : null) as AppEv | null;
    const key = e ? 'e:' + e.id : 'se:' + (c as { se: SheetEvent }).se.id;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push(g = { key, title: e ? e.title : venueName((c as { se: SheetEvent }).se), date: dateOf(c), e, cards: [] });
    g.cards.push(c);
  }
  groups.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const allN = visible.filter((c) => c.kind !== 'check_name' && !lockedOf(c, locks)).length;
  const ago = data.ran ? Math.max(0, Math.round((Date.now() - new Date(data.ran).getTime()) / 60000)) : null;

  return (
    <div className="sc2">
      <div className="sc2-head">
        <span className="serif sc2-title">Sheet changes</span>
        <span className="muted sm">{shown.length}{ago !== null ? ` · checked ${ago < 1 ? 'just now' : ago + ' min ago'}` : ''}</span>
        <span className="grow" />
        <div className="sc2-quiet">
          <span className="sm"><b>Approve quietly</b> · {quiet ? 'nobody gets a message' : 'people with confirmations sent get a message'}</span>
          <button type="button" role="switch" aria-checked={quiet} aria-label="Approve quietly" className={'sw' + (quiet ? ' on' : '')} onClick={() => setQuiet(!quiet)}><span className="sw-track"><span className="sw-knob" /></span></button>
        </div>
        <button className="abtn dark" disabled={!!busy || !allN} onClick={() => approveList(visible, ' (all shown)')}>{busy ?? `Approve all shown · ${allN}`}</button>
      </div>
      {!quietDb && quiet && <div className="sc-locked sc2-warn" role="note">Run migration 058 so start-time changes on confirmed shifts stay quiet too (their Home still shows "Your shift changed").</div>}
      <div className="sc2-filters">
        <span className="sc2-lbl">TYPE</span>
        {TYPES.map(([k, l]) => <button key={k} className={'sc2-chip' + (type === k ? ' on' : '')} onClick={() => setType(k)}>{l} {typeN(k)}</button>)}
        <span className="sc2-lbl">WHEN</span>
        {ranges.map((r) => <button key={r.k} className={'sc2-chip' + (when === r.k ? ' on' : '')} onClick={() => setWhen(when === r.k ? null : r.k)}>{r.label}<small> {whenN(r.k)}</small></button>)}
        <button className={'sc2-chip' + (msgOnly ? ' on' : '')} onClick={() => setMsgOnly(!msgOnly)}>Would send a message · {msgN}</button>
      </div>
      {uniqMissing.length > 0 && (
        <div className="sc2-missing"><span className="sm"><b>{uniqMissing.length}</b> name{uniqMissing.length === 1 ? '' : 's'} not in the app{missing.length > uniqMissing.length ? ` (${missing.length} lines)` : ''}</span>
          <button className="abtn sm green" disabled={!!busy} onClick={addAllMissing}>+ Add all {uniqMissing.length} missing as new staff</button></div>
      )}
      {!shown.length && <div className="adm-card muted sm" style={{ padding: 14 }}>The app matches the Events sheet.</div>}
      {shown.length > 0 && !visible.length && <div className="adm-card muted sm" style={{ padding: 14 }}>Nothing matches these filters.</div>}
      {groups.map((g, i) => {
        const isOpen = open[g.key] ?? i === 0;
        const nNames = g.cards.filter((c) => c.kind === 'check_name').length;
        const ne = g.cards.find((c) => c.kind === 'new_event') as Extract<Change, { kind: 'new_event' }> | undefined;
        return (
          <div key={g.key} className="adm-card sc2-ev">
            <div className="sc2-evh">
              <button className="sc2-fold" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.key]: !isOpen })}>
                <span className="sc2-caret">{isOpen ? '▾' : '▸'}</span><b>{g.title} · {dLabel(g.date)}</b>
                <span className="muted sm">{ne ? `new event · ${ne.staff.length + ne.unmatched.length} names` : `${g.cards.length} change${g.cards.length === 1 ? '' : 's'}`}</span>
                {g.e && sent(g.e) && <span className="sc2-tag gold">CONFIRMATIONS SENT</span>}
                {nNames > 0 && <span className="sc2-tag gold">{nNames} CHECK NAME</span>}
                {ne && <span className="sc2-tag green">NEW EVENT</span>}
              </button>
              <span className="grow" />
              {g.e && <Link className="sm muted" to={`/admin/event/${g.e.id}`}>Event ›</Link>}
              <button className="abtn sm dark" disabled={!!busy} onClick={() => approveList(g.cards, ` · ${g.title} · ${dLabel(g.date)}`)}>Approve this event</button>
              <button className="abtn sm" disabled={!!busy} onClick={() => ignoreList(g.cards, ` · ${g.title}`)}>Ignore</button>
            </div>
            {isOpen && <Lines cards={g.cards} ctx={ctx} locks={locks} onDone={reload} onIgnore={(c) => ignore([c])}
              onVenue={(k, id) => setVenuePick({ ...venuePick, [k]: id })} onVenueSaved={(v) => setData({ ...data, venues: [...data.venues, v] })} />}
          </div>
        );
      })}
      <div className="muted sm sc2-foot">Events sheet · next {DAYS} days. Nothing changes in the app until you approve.{quiet ? ' Approve quietly is on: confirmations still go out by text.' : ''}</div>
    </div>
  );
}

function Lines({ cards, ctx, locks, onDone, onIgnore, onVenue, onVenueSaved }: { cards: Change[]; ctx: Ctx; locks: Locks; onDone: () => void; onIgnore: (c: Change) => void;
  onVenue: (cardKey: string, id: string) => void; onVenueSaved: (v: VenueRow) => void }) {
  const [more, setMore] = useState(false);
  const list = more ? cards : cards.slice(0, FOLD);
  return (
    <div className="sc2-lines">
      {list.map((c) => c.kind === 'new_event'
        ? <NewEvent key={c.key} c={c} ctx={ctx} onDone={onDone} onIgnore={() => onIgnore(c)} onVenue={(id) => onVenue(c.key, id)} onVenueSaved={onVenueSaved} />
        : <Line key={c.key} c={c} ctx={ctx} locked={lockedOf(c, locks)} onDone={onDone} onIgnore={() => onIgnore(c)} />)}
      {cards.length > FOLD && <button className="sc2-more" onClick={() => setMore(!more)}>{more ? '▴ Show less' : `+ ${cards.length - FOLD} more ▾`}</button>}
    </div>
  );
}

function Line({ c, ctx, locked, onDone, onIgnore }: { c: Change; ctx: Ctx; locked: { title: string } | null; onDone: () => void; onIgnore: () => void }) {
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(c.kind === 'check_name' ? c.suggest[0]?.id ?? '' : '');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState(c.kind === 'check_name' ? niceName(c.name) : '');
  const [tag, cls] = TAG[c.kind];
  const msg = !ctx.quiet && sends(c) > 0;
  let what: React.ReactNode = null; const sub: string[] = []; let btn = 'Approve';
  if (c.kind === 'added') {
    what = <><b>{c.name}</b> · {roleName(c.code)} · {ap12(c.start)}</>;
    if (c.from) { sub.push(`moves from ${c.from.e.title} (${ap12(mtlHm(c.from.s.planned_start))})`); btn = 'Approve move'; }
  } else if (c.kind === 'removed') {
    what = <><b>{c.name}</b> · not in the sheet any more</>;
  } else if (c.kind === 'time') {
    what = <>Start <s className="muted">{ap12(c.old)}</s> → <b>{ap12(c.new)}</b> · {c.people.slice(0, 4).map((p) => p.name.split(' ')[0]).join(', ')}{c.people.length > 4 ? ` +${c.people.length - 4}` : ''}</>;
  } else if (c.kind === 'check_name') {
    what = <>"{c.name}" · {roleName(c.code)}{c.start ? ' · ' + ap12(c.start) : ''} · <span className="muted">not in the app</span></>;
  }
  if (msg) sub.push(c.kind === 'time' ? `${c.people.length} get "Your start changed"` : c.kind === 'removed' ? 'gets "You\'re no longer on…"' : 'gets a message');
  const go = async () => {
    if (c.kind === 'check_name' && !pick) return;
    if (locked && 'name' in c && !confirm(`${c.name} is locked on ${locked.title}. ${c.kind === 'removed' ? 'Remove' : 'Move'} anyway?`)) return;
    setBusy(true);
    try { await approve(c, ctx, pick); onDone(); } catch (e) { alert((e as Error).message); setBusy(false); }
  };
  const addNew = async () => {
    if (c.kind !== 'check_name' || !newName.trim()) return;
    setBusy(true);
    try { const id = await addStaff(newName.trim(), c, ctx.staff); if (ctx.quiet) await bookNew(c, id, ctx); onDone(); } catch (e) { alert((e as Error).message); setBusy(false); }
  };
  return (
    <div className="sc2-line">
      <div className="sc2-row">
        <span className={'sc-tag ' + cls}>{tag}</span>
        <span className="sc2-what">{what}{sub.length > 0 && <small className="muted"> · {sub.join(' · ')}</small>}{locked && <small className="sc2-lock"> · 🔒 locked{c.kind === 'added' ? ` on ${locked.title}` : ''} · Approve all skips this</small>}</span>
        <span className="grow" />
        {c.kind === 'check_name' ? <>
          <select className="sc-pick" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Who is this?">
            <option value="">Who is this? ▾</option>
            {c.suggest.length > 0 && <optgroup label="Best matches">{c.suggest.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</optgroup>}
            <optgroup label="Everyone">{ctx.staff.filter((s) => s.active).sort((a, b) => a.full_name.localeCompare(b.full_name)).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</optgroup>
          </select>
          {pick && <button className="sc2-a strong" disabled={busy} onClick={go}>{busy ? 'Saving…' : `Use ${ctx.staff.find((s) => s.id === pick)?.full_name.split(' ')[0] ?? ''}`}</button>}
          <button className="abtn sm green" disabled={busy} onClick={() => setAdding(!adding)}>+ Add as new staff</button>
        </> : <button className="sc2-a strong" disabled={busy} onClick={go}>{busy ? 'Saving…' : btn}</button>}
        <button className="sc2-a muted" disabled={busy} onClick={onIgnore}>Ignore</button>
      </div>
      {c.kind === 'added' && <AlsoWorking compact others={otherShifts(ctx.app, c.staffId, c.e.id, c.e.event_date).filter((o) => !c.from || o.start !== c.from.s.planned_start)} start={startIso(c.e.event_date, c.start)} />}
      {adding && c.kind === 'check_name' && (
        <div className="sc2-add">
          <label className="sm">Full name <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Full name" /></label>
          <span className="sm muted">{roleName(c.code)} · {c.se.department === 'bar' ? 'Bar' : 'Floor'} · active · no invite sent</span>
          <button className="abtn sm green" disabled={busy || !newName.trim()} onClick={addNew}>{busy ? 'Adding…' : ctx.quiet && c.e ? 'Add and book quietly' : 'Add'}</button>
          <button className="sc2-a muted" onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

const SYN = /synagog|congregation|chabad|shaar|temple/i;
function NewEvent({ c, ctx, onDone, onIgnore, onVenue, onVenueSaved }: { c: Extract<Change, { kind: 'new_event' }>; ctx: Ctx; onDone: () => void; onIgnore: () => void;
  onVenue: (id: string) => void; onVenueSaved: (v: VenueRow) => void }) {
  const se = c.se;
  const auto = autoVenue(se, ctx.venues);
  const chosen = ctx.venues.find((v) => v.id === (ctx.venuePick[c.key] ?? auto?.id)) ?? null;
  const [q, setQ] = useState(venueName(se));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const raw = se.venue ? `Venue: ${se.venue}` : se.details.find((d) => /venue|location|address/i.test(d)) ?? se.title;
  const matches = q.trim().length < 2 ? [] : ctx.venues
    .map((v) => ({ v, s: Math.max(sim(q, v.name), norm(v.name).includes(norm(q)) || norm(q).includes(norm(v.name)) ? 0.9 : 0) }))
    .filter((x) => x.s > 0.25).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.v);
  const total = se.lines.reduce((n, l) => n + l.count, 0);
  const go = async () => { setBusy(true); try { await approve(c, ctx); onDone(); } catch (e) { alert((e as Error).message); setBusy(false); } };
  return (
    <div className="sc2-line sc2-new">
      <div className="sc2-row">
        <span className="sc2-tag green">NEW EVENT</span>
        <span className="sc2-what">From the sheet: <b>“{raw.length > 70 ? raw.slice(0, 70) + '…' : raw}”</b>
          <small className="muted"> · {total || se.staff.length} {se.department === 'bar' ? 'bar' : 'floor'} · {c.staff.length} name{c.staff.length === 1 ? '' : 's'} found{c.unmatched.length ? `, ${c.unmatched.length} to check` : ''}</small></span>
        <span className="grow" />
        <button className="sc2-a strong" disabled={busy} onClick={go}>{busy ? 'Creating…' : 'Create event'}</button>
        <button className="sc2-a muted" disabled={busy} onClick={onIgnore}>Ignore</button>
      </div>
      <div className="sc2-venue">
        <span className="sc2-vl muted">Venue</span>
        <div className="sc2-vbox">
          {chosen && !creating && <div className="sc2-vchosen">✓ <b>{chosen.name}</b>{chosen.address ? <span className="muted"> · {chosen.address}</span> : null}{chosen.no_outside_food ? <span className="muted"> · no outside food</span> : null}</div>}
          <input className="sc2-vq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your venues…" aria-label="Search your venues" />
          {matches.map((v) => <button key={v.id} className={'sc2-vopt' + (chosen?.id === v.id ? ' on' : '')} onClick={() => { onVenue(v.id); setCreating(false); }}><b>{v.name}</b>{v.address ? <span className="muted"> · {v.address}</span> : null}</button>)}
          {!matches.length && <div className="muted sm sc2-vnone">Not in your venues</div>}
          {!creating
            ? <button className="sc2-vopt" onClick={() => setCreating(true)}><b>+ New venue</b>{q.trim() ? <> · <span className="muted">“{q.trim()}”</span></> : null}</button>
            : <NewVenue name={q.trim() || venueName(se)} address={addrGuess(se)} onCancel={() => setCreating(false)} onSaved={(v) => { onVenueSaved(v); onVenue(v.id); setCreating(false); }} />}
        </div>
      </div>
      <div className="muted sm sc2-vnote">Picking a Google result saves the venue (address, city, postal code) for next time. Synagogues / Chabad get the No outside food switch on.</div>
    </div>
  );
}

function NewVenue({ name: name0, address: addr0, onCancel, onSaved }: { name: string; address: string; onCancel: () => void; onSaved: (v: VenueRow) => void }) {
  const [name, setName] = useState(name0);
  const [address, setAddress] = useState(addr0);
  const [parts, setParts] = useState<AddressParts | null>(null);
  const [noFood, setNoFood] = useState<boolean | null>(null); // null = follows the name
  const food = noFood ?? SYN.test(name);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return setErr('Give the venue a name (what staff see).');
    setBusy(true); setErr('');
    const row: Record<string, unknown> = { name: name.trim(), address: address.trim() || null, no_outside_food: food,
      ...(parts ? { street: parts.street, unit: parts.unit || null, city: parts.city, province: parts.province, postal_code: parts.postal_code } : {}) };
    let r = await supabase.from('venues').insert(row).select(V_COLS).single();
    if (r.error && /no_outside_food/.test(r.error.message)) { delete row.no_outside_food; r = await supabase.from('venues').insert(row).select(V_COLS.replace(',no_outside_food', '')).single(); } // 051 not applied
    setBusy(false);
    if (r.error) return setErr(/duplicate|unique/i.test(r.error.message) ? `There is already a venue called “${name.trim()}”: search for it above.` : r.error.message);
    onSaved(r.data as unknown as VenueRow);
  };
  return (
    <div className="sc2-nv">
      <label className="sm">Name <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Venue name" /></label>
      <div className="sm sc2-nv-a"><span>Address · Google</span><AddressInput value={address} onChange={(v) => { setAddress(v); setParts(null); }} onPick={setParts} autoSearch placeholder="Start typing the address…" /></div>
      <div className="sc2-nv-row">
        <button type="button" role="switch" aria-checked={food} className={'sw' + (food ? ' on' : '')} onClick={() => setNoFood(!food)}><span className="sw-track"><span className="sw-knob" /></span><span className="sw-lbl">{food ? 'ON' : 'OFF'}</span></button>
        <span className="sm"><b>No outside food</b> <span className="muted">· synagogues / Chabad</span></span>
        <span className="grow" />
        <button className="sc2-a muted" onClick={onCancel}>Cancel</button>
        <button className="abtn sm green" disabled={busy} onClick={save}>{busy ? 'Saving…' : parts ? 'Save venue' : 'Save venue (no Google pick)'}</button>
      </div>
      {err && <div className="error sm">{err}</div>}
    </div>
  );
}

/* ── helpers ── */
type Ctx = { app: AppEv[]; staff: DStaff[]; venues: VenueRow[]; quiet: boolean; venuePick: Record<string, string>; onQuietDb: (ok: boolean) => void };

function label(c: Change) {
  const ev = 'e' in c && c.e ? c.e.title : venueName((c as { se: SheetEvent }).se);
  const d = dLabel(dateOf(c));
  if (c.kind === 'added') return `${c.name} added · ${ev} · ${d}`;
  if (c.kind === 'removed') return `${c.name} removed · ${ev} · ${d}`;
  if (c.kind === 'time') return `Start ${ap12(c.old)} → ${ap12(c.new)} · ${ev} · ${d}`;
  if (c.kind === 'new_event') return `New event · ${ev} · ${d}`;
  return `"${c.name}" · ${ev} · ${d}`;
}
/** "Congregation Sepharade: 5700 Av. Einstein" → "Congregation Sepharade" */
const venueName = (se: SheetEvent) => (se.venue ? se.venue.split(/\s*[:,]\s*/)[0] : '') || se.title;
const addrGuess = (se: SheetEvent) => {
  if (se.address) return se.address;
  const rest = se.venue?.split(/\s*:\s*/).slice(1).join(' ').trim();
  return [venueName(se), rest].filter(Boolean).join(' ');
};
/** ALL CAPS sheet names → "Colombe Broudehoux"; mixed case is kept as typed. */
export const niceName = (n: string) => {
  const t = n.trim().replace(/\s+/g, ' ');
  return t === t.toUpperCase() ? t.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()) : t;
};

const sent = (e: DEvent) => e.shifts.some((s) => s.notified_at);
/** push 50 · the locked shift this change would remove or move (removed · added as a move from another event), or null. */
function lockedOf(c: Change, locks: Locks): { title: string } | null {
  if (c.kind === 'removed' && locks.ids.has(c.s.id)) return { title: c.e.title };
  if (c.kind === 'added' && c.from && locks.ids.has(c.from.s.id)) return { title: c.from.e.title };
  return null;
}
/** How many people approving this sends a message to when Approve quietly is off (same rules as the rest of the app). */
function sends(c: Change) {
  if (c.kind === 'added') return sent(c.e) || (c.from && sent(c.from.e)) ? 1 : 0;
  if (c.kind === 'removed') return sent(c.e) ? 1 : 0;
  if (c.kind === 'time') return sent(c.e) ? c.people.length : 0;
  return 0;
}
const sendsLine = (list: Change[]) => { const n = list.reduce((k, c) => k + sends(c), 0); return n ? `This sends ${n} ${n === 1 ? 'person' : 'people'} a message.` : 'Confirmations not sent yet → nobody gets a message.'; };

const evRef = (e: DEvent, sentNow: boolean, start: string) => ({ id: e.id, event_date: e.event_date, title: e.title, sent: sentNow, start: startIso(e.event_date, start) });

/** Update a shift. Quiet → admin_sheet_quiet_update (058: no "Your shift changed" gold box); without 058 → a plain update. */
async function updShift(id: string, patch: Record<string, unknown>, ctx: Ctx) {
  if (ctx.quiet) {
    const r = await supabase.rpc('admin_sheet_quiet_update', { p_shift: id, p_patch: patch });
    if (!r.error) return;
    if (!/admin_sheet_quiet_update|schema cache|function/i.test(r.error.message) || /no longer|not allowed/.test(r.error.message)) throw r.error;
    ctx.onQuietDb(false);
  }
  const up = await supabase.from('shifts').update(patch).eq('id', id);
  if (up.error) throw up.error;
}

/** Apply one sheet change through the same helpers the event form uses (change_log; alerts only when confirmations went out and not quiet). */
async function approve(c: Change, ctx: Ctx, pick?: string) {
  const { app, quiet } = ctx;
  if (c.kind === 'added') {
    const label = ROLES.find((r) => r.code === c.code)?.label ?? c.code;
    const end = (app.find((e) => e.id === c.e.id)?.end_time ?? null);
    const row = { event_id: c.e.id, position_code: c.code, position_detail: label, planned_start: startIso(c.e.event_date, c.start), planned_end: endIso(c.e.event_date, c.start, end), status: 'booked' };
    if (c.from) {
      await updShift(c.from.s.id, row, ctx);
      await bookingChange('moved', { staff_id: c.staffId, shift_id: c.from.s.id, from: evRef(c.from.e, sent(c.from.e), mtlHm(c.from.s.planned_start)), to: evRef(c.e, sent(c.e), c.start), quiet });
    } else {
      const ins = await supabase.from('shifts').insert({ ...row, staff_id: c.staffId }).select('id').single();
      if (ins.error) throw ins.error;
      await bookingChange('booked', { staff_id: c.staffId, shift_id: ins.data.id, to: evRef(c.e, sent(c.e), c.start), quiet });
    }
  } else if (c.kind === 'removed') {
    if (c.s.punches?.punch_in) throw new Error(`${c.name} already started; not removed.`);
    const del = await supabase.from('shifts').delete().eq('id', c.s.id);
    if (del.error) throw del.error;
    await bookingChange('removed', { staff_id: c.s.staff_id, shift_id: c.s.id, from: evRef(c.e, sent(c.e), mtlHm(c.s.planned_start)), quiet });
  } else if (c.kind === 'time') {
    const end = app.find((e) => e.id === c.e.id)?.end_time ?? null;
    for (const p of c.people) {
      await updShift(p.s.id, { planned_start: startIso(c.e.event_date, c.new), planned_end: endIso(c.e.event_date, c.new, end) }, ctx);
      await bookingChange('moved', { staff_id: p.s.staff_id, shift_id: p.s.id, from: evRef(c.e, sent(c.e), c.old), to: evRef(c.e, sent(c.e), c.new), quiet });
    }
  } else if (c.kind === 'new_event') {
    const se = c.se;
    // push 52 · the venue picked on the card (Pick venue / + New venue), else the closest existing one (push 44)
    const venue = ctx.venues.find((v) => v.id === ctx.venuePick[c.key]) ?? autoVenue(se, ctx.venues);
    const lines = se.lines.filter((l) => l.count > 0);
    const start = lines.map((l) => l.start).filter(Boolean).sort()[0] ?? c.staff.map((s) => s.start).filter(Boolean).sort()[0] ?? '17:00';
    const lead = c.staff.find((s) => s.code === (se.department === 'bar' ? 'BM' : 'MD'));
    const uni = venue ? Object.fromEntries(['uniform_floor', 'uniform_bar', 'uniform_floor_w', 'uniform_bar_w', 'uniform_items'].filter((k) => venue[k] != null).map((k) => [k, venue[k]])) : {};
    const row = {
      event_date: se.event_date, title: venue?.name ?? (venueName(se) || 'Details to come'), venue_id: venue?.id ?? null, address: se.address || venue?.address || null,
      department: se.department, start_time: start, staff_needed: lines.reduce((n, l) => n + l.count, 0) || c.staff.length,
      manager_id: lead?.staffId ?? null, staffing: lines.map((l) => ({ dept: se.department, code: l.code, start: l.start ?? start, end: null, count: l.count })),
      sheet_ref: se.sheet_row ? `EVENTS!A${se.sheet_row}` : null, ...uni,
    };
    const ins = await supabase.from('events').insert(row).select('id').single();
    if (ins.error) throw ins.error;
    const id = ins.data.id as string;
    await supabase.from('event_private').upsert({ event_id: id, client: se.title }, { onConflict: 'event_id' });
    for (const s of c.staff) {
      const st = s.start ?? start; const label = ROLES.find((r) => r.code === s.code)?.label ?? s.code;
      const sh = await supabase.from('shifts').insert({ event_id: id, staff_id: s.staffId, position_code: s.code, position_detail: label, planned_start: startIso(se.event_date, st), status: 'booked' }).select('id').single();
      if (sh.error) throw sh.error;
      await bookingChange('booked', { staff_id: s.staffId, shift_id: sh.data.id, to: { id, event_date: se.event_date, title: row.title, sent: false, start: startIso(se.event_date, st) }, quiet });
    }
  } else if (c.kind === 'check_name' && pick) {
    const r = await supabase.from('sheet_name_alias').upsert({ alias: norm(c.name), staff_id: pick });
    if (r.error) throw r.error;
  }
}

function autoVenue(se: SheetEvent, venues: VenueRow[]) {
  return venues.map((v) => ({ v, s: Math.max(simWords(se.venue, v.name), simWords(venueName(se), v.name), simWords(se.title, v.name)) })).sort((a, b) => b.s - a.s).find((x) => x.s >= 0.5)?.v ?? null;
}

/**
 * push 52 · + Add as new staff: the same row Admin → Staff "add" saves (active, no login / invite), then the sheet name
 * as an alias so the next diff matches it. Someone with the same full name already in the app is reused (no duplicate).
 */
async function addStaff(fullName: string, c: Extract<Change, { kind: 'check_name' }>, staff: DStaff[]) {
  const same = staff.find((s) => norm(s.full_name) === norm(fullName));
  let id = same?.id;
  if (!id) {
    const pos = roleName(c.code).toUpperCase();
    const ins = await supabase.from('staff').insert({ full_name: fullName, email: null, phone: null, language: 'fr', department: c.se.department === 'bar' ? 'bar' : 'floor', role: 'staff', active: true, positions: pos ? [pos] : [] }).select('id').single();
    if (ins.error) throw ins.error;
    id = ins.data.id as string;
    await supabase.from('staff_private').upsert({ staff_id: id, ranking: null, notes: null });
    staff.push({ id, full_name: fullName, nickname: null, active: true }); // dedupe within one "Add all"
  }
  const al = await supabase.from('sheet_name_alias').upsert({ alias: norm(c.name), staff_id: id });
  if (al.error) throw al.error;
  return id;
}

/** Quiet on: book the new person on the event their sheet line is on (new events pick them up when created). */
async function bookNew(c: Extract<Change, { kind: 'check_name' }>, staffId: string, ctx: Ctx) {
  if (!c.e) return;
  const live = c.e.shifts.find((s) => s.status !== 'declined' && !s.attendance);
  if (c.e.shifts.some((s) => s.staff_id === staffId && s.status !== 'declined' && !s.attendance)) return;
  const start = c.start ?? (live ? mtlHm(live.planned_start) : '17:00');
  await approve({ kind: 'added', key: '', sig: '', e: c.e, staffId, name: c.name, code: c.code, start }, ctx);
}

const simWords = (a: string | null | undefined, b: string | null | undefined) => {
  const A = norm(a).split(' ').filter((t) => t.length > 2); const B = norm(b).split(' ').filter((t) => t.length > 2);
  if (!A.length || !B.length) return 0;
  return A.filter((x) => B.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))).length / Math.max(A.length, B.length);
};
