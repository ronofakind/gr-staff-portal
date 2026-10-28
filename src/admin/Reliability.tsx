import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, isoDay, flagsOf, flagText, dLabel, type AEvent, type AShift, type Flag } from './api';

type Item = { e: AEvent; s: AShift; flag: Flag; min?: number; nth: number };
const FILTERS: [string, Flag[] | null][] = [['All', null], ['No-shows', ['no_show']], ['Cancels', ['cancelled']], ['Late', ['late']], ['Early starts', ['early']]];

export function Reliability() {
  const today = isoDay(new Date());
  const [events, setEvents] = useState<AEvent[] | null>(null);
  const [f, setF] = useState(0); const [q, setQ] = useState('');
  const load = () => eventsBetween(today.slice(0, 4) + '-01-01', today).then(setEvents);
  useEffect(() => { load(); }, []);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const e of events ?? []) for (const s of e.shifts) for (const x of flagsOf(s)) out.push({ e, s, ...x, nth: 0 });
    out.sort((a, b) => a.e.event_date.localeCompare(b.e.event_date));
    const count = new Map<string, number>();
    for (const it of out) { const k = it.s.staff_id + it.flag; count.set(k, (count.get(k) ?? 0) + 1); it.nth = count.get(k)!; }
    return out.reverse();
  }, [events]);
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
              <div className="row" style={{ gap: 8 }}><b>{it.s.staff?.full_name}</b><span className={'ftag ' + it.flag}>{flagText(it)}</span></div>
              <span>{dLabel(it.e.event_date)} · {it.e.title}{it.s.manager_note ? ` · “${it.s.manager_note}”` : ''}</span>
              <span className={it.nth > 1 ? 'accent strong' : ''}>{ord(it.nth)}</span>
            </div>
            <Link className="abtn sm" to={`/admin/day?d=${it.e.event_date}`}>Open</Link>
            {(it.flag === 'no_show' || it.flag === 'cancelled') && <button className="abtn sm" onClick={() => clear(it)}>Remove</button>}
          </div>
        ))}
      </div>
      <p className="muted sm">No-shows and cancels come from the manager’s screen. Late = started more than 10 min after their call. Early start = started more than 3 h before.</p>
    </div>
  );
}
