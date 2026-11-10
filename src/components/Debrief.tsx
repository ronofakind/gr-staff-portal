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
  // push 60 (087) · log that the question opened, and Skip. Errors (before 087) are ignored.
  useEffect(() => { supabase.rpc('debrief_mark', { p_event: eventId, p_skip: false, p_build: __BUILD__ }).then(() => {}); }, [eventId]);
  const skip = () => { supabase.rpc('debrief_mark', { p_event: eventId, p_skip: true, p_build: __BUILD__ }).then(() => {}); onClose(); };
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('manager_send_debrief', { p_event: eventId, p_night: a.night ?? null, p_client: a.client ?? null, p_difficulty: a.difficulty ?? null,
      p_team_size: a.team_size ?? null, p_issues: bad ? issues : [], p_what: bad ? what : null, p_note: note });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSent();
  };
  return (
    <SwipeSheet onClose={skip} label="How did tonight go?" x={false}>
      <div className="db-head">
        <div className="grow"><span className="pf-st ok">✓ HOURS SENT</span><div className="serif db-title">How did tonight go?</div></div>
        <button type="button" className="db-skip" onClick={skip}>Skip</button>
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

export type DebriefRow = Row;
type Row = { id: string; event_id: string; archived_at?: string | null; night: string | null; client: string | null; difficulty: string | null; team_size: string | null; issues: string[]; what: string | null; note: string | null; created_at: string; staff: { full_name: string; nickname: string | null } | null; events?: { title: string; event_date: string } | null;
  /** push 70 · Ronnie's edit: the MD's original answers + when */ original?: Partial<Record<'night' | 'client' | 'difficulty' | 'team_size' | 'what' | 'note', string | null>> & { issues?: string[] } | null; edited_at?: string | null };
export const DEBRIEF_COLS = 'id,event_id,archived_at,original,edited_at,';
const COLS = 'id,event_id,original,edited_at,night,client,difficulty,team_size,issues,what,note,created_at,staff:staff!event_debriefs_by_staff_fkey(full_name,nickname),events(title,event_date)';
export function DebriefCard({ r: r0, withEvent, onArchive, flagged }: { r: Row; withEvent?: boolean; onArchive?: () => void; flagged?: boolean }) {
  const [r, setR] = useState(r0); const [edit, setEdit] = useState(false); useEffect(() => setR(r0), [r0]);
  const tags = (['night', 'client', 'difficulty', 'team_size'] as const).map((k) => r[k] ? DEBRIEF_LABEL[k + ':' + r[k]] : null).filter(Boolean) as [string, Tone][];
  const who = r.staff ? (r.staff.nickname || r.staff.full_name.split(' ')[0]) : 'Manager';
  const day = r.events ? new Date(r.events.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  return (
    <div className="dbr">
      <div className="dbr-top"><span aria-hidden="true">📝</span><b>{withEvent && r.events ? `${r.events.title} · ${day} · ${who}` : `Debrief · ${who}`}</b><span className="muted sm">{new Date(r.created_at).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })}</span>
        <button type="button" className="lnk sm" onClick={() => setEdit(true)} title="Edit this debrief · the MD isn’t told">✎ Edit</button>
        {onArchive && <button type="button" className="sq need-arch" aria-label="Archive" title="Archive · stays in Past debriefs" onClick={onArchive}>{ARCH_ICON}</button>}</div>
      {tags.length > 0 && <div className="dbr-tags">{tags.map(([l, t]) => <span key={l} className={t}>{l}</span>)}</div>}
      {(r.issues.length > 0 || r.what) && <div className="dbr-txt">{[r.issues.join(' · '), r.what ? `“${r.what}”` : ''].filter(Boolean).join(' · ')}</div>}
      {r.note && <div className="dbr-txt">💬 {r.note}</div>}
      {(r.edited_at || flagged) && <div className="dbr-ed">{r.edited_at && <i>EDITED BY YOU · {new Date(r.edited_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' })}</i>}{r.edited_at && r.original && <span className="muted sm"> MD said: {(['night', 'client', 'difficulty', 'team_size'] as const).filter((k) => (r.original?.[k] ?? null) !== (r[k] ?? null)).map((k) => r.original?.[k] ? DEBRIEF_LABEL[k + ':' + r.original[k]]?.[0] : '—').join(' · ') || 'same answers'}{r.original.note && r.original.note !== r.note ? ` · “${r.original.note}”` : ''}</span>}{flagged && <i className="red">DEBRIEFS OFTEN CORRECTED</i>}</div>}
      {edit && <DebriefEdit r={r} onClose={() => setEdit(false)} onSaved={(x) => { setR(x); setEdit(false); }} />}
    </div>
  );
}

/** push 70 · Ronnie edits the MD's answers directly (rankings / reviews read these). The MD's original stays for Ronnie; the MD isn't told. */
function DebriefEdit({ r, onClose, onSaved }: { r: Row; onClose: () => void; onSaved: (r: Row) => void }) {
  const [a, setA] = useState<Record<string, string | null>>({ night: r.night, client: r.client, difficulty: r.difficulty, team_size: r.team_size });
  const [what, setWhat] = useState(r.what ?? ''); const [note, setNote] = useState(r.note ?? ''); const [issues, setIssues] = useState<string[]>(r.issues ?? []);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const orig = r.original ?? { night: r.night, client: r.client, difficulty: r.difficulty, team_size: r.team_size, issues: r.issues, what: r.what, note: r.note };
  const save = async (back = false) => {
    setBusy(true); setErr('');
    const { data: me } = await supabase.rpc('me');
    const v = back ? { night: orig.night ?? null, client: orig.client ?? null, difficulty: orig.difficulty ?? null, team_size: orig.team_size ?? null, issues: orig.issues ?? [], what: orig.what ?? null, note: orig.note ?? null, original: null, edited_at: null, edited_by: null }
      : { ...a, issues, what: what.trim() || null, note: note.trim() || null, original: orig, edited_at: new Date().toISOString(), edited_by: me };
    const { error } = await supabase.from('event_debriefs').update(v).eq('id', r.id);
    setBusy(false); if (error) { setErr(error.message); return; }
    onSaved({ ...r, ...(v as Partial<Row>) } as Row);
  };
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card db-edit" onClick={(e) => e.stopPropagation()}>
      <div className="spread"><b className="serif" style={{ fontSize: 22 }}>Edit debrief{r.staff ? ` · ${r.staff.full_name.split(' ')[0]}` : ''}</b><button className="abtn sm" onClick={onClose}>✕</button></div>
      <span className="muted sm">Your answers replace the MD’s, so anything that reads debriefs (ranking reviews) uses yours. The MD’s original stays here for you. The MD isn’t told.</span>
      {QS.map((q) => (
        <div key={q.key} className="db-edrow"><b>{q.label}</b><div className="row wrap" style={{ gap: 6 }}>{q.opts.map(([v, l]) => <button key={v} type="button" className={'abtn sm' + (a[q.key] === v ? ' dark' : '')} onClick={() => setA({ ...a, [q.key]: v })}>{l}</button>)}</div>
          {(orig[q.key] ?? null) !== (a[q.key] ?? null) && <small className="gold">MD said: {orig[q.key] ? q.opts.find((o) => o[0] === orig[q.key])?.[1] : '—'}</small>}</div>))}
      <div className="db-edrow"><b>What happened</b><div className="row wrap" style={{ gap: 6 }}>{ISSUES.map((i) => <button key={i} type="button" className={'abtn sm' + (issues.includes(i) ? ' dark' : '')} onClick={() => setIssues(issues.includes(i) ? issues.filter((x) => x !== i) : [...issues, i])}>{i}</button>)}</div>
        <input className="db-edin" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="What happened (optional)" /></div>
      <div className="db-edrow"><b>Note</b><input className="db-edin" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />{(orig.note ?? '') !== note && <small className="gold">MD wrote: {orig.note ? `“${orig.note}”` : '—'}</small>}</div>
      {err && <p className="error">{err}</p>}
      <div className="row" style={{ gap: 8 }}><button className="abtn dark" disabled={busy} onClick={() => save(false)}>Save</button>{r.edited_at && <button className="abtn" disabled={busy} onClick={() => save(true)}>Back to the MD’s answers</button>}<button className="abtn" onClick={onClose}>Cancel</button></div>
    </div></div>
  );
}
/** Admin · the debrief(s) for one event (Today card). Nothing shown before 077 or when none was sent. */
export function DebriefCards({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { supabase.from('event_debriefs').select(COLS).eq('event_id', eventId).order('created_at')
    .then(({ data, error }) => { if (!error) setRows((data ?? []) as unknown as Row[]); }); }, [eventId]);
  return <>{rows.map((r) => <DebriefCard key={r.id} r={r} />)}</>;
}
export const ARCH_ICON = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" /></svg>;

/** Nov 8 · Today v4 (080). Debriefs from the last 36 h that weren't archived, for events no longer on Tonight.
 *  Archive by hand → Past debriefs (kept forever). After 36 h they leave Today by themselves. */
export function useRecentDebriefs(skip: string[], tick = 0) {
  const [rows, setRows] = useState<Row[]>([]); const [t, setT] = useState(0);
  useEffect(() => {
    const since = new Date(Date.now() - 36 * 3600e3).toISOString();
    supabase.from('event_debriefs').select(DEBRIEF_COLS + COLS.slice('id,event_id,'.length)).gte('created_at', since).is('archived_at', null).order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error) { setRows((data ?? []) as unknown as Row[]); return; }
        // before 080: no archived_at yet
        supabase.from('event_debriefs').select(COLS).gte('created_at', since).order('created_at', { ascending: false }).then(({ data: d2 }) => setRows((d2 ?? []) as unknown as Row[]));
      });
  }, [tick, t]);
  // push 60 (087) · managers who sent hours in the last 36 h but didn't answer: skipped, or never saw it.
  const [miss, setMiss] = useState<Miss[]>([]);
  useEffect(() => {
    // only hours sent after 087 went live (Nov 9, 11:45 AM) — before that nothing was recorded
    const since = new Date(Math.max(Date.now() - 36 * 3600e3, Date.parse('2026-11-09T16:45:00Z'))).toISOString();
    supabase.from('events').select('id,title,hours_submitted_at,hours_submitted_by').gte('hours_submitted_at', since).not('hours_submitted_by', 'is', null).then(async ({ data, error }) => {
      if (error || !data?.length) { setMiss([]); return; }
      const evs = data as { id: string; title: string; hours_submitted_at: string; hours_submitted_by: string }[];
      const ids = evs.map((e) => e.id);
      const [{ data: seen, error: e2 }, { data: done }, { data: st }] = await Promise.all([
        supabase.from('debrief_seen').select('event_id,staff_id,shown_at,skipped_at').in('event_id', ids),
        supabase.from('event_debriefs').select('event_id').in('event_id', ids),
        supabase.from('staff').select('id,full_name,nickname').in('id', [...new Set(evs.map((e) => e.hours_submitted_by))]),
      ]);
      if (e2) { setMiss([]); return; } // before 087
      const answered = new Set(((done ?? []) as { event_id: string }[]).map((d) => d.event_id));
      const who = Object.fromEntries(((st ?? []) as { id: string; full_name: string; nickname: string | null }[]).map((s) => [s.id, s.nickname || s.full_name]));
      const sn = (seen ?? []) as { event_id: string; staff_id: string; shown_at: string; skipped_at: string | null }[];
      setMiss(evs.filter((e) => !answered.has(e.id)).map((e) => {
        const s = sn.find((x) => x.event_id === e.id && x.staff_id === e.hours_submitted_by);
        return { event_id: e.id, title: e.title, who: who[e.hours_submitted_by] ?? 'Manager', sent: e.hours_submitted_at, status: s?.skipped_at ? 'skipped' : s ? 'open' : 'never', at: s?.skipped_at ?? s?.shown_at ?? null };
      }));
    });
  }, [tick, t]);
  const show = rows.filter((r) => !skip.includes(r.event_id));
  const archive = async (id: string) => { setRows((v) => v.filter((x) => x.id !== id)); await supabase.from('event_debriefs').update({ archived_at: new Date().toISOString() }).eq('id', id); setT((x) => x + 1); };
  return { rows: show, archive, miss: miss.filter((m) => !skip.includes(m.event_id)) };
}
type Miss = { event_id: string; title: string; who: string; sent: string; status: 'skipped' | 'open' | 'never'; at: string | null };
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
export function RecentDebriefs({ rows, archive, miss }: ReturnType<typeof useRecentDebriefs>) {
  if (!rows.length && !miss.length) return <div className="muted sm" style={{ padding: '10px 4px' }}>No debriefs from last night.</div>;
  return <>{rows.map((r) => <DebriefCard key={r.id} r={r} withEvent onArchive={() => archive(r.id)} />)}
    {miss.map((m) => (
      <div key={m.event_id} className="dbr dbr-miss">
        <div className="dbr-top"><span aria-hidden="true">📝</span><b>{m.title} · {m.who}</b><span className={'dbm ' + m.status}>{m.status === 'skipped' ? 'SKIPPED' : m.status === 'open' ? 'NOT ANSWERED' : 'NEVER SAW IT'}</span></div>
        <div className="dbr-txt muted">{m.status === 'skipped' ? `Saw it at ${hm(m.at!)} and tapped Skip` : m.status === 'open' ? `Opened at ${hm(m.at!)} · no answer yet` : `Hours sent ${hm(m.sent)} · the question never opened on their phone`}</div>
      </div>))}</>;
}
