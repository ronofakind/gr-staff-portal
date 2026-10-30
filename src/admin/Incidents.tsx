import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { kindLabel } from '../components/IncidentReport';

type Row = {
  id: string; event_id: string; kind: string; involved_staff: string[]; involved_other: string[]; happened_at: string | null; body: string | null;
  audio_path: string | null; audio_sec: number | null; photos: string[]; status: 'new' | 'follow_up' | 'reviewed'; admin_note: string | null; in_reliability: boolean; created_at: string;
  events: { title: string; event_date: string } | null; reporter: { full_name: string } | null;
};
const STATUS: Record<Row['status'], [string, string]> = { new: ['New', 'st-new'], follow_up: ['Follow-up', 'st-fu'], reviewed: ['Reviewed', 'st-ok'] };
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : '');
const dl = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Count of new reports, for the nav badge. */
export function useNewIncidents() {
  const [n, setN] = useState(0);
  useEffect(() => { supabase.from('incidents').select('id', { count: 'exact', head: true }).eq('status', 'new').then(({ count }) => setN(count ?? 0)); }, []);
  return n;
}

export function Incidents() {
  const [rows, setRows] = useState<Row[] | null>(null); const [names, setNames] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | Row['status']>('all'); const [sel, setSel] = useState<string | null>(null);
  const [media, setMedia] = useState<{ audio?: string; photos: string[] }>({ photos: [] }); const [note, setNote] = useState('');
  const load = async () => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const { data } = await supabase.from('incidents').select('*,events(title,event_date),reporter:staff!incidents_reported_by_fkey(full_name)').gte('created_at', since).order('created_at', { ascending: false });
    const list = (data ?? []) as Row[]; setRows(list);
    const ids = [...new Set(list.flatMap((r) => r.involved_staff))];
    if (ids.length) { const { data: st } = await supabase.from('staff').select('id,full_name').in('id', ids); setNames(Object.fromEntries((st ?? []).map((x: { id: string; full_name: string }) => [x.id, x.full_name]))); }
  };
  useEffect(() => { load(); }, []);
  const cur = rows?.find((r) => r.id === sel) ?? null;
  useEffect(() => {
    if (!cur) return; setNote(cur.admin_note ?? ''); setMedia({ photos: [] });
    (async () => {
      const paths = [...(cur.audio_path ? [cur.audio_path] : []), ...cur.photos];
      if (!paths.length) return;
      const { data } = await supabase.storage.from('incidents').createSignedUrls(paths, 3600);
      const urls = (data ?? []).map((d) => d.signedUrl);
      setMedia({ audio: cur.audio_path ? urls[0] : undefined, photos: urls.slice(cur.audio_path ? 1 : 0) });
    })();
  }, [sel]);
  const update = async (patch: Partial<Row>) => {
    if (!cur) return;
    await supabase.from('incidents').update({ ...patch, ...(patch.status === 'reviewed' ? { reviewed_at: new Date().toISOString() } : {}) }).eq('id', cur.id);
    await load();
  };
  const shown = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);
  const month = new Date().toISOString().slice(0, 7);
  const common = useMemo(() => { const c: Record<string, number> = {}; (rows ?? []).forEach((r) => (c[r.kind] = (c[r.kind] ?? 0) + 1)); const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return top ? kindLabel(top[0]) : '—'; }, [rows]);
  const who = (r: Row) => [...r.involved_staff.map((id) => names[id] ?? '?'), ...r.involved_other.map((x) => (x === 'guest' ? 'Guest' : 'Client / venue'))].join(', ') || '—';

  return (
    <div className="stack-lg inc-adm">
      <div className="toolbar"><div><div className="kick">REPORTED BY MANAGERS · LAST 90 DAYS</div><h1 className="serif-h">Incidents</h1></div>
        <div className="seg3">{(['all', 'new', 'follow_up', 'reviewed'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : STATUS[f][0]}</button>)}</div></div>
      <div className="inc-kpis">
        <div className="adm-card k-new"><span>NEW</span><b>{rows?.filter((r) => r.status === 'new').length ?? '…'}</b></div>
        <div className="adm-card k-fu"><span>FOLLOW-UP</span><b>{rows?.filter((r) => r.status === 'follow_up').length ?? '…'}</b></div>
        <div className="adm-card"><span>THIS MONTH</span><b>{rows?.filter((r) => r.created_at.startsWith(month)).length ?? '…'}</b></div>
        <div className="adm-card"><span>MOST COMMON</span><b>{common}</b></div>
      </div>
      <div className="inc-grid">
        <div className="adm-card" style={{ padding: 0, overflow: 'auto' }}>
          {rows && !shown.length && <div className="muted" style={{ padding: 18 }}>No incident reports{filter !== 'all' ? ' with this status' : ''}.</div>}
          {shown.length > 0 && <table className="inc-t"><thead><tr><th>DATE</th><th>EVENT</th><th>TYPE</th><th>INVOLVED</th><th>MANAGER</th><th>REPORT</th><th>STATUS</th></tr></thead><tbody>
            {shown.map((r) => (
              <tr key={r.id} className={sel === r.id ? 'on' : ''} onClick={() => setSel(r.id)}>
                <td className="muted">{r.events ? dl(r.events.event_date) : ''}</td><td><b>{r.events?.title}</b></td><td>{kindLabel(r.kind)}</td><td>{who(r)}</td>
                <td className="muted">{r.reporter?.full_name.split(' ')[0]}</td>
                <td>{[r.audio_sec ? `🎙 ${mmss(r.audio_sec)}` : r.body ? 'typed' : '', r.photos.length ? `${r.photos.length} photo${r.photos.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' · ')}</td>
                <td><span className={'inc-st ' + STATUS[r.status][1]}>{STATUS[r.status][0]}</span></td>
              </tr>))}
          </tbody></table>}
        </div>
        <aside className="adm-card inc-side">
          {!cur ? <div className="muted">Click a report to read it, play the voice note and see the photos.</div> : <>
            <div className="spread"><span className="serif" style={{ fontSize: 22 }}>{kindLabel(cur.kind)}{cur.involved_staff[0] ? ` · ${(names[cur.involved_staff[0]] ?? '').split(' ').slice(0, 2).join(' ')}` : ''}</span><span className={'inc-st ' + STATUS[cur.status][1]}>{STATUS[cur.status][0]}</span></div>
            <div className="muted sm">{cur.events && <Link to={`/admin/event/${cur.event_id}`}>{cur.events.title}</Link>} · {cur.events ? dl(cur.events.event_date) : ''}{cur.happened_at ? ` · ${tm(cur.happened_at)}` : ''} · reported by {cur.reporter?.full_name ?? '?'} {tm(cur.created_at)}</div>
            <div className="muted sm">Involved: {who(cur)}</div>
            {media.audio && <audio controls src={media.audio} style={{ width: '100%' }} />}
            {cur.body && <div className="inc-body">{cur.body}</div>}
            {media.photos.length > 0 && <div className="inc-pics">{media.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Incident photo" /></a>)}</div>}
            <label className="ef-f"><span>YOUR NOTES (PRIVATE)</span><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (cur.admin_note ?? '') && update({ admin_note: note || null })} placeholder="Called Eva Friday, she’s fine…" /></label>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="abtn dark" onClick={() => update({ status: 'reviewed' })}>Mark reviewed</button>
              <button className="abtn" onClick={() => update({ status: 'follow_up' })}>Needs follow-up</button>
              {cur.status !== 'new' && <button className="abtn sm" onClick={() => update({ status: 'new' })}>Back to new</button>}
            </div>
            <label className="radio"><input type="checkbox" checked={cur.in_reliability} onChange={(e) => update({ in_reliability: e.target.checked })} /> Add to reliability (shows on the person’s record)</label>
            <small className="muted">Not in Needs-you. Staff never see incident reports.</small>
          </>}
        </aside>
      </div>
    </div>
  );
}
