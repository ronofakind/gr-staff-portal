import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from './Avatar';
import { Composer } from './Chat';
import { RONNIE_PHOTO, dayHead, dayOf, first, t12, uploadPhotos, useSigned } from '../lib/messages';
import { TEAM_MSG_COLS, TEAM_QUICK, dayOnly, dayTime, readOnlyUntil, teamInfo, type TeamInfo, type TeamMsg } from '../lib/teamChat';

/* Push 41 · one event's team chat (staff, managers, Ronnie). Names on every bubble, MANAGER badge, 📌 pinned message on top,
   photos when allowed, quick replies. Press and hold: your own → Edit / Delete · manager / Ronnie → Pin for everyone · Reply ·
   Remove message ("Removed by the manager"). After closing: read-only for 7 days. Still no private staff-to-staff chat. */

export function TeamChat({ eventId, meId, back = '/messages' }: { eventId: string; meId: string; back?: string }) {
  const [info, setInfo] = useState<TeamInfo | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<TeamMsg[] | null>(null);
  const [text, setText] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState<TeamMsg | null>(null); const [replyTo, setReplyTo] = useState<TeamMsg | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [full, setFull] = useState<string | null>(null);
  const holdT = useRef<number>(); const end = useRef<HTMLDivElement>(null); const lastN = useRef(0); const seenLast = useRef<string | null>(null);

  const load = async () => {
    let i: TeamInfo | null = null;
    try { i = await teamInfo(eventId); } catch (e) { setErr((e as Error).message); }
    setInfo(i);
    if (!i?.conversation_id) { setMsgs([]); return; }
    const { data } = await supabase.from('messages').select(TEAM_MSG_COLS).eq('conversation_id', i.conversation_id).order('created_at');
    const list = (data ?? []) as unknown as TeamMsg[];
    setMsgs(list);
    const last = list[list.length - 1]?.id ?? null;
    if (last && last !== seenLast.current) { seenLast.current = last; supabase.rpc('team_seen', { p_conversation: i.conversation_id }).then(() => {}); }
  };
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const n = msgs?.length ?? 0; if (n !== lastN.current) { lastN.current = n; end.current?.scrollIntoView({ block: 'end' }); } }, [msgs]);
  const urls = useSigned((msgs ?? []).flatMap((m) => m.photo_paths ?? []));

  if (info === undefined) return <div className="loading" style={{ minHeight: 200 }} />;
  if (info === null) return (
    <>
      <header className="ch-head"><Link to={back} className="back" aria-label="Back">‹</Link><span className="tc-av">👥</span><div className="grow"><b>Team chat</b><small>not open</small></div></header>
      <div className="msg-empty"><b>This team chat isn’t open</b><span>Team chats open the day before the event and close 12 h after it.</span>{err && <p className="error">{err}</p>}</div>
    </>
  );

  const me = info.me; const conv = info.conversation_id;
  const nameOf = (id: string | null) => { if (!id) return 'G&R'; const p = info.people[id]; return p?.admin ? 'Ronnie' : first(p?.name) || '…'; };
  const isMgr = (id: string | null) => !!id && info.managers.includes(id);
  const canWrite = me.can_write && !!conv;
  const sub = info.state === 'open' ? `${me.manager ? 'You’re the manager' : `${info.n_members} people`} · open until ${dayTime(info.closes_at)}`
    : info.state === 'readonly' ? `Closed · read only until ${dayOnly(readOnlyUntil(info.closes_at))}`
    : info.state === 'before' ? `Opens ${dayTime(info.opens_at)} (day before)`
    : info.state === 'off' ? 'Off · only you can see this' : 'Closed · hidden from staff';

  const send = async (body: string, withFiles: File[] = files) => {
    setErr('');
    if (!conv || (!body.trim() && !withFiles.length)) return;
    setBusy(true);
    try {
      if (editing) {
        const { error } = await supabase.rpc('edit_message', { p_id: editing.id, p_body: body });
        if (error) throw error;
        setEditing(null); setText(''); await load(); return;
      }
      const paths = withFiles.length ? await uploadPhotos(conv, withFiles) : [];
      const { error } = await supabase.rpc('team_send', { p_conversation: conv, p_body: body.trim(), p_photos: paths, p_reply_to: replyTo?.id ?? null });
      if (error) throw error;
      setText(''); setFiles([]); setReplyTo(null); await load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const act = async (fn: string, args: Record<string, unknown>, ask?: string) => {
    setMenu(null);
    if (ask && !window.confirm(ask)) return;
    const { error } = await supabase.rpc(fn, args);
    if (error) setErr(error.message); else setErr('');
    load();
  };
  const jump = (id: string) => document.getElementById('tm-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  const list = msgs ?? [];
  return (
    <div className="ch tc-chat">
      <header className="ch-head">
        <Link to={back} className="back" aria-label="Back">‹</Link>
        <span className="tc-av">👥</span>
        <div className="grow" style={{ minWidth: 0 }}><b>{info.title} team</b><small>{sub}</small></div>
      </header>
      {info.pinned && (
        <button className="tc-pin" onClick={() => jump(info.pinned!.id)}>
          <span>📌</span><span className="grow"><b>{nameOf(info.pinned.sender_id)}:</b> {info.pinned.body || (info.pinned.photos ? '📷 Photo' : '')}</span>
        </button>
      )}
      <div className="ch-list" onClick={() => menu && setMenu(null)}>
        {msgs === null ? <div className="loading" style={{ minHeight: 160 }} />
          : !list.length ? <div className="msg-empty"><span className="tc-av big">👥</span><b>{info.title} team</b><span>Messages here go to everyone in the team chat{me.admin ? '' : ' and Ronnie'}. Keep it about tonight’s event.</span></div>
          : list.map((m, i) => {
            const mine = m.sender_id === meId;
            const pinned = info.pinned?.id === m.id;
            const senderAdmin = m.sender_role === 'admin' || !!(m.sender_id && info.people[m.sender_id]?.admin);
            const items: { k: string; label: string; red?: boolean; run: () => void }[] = [];
            if (!m.deleted_at) {
              if (me.can_pin) items.push({ k: 'pin', label: pinned ? '📌 Unpin' : '📌 Pin for everyone', run: () => act('team_pin', { p_message: m.id, p_on: !pinned }) });
              if ((me.manager || me.admin) && canWrite) items.push({ k: 'reply', label: '↩ Reply', run: () => { setMenu(null); setEditing(null); setReplyTo(m); } });
              if (mine && canWrite) items.push({ k: 'edit', label: '✏️ Edit', run: () => { setMenu(null); setReplyTo(null); setEditing(m); setText(m.body); } });
              if (mine) items.push({ k: 'del', label: '🗑 Delete', red: true, run: () => act('delete_message', { p_id: m.id }, 'Delete this message? It shows as “Message deleted”.') });
              else if (me.can_remove && (me.admin || !senderAdmin)) items.push({ k: 'rm', label: '🗑 Remove message', red: true, run: () => act('team_remove_message', { p_message: m.id }, `Remove ${nameOf(m.sender_id)}’s message for everyone? It shows as “Removed by the manager”.`) });
            }
            const hold = items.length ? {
              onPointerDown: () => { window.clearTimeout(holdT.current); holdT.current = window.setTimeout(() => setMenu(m.id), 450); },
              onPointerUp: () => window.clearTimeout(holdT.current), onPointerLeave: () => window.clearTimeout(holdT.current), onPointerCancel: () => window.clearTimeout(holdT.current),
              onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); setMenu(m.id); },
            } : {};
            const gone = m.deleted_at ? (m.removed_role === 'admin' ? 'Removed by Ronnie' : m.removed_role ? 'Removed by the manager' : 'Message deleted') : null;
            const reply = m.meta?.reply as { id: string; sender_id: string | null; text: string } | undefined;
            return (
              <Fragment key={m.id}>
                {(i === 0 || dayOf(list[i - 1].created_at) !== dayOf(m.created_at)) && <div className="ch-day">{dayHead(m.created_at)}</div>}
                <div id={'tm-' + m.id} className={'tc-row' + (mine ? ' mine' : '')}>
                  {!mine && <Avatar name={(m.sender_id && info.people[m.sender_id]?.name) || nameOf(m.sender_id)} url={senderAdmin ? (m.sender_id && info.people[m.sender_id]?.photo) || RONNIE_PHOTO : m.sender_id ? info.people[m.sender_id]?.photo : null} size={32} />}
                  <div className="tc-col">
                    {gone ? <div className="ch-del">{!mine && <b>{nameOf(m.sender_id)} · </b>}{gone}</div> : (
                      <div className={'ch-b' + (mine ? ' mine' : '') + (pinned ? ' tc-pinned' : '')} {...hold}>
                        {!mine && <div className="tc-name">{nameOf(m.sender_id)}{isMgr(m.sender_id) && <i className="tc-badge">MANAGER</i>}</div>}
                        {reply && <button className="tc-q" onClick={(e) => { e.stopPropagation(); jump(reply.id); }}><b>{nameOf(reply.sender_id)}</b> {reply.text}</button>}
                        {m.photo_paths?.length > 0 && <div className={'ch-ph n' + Math.min(m.photo_paths.length, 2)}>{m.photo_paths.map((ph) => urls[ph] ? <img key={ph} src={urls[ph]} alt="" onClick={(e) => { e.stopPropagation(); setFull(urls[ph]); }} /> : <span key={ph} />)}</div>}
                        {m.body && <div className="ch-t">{m.body}</div>}
                        <div className="ch-meta">{pinned ? '📌 ' : ''}{t12(m.created_at)}{m.edited_at ? ' · edited' : ''}</div>
                      </div>
                    )}
                    {menu === m.id && items.length > 0 && (
                      <div className="ch-menu" onClick={(e) => e.stopPropagation()}>
                        {items.map((it) => <button key={it.k} className={it.red ? 'red' : ''} onClick={it.run}>{it.label}</button>)}
                      </div>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
        <div ref={end} />
      </div>
      {canWrite ? (
        <Composer value={text} onChange={setText} files={files} onFiles={setFiles} busy={busy} err={err} placeholder="Message the team…"
          editing={!!editing} onCancelEdit={() => { setEditing(null); setText(''); }} noPhotos={!me.photos}
          above={replyTo && !editing ? <div className="ch-editing"><span className="grow">↩ Replying to {nameOf(replyTo.sender_id)}: {(replyTo.body || '📷 Photo').split('\n')[0].slice(0, 60)}</span><button onClick={() => setReplyTo(null)}>Cancel</button></div> : null}
          quick={!editing && !text && !files.length ? TEAM_QUICK : undefined} onQuick={(q) => send(q, [])} onSend={() => send(text)} />
      ) : (
        <div className="ch-closed">
          {err && <p className="error">{err}</p>}
          {info.state === 'readonly' ? <>🔒 The chat closed {dayTime(info.closes_at)}. Everyone can read it until {dayOnly(readOnlyUntil(info.closes_at))}; nobody can write.</>
            : info.state === 'before' ? <>The team chat opens {dayTime(info.opens_at)}, the day before the event.</>
            : info.state === 'off' ? <>Team chat is off for this event. Staff don’t see it.</>
            : info.state === 'hidden' ? <>Closed more than 7 days ago. Staff don’t see it anymore.</>
            : <>You can read this chat but you’re not in it.</>}
        </div>
      )}
      {full && <div className="photo-view" onClick={() => setFull(null)}><img src={full} alt="" style={{ width: 'min(94vw, 720px)', height: 'auto', maxHeight: '78vh', objectFit: 'contain' }} /><button className="photo-view-x">Close</button></div>}
    </div>
  );
}
