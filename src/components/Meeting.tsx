import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from './Avatar';
import {
  answerMeeting, dayCaps, directionsUrl, isOver, joinLabel, joinOpen, monDayOf, placeLetter, placeName, safeLink, t12, todayMtl, dayOfMtl,
  type EventMeetingNote, type MNote, type MyMeeting, type PlaceKind,
} from '../lib/meetings';

/* Push 38 · meeting pieces shared by Home, the meeting page, the admin meeting page and the event page. */

/** Teams-purple square with T / Z, or a pin for in person. */
export function PlaceBadge({ kind, size = 30 }: { kind: PlaceKind; size?: number }) {
  return (
    <span className={'mtg-badge' + (kind === 'in_person' ? ' pin' : '')} style={{ width: size, height: size, borderRadius: Math.round(size / 3.6), fontSize: Math.round(size * 0.5) }} aria-hidden="true">
      {kind === 'in_person'
        ? <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>
        : placeLetter(kind)}
    </span>
  );
}

/** Join button: active 10 min before → end. In person: Directions (Google Maps). */
export function JoinButton({ m, light = false }: { m: { starts_at: string; duration_min: number; place_kind: PlaceKind; link: string | null; address: string | null }; light?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  if (m.place_kind === 'in_person') {
    return m.address ? <a className={'mtg-join' + (light ? ' light' : '')} href={directionsUrl(m.address)} target="_blank" rel="noreferrer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8z" /></svg>Directions</a> : null;
  }
  const url = safeLink(m.link);
  if (isOver(m, now)) return <span className={'mtg-join off' + (light ? ' light' : '')}>Meeting over</span>;
  if (!url) return <span className={'mtg-join off' + (light ? ' light' : '')}>Link coming from Ronnie</span>;
  return joinOpen(m, now)
    ? <a className={'mtg-join on' + (light ? ' light' : '')} href={url} target="_blank" rel="noreferrer">▶ {joinLabel(m.place_kind)}</a>
    : <span className={'mtg-join off' + (light ? ' light' : '')} aria-disabled="true">▶ {joinLabel(m.place_kind)} · opens 10 min before</span>;
}

/** Home card: white with the Teams colour, never looks like a shift. Today = "TODAY · 11:00 AM" + Join. */
export function MeetingCard({ m, to, preview = false, onAnswered }: { m: MyMeeting; to: string; preview?: boolean; onAnswered: (a: 'coming' | 'cant') => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const today = dayOfMtl(m.starts_at) === todayMtl();
  const over = isOver(m);
  const answer = async (a: 'coming' | 'cant') => {
    if (preview || busy) return;
    setBusy(true); setErr('');
    const e = await answerMeeting(m.id, a);
    setBusy(false);
    if (e) setErr(e); else onAnswered(a);
  };
  return (
    <section className={'mtg-card' + (today ? ' today' : '') + (m.answer === 'cant' ? ' cant' : '')}>
      <Link to={to} className="mtg-card-top">
        <PlaceBadge kind={m.place_kind} />
        <div className="grow" style={{ minWidth: 0 }}>
          <small className="mtg-kick">{today ? `TODAY · ${t12(m.starts_at)}` : `MEETING · ${dayCaps(m.starts_at)}`}</small>
          <b className="mtg-title">{m.title}</b>
        </div>
        <span className="mtg-go" aria-hidden="true">›</span>
      </Link>
      {!today && (
        <div className="mtg-tiles">
          <div><small>STARTS</small><span className="serif">{t12(m.starts_at)}</span></div>
          <div><small>WHERE</small><b>{placeName(m)}</b></div>
        </div>
      )}
      {today && m.answer !== 'cant' && <JoinButton m={m} />}
      {!over && (m.answer === null ? (
        <div className="mtg-ans">
          <button className="mtg-yes" disabled={busy} onClick={() => answer('coming')}>✓ I’ll be there</button>
          <button className="mtg-no" disabled={busy} onClick={() => answer('cant')}>Can’t make it</button>
        </div>
      ) : (
        <div className="mtg-answered">
          {m.answer === 'coming' ? <span className="mtg-tag ok">✓ YOU’RE COMING</span> : <span className="mtg-tag no">CAN’T MAKE IT</span>}
          <button className="link-btn" disabled={busy} onClick={() => answer(m.answer === 'coming' ? 'cant' : 'coming')}>{m.answer === 'coming' ? 'Can’t make it anymore?' : 'I can make it now'}</button>
        </div>
      ))}
      {err && <p className="error">{err}</p>}
    </section>
  );
}

const noteTime = (iso: string, meetingDay: string) => (dayOfMtl(iso) === meetingDay ? t12(iso) : `${monDayOf(iso)} · ${t12(iso)}`);

/** push 80 · words for the "already noted" hint */
const words = (t: string) => new Set(t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9:]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set(['the', 'and', 'for', 'with', 'not', 'are', 'but', 'they', 'that', 'this', 'les', 'des', 'pour', 'avec', 'une', 'est', 'pas', 'qui', 'que', 'sur', 'dans']);
const similar = (a: string, b: string) => { const A = words(a), B = words(b); if (A.size < 2 || !B.size) return 0; let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return n / Math.min(A.size, B.size); };

/** Notes on the meeting page: one shared live list (push 80). Everyone invited (+ Ronnie) adds; ✓ Same / Add to it instead of
 *  writing the same note twice; "<name> is writing…"; the author edits / deletes; Ronnie pins (admin page). */
export function MeetingNotes({ meetingId, meetingStart, notes, meId, onChanged, pinTag = true, readOnly = false, myName = '' }: {
  meetingId: string; meetingStart: string; notes: MNote[]; meId: string | null; onChanged: () => void; pinTag?: boolean; readOnly?: boolean; myName?: string;
}) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ id: string; body: string } | null>(null);
  const [reply, setReply] = useState<{ id: string; body: string } | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const day = dayOfMtl(meetingStart);
  // "is writing…" (live presence, nothing saved)
  const [ch, setCh] = useState<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => {
    if (readOnly || !meId) return;
    const c = supabase.channel('mtg-notes:' + meetingId, { config: { presence: { key: meId } } });
    c.on('presence', { event: 'sync' }, () => {
      const st = c.presenceState() as Record<string, { name?: string; typing?: boolean }[]>;
      setTyping(Object.entries(st).filter(([k, v]) => k !== meId && v.some((x) => x.typing)).map(([, v]) => v[0]?.name ?? 'Someone'));
    }).subscribe((stt) => { if (stt === 'SUBSCRIBED') c.track({ name: myName || 'Someone', typing: false }); });
    setCh(c);
    return () => { supabase.removeChannel(c); };
  }, [meetingId, meId, readOnly, myName]);
  const isTyping = !!(text.trim() || reply?.body.trim());
  useEffect(() => { ch?.track({ name: myName || 'Someone', typing: isTyping }).catch(() => {}); }, [isTyping]); // eslint-disable-line react-hooks/exhaustive-deps

  const top = notes.filter((n) => !n.parent_id);
  const kids = (id: string) => notes.filter((n) => n.parent_id === id && !n.deleted_at);
  const hint = text.trim().length > 6 ? top.filter((n) => !n.deleted_at).map((n) => ({ n, s: similar(text, [n.body, ...kids(n.id).map((k) => k.body)].join(' ')) })).filter((x) => x.s >= 0.5).sort((a, b) => b.s - a.s)[0]?.n : undefined;
  const add = async (body: string, parent: string | null) => {
    if (!body.trim() || busy) return;
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('add_meeting_note', parent ? { p_meeting: meetingId, p_body: body, p_parent: parent } : { p_meeting: meetingId, p_body: body });
    setBusy(false);
    if (error) setErr(error.message); else { if (parent) setReply(null); else setText(''); onChanged(); }
  };
  const same = async (id: string) => { const { error } = await supabase.rpc('meeting_note_same', { p_id: id }); if (error) setErr(error.message); else { if (hint?.id === id) setText(''); onChanged(); } };
  const save = async () => {
    if (!edit) return;
    const { error } = await supabase.rpc('edit_meeting_note', { p_id: edit.id, p_body: edit.body });
    if (error) setErr(error.message); else { setEdit(null); onChanged(); }
  };
  const del = async (id: string) => {
    if (!window.confirm('Delete this note?')) return;
    const { error } = await supabase.rpc('delete_meeting_note', { p_id: id });
    if (error) setErr(error.message); else onChanged();
  };
  const first = (n: MNote) => n.author_nickname || (n.author ?? 'Someone').split(' ')[0];
  const one = (n: MNote, child = false) => {
    const mine = !!meId && n.author_id === meId && !n.deleted_at;
    return (
      <div key={n.id} className={'mtg-note' + (n.deleted_at ? ' gone' : '') + (child ? ' child' : '')}>
        <Avatar name={n.author ?? '?'} url={n.author_photo} size={child ? 26 : 34} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="mtg-nhead"><b>{first(n)}</b><small>· {noteTime(n.created_at, day)}{n.edited_at && !n.deleted_at ? ' · edited' : ''}</small>
            {pinTag && n.pinned && !n.deleted_at && <span className="mtg-pin">📌 ON EVENT</span>}</div>
          {n.deleted_at ? <i className="muted sm">Note deleted</i>
            : edit?.id === n.id ? <div className="stack" style={{ gap: 6 }}>
                <textarea className="mtg-input" rows={3} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
                <div className="row" style={{ gap: 8 }}><button className="mtg-mini dark" onClick={save}>Save</button><button className="mtg-mini" onClick={() => setEdit(null)}>Cancel</button></div>
              </div>
            : <div className="mtg-nbody">{n.body}</div>}
          {!child && !n.deleted_at && (n.same?.length ?? 0) > 0 && <div className="mtg-same-who">✓ Same · {n.same!.join(', ')}</div>}
          {!n.deleted_at && !readOnly && edit?.id !== n.id && <div className="mtg-nact">
            {!child && !mine && <button className={'mtg-same' + (n.same_me ? ' on' : '')} onClick={() => same(n.id)}>{n.same_me ? '✓ Same (you)' : '✓ Same'}</button>}
            {!child && <button onClick={() => setReply({ id: n.id, body: '' })}>+ Add to it</button>}
            {mine && <><button onClick={() => setEdit({ id: n.id, body: n.body })}>Edit</button><button onClick={() => del(n.id)}>Delete</button></>}
          </div>}
          {!child && kids(n.id).map((k) => one(k, true))}
          {!child && reply?.id === n.id && <div className="mtg-add sub">
            <textarea className="mtg-input" rows={1} autoFocus placeholder={`Add to ${first(n)}’s note…`} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} />
            <button className="mtg-send" aria-label="Add" disabled={!reply.body.trim() || busy} onClick={() => add(reply.body, n.id)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>}
        </div>
      </div>
    );
  };
  return (
    <div className="mtg-notes">
      {top.length > 0 && <div className="mtg-nlist">{top.map((n) => one(n))}</div>}
      {!top.length && <div className="muted sm" style={{ padding: '2px 4px' }}>No notes yet. Notes show here for everyone as they’re written.</div>}
      {typing.length > 0 && <div className="mtg-typing">{typing.join(', ')} {typing.length > 1 ? 'are' : 'is'} writing…</div>}
      {!readOnly && <div className="mtg-add">
        <textarea className="mtg-input" rows={1} placeholder="Add a note…" value={text} onChange={(e) => setText(e.target.value)}
          onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(140, t.scrollHeight) + 'px'; }} />
        <button className="mtg-send" aria-label="Add the note" disabled={!text.trim() || busy} onClick={() => add(text, null)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </div>}
      {!readOnly && hint && <div className="mtg-hint">{first(hint)} already noted: “{hint.body.length > 70 ? hint.body.slice(0, 70) + '…' : hint.body}”
        {hint.author_id !== meId && <button onClick={() => same(hint.id)}>✓ Same</button>}<button onClick={() => { setReply({ id: hint.id, body: text }); setText(''); }}>Add to it</button></div>}
      {err && <p className="error">{err}</p>}
    </div>
  );
}

