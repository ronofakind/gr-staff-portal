import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AnnounceComposer, AnnounceSent, type Target } from '../components/Announce';
import { Avatar } from '../components/Avatar';
import { Chat } from '../components/Chat';
import { first, shiftLine, shortDate, t12, topicLabel, whenShort, MSG_COLS, type Conv, type InboxRow, type Msg } from '../lib/messages';
import { eventsBetween, allStaff, isoDay, addDays, dLabel, ap12, type AEvent, type AStaff } from './api';

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });

/** Admin → Messages (push 36d): Needs reply · All · Sent + New message (the push-25e composer). Inbox is admins only; no email. */
export function Messages() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as 'needs' | 'all' | 'sent' | null) ?? 'needs';
  const cId = sp.get('c'); const staffId = sp.get('staff');
  const [rows, setRows] = useState<InboxRow[] | null>(null); const [err, setErr] = useState('');
  const [compose, setCompose] = useState(false); const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);
  const go = (p: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(p)) { if (v === null) n.delete(k); else n.set(k, v); } setSp(n); };

  useEffect(() => {
    supabase.rpc('inbox').then(({ data, error }) => { if (error) { setErr(/inbox/.test(error.message) ? 'Messages need migration 042 (apply it in the Supabase SQL editor).' : error.message); setRows([]); } else setRows((data ?? []) as InboxRow[]); });
  }, [tick, cId]);
  // ✉ Message from a staff profile / team list → their conversation (created if needed)
  useEffect(() => {
    if (!staffId) return;
    supabase.rpc('start_conversation', { p_staff: staffId }).then(({ data, error }) => { if (error) setErr(error.message); else go({ staff: null, c: data as string }); });
  }, [staffId]); // eslint-disable-line react-hooks/exhaustive-deps

  const unreadIt = async (r: { id: string; staff_name: string }) => { await supabase.rpc('admin_mark_unread', { p_conversation: r.id }); setToast(`Back in Needs reply. Only for you. ${first(r.staff_name)} sees no change.`); setTick((t) => t + 1); };
  const doneIt = async (r: { id: string }, on = true) => { await supabase.rpc('mark_done', { p_conversation: r.id, p_done: on }); setTick((t) => t + 1); };

  if (cId) return <AdminConversation id={cId} row={rows?.find((r) => r.id === cId) ?? null} onBack={() => go({ c: null })} onUnread={unreadIt} onDone={doneIt} toast={toast} />;

  const needs = (rows ?? []).filter((r) => r.needs_reply);
  const list = tab === 'needs' ? needs : rows ?? [];
  return (
    <div className="stack-lg">
      <div className="toolbar"><div><div className="kick">YOUR ADMIN · MESSAGES</div><h1 className="serif-h">{tab === 'sent' ? 'Sent' : 'Inbox'}</h1></div>
        <button className="abtn dark" onClick={() => setCompose(true)}>✉ New message</button></div>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={tab === 'needs' ? 'on' : ''} onClick={() => go({ tab: null })}>Needs reply{needs.length ? <b className="accent"> {needs.length}</b> : ''}</button>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => go({ tab: 'all' })}>All</button>
        <button className={tab === 'sent' ? 'on' : ''} onClick={() => go({ tab: 'sent' })}>Sent</button>
      </div>
      {err && <p className="error">{err}</p>}
      {tab === 'sent' ? <div className="adm-card" style={{ maxWidth: 760, padding: '6px 16px' }}><AnnounceSent reload={tick} /></div> : (
        <div className="adm-card ib-list" style={{ maxWidth: 760, padding: 0 }}>
          {rows === null ? <div className="muted" style={{ padding: 16 }}>Loading…</div>
            : !list.length ? <div className="muted sm" style={{ padding: 16 }}>{tab === 'needs' ? 'Nothing waiting on you. ✓' : 'No conversations yet.'}</div>
            : list.map((r) => <InboxItem key={r.id} r={r} onOpen={() => go({ c: r.id })} onUnread={() => unreadIt(r)} onDone={() => doneIt(r, r.status !== 'done')} />)}
          <div className="muted sm ib-foot">{tab === 'needs' ? 'The whole message shows here. Reading it here sends nothing: staff only see Seen once you open the conversation.' : 'Opened by mistake or want to answer later? Swipe left → Mark unread. Replies to a manager show here, not in Needs reply, unless he never answered and his messages closed.'}</div>
        </div>
      )}
      {compose && <NewMessage onClose={() => setCompose(false)} onSent={() => { setCompose(false); setTick((t) => t + 1); go({ tab: 'sent' }); }} />}
      {toast && <div className="undo-bar" role="status"><span className="ib-dot" /><span className="grow">{toast}</span></div>}
    </div>
  );
}

