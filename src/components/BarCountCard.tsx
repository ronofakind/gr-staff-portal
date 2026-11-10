import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/** Push 69 · on the shift page of the bar manager / MD (or whoever it was handed to): open the bar count. */
export function BarCountCard({ eventId, preview = false }: { eventId: string; preview?: boolean }) {
  const [m, setM] = useState<{ submitted_at: string | null; out_at: string | null; handed_to_me: boolean } | null>(null);
  useEffect(() => { if (preview) return; supabase.rpc('bar_count_mine', { p_event: eventId }).then(({ data, error }) => { if (!error) setM(data as typeof m); }); }, [eventId, preview]);
  if (!m) return null;
  return (
    <Link to={`/bar/${eventId}`} className="bc-card">
      <span className="grow"><small className="gt-kick">🍸 BAR COUNT{m.handed_to_me ? ' · HANDED TO YOU' : ''}</small>
        <b>{m.submitted_at ? '✓ Submitted · tap to edit' : m.out_at ? 'Started · add more out or count what comes back' : 'Count what goes out to the bar'}</b></span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}
