// POST /api/drive/folder (admin, Bearer) { event_id, month, name } → creates EVENTS 2026 › <MONTH> › <name>, saves the link on the event.
import { EVENTS_ROOT, accessToken, bearer, findOrCreateFolder, sb } from '../_google.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  const jwt = bearer(req); const { event_id, month, name } = req.body || {};
  if (!jwt || !event_id || !month || !name) { res.status(400).json({ error: 'Missing details' }); return; }
  const token = await accessToken(jwt, null); // admins only
  if (!token) { res.status(403).json({ error: 'Google Drive is not connected (or you are not an admin)' }); return; }
  try {
    const m = await findOrCreateFolder(token, EVENTS_ROOT, String(month).toUpperCase());
    const f = await findOrCreateFolder(token, m.id, String(name).toUpperCase());
    const link = f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`;
    const ev = await sb(`events?id=eq.${encodeURIComponent(event_id)}&select=event_date,title`, jwt);
    const e = ev.body?.[0];
    if (e) await sb(`events?event_date=eq.${e.event_date}&title=eq.${encodeURIComponent(e.title)}&drive_folder_url=is.null`, jwt, { method: 'PATCH', body: JSON.stringify({ drive_folder_url: link }), headers: { Prefer: 'return=minimal' } });
    res.status(200).json({ url: link });
  } catch (err) { res.status(502).json({ error: String(err.message || err) }); }
}
