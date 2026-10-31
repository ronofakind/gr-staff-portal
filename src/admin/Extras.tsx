import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { DeptTag } from './DeptTag';
import { EVENT_SELECT, EVENT_SELECT_28, allStaff, dLabel, tTime, hoursBetween, type AEvent, type AShift, type AStaff } from './api';
import { hoursBefore, replacementOf } from './Changes';

/* Push 28f · Extras & cancellations per event row (replaces the 6:00 PM Slack question).
   1 · Extras: ordered vs worked vs extras vs billed; proposal = the n non-lead people with the fewest hours come off the invoice
       (MD / BM never; client pays extras → nobody). 2 · Cancellations: automatic + "+ Add"; CLIENT CUT is logged only.
   3 · What the invoice gets. Confirm → event_adjustments.confirmed_at; the Events-sheet script appends it to EXTRAS LOG. */

export type Adj = { event_id: string; extras_removed: string[]; client_cuts: Cut[]; cancellations: Manual[]; no_changes: boolean; note: string | null;
  confirmed_at: string | null; logged_at: string | null; logged_text: string | null; auto: boolean };
type Cut = { count: number; names: string; note?: string | null };
type Manual = { name: string; kind: 'late' | 'no_show' | 'early'; note?: string | null };

const lead = (s: AShift) => s.position_code === 'MD' || s.position_code === 'BM';
const worked = (s: AShift) => s.status !== 'declined' && !s.attendance && !!s.punches?.punch_in && !!s.punches?.punch_out;
const paidH = (s: AShift) => hoursBetween(s.punches?.punch_in ?? null, s.punches?.punch_out ?? null, !!s.left_early);
/** Client order without the MD / BM: the staffing lines, else staff_needed minus the lead. */
export const orderedOf = (e: AEvent) => { const lines = (e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code)); const n = lines.reduce((x, l) => x + (Number(l.count) || 0), 0);
  return n || Math.max(0, e.staff_needed - (e.shifts.some((s) => lead(s) && s.status !== 'declined') ? 1 : 0)); };
export const clientPays = (e: AEvent, clientBill?: string | null) => (e.extras_billing ?? clientBill ?? 'gr') === 'client';
/** The app's proposal (same rule as extras_proposal() in 034): shift ids, fewest paid hours first, ties by name. */
export function proposal(e: AEvent, clientBill?: string | null) {
  const w = e.shifts.filter((s) => worked(s) && !lead(s)).sort((a, b) => paidH(a) - paidH(b) || (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? ''));
  if (clientPays(e, clientBill)) return [];
  return w.slice(0, Math.max(0, w.length - orderedOf(e))).map((s) => s.id);
}
type CRow = { key: string; kind: 'late' | 'no_show' | 'early' | 'client_cut' | 'removed'; who: string; line: string; when: string; bill: string; manual?: number };
/** Cancellations for an event, filled in by itself. */
export function cancellationsOf(e: AEvent, removed: { name: string; at: string }[] = []): CRow[] {
  const out: CRow[] = [];
  for (const s of e.shifts) {
    const who = s.staff?.full_name ?? '?'; const rep = replacementOf(e, s); const repTxt = rep ? `replaced by ${rep.staff?.full_name ?? '?'}` : 'not replaced';
    if (s.attendance === 'no_show') out.push({ key: s.id, kind: 'no_show', who, line: `${s.cancel_self ? `cancelled in the app${s.cancel_reason ? ` · “${s.cancel_reason.toLowerCase()}”` : ''} · sent to the manager` : s.attendance_reason ? `“${s.attendance_reason}”` : 'marked by the manager'} · ${repTxt}`,
      when: s.cancel_sent_to_manager ? `sent ${tTime(s.cancel_sent_to_manager)}` : '', bill: 'not billed · reliability −−' });
    else if (s.attendance === 'cancelled' && s.cancel_self) out.push({ key: s.id, kind: s.cancel_late ? 'late' : 'early', who,
      line: `in the app${s.cancel_reason ? `: “${s.cancel_reason.toLowerCase()}”` : ''}${s.cancel_note ? ` · ${s.cancel_note}` : ''} · ${repTxt}`,
      when: s.cancelled_at ? `cancelled ${dLabel(s.cancelled_at.slice(0, 10), { weekday: 'short' })} ${tTime(s.cancelled_at)} · ${hoursBefore(s.cancelled_at, s.planned_start)}` : '',
      bill: s.cancel_late ? 'not billed · reliability −' : 'not billed' });
    else if (s.attendance === 'cancelled') out.push({ key: s.id, kind: 'late', who, line: `marked by the manager${s.attendance_reason ? ` · “${s.attendance_reason}”` : ''} · ${repTxt}`, when: '', bill: 'not billed · reliability −' });
  }
  for (const r of removed) out.push({ key: 'rm' + r.name + r.at, kind: 'removed', who: r.name, line: 'removed in Bookings', when: `${dLabel(r.at.slice(0, 10), { weekday: 'short' })} ${tTime(r.at)}`, bill: 'not billed' });
  return out;
}
/** One line for the Needs you card: "3 extras · 1 late cancel · 1 no-show". */
export function summaryOf(e: AEvent, clientBill?: string | null) {
  const x = proposal(e, clientBill).length; const c = cancellationsOf(e);
  const n = (k: CRow['kind']) => c.filter((r) => r.kind === k).length;
  return [x ? `${x} extra${x > 1 ? 's' : ''}` : clientPays(e, clientBill) ? 'client pays extras' : 'no extras', n('late') && `${n('late')} late cancel`, n('no_show') && `${n('no_show')} no-show`, n('early') && `${n('early')} early cancel`].filter(Boolean).join(' · ');
}
const KIND: Record<CRow['kind'], [string, string]> = { late: ['STAFF · LATE', 'red'], no_show: ['NO-SHOW', 'red'], early: ['STAFF · EARLY', ''], client_cut: ['CLIENT CUT', 'gold'], removed: ['REMOVED', ''] };

