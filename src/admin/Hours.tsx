import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { eventsBetween, addDays, isoDay, endIso, startIso, periodOf, hoursBetween, tTime, dLabel, flagsOf, flagText, type AEvent, type AShift } from './api';

type Row = { e: AEvent; s: AShift };
const hm24 = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' }) : '';

export function Hours() {
  const [p, setP] = useState(periodOf(isoDay(new Date())));
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, { in?: string; out?: string }>>({});
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const today = isoDay(new Date());

  const load = async () => {
    const [evs, pp] = await Promise.all([eventsBetween(p.start, p.end), supabase.from('pay_periods').select('closed_at').eq('start_date', p.start).maybeSingle()]);
    setEvents(evs.filter((e) => e.department !== 'bar')); setClosed((pp.data?.closed_at as string) ?? null);
  };
  useEffect(() => { setEvents(null); load(); }, [p.start]);

  const rows: Row[] = useMemo(() => (events ?? []).flatMap((e) => e.shifts.filter((s) => s.status !== 'declined').map((s) => ({ e, s }))), [events]);
  const past = rows.filter((r) => r.e.event_date < today || r.s.punches?.punch_out);
  const missing = past.filter((r) => !r.s.attendance && (!r.s.punches?.punch_in || !r.s.punches?.punch_out) && r.e.event_date < today);
  const worked = rows.filter((r) => r.s.punches?.punch_in && r.s.punches?.punch_out);
  const hours = worked.reduce((n, r) => n + hoursBetween(r.s.punches!.punch_in, r.s.punches!.punch_out), 0);
  const flagged = rows.filter((r) => flagsOf(r.s).some((f) => f.flag === 'early' || f.flag === 'late'));
  const noShows = rows.filter((r) => r.s.attendance === 'no_show');
  const notes = rows.filter((r) => r.s.manager_note);

  const people = useMemo(() => {
    const m = new Map<string, { name: string; rows: Row[] }>();
    for (const r of rows) { const k = r.s.staff_id; if (!m.has(k)) m.set(k, { name: r.s.staff?.full_name ?? '?', rows: [] }); m.get(k)!.rows.push(r); }
    return [...m.entries()].map(([id, v]) => ({ id, ...v, hours: v.rows.reduce((n, r) => n + hoursBetween(r.s.punches?.punch_in ?? null, r.s.punches?.punch_out ?? null), 0) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const save = async (r: Row) => {
    setErr('');
    const d = draft[r.s.id] ?? {};
    const inT = d.in ?? hm24(r.s.punches?.punch_in ?? null); const outT = d.out ?? hm24(r.s.punches?.punch_out ?? null);
    if (!inT) { setErr('Add a start time first.'); return; }
    const pin = startIso(r.e.event_date, inT); const pout = outT ? endIso(r.e.event_date, inT, outT) : null;
    const { error } = await supabase.rpc('manager_set_punch', { p_shift: r.s.id, p_in: pin, p_out: pout });
    if (error) { setErr(error.message); return; }
    setDraft((x) => { const y = { ...x }; delete y[r.s.id]; return y; }); load();
  };
  const close = async (on: boolean) => {
    setBusy(true);
    const { data: me } = await supabase.rpc('me');
    const { error } = await supabase.from('pay_periods').upsert({ start_date: p.start, end_date: p.end, closed_at: on ? new Date().toISOString() : null, closed_by: on ? me : null });
    setBusy(false); if (error) setErr(error.message); else load();
  };
  const exportCsv = () => {
    const lines = [['Name', 'Date', 'Event', 'Start', 'End', 'Hours', 'Flag'].join(',')];
    for (const r of [...rows].sort((a, b) => (a.s.staff?.full_name ?? '').localeCompare(b.s.staff?.full_name ?? '') || a.e.event_date.localeCompare(b.e.event_date)))
      lines.push([r.s.staff?.full_name, r.e.event_date, r.e.title, tTime(r.s.punches?.punch_in ?? null), tTime(r.s.punches?.punch_out ?? null),
        hoursBetween(r.s.punches?.punch_in ?? null, r.s.punches?.punch_out ?? null), flagsOf(r.s).map(flagText).join(' ')].map((x) => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = `hours-${p.start}-to-${p.end}.csv`; a.click();
  };
  const step = (n: number) => setP(n < 0 ? periodOf(addDays(p.start, -1)) : periodOf(addDays(p.end, 1)));

  const times = (r: Row) => (
    <div className="row" style={{ gap: 6 }}>
      <input type="time" className="tin" aria-label="Start" value={draft[r.s.id]?.in ?? hm24(r.s.punches?.punch_in ?? null)} onChange={(ev) => setDraft({ ...draft, [r.s.id]: { ...draft[r.s.id], in: ev.target.value } })} />
      <input type="time" className={'tin' + (!r.s.punches?.punch_out ? ' need' : '')} aria-label="End" value={draft[r.s.id]?.out ?? hm24(r.s.punches?.punch_out ?? null)} onChange={(ev) => setDraft({ ...draft, [r.s.id]: { ...draft[r.s.id], out: ev.target.value } })} />
      {draft[r.s.id] && <button className="abtn sm dark" onClick={() => save(r)}>Save</button>}
    </div>
  );

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div className="row"><button className="sq" aria-label="Previous period" onClick={() => step(-1)}>‹</button>
          <div><div className="kick">HOURS &amp; PAY PERIOD</div><h1 className="serif-h">{dLabel(p.start, { month: 'short', day: 'numeric' })} – {dLabel(p.end, { month: 'short', day: 'numeric' })}</h1>
            <div className={'sm ' + (closed ? 'okc strong' : 'muted')}>{closed ? `Closed ${dLabel(closed.slice(0, 10))} · managers can’t edit` : 'Open · managers can still edit their events'}</div></div>
          <button className="sq" aria-label="Next period" onClick={() => step(1)}>›</button></div>
        <div className="row wrap">
          <button className="abtn" onClick={exportCsv}>Export hours (.csv)</button>
          {closed ? <button className="abtn" disabled={busy} onClick={() => close(false)}>Reopen period</button>
            : <button className={'abtn ' + (missing.length ? '' : 'red')} disabled={busy} onClick={() => (!missing.length || window.confirm(`${missing.length} shifts still have missing times. Close anyway?`)) && close(true)}>
              {missing.length ? `Close pay period · fix ${missing.length} first` : 'Close pay period'}</button>}
        </div>
      </div>
      {err && <p className="error">{err}</p>}

      <div className="kpi5">
        <div className="k"><small>SHIFTS</small><b>{past.length}</b></div>
        <div className="k"><small>HOURS</small><b>{hours}</b></div>
        <div className={'k' + (missing.length ? ' redk' : '')}><small>MISSING TIMES</small><b>{missing.length}</b></div>
        <div className={'k' + (flagged.length ? ' amber' : '')}><small>LATE / EARLY</small><b>{flagged.length}</b></div>
        <div className="k"><small>NO-SHOWS</small><b>{noShows.length}</b></div>
      </div>

      {missing.length > 0 && (
        <section className="stack">
          <div className="sec"><span className="serif">Fix before closing</span><span className="muted sm">type the time · saves as edited by you</span></div>
          <div className="adm-card" style={{ padding: '4px 16px' }}>
            {missing.map((r) => (
              <div key={r.s.id} className="need">
                <div className="grow"><b>{r.s.staff?.full_name} · {dLabel(r.e.event_date)} · {r.e.title}</b>
                  <span>{r.s.punches?.punch_in ? `Start ${tTime(r.s.punches.punch_in)} · end not punched` : 'No times entered'}</span></div>
                {times(r)}
              </div>
            ))}
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <section className="stack">
          <div className="sec"><span className="serif">Notes from managers</span></div>
          <div className="adm-card" style={{ padding: '4px 16px' }}>
            {notes.map((r) => <div key={r.s.id} className="need"><span>📝</span><div className="grow"><b>{r.s.staff?.full_name} · {dLabel(r.e.event_date)} · {r.e.title}</b><span>{r.s.manager_note}</span></div></div>)}
          </div>
        </section>
      )}

      <section className="stack">
        <div className="sec"><span className="serif">By person</span><span className="muted sm">tap a name to see each shift</span></div>
        <div className="adm-card table-card">
          <table className="atable">
            <thead><tr><th>Name</th><th>Shifts</th><th>Hours</th><th>Flags</th></tr></thead>
            <tbody>
              {events === null && <tr><td colSpan={4} className="muted">Loading…</td></tr>}
              {people.map((x) => {
                const fl = x.rows.flatMap((r) => flagsOf(r.s).map(flagText));
                const miss = x.rows.some((r) => missing.includes(r));
                return (
                  <Fragment key={x.id}>
                    <tr className="click" onClick={() => setOpen(open === x.id ? null : x.id)}>
                      <td className="strong">{x.name}</td><td>{x.rows.length}</td><td>{x.hours}{miss ? <span className="accent"> + ?</span> : ''}</td>
                      <td>{fl.length ? <span className="ftag">{fl.join(' · ')}</span> : <span className="muted">—</span>}</td>
                    </tr>
                    {open === x.id && x.rows.map((r) => (
                      <tr key={r.s.id} className="sub"><td>{dLabel(r.e.event_date)} · {r.e.title}</td><td colSpan={2}>{times(r)}</td>
                        <td>{hoursBetween(r.s.punches?.punch_in ?? null, r.s.punches?.punch_out ?? null) || ''} {flagsOf(r.s).map((f) => <span key={f.flag} className="ftag">{flagText(f)}</span>)}</td></tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="muted sm">Hours copy to the Staff Payroll sheet every night at 5 AM. After closing, run payroll as usual (RBC file, Cost of Labour in QuickBooks).</p>
    </div>
  );
}
