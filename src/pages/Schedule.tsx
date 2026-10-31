import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { time } from '../lib/format';
import { TabBar } from '../components/TabBar';
import { ampm15 } from '../components/TimeWheel';
import { todayIso, isBar } from './Home';

type S = { id: string; status: 'booked' | 'confirmed' | 'declined'; position_code: string | null; position_detail: string | null;
  planned_start: string; planned_end: string | null; time_tbc: boolean; events: { event_date: string; title: string } };

const D = (iso: string) => new Date(iso + 'T12:00:00');
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const add = (s: string, n: number) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const monday = (s: string) => add(s, -((D(s).getDay() + 6) % 7));
const short = (s: string) => D(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
const DOW = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const hrs = (s: S) => !s.time_tbc && s.planned_end ? (new Date(s.planned_end).getTime() - new Date(s.planned_start).getTime()) / 3600e3 : 0;
const role = (s: S) => s.position_code === 'MD' ? 'MD' : s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : isBar(s.position_code, null) ? 'Bar' : 'Waiter';

export function Schedule({ me, base = '', preview = false }: { me: Staff; base?: string; preview?: boolean }) {
  const lang = useLang(); const today = todayIso();
  const [mode, setMode] = useState<'week' | 'month'>(() => { try { return (localStorage.getItem('gr_sched') as 'week' | 'month') || 'week'; } catch { return 'week'; } });
  const [anchor, setAnchor] = useState(today);
  const [sel, setSel] = useState(today);
  const [rows, setRows] = useState<S[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [daysOff, setDaysOff] = useState<{ from_date: string; to_date: string; reason: string | null }[]>([]);
  const [usualNo, setUsualNo] = useState<Set<number>>(new Set()); const [usualYes, setUsualYes] = useState<Record<number, string | null>>({});
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // Days off from the calendar: tap a day, tap a second day for a range, tap a picked day to clear.
  const [picking, setPicking] = useState(false); const [pickA, setPickA] = useState<string | null>(null); const [pickB, setPickB] = useState<string | null>(null);
  const [pickReason, setPickReason] = useState(''); const [pickErr, setPickErr] = useState<string | null>(null); const [savingOff, setSavingOff] = useState(false);
  const [savedOff, setSavedOff] = useState<{ id: string; label: string } | null>(null);

  const range = useMemo(() => {
    if (mode === 'week') { const a = monday(anchor); return { from: a, to: add(a, 6) }; }
    const first = anchor.slice(0, 8) + '01'; const a = monday(first);
    const last = iso(new Date(D(first).getFullYear(), D(first).getMonth() + 1, 0));
    return { from: a, to: add(monday(last), 6), first, last };
  }, [mode, anchor]);

  useEffect(() => { try { localStorage.setItem('gr_sched', mode); } catch { /* ignore */ } }, [mode]);
  const [tick, setTick] = useState(0); const reload = () => setTick((t) => t + 1);
  useEffect(() => {
    setRows(null);
    Promise.all([
      supabase.from('shifts').select('id,status,position_code,position_detail,planned_start,planned_end,time_tbc,events!inner(event_date,title)')
        .eq('staff_id', me.id).neq('status', 'declined').gte('events.event_date', range.from).lte('events.event_date', range.to),
      supabase.from('availability').select('for_date,status').eq('staff_id', me.id).eq('status', 'no').gte('for_date', range.from).lte('for_date', range.to),
      supabase.from('days_off').select('from_date,to_date,reason').eq('staff_id', me.id).lte('from_date', range.to).gte('to_date', range.from),
      supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', me.id),
      supabase.from('avail_exceptions').select('for_date').eq('staff_id', me.id).gte('for_date', range.from).lte('for_date', range.to),
    ]).then(([s, a, o, w, x]) => {
      setOpened(new Set((x.data ?? []).map((r) => r.for_date as string)));
      setDaysOff((o.data ?? []) as typeof daysOff);
      const wk = (w.data ?? []) as { dow: number; status: string; from_time: string | null }[];
      setUsualNo(new Set(wk.filter((r) => r.status === 'no').map((r) => r.dow)));
      setUsualYes(Object.fromEntries(wk.filter((r) => r.status !== 'no').map((r) => [r.dow, r.from_time ? r.from_time.slice(0, 5) : null])));
      setRows(((s.data ?? []) as unknown as S[]).sort((x, y) => x.planned_start.localeCompare(y.planned_start)));
      setOff(new Set((a.data ?? []).map((r) => r.for_date as string)));
    });
  }, [range.from, range.to, me.id, tick]);

  const pickFrom = pickA && pickB ? (pickA < pickB ? pickA : pickB) : pickA; const pickTo = pickA && pickB ? (pickA < pickB ? pickB : pickA) : pickA;
  const picked = (day: string) => !!pickFrom && !!pickTo && day >= pickFrom && day <= pickTo;
  const pickDays = pickFrom && pickTo ? (D(pickTo).getTime() - D(pickFrom).getTime()) / 864e5 + 1 : 0;
  const tapPick = (day: string, booked: boolean) => {
    if (booked || day < today) return;
    setPickErr(null);
    if (picked(day) && pickB) { setPickA(day); setPickB(null); return; } // tap inside a range → restart from that day
    if (pickA === day && !pickB) { setPickA(null); return; }
    if (!pickA) { setPickA(day); return; }
    if (!pickB) { const lo = pickA < day ? pickA : day, hi = pickA < day ? day : pickA;
      for (let d = lo; d <= hi; d = add(d, 1)) if ((byDay[d] ?? []).length) { setPickErr(`You're booked on ${short(d)}. Pick around it, or talk to Ronnie.`); return; }
      setPickB(day); return; }
    setPickA(day); setPickB(null);
  };
  const startPick = () => { setPicking(true); setPickA(null); setPickB(null); setPickReason(''); setPickErr(null); setSavedOff(null); setMode('month'); };
  const stopPick = () => { setPicking(false); setPickA(null); setPickB(null); setPickErr(null); };
  const saveOff = async () => {
    if (preview || !pickFrom || !pickTo || savingOff) return; setSavingOff(true);
    const { data, error } = await supabase.from('days_off').insert({ staff_id: me.id, from_date: pickFrom, to_date: pickTo, reason: pickReason.trim() || null }).select('id').single();
    setSavingOff(false);
    if (error) { setPickErr(error.message.includes('booked') ? "You're booked on one of these days. Talk to Ronnie." : error.message); return; }
    setDaysOff((o) => [...o, { from_date: pickFrom, to_date: pickTo, reason: pickReason.trim() || null }]);
    setSavedOff({ id: data.id, label: pickFrom === pickTo ? short(pickFrom) : `${short(pickFrom)} – ${short(pickTo)}` }); setSel(pickFrom); stopPick();
  };
  const undoOff = async () => { if (!savedOff || preview) return; await supabase.from('days_off').delete().eq('id', savedOff.id); setSavedOff(null); reload(); };
  const removeOff = async (o: { from_date: string; to_date: string }) => { if (preview) return; await supabase.from('days_off').delete().eq('staff_id', me.id).eq('from_date', o.from_date).eq('to_date', o.to_date); setDaysOff((d) => d.filter((x) => x !== o)); };
  const offOn = (day: string) => daysOff.find((o) => o.from_date <= day && o.to_date >= day);
  const usuallyNo = (day: string) => usualNo.has((D(day).getDay() + 6) % 7) && !opened.has(day);
  const isOpened = (day: string) => opened.has(day) && usualNo.has((D(day).getDay() + 6) % 7);
  const usualFree = (day: string) => { const d = (D(day).getDay() + 6) % 7; return day >= today && d in usualYes && !offOn(day) && !off.has(day) ? <span className="usual-free"><b>{usualYes[d] ? `Free from ${ampm15(usualYes[d])}` : 'Free · any time'}</b><small>your usual week · not booked</small></span> : null; };
  const dowName = (day: string) => D(day).toLocaleDateString('en-CA', { weekday: 'long' });
  const openDay = async (day: string, on: boolean) => {
    if (preview) return;
    const next = new Set(opened); if (on) next.add(day); else next.delete(day); setOpened(next);
    if (on) await supabase.from('avail_exceptions').upsert({ staff_id: me.id, for_date: day });
    else await supabase.from('avail_exceptions').delete().eq('staff_id', me.id).eq('for_date', day);
  };
  const offLabel = (o: { from_date: string; to_date: string }) => o.from_date === o.to_date ? D(o.from_date).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' }).replace('.', '')
    : `${D(o.from_date).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' }).replace('.', '')} – ${D(o.to_date).toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' }).replace('.', '')}`;
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
              <div key={day} className={'agenda-row' + (isToday ? ' today' : '') + (!list.length && !isToday ? ' empty' : '') + (asking ? ' ask' : '') + (!list.length && offOn(day) ? ' dayoff' : '') + (!list.length && !offOn(day) && usuallyNo(day) && day >= today ? ' usualoff' : '')}>
                <div className="d"><small>{dw}</small><b>{D(day).getDate()}</b></div>
                <div className="what">
                  {list.length === 0 && <span className="none">{offOn(day) ? <><b className="off-tag">DAY OFF</b>{offOn(day)!.reason ?? ''}</> : off.has(day) ? 'Unavailable' : usuallyNo(day) ? <><b>Not free</b><small>Your usual {dowName(day)}</small></> : isOpened(day) ? <span className="opened-tag">✓ Opened up</span> : usualFree(day) ?? '—'}</span>}
                  {list.map((s) => (
                    <Link key={s.id} to={`${base}/shift/${s.id}`}>
                      <b>{s.events.title}</b>
                      <span>{s.time_tbc ? 'Time TBC' : time(s.planned_start, lang)} · {role(s)}</span>
                    </Link>
                  ))}
                </div>
                <div className="right">
                  {!list.length && !offOn(day) && usuallyNo(day) && day >= today && <button className="can-work" onClick={() => openDay(day, true)}>I can work</button>}
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
          {savedOff && <div className="off-saved"><span><b>Days off saved</b> · {savedOff.label}</span><button className="link-btn" onClick={undoOff}>Undo</button></div>}
          {picking ? (
            <div className="pick-hint"><b>Tap a day, or tap two days for a range.</b> Tap a picked day to clear it.</div>
          ) : (
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
              <span className="muted sm">Tap a day for details</span>
              <button className="days-off-btn" onClick={startPick}>+ Days off</button>
            </div>
          )}
          <section className={'month' + (picking ? ' picking' : '')}>
            <div className="heads">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((h, i) => <span key={i}>{h}</span>)}</div>
            <div className="grid">
              {Array.from({ length: (D(range.to).getTime() - D(range.from).getTime()) / 864e5 + 1 }, (_, i) => add(range.from, i)).map((day) => {
                const list = byDay[day] ?? [];
                const out = day < range.first! || day > range.last!;
                let c = 'mcell';
                if (out) c += ' out';
                else if (list.length) c += day < today ? ' done' : list.some((s) => s.status === 'booked') ? ' ask' : ' ok';
                else if (offOn(day)) c += ' dayoff';
                else if (off.has(day)) c += ' off';
                else if (usuallyNo(day) && day >= today) c += ' usualno';
                else if (isOpened(day) && day >= today) c += ' opened';
                else if (day < today) c += ' past';
                if (day === today) c += ' today';
                if (day === sel && !out && !picking) c += ' sel';
                if (picking && !out) { if (picked(day)) c += ' picked' + (day === pickFrom ? ' pf' : '') + (day === pickTo ? ' pt' : ''); else if (list.length || day < today) c += ' nopick'; }
                return <button key={day} className={c} onClick={() => !out && (picking ? tapPick(day, list.length > 0) : setSel(day))} aria-label={day}><span className="n">{D(day).getDate()}</span>{!out && !list.length && offOn(day) ? <span className="off-mark">OFF</span> : <span className="u" />}</button>;
              })}
            </div>
          </section>
          {picking && (
            <div className="save-bar pick-bar">
              <div className="grow">
                <b style={{ color: 'var(--ink)', fontSize: 16 }} className="serif">{pickFrom && pickTo ? <>{pickFrom === pickTo ? short(pickFrom) : `${short(pickFrom)} – ${short(pickTo)}`} <span className="muted sm">· {pickDays} day{pickDays > 1 ? 's' : ''}</span></> : 'Pick your days off'}</b>
                {pickErr ? <span style={{ color: 'var(--accent)' }}>{pickErr}</span> : <input className="av-note" value={pickReason} onChange={(e) => setPickReason(e.target.value)} placeholder="Reason (optional)" />}
              </div>
              <button className="undo" onClick={stopPick}>Cancel</button>
              <button className="save" disabled={!pickFrom || savingOff} onClick={saveOff}>{savingOff ? 'Saving…' : 'Save days off'}</button>
            </div>
          )}
          {picking ? (
            <div className="legend">
              <span><i style={{ background: 'var(--accent)' }} /><b>Picked</b> · day off</span>
              <span><i style={{ background: 'var(--ok)', opacity: .35 }} />Booked · can’t pick</span>
            </div>
          ) : (
          <div className="legend">
            <span><i style={{ background: 'var(--ok)' }} />Confirmed</span>
            <span><i style={{ border: '2px dashed var(--accent)', background: '#fff' }} />To confirm</span>
            <span><i style={{ background: '#EDE7DF' }} />Worked</span>
            <span><i className="stripe" />Day off</span>
            <span><i style={{ background: '#DDD5CA' }} />Not free (usual week)</span>
            <span><i style={{ background: '#fff', boxShadow: 'inset 0 0 0 2px var(--ok)' }} />Opened up</span>
          </div>
          )}
          <div className="sec-head"><span className="serif">{D(sel).toLocaleDateString('en-CA', { weekday: 'long', day: 'numeric' })}</span><span className="muted sm">{inView.length} shifts · {total} hrs this month</span></div>
          {(byDay[sel] ?? []).length === 0 && (offOn(sel) ? (
            <div className="dayoff-card"><div className="grow"><small>DAY OFF · {offLabel(offOn(sel)!).toUpperCase()}</small><div className="serif">{offOn(sel)!.reason || 'Day off'}</div></div><button className="link-btn" style={{ color: 'var(--accent)' }} onClick={() => removeOff(offOn(sel)!)}>Remove</button></div>
          ) : usuallyNo(sel) && sel >= today ? (
            <div className="usual-card">
              <small>{D(sel).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</small>
              <div className="serif">You’re usually not free on {dowName(sel)}s</div>
              <p>Open this day if you can work it. Ronnie will be able to ask you and book you. Your usual week stays the same.</p>
              <button className="big-btn" style={{ background: 'var(--ok)', color: '#fff', justifyContent: 'center' }} onClick={() => openDay(sel, true)}>I can work this day</button>
            </div>
          ) : isOpened(sel) && sel >= today ? (
            <div className="card row" style={{ gap: 10 }}><span className="opened-tag">✓ Opened up</span><span className="grow muted sm">You can be asked and booked this {dowName(sel)}.</span><button className="link-btn" onClick={() => openDay(sel, false)}>Undo</button></div>
          ) : usualFree(sel) ? <div className="card">{usualFree(sel)}</div> : <div className="card muted sm">{off.has(sel) ? 'Unavailable' : 'No shift'}</div>)}
          {(byDay[sel] ?? []).map((s) => (
            <Link key={s.id} to={`${base}/shift/${s.id}`} className="day-card">
              <div className="grow"><small>{s.time_tbc ? 'Time TBC' : time(s.planned_start, lang)} · {role(s)}{s.status === 'booked' ? ' · to confirm' : ''}</small><div className="serif">{s.events.title}</div></div>
              <span className="go">›</span>
            </Link>
          ))}
        </>
      )}
      {picking && <div style={{ height: 120 }} />}
      <TabBar base={base} />
    </main>
  );
}