/** push 40 · shift notes / asks: what they are + where they stand (in All, never Needs reply). */
const CARD_LABEL: Record<string, string> = { shift_changed: 'Shift changed', new_shift: 'New shift', shift_removed: 'Shift removed', ask: 'Asked first', ask_result: 'Answered' };
function noteTag(r: InboxRow) {
  const m = (r.last_meta ?? {}) as Record<string, unknown>; const card = m.card as string | undefined;
  if (r.last_from !== 'system' || !card) return null;
  const seen = !!r.staff_seen_at && r.staff_seen_at >= r.last_message_at;
  if (card === 'shift_changed') return typeof m.got_it_at === 'string' ? <i className="ib-tag ok">✓ GOT IT {t12(m.got_it_at).toUpperCase()}</i> : seen ? <i className="ib-tag">SEEN · NO ANSWER</i> : <i className="ib-tag red">NOT OPENED</i>;
  if (card === 'ask') return m.state === 'yes' ? <i className="ib-tag ok">✓ YES</i> : m.state === 'no' ? <i className="ib-tag red">NO</i> : m.state === 'expired' ? <i className="ib-tag">NO ANSWER</i> : <i className="ib-tag gold">WAITING{seen ? ' · SEEN' : ''}</i>;
  if (card === 'ask_result') return m.answer === 'yes' ? <i className="ib-tag ok">✓ YES</i> : m.answer === 'no' ? <i className="ib-tag red">NO</i> : null;
  return seen ? <i className="ib-tag">SEEN</i> : <i className="ib-tag red">NOT OPENED</i>;
}
function subOf(r: InboxRow) {
  const card = (r.last_meta as Record<string, unknown> | null)?.card as string | undefined;
  if (r.last_from === 'system' && card && CARD_LABEL[card]) { const m = r.last_meta as Record<string, unknown>; const d = (m.date as string | undefined) ?? ((m.new as { date?: string } | undefined)?.date);
    return `🗓 ${CARD_LABEL[card]}${d ? ` · ${shortDate(d)}` : ''}`; }
  if (r.kind === 'manager') return `${r.event_title ?? ''}${r.event_date ? ` · ${shortDate(r.event_date)}` : ''}${r.re ? ` · Re: ${r.re}` : ''}`;
  const m = r.last_meta ?? {};
  if (m.hours && m.shift) return `🕒 Hours · ${shortDate(m.shift.date)} · ${m.shift.title}`;
  if (m.shift) return `A shift · ${shortDate(m.shift.date)} · ${m.shift.title}`;
  if (m.re) return `Re: ${m.re}`;
  return topicLabel(r.last_topic) ?? '';
}
function bodyOf(r: InboxRow) {
  if (r.last_kind === 'hours') { const h = r.last_meta?.hours; return `${h?.kind === 'other' ? 'Something else is wrong' : `Says they ${h?.kind === 'start' ? 'started' : 'ended'} at ${h?.claimed_at ? t12(h.claimed_at) : '?'}`}${r.last_body ? ` · “${r.last_body}”` : ''}`; }
  return (r.last_body || '') + (r.last_photos ? `${r.last_body ? ' ' : ''}📷 ${r.last_photos} photo${r.last_photos > 1 ? 's' : ''}` : '');
}

