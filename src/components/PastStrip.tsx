import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Staff } from '../lib/supabase';
import { useSettings } from '../lib/settings';
import { feedbackOn } from '../pages/Manage';
import { usePastEvents, managesShift, agoLabel, readHidden, hideToday } from '../lib/pastEvents';
import { mtlToday, addDays } from '../lib/myDates';

/**
 * push 51 · Home, managers: one compact gold line per thing left on an event they managed in the last 7 days
 * (yesterday back to 7 days ago): "Rate n new staff" (only when feedback is on for them) and "Send hours".
 * Gone once done or after 7 days. ✕ = hidden until tomorrow on this phone.
 */
export function PastStrips({ me }: { me: Staff }) {
  useSettings();
  const fbOn = feedbackOn(me);
  const { shifts, sums } = usePastEvents(me.id, 7, fbOn);
  const [hidden, setHidden] = useState(readHidden);
  if (!shifts) return null;
  const today = mtlToday(); const from = addDays(today, -7);
  const seen = new Set<string>();
  const evs = shifts.filter((s) => s.events.event_date < today && s.events.event_date >= from && managesShift(s, me.id) && !seen.has(s.events.id) && seen.add(s.events.id));
  const items: { key: string; to: string; title: string; sub: string; btn: string; kind: 'rate' | 'hours' }[] = [];
  for (const s of evs) {
    const sum = sums[s.events.id]; if (!sum) continue;
    const venue = s.events.venues?.name ?? s.events.title; const when = agoLabel(s.events.event_date, today);
    if (!s.events.hours_submitted_at && sum.worked > 0)
      items.push({ key: 'hours:' + s.events.id, to: `/manage/${s.events.id}?submit=1`, title: 'Send hours', sub: `${venue} · ${when}`, btn: 'Send', kind: 'hours' });
    if (fbOn && sum.toRate > 0)
      items.push({ key: 'rate:' + s.events.id, to: `/manage/${s.events.id}?rate=all`, title: `Rate ${sum.toRate} new staff`, sub: `${venue} · ${when}`, btn: 'Rate', kind: 'rate' });
  }
  const show = items.filter((x) => hidden[x.key] !== today);
  if (!show.length) return null;
  return (
    <>
      {show.map((x) => (
        <div key={x.key} className="past-strip" role="status">
          <span className="ps-ic" aria-hidden="true">{x.kind === 'rate' ? '★' : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>}</span>
          <span className="grow"><b>{x.title}</b><small>{x.sub}</small></span>
          <Link className="ps-go" to={x.to}>{x.btn}</Link>
          <button className="ps-x" aria-label="Hide until tomorrow" onClick={() => { hideToday(x.key); setHidden(readHidden()); }}>✕</button>
        </div>
      ))}
    </>
  );
}
