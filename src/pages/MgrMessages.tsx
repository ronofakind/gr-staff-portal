import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { AnnounceComposer, AnnounceSent } from '../components/Announce';
import { SwipeSheet } from '../components/SwipeSheet';
import { Avatar } from '../components/Avatar';
import { Chat } from '../components/Chat';
import { first, shortDate, t12, todayIso, whenShort, type Conv, type InboxRow } from '../lib/messages';

/* Push 36e · manager Messages: only his event, only his team. 📣 Message my team, what he sent (Seen n of N), replies (REPLY / ✓ DONE).
   Opens when he's set as manager, closes 12 h after the event (read-only 7 days). Unanswered replies then go to Ronnie. */

type Ev = { id: string; title: string; event_date: string };
type TeamRow = { planned_start: string; attendance: string | null; staff_id: string };

export function MgrMessages({ me }: { me: { id: string; full_name: string } }) {
  const { eventId } = useParams(); const [sp, setSp] = useSearchParams(); const cId = sp.get('c');
  const [ev, setEv] = useState<Ev | null>(null); const [team, setTeam] = useState<TeamRow[]>([]);
  const [rows, setRows] = useState<InboxRow[] | null>(null); const [closesAt, setClosesAt] = useState<string | null>(null);
  const [compose, setCompose] = useState(false); const [tick, setTick] = useState(0); const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('events').select('id,title,event_date').eq('id', eventId!).maybeSingle().then(({ data }) => setEv((data as Ev) ?? null));
    supabase.from('shifts').select('planned_start,attendance,staff_id').eq('event_id', eventId!).neq('status', 'declined').then(({ data }) => setTeam(((data ?? []) as TeamRow[]).filter((x) => !x.attendance && x.staff_id !== me.id)));
    supabase.rpc('event_closes_at', { ev: eventId }).then(({ data }) => setClosesAt((data as string) ?? null));
  }, [eventId, me.id]);
  useEffect(() => {
    supabase.rpc('inbox', { p_event: eventId }).then(({ data, error }) => { if (error) { setErr(error.message); setRows([]); } else setRows((data ?? []) as InboxRow[]); });
  }, [eventId, tick, cId]);
  if (!ev) return <div className="loading" />;
  const closed = !!closesAt && new Date(closesAt).getTime() <= Date.now();
  const today = todayIso(); const prev = new Date(ev.event_date + 'T12:00:00'); prev.setDate(prev.getDate() - 1);
  const canSend = !closed && today >= prev.toISOString().slice(0, 10) && today <= ev.event_date; // same window as send_announcement
  const groups = [...new Set(team.map((x) => x.planned_start))].sort();
  const targets = [{ key: 'all', label: 'Whole team', n: team.length, audience: { kind: 'event' }, event_id: ev.id },
    ...(groups.length > 1 ? groups.map((g) => ({ key: g, label: t12(g), n: team.filter((x) => x.planned_start === g).length, audience: { kind: 'group', start: g }, event_id: ev.id })) : [])];
  const kicker = `${ev.event_date === today ? 'TONIGHT' : shortDate(ev.event_date).toUpperCase()} · ${ev.title.toUpperCase()}`;

  if (cId) {
    const r = rows?.find((x) => x.id === cId) ?? null;
    return <MgrConversation me={me} id={cId} row={r} closed={closed} back={() => { const n = new URLSearchParams(sp); n.delete('c'); setSp(n); }} onDone={() => setTick((t) => t + 1)} />;
  }
  return (
    <main className="page v2 msg-page">
      <header className="row" style={{ paddingTop: 12 }}>
        <Link to={`/manage/${ev.id}`} className="back" aria-label="Back">‹</Link>
        <span className="kicker">{kicker}</span>
      </header>
      <div className="serif" style={{ fontSize: 32, lineHeight: 1, padding: '0 6px' }}>Messages</div>
      {closed && <div className="mm-closed">🔒 <span className="grow"><b>Closed · {new Date(closesAt!).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })}</b><br />12 h after the event. You can still read them for 7 days. Anything else goes to Ronnie.</span></div>}
      {canSend ? <button className="msg-big" onClick={() => setCompose(true)}>📣 Message my team · {team.length}</button>
        : !closed && <div className="muted sm" style={{ padding: '0 6px' }}>You can message your team from the day before the event until it ends.</div>}
      {err && <p className="error">{err}</p>}
      <div className="msg-sec">YOU SENT</div>
      <div className="card" style={{ padding: '4px 14px' }}><AnnounceSent eventId={ev.id} reload={tick} /></div>
      <div className="msg-sec">REPLIES FROM YOUR TEAM</div>
      <section className="msg-ups">
        {rows === null ? <div className="loading" style={{ minHeight: 80 }} />
          : !rows.length ? <div className="muted sm" style={{ padding: '10px 6px' }}>No replies yet. Staff can reply to your messages; they can’t message you first.</div>
          : rows.map((r) => (
            <Link key={r.id} to={`?c=${r.id}`} className={'msg-up mm-row' + (r.needs_reply ? ' unread' : '')}>
              <Avatar name={r.staff_name} url={r.staff_photo} size={36} />
              <span className="grow"><span className="spread"><b>{r.staff_name}</b><small>{whenShort(r.last_message_at)}</small></span>
                <span>{r.last_from === 'manager' ? 'You: ' : r.last_from === 'admin' ? 'Ronnie: ' : ''}{r.last_body || (r.last_photos ? '📷 Photo' : '')}</span>
                <span className="row" style={{ gap: 6 }}>{r.needs_reply ? <i className="ib-tag red">REPLY</i> : r.status === 'done' ? <i className="ib-tag">✓ DONE</i> : r.last_from === 'admin' ? <i className="ib-tag ok">RONNIE ANSWERED</i> : r.last_from === 'manager' ? <i className="ib-tag ok">✓ ANSWERED</i> : closed ? <i className="ib-tag gold">NO ANSWER · SENT TO RONNIE</i> : null}</span>
              </span>
            </Link>))}
      </section>
      <p className="muted sm" style={{ textAlign: 'center' }}>Only your event, only your team. Ronnie sees the replies too.</p>
      {compose && (<>
        <div className="scrim" onClick={() => setCompose(false)} />
        <SwipeSheet onClose={() => setCompose(false)} label="Message your team" x={false}>
          <AnnounceComposer targets={targets} folder={ev.id} onClose={() => setCompose(false)} onSent={() => { setCompose(false); setTick((t) => t + 1); }} />
        </SwipeSheet>
      </>)}
    </main>
  );
}