function InboxItem({ r, onOpen, onUnread, onDone }: { r: InboxRow; onOpen: () => void; onUnread: () => void; onDone: () => void }) {
  const [dx, setDx] = useState(0); const [x0, setX0] = useState<number | null>(null);
  const mgr = first(r.manager_name) || 'Manager';
  const fromStaff = r.last_from === 'staff';
  const seenTag = fromStaff ? (r.admin_seen_at && r.last_staff_at && r.admin_seen_at >= r.last_staff_at ? <i className="ib-tag ok">SEEN {t12(r.admin_seen_at).toUpperCase()}</i> : <i className="ib-tag">NOT OPENED · NO “SEEN” YET</i>) : null;
  const mgrTag = r.kind !== 'manager' ? null
    : r.last_from === 'manager' ? <i className="ib-tag ok">✓ {mgr.toUpperCase()} ANSWERED</i>
    : r.last_from === 'admin' ? <i className="ib-tag ok">✓ YOU ANSWERED</i>
    : fromStaff && r.closed && r.status === 'open' ? <i className="ib-tag gold">NO ANSWER · SENT TO YOU</i>
    : fromStaff && r.status === 'open' ? <i className="ib-tag gold">{mgr.toUpperCase()} HASN’T ANSWERED</i> : null;
  return (
    <div className="need-wrap ib-wrap">
      <div className="ib-under"><button className="ib-un" onClick={() => { setDx(0); onUnread(); }}>● Mark unread</button><button className="ib-dn" onClick={() => { setDx(0); onDone(); }}>✓ {r.status === 'done' ? 'Reopen' : 'Done'}</button></div>
      <div className={'ib-row' + (r.needs_reply || r.admin_unread ? ' hot' : '')} style={{ transform: `translateX(${dx}px)`, transition: x0 === null ? 'transform .2s' : 'none' }}
        onTouchStart={(e) => setX0(e.touches[0].clientX)} onTouchMove={(e) => { if (x0 !== null) setDx(Math.max(-190, Math.min(0, e.touches[0].clientX - x0))); }}
        onTouchEnd={() => { setX0(null); setDx(dx < -70 ? -184 : 0); }}>
        <button className="ib-main" onClick={() => (dx ? setDx(0) : onOpen())}>
          <Avatar name={r.staff_name} url={r.staff_photo} size={40} />
          <span className="grow">
            <span className="spread"><b>{r.staff_name}{r.kind === 'manager' ? ` → ${mgr}` : ''}</b><small className="muted nowrap">{whenShort(r.last_message_at)}</small></span>
            {subOf(r) && <small className="muted">{subOf(r)}</small>}
            <span className="ib-body">{r.last_from === 'staff' ? '' : r.last_from === 'admin' ? 'You: ' : r.last_from === 'manager' ? `${mgr}: ` : ''}{bodyOf(r)}</span>
            <span className="row wrap" style={{ gap: 6 }}>
              {r.needs_reply && <i className="ib-tag red">REPLY</i>}
              {r.admin_unread && <i className="ib-tag gold">● UNREAD</i>}
              {r.status === 'done' && <i className="ib-tag">✓ DONE</i>}
              {mgrTag}{r.kind === 'ronnie' && seenTag}{noteTag(r)}
            </span>
          </span>
        </button>
        <button className="sq ib-more" aria-label="Mark unread or Done" onClick={() => setDx(dx ? 0 : -184)}>⋯</button>
      </div>
    </div>
  );
}