export function Extras() {
  const { id } = useParams(); const nav = useNavigate();
  const [e, setE] = useState<AEvent | null | undefined>(undefined);
  const [adj, setAdj] = useState<Adj | null>(null); const [noTable, setNoTable] = useState(false);
  const [bill, setBill] = useState<string | null>(null); const [client, setClient] = useState<string | null>(null);
  const [staff, setStaff] = useState<Record<string, AStaff>>({});
  const [removed, setRemoved] = useState<{ name: string; at: string }[]>([]);
  const [off, setOff] = useState<Set<string> | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]); const [manual, setManual] = useState<Manual[]>([]);
  const [add, setAdd] = useState<{ name: string; kind: Manual['kind'] | 'client_cut'; count: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const q = (sel: string) => supabase.from('events').select(sel).eq('id', id!).maybeSingle();
      let r = await q(EVENT_SELECT_28); if (r.error) r = await q(EVENT_SELECT);
      const ev = (r.data as unknown as AEvent | null) ?? null; setE(ev); if (!ev) return;
      const [a, st, cl, log] = await Promise.all([
        supabase.from('event_adjustments').select('event_id,extras_removed,client_cuts,cancellations,no_changes,note,confirmed_at,logged_at,logged_text,auto').eq('event_id', ev.id).maybeSingle(),
        allStaff(),
        ev.event_private?.client_id ? supabase.from('clients').select('name,extras_billing').eq('id', ev.event_private.client_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from('change_log').select('at,change').eq('entity', 'shift').contains('change', { kind: 'removed', from: ev.id }),
      ]);
      setStaff(Object.fromEntries(st.map((s) => [s.id, s])));
      const c = cl.data as { name: string; extras_billing: string | null } | null; setBill(c?.extras_billing ?? null); setClient(c?.name ?? ev.event_private?.client ?? null);
      setRemoved(((log.data ?? []) as { at: string; change: { staff?: string } }[]).map((x) => ({ name: st.find((s) => s.id === x.change?.staff)?.full_name ?? 'Someone', at: x.at })));
      if (a.error) { setNoTable(true); setOff(new Set(proposal(ev, c?.extras_billing))); return; }
      const ad = a.data as Adj | null; setAdj(ad);
      setOff(new Set(ad?.confirmed_at || ad?.logged_at ? ad.extras_removed ?? [] : proposal(ev, c?.extras_billing)));
      setCuts(Array.isArray(ad?.client_cuts) ? ad!.client_cuts : []); setManual(Array.isArray(ad?.cancellations) ? ad!.cancellations : []);
    })();
  }, [id]);

  const pays = e ? clientPays(e, bill) : false;
  const rows = useMemo(() => (e ? e.shifts.filter(worked).sort((a, b) => Number(lead(b)) - Number(lead(a)) || paidH(a) - paidH(b) || (a.staff?.full_name ?? '').localeCompare(b.staff?.full_name ?? '')) : []), [e]);
  if (e === undefined || off === null && e) return <div className="muted">Loading…</div>;
  if (!e) return <div className="adm-card muted">Event not found. <Link to="/admin">Back to Today</Link></div>;
  const ordered = orderedOf(e); const team = rows.filter((s) => !lead(s)); const leads = rows.filter(lead);
  const extras = pays ? Math.max(0, team.length - ordered) : off!.size; const billed = team.length - (pays ? 0 : off!.size);
  const prop = new Set(proposal(e, bill));
  const auto = cancellationsOf(e, removed);
  const all: CRow[] = [...auto,
    ...manual.map((m, i) => ({ key: 'm' + i, kind: m.kind, who: m.name, line: m.note ?? 'added by Ronnie', when: '', bill: m.kind === 'early' ? 'not billed' : m.kind === 'no_show' ? 'not billed · reliability −−' : 'not billed · reliability −', manual: i })),
    ...cuts.map((c, i) => ({ key: 'c' + i, kind: 'client_cut' as const, who: `${c.count} ${c.count === 1 ? 'person' : 'people'}`, line: `${c.names}${c.note ? ` · ${c.note}` : ''}`, when: client ?? '', bill: 'Logged · bill by hand', manual: i }))];
  const cutN = cuts.reduce((n, c) => n + (Number(c.count) || 0), 0);
  const name = (s: AShift) => s.staff?.full_name ?? '?';
  const tierOf = (s: AShift) => staff[s.staff_id]?.staff_private?.tier ?? null;
  const offH = team.filter((s) => off!.has(s.id)).reduce((n, s) => n + paidH(s), 0);
  const billH = team.filter((s) => !off!.has(s.id) || pays).reduce((n, s) => n + paidH(s), 0);
  const logLine = (none: boolean) => none ? 'None' : [off!.size && !pays ? `${off!.size} extra${off!.size > 1 ? 's' : ''} on G&R (${team.filter((s) => off!.has(s.id)).map(name).sort().join(', ')})` : '', cutN ? `${cutN} cut by client · bill by hand` : ''].filter(Boolean).join(' · ') || 'None';
  const locked = !!adj?.logged_at;

  const save = async (none: boolean) => {
    if (noTable) { setMsg('Migration 034 is not applied yet: nothing saved.'); return; }
    setBusy(true); setMsg('');
    const { data: me } = await supabase.rpc('me');
    const row = { event_id: e.id, extras_removed: none || pays ? [] : [...off!], client_cuts: none ? [] : cuts, cancellations: none ? [] : manual, no_changes: none,
      confirmed_at: new Date().toISOString(), confirmed_by: typeof me === 'string' && /^[0-9a-f-]{36}$/.test(me) ? me : null, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('event_adjustments').upsert(row, { onConflict: 'event_id' });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setAdj({ ...(adj ?? { logged_at: null, logged_text: null, auto: false, note: null }), ...row } as Adj);
    setMsg(`✓ Confirmed · goes to the EXTRAS LOG tab: “${logLine(none)}”`);
  };
  const addRow = () => {
    if (!add) return;
    if (add.kind === 'client_cut') { const n = Math.max(1, Number(add.count) || 1); setCuts([...cuts, { count: n, names: add.name.trim() || `${n} cut`, note: add.note.trim() || null }]); }
    else if (add.name.trim()) setManual([...manual, { name: add.name.trim(), kind: add.kind, note: add.note.trim() || null }]);
    setAdd(null);
  };
  const dropRow = (r: CRow) => { if (r.manual == null) return; if (r.kind === 'client_cut') setCuts(cuts.filter((_, i) => i !== r.manual)); else setManual(manual.filter((_, i) => i !== r.manual)); };
  const cutFromRemoved = (r: CRow) => setCuts([...cuts, { count: 1, names: r.who, note: `removed ${r.when}` }]);

  return (
    <div className="stack-lg ex">
      <div className="toolbar">
        <div><div className="kick">EXTRAS &amp; CANCELLATIONS</div>
          <h1 className="serif-h">{e.title}</h1>
          <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}><span className="muted sm">{dLabel(e.event_date, { weekday: 'short', month: 'short', day: 'numeric' })}{client ? ` · ${client}` : ''}</span><DeptTag dept={e.department} /><Link className="sm" to={`/admin/event/${e.id}`}>Event page ›</Link></div></div>
        {adj?.confirmed_at && <span className="tag ok">✓ Confirmed {tTime(adj.confirmed_at)}</span>}
        {locked && <span className="tag">In EXTRAS LOG{adj?.auto ? ' · app proposal' : ''}</span>}
      </div>
      {noTable && <div className="bk-warn gold">Migration 034 isn’t applied yet: this screen shows the proposal but can’t save.</div>}

      <section className="adm-card stack">
        <div className="spread"><b className="serif ex-h">1 · Extras</b><span className="muted sm">client ordered {ordered} · {team.length} worked</span></div>
        <div className="ex-tiles">
          <div><small>ORDERED</small><b>{ordered}</b><span>{e.department === 'bar' ? 'bar staff' : 'waiters'} · client</span></div>
          <div><small>WORKED</small><b>{team.length}</b><span>from the app hours</span></div>
          <div className="gold"><small>EXTRAS</small><b>{extras}</b><span>{pays ? 'client pays · billed' : 'on G&R · not billed'}</span></div>
          <div className="dark"><small>BILLED</small><b>{billed}</b><span>lines on {e.event_private?.qb_doc_number ? `invoice ${e.event_private.qb_doc_number}` : 'the invoice'}</span></div>
        </div>
        {pays ? <div className="muted sm">Client pays extras on this event: nobody comes off the invoice.</div>
          : <div className="sm">Off the invoice = the <b>{prop.size} {e.department === 'bar' ? 'people' : 'waiters'} with the fewest hours</b> (keeps the client’s cost lowest). Tick to swap someone.</div>}
        <table className="ex-t"><thead><tr><th /><th /><th>PERSON</th><th>TIMES</th><th>HOURS</th><th>INVOICE</th></tr></thead><tbody>
          {team.map((s) => { const o = off!.has(s.id) && !pays; return (
            <tr key={s.id} className={o ? 'off' : ''}>
              <td><input type="checkbox" aria-label={`${name(s)} off the invoice`} disabled={pays || locked} checked={o} onChange={(x) => { const n = new Set(off); if (x.target.checked) n.add(s.id); else n.delete(s.id); setOff(n); }} /></td>
              <td>{tierOf(s) && <i className={'ex-tier t' + tierOf(s)}>{tierOf(s)}</i>}</td>
              <td><b>{name(s)}</b>{s.replacement_for && <small className="muted"> · replacement</small>}</td>
              <td className="muted">{tTime(s.punches!.punch_in)} – {tTime(s.punches!.punch_out)}</td>
              <td>{paidH(s)}</td>
              <td>{o ? <span className="gold strong">✓ off the invoice</span> : <span className="muted">billed</span>}</td>
            </tr>); })}
          {leads.map((s) => <tr key={s.id} className="lead"><td /><td /><td><b>{name(s)}</b> <small className="muted">{s.position_code} · never removed</small></td><td className="muted">{tTime(s.punches!.punch_in)} – {tTime(s.punches!.punch_out)}</td><td>{paidH(s)}</td><td className="muted">billed</td></tr>)}
          {!rows.length && <tr><td colSpan={6} className="muted">No hours in the app yet.</td></tr>}
        </tbody></table>
        <div className="muted sm">Extras switch is from New event → Billing (On G&amp;R / Client pays). Client pays → nobody is removed. MD / BM never removed. They’re still paid.</div>
      </section>

      <section className="adm-card stack">
        <div className="spread"><b className="serif ex-h">2 · Cancellations</b><span className="muted sm">what happened before and during the event</span></div>
        {!all.length && <div className="muted sm">No cancellations.</div>}
        {all.map((r) => (
          <div key={r.key} className="ex-c">
            <span className={'ex-k ' + KIND[r.kind][1]}>{KIND[r.kind][0]}</span>
            <div className="grow"><b>{r.who}</b><span>{r.line}</span></div>
            <span className="muted sm ex-when">{r.when}</span>
            <span className={'sm ex-bill' + (r.kind === 'client_cut' ? ' gold' : '')}>{r.bill}</span>
            {r.kind === 'removed' && !locked && <button className="abtn sm" onClick={() => cutFromRemoved(r)}>Client cut?</button>}
            {r.manual != null && !locked && <button className="abtn sm" aria-label="Remove" onClick={() => dropRow(r)}>×</button>}
          </div>
        ))}
        {add ? (
          <div className="ex-add">
            <select value={add.kind} onChange={(x) => setAdd({ ...add, kind: x.target.value as Manual['kind'] | 'client_cut' })}>
              <option value="late">Staff · late</option><option value="no_show">No-show</option><option value="early">Staff · early</option><option value="client_cut">Client cut</option></select>
            {add.kind === 'client_cut' && <input type="number" min={1} value={add.count} onChange={(x) => setAdd({ ...add, count: x.target.value })} style={{ width: 64 }} aria-label="How many" />}
            <input value={add.name} onChange={(x) => setAdd({ ...add, name: x.target.value })} placeholder={add.kind === 'client_cut' ? 'Who (e.g. Laura, Theodora)' : 'Name'} />
            <input value={add.note} onChange={(x) => setAdd({ ...add, note: x.target.value })} placeholder="Note (optional)" />
            <button className="abtn sm dark" onClick={addRow}>Add</button><button className="abtn sm" onClick={() => setAdd(null)}>Cancel</button>
          </div>
        ) : !locked && <button className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAdd({ name: '', kind: 'late', count: '1', note: '' })}>+ Add a cancellation</button>}
        <div className="muted sm">Filled in by itself from Bookings removals, staff “Can’t make it”, and managers’ no-show marks. <b>Late</b> = cancelled after they confirmed. <b>Client cut</b> is logged only: any 4 h billing is done by hand on the invoice.</div>
      </section>

      <section className="adm-card stack">
        <div className="spread"><b className="serif ex-h">3 · What the invoice gets</b><span className="muted sm">{e.event_private?.qb_doc_number ? `${e.event_private.qb_doc_type === 'estimate' ? 'Estimate' : 'Invoice'} ${e.event_private.qb_doc_number}` : 'No invoice # yet'}{client ? ` · ${client}` : ''} · {e.title}</span></div>
        <div className="ex-inv">
          {leads.map((s) => <div key={s.id}><span>{s.position_code === 'MD' ? 'Head Waiter' : 'Bar manager'} · {name(s).split(' ')[0]}</span><b>{paidH(s)} h</b><em>billed</em></div>)}
          <div><span>{e.department === 'bar' ? 'Bar staff' : 'Waiters'} · {billed} of {team.length} worked</span><b>{billH} h</b><em>billed</em></div>
          {cutN > 0 && <div className="gold"><span>Client cut · {cutN} · logged, billed by hand</span><b>—</b><em>by hand</em></div>}
          {!pays && off!.size > 0 && <div className="muted"><span>Extras · {off!.size} (on G&amp;R)</span><b>{offH} h</b><em>paid, not billed</em></div>}
          <div className="muted"><span>Admin fee {/brera/i.test(client ?? '') ? '8' : '10'}% · GST · QST</span><b /><em>recalculated</em></div>
        </div>
      </section>

      <div className="ex-foot">
        <div className="grow"><b>Confirm for the 5 AM invoice</b><span>Writes a line in the EXTRAS LOG tab (“{logLine(false)}”) and the 5 AM run applies it, as today. No reply by 5 AM = the app’s proposal is used.</span></div>
        <button className="abtn" disabled={busy || locked} onClick={() => save(true)}>No extras · no changes</button>
        <button className="abtn dark" disabled={busy || locked} onClick={() => save(false)}>{adj?.confirmed_at ? 'Confirm again' : 'Confirm'}</button>
      </div>
      {msg && <div className="bk-msg">{msg} <button className="lnk" onClick={() => nav('/admin')}>Back to Today ›</button></div>}
      {locked && <div className="muted sm">Logged in EXTRAS LOG{adj?.logged_text ? `: “${adj.logged_text}”` : ''}. Change it by hand in the sheet if needed.</div>}
    </div>
  );
}
