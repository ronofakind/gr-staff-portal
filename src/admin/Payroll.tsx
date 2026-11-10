// push 77 · Payroll in the app (migration 102). One page per pay period (1–15 paid the 16th, 16–end paid the 1st).
// Main view = name + total pay. Tap → hours by date × rate, travel, gas, meetings, extra lines. "Make RBC file" builds the
// same filler script as the rbc-payroll-import skill and locks the period. Admin only.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, addDays, isoDay, periodOf, hoursBetween, dLabel, type AEvent } from './api';
import { loadRates, byStaff, rateOn, money2, type RateRow } from './pay';
import { loadNewHires, missingFor, missingText, type NewHire } from '../lib/newHires';
import { payDayLabel } from '../lib/hours';
import type { MeetingHours } from '../lib/meetings';

export const KINDS: [string, string, 1 | -1 | 0][] = [
  ['tips', 'Tips', 1], ['uber', 'Uber', 1], ['gas', 'Gas', 1], ['parking', 'Parking', 1], ['correction', 'Missing hours / Correction', 0], ['other', 'Other', 1],
  ['paypal', 'PayPal (already paid)', -1], ['cash', 'Paid cash', -1], ['cra', 'Payment to CRA', -1], ['banked', 'Bank hours', -1], ['payout', 'Pay out banked hours', 1],
];
const kindName = (k: string) => KINDS.find((x) => x[0] === k)?.[1] ?? k;
type Line = { id: string; staff_id: string; period_start: string; kind: string; amount: number; hours: number | null; line_date: string | null; note: string | null; source: string };
type PShift = { id: string; date: string; title: string; hours: number; rate: number | null; pay: number; travel: number; gas: number; paypal: boolean; noEnd: boolean };
type Person = { id: string; name: string; shifts: PShift[]; mtg: { date: string; title: string; hours: number; pay: number }[]; lines: Line[]; hours: number; base: number; total: number; noRate: boolean; noEnd: number };
type Period = { locked_at: string | null; closed_at: string | null; rbc_lines: { staff_id: string; name: string; rbc_name: string; amount: number }[] | null; rbc_total: number | null };
type PName = { staff_id: string; rbc_name: string | null; skip: string | null };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function Payroll() {
  const [p, setP] = useState(periodOf(isoDay(new Date())));
  const [evs, setEvs] = useState<AEvent[] | null>(null);
  const [rates, setRates] = useState<Record<string, RateRow[]>>({});
  const [drivers, setDrivers] = useState<Set<string>>(new Set());
  const [mh, setMh] = useState<MeetingHours[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [bank, setBank] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, PName>>({});
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [nh, setNh] = useState<Record<string, NewHire>>({});
  const [per, setPer] = useState<Period | null>(null);
  const [ppd, setPpd] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [rbc, setRbc] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [t, setT] = useState(0);
  const locked = !!per?.locked_at;

  useEffect(() => { (async () => {
    setErr('');
    const ev = await eventsBetween(p.start, p.end); setEvs(ev);
    const ids = ev.map((e) => e.id);
    const [rr, ro, m, pl, bk, pn, pp, h] = await Promise.all([
      loadRates(),
      ids.length ? supabase.from('ride_offers').select('event_id,staff_id').eq('kind', 'driver').in('event_id', ids) : Promise.resolve({ data: [] }),
      supabase.rpc('meeting_hours', { p_from: p.start, p_to: p.end }),
      supabase.from('pay_lines').select('id,staff_id,period_start,kind,amount,hours,line_date,note,source').eq('period_start', p.start).order('created_at'),
      supabase.from('pay_lines').select('staff_id,kind,hours').in('kind', ['banked', 'payout']),
      supabase.from('pay_names').select('staff_id,rbc_name,skip'),
      supabase.from('pay_periods').select('locked_at,closed_at,rbc_lines,rbc_total').eq('start_date', p.start).maybeSingle(),
      loadNewHires(),
    ]);
    if (pl.error) setErr('Payroll needs migration 102 first.');
    setRates(byStaff(rr ?? []));
    setDrivers(new Set(((ro.data ?? []) as { event_id: string; staff_id: string }[]).map((x) => x.event_id + '|' + x.staff_id)));
    setMh(m.error ? [] : ((m.data ?? []) as MeetingHours[]).filter((x) => x.paid && x.ended));
    const L = ((pl.data ?? []) as Line[]).map((l) => ({ ...l, amount: Number(l.amount), hours: l.hours == null ? null : Number(l.hours) })); setLines(L);
    setBank(((bk.data ?? []) as { staff_id: string; kind: string; hours: number }[]).reduce<Record<string, number>>((a, x) => { a[x.staff_id] = (a[x.staff_id] ?? 0) + (x.kind === 'banked' ? 1 : -1) * Number(x.hours ?? 0); return a; }, {}));
    setNames(Object.fromEntries(((pn.data ?? []) as PName[]).map((x) => [x.staff_id, x])));
    setPer((pp.data as Period) ?? null); setNh(h);
    const sids = ev.flatMap((e) => e.shifts.map((s) => s.id));
    const { data: pd } = sids.length ? await supabase.from('shifts').select('id').in('id', sids).not('paypal_paid_at', 'is', null) : { data: [] };
    setPpd(new Set(((pd ?? []) as { id: string }[]).map((x) => x.id)));
    // people with only lines (no shift this period)
    const known = new Set(ev.flatMap((e) => e.shifts.map((s) => s.staff_id)));
    const miss = [...new Set(L.map((l) => l.staff_id))].filter((x) => !known.has(x));
    if (miss.length) { const { data } = await supabase.from('staff').select('id,full_name').in('id', miss); setExtra(Object.fromEntries(((data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name]))); } else setExtra({});
  })(); }, [p.start, t]);

  const people: Person[] = useMemo(() => {
    const m = new Map<string, Person>();
    const get = (id: string, name: string) => { if (!m.has(id)) m.set(id, { id, name, shifts: [], mtg: [], lines: [], hours: 0, base: 0, total: 0, noRate: false, noEnd: 0 }); return m.get(id)!; };
    for (const e of evs ?? []) for (const s of e.shifts) {
      if (s.status === 'declined' || s.attendance || !s.punches?.punch_in) continue;
      const x = get(s.staff_id, s.staff?.full_name ?? '?');
      const rate = rateOn(rates[s.staff_id], e.event_date);
      const noEnd = !s.punches.punch_out;
      const h = noEnd ? 0 : hoursBetween(s.punches.punch_in, s.punches.punch_out, !!s.left_early);
      const travel = e.transport && e.paid_travel_min && rate != null ? r2((e.paid_travel_min / 60) * rate) : 0;
      const gas = e.transport && e.gas_per_car && drivers.has(e.id + '|' + s.staff_id) ? Number(e.gas_per_car) : 0;
      const pay = rate == null ? 0 : r2(h * rate);
      x.shifts.push({ id: s.id, date: e.event_date, title: e.title + (e.department === 'bar' ? ' · bar' : ''), hours: h, rate, pay, travel, gas, paypal: ppd.has(s.id), noEnd });
      x.hours += h; x.base += pay + travel + gas; if (rate == null) x.noRate = true; if (noEnd) x.noEnd++;
    }
    for (const g of mh) { const x = get(g.staff_id, g.full_name); const rate = rateOn(rates[g.staff_id], g.meeting_date); const pay = rate == null ? 0 : r2(Number(g.hours) * rate);
      x.mtg.push({ date: g.meeting_date, title: g.title, hours: Number(g.hours), pay }); x.hours += Number(g.hours); x.base += pay; if (rate == null) x.noRate = true; }
    for (const l of lines) get(l.staff_id, extra[l.staff_id] ?? '?').lines.push(l);
    for (const x of m.values()) x.total = r2(x.base + x.lines.reduce((n, l) => n + l.amount, 0));
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [evs, rates, drivers, mh, lines, extra, ppd]);

  const cash = (id: string) => nh[id]?.paid_by === 'cash';
  const rbcName = (x: Person) => (names[x.id]?.rbc_name || x.name).toUpperCase().trim();
  const why = (x: Person) => names[x.id]?.skip ? `skipped · ${names[x.id]!.skip}` : cash(x.id) ? 'paid cash' : x.total <= 0 ? (x.total < 0 ? 'negative total' : '$0') : null;
  const inFile = people.filter((x) => !why(x));
  const fileLines = (() => { const m = new Map<string, { staff_id: string; name: string; rbc_name: string; amount: number }>();
    for (const x of inFile) { const k = rbcName(x); const o = m.get(k); if (o) o.amount = r2(o.amount + x.total); else m.set(k, { staff_id: x.id, name: x.name, rbc_name: k, amount: x.total }); }
    return [...m.values()]; })();
  const total = r2(people.reduce((n, x) => n + x.total, 0));
  const noEnd = people.filter((x) => x.noEnd); const noRate = people.filter((x) => x.noRate);
  const before = people.map((x) => ({ x, m: missingFor(nh[x.id]).filter((y) => y !== 'handbook') })).filter((y) => y.m.length);
  const step = (n: number) => { setOpen(null); setRbc(false); setP(n < 0 ? periodOf(addDays(p.start, -1)) : periodOf(addDays(p.end, 1))); };
  const run = async (f: () => PromiseLike<{ error: { message: string } | null }>) => { setBusy(true); setErr(''); const { error } = await f(); setBusy(false); if (error) setErr(error.message); else setT((x) => x + 1); };

  const download = async (rows: { rbc_name: string; amount: number }[]) => {
    const tpl = await (await fetch('/rbc/rbc_payroll_template.py')).text();
    const label = `${dLabel(p.start, { month: 'short', day: 'numeric' })} - ${dLabel(p.end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const body = rows.filter((r) => r.amount > 0).sort((a, b) => a.rbc_name.localeCompare(b.rbc_name)).map((r) => `    ${JSON.stringify(r.rbc_name)}: ${r.amount.toFixed(2)},`).join('\n');
    const py = tpl.split('{{PAYROLL_LINES}}').join(body).split('{{PAY_PERIOD}}').join(label);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([py], { type: 'text/x-python' })); a.download = 'rbc_payroll.py'; a.click();
  };
  const makeFile = async () => {
    if (!window.confirm(`Make the RBC file for ${fileLines.length} people (${money2(fileLines.reduce((n, l) => n + l.amount, 0))}) and lock this period? After this, fixes go to the next period.`)) return;
    await download(fileLines);
    await run(() => supabase.rpc('admin_lock_period', { p_start: p.start, p_end: p.end, p_lines: fileLines }));
    setRbc(false);
  };

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="row"><button className="sq" aria-label="Previous period" onClick={() => step(-1)}>‹</button>
          <div><div className="kick">PAYROLL</div><h1 className="serif-h">{dLabel(p.start, { month: 'short', day: 'numeric' })} – {dLabel(p.end, { month: 'short', day: 'numeric' })}</h1>
            <div className={'sm ' + (locked ? 'okc strong' : 'muted')}>{locked ? `Locked ${dLabel(per!.locked_at!.slice(0, 10))} · RBC file ${money2(Number(per!.rbc_total ?? 0))} · fixes go to the next period` : `Open · paid ${payDayLabel(p)}`}</div></div>
          <button className="sq" aria-label="Next period" onClick={() => step(1)}>›</button></div>
        <div className="row wrap">
          {locked ? <>
            <button className="abtn" onClick={() => download(per!.rbc_lines ?? [])}>Download RBC file again</button>
            <button className="abtn" disabled={busy} onClick={() => window.confirm('Unlock this period? The RBC file was already made.') && run(() => supabase.rpc('admin_unlock_period', { p_start: p.start }))}>Unlock</button>
          </> : <button className="abtn red" disabled={busy || !people.length} onClick={() => setRbc(!rbc)}>Make RBC file</button>}
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="kpi5">
        <div className="k"><small>PEOPLE</small><b>{people.length}</b></div>
        <div className="k"><small>TOTAL PAY</small><b>{money2(total)}</b></div>
        <div className="k"><small>HOURS</small><b>{r2(people.reduce((n, x) => n + x.hours, 0))}</b></div>
        <div className={'k' + (noEnd.length ? ' redk' : '')}><small>MISSING END</small><b>{noEnd.reduce((n, x) => n + x.noEnd, 0)}</b></div>
        <div className={'k' + (noRate.length ? ' amber' : '')}><small>NO RATE</small><b>{noRate.length}</b></div>
      </div>

      {(noEnd.length > 0 || noRate.length > 0 || before.length > 0) && (
        <div className="pay-miss"><b>Before you pay</b>
          {noEnd.map((x) => <span key={'e' + x.id}>{x.name} · {x.noEnd} shift{x.noEnd > 1 ? 's' : ''} with no end time (not counted) · <Link className="lnk" to="/admin/hours">Hours ›</Link></span>)}
          {noRate.map((x) => <span key={'r' + x.id}>{x.name} has no pay rate · <Link className="lnk" to="/admin/rates">Pay rates ›</Link></span>)}
          {before.map(({ x, m }) => <span key={'b' + x.id}>{x.name} worked, but we have {missingText(m)}</span>)}
        </div>)}

      {rbc && !locked && (
        <section className="adm-card stack">
          <div className="sec"><span className="serif">RBC file · {fileLines.length} people · {money2(fileLines.reduce((n, l) => n + l.amount, 0))}</span><span className="muted sm">same file as before (rbc_payroll.py)</span></div>
          {people.filter(why).length > 0 && <div className="muted sm">Not in the file: {people.filter(why).map((x) => `${x.name} (${why(x)}${x.total ? ' ' + money2(x.total) : ''})`).join(' · ')}</div>}
          {fileLines.filter((l) => l.rbc_name !== l.name.toUpperCase()).length > 0 && <div className="muted sm">RBC names: {fileLines.filter((l) => l.rbc_name !== l.name.toUpperCase()).map((l) => `${l.name} → ${l.rbc_name}`).join(' · ')}</div>}
          <div className="row"><button className="abtn dark" disabled={busy} onClick={makeFile}>Download file and lock period</button><button className="lnk sm" onClick={() => setRbc(false)}>Cancel</button></div>
          <div className="muted sm">Run it on your computer like before, log in to RBC yourself, review the totals in RBC before approving.</div>
        </section>)}

      <section className="stack">
        <div className="sec"><span className="serif">By person</span><span className="muted sm">tap a name for hours, rate and extra lines</span></div>
        <div className="adm-card table-card">
          <table className="atable">
            <thead><tr><th>Name</th><th>Hours</th><th style={{ textAlign: 'right' }}>Total pay</th></tr></thead>
            <tbody>
              {evs === null && <tr><td colSpan={3} className="muted">Loading…</td></tr>}
              {evs !== null && !people.length && <tr><td colSpan={3} className="muted">Nobody worked this period yet.</td></tr>}
              {people.map((x) => (
                <Fragment key={x.id}>
                  <tr className="click" onClick={() => setOpen(open === x.id ? null : x.id)}>
                    <td className="strong">{x.name}{why(x) ? <span className="ftag">{why(x)}</span> : null}{bank[x.id] ? <span className="ftag">{bank[x.id]} h banked</span> : null}</td>
                    <td>{x.hours}{x.noEnd ? <span className="accent"> + ?</span> : ''}</td>
                    <td style={{ textAlign: 'right' }} className="strong">{x.noRate ? <span className="accent">no rate · </span> : null}{money2(x.total)}</td>
                  </tr>
                  {open === x.id && <tr className="sub"><td colSpan={3}><Detail x={x} locked={locked} period={p.start} bank={bank[x.id] ?? 0} rate={rateOn(rates[x.id], p.end)} pn={names[x.id]} onDone={() => setT((n) => n + 1)} /></td></tr>}
                </Fragment>
              ))}
              {people.length > 0 && <tr><td className="strong">Total</td><td>{r2(people.reduce((n, x) => n + x.hours, 0))}</td><td style={{ textAlign: 'right' }} className="strong">{money2(total)}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted sm">The payroll sheet still fills every night, so you can compare. Staff never see rates or totals.</p>
    </div>
  );
}

function Detail({ x, locked, period, bank, rate, pn, onDone }: { x: Person; locked: boolean; period: string; bank: number; rate: number | null; pn?: PName; onDone: () => void }) {
  const [kind, setKind] = useState('tips'); const [amt, setAmt] = useState(''); const [hrs, setHrs] = useState(''); const [date, setDate] = useState(''); const [note, setNote] = useState('');
  const [pp, setPp] = useState<Set<string>>(new Set()); const [nm, setNm] = useState(pn?.rbc_name ?? ''); const [skip, setSkip] = useState(pn?.skip ?? '');
  const [notes, setNotes] = useState(false); const [err, setErr] = useState('');
  const sign = KINDS.find((k) => k[0] === kind)![2];
  const byHours = kind === 'banked' || kind === 'payout';
  const amount = byHours ? (rate == null ? NaN : r2(Number(hrs) * rate) * sign) : sign === 0 ? Number(amt) : Math.abs(Number(amt)) * sign;
  const add = async () => {
    setErr('');
    if (!Number.isFinite(amount) || !amount) { setErr(byHours ? (rate == null ? 'No pay rate for this person.' : 'Type the hours.') : 'Type an amount.'); return; }
    if (kind === 'payout' && Number(hrs) > bank) { setErr(`Only ${bank} h banked.`); return; }
    const { data: me } = await supabase.rpc('me');
    const { error } = await supabase.from('pay_lines').insert({ staff_id: x.id, period_start: period, kind, amount, hours: byHours ? Number(hrs) : null, line_date: date || null, note: note.trim() || null, source: kind === 'paypal' ? 'paypal' : 'manual', created_by: me });
    if (error) { setErr(error.message); return; }
    if (kind === 'paypal' && pp.size) await supabase.from('shifts').update({ paypal_paid_at: new Date().toISOString() }).in('id', [...pp]);
    setAmt(''); setHrs(''); setNote(''); setDate(''); setPp(new Set()); onDone();
  };
  const del = async (id: string) => { const { error } = await supabase.from('pay_lines').delete().eq('id', id); if (error) setErr(error.message); else onDone(); };
  const saveName = async () => { const { error } = await supabase.from('pay_names').upsert({ staff_id: x.id, rbc_name: nm.trim().toUpperCase() || null, skip: skip.trim() || null }); if (error) setErr(error.message); else onDone(); };
  return (
    <div className="stack" style={{ padding: '8px 0' }}>
      <table className="atable mini">
        <tbody>
          {x.shifts.sort((a, b) => a.date.localeCompare(b.date)).map((s) => (
            <tr key={s.id}><td>{dLabel(s.date)} · {s.title}{s.paypal ? <span className="ftag">paid by PayPal</span> : null}</td>
              <td>{s.noEnd ? <span className="accent">no end time</span> : `${s.hours} h × ${s.rate == null ? '—' : money2(s.rate)}`}{s.travel ? ` + travel ${money2(s.travel)}` : ''}{s.gas ? ` + gas ${money2(s.gas)}` : ''}</td>
              <td style={{ textAlign: 'right' }}>{money2(s.pay + s.travel + s.gas)}</td></tr>))}
          {x.mtg.map((g, i) => <tr key={'m' + i}><td>{dLabel(g.date)} · Meeting · {g.title}</td><td>{g.hours} h</td><td style={{ textAlign: 'right' }}>{money2(g.pay)}</td></tr>)}
          {x.lines.map((l) => (
            <tr key={l.id}><td>{kindName(l.kind)}{l.line_date ? ` · ${dLabel(l.line_date)}` : ''}{l.hours ? ` · ${l.hours} h` : ''}{l.source === 'flag_fix' ? ' · staff flag' : ''}{notes && l.note ? <span className="muted"> · {l.note}</span> : null}</td>
              <td>{!locked && <button className="lnk sm" onClick={() => del(l.id)}>Remove</button>}</td>
              <td style={{ textAlign: 'right' }} className={l.amount < 0 ? 'accent' : ''}>{l.amount < 0 ? '− ' : '+ '}{money2(Math.abs(l.amount))}</td></tr>))}
          <tr><td className="strong">Total</td><td>{x.lines.some((l) => l.note) && <button className="lnk sm" onClick={() => setNotes(!notes)}>{notes ? 'Hide notes' : 'Show notes'}</button>}</td><td style={{ textAlign: 'right' }} className="strong">{money2(x.total)}</td></tr>
        </tbody>
      </table>
      {bank > 0 && <div className="muted sm">Banked balance: {bank} h</div>}
      {!locked ? (
        <div className="row wrap" style={{ gap: 6 }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          {byHours ? <input className="tin" inputMode="decimal" placeholder="Hours" value={hrs} onChange={(e) => setHrs(e.target.value)} />
            : <input className="tin" inputMode="decimal" placeholder={sign === 0 ? 'Amount (− to take off)' : 'Amount'} value={amt} onChange={(e) => setAmt(e.target.value)} />}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <input placeholder="Note (only you see it)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="abtn sm dark" onClick={add}>Add{Number.isFinite(amount) && amount ? ` ${amount < 0 ? '−' : '+'}${money2(Math.abs(amount))}` : ''}</button>
        </div>) : <div className="muted sm">Locked. A fix now goes to the next period as a Correction.</div>}
      {!locked && kind === 'paypal' && x.shifts.length > 0 && (
        <div className="row wrap sm" style={{ gap: 10 }}><span className="muted">Shifts it paid:</span>
          {x.shifts.map((s) => <label key={s.id}><input type="checkbox" checked={pp.has(s.id)} onChange={() => { const n = new Set(pp); n.has(s.id) ? n.delete(s.id) : n.add(s.id); setPp(n); }} /> {dLabel(s.date)}</label>)}</div>)}
      <div className="row wrap sm" style={{ gap: 6 }}><span className="muted">RBC name</span>
        <input value={nm} placeholder={x.name.toUpperCase()} onChange={(e) => setNm(e.target.value)} />
        <input value={skip} placeholder="Skip reason (e.g. employee)" onChange={(e) => setSkip(e.target.value)} />
        {(nm !== (pn?.rbc_name ?? '') || skip !== (pn?.skip ?? '')) && <button className="abtn sm" onClick={saveName}>Save</button>}</div>
      {err && <p className="error">{err}</p>}
    </div>
  );
}
