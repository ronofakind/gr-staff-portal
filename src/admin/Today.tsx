import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LastMinute, ChangeAnswer, CHANGE_COLS, replaceUrl, isSelfCancel, isEventDayCancel, replacementOf, hoursBefore, type ChangeRow } from './Changes';
import { summaryOf } from './Extras';
import { DeleteEvent } from './DeleteEvent';
import { DeptTag } from './DeptTag';
import { hoursBetween } from './api';
import { supabase } from '../lib/supabase';
import { eventsBetween, addDays, isoDay, flagsOf, flagText, periodOf, dLabel, tTime, type AEvent, type AShift } from './api';

type Need = { key: string; title: string; sub: string; action: string; to: string; red?: boolean; onAct?: () => Promise<void>; alt?: { label: string; to: string } };
type ResetReq = { id: string; created_at: string; staff: { id: string; full_name: string; email: string | null } | null };
type Arch = { key: string; sig: string; label: string | null; archived_at: string };
const sigOf = (n: Need) => n.title + '|' + n.sub;

export function Today() {
  const today = isoDay(new Date());
  const [week, setWeek] = useState<AEvent[] | null>(null);
  const [needs, setNeeds] = useState<Need[]>([]);
  const [answers, setAnswers] = useState(0); const [qBy, setQBy] = useState<Record<string, number>>({});
  const [missing, setMissing] = useState(0);
  const [arch, setArch] = useState<Arch[]>([]);
  const [showArch, setShowArch] = useState(false);
  // push 28
  const [params, setParams] = useSearchParams();
  const changeId = params.get('change');
  const [lm, setLm] = useState<{ e: AEvent; s: AShift }[]>([]); const [mgrs, setMgrs] = useState<Record<string, string>>({});
  const [lateBy, setLateBy] = useState<Record<string, { eta: string; reason: string | null }>>({});
  const [tick, setTick] = useState(0);
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
        if (s.cancel_self) continue; // push 28: staff self-cancels have their own cards below
        for (const f of flagsOf(s).filter((x) => x.flag !== 'early' && !x.free)) n.push({ key: s.id + f.flag, red: true, title: `⚑ ${s.staff?.full_name ?? '?'} · ${flagText(f).toLowerCase()}`, sub: `${e.event_date === today ? 'Today' : 'Yesterday'} · ${e.title}`, action: 'View', to: '/admin/reliability' });
      }
      for (const e of ahead.filter((x) => x.department !== 'bar')) {
        const booked = e.shifts.filter((s) => s.status !== 'declined').length;
        if (booked < e.staff_needed) n.push({ key: e.id + 'short', title: `${e.title}${e.department === 'bar' ? ' · BAR' : ''} · ${dLabel(e.event_date)}`, sub: `Short ${e.staff_needed - booked} · ${booked} / ${e.staff_needed} booked`, action: 'Assign', to: `/admin/day?d=${e.event_date}` });
        const unsent = e.shifts.filter((s) => !s.notified_at || s.changed_at > s.notified_at).length;
        if (booked && unsent && e.event_date <= addDays(today, 7)) n.push({ key: e.id + 'send', title: `${e.title} · ${dLabel(e.event_date)}`, sub: `${unsent} not sent details yet`, action: 'Send', to: `/admin/day?d=${e.event_date}` });
      }
      if (miss.length) n.push({ key: 'miss', title: `Pay period ${dLabel(cur.start, { month: 'short', day: 'numeric' })} – ${dLabel(cur.end, { day: 'numeric' })}`, sub: `${miss.length} missing end time${miss.length > 1 ? 's' : ''}`, action: 'Fix', to: '/admin/hours' });
      const { data: hq } = await supabase.from('hours_questions').select('id,kind,claimed_at,shifts!inner(event_id,staff:staff!shifts_staff_id_fkey(full_name),events(title))').eq('status', 'open');
      { const m: Record<string, number> = {}; for (const x of (hq ?? []) as unknown as { shifts?: { event_id: string } }[]) if (x.shifts?.event_id) m[x.shifts.event_id] = (m[x.shifts.event_id] ?? 0) + 1; setQBy(m); }
      for (const q of (hq ?? []) as unknown as { id: string; kind: string; shifts: { staff: { full_name: string }; events: { title: string } } }[])
        n.unshift({ key: 'q' + q.id, red: true, title: `Hours question · ${q.shifts.staff.full_name}`, sub: `${q.shifts.events.title} · about ${q.kind === 'other' ? 'something else' : q.kind + ' time'}`, action: 'Check', to: '/admin/hours' });
      // Cash paid: the QuickBooks estimate should go
      const { data: qb } = await supabase.from('event_private').select('event_id,qb_doc_number,events!inner(title,event_date)').eq('pay_method', 'cash').eq('qb_doc_type', 'estimate')
        .not('cash_received_at', 'is', null).is('qb_removed_at', null).not('qb_doc_number', 'is', null);
      const qseen = new Set<string>();
      for (const r of (qb ?? []) as unknown as { event_id: string; qb_doc_number: string; events: { title: string; event_date: string } }[]) {
        if (qseen.has(r.qb_doc_number)) continue; qseen.add(r.qb_doc_number);
        n.push({ key: 'qb' + r.qb_doc_number, title: `Remove Estimate #${r.qb_doc_number} in QuickBooks`, sub: `${r.events.title} · ${dLabel(r.events.event_date)} · paid cash`, action: 'Done?', to: `/admin/event/${r.event_id}` });
      }
      // Manager feedback (push 30): overall 1–2★ or "worked like a C" shows right away. Older rows (no stars): C or any ▼, as in push 27.
      const fbCols = 'id,staff_id,tier_vote,ratings,note,created_at,by:staff!staff_feedback_by_staff_id_fkey(full_name),who:staff!staff_feedback_staff_id_fkey(full_name),events(title,event_date)';
      const fbq = (cols: string) => supabase.from('staff_feedback').select(cols).is('archived_at', null).gte('created_at', addDays(today, -30) + 'T00:00:00Z').order('created_at', { ascending: false });
      let fbr = await fbq(fbCols + ',overall_stars');
      if (fbr.error && /overall_stars/.test(fbr.error.message)) fbr = await fbq(fbCols); // migration 033 not applied yet
      const fbs = fbr.data;
      type Fb = { id: string; staff_id: string; tier_vote: string | null; overall_stars?: number | null; ratings: Record<string, unknown> | null; note: string | null; by: { full_name: string } | null; who: { full_name: string } | null; events: { title: string; event_date: string } | null };
      const AREA: Record<string, string> = { punctuality: 'Punctuality', attitude: 'Attitude', presentation: 'Presentation', experience: 'Experience', teamwork: 'Teamwork', guest: 'Guest service' };
      const star = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
      for (const f of (Array.isArray(fbs) ? fbs as unknown as Fb[] : []).filter((x) => x && typeof x.staff_id === 'string')) {
        const r = f.ratings && typeof f.ratings === 'object' ? f.ratings : {};
        const stars = star(f.overall_stars) ? f.overall_stars : null;
        let bits: string[];
        if (stars) {
          if (stars > 2 && f.tier_vote !== 'C') continue;
          const lows = Object.entries(r).filter(([, v]) => star(v) && v <= 2).map(([k, v]) => `${AREA[k] ?? k} ${v}★`);
          bits = [`${stars}★`, f.tier_vote === 'C' ? 'worked like a C' : '', ...lows];
        } else {
          const downs = Object.entries(r).filter(([, v]) => v === 'down').map(([k]) => `${AREA[k] ?? k} ▼`);
          if (f.tier_vote !== 'C' && !downs.length) continue;
          bits = [f.tier_vote === 'C' ? 'worked like a C' : '', ...downs];
        }
        const fn = (x?: { full_name: string } | null) => x?.full_name?.split(' ')[0] ?? '?';
        n.push({ key: 'fb' + f.id, red: true, title: `${fn(f.by)}: ${fn(f.who)} · ${bits.filter(Boolean).join(' · ')}`,
          sub: `${f.events ? `${f.events.title} · ${dLabel(f.events.event_date)}` : 'Manager feedback'}${f.note ? ` · “${f.note}”` : ''}`, action: 'View', to: `/admin/staff?open=${f.staff_id}` });
      }
      // ── push 28 ──
      // b/c · staff cancels: event-day → red LAST-MINUTE card; earlier → Needs you "Find a replacement ›" (until someone replaces them)
      const mids = [...new Set(ahead.map((e) => e.manager_id).filter(Boolean))] as string[];
      if (mids.length) supabase.from('staff').select('id,full_name').in('id', mids).then(({ data }) => setMgrs(Object.fromEntries(((data ?? []) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name]))));
      const lmList: { e: AEvent; s: AShift }[] = [];
      for (const e of ahead) for (const s of e.shifts) {
        if (!isSelfCancel(s)) continue;
        const rep = replacementOf(e, s);
        if (isEventDayCancel(e, s)) { if (!(rep && s.cancel_sent_to_manager)) lmList.push({ e, s }); continue; }
        if (rep || s.attendance !== 'cancelled') continue;
        const fn = (s.staff?.full_name ?? '?').split(' ')[0];
        n.unshift({ key: 'cx' + s.id, red: true, title: `${fn} cancelled · ${e.title} ${e.event_date === today ? 'today' : e.event_date === addDays(today, 1) ? 'tomorrow' : dLabel(e.event_date)}`,
          sub: [s.cancel_reason ?? 'no reason', s.cancelled_at ? hoursBefore(s.cancelled_at, s.planned_start) : '', s.cancel_late ? 'LATE (had confirmed)' : 'before confirming · not counted'].filter(Boolean).join(' · '),
          action: 'Find a replacement', to: replaceUrl(e, { replace: s.id, at: new Date(s.planned_start).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' }) }) });
      }
      setLm(lmList);
      // d · time-change requests waiting for Ronnie
      const { data: cr, error: crErr } = await supabase.from('shift_change_requests').select(CHANGE_COLS).eq('status', 'pending').order('created_at');
      if (!crErr) for (const r of (cr ?? []) as unknown as ChangeRow[]) {
        const sh = r.shifts; const e = sh?.events; if (!sh || !e) continue;
        const fn = (sh.staff?.full_name ?? '?').split(' ')[0];
        n.unshift({ key: 'tc' + r.id, red: true, title: `${fn} · ${r.kind === 'later' ? 'time change' : 'leave early'}`,
          sub: `${e.title} ${e.event_date === today ? 'today' : e.event_date === addDays(today, 1) ? 'tomorrow' : dLabel(e.event_date)} · ${r.kind === 'later' ? `${tTime(sh.planned_start)} → ${tTime(r.new_time)}` : `leaves ${tTime(r.new_time)}`}`, action: 'Answer', to: `/admin?change=${r.id}` });
      }
      // e · running late notices for tonight ("late · told ahead" on the Tonight cards)
      const tonightIds = evs.filter((e) => e.event_date === today).flatMap((e) => e.shifts.map((s) => s.id));
      if (tonightIds.length) supabase.from('late_notices').select('shift_id,eta,reason').in('shift_id', tonightIds).then(({ data, error }) => { if (!error && Array.isArray(data)) setLateBy(Object.fromEntries((data as { shift_id: string; eta: string; reason: string | null }[]).map((x) => [x.shift_id, x]))); });
      // f · extras & cancellations: 6 PM on the event day or once hours are in, until confirmed / logged (yesterday's stay until the 5 AM log)
      const exEvs = [...evs, ...past].filter((e, i, a) => a.findIndex((x) => x.id === e.id) === i && (e.event_date === addDays(today, -1) || (e.event_date === today && (!!e.hours_submitted_at || new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit' }) >= '18'))) && e.shifts.some((s) => s.status !== 'declined'));
      if (exEvs.length) {
        const { data: adj, error: aErr } = await supabase.from('event_adjustments').select('event_id,confirmed_at,logged_at').in('event_id', exEvs.map((e) => e.id));
        if (!aErr) for (const e of exEvs) {
          const a = ((adj ?? []) as { event_id: string; confirmed_at: string | null; logged_at: string | null }[]).find((x) => x.event_id === e.id);
          if (a?.confirmed_at || a?.logged_at) continue;
          n.push({ key: 'ex' + e.id, title: `${e.title}${e.department === 'bar' ? ' · BAR' : ''} · extras & cancellations`, sub: `${e.event_date === today ? 'Today' : 'Yesterday'} · ${summaryOf(e)}`, action: 'Check', to: `/admin/extras/${e.id}` });
        }
      }
      // push 31e · "Ask Ronnie to reset": nothing is emailed until Ronnie presses Send reset link
      const { data: rr, error: rrErr } = await supabase.from('reset_requests').select('id,created_at,staff:staff!reset_requests_staff_id_fkey(id,full_name,email)').is('handled_at', null).order('created_at');
      if (!rrErr) for (const r of (rr ?? []) as unknown as ResetReq[]) {
        const st = r.staff; if (!st) continue;
        const fn = st.full_name.split(' ')[0];
        n.unshift({ key: 'rr' + r.id, red: true, title: `${fn} can't sign in`, sub: `Asked for a code reset ${dLabel(isoDay(new Date(r.created_at)), { month: 'short', day: 'numeric' })} ${tTime(r.created_at)} · ${st.email ?? 'no email on file'}`,
          action: 'Send reset link', to: `/admin/staff?open=${st.id}`, alt: { label: 'Fix email', to: `/admin/staff?open=${st.id}` },
          onAct: async () => {
            if (!st.email) { alert(`${fn} has no email. Add it on their profile first.`); return; }
            if (!confirm(`Email a reset code + link to ${st.email}?`)) return;
            // Same email as "Forgot your code?" on the sign-in screen (6-digit code + link → choose a new code).
            const { error } = await supabase.auth.signInWithOtp({ email: st.email, options: { shouldCreateUser: false, emailRedirectTo: window.location.origin } });
            if (error) { alert(error.message); return; }
            await supabase.from('reset_requests').update({ handled_at: new Date().toISOString(), handled_by: (await supabase.rpc('me')).data ?? null }).eq('id', r.id);
            setTick((t) => t + 1);
          } });
      }
      setNeeds(n);
    })();
  }, [tick]);

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
        <div className="k dark"><small>TONIGHT</small><b>{new Set(tonight.map((e) => e.title)).size} <span>event{new Set(tonight.map((e) => e.title)).size === 1 ? '' : 's'} · Floor {tonight.filter((e) => e.department !== 'bar').reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0)} · Bar {tonight.filter((e) => e.department === 'bar').reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0)}</span></b></div>
        <div className={'k' + (floorShort ? ' amber' : '')}><small>STILL SHORT THIS WEEK</small><b>{floorShort} <span>shifts</span></b></div>
        <Link to="/admin/availability" className="k"><small>AVAILABILITY ANSWERS</small><b>{answers} <span>said yes</span></b></Link>
        <Link to="/admin/hours" className={'k' + (missing ? ' amber' : '')}><small>HOURS TO REVIEW</small><b>{missing} <span>missing end times</span></b></Link>
      </div>

      <div className="two-col">
        <section className="stack">
          <div className="sec"><span className="serif">Tonight</span><Link to={`/admin/day?d=${today}`}>Open day view ›</Link></div>
          {week === null && <div className="muted">Loading…</div>}
          {week && !tonight.length && <div className="adm-card muted">No events today.</div>}
          {(() => {
            const gone = (ids: string[]) => setWeek((v) => (v ?? []).filter((x) => !ids.includes(x.id)));
            const venues = [...new Set(tonight.map((e) => e.title))].map((t) => tonight.filter((e) => e.title === t).sort((a) => (a.department === 'bar' ? 1 : -1)));
            const doneV = (evs: AEvent[]) => evs.every((e) => !!e.hours_submitted_at);
            return venues.sort((a, b) => Number(doneV(a)) - Number(doneV(b))).map((evs) => {
              if (evs.length === 1) return <Live key={evs[0].id} e={evs[0]} q={qBy[evs[0].id] ?? 0} lateBy={lateBy} onDeleted={gone} />;
              const e0 = evs[0]; const nOf = (d: string) => evs.filter((e) => (d === 'bar') === (e.department === 'bar')).reduce((n, e) => n + e.shifts.filter((x) => x.status !== 'declined' && !x.attendance).length, 0);
              return (
                <div key={e0.title} className="venue-block">
                  <div className="vb-h"><span className="serif" style={{ fontSize: 24 }}>{e0.title}</span><span className="muted sm">{[e0.event_private?.client, e0.event_type, e0.guests ? `${e0.guests} guests` : null].filter(Boolean).join(' · ')}</span>
                    <span className="grow" /><span className="sm strong">Floor {nOf('floor')} · <span className="accent">Bar {nOf('bar')}</span> · <Link to={`/admin/event/${e0.id}`}>Event page ›</Link></span></div>
                  {evs.map((e) => <Live key={e.id} e={e} q={qBy[e.id] ?? 0} lateBy={lateBy} inBlock onDeleted={gone} />)}
                </div>);
            });
          })()}
        </section>
        <section className="stack">
          {lm.map(({ e, s }) => <LastMinute key={s.id} e={e} s={s} mgr={e.manager_id ? mgrs[e.manager_id] ?? null : null} onSent={() => setTick((t) => t + 1)} />)}
          <div className="sec"><span className="serif">Needs you <b className="accent sm">{shown.length || ''}</b></span>{shown.length > 0 && <button className="abtn sm" onClick={() => archive(shown)}>{ARCH_ICON} Archive all</button>}</div>
          <div className="adm-card" style={{ padding: '4px 16px' }}>
            {!shown.length && <div className="muted sm" style={{ padding: '12px 0' }}>All clear.</div>}
            {shown.slice(0, 14).map((x) => <NeedRow key={x.key} x={x} onArchive={() => archive([x])} />)}
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
              const staff = evs.filter((e) => e.department !== 'bar').reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0);
              const barN = evs.filter((e) => e.department === 'bar').reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0);
              const short = evs.some((e) => e.department !== 'bar' && e.shifts.filter((s) => s.status !== 'declined').length < e.staff_needed);
              return (
                <Link key={d} to={`/admin/day?d=${d}`} className={'sd' + (d === today ? ' on' : '') + (short && d >= today ? ' short' : '')}>
                  <small>{dLabel(d, { weekday: 'short' }).toUpperCase()}</small><b>{Number(d.slice(8))}</b><span>{evs.length ? `${new Set(evs.map((e) => e.title)).size} · ${staff}` : '–'}</span>{barN > 0 && <span className="accent" style={{ fontSize: 10 }}>bar {barN}</span>}
                </Link>
              );
            })}
          </div>
          <div className="muted sm">events · floor staff booked, red = bar. Amber = still short.</div>
        </section>
      </div>
      {changeId && <ChangeAnswer id={changeId} onClose={() => { const p = new URLSearchParams(params); p.delete('change'); setParams(p, { replace: true }); }} onDone={() => { const p = new URLSearchParams(params); p.delete('change'); setParams(p, { replace: true }); setTick((t) => t + 1); }} />}
    </div>
  );
}

