import { useEffect, useState } from 'react';
import { supabase, onDbWrite } from './supabase';
import { isAndroid, isIOS, isStandalone } from './install';

/* Push 42 · phone alerts (Web Push). Migration 046 + api/alerts.js + public/push-sw.js.
   Dormant until Ronnie adds the alert keys in Vercel: /api/alerts?key=1 returns null → no card, no Profile section. */

export type AlertPrefs = { messages: boolean; dates: boolean; meetings: boolean; team_chat: boolean; nudge_skips: number; nudge_at: string | null; phones: number };
/** dormant = keys not set up · ios_browser = iPhone in Safari (only the Home Screen app can get alerts) */
export type DeviceState = 'dormant' | 'unsupported' | 'ios_browser' | 'denied' | 'off' | 'on';

let keyP: Promise<string | null> | null = null;
/** Public alert key from the server (no rebuild needed once Ronnie adds the keys), or null while not set up. */
export function alertKey(): Promise<string | null> {
  if (!keyP) {
    keyP = fetch('/api/alerts?key=1', { cache: 'no-store' })
      .then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : { key: null }))
      .then((j: { key?: string | null }) => (typeof j?.key === 'string' && j.key.length > 60 ? j.key : null))
      .catch(() => null);
  }
  return keyP;
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64uToBytes(s: string) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function bytesToB64u(buf: ArrayBuffer | Uint8Array | null | undefined) {
  if (!buf) return '';
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function deviceState(): Promise<DeviceState> {
  const key = await alertKey();
  if (!key) return 'dormant';
  if (isIOS() && !isStandalone()) return 'ios_browser';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await currentSub().catch(() => null);
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const platform = () => (isIOS() ? 'ios' : isAndroid() ? 'android' : 'desktop');
async function saveSub(sub: PushSubscription) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('push_subscribe', {
    p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_platform: platform(), p_ua: navigator.userAgent.slice(0, 300),
  });
  if (error) throw new Error(error.message);
}

/** Turn on (call straight from the tap: iPhone only asks from a tap). Returns the new state. */
export async function turnOnAlerts(): Promise<DeviceState> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission(); // first thing in the tap handler (iPhone needs the tap)
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const key = await alertKey();
  if (!key) return 'dormant';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && bytesToB64u(sub.options?.applicationServerKey) !== key) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(key) });
  await saveSub(sub);
  return 'on';
}

export async function turnOffAlerts(): Promise<DeviceState> {
  const sub = await currentSub().catch(() => null);
  if (sub) {
    await supabase.rpc('push_unsubscribe', { p_endpoint: sub.endpoint }).then(() => {}, () => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}

/** On every open: phone already on → make sure the server still has it (and it uses today's key; Ronnie may have made new keys). */
export async function syncDevice() {
  try {
    const key = await alertKey();
    if (!key || !pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentSub();
    if (!sub) return;
    if (bytesToB64u(sub.options?.applicationServerKey) !== key) { await turnOnAlerts(); return; }
    await saveSub(sub);
  } catch { /* try again next open */ }
}

/** My switches (null until migration 046 is applied). */
export async function loadAlertPrefs(): Promise<AlertPrefs | null> {
  const { data, error } = await supabase.rpc('my_alert_prefs');
  return error || !data ? null : (data as AlertPrefs);
}
export async function saveAlertPrefs(p: Partial<Pick<AlertPrefs, 'messages' | 'dates' | 'meetings' | 'team_chat'>>, nudge = false): Promise<AlertPrefs | null> {
  const { data, error } = await supabase.rpc('save_alert_prefs', { p, p_nudge: nudge });
  if (error) throw new Error(error.message);
  return data as AlertPrefs;
}

/** Phone state + my switches, for the Home card and Profile → Notifications. */
export function useAlerts() {
  const [state, setState] = useState<DeviceState | null>(null);
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null);
  useEffect(() => {
    let live = true;
    deviceState().then((s) => { if (!live) return; setState(s); if (s !== 'dormant') loadAlertPrefs().then((p) => live && setPrefs(p)); });
    return () => { live = false; };
  }, []);
  return { state, setState, prefs, setPrefs };
}

/** "Not now" on the Home card comes back once a week, 3 times max. */
export const nudgeDue = (p: AlertPrefs | null) => !!p && p.nudge_skips < 3 && (!p.nudge_at || Date.now() - new Date(p.nudge_at).getTime() > 7 * 864e5);

// ───────── send what's waiting (no cron: right after any write, on every open, and each morning from Vercel cron) ─────────
let timer: number | undefined; let disabled = false; let lastRun = 0; let fast = false;
async function runNow(what: 'run' | 'test' = 'run') {
  if (disabled && what === 'run') return null;
  const { data } = await supabase.auth.getSession();
  const tok = data.session?.access_token; if (!tok) return null;
  lastRun = Date.now();
  try {
    const r = await fetch('/api/alerts', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ do: what }) });
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) { if (r.status === 404) disabled = true; return null; }
    const j = await r.json();
    if (j?.setup === 'service') disabled = true; // server not set up: stop calling for this session
    return j;
  } catch { return null; }
}
/** Debounced: Ronnie / managers right away (1.5 s after the last write), staff at most every 20 s. */
export function kickAlerts() {
  if (disabled) return;
  window.clearTimeout(timer);
  const wait = fast ? 1500 : Math.max(1500, 20000 - (Date.now() - lastRun));
  timer = window.setTimeout(() => { runNow(); }, wait);
}
export const sendTestAlert = () => runNow('test');

