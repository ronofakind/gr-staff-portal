import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { eventsBetween, addDays, isoDay, flagsOf, flagText, periodOf, dLabel, tTime, type AEvent, type AShift } from './api';

type Need = { key: string; title: string; sub: string; action: string; to: string; red?: boolean };
type Arch = { key: string; sig: string; label: string | null; archived_at: string };
const sigOf = (n: Need) => n.title + '|' + n.sub;

export function Today() {
  const today = isoDay(new Date());
  const [week, setWeek] = useState<AEvent[] | null>(null);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [answers, setAnswers] = useState(0);
  const [missing, setMissing] = useState(0);
  const [arch, setArch] = useState<Arch[]>([]);
  const [showArch, setShowArch] = useState(false);
  const loadArch = () => supabase.from('admin_archive').select('key,sig,label,archived_at').order('archived_at', { ascending: false }).then(({ data }) => setArch((data ?? []) as Arch[]));

  useEffect(() => {
    loadArch();
    (async () => {
      const mon = addDays(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7));
      const [evs, ahead, ans] = await Promise.all([
        eventsBetween(mon, addDays(mon, 6)),
        eventsBetween(today, addDays(today, 14)),
        supabase.from('availability').select('id', { count: 'exact', head: true }).eq('status', 'yes').not('ask_id', 'is', null).gte('for_date', today),
      ]);
      setWeek(evs); setAnswers(ans.count ?? 0);
      // Missing end times in this + last pay period
      const cur = periodOf(today); const prev = periodOf(addDays(cur.start, -1));
      const past = await eventsBetween(prev.start, addDays(today, -1));
      const miss = past.flatMap((e) => e.shifts.filter((s) => !s.attendance && s.punches?.punch_in && !s.punches.punch_out).map((s) => ({ e, s })));
      setMissing(miss.length);

      const n: Need[] = [];
      // Flags from today and yesterday
      const recent = [...evs, ...past].filter((e) => e.event_date >= addDays(today, -1) && e.event_date <= today);
      const seen = new Set<string>();
      for (const e of recent) for (const s of e.shifts) {
        if (seen.has(s.id)) continue; seen.add(s.id);
        for (const f of flagsOf(s).filter((x) => x.flag !== 'early')) n.push({ key: s.id + f.flag, red: true, title: `⚑ ${s.staff?.full_name ?? '?'} · ${flagText(f).toLowerCase()}`, sub: `${e.event_date === today ? 'Today' : 'Yesterday'} · ${e.title}`, action: 'View', to: '/admin/reliability' });
      }
      for (const e of ahead.filter((x) => x.department !== 'bar')) {
        const booked = e.shifts.filter((s) => s.status !== 'declined').length;
        if (booked < e.staff_needed) n.push({ key: e.id + 'short', title: `${e.title} · ${dLabel(e.event_date)}`, sub: `Short ${e.staff_needed - booked} · ${booked} / ${e.staff_needed} booked`, action: 'Assign', to: `/admin/day?d=${e.event_date}` });
        const unsent = e.shifts.filter((s) => !s.notified_at || s.changed_at > s.notified_at).length;
        if (booked && unsent && e.event_date <= addDays(today, 7)) n.push({ key: e.id + 'send', title: `${e.title} · ${dLabel(e.event_date)}`, sub: `${unsent} not sent details yet`, action: 'Send', to: `/admin/day?d=${e.event_date}` });
      }
      if (miss.length) n.push({ key: 'miss', title: `Pay period ${dLabel(cur.start, { month: 'short', day: 'numeric' })} – ${dLabel(cur.end, { day: 'numeric' })}`, sub: `${miss.length} missing end time${miss.length > 1 ? 's' : ''}`, action: 'Fix', to: '/admin/hours' });
      const { data: hq } = await supabase.from('hours_questions').select('id,kind,claimed_at,shifts!inner(staff:staff!shifts_staff_id_fkey(full_name),events(title))').eq('status', 'open');
      for (const q of (hq ?? []) as unknown as { id: string; kind: string; shifts: { staff: { full_name: string }; events: { title: string } } }[])
        n.unshift({ key: 'q' + q.id, red: true, title: `Hours question · ${q.shifts.staff.full_name}`, sub: `${q.shifts.events.title} · about ${q.kind === 'other' ? 'something else' : q.kind + ' time'}`, action: 'Check', to: '/admin/hours' });
      setNeeds(n);
    })();
  }, []);

  const tonight = (week ?? []).filter((e) => e.event_date === today);
  const hidden = (n: Need) => arch.some((a) => a.key === n.key && a.sig === sigOf(n));
  const shown = needs.filter((n) => !hidden(n));
  const archivedToday = arch.filter((a) => isoDay(new Date(a.archived_at)) === today);
  const archive = async (list: Need[]) => {
    if (!list.length) return;
    await supabase.from('admin_archive').upsert(list.map((n) => ({ key: n.key, sig: sigOf(n), label: n.title + ' · ' + n.sub, archived_at: new Date().toISOString() })));
    loadArch();
  };
  const restore = async (key: string) => { await supabase.from('admin_archive').delete().eq('key', key); loadArch(); };
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const mon = addDays(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const floorShort = (week ?? []).filter((e) => e.department !== 'bar' && e.event_date >= today).reduce((n, e) => n + Math.max(0, e.staff_needed - e.shifts.filter((s) => s.status !== 'declined').length), 0);

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="kick">{dLabel(today, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</div><h1 className="serif-h">{hello}, Ronnie</h1></div>
        <div className="row wrap"><Link className="abtn" to="/admin/availability">Ask availability</Link><Link className="abtn dark" to="/admin/week">Open the week</Link></div>
      </div>

      <div className="kpi4">
        <div className="k dark"><small>TONIGHT</small><b>{tonight.length} <span>events · {tonight.reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0)} staff</span></b></div>
        <div className={'k' + (floorShort ? ' amber' : '')}><small>STILL SHORT THIS WEEK</small><b>{floorShort} <span>shifts</span></b></div>
        <Link to="/admin/availability" className="k"><small>AVAILABILITY ANSWERS</small><b>{answers} <span>said yes</span></b></Link>
        <Link to="/admin/hours" className={'k' + (missing ? ' amber' : '')}><small>HOURS TO REVIEW</small><b>{missing} <span>missing end times</span></b></Link>
      </div>

      <div className="two-col">
        <section className="stack">
          <div className="sec"><span className="serif">Tonight</span><Link to={`/admin/day?d=${today}`}>Open day view ›</Link></div>
          {week === null && <div className="muted">Loading…</div>}
          {week && !tonight.length && <div className="adm-card muted">No events today.</div>}
          {tonight.map((e) => <Live key={e.id} e={e} />)}
        </section>
        <section className="stack">
          <div className="sec"><span className="serif">Needs you <b className="accent sm">{shown.length || ''}</b></span>{shown.length > 0 && <button className="abtn sm" onClick={() => archive(shown)}>{ARCH_ICON} Archive all</button>}</div>
          <div className="adm-card" style={{ padding: '4px 16px' }}>
            {!shown.length && <div className="muted sm" style={{ padding: '12px 0' }}>All clear.</div>}
            {shown.slice(0, 12).map((x) => <NeedRow key={x.key} x={x} onArchive={() => archive([x])} />)}
          </div>
          {archivedToday.length > 0 && (
            <div className="arch-box">
              <button className="arch-toggle" onClick={() => setShowArch(!showArch)}>{showArch ? '▾' : '▸'} Archived today · {archivedToday.length}</button>
              {showArch && archivedToday.map((a) => <div key={a.key} className="arch-row"><span className="grow">{a.label}</span><button className="abtn sm" onClick={() => restore(a.key)}>Restore</button></div>)}
            </div>
          )}
          <div className="muted sm" style={{ padding: '0 6px' }}>Archiving only hides it here. It comes back if something new happens on it. On the phone, swipe a row left.</div>
          <div className="sec"><span className="serif">This week</span><Link to="/admin/week">Week ›</Link></div>
          <div className="strip">
            {weekDays.map((d) => {
              const evs = (week ?? []).filter((e) => e.event_date === d);
              const staff = evs.reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0);
              const short = evs.some((e) => e.department !== 'bar' && e.shifts.filter((s) => s.status !== 'declined').length < e.staff_needed);
              return (
                <Link key={d} to={`/admin/day?d=${d}`} className={'sd' + (d === today ? ' on' : '') + (short && d >= today ? ' short' : '')}>
                  <small>{dLabel(d, { weekday: 'short' }).toUpperCase()}</small><b>{Number(d.slice(8))}</b><span>{evs.length ? `${evs.length} · ${staff}` : '–'}</span>
                </Link>
              );
            })}
          </div>
          <div className="muted sm">events · staff booked. Amber = still short.</div>
        </section>
      </div>
    </div>
  );
}

