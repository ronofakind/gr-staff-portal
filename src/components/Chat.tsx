import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ShiftNote } from './ShiftNotes';
import type { MyAsk } from '../lib/shiftAsks';
import { CONV_COLS, MSG_COLS, QUICK, dayHead, dayOf, fmtH, first, shiftLine, shortDate, t12, uploadPhotos, useSigned, type Conv, type Msg, type Side, type Topic } from '../lib/messages';

/* Push 36 · one conversation: bubbles, shift tag, system notes, hours card, photos, Seen, press-and-hold Edit / Delete, composer. */

type Extra = { id: string; at: string; node: ReactNode };
export type ChatProps = {
  convId: string | null; meId: string; side: Side;
  /** creates the conversation on the first send (staff → Ronnie, staff → manager reply) */
  ensureConv?: () => Promise<string>;
  /** topic / attached shift / announcement replied to, read at send time */
  sendArgs?: () => { topic?: Topic | null; shift?: string | null; announcement?: string | null };
  onSent?: (convId: string) => void;
  onConv?: (c: Conv | null) => void;
  /** items shown between the messages by time (the manager's announcements in his thread) */
  extras?: Extra[];
  managerName?: string | null;
  placeholder: string; quick?: boolean;
  /** shown instead of the composer (closed / can't reply yet) */
  noComposer?: ReactNode;
  empty?: ReactNode;
  /** shown instead of the messages (Message Ronnie: topic + shift picker) */
  intro?: ReactNode;
  reloadKey?: number;
};

