// GET /api/google/callback?code&state — Google sends the admin back here; the refresh token is stored server-side only.
import { CID, SECRET, REDIRECT, keyHash, rpc } from '../_google.js';

export default async function handler(req, res) {
  const back = (msg) => { res.writeHead(302, { Location: '/admin/event/new?google=' + encodeURIComponent(msg) }); res.end(); };
  const { code, state, error } = req.query;
  if (error || !code || !state) return back('cancelled');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: String(code), client_id: CID, client_secret: SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
  const t = await r.json().catch(() => ({}));
  if (!t.access_token) return back('failed');
  const me = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((x) => x.json()).catch(() => ({}));
  const ok = await rpc('google_store', { p_state: String(state), p_email: me.user?.emailAddress || null, p_refresh: t.refresh_token || null, p_key_hash: keyHash() });
  return back(ok.ok && ok.body === true ? 'connected' : 'failed');
}