const SKIP_RPC = /\/rpc\/(my_alert_badge|my_alert_prefs|touch_last_seen|messages_badge|push_subscribe|push_unsubscribe)\b/;
let started = false;
/** Once per app session, after sign-in. */
export function startAlerts(role: 'staff' | 'manager' | 'admin') {
  if (started) return; started = true;
  fast = role !== 'staff';
  onDbWrite((url) => { if (!SKIP_RPC.test(url)) kickAlerts(); });
  const OPEN = 'gr_alerts_open';
  const onOpen = () => {
    refreshBadge();
    let last = 0; try { last = Number(localStorage.getItem(OPEN) || 0); } catch { /* private mode */ }
    if (Date.now() - last > 5 * 60000) { try { localStorage.setItem(OPEN, String(Date.now())); } catch { /* private mode */ } runNow(); }
  };
  onOpen(); syncDevice();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onOpen(); });
  // Ronnie / managers with the app open: reminders and "not started yet" every 5 min.
  if (fast) window.setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - lastRun > 4.5 * 60000) runNow(); }, 60000);
}

/** Red number on the app icon (asks, confirms, unread). */
export async function refreshBadge() {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  const { data, error } = await supabase.rpc('my_alert_badge');
  if (error || typeof data !== 'number') return;
  try { if (data > 0) await nav.setAppBadge(data); else await nav.clearAppBadge?.(); } catch { /* not allowed */ }
}

// ───────── admin: make the alert keys in this browser (never saved anywhere) ─────────
/** VAPID key pair: public = uncompressed P-256 point (65 bytes), private = raw d (32 bytes), both base64url (web-push format). */
export async function makeAlertKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const publicKey = bytesToB64u(raw);
  const privateKey = String(jwk.d || '').replace(/=+$/, '');
  if (publicKey.length !== 87 || privateKey.length !== 43) throw new Error('These keys came out wrong. Tap Make alert keys again.');
  return { publicKey, privateKey };
}
export type AlertServerStatus = { keys: 'missing' | 'ready' | 'invalid'; service: boolean; subject: boolean };
export async function alertServerStatus(): Promise<AlertServerStatus | null> {
  try {
    const r = await fetch('/api/alerts?status=1', { cache: 'no-store' });
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) return null;
    return (await r.json()) as AlertServerStatus;
  } catch { return null; }
}
export type AlertPeople = { total: number; on: number; off: { id: string; name: string; phone: boolean }[]; texts_queued: number; waiting: number; last_push: string | null };
export async function alertPeople(): Promise<AlertPeople | null> {
  const { data, error } = await supabase.rpc('admin_alert_people');
  return error || !data ? null : (data as AlertPeople);
}
