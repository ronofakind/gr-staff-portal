// GET /api/drive/files?event= (admin, or the event's MD/BM; Bearer) → files in the event's Drive folder.
// Files marked "Only you" are left out for managers.
import { accessToken, bearer, drive, folderIdOf, rpc, sb } from '../_google.js';

export default async function handler(req, res) {
  const jwt = bearer(req); const event = String(req.query.event || '');
  if (!jwt || !/^[0-9a-f-]{36}$/i.test(event)) { res.status(400).json({ files: [] }); return; }
  const ev = await sb(`events?id=eq.${event}&select=drive_folder_url`, jwt);
  const folder = folderIdOf(ev.body?.[0]?.drive_folder_url);
  if (!folder) { res.status(200).json({ files: [] }); return; }
  const token = await accessToken(jwt, event);
  if (!token) { res.status(200).json({ files: [] }); return; }
  try {
    const list = await drive(token, `files?${new URLSearchParams({ q: `'${folder}' in parents and trashed = false`, fields: 'files(id,name,webViewLink,modifiedTime,mimeType)', orderBy: 'folder,name', pageSize: '100', supportsAllDrives: 'true', includeItemsFromAllDrives: 'true' })}`);
    const [hid, st] = await Promise.all([sb(`event_files_hidden?event_id=eq.${event}&select=file_id`, jwt), rpc('google_status', {}, jwt)]);
    const hidden = new Set((hid.body || []).map((h) => h.file_id)); const admin = !!st.body;
    const files = (list.files || []).map((f) => ({ id: f.id, name: f.name, link: f.webViewLink, modified: f.modifiedTime, hidden: hidden.has(f.id) }))
      .filter((f) => admin || !f.hidden);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ files, admin });
  } catch (err) { res.status(200).json({ files: [], error: String(err.message || err) }); }
}
