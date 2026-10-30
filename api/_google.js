// Shared helpers for the Google Drive connection. The refresh token never leaves the server.
import crypto from 'node:crypto';

export const SB = process.env.VITE_SUPABASE_URL;
export const ANON = process.env.VITE_SUPABASE_KEY;
export const CID = process.env.GOOGLE_CLIENT_ID;
export const SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const REDIRECT = 'https://gr-staff-portal.vercel.app/api/google/callback';
export const EVENTS_ROOT = '1bkgZiaXnjhlNnjEVAbWUBM90SV3ccyoV'; // EVENTS 2026
export const keyHash = () => crypto.createHash('sha256').update('gr-drive:' + SECRET).digest('hex');

export const bearer = (req) => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7) : null; };

/** Call Supabase REST as the signed-in user (RLS applies). */
export async function sb(path, jwt, init = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${jwt || ANON}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await r.text(); let body = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: r.ok, status: r.status, body };
}
export const rpc = (fn, args, jwt) => sb(`rpc/${fn}`, jwt, { method: 'POST', body: JSON.stringify(args || {}) });

/** Google access token for this user (admin, or MD/BM of the event). Null if not allowed / not connected. */
export async function accessToken(jwt, eventId = null) {
  const t = await rpc('google_token', { p_key_hash: keyHash(), p_event: eventId }, jwt);
  if (!t.ok || !t.body) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CID, client_secret: SECRET, refresh_token: t.body, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  return j.access_token || null;
}

export async function drive(token, path, init = {}) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Drive ${r.status}`);
  return j;
}
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
export async function findOrCreateFolder(token, parent, name) {
  const found = await drive(token, `files?${new URLSearchParams({ q: `'${parent}' in parents and name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`, fields: 'files(id,webViewLink)', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`);
  if (found.files?.length) return found.files[0];
  return drive(token, 'files?fields=id,webViewLink&supportsAllDrives=true', { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
}
export const folderIdOf = (url) => (String(url || '').match(/folders\/([\w-]+)/) || String(url || '').match(/[?&]id=([\w-]+)/) || [])[1] || null;
