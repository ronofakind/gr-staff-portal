import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNewIncidents } from './Incidents';
import { useInboxCount } from '../lib/messages';

const I = (d: string) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
export const ICONS = {
  today: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book: '<rect x="3" y="4" width="7" height="16" rx="2"/><rect x="14" y="4" width="7" height="10" rx="2"/><path d="M14 18h7"/>',
  msg: '<path d="M4 5h16v10H9l-5 4z"/>',
  week: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/>',
  day: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="9.5" y="4" width="5" height="16" rx="1.5"/><rect x="16" y="4" width="5" height="16" rx="1.5"/>',
  staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5c2.8 0 4.8 1.6 5.5 4.5"/>',
  avail: '<path d="M9 11.5l2.2 2.2L16 9"/><rect x="3.5" y="3.5" width="17" height="17" rx="3"/>',
  tiers: '<path d="M12 3 3 8l9 5 9-5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  hours: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17.2v.3"/>',
  rank: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  venue: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  meet: '<rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5 21 7.5v9l-5.5-3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
};
/** push 47 · desktop left nav in 4 groups (Plan · People · Pay · Talk), setup pages greyed at the bottom. */
export const NAV_GROUPS: { title: string; items: [string, string, keyof typeof ICONS][] }[] = [
  { title: 'PLAN', items: [['/admin', 'Today', 'today'], ['/admin/bookings', 'Bookings', 'book'], ['/admin/calendar', 'Calendar', 'week']] },
  { title: 'PEOPLE', items: [['/admin/staff', 'Staff', 'staff'], ['/admin/availability', 'Availability', 'avail'], ['/admin/tiers', 'Tiers & ranking', 'tiers'], ['/admin/reliability', 'Reliability', 'flag'], ['/admin/debriefs', 'Debriefs & ratings', 'msg'], ['/admin/rates', 'Pay rates', 'hours']] },
  { title: 'PAY', items: [['/admin/hours', 'Hours', 'hours']] },
  { title: 'TALK', items: [['/admin/messages', 'Messages', 'msg'], ['/admin/meetings', 'Meetings', 'meet'], ['/admin/incidents', 'Incidents', 'alert']] },
];
const SETUP: [string, string, keyof typeof ICONS][] = [['/admin/venues', 'Venues & clients', 'venue'], ['/admin/settings', 'Settings', 'gear'], ['/me', 'My shifts', 'today']];
export const NAV = [...NAV_GROUPS.flatMap((g) => g.items), ...SETUP.filter(([to]) => to !== '/me')];
/** One nav line stands for several pages: Calendar = Week + Day, Tiers & ranking = Tiers + Ranking. */
const ALSO: Record<string, string[]> = { '/admin/calendar': ['/admin/week', '/admin/day', '/admin/month'], '/admin/week': ['/admin/day', '/admin/calendar', '/admin/month'], '/admin/tiers': ['/admin/ranking'] };
const TABS: [string, string, keyof typeof ICONS][] = [
  ['/admin', 'Today', 'today'], ['/admin/week', 'Week', 'week'], ['/admin/availability', 'Availability', 'avail'], ['/admin/staff', 'Staff', 'staff'], ['/admin/more', 'More', 'more'],
];

export function AdminLayout() {
  const newInc = useNewIncidents();
  const loc = useLocation();
  const needsReply = useInboxCount(); // push 36d · Needs reply
  // Switch the page to the admin home-screen app (name, icon, start page) while on /admin.
  useEffect(() => { (window as unknown as { grAppMode?: () => void }).grAppMode?.(); return () => { setTimeout(() => (window as unknown as { grAppMode?: () => void }).grAppMode?.(), 0); }; }, []);
  return (
    <div className="adm">
      <nav className="adm-side" aria-label="Admin">
        <Link to="/admin" className="adm-brand" aria-label="Today"><img className="adm-logo" src="/logo-white.png" alt="G&amp;R" /><small>ADMIN</small></Link>
        <Link to="/admin/event/new" className="adm-new"><span>+</span>New event</Link>
        {NAV_GROUPS.map((g) => (
          <div key={g.title} className="adm-grp">
            <div className="adm-grp-h">{g.title}</div>
            {g.items.map(([to, label, ic]) => (
              <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => 'adm-link' + (isActive || (ALSO[to] ?? []).some((p) => loc.pathname.startsWith(p)) ? ' on' : '')}>{I(ICONS[ic])}{label}{to === '/admin/incidents' && newInc > 0 && <span className="nav-badge">{newInc}</span>}{to === '/admin/messages' && needsReply > 0 && <span className="nav-badge">{needsReply}</span>}</NavLink>
            ))}
          </div>
        ))}
        <div className="grow" />
        <div className="adm-setup">
          {SETUP.map(([to, label, ic]) => <NavLink key={to} to={to} className={({ isActive }) => 'adm-link sm' + (isActive ? ' on' : '')}>{I(ICONS[ic])}{label}</NavLink>)}
          <button className="adm-link sm" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>Log out</button>
        </div>
      </nav>
      <main className="adm-main"><Link to="/admin" className="adm-mtop" aria-label="Today"><img src="/logo-mark.png" alt="G&amp;R" /><small>ADMIN</small></Link><Outlet /></main>
      <Link to="/admin/event/new" className="adm-fab" aria-label="New event">+</Link>
      <nav className="adm-tabs" aria-label="Admin tabs">
        {TABS.map(([to, label, ic]) => (
          <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => (isActive ? 'on' : '')}>{I(ICONS[ic])}{label}</NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Phone only: everything that doesn't fit in the bottom tabs. */
export function More() {
  const needsReply = useInboxCount();
  const items: [string, string, keyof typeof ICONS][] = [
    ['/admin/bookings', 'Bookings', 'book'], ['/admin/day', 'Day view', 'day'], ['/admin/hours', 'Hours & pay period', 'hours'], ['/admin/reliability', 'Reliability', 'flag'], ['/admin/debriefs', 'Debriefs & ratings', 'msg'], ['/admin/rates', 'Pay rates', 'hours'], ['/admin/incidents', 'Incidents', 'alert'], ['/admin/messages', 'Messages', 'msg'],
    ['/admin/meetings', 'Meetings', 'meet'], ['/admin/tiers', 'Tiers', 'tiers'], ['/admin/ranking', 'Ranking · score', 'rank'], ['/admin/venues', 'Venues & clients', 'venue'], ['/admin/settings', 'Settings', 'gear'], ['/me', 'My shifts', 'today'],
  ];
  return (
    <div className="stack-lg">
      <div><div className="kick">MORE</div><h1 className="serif-h">Everything else</h1></div>
      <div className="adm-card" style={{ padding: '4px 16px' }}>
        {items.map(([to, label, ic]) => <Link key={to} to={to} className="more-row">{I(ICONS[ic])}<span className="grow">{label}</span>{to === '/admin/messages' && needsReply > 0 && <span className="nav-badge">{needsReply}</span>}›</Link>)}
        <button className="more-row" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}><span className="grow">Log out</span></button>
      </div>
    </div>
  );
}
