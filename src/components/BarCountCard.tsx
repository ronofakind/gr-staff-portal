import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { q } from '../lib/barCount';

type Mine = { submitted_at: string | null; started: boolean; handed_to_me: boolean; out?: number };
function useBarMine(eventId: string, off = false) {
  const [m, setM] = useState<Mine | null>(null);
  useEffect(() => { if (off) return; supabase.rpc('bar_count_mine', { p_event: eventId }).then(({ data, error }) => { if (!error) setM(data as Mine | null); }); }, [eventId, off]);
  return m;
}

/** Push 69 · on the shift page of the bar manager / MD (or whoever it was handed to): open the bar count. */
export function BarCountCard({ eventId, preview = false }: { eventId: string; preview?: boolean }) {
  const m = useBarMine(eventId, preview);
  if (!m) return null;
  return (
    <Link to={`/bar/${eventId}`} className="bc-card">
      <span className="grow"><small className="gt-kick">🍸 BAR COUNT{m.handed_to_me ? ' · HANDED TO YOU' : ''}</small>
        <b>{m.submitted_at ? '✓ Submitted · tap to edit' : m.started ? 'Started · + more out or bring back' : 'Count what goes out to the bar'}</b></span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}

/** Push 83 (board BarCountHomeV1) · Home next-shift card: 📁 Event folder + 🍸 Bar count side by side. Push 87: on any bar event that is the next shift (not only the same day), also in View as. */
export function HomeFolderBar({ eventId, isBar, folder }: { eventId: string; isBar: boolean; today?: boolean; folder: string | null; preview?: boolean }) {
  const m = useBarMine(eventId, !isBar);
  const bar = isBar && m;
  if (!folder && !bar) return null;
  return (
    <div className="home-fb">
      {folder && <a className="home-folder" href={folder} target="_blank" rel="noreferrer">📁 Event folder</a>}
      {bar && <Link className="home-folder" to={`/bar/${eventId}`}>{m.submitted_at ? <span className="ok">✓ Bar count sent</span>
        : <>🍸 Bar count{m.started && m.out ? <span className="gold">· {q(m.out)} out</span> : null}</>}</Link>}
    </div>);
}
