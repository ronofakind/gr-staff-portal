// Nov 6 · read the exact spot from a Google Maps link (short share links too).
//   GET /api/pin?u=<link>  → { lat, lng, name? }  or { error }
// Short "maps.app.goo.gl" links only show the spot after Google redirects, which the browser can't follow
// (cross-site), so this follows the link here. Only Google Maps hosts are fetched.
const OK_HOST = /^(maps\.app\.goo\.gl|goo\.gl|(www\.|maps\.)?google\.[a-z.]+|consent\.google\.[a-z.]+)$/i;
const ok = (lat, lng) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
function read(s) {
  const t = decodeURIComponent(String(s || ''));
  const m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/[?&](?:q|ll|query|destination|center)=(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/)
    || t.match(/\/(?:place|search|dir\/[^/]*)\/(-?\d+\.\d+)\s*,\s*\+?\s*(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null; const lat = Number(m[1]); const lng = Number(m[2]);
  if (!ok(lat, lng)) return null;
  const n = t.match(/\/place\/([^/@]+)\//); const name = n && !/^-?\d/.test(n[1]) ? n[1].replace(/\+/g, ' ') : null;
  return { lat, lng, name };
}
export default async function handler(req, res) {
  // Native app (App Store / Google Play) calls from capacitor://localhost / https://localhost: allow it, answer preflight.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  res.setHeader('Cache-Control', 'no-store');
  const raw = String(req.query.u || '').trim().match(/https?:\/\/\S+/)?.[0];
  if (!raw) return res.status(200).json({ error: 'nolink' });
  let url = raw;
  try {
    const first = read(url); if (first && !/goo\.gl/i.test(url)) return res.status(200).json(first);
    for (let i = 0; i < 6; i++) {
      const h = new URL(url).hostname; if (!OK_HOST.test(h)) return res.status(200).json({ error: 'notgoogle' });
      const r = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', 'Accept-Language': 'en' } });
      const loc = r.headers.get('location');
      if (loc) { url = new URL(loc, url).toString(); const c = new URL(url).searchParams.get('continue'); const p = read(c || url); if (p) return res.status(200).json(p); continue; }
      const body = await r.text(); const p = read(url) || read(body.match(/https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s\\]+/)?.[0]) || read(body.match(/center=-?\d+\.\d+%2C-?\d+\.\d+/)?.[0]?.replace('%2C', ',').replace('center=', '?center='));
      return res.status(200).json(p || { error: 'nospot' });
    }
    return res.status(200).json({ error: 'nospot' });
  } catch { return res.status(200).json({ error: 'nospot' }); }
}
