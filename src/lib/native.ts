/**
 * Native app (Capacitor, branch native-app). Same React app inside the iOS / Android shells.
 * - The app is served from the phone (capacitor://localhost or https://localhost), so server routes (/api/*) and
 *   links we hand out (invite, calendar feed) must point at the live site.
 * - Invite / app links (https://gr-staff-portal.vercel.app/go/…) open the app: we route them to the same path.
 */
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';

export const SITE_ORIGIN = 'https://gr-staff-portal.vercel.app';
export const isNative = () => Capacitor.isNativePlatform();
/** Origin for links and server calls: the live site inside the native app, the current origin on the web. */
export const siteOrigin = () => (isNative() ? SITE_ORIGIN : window.location.origin);
export const siteHost = () => new URL(siteOrigin()).host;

export function setupNative() {
  if (!isNative()) return;
  // 1. Relative /api/* calls go to the live site.
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/api/')) input = SITE_ORIGIN + input;
    return orig(input, init);
  };
  // 2. Links that open the app (Universal Links / App Links) → same page inside the app.
  CapApp.addListener('appUrlOpen', ({ url }) => {
    try {
      const u = new URL(url);
      if (u.host === new URL(SITE_ORIGIN).host) {
        const path = u.pathname + u.search + u.hash;
        if (path && path !== window.location.pathname + window.location.search) window.location.href = path;
      }
    } catch { /* not a URL we handle */ }
  });
}
