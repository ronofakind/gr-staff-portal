import { NavLink } from 'react-router-dom';

const ic = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

/** Bottom menu on every staff screen. `base` keeps admin "view as" inside the preview. */
export function TabBar({ base = '', badge = 0 }: { base?: string; badge?: number }) {
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="in">
        <NavLink to={base || '/me'} end className={cls}><svg {...ic}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>Home</NavLink>
        <NavLink to={`${base}/schedule`} className={cls}><svg {...ic}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>Schedule</NavLink>
        {!base && <NavLink to="/availability" className={cls}><span className="tb-ic"><svg {...ic}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M8 2.5v4M16 2.5v4M8.5 14l2.5 2.5 4.5-5" /></svg>{badge > 0 && <i className="tb-badge">{badge}</i>}</span>Availability</NavLink>}
        {!base && <NavLink to="/profile" className={cls}><svg {...ic}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>Profile</NavLink>}
      </div>
    </nav>
  );
}
