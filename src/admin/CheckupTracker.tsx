import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dLabel, tTime, isoDay, type AStaff } from './api';

type Row = { staff_id: string; checkup_done_at: string | null; checkup_step: number; has_emergency: boolean; last_seen_at: string | null; last_sign_in_at: string | null; usual_week_skipped?: boolean };
type Filter = 'notyet' | 'done' | 'skipped' | 'week' | 'never';

/** "last opened" = the later of last_seen_at (from push 31, app load) and the auth last sign-in. */
export const lastOpened = (r?: Pick<Row, 'last_seen_at' | 'last_sign_in_at'> | null) =>
  [r?.last_seen_at, r?.last_sign_in_at].filter(Boolean).sort().pop() ?? null;
const when = (iso: string) => { const d = isoDay(new Date(iso)); return `${d === isoDay(new Date()) ? 'today' : dLabel(d, { month: 'short', day: 'numeric' })} ${tTime(iso)}`; };

/** PROFILE CHECK-UP card on admin Staff (push 31c): n of N done + bar, chips, list. */
export function CheckupTracker({ staff, onOpen }: { staff: AStaff[]; onOpen: (s: AStaff) => void }) {
  const [rows, setRows] = useState<Record<string, Row> | null>(null); const [err, setErr] = useState('');
  const [next, setNext] = useState<Record<string, string>>({});
  const [f, setF] = useState<Filter>('notyet'); const [all, setAll] = useState(false);
  // Nov 6 · fold away (remembered on this computer)
  const [fold, setFold] = useState(() => { try { return localStorage.getItem('gr_cu_fold') === '1'; } catch { return false; } });
  const tog = () => { setFold(!fold); try { localStorage.setItem('gr_cu_fold', fold ? '0' : '1'); } catch { /* private mode */ } };
  useEffect(() => {
    supabase.rpc('admin_checkup_overview').then(({ data, error }) => {
      if (error) { setErr(/function|schema|exist/i.test(error.message) ? 'Needs migration 036 (not applied yet).' : error.message); return; }
      setRows(Object.fromEntries(((data ?? []) as Row[]).map((r) => [r.staff_id, r])));
    });
    const today = isoDay(new Date());
    supabase.from('shifts').select('staff_id,events!inner(event_date)').neq('status', 'declined').is('attendance', null).gte('events.event_date', today)
      .then(({ data }) => { const m: Record<string, string> = {}; for (const r of (data ?? []) as unknown as { staff_id: string; events: { event_date: string } }[]) if (!m[r.staff_id] || r.events.event_date < m[r.staff_id]) m[r.staff_id] = r.events.event_date; setNext(m); });
  }, []);
  const active = staff.filter((s) => s.active);
  if (err) return <div className="adm-card cu-tr"><span className="kick">PROFILE CHECK-UP</span><span className="muted sm">{err}</span></div>;
  if (!rows) return <div className="adm-card cu-tr"><span className="kick">PROFILE CHECK-UP</span><span className="muted sm">Loading…</span></div>;
  const r = (s: AStaff) => rows[s.id];
  const done = active.filter((s) => r(s)?.checkup_done_at);
  const skipped = done.filter((s) => !r(s)?.has_emergency);
  const skippedWeek = active.filter((s) => r(s)?.usual_week_skipped); // push 34d · "Skip for now" on step 5, no day set since
  const never = active.filter((s) => !r(s)?.checkup_done_at && !r(s)?.last_seen_at); // hasn't opened the app since the check-up went live
  const notYet = active.filter((s) => !r(s)?.checkup_done_at);
  const pct = active.length ? Math.round((done.length / active.length) * 100) : 0;
  const list = (f === 'done' ? done : f === 'skipped' ? skipped : f === 'week' ? skippedWeek : f === 'never' ? never : notYet).slice().sort((a, b) => {
    if (f === 'done' || f === 'skipped' || f === 'week') return (r(b)?.checkup_done_at ?? '').localeCompare(r(a)?.checkup_done_at ?? '');
    return (next[a.id] ?? '9999').localeCompare(next[b.id] ?? '9999') || a.full_name.localeCompare(b.full_name, 'fr');
  });
  const shown = all ? list : list.slice(0, 8);
  return (
    <div className="adm-card cu-tr">
      <button type="button" className="cu-tr-h" onClick={tog} aria-expanded={!fold}><span className="kick">PROFILE CHECK-UP</span><span className="grow" /><b className="sm">{done.length} of {active.length} done</b><span className="muted">{fold ? '▾' : '▴'}</span></button>
      <div className="cu-tr-bar"><span style={{ width: pct + '%' }} /></div>
      {!fold && <>
      <div className="cu-tr-chips">
        <button className={'c-done' + (f === 'done' ? ' on' : '')} onClick={() => setF('done')}>Done {done.length}</button>
        <button className={'c-skip' + (f === 'skipped' ? ' on' : '')} onClick={() => setF('skipped')}>Skipped emergency contact {skipped.length}</button>
        <button className={'c-skip' + (f === 'week' ? ' on' : '')} onClick={() => setF('week')}>Skipped usual week {skippedWeek.length}</button>
        <button className={'c-never' + (f === 'never' ? ' on' : '')} onClick={() => setF('never')}>Not opened the app yet {never.length}</button>
        <button className={'c-all' + (f === 'notyet' ? ' on' : '')} onClick={() => setF('notyet')}>All not done {notYet.length}</button>
      </div>
      <div className="cu-tr-list">
        {shown.map((s) => {
          const x = r(s); const lo = lastOpened(x);
          const sub = x?.checkup_done_at ? when(x.checkup_done_at) + (x.has_emergency ? '' : ' · no emergency contact') + (x.usual_week_skipped ? ' · skipped usual week' : '')
            : [next[s.id] ? `booked ${dLabel(next[s.id], { month: 'short', day: 'numeric' })}` : 'nothing booked', lo ? `last opened ${dLabel(isoDay(new Date(lo)), { month: 'short', day: 'numeric' })}` : 'never opened', x?.last_seen_at && (x.checkup_step ?? 1) > 1 ? (x.checkup_step >= 8 ? 'at the last step' : `at step ${Math.min(6, x.checkup_step)}`) : ''].filter(Boolean).join(' · ');
          return (
            <button key={s.id} className="cu-tr-row" onClick={() => onOpen(s)}>
              <span className="grow"><b>{s.full_name}</b><span className="muted"> · {sub}</span></span>
              {x?.checkup_done_at ? <i className="cu-tag ok">✓ DONE</i> : <i className="cu-tag">NOT YET</i>}
            </button>
          );
        })}
        {!list.length && <div className="muted sm" style={{ padding: '8px 0' }}>Nobody here.</div>}
        {list.length > 8 && <button className="lnk sm" style={{ alignSelf: 'flex-start' }} onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${list.length}`}</button>}
      </div>
      <span className="muted sm">They do it the next time they open the app, so most will be done by their next shift. No texts are sent from here.</span>
      </>}
    </div>
  );
}
