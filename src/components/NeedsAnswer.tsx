// push 90 (boards NotificationsMapV1 + NotifCardsMessagesV1) · one card for every shift notice + "Needs your answer".
// Home shows ONE red call to action (NeedsBar) → Messages, where NeedsAnswer lists the open cards:
// 🙋 Can you work? (blue) · ✅ Confirm (green) · 🗓 Shift changed (gold) · 🗓 Shift removed (red) · 📅 Dates to answer (purple).
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, SHIFT_SELECT, type ShiftRow, type Staff } from '../lib/supabase';
import { useMyDates, toAnswer, latestKnows, dayLabel, type MyDate } from '../lib/myDates';
import { useMyAsks, type MyAsk } from '../lib/shiftAsks';
import { AskCard } from './ShiftNotes';
import { KnowsSheet } from '../pages/MyDates';


type Prev = { start?: string | null; end?: string | null; position?: string | null; place?: string | null; address?: string | null; uniform?: string | null; uniform_new?: string | null };
type Row = ShiftRow & { change_prev?: Prev | null; change_seen_at?: string | null; change_sent_at?: string | null; confirm_by?: string | null };
type Al = { id: string; kind: string; title: string; body: string | null; event_id: string | null; created_at: string };
export type NoticeKind = 'ask' | 'confirm' | 'changed' | 'removed' | 'dates' | 'new';

const TZ = 'America/Toronto';
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const dayShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
const isBar = (code: string | null) => /^(BM|BT|BB)$/.test(code ?? '');
const roleOf = (s: ShiftRow) => s.position_code === 'MD' ? 'MD' : s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : isBar(s.position_code) ? 'Bar' : 'Waiter';
const placeOf = (s: ShiftRow) => s.events.venues?.name ?? s.events.title;
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : dayShort(new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ })); };
const byWhen = (iso: string | null) => (iso ? `by ${new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: TZ })}` : '');

/** The standard card: colour bar · icon + KIND · title (date · place) · line · what changed · buttons. */
export function NoticeCard({ kind, kick, title, line, tag, children, actions }: { kind: NoticeKind; kick: string; title: ReactNode; line?: ReactNode; tag?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={'nc nc-' + kind}>
      <div className="nc-top"><small className="nc-k">{kick}</small>{tag && <small className="nc-tag">{tag}</small>}</div>
      <b className="nc-t">{title}</b>
      {line && <span className="nc-l">{line}</span>}
      {children}
      {actions && <div className="nc-btns">{actions}</div>}
    </div>);
}
export const Chg = ({ k, old, nw }: { k: string; old?: string | null; nw: string }) => <div className="nc-chg"><span>{k}</span> {old && <><s>{old}</s> → </>}<b>{nw}</b></div>;

function changeRows(prev: Prev, s: ShiftRow) {
  const place = placeOf(s); const addr = s.events.address || s.events.venues?.address || ''; const role = roleOf(s);
  const rows: { k: string; nw: string; old?: string | null }[] = [];
  if (prev.start && new Date(prev.start).getTime() !== new Date(s.planned_start).getTime() && !s.time_tbc) rows.push({ k: 'Start', nw: t12(s.planned_start), old: t12(prev.start) });
  if ('end' in prev && s.planned_end && (!prev.end || new Date(prev.end).getTime() !== new Date(s.planned_end).getTime())) rows.push({ k: 'End', nw: '~ ' + t12(s.planned_end), old: prev.end ? '~ ' + t12(prev.end) : null });
  if (prev.place && prev.place !== place) rows.push({ k: 'Place', nw: place + (addr ? ` · ${addr.split(',')[0]}` : ''), old: prev.place });
  else if (prev.address && prev.address !== addr) rows.push({ k: 'Address', nw: addr, old: prev.address });
  if (prev.position && prev.position.replace(/^bar\s*-\s*/i, '') !== role && !/^\d+$/.test(prev.position)) rows.push({ k: 'Position', nw: role, old: prev.position.replace(/^bar\s*-\s*/i, '') });
  if (prev.uniform_new) rows.push({ k: 'Uniform', nw: prev.uniform_new, old: prev.uniform && prev.uniform !== prev.uniform_new ? prev.uniform : null });
  return rows;
}

