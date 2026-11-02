import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { TabBar } from '../components/TabBar';
import { PageHead } from '../components/ProfileMenu';
import { Avatar } from '../components/Avatar';
import { Chat } from '../components/Chat';
import { TimeWheel, ampm15 } from '../components/TimeWheel';
import { AnnounceView, ANN_SELECT, ANN_SELECT_36, wantsGotIt, type Ann } from '../components/Announce';
import {
  CONV_COLS, MSG_COLS, RONNIE_PHOTO, TOPICS, first, fmtH, hm24, hmNear, markRideSeen, ridesSeen, ronnieSub, shortDate, t12, todayIso, topicLabel, useSigned, whenShort,
  type Conv, type Msg, type Topic,
} from '../lib/messages';
import { meetingMorningCheck } from '../lib/meetings';

/* Push 36 · staff Messages tab: Ronnie pinned on top, tonight's manager thread, Updates (announcements, shift notices, rides, hours answers). */

const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ago = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const unread = (c: Conv | null | undefined) => !!c && !!c.last_from && c.last_from !== 'staff' && !!c.last_message_at && (!c.staff_seen_at || c.staff_seen_at < c.last_message_at);
const preview = (m: Msg | null | undefined, other: string) => {
  if (!m) return '';
  const who = m.sender_role === 'staff' ? 'You' : m.sender_role === 'system' ? '' : m.sender_role === 'admin' ? 'Ronnie' : other;
  const txt = m.deleted_at ? 'Message deleted' : m.kind === 'hours' ? 'Hours question' : m.body || (m.photo_paths?.length ? '📷 Photo' : '');
  return who ? `${who}: ${txt}` : txt;
};

export function Messages({ me }: { me: Staff }) {
  const [sp] = useSearchParams();
  const c = sp.get('c'); const nw = sp.get('new'); const hours = sp.get('hours');
  if (me.role === 'admin') return (
    <main className="page v2"><PageHead me={me} kicker="Inbox" title="Messages" />
      <div className="card stack"><b>Your inbox is in Admin → Messages.</b><Link className="btn-ink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} to="/admin/messages">Open my inbox ›</Link></div>
      <TabBar /></main>
  );
  if (hours) return <MyHours me={me} pick={hours} />;
  if (c === 'ronnie' || nw) return <RonnieThread me={me} compose={!!nw} topicInit={(sp.get('topic') as Topic | null) ?? null} shiftInit={sp.get('shift')} />;
  if (c?.startsWith('mgr:')) return <MgrThread me={me} eventId={c.slice(4)} />;
  return <Inbox me={me} />;
}

/* ───────── list ───────── */
type MgrRow = { event_id: string; title: string; date: string; manager: string; photo: string | null; conv: Conv | null; last: { at: string; text: string } | null; unread: boolean; closed: boolean };
type Upd = { key: string; at: string; icon: string; title: string; sub: string; unread: boolean; from: 'ronnie' | 'shift' | 'other'; open: () => void };
type AlertRow = { id: string; kind: string; title: string; body: string | null; event_id: string | null; meeting_id?: string | null; created_at: string; seen_at: string | null };
type ReadRow = { opened_at: string | null; ack_at: string | null; announcements: Ann & { sender: { full_name: string; role?: string } | null } };

