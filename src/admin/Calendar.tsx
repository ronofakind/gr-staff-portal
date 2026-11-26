import { Navigate, useSearchParams } from 'react-router-dom';
import { Day } from './Day';
import { Month } from './Month';

/* Nov 25 · Calendar = the month only (Ronnie: Week and Day aren't useful). /admin/week opens the month;
   /admin/day still works for links that send details (no tabs any more). */
export function Calendar({ view }: { view: 'week' | 'day' | 'month' }) {
  const [params] = useSearchParams();
  if (view === 'week') { const p = params.toString(); return <Navigate to={`/admin/month${p ? `?${p}` : ''}`} replace />; }
  return <div className="stack-lg">{view === 'month' ? <Month /> : <Day />}</div>;
}

/** /admin/calendar → the month. */
export function CalendarRedirect() {
  const [params] = useSearchParams();
  const p = new URLSearchParams(params); p.delete('view'); const q = p.toString();
  return <Navigate to={`/admin/month${q ? `?${q}` : ''}`} replace />;
}
