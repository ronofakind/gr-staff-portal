import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Files in the event's Drive folder (needs Google Drive connected). "Only you" hides a file from managers. */
export function DriveFiles({ eventId, admin = true }: { eventId: string; admin?: boolean }) {
  const [files, setFiles] = useState<{ id: string; name: string; link: string; modified: string; hidden?: boolean }[] | null>(null);
  const load = async () => {
    const { data: ses } = await supabase.auth.getSession();
    const r = await fetch(`/api/drive/files?event=${eventId}`, { headers: { Authorization: `Bearer ${ses.session?.access_token}` } });
    setFiles(r.ok ? (await r.json()).files : null);
  };
  useEffect(() => { load(); }, [eventId]);
  if (!files || !files.length) return null;
  const toggle = async (id: string, hidden?: boolean) => {
    if (hidden) await supabase.from('event_files_hidden').delete().eq('event_id', eventId).eq('file_id', id);
    else await supabase.from('event_files_hidden').insert({ event_id: eventId, file_id: id });
    load();
  };
  return (
    <div className="full"><small>Files in the folder{admin ? ' · managers see them unless “Only you”' : ''}</small>
      <div className="stack" style={{ gap: 6 }}>{files.map((f) => (
        <div key={f.id} className="row" style={{ gap: 8, alignItems: 'center' }}>
          <a className="tag" href={f.link} target="_blank" rel="noreferrer">{f.name}</a>
          {admin && <button className="abtn sm" onClick={() => toggle(f.id, f.hidden)}>{f.hidden ? 'Only you ✓' : 'MD + BM'}</button>}
        </div>))}</div>
    </div>
  );
}
