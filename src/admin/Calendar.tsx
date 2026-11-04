import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Week } from './Week';
import { Day } from './Day';
import { addDays, isoDay } from './api';

/* Push 47 · Week + Day = one Calendar page with a Week / Day switch at the top.
   The old /admin/week and /admin/day URLs (and every link to them) keep working: they render here with the right tab. */

const monday = (iso: string) => { const d = new Date(iso + 'T12:00:00'); return addDays(iso, -((d.getDay() + 6) % 7)); };
const okDay = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

export function Calendar({ view }: { view: 'week' | 'day' }) {
  const [params] = useSearchParams();
  const today = isoDay(new Date());
  const d = okDay(params.get('d')) ? params.get('d')! : today;
  // Week → Day: today if it's in that week, else the Monday. Day → Week: the week of that day.
  const dayTarget = view === 'week' ? (monday(today) === monday(d) ? today : monday(d)) : d;
  return (
    <div className="stack-lg">
      <div className="cal-switch">
        <span className="kick">CALENDAR</span>
        <div className="seg3" role="tablist" aria-label="Calendar view">
          <Link role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'on' : ''} to={`/admin/week?d=${d}`}>Week</Link>
          <Link role="tab" aria-selected={view === 'day'} className={view === 'day' ? 'on' : ''} to={`/admin/day?d=${dayTarget}`}>Day</Link>
        </div>
      </div>
      {view === 'week' ? <Week /> : <Day />}
    </div>
  );
}

/** /admin/calendar?view=day&d=… → the right tab. */
export function CalendarRedirect() {
  const [params] = useSearchParams();
  const p = new URLSearchParams(params); const v = p.get('view') === 'day' ? 'day' : 'week'; p.delete('view');
  const q = p.toString();
  return <Navigate to={`/admin/${v}${q ? `?${q}` : ''}`} replace />;
}
