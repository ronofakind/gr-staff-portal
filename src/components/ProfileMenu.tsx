import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { Avatar } from './Avatar';

/** Push 35a · their photo (or initials) top right on every staff page. Tap → small menu (Profile is no longer a tab). */
export function ProfileButton({ me, preview = false, size = 38 }: { me: Staff; preview?: boolean; size?: number }) {
  const [open, setOpen] = useState(false); const nav = useNavigate(); const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | TouchEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', off); document.addEventListener('touchstart', off, { passive: true });
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('touchstart', off); };
  }, [open]);
  if (preview) return <Avatar name={me.full_name} url={me.photo_url} size={size} />;
  const go = (to: string) => { setOpen(false); nav(to); };
  return (
    <div className="pm" ref={box}>
      <button className={'pm-btn' + (open ? ' on' : '')} aria-label="My profile menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Avatar name={me.full_name} url={me.photo_url} size={size} />
      </button>
      {open && (
        <div className="pm-menu" role="menu">
          <button role="menuitem" className="first" onClick={() => go('/profile')}>My profile</button>
          {me.role !== 'admin' && <button role="menuitem" onClick={() => go('/profile?open=cal')}>Add my G&amp;R calendar</button>}
          <button role="menuitem" onClick={() => go('/profile?open=pin')}>Change my code</button>
          <button role="menuitem" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>Log out</button>
        </div>
      )}
    </div>
  );
}

/** Kicker + serif title on the left, photo menu on the right (My dates, Availability, Hours, Profile). */
export function PageHead({ me, kicker, title, preview = false, children }: { me: Staff; kicker: string; title: string; preview?: boolean; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="kicker">{kicker}</div>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05 }}>{title}</div>
        {children}
      </div>
      <ProfileButton me={me} preview={preview} />
    </div>
  );
}