function Inbox({ me }: { me: Staff }) {
  const nav = useNavigate(); const today = todayIso();
  const [filter, setFilter] = useState<'all' | 'ronnie' | 'shifts'>('all');
  const [ron, setRon] = useState<{ conv: Conv | null; last: Msg | null } | null>(null);
  const [mgr, setMgr] = useState<MgrRow[]>([]);
  const [ups, setUps] = useState<Upd[] | null>(null);
  const [ann, setAnn] = useState<{ a: Ann; acked: boolean } | null>(null);
  const [alert, setAlert] = useState<(AlertRow & { shift: string | null }) | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      const cut = ago(90);
      // Ronnie
      const { data: rc } = await supabase.from('conversations').select(CONV_COLS).eq('staff_id', me.id).eq('kind', 'ronnie').maybeSingle();
      let rLast: Msg | null = null;
      if (rc) { const { data } = await supabase.from('messages').select(MSG_COLS).eq('conversation_id', (rc as Conv).id).order('created_at', { ascending: false }).limit(1); rLast = ((data ?? []) as Msg[])[0] ?? null; }
      setRon({ conv: (rc as Conv | null) ?? null, last: rLast });

      // announcements to me (90 days)
      const reads = async (cols: string) => supabase.from('announcement_reads').select(`opened_at,ack_at,announcements!inner(${cols})`).eq('staff_id', me.id).gte('announcements.created_at', cut);
      let rr = await reads(ANN_SELECT_36); if (rr.error) rr = await reads(ANN_SELECT);
      const annRows = ((rr.data ?? []) as unknown as ReadRow[]).filter((x) => x.announcements);
      const isMgrAnn = (a: ReadRow['announcements']) => !!a.event_id && a.sender?.role !== undefined && a.sender.role !== 'admin';

      // manager threads: tonight's event (has a manager who isn't me) + any manager conversation still readable
      const { data: sh } = await supabase.from('shifts').select('id,event_id,events!inner(id,title,event_date,manager_id,manager:staff!events_manager_id_fkey(full_name,photo_url))')
        .eq('staff_id', me.id).neq('status', 'declined').is('attendance', null).eq('events.event_date', today);
      const { data: mc } = await supabase.from('conversations').select(CONV_COLS + ',events(title,event_date),manager:staff!conversations_manager_id_fkey(full_name,photo_url)').eq('staff_id', me.id).eq('kind', 'manager');
      type Ev = { id: string; title: string; event_date: string; manager_id: string | null; manager: { full_name: string; photo_url: string | null } | null };
      const convs = ((mc ?? []) as unknown as (Conv & { events: { title: string; event_date: string } | null; manager: { full_name: string; photo_url: string | null } | null })[])
        .filter((x) => !x.closes_at || new Date(x.closes_at).getTime() + 7 * 864e5 > Date.now());
      const rows = new Map<string, MgrRow>();
      for (const s of (sh ?? []) as unknown as { events: Ev }[]) {
        const e = s.events; if (!e.manager_id || e.manager_id === me.id || !e.manager) continue;
        rows.set(e.id, { event_id: e.id, title: e.title, date: e.event_date, manager: e.manager.full_name, photo: e.manager.photo_url, conv: null, last: null, unread: false, closed: false });
      }
      for (const x of convs) {
        const r = rows.get(x.event_id!) ?? { event_id: x.event_id!, title: x.events?.title ?? '', date: x.events?.event_date ?? '', manager: x.manager?.full_name ?? 'Manager', photo: x.manager?.photo_url ?? null, conv: null, last: null, unread: false, closed: false };
        r.conv = x; r.closed = !!x.closes_at && new Date(x.closes_at).getTime() <= Date.now(); rows.set(r.event_id, r);
      }
      for (const r of rows.values()) {
        const mine = annRows.filter((a) => a.announcements.event_id === r.event_id && isMgrAnn(a.announcements)).sort((a, b) => b.announcements.created_at.localeCompare(a.announcements.created_at));
        let lastMsg: Msg | null = null;
        if (r.conv) { const { data } = await supabase.from('messages').select(MSG_COLS).eq('conversation_id', r.conv.id).order('created_at', { ascending: false }).limit(1); lastMsg = ((data ?? []) as Msg[])[0] ?? null; }
        const la = mine[0]?.announcements;
        r.last = lastMsg && (!la || lastMsg.created_at > la.created_at) ? { at: lastMsg.created_at, text: preview(lastMsg, first(r.manager)) } : la ? { at: la.created_at, text: la.body.split('\n')[0] || '📷 Photo' } : null;
        r.unread = unread(r.conv) || mine.some((a) => !a.opened_at);
      }
      const mgrRows = [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
      setMgr(mgrRows);
      const inThread = new Set(mgrRows.map((r) => r.event_id));

      const list: Upd[] = [];
      for (const r of annRows) {
        const a = r.announcements; if (isMgrAnn(a) && inThread.has(a.event_id!)) continue;
        const [t, ...rest] = (a.body || '📷 Photo').split('\n');
        list.push({ key: 'a' + a.id, at: a.created_at, icon: '📣', title: t, sub: rest.join(' ').trim() || (a.events ? `${a.events.title}` : `From ${first(a.sender?.full_name) || 'G&R'}`), unread: !r.opened_at,
          from: a.sender?.role === 'admin' || !a.sender ? 'ronnie' : 'other', open: () => setAnn({ a, acked: !!r.ack_at }) });
      }
      await meetingMorningCheck(); // push 38 · "Today · 11:00 AM · …" on a meeting day
      const alertsQ = (cols: string) => supabase.from('staff_alerts').select(cols).eq('staff_id', me.id).gte('created_at', cut);
      let al = await alertsQ('id,kind,title,body,event_id,meeting_id,created_at,seen_at');
      if (al.error) al = await alertsQ('id,kind,title,body,event_id,created_at,seen_at'); // migration 043 not applied yet
      const alerts = (al.data ?? []) as unknown as AlertRow[];
      const evIds = [...new Set(alerts.map((a) => a.event_id).filter(Boolean))] as string[];
      const { data: rides } = await supabase.from('ride_offers').select('id,event_id,kind,sent_at,events(title,event_date)').eq('staff_id', me.id).not('sent_at', 'is', null).gte('sent_at', cut);
      const rideRows = (rides ?? []) as unknown as { id: string; event_id: string; kind: string; sent_at: string; events: { title: string; event_date: string } | null }[];
      const allEv = [...new Set([...evIds, ...rideRows.map((r) => r.event_id)])];
      const shiftOf: Record<string, string> = {};
      if (allEv.length) { const { data: ms } = await supabase.from('shifts').select('id,event_id').eq('staff_id', me.id).in('event_id', allEv); for (const x of (ms ?? []) as { id: string; event_id: string }[]) shiftOf[x.event_id] = x.id; }
      const lbl: Record<string, string> = { booked: 'New shift', moved: 'Shift changed', changed: 'Shift changed', removed: 'Shift removed' };
      for (const a of alerts.filter((x) => x.kind.startsWith('meeting'))) list.push({ key: 'n' + a.id, at: a.created_at, icon: a.kind === 'meeting_cancelled' ? '✕' : '👥', title: a.title, sub: a.body ?? '', unread: !a.seen_at, from: 'shift',
        open: () => { if (!a.seen_at) supabase.rpc('alert_seen', { p_id: a.id }).then(() => setTick((t) => t + 1)); if (a.meeting_id) nav(`/meeting/${a.meeting_id}`); } });
      for (const a of alerts.filter((x) => !x.kind.startsWith('meeting'))) list.push({ key: 'n' + a.id, at: a.created_at, icon: '🗓', title: `${lbl[a.kind] ?? 'Your schedule'} · ${a.title}`, sub: a.body ?? '', unread: !a.seen_at, from: 'shift',
        open: () => { setAlert({ ...a, shift: a.event_id ? shiftOf[a.event_id] ?? null : null }); if (!a.seen_at) supabase.rpc('alert_seen', { p_id: a.id }).then(() => setTick((t) => t + 1)); } });
      const seenR = ridesSeen();
      for (const r of rideRows) list.push({ key: 'r' + r.id, at: r.sent_at, icon: '🚗', title: `Ride plan${r.events ? ` · ${shortDate(r.events.event_date)}` : ''}`, sub: r.kind === 'driver' ? `You’re driving · ${r.events?.title ?? ''}` : `${r.events?.title ?? ''} · tap to see your car`, unread: !seenR.includes(r.id), from: 'shift',
        open: () => { markRideSeen(r.id); const s = shiftOf[r.event_id]; nav(s ? `/shift/${s}` : '/my-dates'); } });
      const { data: hq } = await supabase.from('hours_questions').select('id,status,answer_note,resolved_at,shifts(events(title,event_date))').eq('staff_id', me.id).neq('status', 'open').gte('resolved_at', cut);
      for (const q of (hq ?? []) as unknown as { id: string; status: string; answer_note: string | null; resolved_at: string; shifts: { events: { title: string; event_date: string } | null } | null }[]) {
        const e = q.shifts?.events;
        list.push({ key: 'h' + q.id, at: q.resolved_at, icon: '🕒', title: 'Ronnie answered your hours question', sub: `${e ? `${shortDate(e.event_date)} · ${e.title} · ` : ''}${q.status === 'fixed' ? '✓ Fixed' : 'Hours stay as recorded'}`,
          unread: !!rc && !!(rc as Conv).staff_seen_at ? (rc as Conv).staff_seen_at! < q.resolved_at : !!rc, from: 'ronnie', open: () => nav('/messages?c=ronnie') });
      }
      setUps(list.sort((a, b) => b.at.localeCompare(a.at)));
    })();
  }, [me.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (ups ?? []).filter((u) => filter === 'all' || (filter === 'ronnie' ? u.from === 'ronnie' : u.from === 'shift'));
  const nRonnie = (ups ?? []).filter((u) => u.from === 'ronnie' && u.unread).length;
  const rUnread = unread(ron?.conv);
  return (
    <main className="page v2 msg-page">
      <PageHead me={me} kicker="Inbox" title="Messages" />
      <button className={'msg-ron' + (rUnread ? ' unread' : '')} onClick={() => nav('/messages?c=ronnie')}>
        <Avatar name="Ronnie" url={RONNIE_PHOTO} size={48} />
        <span className="grow">
          <span className="spread"><b>Ronnie</b>{ron?.conv?.last_message_at && <small>{whenShort(ron.conv.last_message_at)}</small>}</span>
          <small className="muted">{ronnieSub()}</small>
          {ron?.last && <span className="msg-prev">{preview(ron.last, 'Ronnie')}</span>}
        </span>
        {rUnread && <i className="msg-n">1</i>}
      </button>
      <button className="msg-big" onClick={() => nav('/messages?new=1')}>✉ Message Ronnie</button>

      {mgr.map((r) => (
        <section key={r.event_id} className="stack" style={{ gap: 6 }}>
          <div className="msg-sec">{r.date === today ? 'TONIGHT' : shortDate(r.date).toUpperCase()} · {r.title.toUpperCase()}</div>
          <button className={'msg-ron mgr' + (r.unread ? ' unread' : '')} onClick={() => nav(`/messages?c=mgr:${r.event_id}`)}>
            <Avatar name={r.manager} url={r.photo} size={44} />
            <span className="grow">
              <span className="spread"><b>{first(r.manager)} · your manager{r.date === today ? ' tonight' : ''}</b>{r.last && <small>{whenShort(r.last.at)}</small>}</span>
              <small className="muted">{r.closed ? 'closed · read only' : 'until 12 h after the event'}</small>
              {r.last && <span className="msg-prev">{r.last.text}</span>}
            </span>
            {r.unread && <i className="msg-dot" />}
          </button>
        </section>
      ))}

      <div className="spread" style={{ alignItems: 'center', padding: '6px 4px 0' }}><div className="msg-sec" style={{ padding: 0 }}>UPDATES</div></div>
      <div className="msg-filters">
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'ronnie' ? 'on' : ''} onClick={() => setFilter('ronnie')}>From Ronnie{nRonnie ? ` · ${nRonnie}` : ''}</button>
        <button className={filter === 'shifts' ? 'on' : ''} onClick={() => setFilter('shifts')}>My shifts</button>
      </div>
      <section className="msg-ups">
        {ups === null ? <div className="loading" style={{ minHeight: 120 }} />
          : !shown.length ? <div className="muted sm" style={{ padding: '14px 6px' }}>Nothing here yet. Updates are kept 90 days.</div>
          : shown.map((u) => (
            <button key={u.key} className={'msg-up' + (u.unread ? ' unread' : '')} onClick={u.open}>
              <span className="msg-ic">{u.icon}</span>
              <span className="grow"><b>{u.title}</b>{u.sub && <span>{u.sub}</span>}</span>
              <small>{whenShort(u.at)}</small>
              {u.unread && <i className="msg-dot" />}
            </button>))}
      </section>
      <p className="muted sm" style={{ margin: '2px 6px', textAlign: 'center' }}>Only Ronnie and your manager write here. No chats between staff.</p>

      {ann && <AnnounceView a={ann.a} acked={ann.acked} onClose={() => { setAnn(null); setTick((t) => t + 1); }} onAck={() => { setAnn(null); setTick((t) => t + 1); }} />}
      {alert && (<>
        <div className="scrim" onClick={() => { setAlert(null); setTick((t) => t + 1); }} />
        <div className="sheet swipe" role="dialog" aria-label="Your schedule">
          <button className="sheet-x" aria-label="Close" onClick={() => { setAlert(null); setTick((t) => t + 1); }}>✕</button>
          <div><div className="kicker">🗓 YOUR SCHEDULE · {whenShort(alert.created_at).toUpperCase()}</div><div className="serif" style={{ fontSize: 26, lineHeight: 1.15, paddingRight: 44 }}>{alert.title}</div></div>
          {alert.body && <div className="ann-text">{alert.body}</div>}
          <button className="btn-ink" onClick={() => { setAlert(null); setTick((t) => t + 1); }}>OK, got it ✓</button>
          {alert.shift && alert.kind !== 'removed' && <Link className="btn-ghost" style={{ height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center' }} to={`/shift/${alert.shift}`}>Shift details ›</Link>}
        </div>
      </>)}
      <TabBar />
    </main>
  );
}

/* ───────── Ronnie conversation (+ Message Ronnie: topic, shift) ───────── */
type ShiftOpt = { id: string; planned_start: string; events: { title: string; event_date: string } };

function ThreadHead({ name, photo, sub, back = '/messages', right }: { name: string; photo?: string | null; sub: string; back?: string; right?: React.ReactNode }) {
  return (
    <header className="ch-head">
      <Link to={back} className="back" aria-label="Back">‹</Link>
      <Avatar name={name} url={photo} size={38} />
      <div className="grow" style={{ minWidth: 0 }}><b>{name}</b><small>{sub}</small></div>
      {right}
    </header>
  );
}

function RonnieThread({ me, compose, topicInit, shiftInit }: { me: Staff; compose: boolean; topicInit: Topic | null; shiftInit: string | null }) {
  const nav = useNavigate();
  const [convId, setConvId] = useState<string | null | undefined>(undefined);
  const [topic, setTopic] = useState<Topic | null>(topicInit);
  const [shift, setShift] = useState<ShiftOpt | null>(null);
  const [opts, setOpts] = useState<ShiftOpt[]>([]);
  useEffect(() => { supabase.from('conversations').select('id').eq('staff_id', me.id).eq('kind', 'ronnie').maybeSingle().then(({ data }) => setConvId((data as { id: string } | null)?.id ?? null)); }, [me.id]);
  useEffect(() => {
    if (!compose) return;
    const t = todayIso();
    supabase.from('shifts').select('id,planned_start,events!inner(title,event_date)').eq('staff_id', me.id).neq('status', 'declined').is('attendance', null)
      .gte('events.event_date', addDays(t, -14)).lte('events.event_date', addDays(t, 45)).order('planned_start')
      .then(({ data }) => {
        const l = (data ?? []) as unknown as ShiftOpt[];
        const up = l.filter((x) => x.events.event_date >= t); const past = l.filter((x) => x.events.event_date < t).reverse();
        const all = [...up, ...past]; setOpts(all);
        if (shiftInit) { const s = all.find((x) => x.id === shiftInit); if (s) { setShift(s); setTopic('shift'); } }
      });
  }, [compose, me.id, shiftInit]);
  const ensureConv = async () => { const { data, error } = await supabase.rpc('start_conversation'); if (error) throw error; setConvId(data as string); return data as string; };
  if (convId === undefined) return <div className="loading" />;
  const intro = compose ? (
    <div className="msg-new">
      <b className="sm">What’s it about?</b>
      <div className="msg-topics">
        {TOPICS.map((t) => <button key={t.k} className={topic === t.k ? 'on' : ''} onClick={() => { if (t.k === 'hours') { nav('/messages?hours=1', { replace: true }); return; } setTopic(topic === t.k ? null : t.k); if (t.k !== 'shift') setShift(null); }}>{t.ic} {t.label}</button>)}
        {topic === 'pay' && <button className="on">💵 Pay</button>}
      </div>
      {topic === 'shift' && (
        <div className="msg-pick">
          <small className="gold">🗓 A SHIFT · {shift ? 'ATTACHED' : 'PICK ONE'}</small>
          {shift ? <button className="on" onClick={() => setShift(null)}><b>{shortDate(shift.events.event_date)} · {shift.events.title} · {t12(shift.planned_start)}</b><span>Tap to pick another</span></button>
            : !opts.length ? <span className="muted sm">No shifts in the last 2 weeks or coming up.</span>
            : opts.slice(0, 8).map((o) => <button key={o.id} onClick={() => setShift(o)}><b>{shortDate(o.events.event_date)} · {o.events.title}</b><span>{t12(o.planned_start)}{o.events.event_date < todayIso() ? ' · worked' : ''}</span></button>)}
          <span className="muted sm">The shift is attached, so Ronnie knows which one right away.</span>
        </div>
      )}
      {convId && <button className="link-btn" onClick={() => nav('/messages?c=ronnie', { replace: true })}>See our conversation ›</button>}
    </div>
  ) : null;
  return (
    <main className="page v2 ch-page">
      <ThreadHead name="Ronnie" photo={RONNIE_PHOTO} sub={compose ? (topic ? `${topicLabel(topic)}${shift ? ' · shift attached' : ''}` : ronnieSub()) : ronnieSub()} />
      <Chat convId={convId} meId={me.id} side="staff" ensureConv={ensureConv} placeholder={compose ? 'Type your message…' : 'Message Ronnie…'} quick={!compose}
        intro={intro ?? undefined}
        sendArgs={() => (compose ? { topic: topic ?? 'other', shift: topic === 'shift' ? shift?.id ?? null : null } : {})}
        onSent={() => { if (compose) nav('/messages?c=ronnie', { replace: true }); }}
        empty={<div className="msg-empty"><Avatar name="Ronnie" url={RONNIE_PHOTO} size={56} /><b>Message Ronnie</b><span>Questions about a shift, your hours, uniform, getting there… One conversation, everything with Ronnie.</span><button className="btn-ink" style={{ padding: '0 18px' }} onClick={() => nav('/messages?new=1', { replace: true })}>Pick a topic</button></div>} />
    </main>
  );
}

/* ───────── tonight's manager thread (his announcements + replies) ───────── */
type EvRow = { id: string; title: string; event_date: string; manager: { full_name: string; photo_url: string | null } | null };
function MgrThread({ me, eventId }: { me: Staff; eventId: string }) {
  const nav = useNavigate();
  const [ev, setEv] = useState<EvRow | null>(null); const [conv, setConv] = useState<Conv | null>(null); const [convId, setConvId] = useState<string | null | undefined>(undefined);
  const [anns, setAnns] = useState<{ a: Ann; opened: boolean; acked: boolean }[]>([]); const [closesAt, setClosesAt] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    supabase.from('events').select('id,title,event_date,manager:staff!events_manager_id_fkey(full_name,photo_url)').eq('id', eventId).maybeSingle().then(({ data }) => setEv((data as unknown as EvRow) ?? null));
    supabase.from('conversations').select('id').eq('staff_id', me.id).eq('kind', 'manager').eq('event_id', eventId).maybeSingle().then(({ data }) => setConvId((data as { id: string } | null)?.id ?? null));
    supabase.rpc('event_closes_at', { ev: eventId }).then(({ data }) => setClosesAt((data as string) ?? null));
  }, [eventId, me.id]);
  useEffect(() => {
    (async () => {
      const q = (cols: string) => supabase.from('announcement_reads').select(`opened_at,ack_at,announcements!inner(${cols})`).eq('staff_id', me.id).eq('announcements.event_id', eventId);
      let r = await q(ANN_SELECT_36); if (r.error) r = await q(ANN_SELECT);
      const l = ((r.data ?? []) as unknown as ReadRow[]).filter((x) => x.announcements && x.announcements.sender?.role !== 'admin')
        .map((x) => ({ a: x.announcements as Ann, opened: !!x.opened_at, acked: !!x.ack_at })).sort((a, b) => a.a.created_at.localeCompare(b.a.created_at));
      setAnns(l);
      for (const x of l) if (!x.opened) supabase.rpc('announcement_seen', { p_id: x.a.id, p_ack: false }).then(() => {}); // opening the thread = Seen
    })();
  }, [eventId, me.id, tick]);
  const media = useMemo(() => anns.flatMap((x) => x.a.media.filter((m) => m.type === 'image').map((m) => m.path)), [anns]);
  const urls = useSigned(media, 'announcements');
  const [full, setFull] = useState<string | null>(null);
  const mgrName = ev?.manager?.full_name ?? 'Your manager';
  const closed = !!closesAt && new Date(closesAt).getTime() <= Date.now();
  const latest = anns[anns.length - 1]?.a.id ?? null;
  const extras = anns.map((x) => ({ id: x.a.id, at: x.a.created_at, node: (
    <div className="ch-row">
      <div className="ch-from">📣 {first(mgrName)} · to the team</div>
      <div className="ch-b">
        {x.a.media.some((m) => m.type === 'image') && <div className="ch-ph n2">{x.a.media.filter((m) => m.type === 'image').map((m) => urls[m.path] ? <img key={m.path} src={urls[m.path]} alt="" onClick={() => setFull(urls[m.path])} /> : <span key={m.path} />)}</div>}
        {x.a.body && <div className="ch-t">{x.a.body}</div>}
        {wantsGotIt(x.a) && (x.acked ? <div className="ch-got done">✓ Got it</div> : <button className="ch-got" onClick={async () => { await supabase.rpc('announcement_seen', { p_id: x.a.id, p_ack: true }); setTick((t) => t + 1); }}>Got it ✓</button>)}
        <div className="ch-meta">{t12(x.a.created_at)}</div>
      </div>
    </div>) }));
  if (convId === undefined) return <div className="loading" />;
  return (
    <main className="page v2 ch-page">
      <ThreadHead name={`${first(mgrName)} · your manager`} photo={ev?.manager?.photo_url} sub={`${ev?.title ?? ''}${ev ? ` · ${shortDate(ev.event_date)}` : ''} · replies go to ${first(mgrName)} and Ronnie`} />
      <Chat convId={convId} meId={me.id} side="staff" managerName={mgrName} extras={extras} placeholder={`Reply to ${first(mgrName)}…`} quick onConv={setConv}
        ensureConv={async () => { const { data, error } = await supabase.rpc('open_reply_thread', { p_announcement: latest }); if (error) throw error; setConvId(data as string); return data as string; }}
        sendArgs={() => ({ announcement: !conv || conv.announcement_id !== latest ? latest : null })}
        empty={<div className="msg-empty"><b>Nothing from {first(mgrName)} yet</b><span>When your manager messages the team, it shows here. You can reply to it.</span></div>}
        noComposer={closed ? <div className="ch-closed">{first(mgrName)}’s messages are closed. <button className="link-btn" onClick={() => nav('/messages?new=1')}>Message Ronnie ›</button></div>
          : !latest ? <div className="ch-closed">You can reply once {first(mgrName)} sends a message.</div> : undefined} />
      {full && <div className="photo-view" onClick={() => setFull(null)}><img src={full} alt="" style={{ width: 'min(94vw, 720px)', height: 'auto', maxHeight: '78vh', objectFit: 'contain' }} /><button className="photo-view-x">Close</button></div>}
    </main>
  );
}

