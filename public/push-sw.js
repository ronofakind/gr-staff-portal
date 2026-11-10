/* Push 42 · phone alerts. Loaded into the app's service worker (vite.config.ts → workbox.importScripts).
 * Payload from /api/alerts: { title, body, cta, url, tag, actions, data, badge }.
 * iPhone: the phone draws the alert itself (white card, no buttons, text can't be coloured) → the 👉 line is plain text.
 * Android: G&R red accent, stronger vibration, buttons on the alert (YES · NO · OPEN, CONFIRM · OPEN, REPLY). */
self.addEventListener('push', (event) => {
  let p = {};
  try { p = event.data ? event.data.json() : {}; } catch (e) { p = { title: 'G&R', body: event.data ? event.data.text() : '' }; }
  const title = p.title || 'G&R';
  const body = [p.body, p.cta].filter(Boolean).join('\n');
  const max = (self.Notification && self.Notification.maxActions) || 0;
  const opts = {
    body,
    icon: '/icon-192.png',             // same G&R logo as the app icon (Ronnie, Nov 2)
    tag: p.tag || 'gr',
    renotify: true,
    timestamp: Date.now(),
    vibrate: [220, 90, 220, 90, 320],  // Android: stronger than the default buzz
    data: { url: p.url || '/', ...(p.data || {}) },
    actions: max > 0 && Array.isArray(p.actions) ? p.actions.slice(0, max) : [],
  };
  event.waitUntil((async () => {
    // Red number on the app icon = things waiting (asks, confirms, unread).
    try { if (typeof p.badge === 'number' && self.navigator.setAppBadge) { if (p.badge > 0) await self.navigator.setAppBadge(p.badge); else await self.navigator.clearAppBadge(); } } catch (e) { /* not supported */ }
    await self.registration.showNotification(title, opts);
    // App open on screen → also show the in-app banner (red "👉 Tap to…").
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((c) => c.postMessage({ type: 'gr-alert', title, body: p.body || '', cta: p.cta || '', url: p.url || '/', tag: opts.tag }));
  })());
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification; const d = n.data || {};
  n.close();
  let url = d.url || '/';
  const add = (q) => url + (url.includes('?') ? '&' : '?') + q;
  // Android buttons: the app does the answer when it opens (signed in there), then shows "✓ Sent".
  if ((event.action === 'yes' || event.action === 'no') && d.ask_id) url = add(`alert_do=${event.action}&ask=${encodeURIComponent(d.ask_id)}`);
  else if (event.action === 'confirm' && d.shift_id) url = add(`alert_do=confirm&shift=${encodeURIComponent(d.shift_id)}`);
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (w) {
      try { await w.focus(); } catch (e) { /* ignore */ }
      w.postMessage({ type: 'gr-open', url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
