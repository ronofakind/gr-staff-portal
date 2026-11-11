// push 77 · Payroll in the app (migration 102). One page per pay period (1–15 paid the 16th, 16–end paid the 1st).
// Main view = name + total pay. Tap → hours by date × rate, travel, gas, meetings, extra lines. "Make RBC file" builds the
// same filler script as the rbc-payroll-import skill and locks the period. Admin only.
import { zipSync } from 'fflate';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, addDays, isoDay, periodOf, hoursBetween, dLabel, type AEvent } from './api';
import { loadRates, byStaff, rateOn, money2, type RateRow } from './pay';
import { loadNewHires, missingFor, missingText, type NewHire } from '../lib/newHires';
import { payDayLabel } from '../lib/hours';
import type { MeetingHours } from '../lib/meetings';

export const KINDS: [string, string, 1 | -1 | 0][] = [
  ['hours', 'Hours worked (typed in)', 1], ['tips', 'Tips', 1], ['uber', 'Uber', 1], ['gas', 'Gas', 1], ['parking', 'Parking', 1], ['correction', 'Missing hours / Correction', 0], ['other', 'Other', 1],
  ['paypal', 'PayPal (already paid)', -1], ['cash', 'Paid cash', -1], ['cra', 'Payment to CRA', -1], ['banked', 'Bank hours', -1], ['payout', 'Pay out banked hours', 1],
];
const kindName = (k: string) => KINDS.find((x) => x[0] === k)?.[1] ?? k;
type Line = { id: string; staff_id: string; period_start: string; col_id?: string | null; source_id?: string | null; kind: string; amount: number; hours: number | null; line_date: string | null; note: string | null; source: string };
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
  const [cols, setCols] = useState<PCol[]>([]); const [roster, setRoster] = useState<{ id: string; full_name: string }[]>([]); const [added, setAdded] = useState<string[]>([]); // push 79 · grid
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
      supabase.from('pay_lines').select('*').eq('period_start', p.start).order('created_at'),
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
    const [pc, ro2] = await Promise.all([supabase.from('pay_columns').select('id,name,ctype,sort').eq('period_start', p.start).order('sort').order('created_at'),
      supabase.from('staff').select('id,full_name').eq('active', true).is('deleted_at', null).order('full_name')]);
    setCols(pc.error ? [] : (pc.data ?? []) as PCol[]); setRoster((ro2.data ?? []) as { id: string; full_name: string }[]);
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
    for (const l of lines) { const x = get(l.staff_id, extra[l.staff_id] ?? roster.find((r) => r.id === l.staff_id)?.full_name ?? '?'); x.lines.push(l); if (l.kind === 'hours') x.hours += Number(l.hours ?? 0); }
    for (const id of added) if (!m.has(id)) get(id, roster.find((r) => r.id === id)?.full_name ?? '?');
    for (const x of m.values()) x.total = r2(x.base + x.lines.reduce((n, l) => n + l.amount, 0));
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [evs, rates, drivers, mh, lines, extra, ppd, roster, added]);

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
          {lines.some((l) => l.source === 'expense') && <button className="abtn" disabled={busy} onClick={async () => { setBusy(true); setErr((await zipReceipts(lines, people, p)) ?? ''); setBusy(false); }}>🧾 Download receipts</button>}
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

      {evs !== null && <Grid p={p} people={people} cols={cols} locked={locked} rates={rates} isCash={(id) => !!names[id]?.skip?.includes('cash') || cash(id)} roster={roster}
        onAdd={(id) => setAdded((a) => [...a, id])} onOpen={(id) => setOpen(open === id ? null : id)} open={open} onDone={() => setT((n) => n + 1)}
        detail={(x) => <Detail x={x} locked={locked} period={p.start} bank={bank[x.id] ?? 0} rate={rateOn(rates[x.id], p.end)} pn={names[x.id]} onDone={() => setT((n) => n + 1)} />} />}

      <section className="stack pg-list">
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
  const byHours = kind === 'banked' || kind === 'payout' || kind === 'hours';
  const dayRate = kind === 'hours' && date ? rate : rate;
  const amount = byHours ? (dayRate == null ? NaN : r2(Number(hrs) * dayRate) * sign) : sign === 0 ? Number(amt) : Math.abs(Number(amt)) * sign;
  const add = async () => {
    setErr('');
    if (!Number.isFinite(amount) || !amount) { setErr(byHours ? (rate == null ? 'No pay rate for this person.' : 'Type the hours.') : 'Type an amount.'); return; }
    if (kind === 'payout' && Number(hrs) > bank) { setErr(`Only ${bank} h banked.`); return; }
    if (kind === 'hours' && !date) { setErr('Pick the day they worked.'); return; }
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
            <tr key={l.id}><td>{kindName(l.kind)}{l.line_date ? ` · ${dLabel(l.line_date)}` : ''}{l.hours ? ` · ${l.hours} h` : ''}{l.source === 'flag_fix' ? ' · staff flag' : ''}{l.source === 'expense' && l.source_id ? <> · <button className="lnk sm" onClick={() => openReceipt(l.source_id!)}>🧾 Receipt</button></> : null}{notes && l.note ? <span className="muted"> · {l.note}</span> : null}</td>
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

// ── push 79 · Payroll V2: grid like the Staff Payroll sheet (desktop). One column per day, extra columns, two blocks.
type PCol = { id: string; name: string; ctype: 'add' | 'off' | 'hours'; sort: number };
const AUTO: Record<string, string> = { paypal: 'PayPal', expense: 'Expenses', tips: 'Tips', uber: 'Uber', gas: 'Gas', parking: 'Parking', correction: 'Correction', other: 'Other', cash: 'Paid cash', cra: 'CRA', banked: 'Banked', payout: 'Banked paid out' };
const autoKey = (l: Line) => (l.source === 'expense' ? 'expense' : l.kind);
const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

function Grid({ p, people, cols, locked, rates, isCash, roster, onAdd, onOpen, open, onDone, detail }: {
  p: { start: string; end: string }; people: Person[]; cols: PCol[]; locked: boolean; rates: Record<string, RateRow[]>; isCash: (id: string) => boolean;
  roster: { id: string; full_name: string }[]; onAdd: (id: string) => void; onOpen: (id: string) => void; open: string | null; onDone: () => void; detail: (x: Person) => JSX.Element }) {
  const days: string[] = []; for (let d = p.start; d <= p.end; d = addDays(d, 1)) days.push(d);
  const autos = Object.keys(AUTO).filter((k) => people.some((x) => x.lines.some((l) => !l.col_id && l.kind !== 'hours' && autoKey(l) === k)));
  const [day, setDay] = useState<{ x: Person; d: string } | null>(null);
  const [cell, setCell] = useState<{ pid: string; col: string } | null>(null); const [val, setVal] = useState('');
  const [newCol, setNewCol] = useState<{ name: string; ctype: PCol['ctype'] } | null>(null); const [err, setErr] = useState(''); const [pick, setPick] = useState('');
  const me = async () => (await supabase.rpc('me')).data as string;

  const dayCell = (x: Person, d: string) => {
    const sh = x.shifts.filter((s) => s.date === d); const mt = x.mtg.filter((g) => g.date === d); const man = x.lines.filter((l) => l.kind === 'hours' && l.line_date === d);
    const h = sh.reduce((n, s) => n + s.hours, 0) + mt.reduce((n, g) => n + g.hours, 0) + man.reduce((n, l) => n + Number(l.hours ?? 0), 0);
    const cls = sh.some((s) => s.noEnd) ? ' q' : man.length ? ' man' : mt.length && !sh.length ? ' mtg' : '';
    return <td key={d} className={'pg-d' + cls} onClick={() => !locked && setDay({ x, d })}>{sh.some((s) => s.noEnd) && !h ? '?' : h ? fmt(h) : ''}{man.length ? '✎' : mt.length ? <sup>M</sup> : ''}</td>;
  };
  const colVal = (x: Person, c: PCol) => { const ls = x.lines.filter((l) => l.col_id === c.id); return c.ctype === 'hours' ? ls.reduce((n, l) => n + Number(l.hours ?? 0), 0) : ls.reduce((n, l) => n + l.amount, 0); };
  const saveCell = async (x: Person, c: PCol) => {
    setErr(''); const ls = x.lines.filter((l) => l.col_id === c.id); const n = Number(val.replace(',', '.').replace('$', ''));
    const rate = rateOn(rates[x.id], p.end);
    if (ls.length) { const { error } = await supabase.from('pay_lines').delete().in('id', ls.map((l) => l.id)); if (error) { setErr(error.message); return; } }
    if (val.trim() && Number.isFinite(n) && n !== 0) {
      if (c.ctype === 'hours' && rate == null) { setErr('No pay rate for ' + x.name); return; }
      const row = c.ctype === 'hours' ? { kind: n > 0 ? 'banked' : 'payout', hours: Math.abs(n), amount: -r2(n * rate!) }
        : { kind: 'other', hours: null, amount: c.ctype === 'off' ? -Math.abs(n) : n };
      const { error } = await supabase.from('pay_lines').insert({ staff_id: x.id, period_start: p.start, col_id: c.id, note: c.name, source: 'manual', created_by: await me(), ...row });
      if (error) { setErr(error.message); return; }
    }
    setCell(null); onDone();
  };
  const addCol = async () => { if (!newCol?.name.trim()) return; const { error } = await supabase.from('pay_columns').insert({ period_start: p.start, name: newCol.name.trim(), ctype: newCol.ctype, sort: cols.length });
    if (error) setErr(error.message); else { setNewCol(null); onDone(); } };
  const delCol = async (c: PCol) => { if (!window.confirm(`Remove the column “${c.name}” and its amounts?`)) return; const { error } = await supabase.from('pay_columns').delete().eq('id', c.id); if (error) setErr(error.message); else onDone(); };

  const block = (list: Person[]) => list.map((x) => (
    <Fragment key={x.id}>
      <tr className={open === x.id ? 'on' : ''}>
        <th className="pg-n" onClick={() => onOpen(x.id)}>{x.name.toUpperCase()}{isCash(x.id) ? <span className="ftag">CASH</span> : null}</th>
        {days.map((d) => dayCell(x, d))}
        <td className="pg-h">{fmt(x.hours)}</td>
        <td className="pg-r">{rateOn(rates[x.id], p.end) == null ? '—' : money2(rateOn(rates[x.id], p.end)!)}</td>
        {cols.map((c) => { const v = colVal(x, c); const ed = cell?.pid === x.id && cell.col === c.id;
          return <td key={c.id} className={'pg-x' + (v < 0 || c.ctype === 'off' ? ' off' : v > 0 ? ' add' : '')} onClick={() => { if (locked || ed) return; setCell({ pid: x.id, col: c.id }); setVal(v ? String(Math.abs(v)) : ''); }}>
            {ed ? <input autoFocus className="pg-in" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveCell(x, c); if (e.key === 'Escape') setCell(null); }} onBlur={() => saveCell(x, c)} />
              : v ? (c.ctype === 'hours' ? `${fmt(v)} h` : (v < 0 ? '−' : '+') + fmt(Math.abs(v))) : ''}</td>; })}
        {autos.map((k) => { const v = x.lines.filter((l) => !l.col_id && l.kind !== 'hours' && autoKey(l) === k).reduce((n, l) => n + l.amount, 0);
          return <td key={k} className={'pg-x' + (v < 0 ? ' off' : v > 0 ? ' add' : '')} onClick={() => onOpen(x.id)}>{v ? (v < 0 ? '−' : '+') + fmt(Math.abs(v)) : ''}</td>; })}
        <td className="pg-t">{x.noRate ? <span className="accent">no rate</span> : money2(x.total)}</td>
      </tr>
      {open === x.id && <tr className="sub"><td colSpan={days.length + 4 + cols.length + autos.length}>{detail(x)}</td></tr>}
    </Fragment>));
  const main = people.filter((x) => !isCash(x.id)); const cashL = people.filter((x) => isCash(x.id));
  const dayTot = (d: string) => people.reduce((n, x) => n + x.shifts.filter((s) => s.date === d).reduce((a, s) => a + s.hours, 0) + x.mtg.filter((g) => g.date === d).reduce((a, g) => a + g.hours, 0)
    + x.lines.filter((l) => l.kind === 'hours' && l.line_date === d).reduce((a, l) => a + Number(l.hours ?? 0), 0), 0);
  const W = days.length + 4 + cols.length + autos.length;
  const notIn = roster.filter((r) => !people.some((x) => x.id === r.id));
  return (
    <section className="stack pg-wrap">
      <div className="sec"><span className="serif">Hours per day</span><span className="muted sm">like the payroll sheet · tap a day to type hours · tap a name for the detail</span></div>
      <div className="pg-legend sm"><span><b className="pg-k">7</b> app hours</span><span><b className="pg-k man">6✎</b> typed by you</span><span><b className="pg-k mtg">2<sup>M</sup></b> meeting</span><span><b className="pg-k q">?</b> no end time</span></div>
      <div className="adm-card pg-card">
        <table className="pg">
          <thead><tr><th className="pg-n">NAME</th>
            {days.map((d) => <th key={d} className="pg-dh">{new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })}<br />{+d.slice(8)}</th>)}
            <th>HOURS</th><th>RATE</th>
            {cols.map((c) => <th key={c.id} className={'pg-xh ' + c.ctype} title={c.ctype === 'add' ? 'Adds to pay' : c.ctype === 'off' ? 'Comes off' : 'Hours banked'}>{c.name}{!locked && <button className="pg-xdel" aria-label="Remove column" onClick={() => delCol(c)}>×</button>}</th>)}
            {autos.map((k) => <th key={k} className="pg-xh auto">{AUTO[k]}</th>)}
            <th className="pg-t">{!locked && <button className="pg-addc" onClick={() => setNewCol({ name: '', ctype: 'add' })}>+ Column</button>}<br />TOTAL PAY</th></tr></thead>
          <tbody>
            <tr className="pg-sec"><td colSpan={W}>STAFF ON FLOOR · RBC FILE</td></tr>
            {block(main)}
            {cashL.length > 0 && <tr className="pg-sec"><td colSpan={W}>SPECIAL STAFF ON FLOOR · PAID CASH · NOT IN THE RBC FILE</td></tr>}
            {block(cashL)}
            <tr className="pg-tot"><th className="pg-n">TOTAL HOURS</th>{days.map((d) => <td key={d}>{fmt(dayTot(d)) === '0' ? '' : fmt(dayTot(d))}</td>)}
              <td className="pg-h">{fmt(people.reduce((n, x) => n + x.hours, 0))}</td><td colSpan={1 + cols.length + autos.length} /><td className="pg-t">{money2(people.reduce((n, x) => n + x.total, 0))}</td></tr>
          </tbody>
        </table>
      </div>
      {!locked && <div className="row wrap sm" style={{ gap: 8 }}><span className="muted">Someone not on the list (e.g. a cook):</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Pick a person…</option>{notIn.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select>
        {pick && <button className="abtn sm dark" onClick={() => { onAdd(pick); setPick(''); }}>Add to this period</button>}</div>}
      {err && <p className="error">{err}</p>}
      {newCol && <div className="pg-pop">
        <b>+ Column · {dLabel(p.start, { month: 'short', day: 'numeric' })} – {dLabel(p.end, { month: 'short', day: 'numeric' })}</b>
        <input autoFocus placeholder="Name, e.g. Tip Oct 23rd" value={newCol.name} onChange={(e) => setNewCol({ ...newCol, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && addCol()} />
        <div className="row wrap" style={{ gap: 6 }}>{([['add', 'Adds to pay'], ['off', 'Comes off'], ['hours', 'Hours (banked)']] as [PCol['ctype'], string][]).map(([k, n]) =>
          <button key={k} className={'abtn sm' + (newCol.ctype === k ? ' dark' : '')} onClick={() => setNewCol({ ...newCol, ctype: k })}>{n}</button>)}</div>
        <div className="row" style={{ gap: 8 }}><button className="abtn sm dark" onClick={addCol}>Add column</button><button className="lnk sm" onClick={() => setNewCol(null)}>Cancel</button></div>
        <small className="muted">Then type amounts in its cells. Staff never see column names or notes.</small></div>}
      {day && <DayPop key={day.x.id + day.d} x={day.x} d={day.d} period={p.start} rate={rateOn(rates[day.x.id], day.d)} onClose={() => setDay(null)} onDone={() => { setDay(null); onDone(); }} />}
    </section>);
}

function DayPop({ x, d, period, rate, onClose, onDone }: { x: Person; d: string; period: string; rate: number | null; onClose: () => void; onDone: () => void }) {
  const sh = x.shifts.filter((s) => s.date === d); const mt = x.mtg.filter((g) => g.date === d); const man = x.lines.find((l) => l.kind === 'hours' && l.line_date === d);
  const [h, setH] = useState(man?.hours ? String(man.hours) : ''); const [note, setNote] = useState(man?.note ?? ''); const [err, setErr] = useState('');
  const save = async () => {
    setErr(''); const n = Number(h.replace(',', '.'));
    if (man) { const { error } = await supabase.from('pay_lines').delete().eq('id', man.id); if (error) { setErr(error.message); return; } }
    if (h.trim() && n > 0) {
      if (rate == null) { setErr(`${x.name} has no pay rate.`); return; }
      const { data: me } = await supabase.rpc('me');
      const { error } = await supabase.from('pay_lines').insert({ staff_id: x.id, period_start: period, kind: 'hours', hours: n, amount: r2(n * rate), line_date: d, note: note.trim() || null, source: 'manual', created_by: me });
      if (error) { setErr(error.message); return; }
    }
    onDone();
  };
  return (
    <div className="pg-pop">
      <div className="spread"><b>{x.name} · {dLabel(d)}</b><button className="lnk sm" onClick={onClose}>✕</button></div>
      {sh.map((s) => <div key={s.id} className="sm">{s.title} · {s.noEnd ? <span className="accent">no end time</span> : <b>{s.hours} h</b>} <Link className="lnk" to="/admin/hours">Change the times ›</Link></div>)}
      {mt.map((g, i) => <div key={i} className="sm muted">Meeting · {g.title} · {g.hours} h</div>)}
      <span className="muted sm">{sh.length ? '+ Add hours (typed in, on top of the app hours)' : 'Type the hours'}{rate != null ? ` · × ${money2(rate)}` : ' · no pay rate!'}</span>
      <div className="row" style={{ gap: 6 }}><input autoFocus inputMode="decimal" style={{ width: 80 }} placeholder="Hours" value={h} onChange={(e) => setH(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
        <input className="grow" placeholder="Note (only you see it)" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="row" style={{ gap: 8 }}><button className="abtn sm dark" onClick={save}>Save</button>{man && <button className="abtn sm" onClick={() => { setH(''); setTimeout(save); }}>Remove</button>}</div>
      <small className="muted">Staff see “{dLabel(d)} · hours” in their Hours tab, never the note.</small>
      {err && <p className="error">{err}</p>}
    </div>);
}

// push 79d · receipts: open one (Payroll detail) or download every approved receipt of the period in one zip.
async function openReceipt(expenseId: string) {
  const w = window.open('', '_blank');
  const { data: e } = await supabase.from('expenses').select('receipt_path').eq('id', expenseId).maybeSingle();
  const path = (e as { receipt_path: string | null } | null)?.receipt_path;
  const { data } = path ? await supabase.storage.from('receipts').createSignedUrl(path, 600) : { data: null };
  if (data?.signedUrl && w) w.location.href = data.signedUrl; else { w?.close(); window.alert('No receipt photo for this one.'); }
}
async function zipReceipts(lines: Line[], people: Person[], p: { start: string; end: string }): Promise<string | null> {
  const ids = lines.filter((l) => l.source === 'expense' && l.source_id).map((l) => l.source_id!);
  const { data, error } = await supabase.from('expenses').select('id,staff_id,kind,amount,exp_date,receipt_path').in('id', ids);
  if (error) return error.message;
  const files: Record<string, Uint8Array> = {}; const miss: string[] = [];
  const nm = (id: string) => people.find((x) => x.id === id)?.name ?? 'Unknown';
  for (const e of (data ?? []) as { id: string; staff_id: string; kind: string; amount: number; exp_date: string; receipt_path: string | null }[]) {
    const base = `${e.exp_date} ${nm(e.staff_id)} ${e.kind[0].toUpperCase() + e.kind.slice(1)} ${Number(e.amount).toFixed(2)}`.replace(/[\\/:*?"<>|]/g, '');
    if (!e.receipt_path) { miss.push(base); continue; }
    const dl = await supabase.storage.from('receipts').download(e.receipt_path);
    if (dl.error || !dl.data) { miss.push(base); continue; }
    let name = base + '.' + (e.receipt_path.split('.').pop() || 'jpg'); let i = 2; while (files[name]) name = `${base} (${i++}).${e.receipt_path.split('.').pop() || 'jpg'}`;
    files[name] = new Uint8Array(await dl.data.arrayBuffer());
  }
  if (!Object.keys(files).length) return 'No receipt photos to download.';
  const zip = zipSync(files, { level: 0 });
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' })); a.download = `G&R receipts ${p.start} to ${p.end}.zip`; a.click();
  return miss.length ? `Downloaded. Missing photo: ${miss.join(' · ')}` : null;
}
