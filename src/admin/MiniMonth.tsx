import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { addDays, isoDay, countOf, sendStateOf, type AEvent } from './api';

/* Push 60 · Today → "This month" (board TodayMonthV1, compact v2). Small month on the left: date + one dot per event
   (amber = short). Click a date → its events on the right: venue · start · manager · booked/needed · SEND. Opens on today. */
const monday = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };
const firstOf = (iso: string) => iso.slice(0, 8) + '01';
const addMonths = (iso: string, n: number) => { const d = new Date(firstOf(iso) + 'T12:00:00'); d.setMonth(d.getMonth() + n); return isoDay(d); };
const nameOf = (e: AEvent & { venues?: { name: string } | null }) => e.venues?.name ?? e.title;
const tShort = (t: string | null) => { if (!t) return ''; const [h, m] = t.slice(0, 5).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const first = (n?: string | null) => (n ?? '').split(' ')[0];

const LIGHT = 'id,event_date,title,department,start_time,staff_needed,staffing,manager_id,shifts(id,status,cancelled_at,attendance,notified_at,changed_at,responded_at)';
export function MiniMonth() {
  const today = isoDay(new Date());
  const [mo, setMo] = useState(firstOf(today));
  const [sel, setSel] = useState(today);
  const [evs, setEvs] = useState<AEvent[] | null>(null);
  const [mgr, setMgr] = useState<Record<string, string>>({});
  const last = addDays(addMonths(mo, 1), -1);
  const start = monday(mo);
  const weeks = Math.ceil((new Date(last + 'T12:00:00').getTime() - new Date(start + 'T12:00:00').getTime()) / (7 * 864e5) + 1 / 7);
  useEffect(() => {
    let live = true; setEvs(null);
    // light query: only what the dots, counts and SEND need (the full event select took ~12 s for a month)
    supabase.from('events').select(LIGHT).gte('event_date', mo).lte('event_date', last).order('event_date').order('start_time').then(({ data, error }) => {
      if (!live) return; if (error) { setEvs([]); return; }
      const r = (data ?? []) as unknown as AEvent[]; setEvs(r);
      const ids = [...new Set(r.map((e) => e.manager_id).filter(Boolean))] as string[];
      if (ids.length) supabase.from('staff').select('id,full_name,nickname').in('id', ids).then(({ data }) => live && setMgr(Object.fromEntries(((data ?? []) as { id: string; full_name: string; nickname: string | null }[]).map((s) => [s.id, s.nickname || first(s.full_name)]))));
    });
    return () => { live = false; };
  }, [mo, last]);
  const go = (n: number) => { const m = addMonths(mo, n); setMo(m); setSel(m === firstOf(today) ? today : m); };
  const by = (d: string) => (evs ?? []).filter((e) => e.event_date === d);
  const days = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  const list = by(sel);
  const short = list.reduce((n, e) => n + countOf(e).short, 0);
  const label = new Date(mo + 'T12:00:00').toLocaleDateString('en-CA', { month: 'long' });
  return (
    <div className="adm-card mm">
      <div className="mm-cal">
        <div className="mm-head"><b style={{ textTransform: 'capitalize' }}>{label}</b><button className="mm-nav" aria-label="Previous month" onClick={() => go(-1)}>‹</button><button className="mm-nav" aria-label="Next month" onClick={() => go(1)}>›</button><span className="grow" /><small><i className="mm-dot" /> booked · <i className="mm-dot short" /> short</small></div>
        <div className="mm-grid">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="mm-wd">{d}</span>)}
          {days.map((d) => {
            if (d < mo || d > last) return <span key={d} />;
            const e = by(d); const past = d < today;
            return (
              <button key={d} type="button" className={'mm-d' + (d === sel ? ' sel' : '') + (past ? ' past' : '') + (e.length ? ' has' : '')} onClick={() => setSel(d)} aria-label={`${d} · ${e.length} events`}>
                <b className={d === today ? 'today' : ''}>{Number(d.slice(8))}</b>
                <span className="mm-dots">{e.slice(0, 4).map((x) => <i key={x.id} className={'mm-dot' + (!past && countOf(x).short ? ' short' : '')} />)}</span>
              </button>);
          })}
        </div>
      </div>
      <div className="mm-day">
        <div className="mm-dh"><b className="serif">{new Date(sel + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</b>{short > 0 && sel >= today && <span className="mm-short">{short} short</span>}</div>
        {evs === null ? <small className="muted">Loading…</small> : !list.length ? <small className="muted">No events.</small> : <>
          <small className="muted">{list.length} event{list.length > 1 ? 's' : ''} · tap one to open its bookings</small>
          {list.map((e) => { const c = countOf(e); const st = sel >= today ? sendStateOf(e, today) : 'none'; return (
            <Link key={e.id} className="mm-ev" to={`/admin/bookings?date=${sel}&view=board&ev=${e.id}`}>
              <span className="grow"><b>{e.department === 'bar' && <i className="mm-bar" />}{nameOf(e)}</b><small>{[tShort(e.start_time), e.manager_id ? mgr[e.manager_id] : ''].filter(Boolean).join(' · ')}</small></span>
              <b className={c.short && sel >= today ? 'amber' : ''}>{c.booked}/{c.need || c.n}</b>
              {st === 'ready' ? <b className="mm-send">SEND</b> : st === 'later' ? <span className="mm-o">○</span> : st === 'sent' ? <span className="mm-ok">✓</span> : null}
              <span className="muted">›</span>
            </Link>); })}
        </>}
        <Link className="mm-open" to={`/admin/day?d=${sel}`}>Open this day ›</Link>
      </div>
    </div>
  );
}
