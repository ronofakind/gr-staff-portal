// push 80 · Today → Needs you: notes from meetings that are over, grouped by meeting, with
// Add to the event (the AI turns it into a review card in "AI · to review"), Pin on event page, Done.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { t12, dayShort } from '../lib/meetings';

type N = { id: string; body: string; parent_id: string | null; created_at: string; pinned: boolean; apply_status: string | null; done_at: string | null; same_by: string[];
  meeting_id: string; author: { full_name: string; nickname: string | null } | null; meetings: { title: string; starts_at: string; duration_min: number; cancelled_at: string | null } | null };
type Ev = { meeting_id: string; events: { title: string; event_date: string } | null };

export function MeetingNotesNeeds({ tick, onCount }: { tick: number; onCount?: (n: number) => void }) {
  const [rows, setRows] = useState<N[]>([]); const [evs, setEvs] = useState<Ev[]>([]); const [t, setT] = useState(0); const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    const since = new Date(Date.now() - 21 * 864e5).toISOString();
    const { data, error } = await supabase.from('meeting_notes')
      .select('id,body,parent_id,created_at,pinned,apply_status,done_at,same_by,meeting_id,author:staff!meeting_notes_author_id_fkey(full_name,nickname),meetings!inner(title,starts_at,duration_min,cancelled_at)')
      .is('deleted_at', null).is('done_at', null).gte('meetings.starts_at', since).lte('meetings.starts_at', new Date().toISOString()).is('meetings.cancelled_at', null).order('created_at');
    if (error) { setRows([]); return; }
    const r = ((data ?? []) as unknown as N[]).filter((n) => n.meetings && +new Date(n.meetings.starts_at) + n.meetings.duration_min * 60e3 <= Date.now() + 10 * 60e3);
    setRows(r);
    const ids = [...new Set(r.map((n) => n.meeting_id))];
    if (ids.length) { const { data: e } = await supabase.from('meeting_events').select('meeting_id,events(title,event_date)').in('meeting_id', ids); setEvs((e ?? []) as unknown as Ev[]); }
  })(); }, [tick, t]);
  const tops = rows.filter((n) => !n.parent_id && n.apply_status !== 'sending' && n.apply_status !== 'done');
  useEffect(() => { onCount?.(new Set(tops.map((n) => n.meeting_id)).size); }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tops.length) return null;
  const act = async (id: string, a: 'done' | 'apply') => { setErr(''); const { error } = await supabase.rpc('admin_meeting_note_act', { p_id: id, p_act: a }); if (error) setErr(error.message); else setT((x) => x + 1); };
  const pin = async (n: N) => { const { error } = await supabase.rpc('pin_meeting_note', { p_id: n.id, p_on: !n.pinned }); if (error) setErr(error.message); else setT((x) => x + 1); };
  const who = (n: N) => n.author?.nickname || (n.author?.full_name ?? 'Someone').split(' ')[0];
  const meetings = [...new Set(tops.map((n) => n.meeting_id))];
  return (
    <div className="nh-list">
      {meetings.map((mid) => {
        const list = tops.filter((n) => n.meeting_id === mid); const m = list[0].meetings!;
        const ev = evs.filter((e) => e.meeting_id === mid && e.events).map((e) => e.events!);
        return (
          <div key={mid} className="nh-card mn-card">
            <div className="nh-top"><b>📝 Meeting notes · {m.title} · {list.length} new</b>{ev[0] && <i className="nh-tag mn-tag">FOR {ev[0].title.toUpperCase()} · {dayShort(ev[0].event_date + 'T12:00:00').toUpperCase()}</i>}</div>
            <span className="muted sm">{dayShort(m.starts_at)} · {t12(m.starts_at)} · <Link className="lnk" to={`/admin/meeting/${mid}`}>Open the meeting ›</Link></span>
            {list.map((n) => (
              <div key={n.id} className="mn-note">
                <div className="sm">“{n.body}” <span className="muted">· {who(n)}{n.same_by?.length ? ` · ✓ ${n.same_by.length} same` : ''}</span></div>
                {rows.filter((k) => k.parent_id === n.id).map((k) => <div key={k.id} className="sm muted" style={{ paddingLeft: 14 }}>+ {k.body} · {who(k)}</div>)}
                {n.apply_status === 'error' && <div className="sm accent">The AI couldn’t read this one. Add it to the event by hand.</div>}
                <div className="nh-acts">
                  {ev.length > 0 && <button className="abtn sm dark" onClick={() => act(n.id, 'apply')}>Add to the event</button>}
                  {ev.length > 0 && <button className="abtn sm" onClick={() => pin(n)}>{n.pinned ? '📌 On event page' : 'Pin on event page'}</button>}
                  <button className="abtn sm" onClick={() => act(n.id, 'done')}>Done</button>
                </div>
              </div>))}
            {rows.some((n) => n.meeting_id === mid && n.apply_status === 'sending') && <small className="muted">Notes you added to the event come back as a review card in “AI · to review” (within the hour).</small>}
          </div>);
      })}
      {err && <p className="error">{err}</p>}
    </div>);
}
