import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { time } from '../lib/format';
import { TabBar } from '../components/TabBar';
import { todayIso, isBar } from './Home';

type S = { id: string; status: 'booked' | 'confirmed' | 'declined'; position_code: string | null; position_detail: string | null;
  planned_start: string; planned_end: string | null; events: { event_date: string; title: string } };

const D = (iso: string) => new Date(iso + 'T12:00:00');
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const add = (s: string, n: number) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const monday = (s: string) => add(s, -((D(s).getDay() + 6) % 7));
const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const hrs = (s: S) => s.planned_end ? (new Date(s.planned_end).getTime() - new Date(s.planned_start).getTime()) / 3600e3 : 0;
const role = (s: S) => s.position_code === 'MD' ? 'MD' : s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : isBar(s.position_code, null) ? 'Bar' : 'Waiter';

export function Schedule({ me, base = '', preview = false }: { me: Staff; base?: string; preview?: boolean }) {
  const lang = useLang(); const today = todayIso();
  const [mode, setMode] = useState<'week' | 'month'>(() => { try { return (localStorage.getItem('gr_sched') as 'week' | 'month') || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(today);
  const [sel, setSel] = useState(today);
  const [rows, setRows] = useState<S[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());

  const range = useMemo(() => {
    if (mode === 'week') { const a = monday(anchor); return { from: a, to: add(a, 6) }; }
    const first = anchor.slice(0, 8) + '01'; const a = monday(first);
    const last = iso(new Date(D(first).getFullYear(), D(first).getMonth() + 1, 0));
    return { from: a, to: add(monday(last), 6), first, last };
  }, [mode, anchor]);

  useEffect(() => { try { localStorage.setItem('gr_sched', mode); } catch { /* ignore */ } }, [mode]);
  useEffect(() => {
    setRows(null);
    Promise.all([
      supabase.from('shifts').select('id,status,position_code,position_detail,planned_start,planned_end,events!inner(event_date,title)')
        .eq('staff_id', me.id).neq('status', 'declined').gte('events.event_date', range.from).lte('events.event_date', range.to),
      supabase.from('availability').select('for_date,status').eq('staff_id', me.id).eq('status', 'no').gte('for_date', range.from).lte('for_date', range.to),
    ]).then(([s, a]) => {
      setRows(((s.data ?? []) as unknown as S[]).sort((x, y) => x.planned_start.localeCompare(y.planned_start)));
      setOff(new Set((a.data ?? []).map((r) => r.for_date as string)));
    });
  }, [range.from, range.to, me.id]);

  const byDay = useMemo(() => { const m: Record<string, S[]> = {}; for (const r of rows ?? []) (m[r.events.event_date] ??= []).push(r); return m; }, [rows]);
  const step = (n: number) => {
    if (mode === 'week') setAnchor(add(anchor, 7 * n));
    else { const d = D(anchor.slice(0, 8) + '01'); d.setMonth(d.getMonth() + n); setAnchor(iso(d)); }
  };
  const respond = async (id: string) => {
    if (preview) return;
    await supabase.rpc('respond_to_shift', { p_shift: id, p_response: 'confirmed' });
    setRows((r) => (r ?? []).map((x) => (x.id === id ? { ...x, status: 'confirmed' } : x)));
  };

  const short = (s: string) => D(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  const title = mode === 'week' ? `${short(range.from)} – ${short(range.to)}`
    : D(range.first!).toLocaleDateString('en-CA', { month: 'long' });
  const inView = (rows ?? []).filter((r) => mode === 'week' || (r.events.event_date >= range.first! && r.events.event_date <= range.last!));
  const total = Math.round(inView.reduce((n, r) => n + hrs(r), 0));
  const asks = inView.filter((r) => r.status === 'booked').length;

  return (
    <main className="page v2">
      <div className="sched-head">
        <div>
          <div className="kicker">{mode === 'week' ? (monday(today) === range.from ? 'This week' : 'Week') : D(range.first!).getFullYear()}</div>
          <div className="serif" style={{ fontSize: 30, lineHeight: 1.05 }}>{title}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="round" aria-label="Previous" onClick={() => step(-1)}>‹</button>
          <button className="round" aria-label="Next" onClick={() => step(1)}>›</button>
        </div>
      </div>

      <div className="seg" role="tablist">
        <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Week</button>
        <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
      </div>

      <div className="sumbar">
        <div><b>{inView.length}</b><span>shift{inView.length === 1 ? '' : 's'}</span></div>
        <div><b>{total ? `~${total}` : 0}</b><span>hours</span></div>
        <div className={asks ? 'red' : ''}><b>{asks}</b><span>to confirm</span></div>
      </div>

      {rows === null ? <div className="loading" style={{ minHeight: 300 }} /> : mode === 'week' ? (
        <section className="agenda">
          {DOW.map((dw, i) => {
            const day = add(range.from, i); const list = byDay[day] ?? []; const isToday = day === today;
            const asking = list.some((s) => s.status === 'booked');
            return (
              <div key={day} className={'agenda-row' + (isToday ? ' today' : '') + (!list.length && !isToday ? ' empty' : '') + (asking ? ' ask' : '')}>
                <div className="d"><small>{dw}</small><b>{D(day).getDate()}</b></div>
                <div className="what">
                  {list.length === 0 && <span className="none">{off.has(day) ? 'Unavailable' : '—'}</span>}
                  {list.map((s) => (
                    <Link key={s.id} to={`${base}/shift/${s.id}`}>
                      <b>{s.events.title}</b>
                      <span>{time(s.planned_start, lang)}{s.planned_end ? ` – ${time(s.planned_end, lang)}` : ''} · {role(s)}</span>
                    </Link>
                  ))}
                </div>
                <div className="right">
                  {isToday && <span className="tag-today">TODAY</span>}
                  {list.map((s) => day < today ? <span key={s.id} className="tag-done">Worked</span>
                    : s.status === 'confirmed' ? <span key={s.id} className="tag-ok">✓ Confirmed</span>
                    : <button key={s.id} className="tag-ask" onClick={() => respond(s.id)}>Confirm ›</button>)}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <>
          <section className="month">
            <div className="heads">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => <span key={i}>{h}</span>)}</div>
            <div className="grid">
              {Array.from({ length: (D(range.to).getTime() - D(range.from).getTime()) / 864e5 + 1 }, (_, i) => add(range.from, i)).map((day) => {
                const list = byDay[day] ?? [];
                const out = day < range.first! || day > range.last!;
                let c = 'mcell';
                if (out) c += ' out';
                else if (list.length) c += day < today ? ' done' : list.some((s) => s.status === 'booked') ? ' ask' : ' ok';
                else if (off.has(day)) c += ' off';
                else if (day < today) c += ' past';
                if (day === today) c += ' today';
                if (day === sel && !out) c += ' sel';
                return <button key={day} className={c} onClick={() => !out && setSel(day)} aria-label={day}><span className="n">{D(day).getDate()}</span><span className="u" /></button>;
              })}
            </div>
          </section>
          <div className="legend">
            <span><i style={{ background: 'var(--ok)' }} />Confirmed</span>
            <span><i style={{ border: '2px dashed var(--accent)', background: '#fff' }} />To confirm</span>
            <span><i style={{ background: '#EDE7DF' }} />Worked</span>
            <span><s style={{ color: '#C9BFB2' }}>30</s>Off</span>
          </div>
          <div className="sec-head"><span className="serif">{D(sel).toLocaleDateString('en-CA', { weekday: 'long', day: 'numeric' })}</span><span className="muted sm">{inView.length} shifts · {total} hrs this month</span></div>
          {(byDay[sel] ?? []).length === 0 && <div className="card muted sm">{off.has(sel) ? 'Unavailable' : 'No shift'}</div>}
          {(byDay[sel] ?? []).map((s) => (
            <Link key={s.id} to={`${base}/shift/${s.id}`} className="day-card">
              <div className="grow"><small>{time(s.planned_start, lang)}{s.planned_end ? ` – ${time(s.planned_end, lang)}` : ''} · {role(s)}{s.status === 'booked' ? ' · to confirm' : ''}</small><div className="serif">{s.events.title}</div></div>
              <span className="go">›</span>
            </Link>
          ))}
        </>
      )}
      <TabBar base={base} />
    </main>
  );
}