function Live({ e }: { e: AEvent }) {
  const all = e.shifts.filter((s) => s.status !== 'declined');
  const now = Date.now();
  const firstStart = all.map((s) => new Date(s.planned_start).getTime()).sort((a, b) => a - b)[0] ?? 0;
  const started = all.some((s) => s.punches?.punch_in) || (firstStart && firstStart <= now);
  const md = all.find((s) => s.position_code === 'MD' || s.position_code === 'BM');
  const name = (s: AShift) => s.staff?.full_name ?? '?';
  let boxes: [number, string, string][]; let issues: [string, string, string][];
  if (!started) {
    const cancelled = all.filter((s) => s.attendance === 'cancelled');
    const team = all.filter((s) => !s.attendance);
    const conf = team.filter((s) => s.status === 'confirmed'); const unsure = team.filter((s) => s.status !== 'confirmed');
    boxes = [[team.length, 'booked', ''], [conf.length, 'confirmed', 'ok'], [unsure.length, 'unsure', unsure.length ? 'amber' : ''], [cancelled.length, 'cancelled', cancelled.length ? 'red' : '']];
    issues = [...cancelled.map((s) => ['red', name(s), 'cancelled'] as [string, string, string]), ...unsure.map((s) => ['amber', name(s), 'not confirmed yet'] as [string, string, string])];
  } else {
    const ns = all.filter((s) => s.attendance === 'no_show');
    const missing = all.filter((s) => !s.attendance && !s.punches?.punch_in && new Date(s.planned_start).getTime() < now);
    const lateIn = all.filter((s) => !s.attendance && flagsOf(s).some((f) => f.flag === 'late'));
    const late = [...missing, ...lateIn];
    const working = all.filter((s) => s.punches?.punch_in && !(s.punches.punch_out && new Date(s.punches.punch_out).getTime() <= now));
    const done = all.filter((s) => s.punches?.punch_out && new Date(s.punches.punch_out).getTime() <= now);
    const leaving = working.filter((s) => s.leave_by);
    boxes = [[working.length, 'working', 'ok'], [late.length, 'late', late.length ? 'amber' : ''], [ns.length, 'no-show', ns.length ? 'red' : ''], [done.length, 'done', '']];
    issues = [...ns.map((s) => ['red', name(s), 'no-show'] as [string, string, string]),
      ...missing.map((s) => ['amber', name(s), `not here · ${Math.round((now - new Date(s.planned_start).getTime()) / 60000)} min late`] as [string, string, string]),
      ...lateIn.map((s) => ['amber', name(s), `started ${tTime(s.punches!.punch_in)} · ${flagsOf(s)[0].min} min late`] as [string, string, string]),
      ...leaving.map((s) => ['grey', name(s), `leaves ~${tTime(s.leave_by)}`] as [string, string, string])];
  }
  const startsIn = Math.round((firstStart - now) / 60000);
  const phones = all.map((s) => s.staff?.phone?.replace(/[^\d+]/g, '')).filter(Boolean);
  return (
    <div className="adm-card stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 180 }}><div className="serif" style={{ fontSize: 22 }}>{e.title}</div>
          <div className="muted sm">{e.event_private?.client ? e.event_private.client + ' · ' : ''}{e.department === 'bar' ? 'Bar' : 'Floor'} · {ap(e.start_time) || 'TBC'}{e.ends_label ? ` · ends ${e.ends_label}` : e.end_time ? ` · ends ~ ${ap(e.end_time)}` : ''}{md ? ` · ${md.position_code} ${md.staff?.full_name.split(' ')[0]}` : ''}</div></div>
        {started ? <span className="tag ok">● live</span> : <span className="tag amber">in {Math.floor(startsIn / 60)} h {startsIn % 60} min</span>}
      </div>
      <div className="cnt4">{boxes.map(([n, l, c]) => <div key={l} className={c}><b>{n}</b><small>{l}</small></div>)}</div>
      {issues.length ? <div className="iss">{issues.slice(0, 3).map(([c, n, t], k) => <div key={k}><i className={c} /><b>{n}</b> {t}</div>)}{issues.length > 3 && <div className="muted sm">+ {issues.length - 3} more on Team ›</div>}</div>
        : <div className="okc sm strong">✓ Nothing to flag</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <a className="abtn sm" href={phones.length ? `sms:/open?addresses=${phones.join(',')}` : undefined}>Message</a>
        <Link className="abtn sm" to={`/admin/event/${e.id}`}>Team ›</Link>
        <Link className="abtn sm dark" to={`/manage/${e.id}`}>Check-in{started && <i className="live-dot" />}</Link>
      </div>
    </div>
  );
}

const ARCH_ICON = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>;

/** A Needs-you row: archive button on desktop, swipe left on the phone. */
function NeedRow({ x, onArchive }: { x: Need; onArchive: () => void }) {
  const [dx, setDx] = useState(0); const [x0, setX0] = useState<number | null>(null);
  return (
    <div className="need-wrap">
      <div className="need-under">{ARCH_ICON}Archive</div>
      <div className="need" style={{ transform: `translateX(${dx}px)`, transition: x0 === null ? 'transform .2s' : 'none' }}
        onTouchStart={(ev) => setX0(ev.touches[0].clientX)}
        onTouchMove={(ev) => { if (x0 !== null) setDx(Math.min(0, ev.touches[0].clientX - x0)); }}
        onTouchEnd={() => { setX0(null); if (dx < -140) onArchive(); else setDx(dx < -60 ? -96 : 0); }}>
        <span className={'dotr' + (x.red ? '' : ' amber')} />
        <div className="grow"><b className={x.red ? 'accent' : ''}>{x.title}</b><span>{x.sub}</span></div>
        <Link to={x.to} className="need-go">{x.action} ›</Link>
        {dx <= -90 ? <button className="need-arch-ph" onClick={onArchive}>Archive</button> : <button className="sq need-arch" aria-label="Archive" title="Archive" onClick={onArchive}>{ARCH_ICON}</button>}
      </div>
    </div>
  );
}

const ap = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
