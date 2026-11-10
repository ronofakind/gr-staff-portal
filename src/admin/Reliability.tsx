import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, isoDay, flagsOf, flagText, dLabel, loadLateDecisions, setLateDecision, type AEvent, type AShift, type Flag } from './api';

type Item = { e: AEvent; s: AShift; flag: Flag; min?: number; nth: number; free?: boolean; told?: boolean };
const FILTERS: [string, Flag[] | null][] = [['All', null], ['No-shows', ['no_show']], ['Cancels', ['cancelled']], ['Late', ['late']], ['Early starts', ['early']]];

export function Reliability() {
  const today = isoDay(new Date());
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [f, setF] = useState(0); const [q, setQ] = useState('');
  const [eta, setEta] = useState<Record<string, string>>({}); const [tick, setTick] = useState(0);
  const load = () => {
    Promise.all([eventsBetween(today.slice(0, 4) + '-01-01', today), loadLateDecisions()]).then(([e]) => setEvents(e));
    // push 28e · "told ahead" (late_notices is new in 034: errors → none)
    supabase.from('late_notices').select('shift_id,eta').then(({ data, error }) => { if (!error && Array.isArray(data)) setEta(Object.fromEntries((data as { shift_id: string; eta: string }[]).map((x) => [x.shift_id, x.eta]))); });
  };
  useEffect(() => { load(); }, []);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const e of events ?? []) for (const s of e.shifts) for (const x of flagsOf({ ...s, late_eta: eta[s.id] ?? null })) out.push({ e, s, ...x, nth: 0 });
    out.sort((a, b) => a.e.event_date.localeCompare(b.e.event_date));
    const count = new Map<string, number>();
    for (const it of out) { if (it.free) continue; const k = it.s.staff_id + it.flag; count.set(k, (count.get(k) ?? 0) + 1); it.nth = count.get(k)!; }
    return out.reverse();
  }, [events, eta, tick]);
  const shown = items.filter((it) => (!FILTERS[f][1] || FILTERS[f][1]!.includes(it.flag)) && (!q || (it.s.staff?.full_name ?? '').toLowerCase().includes(q.toLowerCase())));
  const clear = async (it: Item) => {
    if (!window.confirm(`Remove the ${flagText(it).toLowerCase()} for ${it.s.staff?.full_name}?`)) return;
    await supabase.from('shifts').update({ attendance: null }).eq('id', it.s.id); load();
  };
  const ord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} this year`;

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="kick">RELIABILITY · {today.slice(0, 4)}</div><h1 className="serif-h">Flags, newest first</h1></div>
        <input className="search" placeholder="Search a name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {FILTERS.map(([label, fl], i) => <button key={label} className={'chipb' + (f === i ? ' on' : '')} onClick={() => setF(i)}>{label} <span>{fl ? items.filter((x) => fl.includes(x.flag)).length : items.length}</span></button>)}
      </div>
      <div className="adm-card" style={{ padding: '4px 16px' }}>
        {events === null && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
        {events && !shown.length && <div className="muted" style={{ padding: 12 }}>Nothing here.</div>}
        {shown.map((it) => (
          <div key={it.s.id + it.flag} className="need">
            <div className="grow">
              <div className="row" style={{ gap: 8 }}><b>{it.s.staff?.full_name}</b><span className={'ftag ' + it.flag}>{flagText(it)}</span>
                {it.flag === 'cancelled' && it.s.cancel_self && <span className="ftag cancelled">{it.s.cancel_late ? 'AFTER CONFIRMING' : 'BEFORE CONFIRMING'}</span>}
                {it.told && <span className="ftag early">TOLD AHEAD</span>}{it.free && <span className="muted sm">not counted</span>}</div>
              <span>{dLabel(it.e.event_date)} · {it.e.title}{it.s.cancel_reason ? ` · ${it.s.cancel_reason}` : ''}{it.s.manager_note ? ` · “${it.s.manager_note}”` : ''}</span>
              {!it.free && <span className={it.nth > 1 ? 'accent strong' : ''}>{ord(it.nth)}</span>}
            </div>
            <Link className="abtn sm" to={`/admin/day?d=${it.e.event_date}`}>Open</Link>
            {it.flag === 'late' && <LateDecide shiftId={it.s.id} counted={!it.free} onChange={() => setTick((t) => t + 1)} />}
            {(it.flag === 'no_show' || it.flag === 'cancelled') && <button className="abtn sm" onClick={() => clear(it)}>Remove</button>}
          </div>
        ))}
      </div>
      <p className="muted sm">No-shows and cancels come from the manager’s screen and from staff “Can’t make it”. Late cancel = cancelled after they confirmed; a cancel before confirming is listed but not counted. Late = started more than 30 min after their call (30 min and under is not counted); not counted when they said “I’m running late” and started by the time they gave. Early start = a manager started them before the call time.</p>
    </div>
  );
}

/** push 57 · count this late arrival in their reliability, or not. Saved per shift (084); the score updates on the next load. */
/** counted null = not decided yet (Today): neither button is lit. */
export function LateDecide({ shiftId, counted, onChange }: { shiftId: string; counted: boolean | null; onChange: (counted: boolean) => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const pick = async (c: boolean) => {
    if (c === counted || busy) return;
    setBusy(true); setErr('');
    const e = await setLateDecision(shiftId, c ? 'count' : 'skip');
    setBusy(false); if (e) { setErr(/late_decisions/.test(e.message) ? 'needs 084' : 'not saved'); return; }
    onChange(c);
  };
  return (
    <span className="ld-seg" title="Count this late arrival in their reliability score?">
      <button className={counted === true ? 'on red' : ''} disabled={busy} onClick={() => pick(true)}>Count it</button>
      <button className={counted === false ? 'on' : ''} disabled={busy} onClick={() => pick(false)}>Don’t count</button>
      {err && <small className="error">{err}</small>}
    </span>
  );
}