export function Chat(p: ChatProps) {
  const [conv, setConv] = useState<Conv | null>(null);
  const [msgs, setMsgs] = useState<Msg[] | null>(p.convId ? null : []);
  const [text, setText] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState<Msg | null>(null); const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [full, setFull] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null); const lastN = useRef(0);
  const [asks, setAsks] = useState<Record<string, MyAsk>>({}); // push 40 · live state of the ask cards in this conversation

  const load = async (id = p.convId) => {
    if (!id) { setMsgs([]); setConv(null); p.onConv?.(null); return; }
    const since = new Date(Date.now() - 365 * 864e5).toISOString();
    const [c, m] = await Promise.all([
      supabase.from('conversations').select(CONV_COLS).eq('id', id).maybeSingle(),
      supabase.from('messages').select(MSG_COLS).eq('conversation_id', id).gte('created_at', since).order('created_at'),
    ]);
    const cv = (c.data as Conv | null) ?? null; const list = (m.data ?? []) as Msg[];
    setConv(cv); p.onConv?.(cv); setMsgs(list);
    const askIds = [...new Set(list.filter((x) => x.meta?.card === 'ask' && typeof x.meta.ask_id === 'string').map((x) => x.meta.ask_id as string))];
    if (askIds.length && cv) supabase.rpc('shift_ask_cards', { p_ids: askIds, p_staff: p.side === 'admin' ? cv.staff_id : null })
      .then(({ data, error }) => { if (!error && Array.isArray(data)) setAsks(Object.fromEntries((data as MyAsk[]).map((a) => [a.ask_id, a]))); });
    // Opening = Seen. Only when something from the other side is newer than what we've seen.
    if (cv) {
      const mine = p.side === 'staff' ? cv.staff_seen_at : p.side === 'admin' ? cv.admin_seen_at : cv.manager_seen_at;
      if (cv.last_message_at && (!mine || mine < cv.last_message_at)) supabase.rpc('mark_conversation_seen', { p_conversation: cv.id }).then(() => {});
    }
  };
  useEffect(() => { load(); const t = setInterval(() => load(), 15000); return () => clearInterval(t); }, [p.convId, p.reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const n = (msgs?.length ?? 0) + (p.extras?.length ?? 0); if (n !== lastN.current) { lastN.current = n; end.current?.scrollIntoView({ block: 'end' }); } }, [msgs, p.extras]);

  const send = async (body: string, withFiles: File[] = files) => {
    setErr('');
    if (!body.trim() && !withFiles.length) return;
    setBusy(true);
    try {
      if (editing) {
        const { error } = await supabase.rpc('edit_message', { p_id: editing.id, p_body: body });
        if (error) throw error;
        setEditing(null); setText(''); await load(); return;
      }
      const id = p.convId ?? (p.ensureConv ? await p.ensureConv() : null);
      if (!id) throw new Error('No conversation yet.');
      const paths = withFiles.length ? await uploadPhotos(id, withFiles) : [];
      const a = p.sendArgs?.() ?? {};
      const { error } = await supabase.rpc('send_message', { p_conversation: id, p_body: body.trim(), p_topic: a.topic ?? null, p_shift: a.shift ?? null, p_photos: paths, p_announcement: a.announcement ?? null });
      if (error) throw error;
      setText(''); setFiles([]);
      if (p.convId) await load(); p.onSent?.(id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const del = async (m: Msg) => { setMenu(null); if (!window.confirm('Delete this message? It shows as “Message deleted”.')) return; const { error } = await supabase.rpc('delete_message', { p_id: m.id }); if (error) setErr(error.message); load(); };

  const urls = useSigned((msgs ?? []).flatMap((m) => m.photo_paths ?? []));
  const otherSeen = !conv ? null : p.side === 'staff' ? (conv.kind === 'ronnie' ? conv.admin_seen_at : conv.manager_seen_at) : conv.staff_seen_at;
  const mineIds = (msgs ?? []).filter((m) => m.sender_id === p.meId && m.sender_role !== 'system' && !m.deleted_at);
  const lastMine = mineIds[mineIds.length - 1]?.id;
  const label = (m: Msg) => {
    if (m.sender_id === p.meId || m.sender_role === 'staff' || conv?.kind !== 'manager') return null;
    return m.sender_role === 'admin' ? 'Ronnie' : first(p.managerName) || 'Manager';
  };

  type Item = { at: string; key: string; node: ReactNode };
  const items: Item[] = [
    ...(p.extras ?? []).map((x) => ({ at: x.at, key: 'x' + x.id, node: x.node })),
    ...(msgs ?? []).map((m) => ({ at: m.created_at, key: m.id, node: <MsgView key={m.id} m={m} mine={m.sender_id === p.meId && m.sender_role !== 'system'} side={p.side} label={label(m)} urls={urls}
      seen={m.id === lastMine ? (otherSeen && otherSeen >= m.created_at ? (p.side === 'staff' ? 'Seen' : `Seen ${t12(otherSeen)}`) : 'Sent') : null}
      menu={menu === m.id} onMenu={(on) => setMenu(on ? m.id : null)} onEdit={() => { setMenu(null); setEditing(m); setText(m.body); }} onDelete={() => del(m)} onPhoto={setFull}
      draft={text} onAnswered={() => { setText(''); load(); }} ask={typeof m.meta?.ask_id === 'string' ? asks[m.meta.ask_id] ?? null : null} staffSeenAt={conv?.staff_seen_at ?? null} onNote={() => load()} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <div className="ch">
      <div className="ch-list" onClick={() => menu && setMenu(null)}>
        {p.intro ? p.intro : msgs === null ? <div className="loading" style={{ minHeight: 160 }} />
          : !items.length ? (p.empty ?? null)
          : items.map((it, i) => (
            <Fragment key={it.key}>
              {(i === 0 || dayOf(items[i - 1].at) !== dayOf(it.at)) && <div className="ch-day">{dayHead(it.at)}</div>}
              {it.node}
            </Fragment>))}
        <div ref={end} />
      </div>
      {p.noComposer ?? (
        <Composer value={text} onChange={setText} files={files} onFiles={setFiles} busy={busy} err={err} placeholder={p.placeholder}
          editing={!!editing} onCancelEdit={() => { setEditing(null); setText(''); }}
          quick={p.quick && !editing && !text && !files.length ? QUICK : undefined} onQuick={(q) => send(q, [])} onSend={() => send(text)} />
      )}
      {full && <div className="photo-view" onClick={() => setFull(null)}><img src={full} alt="" style={{ width: 'min(94vw, 720px)', height: 'auto', maxHeight: '78vh', objectFit: 'contain' }} /><button className="photo-view-x">Close</button></div>}
    </div>
  );
}

function MsgView({ m, mine, side, label, urls, seen, menu, onMenu, onEdit, onDelete, onPhoto, draft, onAnswered, ask, staffSeenAt, onNote }: {
  m: Msg; mine: boolean; side: Side; label: string | null; urls: Record<string, string>; seen: string | null; menu: boolean;
  onMenu: (on: boolean) => void; onEdit: () => void; onDelete: () => void; onPhoto: (u: string) => void; draft: string; onAnswered: () => void;
  ask: MyAsk | null; staffSeenAt: string | null; onNote: () => void;
}) {
  const hold = useRef<number>();
  if (m.kind === 'system' && m.meta?.card) return <ShiftNote m={m} side={side} ask={ask} staffSeenAt={staffSeenAt} onChanged={onNote} />;
  if (m.kind === 'system') return <div className={'ch-sys' + (m.body.startsWith('✓') ? ' ok' : '')}>{m.body}</div>;
  if (m.kind === 'hours') return <><HoursCard m={m} mine={mine} side={side} draft={draft} onAnswered={onAnswered} />{seen && <div className="ch-seen">{seen}</div>}</>;
  const canHold = mine && !m.deleted_at;
  const press = canHold ? {
    onPointerDown: () => { window.clearTimeout(hold.current); hold.current = window.setTimeout(() => onMenu(true), 450); },
    onPointerUp: () => window.clearTimeout(hold.current), onPointerLeave: () => window.clearTimeout(hold.current), onPointerCancel: () => window.clearTimeout(hold.current),
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); onMenu(true); },
  } : {};
  return (
    <div className={'ch-row' + (mine ? ' mine' : '')}>
      {label && <div className="ch-from">{label}</div>}
      {m.meta?.shift && !m.deleted_at && <div className="ch-shift">🗓 {shiftLine(m.meta.shift)}</div>}
      {m.meta?.re && !m.deleted_at && <div className="ch-re">Re: {m.meta.re}</div>}
      {m.deleted_at ? <div className="ch-del">Message deleted</div> : (
        <div className={'ch-b' + (mine ? ' mine' : '')} {...press}>
          {m.photo_paths?.length > 0 && <div className={'ch-ph n' + Math.min(m.photo_paths.length, 2)}>{m.photo_paths.map((ph) => urls[ph] ? <img key={ph} src={urls[ph]} alt="" onClick={(e) => { e.stopPropagation(); onPhoto(urls[ph]); }} /> : <span key={ph} />)}</div>}
          {m.body && <div className="ch-t">{m.body}</div>}
          <div className="ch-meta">{t12(m.created_at)}{m.edited_at ? ' · edited' : ''}</div>
        </div>
      )}
      {menu && (
        <div className="ch-menu" onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit}>✏️ Edit</button>
          <button className="red" onClick={onDelete}>🗑 Delete</button>
        </div>
      )}
      {menu && <div className="ch-hint">press and hold your own message</div>}
      {seen && <div className={'ch-seen' + (seen.startsWith('Seen') && side !== 'staff' ? ' ok' : '')}>{seen}</div>}
    </div>
  );
}

type Ctx = { status: string; kind: 'start' | 'end' | 'other'; claimed_at: string | null; note: string | null; answer_note: string | null; app_in: string | null; app_out: string | null;
  h: number | null; entered_by: string | null; title: string; date: string; near: { name: string; at: string }[] };

/** HOURS QUESTION card. Staff: what they sent. Ronnie: app hours, who entered them, who else ended near that time + ✓ Fix / Hours are correct. */
function HoursCard({ m, mine, side, draft, onAnswered }: { m: Msg; mine: boolean; side: Side; draft: string; onAnswered: () => void }) {
  const h = m.meta?.hours; const s = m.meta?.shift;
  const [ctx, setCtx] = useState<Ctx | null>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    if (side !== 'admin' || !m.hours_question_id) return;
    supabase.rpc('hours_question_context', { p_question: m.hours_question_id }).then(({ data }) => setCtx((data as Ctx) ?? null));
  }, [m.hours_question_id, side]);
  const range = (a: string | null | undefined, b: string | null | undefined) => (a && b ? `${t12(a)} – ${t12(b)}` : a ? `${t12(a)} – ?` : 'no times');
  const said = h?.kind === 'other' ? 'Something else' : `${h?.kind === 'start' ? 'started' : 'ended'} at ${h?.claimed_at ? t12(h.claimed_at) : '?'}`;
  const answer = async (st: 'fixed' | 'correct') => {
    if (!m.hours_question_id || !h) return; setBusy(true); setErr('');
    const pin = h.kind === 'start' ? h.claimed_at : null; const pout = h.kind === 'end' ? h.claimed_at : null;
    const { error } = await supabase.rpc('answer_hours_question', { p_question: m.hours_question_id, p_status: st, p_in: pin, p_out: pout, p_note: draft.trim() || null });
    setBusy(false); if (error) setErr(error.message); else onAnswered();
  };
  if (side !== 'admin') return (
    <div className={'ch-row' + (mine ? ' mine' : '')}>
      <div className="ch-hq dark">
        <small>🕒 HOURS QUESTION</small>
        {s && <b>{shortDate(s.date)} · {s.title}</b>}
        {h && <span className="dim">App: {range(h.app_in, h.app_out)}{h.h != null ? ` · ${fmtH(h.h)} h` : ''}</span>}
        <span>{h?.kind === 'other' ? 'Something else' : `I ${said}`}{m.body ? ` · “${m.body}”` : ''}</span>
        <div className="ch-meta">{t12(m.created_at)}</div>
      </div>
    </div>
  );
  const open = (ctx?.status ?? 'open') === 'open';
  return (
    <div className="ch-row">
      <div className="ch-hq">
        <small className="gold">🕒 HOURS QUESTION</small>
        {s && <b>{shortDate(s.date)} · {s.title}</b>}
        <span className="muted">App: {range(ctx?.app_in ?? h?.app_in, ctx?.app_out ?? h?.app_out)}{(ctx?.h ?? h?.h) != null ? ` · ${fmtH(ctx?.h ?? h?.h)} h` : ''}{ctx?.entered_by ? ` · ${first(ctx.entered_by)} entered them` : ''}</span>
        <span>Says {h?.kind === 'other' ? 'something else is wrong' : <>they {h?.kind === 'start' ? 'started' : 'ended'} at <b>{h?.claimed_at ? t12(h.claimed_at) : '?'}</b></>}{m.body ? ` · “${m.body}”` : ''}</span>
        {ctx && ctx.near.length > 0 && <span className="muted sm">Also near {h?.claimed_at ? t12(h.claimed_at) : ''}: {ctx.near.slice(0, 4).map((x) => `${first(x.name)} (${t12(x.at)})`).join(', ')}</span>}
        {open ? <>
          <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {h?.kind !== 'other' && h?.claimed_at && <button className="ch-fix" disabled={busy} onClick={() => answer('fixed')}>✓ Fix to {t12(h.claimed_at)}</button>}
            <button className="ch-ok" disabled={busy} onClick={() => answer('correct')}>Hours are correct</button>
            {h?.kind === 'other' && <Link to="/admin/hours" className="ch-ok" style={{ display: 'inline-flex', alignItems: 'center' }}>Fix in Hours ›</Link>}
          </div>
          <span className="muted sm">Fix updates the hours everywhere (APP tab, payroll), same as Hours. {draft.trim() ? 'Your note in the box goes with the answer.' : 'Type a note in the box first if you want it to go with the answer.'}</span>
        </> : <span className={'sm strong ' + (ctx?.status === 'fixed' ? 'okc' : 'muted')}>{ctx?.status === 'fixed' ? '✓ Fixed' : 'Answered · hours are correct'}</span>}
        {err && <p className="error">{err}</p>}
        <div className="ch-meta">{t12(m.created_at)}</div>
      </div>
    </div>
  );
}

