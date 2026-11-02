import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from './Avatar';
import { AnnounceView, ANN_SELECT, ANN_SELECT_36, wantsGotIt, type Ann } from './Announce';
import { CONV_COLS, MSG_COLS, RONNIE_PHOTO, first, type Conv, type InboxRow, type Msg } from '../lib/messages';

/* Push 36b · Home: ONE card for the newest unread thing from Ronnie or a manager (conversation reply or announcement), gone once opened.
   Replaces the push-25e red announcement cards (an announcement that asks for Got it stays until Got it, as before). */

type Cand = { at: string; title: string; text: string; photo: string | null; name: string; go: () => void };

export function MessageCard({ meId }: { meId: string }) {
  const nav = useNavigate();
  const [cands, setCands] = useState<Cand[]>([]); const [ann, setAnn] = useState<Ann | null>(null); const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const out: Cand[] = [];
      const { data: cs, error } = await supabase.from('conversations').select(CONV_COLS + ',manager:staff!conversations_manager_id_fkey(full_name,photo_url)').eq('staff_id', meId);
      if (!error) for (const c of (cs ?? []) as unknown as (Conv & { manager: { full_name: string; photo_url: string | null } | null })[]) {
        if (!c.last_from || c.last_from === 'staff' || !c.last_message_at || (c.staff_seen_at && c.staff_seen_at >= c.last_message_at)) continue;
        if (c.kind === 'manager' && c.closes_at && new Date(c.closes_at).getTime() + 7 * 864e5 < Date.now()) continue;
        const { data: m } = await supabase.from('messages').select(MSG_COLS).eq('conversation_id', c.id).neq('sender_role', 'staff').order('created_at', { ascending: false }).limit(1);
        const last = ((m ?? []) as Msg[])[0];
        const fromRonnie = c.kind === 'ronnie' || last?.sender_role === 'admin';
        out.push({ at: c.last_message_at, name: fromRonnie ? 'Ronnie' : c.manager?.full_name ?? 'Manager', photo: fromRonnie ? RONNIE_PHOTO : c.manager?.photo_url ?? null,
          title: fromRonnie ? (last?.kind === 'system' ? 'Ronnie answered' : 'Ronnie replied') : `New from ${first(c.manager?.full_name)}`,
          text: last ? (last.deleted_at ? 'Message deleted' : last.body || (last.photo_paths?.length ? '📷 Photo' : '')) : '',
          go: () => nav(c.kind === 'ronnie' ? '/messages?c=ronnie' : `/messages?c=mgr:${c.event_id}`) });
      }
      const q = (cols: string) => supabase.from('announcement_reads').select(`opened_at,ack_at,announcements!inner(${cols})`).eq('staff_id', meId).gte('announcements.created_at', new Date(Date.now() - 90 * 864e5).toISOString());
      let r = await q(ANN_SELECT_36); if (r.error) r = await q(ANN_SELECT);
      for (const x of (r.data ?? []) as unknown as { opened_at: string | null; ack_at: string | null; announcements: Ann & { sender: { full_name: string; role?: string } | null } }[]) {
        const a = x.announcements; if (!a) continue;
        if (x.opened_at && !(wantsGotIt(a) && !x.ack_at)) continue;
        out.push({ at: a.created_at, name: a.sender?.full_name ?? 'G&R', photo: a.sender?.role === 'admin' || !a.sender ? RONNIE_PHOTO : null,
          title: `New from ${first(a.sender?.full_name) || 'G&R'}${a.events ? ` · ${a.events.title}` : ''}`, text: a.body.split('\n')[0] || '📷 Photo', go: () => setAnn(a) });
      }
      setCands(out.sort((a, b) => b.at.localeCompare(a.at)));
    })();
  }, [meId, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = cands[0];
  return (<>
    {c && (
      <button className="msg-home" onClick={c.go}>
        <Avatar name={c.name} url={c.photo} size={40} />
        <span className="grow"><b>{c.title}</b><span>{c.text}</span>{cands.length > 1 && <small>+{cands.length - 1} more in Messages</small>}</span>
        <span className="msg-home-go">Open ›</span>
      </button>
    )}
    {ann && <AnnounceView a={ann} acked={false} onClose={() => { setAnn(null); setTick((t) => t + 1); }} onAck={() => { setAnn(null); setTick((t) => t + 1); }} />}
  </>);
}

/** Small "✉ Message Ronnie" shortcut (Home + shift details). */
export function MessageRonnieLink({ shiftId, label = '✉ Message Ronnie' }: { shiftId?: string; label?: string }) {
  return <Link to={shiftId ? `/messages?new=1&topic=shift&shift=${shiftId}` : '/messages?new=1'} className="msg-short">{label}</Link>;
}

/** Manager Home (Working now card): "💬 n replies from your team", under the running-late alerts, above My team. */
export function MgrRepliesLine({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<InboxRow[]>([]);
  useEffect(() => { supabase.rpc('inbox', { p_event: eventId }).then(({ data, error }) => { if (!error) setRows(((data ?? []) as InboxRow[]).filter((r) => r.needs_reply)); }); }, [eventId]);
  if (!rows.length) return null;
  return (
    <Link to={`/manage/${eventId}/messages`} className="mgr-replies">
      <span aria-hidden="true">💬</span>
      <span className="grow"><b>{rows.length} repl{rows.length === 1 ? 'y' : 'ies'} from your team</b><small>{first(rows[0].staff_name)}: {rows[0].last_body || '📷 Photo'}</small></span>
      <i className="msg-n">{rows.length}</i>
    </Link>
  );
}
