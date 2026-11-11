// push 31: catch Android's beforeinstallprompt before anything renders (Home Screen step of the check-up)
import './lib/install';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './theme-dark.css';
import './theme-terra.css';
import { applyTheme, currentTheme } from './lib/theme';
applyTheme(currentTheme()); // push 78 · before first paint, no flash
import { registerSW } from 'virtual:pwa-register';

// New version deployed → swap it in and reload right away; check again whenever the app comes back to the front.
// Not inside the App Store / Google Play app (it opens the live site directly, no service worker there).
if (!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
  const update = registerSW({ immediate: true, onNeedRefresh() { update(true); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker?.getRegistration().then((r) => r?.update());
  });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