export function Composer({ value, onChange, files, onFiles, busy, err, placeholder, editing, onCancelEdit, quick, onQuick, onSend }: {
  value: string; onChange: (v: string) => void; files: File[]; onFiles: (f: File[]) => void; busy: boolean; err?: string; placeholder: string;
  editing?: boolean; onCancelEdit?: () => void; quick?: string[]; onQuick?: (q: string) => void; onSend: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = ta.current; if (!el) return; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }, [value]);
  useEffect(() => { if (editing) ta.current?.focus(); }, [editing]);
  return (
    <div className="ch-comp">
      {err && <p className="error" style={{ padding: '0 6px' }}>{err}</p>}
      {editing && <div className="ch-editing"><span className="grow">Editing your message · others will see “edited”</span><button onClick={onCancelEdit}>Cancel</button></div>}
      {quick && <div className="ch-quick">{quick.map((q) => <button key={q} disabled={busy} onClick={() => onQuick?.(q)}>{q}</button>)}</div>}
      {files.length > 0 && <div className="ch-files">{files.map((f, i) => <span key={i}>📷 {f.name.slice(0, 16)}<button aria-label="Remove photo" onClick={() => onFiles(files.filter((_, k) => k !== i))}>×</button></span>)}</div>}
      <div className="ch-bar">
        {!editing && <label className="ch-cam" aria-label="Add a photo">📷<input type="file" accept="image/*" multiple hidden onChange={(e) => { onFiles([...files, ...Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))].slice(0, 6)); e.target.value = ''; }} /></label>}
        <textarea ref={ta} rows={1} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <button className="ch-send" aria-label={editing ? 'Save' : 'Send'} disabled={busy || (!value.trim() && !files.length)} onClick={onSend}>{editing ? '✓' : '↑'}</button>
      </div>
    </div>
  );
}