/** Event page: "From the meeting · Nov 12" — pinned notes of the meetings linked to this event. Nothing when there are none. */
export function FromTheMeeting({ eventId, meetingBase = '' }: { eventId: string; meetingBase?: string }) {
  const [rows, setRows] = useState<EventMeetingNote[]>([]);
  useEffect(() => {
    let live = true;
    supabase.rpc('event_meeting_notes', { p_event: eventId }).then(({ data, error }) => { if (live && !error) setRows((data ?? []) as EventMeetingNote[]); }, () => {});
    return () => { live = false; };
  }, [eventId]);
  if (!rows.length) return null;
  const groups = [...new Set(rows.map((r) => r.meeting_id))].map((id) => rows.filter((r) => r.meeting_id === id));
  return <>{groups.map((g) => (
    <div key={g[0].meeting_id} className="mtg-from-wrap">
      <div className="d37-sec"><span className="serif">From the meeting</span><i /><small className="mtg-from-date">{monDayOf(g[0].starts_at)}</small></div>
      <section className="mtg-from">
        <ul>{g.map((r) => <li key={r.note_id}>{r.body}</li>)}</ul>
        {g[0].can_open && <Link className="mtg-from-link" to={`${meetingBase}/meeting/${g[0].meeting_id}`}>See the whole meeting ›</Link>}
      </section>
    </div>
  ))}</>;
}