function MgrConversation({ me, id, row, closed, back, onDone }: { me: { id: string; full_name: string }; id: string; row: InboxRow | null; closed: boolean; back: () => void; onDone: () => void }) {
  const [conv, setConv] = useState<Conv | null>(null); const [tick, setTick] = useState(0);
  const name = row?.staff_name ?? '…';
  const done = async () => { if (!conv) return; await supabase.rpc('mark_done', { p_conversation: conv.id, p_done: conv.status !== 'done' }); setTick((t) => t + 1); onDone(); };
  return (
    <main className="page v2 ch-page">
      <header className="ch-head">
        <button className="back" aria-label="Back" onClick={back} style={{ border: 0 }}>‹</button>
        <Avatar name={name} url={row?.staff_photo} size={38} />
        <div className="grow" style={{ minWidth: 0 }}><b>{name}</b><small>{row?.re ? `Re: ${row.re} · ` : ''}Ronnie sees this too</small></div>
        {conv && !closed && <button className="pill-line" style={{ height: 32 }} onClick={done}>{conv.status === 'done' ? 'Reopen' : '✓ Done'}</button>}
      </header>
      <Chat convId={id} meId={me.id} side="manager" managerName={me.full_name} onConv={setConv} reloadKey={tick} placeholder={`Reply to ${first(name)}…`}
        noComposer={closed ? <div className="ch-closed">Closed 12 h after the event. Read only.</div> : undefined} />
    </main>
  );
}
