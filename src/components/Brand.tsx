import { Fragment, type ReactNode } from 'react';

/** Ronnie, Nov 4: wherever the G&R brand shows in the app, use the logo, not the letters. */
export function Brand() {
  return <img src="/logo-mark.png" alt="G&R" className="brand-i" />;
}

/** "Add G&R to your Home Screen" → text with the logo in place of G&R. */
export function brandify(s: string): ReactNode {
  const parts = s.split('G&R');
  if (parts.length === 1) return s;
  return parts.map((p, i) => <Fragment key={i}>{i > 0 && <Brand />}{p}</Fragment>);
}
