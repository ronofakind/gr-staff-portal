import { NavLink, Outlet, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function AdminLayout() {
  const nav = [
    ['/admin', 'Week'],
    ['/admin/day', 'Day'],
    ['/admin/availability', 'Availability'],
    ['/admin/tiers', 'Tiers & ranking'],
    ['/admin/staff', 'Staff'],
  ];
  return (
    <div className="admin">
      <nav className="side">
        <img src="/logo-mark.png" alt="G&R" className="side-logo" />
        {nav.map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => 'side-link' + (isActive ? ' on' : '')}>{label}</NavLink>
        ))}
        <div className="grow" />
        <Link to="/me" className="side-link">My shifts</Link>
        <Link to="/admin/staff" className="side-link">View as staff…</Link>
        <button className="side-link" onClick={() => supabase.auth.signOut()}>Log out</button>
      </nav>
      <main className="admin-main"><Outlet /></main>
    </div>
  );
}