type Box = { n: number; label: string; cls: string; rows: [string, string, string][] };
function Live({ e, q = 0, inBlock = false, onDeleted, lateBy = {} }: { e: AEvent; q?: number; inBlock?: boolean; onDeleted: (ids: string[]) => void; lateBy?: Record<string, { eta: string; reason: string | null }> }) {
  const [tab, setTab] = useState<string | null>(null);
  const all = e.shifts.filter((s) => s.status !== 'declined');
  const now = Date.now();
  const firstStart = all.map((s) => new Date(s.planned_start).getTime()).sort((a, b) => a - b)[0] ?? 0;
  const started = all.some((s) => s.punches?.punch_in) || (firstStart && firstStart <= now);
  const md = all.find((s) => s.position_code === 'MD' || s.position_code === 'BM');
  const name = (s: AShift) => s.staff?.full_name ?? '?';
  const r = (s: AShift, a: string, b = ''): [string, string, string] => [name(s), a, b];
  let boxes: Box[];
  const workingNow = all.filter((s) => s.punches?.punch_in && !(s.punches.punch_out && new Date(s.punches.punch_out).getTime() <= now));
  const completed = !!e.hours_submitted_at;
  const status: 'soon' | 'live' | 'notsent' | 'done' = completed ? 'done' : !started ? 'soon' : workingNow.length ? 'live' : 'notsent';
  if (completed) {
    const worked = all.filter((s) => !s.attendance && s.punches?.punch_in && s.punches.punch_out);
    const hrs = worked.reduce((n, s) => n + hoursBetween(s.punches!.punch_in, s.punches!.punch_out, !!s.left_early), 0);
    const ns = all.filter((s) => s.attendance === 'no_show');
    boxes = [
      { n: worked.length, label: 'worked', cls: 'ok', rows: worked.map((s) => r(s, `${tTime(s.punches!.punch_in)} → ${tTime(s.punches!.punch_out)}`)) },
      { n: hrs, label: 'hours', cls: '', rows: worked.map((s) => r(s, `${hoursBetween(s.punches!.punch_in, s.punches!.punch_out, !!s.left_early)} h`)) },
      { n: ns.length, label: 'no-show', cls: ns.length ? 'red' : '', rows: ns.map((s) => r(s, 'no-show', s.manager_note ?? '')) },
      { n: q, label: 'questions', cls: q ? 'amber' : '', rows: [] },
    ];
  } else if (!started) {
    const cancelled = all.filter((s) => s.attendance === 'cancelled');
    const team = all.filter((s) => !s.attendance);
    const conf = team.filter((s) => s.status === 'confirmed'); const unsure = team.filter((s) => s.status !== 'confirmed');
    boxes = [
      { n: team.length, label: 'booked', cls: '', rows: team.map((s) => r(s, s.position_code ?? '', tTime(s.planned_start))) },
      { n: conf.length, label: 'confirmed', cls: 'ok', rows: conf.map((s) => r(s, 'confirmed', tTime(s.planned_start))) },
      { n: unsure.length, label: 'unsure', cls: unsure.length ? 'amber' : '', rows: unsure.map((s) => r(s, 'not confirmed yet', tTime(s.planned_start))) },
      { n: cancelled.length, label: 'cancelled', cls: cancelled.length ? 'red' : '', rows: cancelled.map((s) => r(s, 'cancelled')) },
    ];
  } else {
    const ns = all.filter((s) => s.attendance === 'no_show');
    const missing = all.filter((s) => !s.attendance && !s.punches?.punch_in && new Date(s.planned_start).getTime() < now);
    const lateIn = all.filter((s) => !s.attendance && flagsOf(s).some((f) => f.flag === 'late'));
    const working = all.filter((s) => s.punches?.punch_in && !(s.punches.punch_out && new Date(s.punches.punch_out).getTime() <= now));
    const done = all.filter((s) => s.punches?.punch_out && new Date(s.punches.punch_out).getTime() <= now);
    boxes = [
      { n: working.length, label: 'working', cls: 'ok', rows: working.map((s) => r(s, `in ${tTime(s.punches!.punch_in)}`, s.leave_by ? `leaves ~${tTime(s.leave_by)}` : '')) },
      { n: missing.length + lateIn.length, label: 'late', cls: missing.length + lateIn.length ? 'amber' : '', rows: [
        ...missing.map((s) => lateBy[s.id] ? r(s, 'late · told ahead', `~${tTime(lateBy[s.id].eta)}${new Date(lateBy[s.id].eta).getTime() < now ? ' · passed' : ''}`) : r(s, 'not in yet', `${Math.round((now - new Date(s.planned_start).getTime()) / 60000)} min late`)),
        ...lateIn.map((s) => r(s, lateBy[s.id] ? 'late · told ahead' : `${flagsOf(s)[0].min} min`, `in ${tTime(s.punches!.punch_in)}`))] },
      { n: ns.length, label: 'no-show', cls: ns.length ? 'red' : '', rows: ns.map((s) => r(s, 'no-show', s.manager_note ?? '')) },
      { n: done.length, label: 'done', cls: '', rows: done.map((s) => r(s, `${tTime(s.punches!.punch_in)} → ${tTime(s.punches!.punch_out)}`)) },
    ];
  }
  const openBox = boxes.find((b) => b.label === tab);
  const startsIn = Math.round((firstStart - now) / 60000);
  const phones = all.map((s) => s.staff?.phone?.replace(/[^\d+]/g, '')).filter(Boolean);
  return (
    <div className={'adm-card stack live-card edge-' + (e.department === 'bar' ? 'bar' : 'floor') + (completed ? ' completed' : '')} style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div className="grow" style={{ minWidth: 180 }}><div className="row" style={{ gap: 8, alignItems: 'center' }}>{!inBlock && <span className="serif" style={{ fontSize: 22 }}>{e.title}</span>}<DeptTag dept={e.department} /></div>
          <div className="muted sm">{!inBlock && e.event_private?.client ? e.event_private.client + ' · ' : ''}{ap(e.start_time) || 'TBC'}{e.ends_label ? ` · ends ${e.ends_label}` : e.end_time ? ` · ends ~ ${ap(e.end_time)}` : ''}{md ? ` · ${md.position_code} ${md.staff?.full_name.split(' ')[0]}` : ''}</div></div>
        {status === 'done' ? <span className="tag done-tag">✓ Completed</span> : status === 'live' ? <span className="tag ok"><i className="pulse" />live</span> : status === 'notsent' ? <span className="tag amber">Hours not sent</span> : <span className="tag amber">in {Math.floor(startsIn / 60)} h {String(startsIn % 60).padStart(2, '0')}</span>}
      </div>
      {completed && <div className="muted sm">Hours submitted by {e.shifts.find((s) => s.staff_id === e.hours_submitted_by)?.staff?.full_name ?? 'the manager'} at {tTime(e.hours_submitted_at)}</div>}
      <div className="cnt4" role="tablist">{boxes.map((b) => (
        <button key={b.label} role="tab" aria-selected={tab === b.label} disabled={!b.n} className={b.cls + (tab === b.label ? ' on' : '')} onClick={() => setTab(tab === b.label ? null : b.label)}>
          <b>{b.n}</b><small>{b.label}{tab === b.label ? ' ▴' : ''}</small>
        </button>
      ))}</div>
      {openBox ? (
        <div className={'tab-list ' + openBox.cls}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="kick" style={{ fontSize: 11 }}>{openBox.label.toUpperCase()} · {openBox.n}</span><button className="lnk" aria-label="Close" onClick={() => setTab(null)}>×</button></div>
          {openBox.rows.map(([n, a, b], k) => <div key={k} className="tab-row"><b>{n}</b><span className="grow" /><span className="strong">{a}</span>{b && <span className="muted">{b}</span>}</div>)}
        </div>
      ) : <div className="muted sm">Tap a number to see who.</div>}
      <div className="row" style={{ justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <DeleteEvent id={e.id} label="Delete" small onDone={onDeleted} />
        <span className="grow" />
        <a className="abtn sm" href={phones.length ? `sms:/open?addresses=${phones.join(',')}` : undefined}>Message</a>
        <Link className="abtn sm" to={completed ? `/manage/${e.id}` : `/admin/event/${e.id}`}>Team ›</Link>
        {completed ? <Link className="abtn sm dark" to={`/admin/hours?d=${e.event_date}`}>Hours ›</Link> : <Link className="abtn sm dark" to={`/manage/${e.id}`}>Check-in{started && <i className="live-dot" />}</Link>}
      </div>
    </div>
  );
}

const ARCH_ICON = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>;

/** A Needs-you row: archive button on desktop, swipe left on the phone. */
function NeedRow({ x, onArchive }: { x: Need; onArchive: () => void }) {
  const [dx, setDx] = useState(0); const [x0, setX0] = useState<number | null>(null); const [busy, setBusy] = useState(false);
  return (
    <div className="need-wrap">
      <div className="need-under">{ARCH_ICON}Archive</div>
      <div className="need" style={{ transform: `translateX(${dx}px)`, transition: x0 === null ? 'transform .2s' : 'none' }}
        onTouchStart={(ev) => setX0(ev.touches[0].clientX)}
        onTouchMove={(ev) => { if (x0 !== null) setDx(Math.min(0, ev.touches[0].clientX - x0)); }}
        onTouchEnd={() => { setX0(null); if (dx < -140) onArchive(); else setDx(dx < -60 ? -96 : 0); }}>
        <span className={'dotr' + (x.red ? '' : ' amber')} />
        <div className="grow"><b className={x.red ? 'accent' : ''}>{x.title}</b><span>{x.sub}</span></div>
        {x.alt && <Link to={x.alt.to} className="need-go muted-go">{x.alt.label} ›</Link>}
        {x.onAct ? <button className="need-go need-act" disabled={busy} onClick={async () => { setBusy(true); try { await x.onAct!(); } finally { setBusy(false); } }}>{busy ? 'Sending…' : x.action}</button>
          : <Link to={x.to} className="need-go">{x.action} ›</Link>}
        {dx <= -90 ? <button className="need-arch-ph" onClick={onArchive}>Archive</button> : <button className="sq need-arch" aria-label="Archive" title="Archive" onClick={onArchive}>{ARCH_ICON}</button>}
      </div>
    </div>
  );
}

const ap = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
