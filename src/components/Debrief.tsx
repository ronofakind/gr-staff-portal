import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SwipeSheet } from './SwipeSheet';

/** Nov 7 · MD debrief after Submit hours (migration 077). 4 taps + "What happened?" on a rough night + optional note.
 *  Green = smooth / easy · yellow = medium · red = rough / harder. Only Ronnie sees the answers. */
type Tone = 'g' | 'y' | 'r';
const QS: { key: 'night' | 'client' | 'difficulty' | 'team_size'; label: string; opts: [string, string, Tone][] }[] = [
  { key: 'night', label: 'The night', opts: [['smooth', 'Smooth', 'g'], ['issues', 'Some issues', 'y'], ['rough', 'Rough', 'r']] },
  { key: 'client', label: 'Client happy', opts: [['yes', 'Yes', 'g'], ['mixed', 'Mixed', 'y'], ['no', 'No', 'r']] },
  { key: 'difficulty', label: 'Difficulty', opts: [['easier', 'Easier', 'g'], ['expected', 'As expected', 'y'], ['harder', 'Harder', 'r']] },
  { key: 'team_size', label: 'Team size', opts: [['few', 'Too few', 'y'], ['right', 'Right', 'g'], ['many', 'Too many', 'y']] },
];
const ISSUES = ['Kitchen late', 'Short staffed', 'Client issue', 'Venue issue'];
export const DEBRIEF_LABEL: Record<string, [string, Tone]> = Object.fromEntries(QS.flatMap((q) => q.opts.map(([v, l, t]) => [q.key + ':' + v, [q.key === 'client' ? 'Client ' + l.toLowerCase() : q.key === 'team_size' && v === 'right' ? 'Team right' : l, t]])));

export function DebriefSheet({ eventId, onClose, onSent }: { eventId: string; onClose: () => void; onSent: () => void }) {
  const [a, setA] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<string[]>([]); const [what, setWhat] = useState(''); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const bad = a.night === 'rough' || a.night === 'issues' || a.client === 'mixed' || a.client === 'no';
  const n = QS.filter((q) => a[q.key]).length;
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('manager_send_debrief', { p_event: eventId, p_night: a.night ?? null, p_client: a.client ?? null, p_difficulty: a.difficulty ?? null,
      p_team_size: a.team_size ?? null, p_issues: bad ? issues : [], p_what: bad ? what : null, p_note: note });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSent();
  };
  return (
    <SwipeSheet onClose={onClose} label="How did tonight go?" x={false}>
      <div className="db-head">
        <div className="grow"><span className="pf-st ok">✓ HOURS SENT</span><div className="serif db-title">How did tonight go?</div></div>
        <button type="button" className="db-skip" onClick={onClose}>Skip</button>
      </div>
      <div className="db-card">
        {QS.map((q, i) => (
          <div key={q.key} className="db-q">
            {i > 0 && <i className="db-line" />}
            <b>{q.label}</b>
            <div className="db-seg" role="radiogroup" aria-label={q.label}>
              {q.opts.map(([v, l, t]) => (
                <button key={v} type="button" role="radio" aria-checked={a[q.key] === v} className={a[q.key] === v ? 'on ' + t : ''}
                  onClick={() => setA((x) => ({ ...x, [q.key]: x[q.key] === v ? '' : v }))}>{l}</button>
              ))}
            </div>
            {q.key === 'night' && bad && (
              <div className="db-what">
                <b>What happened? <span>optional</span></b>
                <div className="db-chips">{ISSUES.map((x) => <button key={x} type="button" className={issues.includes(x) ? 'on' : ''} onClick={() => setIssues((s) => s.includes(x) ? s.filter((y) => y !== x) : [...s, x])}>{x}</button>)}</div>
                <input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="A line to explain" maxLength={300} />
              </div>
            )}
          </div>
        ))}
      </div>
      <label className="db-note"><span aria-hidden="true">💬</span><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional)" maxLength={500} /></label>
      {err && <p className="error">{err}</p>}
      <button type="button" className="btn-ink" disabled={busy || n === 0} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
    </SwipeSheet>
  );
}

type Row = { id: string; event_id: string; night: string | null; client: string | null; difficulty: string | null; team_size: string | null; issues: string[]; what: string | null; note: string | null; created_at: string; staff: { full_name: string; nickname: string | null } | null; events?: { title: string; event_date: string } | null };
const COLS = 'id,event_id,night,client,difficulty,team_size,issues,what,note,created_at,staff:staff!event_debriefs_by_staff_fkey(full_name,nickname),events(title,event_date)';
function Card({ r, withEvent }: { r: Row; withEvent?: boolean }) {
  const tags = (['night', 'client', 'difficulty', 'team_size'] as const).map((k) => r[k] ? DEBRIEF_LABEL[k + ':' + r[k]] : null).filter(Boolean) as [string, Tone][];
  const who = r.staff ? (r.staff.nickname || r.staff.full_name.split(' ')[0]) : 'Manager';
  const day = r.events ? new Date(r.events.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  return (
    <div className="dbr">
      <div className="dbr-top"><span aria-hidden="true">📝</span><b>{withEvent && r.events ? `${r.events.title} · ${day} · ${who}` : `Debrief · ${who}`}</b><span className="muted sm">{new Date(r.created_at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })}</span></div>
      {tags.length > 0 && <div className="dbr-tags">{tags.map(([l, t]) => <span key={l} className={t}>{l}</span>)}</div>}
      {(r.issues.length > 0 || r.what) && <div className="dbr-txt">{[r.issues.join(' · '), r.what ? `“${r.what}”` : ''].filter(Boolean).join(' · ')}</div>}
      {r.note && <div className="dbr-txt">💬 {r.note}</div>}
    </div>
  );
}
/** Admin · the debrief(s) for one event (Today card). Nothing shown before 077 or when none was sent. */
export function DebriefCards({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { supabase.from('event_debriefs').select(COLS).eq('event_id', eventId).order('created_at')
    .then(({ data, error }) => { if (!error) setRows((data ?? []) as unknown as Row[]); }); }, [eventId]);
  return <>{rows.map((r) => <Card key={r.id} r={r} />)}</>;
}
/** Admin Today · debriefs sent in the last 36 h for events that are no longer on Tonight (last night's). */
export function RecentDebriefs({ skip }: { skip: string[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { supabase.from('event_debriefs').select(COLS).gte('created_at', new Date(Date.now() - 36 * 3600e3).toISOString()).order('created_at', { ascending: false })
    .then(({ data, error }) => { if (!error) setRows((data ?? []) as unknown as Row[]); }); }, []);
  const show = rows.filter((r) => !skip.includes(r.event_id));
  if (!show.length) return null;
  return <><div className="sec"><span className="serif">Last night · debriefs</span></div>{show.map((r) => <Card key={r.id} r={r} withEvent />)}</>;
}
