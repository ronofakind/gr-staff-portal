// Push 42 · phone alerts (Web Push) + text outbox for staff without alerts. Migration 046.
//
//   GET  /api/alerts?key=1     → { key }   public VAPID key, or null while alerts are not set up (the app then shows nothing)
//   GET  /api/alerts?status=1  → { keys: 'missing'|'ready'|'invalid', service, subject }   admin Settings → Phone alerts
//   GET  /api/alerts?tick=<token> → Supabase timer every 5 min (migration 047)
//   GET  /api/alerts?cron=1    → Vercel cron (vercel.json, once a day): reminders + anything held by quiet hours
//   POST /api/alerts {do:'run'}  (signed-in user's Supabase token) → reminders + send what's waiting
//   POST /api/alerts {do:'test'} (signed-in user's Supabase token) → "Send me a test" to that person's phones
//
// Env (Vercel): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (default mailto:gravotreservice@gmail.com),
// SUPABASE_SERVICE_ROLE_KEY, optional CRON_SECRET (Vercel sends it to the cron), optional APP_URL (links in texts).
// Dormant until the keys exist: no key → the app shows no "Turn on" card; no service key → nothing runs; no VAPID keys →
// nobody can have alerts on, so everything waiting goes to the text outbox (Mac mini iMessage) instead.
//
// What gets sent is decided in the database (alert_queue rows written by triggers when Ronnie presses Send / Ask,
// alerts_tick() for reminders, alerts_take() for quiet hours / switches / no longer relevant). Here: one notification per
// person per run (everything waiting merged), sent to each of their phones; none → one text.
import webpush from 'web-push';

const URL_ = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_KEY;
// Vercel value was pasted as SUPABASE_SERVICE_ROLE_KEY=“…” → keep only the key itself.
const cleanKey = (v) => (v || '').replace(/^\s*[A-Z_]+\s*=\s*/, '').replace(/[\s"'“”‘’]/g, '');
const SERVICE = cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
const PUB = (process.env.VAPID_PUBLIC_KEY || '').trim();
const PRIV = (process.env.VAPID_PRIVATE_KEY || '').trim();
const SUBJECT = (process.env.VAPID_SUBJECT || '').trim() || 'mailto:gravotreservice@gmail.com';
const TZ = 'America/Toronto';

let vapid = 'missing';
if (PUB && PRIV) {
  try { webpush.setVapidDetails(SUBJECT, PUB, PRIV); vapid = 'ready'; } catch (e) { vapid = 'invalid'; console.error('[alerts] VAPID keys', e.message); }
}
const pushReady = () => vapid === 'ready' && !!(URL_ && SERVICE);

const H = () => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' });
async function rpc(name, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: H(), body: JSON.stringify(args ?? {}) });
  if (!r.ok) throw new Error(`${name} ${r.status} ${(await r.text()).slice(0, 200)}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/** The signed-in person (Supabase access token) → staff id, or null. */
async function whoIs(req) {
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tok || !URL_ || !ANON) return null;
  const u = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!u.ok) return null;
  const uid = (await u.json().catch(() => ({})))?.id;
  if (!uid) return null;
  const s = await fetch(`${URL_}/rest/v1/staff?auth_user_id=eq.${encodeURIComponent(uid)}&active=eq.true&select=id,role`, { headers: H() });
  const rows = s.ok ? await s.json() : [];
  return rows[0] || null;
}

// ───────── wording ─────────
const ymd = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const t12 = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
/** "7:30 PM tonight" · "11:00 AM today" · "9:00 AM tomorrow" · "Sat 9:00 AM" */
function rel(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const now = new Date(); const day = ymd(d);
  const h = Number(d.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ })) % 24;
  if (day === ymd(now)) return `${t12(d)} ${h >= 17 ? 'tonight' : 'today'}`;
  if (day === ymd(new Date(now.getTime() + 864e5))) return `${t12(d)} tomorrow`;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })} ${t12(d)}`;
}
const fill = (s, a) => String(s || '').replace('{by}', a.data?.by ? rel(a.data.by) : 'soon');

// Most important first (the one that becomes the alert when several are waiting).
const ORDER = ['ask', 'confirm', 'confirm_remind', 'changed', 'shift', 'mgr_late', 'mgr_not_started', 'mgr_hours', 'mgr_reply', 'message',
  'team_pin', 'meeting_today', 'meeting', 'dates_remind', 'dates', 'team_chat', 'test'];
// Kinds that also go out as a text from the Mac mini when the person has no alert-enabled phone.
const TEXT_KINDS = new Set(['ask', 'confirm', 'confirm_remind', 'changed', 'shift', 'message', 'meeting_today', 'dates_remind']);

function compose(p) {
  const list = [...p.alerts].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || String(a.created_at).localeCompare(String(b.created_at)));
  const titleOf = (a) => {
    if (a.kind === 'dates' && Number(p.open_dates) > 0) return `📅 ${p.open_dates} ${Number(p.open_dates) === 1 ? 'date' : 'dates'} to answer`;
    return fill(a.title, a);
  };
  const main = list[0];
  const rest = list.slice(1);
  const also = rest.length ? `Also: ${titleOf(rest[0]).replace(/^\S+\s/u, '')}${rest.length > 1 ? ` + ${rest.length - 1} more` : ''}` : '';
  return {
    main, list,
    title: titleOf(main),
    body: [fill(main.body, main), also].filter(Boolean).join('\n'),
    cta: main.cta || '👉 Tap to open',
    url: main.url || '/',
    tag: main.tag || `gr-${main.kind}`,
    actions: rest.length ? [] : Array.isArray(main.actions) ? main.actions : [],
    data: { ...(main.data || {}), kind: main.kind },
  };
}

