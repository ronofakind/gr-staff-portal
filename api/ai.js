// Nov 7 · AI plan step 1 · the hourly Claude task ↔ the app (migration 079).
//
//   GET  /api/ai?token=…            → { events: upcoming 60 days (id, date, title, venue, client, guests, dept, address), keys: dedupe keys of the last 14 days,
//                                      clients: [names], inbox_checked_at }   → used to match emails to events and skip ones already done
//   POST /api/ai { token, items:[…], checked:true }  → adds new items to "Waiting for your OK" (dedupe_key = no doubles) + stamps inbox_checked_at
//
// The token is ai_settings.token (only the admin and this endpoint can read it). Reads only email; never touches events or staff.
const URL_ = process.env.VITE_SUPABASE_URL;
const cleanKey = (v) => (v || '').replace(/^\s*[A-Z_]+\s*=\s*/, '').replace(/[\s"'“”‘’]/g, '');
const SERVICE = cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
const H = (extra = {}) => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...extra });
const get = async (path) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H() }); if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`); return r.json(); };
const KINDS = new Set(['count_change', 'time_change', 'address', 'new_event', 'cancel', 'question', 'other']);
const s = (v, n) => (v == null ? null : String(v).slice(0, n));

async function okToken(t) {
  if (!t || String(t).length < 20) return false;
  const rows = await get('ai_settings?id=eq.1&select=token');
  return rows[0]?.token === String(t);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !SERVICE) return res.status(503).json({ error: 'not set up' });
  try {
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) : {};
    const token = req.method === 'POST' ? body.token : req.query.token;
    if (!(await okToken(token))) return res.status(401).json({ error: 'bad token' });

    if (req.method === 'GET') {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      const until = new Date(Date.now() + 60 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const [evs, priv, items, clients, st] = await Promise.all([
        get(`events?event_date=gte.${today}&event_date=lte.${until}&select=id,event_date,title,address,guests,department,venues(name)&order=event_date`),
        get('event_private?select=event_id,clients(name)'),
        get(`ai_items?created_at=gte.${since}&select=dedupe_key`),
        get('clients?archived_at=is.null&select=name'),
        get('ai_settings?id=eq.1&select=inbox_checked_at'),
      ]);
      const cl = Object.fromEntries(priv.map((p) => [p.event_id, p.clients?.name ?? null]));
      return res.json({
        events: evs.map((e) => ({ id: e.id, date: e.event_date, title: e.title, venue: e.venues?.name ?? null, client: cl[e.id] ?? null,
          guests: e.guests ?? null, dept: e.department, address: e.address ?? null })),
        keys: items.map((i) => i.dedupe_key).filter(Boolean),
        clients: clients.map((c) => c.name),
        inbox_checked_at: st[0]?.inbox_checked_at ?? null,
      });
    }

    if (req.method === 'POST') {
      const list = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
      const rows = list.filter((i) => i && i.dedupe_key && i.who).map((i) => ({
        source: 'email', kind: KINDS.has(i.kind) ? i.kind : 'other', dedupe_key: s(i.dedupe_key, 200),
        event_id: /^[0-9a-f-]{36}$/i.test(i.event_id || '') ? i.event_id : null,
        who: s(i.who, 120), quote: s(i.quote, 400), event_hint: s(i.event_hint, 160), email_url: /^https:\/\/mail\.google\.com\//.test(i.email_url || '') ? s(i.email_url, 400) : null,
        lines: Array.isArray(i.lines) ? i.lines.slice(0, 6).map((l) => ({ label: s(l?.label, 40), old: s(l?.old, 120), new: s(l?.new, 160) })) : [],
        sure: i.sure !== false,
      }));
      let added = 0;
      if (rows.length) {
        const r = await fetch(`${URL_}/rest/v1/ai_items?on_conflict=dedupe_key`, { method: 'POST', headers: H({ Prefer: 'resolution=ignore-duplicates,return=representation' }), body: JSON.stringify(rows) });
        if (!r.ok) throw new Error(`insert ${r.status} ${(await r.text()).slice(0, 200)}`);
        added = (await r.json()).length;
      }
      if (body.checked) await fetch(`${URL_}/rest/v1/ai_settings?id=eq.1`, { method: 'PATCH', headers: H(), body: JSON.stringify({ inbox_checked_at: new Date().toISOString() }) });
      return res.json({ added, skipped: rows.length - added });
    }
    return res.status(405).json({ error: 'GET or POST' });
  } catch (e) {
    console.error('[ai]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