/** Everything still waiting on this person. */
export function useNeeds(me: Staff, preview = false) {
  const [rows, setRows] = useState<Row[] | null>(null); const [alerts, setAlerts] = useState<Al[]>([]); const [tick, setTick] = useState(0);
  const { asks, reload: reloadAsks } = useMyAsks(preview || me.role === 'admin');
  const { dates, reload: reloadDates } = useMyDates(me.id, preview);
  useEffect(() => {
    const since = new Date(Date.now() - 6 * 3600e3).toISOString();
    supabase.from('shifts').select(SHIFT_SELECT + ',change_prev,change_seen_at,change_sent_at,confirm_by').eq('staff_id', me.id).in('status', ['booked', 'confirmed'])
      .is('attendance', null).gte('planned_start', since).order('planned_start').limit(40)
      .then(({ data, error }) => setRows(error ? [] : ((data ?? []) as unknown as Row[])));
    if (!preview) supabase.from('staff_alerts').select('id,kind,title,body,event_id,created_at').eq('staff_id', me.id).is('seen_at', null).order('created_at')
      .then(({ data }) => setAlerts(((data ?? []) as Al[]).filter((a) => !a.kind.startsWith('meeting'))));
  }, [me.id, preview, tick]);
  const reload = () => { setTick((t) => t + 1); reloadAsks(); reloadDates(); };
  const list = rows ?? [];
  const notFinal = (s: Row) => !!s.events.details_pending || !!s.time_tbc || !!s.events.tentative;
  const confirm = list.filter((s) => s.status === 'booked' && !notFinal(s));
  const changed = list.filter((s) => s.status === 'confirmed' && s.change_prev && s.change_sent_at && !s.change_seen_at);
  const chEv = new Set([...changed, ...confirm].map((s) => s.events.id));
  const als = alerts.filter((a) => !(a.event_id && chEv.has(a.event_id) && a.kind !== 'removed')); // the shift card already says it
  const openAsks = asks.filter((a) => a.state === 'open');
  const toAns = (dates ?? []).filter((d) => toAnswer(d));
  const count = confirm.length + changed.length + als.length + openAsks.length + (toAns.length ? 1 : 0);
  return { loading: rows === null, confirm, changed, alerts: als, asks: openAsks, toAns, count, reload, setAlerts, setRows };
}

/** Home: the one call to action. */
export function NeedsBar({ me, preview = false }: { me: Staff; preview?: boolean }) {
  const n = useNeeds(me, preview);
  if (!n.count) return null;
  const bits = [
    ...n.confirm.slice(0, 2).map((s) => `Confirm ${dayShort(s.events.event_date)}`),
    ...n.changed.slice(0, 2).map((s) => `Shift changed ${dayShort(s.events.event_date)}`),
    ...n.asks.slice(0, 1).map(() => 'Can you work?'),
    ...n.alerts.filter((a) => a.kind === 'removed').slice(0, 1).map(() => 'Shift removed'),
    ...(n.toAns.length ? [`${n.toAns.length} date${n.toAns.length > 1 ? 's' : ''}`] : []),
  ];
  const body = <><span className="nb-ic" aria-hidden="true">🔔</span><span className="grow"><b>{n.count} thing{n.count > 1 ? 's' : ''} need{n.count > 1 ? '' : 's'} your answer</b><small>{bits.slice(0, 3).join(' · ')}</small></span><b className="nb-go">›</b></>;
  return preview ? <div className="needs-bar">{body}</div> : <Link to="/messages#needs" className="needs-bar">{body}</Link>;
}

