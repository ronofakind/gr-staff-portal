import { useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';

const ORDER = ['/me', '/schedule', '/hours', '/availability', '/profile'];

/** Swipe left/right anywhere on a main staff screen to move between tabs. */
function useSwipeTabs(enabled: boolean) {
  const nav = useNavigate(); const { pathname } = useLocation();
  useEffect(() => {
    const i = ORDER.indexOf(pathname === '/' ? '/me' : pathname);
    if (!enabled || i < 0) return;
    let x0 = 0, y0 = 0, t0 = 0, skip = false;
    const blocked = (el: EventTarget | null) => {
      for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName) || n.classList.contains('sheet') || n.classList.contains('dialog')) return true;
        if (n.scrollWidth > n.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) return true;
      }
      return !!document.querySelector('.sheet, .dialog, .review');
    };
    const start = (e: TouchEvent) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; t0 = Date.now(); skip = e.touches.length > 1 || blocked(e.target); };
    const end = (e: TouchEvent) => {
      if (skip) return;
      const t = e.changedTouches[0]; const dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - t0 > 700) return;
      const j = dx < 0 ? i + 1 : i - 1;
      if (j < 0 || j >= ORDER.length) return;
      try { sessionStorage.setItem('gr_swipe', dx < 0 ? 'left' : 'right'); } catch { /* ignore */ }
      nav(ORDER[j]);
    };
    document.addEventListener('touchstart', start, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    // Slide the new screen in from the side it came from.
    try {
      const dir = sessionStorage.getItem('gr_swipe'); sessionStorage.removeItem('gr_swipe');
      const main = document.querySelector('main.page');
      if (dir && main) { main.classList.remove('slide-left', 'slide-right'); void (main as HTMLElement).offsetWidth; main.classList.add('slide-' + dir); }
    } catch { /* ignore */ }
    return () => { document.removeEventListener('touchstart', start); document.removeEventListener('touchend', end); };
  }, [enabled, pathname, nav]);
}

const ic = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

/** Bottom menu on every staff screen. `base` keeps admin "view as" inside the preview. */
export function TabBar({ base = '', badge = 0 }: { base?: string; badge?: number }) {
  useSwipeTabs(!base);
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="in">
        <NavLink to={base || '/me'} end className={cls}><svg {...ic}><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>Home</NavLink>
        <NavLink to={`${base}/schedule`} className={cls}><svg {...ic}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></svg>Schedule</NavLink>
        {!base && <NavLink to="/hours" className={cls}><svg {...ic}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>Hours</NavLink>}
        {!base && <NavLink to="/availability" className={cls}><span className="tb-ic"><svg {...ic}><rect x="3" y="4.5" width="18" height="16" rx="3" /><path d="M8 2.5v4M16 2.5v4M8.5 14l2.5 2.5 4.5-5" /></svg>{badge > 0 && <i className="tb-badge">{badge}</i>}</span>Availability</NavLink>}
        {!base && <NavLink to="/profile" className={cls}><svg {...ic}><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></svg>Profile</NavLink>}
      </div>
    </nav>
  );
}
