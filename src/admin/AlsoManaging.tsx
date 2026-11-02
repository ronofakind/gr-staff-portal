import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SwipeSheet } from '../components/SwipeSheet';
import { Avatar } from '../components/Avatar';
import { ap12, roleName, type AEvent } from './api';

type P = { id: string; full_name: string; photo_url: string | null; positions: string[] | null };
const first = (n: string) => n.split(' ')[0];
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Toronto' });

/** push 39 · Check-in managers: the lead (events.manager_id, from the MD / BM line) + "Also managing" co-managers (events.co_manager_ids, migration 037).
 *  Only people already on this event row can be picked. Saves this event row only (floor and bar are separate rows). */
export function AlsoManaging({ ev, onSaved }: { ev: AEvent; onSaved?: () => void }) {
  const [co, setCo] = useState<string[] | null>(null);
  const [people, setPeople] = useState<Record<string, P>>({});
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(''); const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  const onEvent = ev.shifts.filter((s) => s.status !== 'declined' && s.attendance !== 'cancelled' && !s.cancelled_at && s.staff_id);
  useEffect(() => {
    supabase.from('events').select('co_manager_ids').eq('id', ev.id).single()
      .then(({ data, error }) => { if (error) { setErr(error.message); setCo([]); } else setCo(((data as { co_manager_ids: string[] | null } | null)?.co_manager_ids) ?? []); });
  }, [ev.id]);
  useEffect(() => {
    if (co === null) return;
    const ids = [...new Set([...onEvent.map((s) => s.staff_id), ...co, ...(ev.manager_id ? [ev.manager_id] : [])])].filter((id) => !people[id]);
    if (!ids.length) return;
    supabase.from('staff').select('id,full_name,photo_url,positions').in('id', ids)
      .then(({ data }) => setPeople((m) => ({ ...m, ...Object.fromEntries(((data ?? []) as P[]).map((p) => [p.id, p])) })));
  }, [co, ev.id, ev.shifts.length]);

  const save = async (next: string[]) => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('events').update({ co_manager_ids: next }).eq('id', ev.id);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    setCo(next); onSaved?.(); return true;
  };
  const shiftOf = (id: string) => onEvent.find((s) => s.staff_id === id);
  const nameOf = (id: string) => people[id]?.full_name ?? shiftOf(id)?.staff?.full_name ?? '…';
  const is2ic = (id: string) => shiftOf(id)?.position_code?.toUpperCase() === '2IC' || (people[id]?.positions ?? []).some((p) => p.toUpperCase() === '2IC');
  const leadShift = ev.manager_id ? shiftOf(ev.manager_id) : undefined;
  const leadCode = leadShift?.position_code === 'BM' ? 'BM' : 'MD';

  // Candidates: on this event row, not the lead, not already managing; 2IC first, then by start time, then A–Z.
  const seen = new Set<string>();
  const cands = onEvent.filter((s) => s.staff_id !== ev.manager_id && !(co ?? []).includes(s.staff_id) && !seen.has(s.staff_id) && seen.add(s.staff_id))
    .sort((a, b) => Number(is2ic(b.staff_id)) - Number(is2ic(a.staff_id)) || a.planned_start.localeCompare(b.planned_start) || nameOf(a.staff_id).localeCompare(nameOf(b.staff_id), 'fr', { sensitivity: 'base' }));
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const shown = cands.filter((s) => !q.trim() || norm(nameOf(s.staff_id)).includes(norm(q.trim())));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const close = () => { setOpen(false); setPicked([]); setQ(''); };
  const add = async () => { if (await save([...(co ?? []), ...picked])) close(); };
  const remove = (id: string) => { if (window.confirm(`Remove ${first(nameOf(id))} as manager? The shift stays as it is.`)) save((co ?? []).filter((x) => x !== id)); };

  return (
    <div className="am">
      <div className="am-list">
        {ev.manager_id ? (
          <div className="am-row">
            <span className="am-av lead"><Avatar name={nameOf(ev.manager_id)} url={people[ev.manager_id]?.photo_url} size={44} /></span>
            <span className="grow"><b>{nameOf(ev.manager_id)}</b><small>{leadCode} · from the {leadCode} line · gets the submit reminder</small></span>
            <span className="am-lead">LEAD</span>
          </div>
        ) : <div className="am-row"><span className="grow"><b>No lead yet</b><small>The lead comes from the MD (or BM) line. Book one in the Day view.</small></span></div>}
        {(co ?? []).map((id) => (
          <div key={id} className="am-row">
            <span className="am-av"><Avatar name={nameOf(id)} url={people[id]?.photo_url} size={44} /></span>
            <span className="grow"><b>{nameOf(id)}</b><small>Also managing · start, end, submit{!shiftOf(id) ? ' · not on this event anymore' : ''}</small></span>
            <button className="am-rm" disabled={busy} onClick={() => remove(id)}>Remove</button>
          </div>
        ))}
      </div>
      <button className="am-add no-print" disabled={co === null} onClick={() => setOpen(true)}>＋ Also managing</button>
      <div className="muted sm">The lead comes from the {leadCode} line as today. Here you add a second manager from the people on this event: same tools, same team, either one can submit.</div>
      {err && <p className="error">{err}</p>}

      {open && <>
        <div className="scrim" onClick={close} />
        <SwipeSheet onClose={close} label="Who else is managing?" back onBack={close}>
          <div className="serif am-title">Who else is managing?</div>
          <input className="as-search" type="search" autoComplete="off" autoCorrect="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name" />
          <div className="am-kick">On this event{ev.department === 'bar' ? ' · bar' : ''}</div>
          {shown.length > 0 ? <div className="as-list">{shown.map((s) => {
            const on = picked.includes(s.staff_id);
            return (
              <button key={s.staff_id} className={'as-opt am-opt' + (on ? ' on' : '')} onClick={() => toggle(s.staff_id)} aria-pressed={on}>
                <Avatar name={nameOf(s.staff_id)} url={people[s.staff_id]?.photo_url} size={36} />
                <span className="grow"><b>{nameOf(s.staff_id)}</b><small>{s.position_detail?.replace(/^bar\s*-\s*/i, '') || roleName(s.position_code ?? 'W')} · {ap12(hm(s.planned_start))}</small></span>
                {is2ic(s.staff_id) && <span className="am-2ic">2IC</span>}
                <span className={'am-ck' + (on ? ' on' : '')} aria-hidden="true">{on ? '✓' : ''}</span>
              </button>
            );
          })}</div> : <div className="muted sm">{cands.length ? 'No one by that name on this event.' : 'Everyone on this event is already a manager, or no one is booked yet.'}</div>}
          {err && <p className="error">{err}</p>}
          <button className="btn-ink" style={{ height: 52 }} disabled={!picked.length || busy} onClick={add}>
            {busy ? 'Saving…' : picked.length > 1 ? `Add ${picked.length} as managers` : picked.length === 1 ? `Add ${first(nameOf(picked[0]))} as manager` : 'Pick someone'}
          </button>
        </SwipeSheet>
      </>}
    </div>
  );
}