/** Messages: the open cards, on top. */
export function NeedsAnswer({ me }: { me: Staff }) {
  const nav = useNavigate(); const n = useNeeds(me); const [busy, setBusy] = useState(''); const [notSure, setNotSure] = useState(false);
  if (n.loading || !n.count) return null;
  const respond = async (id: string, r: 'confirmed' | 'declined') => { setBusy(id); await supabase.rpc('respond_to_shift', { p_shift: id, p_response: r }); setBusy(''); n.reload(); };
  const seenChange = async (s: Row) => {
    setBusy(s.id); await supabase.rpc('shift_change_seen', { p_shift: s.id });
    for (const a of n.alerts.filter((x) => x.event_id === s.events.id)) await supabase.rpc('alert_seen', { p_id: a.id });
    setBusy(''); n.reload();
  };
  const seenAlert = async (a: Al) => { n.setAlerts((l) => l.filter((x) => x.id !== a.id)); await supabase.rpc('alert_seen', { p_id: a.id }); };
  const dueMaybes: MyDate[] = n.toAns.filter((d) => d.status === 'maybe');
  const asked = n.toAns.filter((d) => d.status !== 'maybe');
  const datesTxt = (l: MyDate[]) => l.slice(0, 4).map((d) => new Date(d.for_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).join(', ') + (l.length > 4 ? '…' : '');
  const firstBy = (l: MyDate[]) => l.map((d) => d.answer_by).filter(Boolean).sort()[0] ?? null;
  return (
    <section id="needs" className="needs">
      <div className="needs-h"><b>Needs your answer</b><i>{n.count}</i></div>
      {n.asks.map((a: MyAsk) => <div key={a.ask_id} className="nc-wrap ask"><AskCard a={a} home onAnswered={() => setTimeout(n.reload, 1500)} /></div>)}
      {n.confirm.map((s) => (
        <NoticeCard key={s.id} kind="confirm" kick="✅ CONFIRM" tag={byWhen(s.confirm_by ?? null)} title={`${dayShort(s.events.event_date)} · ${placeOf(s)}`}
          line={`${roleOf(s)} · ${t12(s.planned_start)}`}
          actions={<><button className="nc-main" disabled={busy === s.id} onClick={() => respond(s.id, 'confirmed')}>Confirm</button><button disabled={busy === s.id} onClick={() => respond(s.id, 'declined')}>I can’t make it</button></>} />))}
      {n.changed.map((s) => { const rows = changeRows(s.change_prev!, s); return (
        <NoticeCard key={s.id} kind="changed" kick="🗓 SHIFT CHANGED" tag={s.change_sent_at ? ago(s.change_sent_at) : ''} title={`${dayShort(s.events.event_date)} · ${placeOf(s)}`}
          line={`${roleOf(s)} · ${rows.length > 1 ? `${rows.length} things changed` : rows.length ? '1 thing changed' : 'Some details changed'}`}
          actions={<><button className="nc-main" disabled={busy === s.id} onClick={() => seenChange(s)}>Got it</button><button onClick={() => nav(`/shift/${s.id}`)}>Shift details ›</button></>}>
          {rows.map((r) => <Chg key={r.k} k={r.k} old={r.old} nw={r.nw} />)}
        </NoticeCard>); })}
      {n.alerts.map((a) => a.kind === 'removed' ? (
        <NoticeCard key={a.id} kind="removed" kick="🗓 SHIFT REMOVED" tag={ago(a.created_at)} title={a.title.replace(/^You(’|')re no longer (on|needed) /, '')} line="You’re no longer on this event."
          actions={<><button className="nc-main" onClick={() => seenAlert(a)}>OK</button><button onClick={() => { seenAlert(a); nav('/messages?new=1&topic=shift'); }}>Message Ronnie</button></>}>
          {a.body && <div className="nc-why">{a.body}</div>}
        </NoticeCard>
      ) : (
        <NoticeCard key={a.id} kind={a.kind === 'booked' ? 'new' : 'changed'} kick={a.kind === 'booked' ? '🗓 NEW SHIFT' : '🗓 SHIFT CHANGED'} tag={ago(a.created_at)} title={a.title} line={a.body ?? undefined}
          actions={<button className="nc-main" onClick={() => seenAlert(a)}>Got it</button>} />))}
      {asked.length > 0 && (
        <NoticeCard kind="dates" kick="📅 DATES TO ANSWER" tag={firstBy(asked) ? `by ${dayLabel(new Date(firstBy(asked)!).toLocaleDateString('en-CA', { timeZone: TZ }))}` : ''}
          title={`${asked.length} date${asked.length > 1 ? 's' : ''} · ${datesTxt(asked)}`} line={[...new Set(asked.map((d) => d.venue).filter(Boolean))].slice(0, 3).join(' · ') || 'Can you work these days?'}
          actions={<button className="nc-main" onClick={() => nav('/my-dates?tab=answer')}>Answer</button>} />)}
      {dueMaybes.length > 0 && (
        <NoticeCard kind="ask" kick="🙋 CAN YOU WORK? · MAYBE" title={`Do you know yet? · ${datesTxt(dueMaybes)}`} line={`You said maybe · today is the day you said you’d know`}
          actions={<><button className="nc-main" onClick={() => nav('/my-dates?tab=answer')}>Answer</button><button onClick={() => setNotSure(true)}>Still not sure</button></>} />)}
      <small className="needs-f">Tap one to answer · it leaves this list once done</small>
      {notSure && <KnowsSheet title="When will you know?" latest={latestKnows(dueMaybes)} oneTap sub="Pick a new day. It can't be after the answer-by date." onClose={() => setNotSure(false)}
        onPick={async (by) => { setNotSure(false); await supabase.rpc('dont_know_yet', { p_knows_by: by, p_note: null, p_ids: dueMaybes.map((d) => d.id) }); n.reload(); }} />}
    </section>);
}