/* ───────── 36g · My hours ───────── */
type P = { punch_in: string | null; punch_out: string | null } | null;
type WRow = { id: string; planned_start: string; attendance: string | null; punches: P | P[]; events: { title: string; event_date: string } };
const one = (p: P | P[]) => (Array.isArray(p) ? p[0] ?? null : p);

function MyHours({ me, pick }: { me: Staff; pick: string }) {
  const nav = useNavigate();
  const [rows, setRows] = useState<(Omit<WRow, 'punches'> & { punches: P })[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState<'start' | 'end' | 'other'>('end'); const [t, setT] = useState<string | null>(null); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    const today = todayIso();
    supabase.from('shifts').select('id,planned_start,attendance,punches(punch_in,punch_out),events!inner(title,event_date)').eq('staff_id', me.id).neq('status', 'declined')
      .gte('events.event_date', addDays(today, -30)).lte('events.event_date', today).order('planned_start', { ascending: false })
      .then(async ({ data }) => {
        const l = ((data ?? []) as unknown as WRow[]).map((r) => ({ ...r, punches: one(r.punches) })).filter((r) => !r.attendance && r.punches?.punch_in && r.punches.punch_out && new Date(r.punches.punch_out).getTime() <= Date.now());
        setRows(l);
        if (l.length) { const { data: q } = await supabase.from('hours_questions').select('shift_id').eq('status', 'open').in('shift_id', l.map((r) => r.id)); setOpen(Object.fromEntries(((q ?? []) as { shift_id: string }[]).map((x) => [x.shift_id, true]))); }
      });
  }, [me.id]);
  const s = pick !== '1' ? rows?.find((r) => r.id === pick) : null;
  const timeOf = (k: 'start' | 'end' | 'other') => (s && k !== 'other' ? hm24(k === 'start' ? s.punches!.punch_in! : s.punches!.punch_out!) : null);
  useEffect(() => { if (s) setT(timeOf(kind)); }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = (r: { punches: P }) => Math.round((new Date(r.punches!.punch_out!).getTime() - new Date(r.punches!.punch_in!).getTime()) / 900000) / 4;
  const range = (r: { punches: P }) => `${t12(r.punches!.punch_in!)} – ${t12(r.punches!.punch_out!)}`;

  if (rows === null) return <div className="loading" />;
  if (pick === '1' || !s) return (
    <main className="page v2 ch-page">
      <ThreadHead name="Message Ronnie" photo={RONNIE_PHOTO} sub="🕒 My hours · which shift?" back="/messages?new=1" />
      <div className="msg-sec">YOUR LAST SHIFTS</div>
      <section className="stack" style={{ gap: 8 }}>
        {!rows.length && <div className="card muted sm">No worked shifts in the last 30 days.</div>}
        {rows.map((r) => (
          <button key={r.id} className="msg-shift" onClick={() => nav(`/messages?hours=${r.id}`, { replace: true })}>
            <span className="grow"><b>{shortDate(r.events.event_date)} · {r.events.title}</b><span>{range(r)} · {fmtH(h(r))} h{open[r.id] ? ' · question sent' : ''}</span></span><span>›</span>
          </button>))}
      </section>
      <p className="muted sm" style={{ textAlign: 'center' }}>Last 30 days · only shifts you worked</p>
      <div className="grow" />
      <button className="msg-pay" onClick={() => nav('/messages?new=1&topic=pay', { replace: true })}>
        <span className="grow"><b>💵 About pay instead?</b><span>pay date, PayPal, a missing payment</span></span><span>›</span>
      </button>
    </main>
  );
  const send = async () => {
    setErr(''); setBusy(true);
    const ref = kind === 'start' ? s.punches!.punch_in! : s.punches!.punch_out!;
    const { error } = await supabase.rpc('ask_hours_in_messages', { p_shift: s.id, p_kind: kind, p_at: kind !== 'other' && t ? hmNear(ref, t) : null, p_note: note.trim() || null });
    setBusy(false); if (error) setErr(error.message); else nav('/messages?c=ronnie', { replace: true });
  };
  return (
    <main className="page v2 ch-page">
      <ThreadHead name="Message Ronnie" photo={RONNIE_PHOTO} sub={`${shortDate(s.events.event_date)} · ${s.events.title} · ${range(s)}`} back="/messages?hours=1" />
      {open[s.id] ? <div className="card stack"><b>You already asked about this shift.</b><span className="muted sm">Ronnie will answer in your conversation.</span><Link className="btn-ink" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }} to="/messages?c=ronnie" replace>See the conversation ›</Link></div> : <>
        <b style={{ padding: '0 4px' }}>What’s not right?</b>
        <div className="msg-topics">
          {(['start', 'end', 'other'] as const).map((k) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); setT(timeOf(k)); }}>{k === 'start' ? 'My start time' : k === 'end' ? 'My end time' : 'Something else'}</button>)}
        </div>
        {kind !== 'other' && <>
          <b style={{ padding: '0 4px' }}>When did you {kind === 'start' ? 'start' : 'end'}?</b>
          {t && <div className="card" style={{ padding: 8 }}><TimeWheel key={kind} value={t} onChange={setT} rest={t} /></div>}
          {t && <div className="muted sm" style={{ textAlign: 'center' }}>App says {t12(kind === 'start' ? s.punches!.punch_in! : s.punches!.punch_out!)} · you say {ampm15(t)}</div>}
        </>}
        <textarea className="msg-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'other' ? 'What happened?' : 'Note (optional) · e.g. stayed for the bar breakdown'} />
        {err && <p className="error">{err}</p>}
        <div className="grow" />
        <button className="msg-send-big" disabled={busy || (kind === 'other' ? !note.trim() : !t)} onClick={send}>{busy ? 'Sending…' : 'Send to Ronnie'}</button>
        <p className="muted sm" style={{ textAlign: 'center', margin: 0 }}>Same question as “Something wrong with these hours?” in Hours. Your hours stay as they are until Ronnie checks.</p>
      </>}
    </main>
  );
}
