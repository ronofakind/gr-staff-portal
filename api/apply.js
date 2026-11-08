// Nov 8 · push 55 (migration 082) · the public apply page → applications.
//
//   GET  /api/apply?r=<staff id>                     → { referrer: { id, first } | null }   (Refer-a-friend link; first name only)
//   POST /api/apply { action:'cv', name, type, size } → { path, token }   signed upload into the private "applications" bucket
//   POST /api/apply { action:'send', …fields }       → { ok, first } · { existing:true } when they're already G&R staff
//
// No login. Writes only the applications table + the CV bucket (service key). Nothing is texted or emailed to anyone.
import { randomUUID } from 'node:crypto';
const URL_ = process.env.VITE_SUPABASE_URL;
const cleanKey = (v) => (v || '').replace(/^\s*[A-Z_]+\s*=\s*/, '').replace(/[\s"'“”‘’]/g, '');
const SERVICE = cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
const H = (extra = {}) => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...extra });
const get = async (path) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H() }); if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`); return r.json(); };
const s = (v, n) => { const x = v == null ? '' : String(v).trim(); return x ? x.slice(0, n) : null; };
const UUID = /^[0-9a-f-]{36}$/i;
const digits = (p) => (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
const pick = (v, ok) => (Array.isArray(v) ? [...new Set(v.filter((x) => ok.includes(x)))] : []);
const TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'];
const ROLES = ['waiter', 'bartender', 'barback', 'cook', 'manager'];
const WORKED = ['fine_dining', 'banquets', 'catering', 'hotel', 'cocktail_bar', 'cafe', 'none'];
const YEARS = ['none', 'lt1', '1-2', '3-5', '5+'];
const DAYS = ['weekday_days', 'weekday_evenings', 'weekends', 'anytime'];

async function referrer(id) {
  if (!UUID.test(id || '')) return null;
  const r = await get(`staff?id=eq.${id}&active=eq.true&select=id,full_name,nickname`).catch(() => []);
  if (!r[0]) return null;
  return { id: r[0].id, first: (r[0].nickname || r[0].full_name || '').trim().split(/\s+/)[0] };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !SERVICE) return res.status(503).json({ error: 'not set up' });
  try {
    if (req.method === 'GET') return res.json({ referrer: await referrer(req.query.r) });
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
    if (b.website) return res.json({ ok: true, first: '' }); // honeypot

    if (b.action === 'cv') {
      if (!TYPES.includes(b.type)) return res.status(400).json({ error: 'type' });
      if (!(Number(b.size) > 0 && Number(b.size) <= 12 * 1024 * 1024)) return res.status(400).json({ error: 'size' });
      const ext = (String(b.name || '').match(/\.([a-z0-9]{2,5})$/i)?.[1] || b.type.split('/')[1] || 'pdf').toLowerCase().replace('jpeg', 'jpg');
      const path = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
      const r = await fetch(`${URL_}/storage/v1/object/upload/sign/applications/${path}`, { method: 'POST', headers: H(), body: '{}' });
      if (!r.ok) return res.status(502).json({ error: `upload ${r.status}` });
      const { url } = await r.json();
      const token = new URL(url, 'https://x').searchParams.get('token');
      return res.json({ path, token });
    }

    if (b.action !== 'send') return res.status(400).json({ error: 'action' });
    const first = s(b.first_name, 60), last = s(b.last_name, 60), email = s(b.email, 120)?.toLowerCase() ?? null, phone = s(b.phone, 30);
    if (!first || !last) return res.status(400).json({ error: 'name' });
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'email' });
    if (digits(phone).length < 10) return res.status(400).json({ error: 'phone' });
    if (b.adult !== true) return res.status(400).json({ error: 'adult' });
    if (!b.consent) return res.status(400).json({ error: 'consent' });
    const cvPath = /^\d{4}-\d{2}\/[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(b.cv_path || '') ? b.cv_path : null;
    if (!cvPath && !s(b.no_cv_note, 600)) return res.status(400).json({ error: 'cv' });

    // Already G&R staff → don't make an application, tell them to sign in.
    const staff = await get('staff?select=id,email,phone,active');
    const p = digits(phone);
    if (staff.some((x) => x.active && ((x.email && x.email.toLowerCase() === email) || (p && digits(x.phone) === p)))) return res.json({ existing: true });

    const ref = await referrer(b.referrer_id);
    const lv = (n) => ([1, 2, 3].includes(Number(n)) ? Number(n) : null);
    const row = {
      lang: b.lang === 'fr' ? 'fr' : 'en', first_name: first, last_name: last, email, phone, neighbourhood: s(b.neighbourhood, 80), adult: true,
      roles: pick(b.roles, ROLES), worked_in: pick(b.worked_in, WORKED), years: YEARS.includes(b.years) ? b.years : null,
      lang_fr: lv(b.lang_fr), lang_en: lv(b.lang_en), days: pick(b.days, DAYS), transport: ['car', 'transit'].includes(b.transport) ? b.transport : null,
      cv_path: cvPath, cv_name: cvPath ? s(b.cv_name, 120) : null, no_cv_note: s(b.no_cv_note, 600),
      referrer_id: ref?.id ?? null, referrer_text: ref ? null : s(b.referrer_text, 80), note: s(b.note, 600),
      consent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };

    // Same email or phone still open (new / kept) → update that one instead of a double.
    const open = await get('applications?status=in.(new,kept)&select=id,email,phone,cv_path');
    const dup = open.find((a) => (a.email && a.email.toLowerCase() === email) || (p && digits(a.phone) === p));
    if (dup && !row.cv_path) { row.cv_path = dup.cv_path; delete row.cv_name; }
    const r = dup
      ? await fetch(`${URL_}/rest/v1/applications?id=eq.${dup.id}`, { method: 'PATCH', headers: H({ Prefer: 'return=minimal' }), body: JSON.stringify(row) })
      : await fetch(`${URL_}/rest/v1/applications`, { method: 'POST', headers: H({ Prefer: 'return=minimal' }), body: JSON.stringify(row) });
    if (!r.ok) return res.status(502).json({ error: `save ${r.status}` });
    return res.json({ ok: true, first, updated: !!dup });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 200) });
  }
}
