// Nov 11 · Today → Messages box: the 5 latest open staff conversations (unread first). Row → the conversation, date tag → the event,
// ✓ No reply needed right on the row. Same data as Admin → Messages (rpc inbox).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { shortDate, whenShort, type InboxRow } from '../lib/messages';

export function useInboxToday(tick = 0) {
  const [rows, setRows] = useState<InboxRow[] | null>(null); const [t, setT] = useState(0);
  useEffect(() => { supabase.rpc('inbox').then(({ data, error }) => setRows(error ? [] : (data ?? []) as InboxRow[])); }, [tick, t]);
  const open = (rows ?? []).filter((r) => r.status === 'open' && !r.closed && (r.needs_reply || r.admin_unread) && r.last_body)
    .sort((a, b) => Number(b.admin_unread) - Number(a.admin_unread) || b.last_message_at.localeCompare(a.last_message_at));
  return { rows, open, reload: () => setT((x) => x + 1) };
}

export function MessagesToday({ tick = 0 }: { tick?: number }) {
  const { rows, open, reload } = useInboxToday(tick); const nav = useNavigate();
  if (!rows) return <span className="muted sm">Loading…</span>;
  if (!open.length) return <span className="muted sm">✓ Nothing waiting. Every message has an answer.</span>;
  const done = async (id: string) => { await supabase.rpc('mark_done', { p_conversation: id, p_done: true }); reload(); };
  return <div className="mt-list">
    {open.slice(0, 5).map((r) => { const sh = r.last_meta?.shift; const ev = sh?.event_id ?? r.event_id; const day = sh?.date ?? r.event_date;
      return <div key={r.id} className={'mt-row' + (r.admin_unread ? ' hot' : '')} role="button" tabIndex={0}
        onClick={() => nav(`/admin/messages?c=${r.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/admin/messages?c=${r.id}`); }}>
        <Avatar name={r.staff_name} url={r.staff_photo} size={36} />
        <span className="mt-main"><span className="mt-top"><b>{r.staff_name}</b><small className="muted">{whenShort(r.last_message_at)}</small></span>
          <span className="mt-body">{r.last_body}</span>
          {day && (ev ? <Link className="ch-shift ch-shift-link mt-shift" to={`/admin/event/${ev}`} onClick={(e) => e.stopPropagation()}>🗓 {shortDate(day)}{sh?.title ?? r.event_title ? ` · ${sh?.title ?? r.event_title}` : ''} ›</Link>
            : <span className="ch-shift mt-shift">🗓 {shortDate(day)}</span>)}</span>
        <button className="abtn sm ok mt-done" onClick={(e) => { e.stopPropagation(); done(r.id); }}>✓ No reply needed</button>
      </div>; })}
    {open.length > 5 && <Link className="lnk sm" to="/admin/messages">+ {open.length - 5} more</Link>}
  </div>;
}
