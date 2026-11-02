// Push 34 · personal invite link /go/<token> (one use, 7 days).
//
//   GET  /api/go?check=1   → { ready }  is the service role key set? (admin Invite pop-up shows "Invite links need setup")
//   GET  /api/go?t=<token> → { state: 'ok'|'expired'|'used'|'unknown'|'setup', name?, email? }   never consumes the link
//   POST /api/go { t }     → { token_hash, email }   consumes the link (used_at) and returns a one-time sign-in hash
//
// How the sign-in works (no email is sent, no email code is typed):
//   1. go_invite_claim(token) marks used_at atomically (works once) and gives back the staff email / auth_user_id.
//   2. If they have no auth user yet: auth.admin "create user" with their staff email (email_confirm: true). The
//      link_staff_login() trigger (migration 001) links it to the staff row, exactly like a first sign-in by email.
//   3. auth.admin "generate_link" type magiclink (Supabase does NOT email it) → hashed_token.
//   4. The browser calls supabase.auth.verifyOtp({ token_hash, type: 'magiclink' }) → a normal Supabase session in
//      that browser. No redirect URL to allow-list, and session tokens never pass through this server.
// The service role key stays here (server env SUPABASE_SERVICE_ROLE_KEY); the client only ever gets the one-time hash.
const URL_ = process.env.VITE_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TOKEN_RE = /^[A-Za-z0-9_-]{10,64}$/;
const H = () => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' });

async function rpc(name, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${name}`, { method: 'POST', headers: H(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${name} ${r.status}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}
async function auth(path, method, body) {
  const r = await fetch(`${URL_}/auth/v1/${path}`, { method, headers: H(), body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const ready = !!(URL_ && SERVICE);

  if (req.method === 'GET' && req.query.check) { res.status(200).json({ ready }); return; }

  if (req.method === 'GET') {
    const t = String(req.query.t || '');
    if (!ready) { res.status(200).json({ state: 'setup' }); return; }
    if (!TOKEN_RE.test(t)) { res.status(200).json({ state: 'unknown' }); return; }
    try { res.status(200).json(await rpc('go_invite_peek', { p_token: t })); }
    catch (e) { console.error('[go] peek', e.message); res.status(502).json({ state: 'error' }); }
    return;
  }

  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  if (!ready) { res.status(503).json({ error: 'setup' }); return; }
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const t = String(body?.t || '');
  if (!TOKEN_RE.test(t)) { res.status(410).json({ error: 'expired' }); return; }

  let claimed = false;
  try {
    const who = await rpc('go_invite_claim', { p_token: t });
    if (!who || !who.email) { res.status(410).json({ error: 'expired' }); return; }
    claimed = true;

    // Which email signs in: the existing auth user's (if linked) else the staff email.
    let email = who.email;
    if (who.auth_user_id) {
      const u = await auth(`admin/users/${who.auth_user_id}`, 'GET');
      if (u.ok && u.data?.email) email = String(u.data.email).toLowerCase();
    } else {
      // First time: create the login. "already registered" just means it exists but was never linked (handled below).
      const c = await auth('admin/users', 'POST', { email, email_confirm: true });
      if (!c.ok && c.status !== 422) throw new Error(`create user ${c.status} ${c.data?.msg || c.data?.message || ''}`);
    }

    const g = await auth('admin/generate_link', 'POST', { type: 'magiclink', email });
    const hash = g.data?.hashed_token ?? g.data?.properties?.hashed_token;
    const uid = g.data?.id ?? g.data?.user?.id;
    if (!g.ok || !hash) throw new Error(`generate_link ${g.status} ${g.data?.msg || g.data?.message || ''}`);
    if (!who.auth_user_id && uid) await rpc('go_link_login', { p_staff: who.staff_id, p_uid: uid });

    res.status(200).json({ token_hash: hash, email });
  } catch (e) {
    console.error('[go]', e.message);
    if (claimed) { try { await rpc('go_invite_unclaim', { p_token: t }); } catch { /* best effort */ } }
    res.status(502).json({ error: 'failed' });
  }
}
