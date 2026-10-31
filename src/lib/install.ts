/**
 * Push 31b step 6 · Add G&R to the Home Screen.
 * Imported first thing in main.tsx so Android Chrome's `beforeinstallprompt` is caught before the check-up renders.
 */
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: BIPEvent | null = null;
const subs = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as BIPEvent; subs.forEach((f) => f()); });
  window.addEventListener('appinstalled', () => { deferred = null; clearHomeSkip(); subs.forEach((f) => f()); });
}

export const canPromptInstall = () => !!deferred;
export const onInstallChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** Show Chrome's install dialog. Returns true when they accepted. */
export async function promptInstall(): Promise<boolean> {
  const e = deferred; if (!e) return false;
  await e.prompt();
  const r = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  deferred = null; subs.forEach((f) => f());
  return r.outcome === 'accepted';
}

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent || '');
/** Running from the Home Screen icon (installed). */
export const isStandalone = () =>
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true);
export const isIOS = () => /iPhone|iPad|iPod/i.test(ua()) || (/Macintosh/.test(ua()) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(ua());
export const isPhone = () => isIOS() || isAndroid();
/** WhatsApp / Instagram / Facebook / Messenger / Line … in-app browsers can't install a web app. */
export const isInAppBrowser = () => /FBAN|FBAV|FB_IAB|FBIOS|Instagram|WhatsApp|Messenger|MessengerForiOS|\bLine\/|MicroMessenger|Snapchat|TikTok|musical_ly|LinkedInApp|GSA\/|; wv\)/i.test(ua());

/** Android: open this page in Chrome from an in-app browser. */
export const chromeIntentUrl = () => {
  const u = new URL(window.location.href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`;
};

// "Skip for now" on the Home Screen step: per device. checkup_done_at is still set; the step alone shows again on the
// next open from the browser (once per browser session), never once the app runs from the icon.
const SKIP = 'gr_a2hs_skip'; const SEEN = 'gr_a2hs_seen';
export function setHomeSkip() { try { localStorage.setItem(SKIP, '1'); sessionStorage.setItem(SEEN, '1'); } catch { /* private mode */ } }
export function clearHomeSkip() { try { localStorage.removeItem(SKIP); } catch { /* private mode */ } }
export function homeStepDue(): boolean {
  try {
    if (isStandalone()) { localStorage.removeItem(SKIP); return false; }
    return localStorage.getItem(SKIP) === '1' && sessionStorage.getItem(SEEN) !== '1' && isPhone();
  } catch { return false; }
}
export function markHomeStepSeen() { try { sessionStorage.setItem(SEEN, '1'); } catch { /* private mode */ } }
/** Step 6 applies at all: a phone browser, not already installed. */
export const homeStepApplies = () => !isStandalone() && isPhone();