function AdminConversation({ id, row, onBack, onUnread, onDone, toast }: { id: string; row: InboxRow | null; onBack: () => void; onUnread: (r: { id: string; staff_name: string }) => void; onDone: (r: { id: string }, on?: boolean) => void; toast: string | null }) {
  const [meId, setMeId] = useState<string | null>(null); const [conv, setConv] = useState<Conv | null>(null);
  const [who, setWho] = useState<{ full_name: string; photo_url: string | null; phone: string | null } | null>(null);
  const [lastShift, setLastShift] = useState<Msg['meta']['shift'] | null>(null); const [menu, setMenu] = useState(false);
  const [mgrName, setMgrName] = useState<string | null>(null); const [tick, setTick] = useState(0);
  useEffect(() => { supabase.rpc('me').then(({ data }) => setMeId((data as string) ?? null)); }, []);
  useEffect(() => {
    if (!conv) return;
    supabase.from('staff').select('full_name,photo_url,phone').eq('id', conv.staff_id).maybeSingle().then(({ data }) => setWho((data as typeof who) ?? null));
    if (conv.manager_id) supabase.from('staff').select('full_name').eq('id', conv.manager_id).maybeSingle().then(({ data }) => setMgrName((data as { full_name: string } | null)?.full_name ?? null));
    supabase.from('messages').select(MSG_COLS).eq('conversation_id', conv.id).not('meta->shift', 'is', null).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => setLastShift(((data ?? []) as Msg[])[0]?.meta?.shift ?? null));
  }, [conv?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = who?.full_name ?? row?.staff_name ?? '…';
  const tel = who?.phone?.replace(/[^\d+]/g, '');
  const sub = conv?.kind === 'manager' ? `Reply to ${first(mgrName)}’s message · ${row?.event_title ?? ''} · ${first(name)} sees “Ronnie” on your answer`
    : lastShift ? `A shift · ${shiftLine(lastShift)}` : 'replies go only to them';
  return (
    <div className="stack ib-conv">
      <div className="ib-chead">
        <button className="sq" aria-label="Back" onClick={onBack}>‹</button>
        <Avatar name={name} url={who?.photo_url ?? row?.staff_photo} size={40} />
        <div className="grow" style={{ minWidth: 0 }}><b>{name}{conv?.kind === 'manager' ? ` → ${first(mgrName)}` : ''}</b><small className="muted">{sub}</small></div>
        {tel && <a className="abtn sm" href={`tel:${tel}`}>Call</a>}
        <div style={{ position: 'relative' }}>
          <button className="sq" aria-label="More" onClick={() => setMenu(!menu)}>⋯</button>
          {menu && conv && <div className="ib-menu" onClick={() => setMenu(false)}>
            <button onClick={() => onUnread({ id: conv.id, staff_name: name })}><i className="ib-dot" /> Mark unread</button>
            <button onClick={() => { onDone({ id: conv.id }, conv.status !== 'done'); setTick((t) => t + 1); }}>✓ {conv.status === 'done' ? 'Reopen' : 'Done'}</button>
            {(lastShift?.event_id || conv.event_id) && <Link to={`/admin/event/${lastShift?.event_id ?? conv.event_id}`}>🗓 Open the shift</Link>}
          </div>}
        </div>
      </div>
      {lastShift && conv?.kind === 'ronnie' && <div className="ch-shift" style={{ alignSelf: 'flex-start' }}>🗓 {shortDate(lastShift.date).toUpperCase()} · {lastShift.title.toUpperCase()}</div>}
      <div className="adm-card ib-chat">
        {meId ? <Chat convId={id} meId={meId} side="admin" managerName={mgrName} onConv={setConv} reloadKey={tick} placeholder={`Reply to ${first(name)}…`} /> : <div className="loading" style={{ minHeight: 200 }} />}
      </div>
      <small className="muted">{conv?.status === 'done' ? '✓ Done · a new message from them opens it again.' : 'Mark unread is only on your side: staff never see that you used it.'}</small>
      {toast && <div className="undo-bar" role="status"><span className="ib-dot" /><span className="grow">{toast}</span></div>}
    </div>
  );
}

/** "New message" (push 25e composer): everyone / a day / an event / a start group / one person. */
function NewMessage({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const today = isoDay(new Date());
  const [evs, setEvs] = useState<AEvent[]>([]); const [staff, setStaff] = useState<AStaff[]>([]);
  const [kind, setKind] = useState<'event' | 'group' | 'day' | 'person' | 'all'>('event');
  const [evId, setEvId] = useState(''); const [start, setStart] = useState(''); const [day, setDay] = useState(today); const [person, setPerson] = useState('');
  const [write, setWrite] = useState(false);
  useEffect(() => { eventsBetween(today, addDays(today, 14)).then((e) => { setEvs(e); setEvId(e[0]?.id ?? ''); }); allStaff().then(setStaff); }, [today]);
  const ev = evs.find((e) => e.id === evId);
  const team = ev ? ev.shifts.filter((s) => s.status !== 'declined' && !s.attendance) : [];
  const groups = [...new Set(team.map((s) => s.planned_start))].sort();
  const dayN = evs.filter((e) => e.event_date === day).reduce((n, e) => n + e.shifts.filter((s) => s.status !== 'declined').length, 0);
  const p = staff.find((s) => s.full_name === person);
  const target: Target | null = kind === 'event' && ev ? { key: 'e', label: `${ev.title} · whole team`, n: team.length, audience: { kind: 'event' }, event_id: ev.id }
    : kind === 'group' && ev && start ? { key: 'g', label: `${ev.title} · ${ap12(hm(start))}`, n: team.filter((s) => s.planned_start === start).length, audience: { kind: 'group', start }, event_id: ev.id }
    : kind === 'day' ? { key: 'd', label: `Everyone booked · ${dLabel(day)}`, n: dayN, audience: { kind: 'day', date: day }, event_id: null }
    : kind === 'person' && p ? { key: 'p', label: p.full_name, n: 1, audience: { kind: 'people', ids: [p.id] }, event_id: null }
    : kind === 'all' ? { key: 'a', label: 'Everyone', n: staff.filter((s) => s.active).length, audience: { kind: 'all' }, event_id: null } : null;
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560, width: '100%' }}>
      {write && target ? <AnnounceComposer targets={[target]} folder={target.event_id ?? 'all'} gotItSwitch title="New message" onClose={() => setWrite(false)} onSent={onSent} /> : (
        <div className="stack" style={{ gap: 12 }}>
          <div className="spread"><div><div className="kick">YOUR ADMIN · NEW MESSAGE</div><div className="serif" style={{ fontSize: 24 }}>Who is it for?</div></div><button className="sq" aria-label="Close" onClick={onClose}>×</button></div>
          <div className="seg3">{([['event', 'An event'], ['group', 'A start group'], ['day', 'A day'], ['person', 'One person'], ['all', 'Everyone']] as const).map(([k, l]) => <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{l}</button>)}</div>
          {(kind === 'event' || kind === 'group') && <select value={evId} onChange={(e) => { setEvId(e.target.value); setStart(''); }} className="msg-in">{evs.map((e) => <option key={e.id} value={e.id}>{dLabel(e.event_date)} · {e.title}{e.department === 'bar' ? ' · BAR' : ''}</option>)}</select>}
          {kind === 'group' && <select value={start} onChange={(e) => setStart(e.target.value)} className="msg-in"><option value="">Pick a start time…</option>{groups.map((g) => <option key={g} value={g}>{ap12(hm(g))} · {team.filter((s) => s.planned_start === g).length} people</option>)}</select>}
          {kind === 'day' && <input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="msg-in" />}
          {kind === 'person' && <><input list="msg-people" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Search staff…" className="msg-in" /><datalist id="msg-people">{staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.full_name} />)}</datalist>
            {p && <small className="muted">For a back-and-forth with one person, use ✉ Message on their profile instead.</small>}</>}
          <button className="abtn dark" disabled={!target || !target.n} onClick={() => setWrite(true)}>Write to {target ? `${target.label} · ${target.n}` : '…'}</button>
          <small className="muted">Opening it shows as Seen to you. They can reply: replies land in your Inbox. Phone buzz comes with app notifications.</small>
        </div>
      )}
    </div></div>
  );
}
