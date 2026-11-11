// GET /api/google/start (admin, Bearer) → { url } of the Google consent screen.
import { CID, REDIRECT, bearer, rpc } from '../_google.js';

export default async function handler(req, res) {
  // Native app (App Store / Google Play) calls from capacitor://localhost / https://localhost: allow it, answer preflight.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const jwt = bearer(req);
  if (!jwt || !CID) { res.status(401).json({ error: 'Not allowed' }); return; }
  const s = await rpc('google_begin', {}, jwt);
  if (!s.ok || !s.body) { res.status(403).json({ error: 'Admins only' }); return; }
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: CID, redirect_uri: REDIRECT, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive',
    access_type: 'offline', prompt: 'select_account consent', login_hint: 'gravotreservice@gmail.com', include_granted_scopes: 'true', state: s.body,
  });
  res.status(200).json({ url });
}
