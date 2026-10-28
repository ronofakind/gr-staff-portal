import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { allStaff, eventsBetween, isoDay, startIso, type AEvent, type AStaff } from './api';
import { ampm } from '../pages/Availability';

type Tier = 'A' | 'B' | 'C';
type Ask = { id: string; for_date: string; department: string; label: string; approx_start: string | null; staff_needed: number; tiers_sent: Tier[]; created_at: string };
type Row = { id: string; staff_id: string; for_date: string; status: string; tier: string | null; from_time: string | null; until_time: string | null; ask_id: string | null };
type Weekly = { staff_id: string; dow: number; status: 'yes' | 'from' | 'no'; from_time: string | null };
type Off = { staff_id: string; from_date: string; to_date: string; reason: string | null };

const TIERS: Tier[] = ['A', 'B', 'C'];
export const tiersFor = (n: number): Tier[] => (n <= 8 ? ['A'] : n <= 20 ? ['A', 'B'] : ['A', 'B', 'C']);
const D = (iso: string) => new Date(iso + 'T12:00:00');
const dow = (iso: string) => (D(iso).getDay() + 6) % 7;
const fmt = (iso: string) => D(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');

export function Availability() {
  const [month, setMonth] = useState(isoDay(new Date()).slice(0, 8) + '01');
  const [events, setEvents] = useState<AEvent[]>([]);
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [off, setOff] = useState<Off[]>([]);
  const [asks, setAsks] = useState<Ask[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [aEvents, setAEvents] = useState<AEvent[]>([]);
  const [sel, setSel] = useState<Record<string, Tier[]>>({});
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const today = isoDay(new Date());

  const first = D(month); const last = isoDay(new Date(first.getFullYear(), first.getMonth() + 1, 0));
  const load = async () => {
    const [ev, st, w, o, a, r, x] = await Promise.all([
      eventsBetween(month, last), staff.length ? Promise.resolve(staff) : allStaff(),
      supabase.from('staff_weekly').select('staff_id,dow,status,from_time'),
      supabase.from('days_off').select('staff_id,from_date,to_date,reason').gte('to_date', today),
      supabase.from('avail_asks').select('*').gte('for_date', today).order('for_date'),
      supabase.from('availability').select('id,staff_id,for_date,status,tier,from_time,until_time,ask_id').not('ask_id', 'is', null).gte('for_date', today),
      supabase.from('avail_exceptions').select('staff_id,for_date').gte('for_date', today),
    ]);
    setOpened(new Set(((x.data ?? []) as { staff_id: string; for_date: string }[]).map((e) => `${e.staff_id}|${e.for_date}`)));
    setEvents(ev.filter((e) => e.department !== 'bar')); setStaff(st);
    setWeekly((w.data ?? []) as Weekly[]); setOff((o.data ?? []) as Off[]);
    const as = (a.data ?? []) as Ask[];
    setAsks(as); setRows((r.data ?? []) as Row[]);
    if (as.length) setAEvents((await eventsBetween(as[0].for_date, as[as.length - 1].for_date)).filter((e) => e.department !== 'bar'));
  };
  useEffect(() => { load(); }, [month]);

  const byDate = useMemo(() => { const m: Record<string, AEvent[]> = {}; for (const e of events) (m[e.event_date] ??= []).push(e); return m; }, [events]);
  const need = (d: string) => (byDate[d] ?? []).reduce((n, e) => n + e.staff_needed, 0);
  const startOf = (d: string) => (byDate[d] ?? []).map((e) => e.start_time).filter(Boolean).sort()[0] ?? null;
  const askFor = (d: string) => asks.find((a) => a.for_date === d && a.department === 'floor');
  const floor = staff.filter((s) => s.active && s.department !== 'bar');
  const tierOf = (s: AStaff) => s.staff_private?.tier ?? null;
  const rank = (s: AStaff) => s.staff_private?.ranking ?? 9999;

  /** Why someone is skipped automatically for a date (or null). */
  const skipWhy = (s: AStaff, d: string) => {
    const o = off.find((x) => x.staff_id === s.id && x.from_date <= d && x.to_date >= d);
    if (o) return `Day off${o.reason ? ` (${o.reason})` : ''}`;
    const w = weekly.find((x) => x.staff_id === s.id && x.dow === dow(d));
    if (w?.status === 'no' && !opened.has(`${s.id}|${d}`)) return `Not on ${D(d).toLocaleDateString('en-CA', { weekday: 'long' })}s`;
    return null;
  };
  const freeFrom = (s: AStaff, d: string) => { const w = weekly.find((x) => x.staff_id === s.id && x.dow === dow(d)); return w?.status === 'from' ? w.from_time : null; };
  const alreadyAsked = (s: AStaff, d: string) => rows.some((r) => r.staff_id === s.id && r.for_date === d);
  const recipients = (d: string, tiers: Tier[]) => floor
    .filter((s) => tierOf(s) && tiers.includes(tierOf(s)!) && !alreadyAsked(s, d))
    .filter((s) => !skipWhy(s, d) || include.has(`${s.id}|${d}`));
  const skipped = (d: string, tiers: Tier[]) => floor.filter((s) => tierOf(s) && tiers.includes(tierOf(s)!) && !alreadyAsked(s, d) && skipWhy(s, d) && !include.has(`${s.id}|${d}`));

  const selDates = Object.keys(sel).sort();
  const total = new Set(selDates.flatMap((d) => recipients(d, sel[d]).map((s) => s.id)));
  const perTier = TIERS.map((t) => new Set(selDates.flatMap((d) => recipients(d, sel[d]).filter((s) => tierOf(s) === t).map((s) => s.id))).size);

  const toggle = (d: string) => {
    if (d < today) return;
    const next = { ...sel }; if (next[d]) delete next[d]; else next[d] = tiersFor(need(d) || 1); setSel(next);
  };
  const setTiers = (d: string, t: Tier) => {
    const cur = sel[d]; const i = TIERS.indexOf(t);
    setSel({ ...sel, [d]: cur.length === i + 1 && cur[i] === t ? TIERS.slice(0, Math.max(1, i)) : TIERS.slice(0, i + 1) });
  };

  /** Create/extend the ask for each date and add one "asked" row per person. */
  const send = async (dates: { d: string; tiers: Tier[] }[]) => {
    setBusy(true); setErr(''); setMsg('');
    let n = 0;
    for (const { d, tiers } of dates) {
      const existing = askFor(d);
      const label = (byDate[d] ?? []).length === 1 ? 'Evening event' : (byDate[d] ?? []).length > 1 ? `${byDate[d].length} events` : 'Event';
      const { data: ask, error } = await supabase.from('avail_asks').upsert({
        for_date: d, department: 'floor', label, approx_start: startOf(d), staff_needed: need(d),
        tiers_sent: Array.from(new Set([...(existing?.tiers_sent ?? []), ...tiers])).sort(), reply_by: null,
      }, { onConflict: 'for_date,department' }).select('id').single();
      if (error || !ask) { setErr(error?.message ?? 'Could not save'); break; }
      const people = recipients(d, tiers);
      if (people.length) {
        const { error: e2 } = await supabase.from('availability').upsert(people.map((s) => ({
          staff_id: s.id, for_date: d, part: 'evening', status: 'asked', ask_id: ask.id, tier: tierOf(s), asked_at: new Date().toISOString(),
        })), { onConflict: 'staff_id,for_date,part' });
        if (e2) { setErr(e2.message); break; }
        n += people.length;
      }
    }
    setBusy(false); setSel({}); setMsg(`${n} people asked. They see it in the app under Availability.`); load();
  };
  const nextTier = (a: Ask) => { const nt = TIERS.find((t) => !a.tiers_sent.includes(t)); if (nt) send([{ d: a.for_date, tiers: [nt] }]); };
  const book = async (r: Row, e: AEvent) => {
    setErr('');
    const { error } = await supabase.from('shifts').insert({ event_id: e.id, staff_id: r.staff_id, planned_start: startIso(e.event_date, e.start_time) });
    if (error) setErr(error.message.includes('duplicate') ? 'Already on that event.' : error.message); load();
  };
  const textMsg = 'Hi! G&R is asking for your availability. Open the staff app and tap Availability to answer: https://gr-staff-portal.vercel.app/availability';

  // Calendar grid (Sunday first, like the mockup)
  const startPad = first.getDay(); const days = Number(last.slice(8));
  const cells = [...Array(startPad).fill(null), ...Array.from({ length: days }, (_, i) => month.slice(0, 8) + String(i + 1).padStart(2, '0'))];
  const name = (id: string) => staff.find((s) => s.id === id);
  const evOn = (d: string) => aEvents.filter((e) => e.event_date === d);
  const booked = (d: string) => new Set(evOn(d).flatMap((e) => e.shifts.map((s) => s.staff_id)));

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="muted sm strong">ASK FOR AVAILABILITY</div>
          <div className="row"><button className="sq" onClick={() => { const x = D(month); x.setMonth(x.getMonth() - 1); setMonth(isoDay(x).slice(0, 8) + '01'); }}>‹</button>
            <h1>{first.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}</h1>
            <button className="sq" onClick={() => { const x = D(month); x.setMonth(x.getMonth() + 1); setMonth(isoDay(x).slice(0, 8) + '01'); }}>›</button></div></div>
        <div className="muted sm"><b className="tier-dot A">A</b> 1–8 staff · <b className="tier-dot A">A</b><b className="tier-dot B">B</b> 9–20 · <b className="tier-dot A">A</b><b className="tier-dot B">B</b><b className="tier-dot C">C</b> 21+</div>
      </div>
      {err && <p className="error">{err}</p>}
      {msg && <div className="pending"><div className="grow"><b>{msg}</b><div className="sm muted">Texting isn’t connected yet. To text them yourself, copy this message.</div></div>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(textMsg)}>Copy text</button></div>}

      <div className="avail-grid">
        <section className="cal">
          <div className="cal-head">{['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((h) => <span key={h}>{h}</span>)}</div>
          <div className="cal-body">
            {cells.map((d, i) => d ? (
              <button key={d} className={'cal-cell' + (sel[d] ? ' on' : '') + (d < today ? ' past' : '') + (byDate[d] ? ' has' : '')} onClick={() => toggle(d)}>
                <span className="n">{Number(d.slice(8))}</span>
                {byDate[d] && <span className="need">{need(d)} staff</span>}
                {byDate[d] && <span className="tiers">{(sel[d] ?? tiersFor(need(d) || 1)).map((t) => <i key={t} className={'tier-dot ' + t}>{t}</i>)}</span>}
                {askFor(d) && <span className="asked">asked {askFor(d)!.tiers_sent.join('')}</span>}
              </button>
            ) : <span key={'p' + i} />)}
          </div>
          <div className="muted sm" style={{ padding: '8px 4px' }}>Tiers are picked from the staff needed. Tap a letter on the right to change.</div>
        </section>

        <aside className="ask-side">
          <b>{selDates.length ? `${selDates.length} date${selDates.length > 1 ? 's' : ''} selected` : 'Tap dates to ask'}</b>
          {selDates.map((d) => (
            <div key={d} className="ask-date">
              <div className="grow"><b>{fmt(d)}</b><small>Need {need(d)} · ask ~{Math.ceil(need(d) * 1.5)}</small></div>
              <div className="tier-pick">{TIERS.map((t) => <button key={t} className={'tier-dot ' + t + (sel[d].includes(t) ? '' : ' off')} onClick={() => setTiers(d, t)}>{t}</button>)}</div>
              {skipped(d, sel[d]).length > 0 && (
                <details className="skipped"><summary>{skipped(d, sel[d]).length} skipped automatically</summary>
                  {skipped(d, sel[d]).map((s) => <button key={s.id} onClick={() => setInclude(new Set([...include, `${s.id}|${d}`]))}>{s.full_name} <small>{skipWhy(s, d)}</small> <u>ask anyway</u></button>)}
                </details>)}
            </div>
          ))}
          {selDates.length > 0 && <>
            <div className="who">{TIERS.map((t, i) => <span key={t}><i className={'tier-dot ' + t}>{t}</i>{perTier[i]} people</span>)}</div>
            <p className="muted sm" style={{ margin: 0 }}>Each person sees only the dates their tier was asked for. People whose usual week says “No” or who have a day off are skipped.</p>
            <button className="btn primary" disabled={busy || !total.size} onClick={() => send(selDates.map((d) => ({ d, tiers: sel[d] })))}>{busy ? 'Sending…' : `Ask ${total.size} people`}</button>
          </>}
        </aside>
      </div>

      <h2 style={{ margin: '8px 0 0' }}>Who’s available</h2>
      <div className="muted sm">Tier, then ranking</div>
      {!asks.length && <div className="muted">No open asks.</div>}
      <div className="answers">
        {asks.map((a) => {
          const rs = rows.filter((r) => r.ask_id === a.id).map((r) => ({ r, s: name(r.staff_id) }))
            .sort((x, y) => (x.r.tier ?? 'Z').localeCompare(y.r.tier ?? 'Z') || (x.r.status === 'yes' ? 0 : x.r.status === 'asked' ? 1 : 2) - (y.r.status === 'yes' ? 0 : y.r.status === 'asked' ? 1 : 2) || (x.s ? rank(x.s) : 9999) - (y.s ? rank(y.s) : 9999));
          const yes = rs.filter((x) => x.r.status === 'yes').length; const waiting = rs.filter((x) => x.r.status === 'asked').length;
          const evs = evOn(a.for_date); const bk = booked(a.for_date);
          const nt = TIERS.find((t) => !a.tiers_sent.includes(t));
          return (
            <section key={a.id} className="ans-card">
              <header>
                <div className="grow"><b>{fmt(a.for_date)}</b> {a.tiers_sent.map((t) => <i key={t} className={'tier-dot ' + t}>{t}</i>)}
                  <div className="sm muted"><b className={yes >= a.staff_needed ? 'okc' : ''}>{yes} yes</b> of {a.staff_needed} needed · {waiting} no answer{yes >= a.staff_needed ? ' · Full ✓' : ''}</div></div>
              </header>
              {rs.map(({ r, s }) => (
                <div key={r.id} className={'ans-row ' + r.status}>
                  <i className={'tier-dot ' + (r.tier ?? '')}>{r.tier ?? '–'}</i>
                  <span className="rk">#{s ? rank(s) : '?'}</span>
                  <span className="grow strong">{s?.full_name ?? '—'}</span>
                  <span className="sm">{r.status === 'yes' ? <>Yes · {r.from_time ? `from ${ampm(r.from_time)}` : 'any time'}{r.until_time ? ` – ${ampm(r.until_time)}` : ''}</> : r.status === 'no' ? 'No' : '—'}
                    {r.status === 'asked' && s && freeFrom(s, a.for_date) && <small className="muted"> (usually from {ampm(freeFrom(s, a.for_date))})</small>}</span>
                  {r.status === 'yes' && (bk.has(r.staff_id) ? <span className="pill ok">Booked</span>
                    : evs.length === 1 ? <button className="btn sm" onClick={() => book(r, evs[0])}>Add ›</button>
                    : evs.length > 1 ? <select className="btn sm" value="" onChange={(e) => { const ev = evs.find((x) => x.id === e.target.value); if (ev) book(r, ev); }}><option value="">Add to…</option>{evs.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}</select> : null)}
                </div>
              ))}
              {nt && <button className="btn sm" disabled={busy} onClick={() => nextTier(a)}>Ask next tier <i className={'tier-dot ' + nt}>{nt}</i> by ranking</button>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