async function sendOne(p, origin) {
  const n = compose(p);
  const ids = p.alerts.map((a) => a.id);
  const subs = pushReady() ? p.subs || [] : [];
  const ok = []; const gone = []; let lastErr = '';
  if (subs.length) {
    const payload = JSON.stringify({ title: n.title, body: n.body, cta: n.cta, url: n.url, tag: n.tag, actions: n.actions, data: n.data, badge: Number(p.badge) || 0 });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600, urgency: 'high' });
        ok.push(s.endpoint);
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s.endpoint);
        lastErr = `${e?.statusCode || ''} ${e?.body || e?.message || ''}`.trim().slice(0, 200);
      }
    }));
  }
  if (ok.length) {
    await rpc('alerts_done', { p_ids: ids, p_via: 'push', p_note: ok.length < subs.length ? `${ok.length} of ${subs.length} phones` : null, p_ok: ok, p_gone: gone });
    return 'push';
  }
  // No phone took it → one text from the Mac mini (only for the kinds that matter, and only with a phone number).
  const forText = n.list.filter((a) => TEXT_KINDS.has(a.kind));
  if (!forText.length || !p.phone) {
    await rpc('alerts_done', { p_ids: ids, p_via: subs.length ? 'failed' : 'none', p_note: subs.length ? lastErr || 'push failed' : !p.phone ? 'no alerts, no phone number' : 'no alerts (no text for this kind)', p_gone: gone });
    return subs.length ? 'failed' : 'none';
  }
  const t = compose({ ...p, alerts: forText });
  const text = [`G&R · ${t.title}`, t.body, `Open the G&R app: ${origin}${t.url}`].filter(Boolean).join('\n');
  const by = forText.map((a) => a.data?.by).filter(Boolean).map((x) => new Date(x).getTime()).filter((x) => x > Date.now());
  const expires = new Date(Math.min(Date.now() + 12 * 3600e3, ...by)).toISOString();
  await rpc('alerts_done', { p_ids: ids, p_via: 'text', p_note: subs.length ? `push failed: ${lastErr}` : null, p_staff: p.staff_id, p_phone: p.phone,
    p_text: text, p_lang: p.lang || 'en', p_kind: t.main.kind, p_expires: expires, p_gone: gone });
  return 'text';
}

async function run(origin, only) {
  if (!only) await rpc('alerts_tick', {});
  const people = (await rpc('alerts_take', { p_only: only ?? null })) || [];
  const out = { push: 0, text: 0, none: 0, failed: 0 };
  for (let i = 0; i < people.length; i += 8) {
    const r = await Promise.all(people.slice(i, i + 8).map((p) => sendOne(p, origin).catch(async (e) => {
      console.error('[alerts] send', e.message);
      try { await rpc('alerts_done', { p_ids: p.alerts.map((a) => a.id), p_via: 'failed', p_note: String(e.message).slice(0, 200) }); } catch { /* left as sending */ }
      return 'failed';
    })));
    r.forEach((k) => { out[k] = (out[k] || 0) + 1; });
  }
  return { people: people.length, ...out };
}

export default async function handler(req, res) {
  // Native app (Capacitor) calls from capacitor://localhost / https://localhost: allow it, answer preflight.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const origin = (process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

  if (req.method === 'GET' && req.query.key) { res.status(200).json({ key: pushReady() ? PUB : null }); return; }
  if (req.method === 'GET' && req.query.status) {
    res.status(200).json({ keys: vapid, service: !!(URL_ && SERVICE), subject: !!process.env.VAPID_SUBJECT });
    return;
  }

  if (!URL_ || !SERVICE) { res.status(200).json({ ok: false, setup: 'service' }); return; } // dormant

  if (req.method === 'GET' && req.query.tick) {
    // Supabase timer (migration 047, pg_cron every 5 min) — one-time token it just wrote, checked with the service key.
    let ok = false;
    try { ok = await rpc('alerts_claim_tick', { p_token: String(req.query.tick) }); } catch { ok = false; }
    if (ok !== true) { res.status(401).json({ error: 'tick only' }); return; }
    try { res.status(200).json({ ok: true, ...(await run(origin)) }); } catch (e) { console.error('[alerts] tick', e.message); res.status(502).json({ error: 'failed' }); }
    return;
  }

  if (req.method === 'GET' && req.query.cron) {
    const secret = process.env.CRON_SECRET;
    const okCron = secret ? req.headers.authorization === `Bearer ${secret}` : /vercel-cron/i.test(String(req.headers['user-agent'] || ''));
    if (!okCron) { res.status(401).json({ error: 'cron only' }); return; }
    try { res.status(200).json({ ok: true, ...(await run(origin)) }); } catch (e) { console.error('[alerts] cron', e.message); res.status(502).json({ error: 'failed' }); }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  try {
    const me = await whoIs(req);
    if (!me) { res.status(401).json({ error: 'sign in' }); return; }
    if (body?.do === 'test') {
      if (!pushReady()) { res.status(200).json({ ok: false, setup: 'keys' }); return; }
      await rpc('alerts_test', { p_staff: me.id });
      res.status(200).json({ ok: true, ...(await run(origin, me.id)) });
      return;
    }
    res.status(200).json({ ok: true, ...(await run(origin)) });
  } catch (e) {
    console.error('[alerts]', e.message);
    res.status(502).json({ error: 'failed' });
  }
}
