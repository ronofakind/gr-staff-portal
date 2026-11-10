import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { eventsBetween, addDays, isoDay, periodOf, dLabel, type AEvent } from './api';
import { loadNewHires, missingFor, missingText } from '../lib/newHires';
import { loadRates, byStaff, eventCost, sumCost, driversBy, invoicesFor, money, type Cost, type Invoice, type RateRow } from './pay';

/** Nov 8 · push 54 · Today → Pay period: staff cost so far / booked ahead / est. total vs last period + profit per event once its invoice is sent. */
type Data = { miss: { name: string; what: string }[]; cur: { start: string; end: string }; so: Cost; ahead: Cost; last: Cost; rows: { e: AEvent; c: Cost; inv: Invoice }[]; unsent: number };
export function PayPeriod() {
  const [d, setD] = useState<Data | null>(null); const [none, setNone] = useState(false);
  useEffect(() => { (async () => {
    const today = isoDay(new Date()); const cur = periodOf(today); const prev = periodOf(addDays(cur.start, -1));
    const [rr, evs, nh] = await Promise.all([loadRates(), eventsBetween(prev.start, cur.end), loadNewHires()]);
    if (!rr) { setNone(true); return; }
    const rates: Record<string, RateRow[]> = byStaff(rr);
    const ids = evs.map((e) => e.id); const [drv, inv] = await Promise.all([driversBy(ids), invoicesFor(ids)]);
    const cost = (e: AEvent, ahead = false) => eventCost(e, rates, drv[e.id] ?? 0, ahead);
    const inCur = evs.filter((e) => e.event_date >= cur.start);
    const so = sumCost(inCur.filter((e) => e.event_date <= today).map((e) => cost(e)));
    const ahead = sumCost(inCur.filter((e) => e.event_date > today).map((e) => cost(e, true)));
    const last = sumCost(evs.filter((e) => e.event_date < cur.start).map((e) => cost(e)));
    const invBy = Object.fromEntries(inv.map((i) => [i.event_id, i]));
    const past = inCur.filter((e) => e.event_date <= today);
    const rows = past.filter((e) => invBy[e.id]).map((e) => ({ e, c: cost(e), inv: invBy[e.id] as Invoice })).sort((a, b) => b.e.event_date.localeCompare(a.e.event_date));
    const unsent = past.filter((e) => !invBy[e.id] && e.shifts.some((s) => s.punches?.punch_in)).length;
    // push 71 · new hires who worked (this or last period) but we don't have everything to pay them
    const miss = new Map<string, { name: string; what: string }>();
    for (const e of evs) for (const sh of e.shifts) { const id = sh.staff_id as string | undefined; if (!id || !sh.punches?.punch_in || miss.has(id)) continue;
      const m = missingFor(nh[id]).filter((x) => x !== 'handbook'); if (m.length) miss.set(id, { name: sh.staff?.full_name ?? '?', what: missingText(m) }); }
    setD({ miss: [...miss.values()], cur, so, ahead, last, rows, unsent });
  })().catch(() => setNone(true)); }, []);
  if (none) return <div className="adm-card muted sm">Pay rates aren't in the app yet.</div>;
  if (!d) return <div className="muted">Loading…</div>;
  const payday = d.cur.end.endsWith('-15') ? d.cur.start.slice(0, 8) + '16' : addDays(d.cur.end, 1);
  const est = d.so.cost + d.ahead.cost; const tb = d.rows.reduce((n, r) => n + (r.inv.subtotal ?? 0), 0); const tc = d.rows.reduce((n, r) => n + r.c.cost, 0);
  const pct = (p: number, b: number) => (b ? Math.round((p / b) * 100) : 0);
  const tone = (m: number) => (m >= 30 ? 'okc' : m >= 25 ? 'gold' : 'accent');
  return (
    <div className="adm-card t4-card pp">
      <div className="pp-top"><b>{dLabel(d.cur.start, { month: 'short', day: 'numeric' })} – {dLabel(d.cur.end, { day: 'numeric' })}</b><span className="muted sm">· paid {dLabel(payday, { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>
      <div className="pp-nums">
        <div><small>SO FAR</small><b className="serif">{money(d.so.cost)}</b><span className="muted sm">{Math.round(d.so.hours)} h worked</span></div>
        <div><small>BOOKED AHEAD</small><b className="serif dim">+ {money(d.ahead.cost)}</b><span className="muted sm">to {dLabel(d.cur.end, { month: 'short', day: 'numeric' })}</span></div>
        <div><small>EST. TOTAL</small><b className="serif">≈ {money(est)}</b><span className="muted sm">last period {money(d.last.cost)}</span></div>
      </div>
      {d.miss.length > 0 && <div className="pay-miss"><b>Before you pay</b>{d.miss.map((m) => <span key={m.name}>{m.name} worked, but we have {m.what}</span>)}</div>}
      <div className="pp-bar"><i style={{ width: `${est ? (d.so.cost / est) * 100 : 0}%` }} /></div>
      <div className="pp-split">
        {([['Floor', d.so.floor], ['Bar', d.so.bar], ['MDs + BMs', d.so.mgr], ['Gas + travel', d.so.gas + d.so.travel]] as [string, number][]).map(([l, v]) => <div key={l}><span>{l}</span><b>{money(v)}</b></div>)}
      </div>
      {(d.so.missing > 0 || d.so.noRate.length > 0) && <div className="muted sm">{d.so.missing > 0 && <>⚠ {d.so.missing} end time{d.so.missing > 1 ? 's' : ''} missing (not counted) · </>}{d.so.noRate.length > 0 && <>no rate: {[...new Set(d.so.noRate)].slice(0, 4).join(', ')}{new Set(d.so.noRate).size > 4 ? '…' : ''}</>}</div>}
      <div className="pp-h"><b>Profit · sent invoices</b><span className="muted sm">billed before taxes − staff cost</span></div>
      {!d.rows.length && <div className="muted sm">No invoice sent yet this period.</div>}
      {d.rows.map(({ e, c, inv }) => { const b = inv.subtotal ?? 0; const p = b - c.cost; const m = pct(p, b); return (
        <Link key={e.id} to={`/admin/event/${e.id}`} className="pp-row"><span className="grow"><b>{e.title}{e.department === 'bar' ? ' · bar' : ''}</b><small className="muted">{dLabel(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' })} · #{inv.doc_number}</small></span>
          <span className="pp-c">{money(b)}</span><span className="pp-c muted">{money(c.cost)}</span><b className={'pp-c ' + tone(m)}>{money(p)}</b><b className={'pp-m ' + tone(m)}>{m}%</b></Link>); })}
      {d.rows.length > 0 && <div className="pp-row tot"><span className="grow"><b>{d.rows.length} sent</b></span><span className="pp-c">{money(tb)}</span><span className="pp-c muted">{money(tc)}</span><b className={'pp-c ' + tone(pct(tb - tc, tb))}>{money(tb - tc)}</b><b className={'pp-m ' + tone(pct(tb - tc, tb))}>{pct(tb - tc, tb)}%</b></div>}
      {d.unsent > 0 && <div className="muted sm">{d.unsent} event{d.unsent > 1 ? 's' : ''} worked, invoice not sent yet</div>}
    </div>
  );
}
