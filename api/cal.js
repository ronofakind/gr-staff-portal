// GET /api/cal?t=<token> → .ics for one person's shift (opens Apple / Google / Outlook calendar).
const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_KEY;

const UNIFORM = {
  white_shirt: 'White dress shirt + black tie', black_shirt: 'Black dress shirt + black tie',
  dress: 'Black cocktail dress', black_tshirt: 'Black T-shirt',
};
const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const fold = (line) => { const out = []; let s = line; while (s.length > 73) { out.push(s.slice(0, 73)); s = ' ' + s.slice(73); } out.push(s); return out.join('\r\n'); };
const hm = (iso) => new Date(iso).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' });

export default async function handler(req, res) {
  const t = String(req.query.t || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(t) || !URL_ || !KEY) { res.status(404).send('Not found'); return; }
  const r = await fetch(`${URL_}/rest/v1/rpc/cal_event`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: t }),
  });
  const e = r.ok ? await r.json() : null;
  if (!e) { res.status(404).send('This shift is no longer on your schedule.'); return; }

  const start = new Date(e.start);
  const arrive = new Date(start.getTime() - (e.arrive_min ?? 15) * 60000);
  const end = e.end ? new Date(e.end) : new Date(start.getTime() + 6 * 3600e3);
  const lines = [
    e.time_tbc ? 'Time to be confirmed' : `Be there ${hm(arrive)} · shift starts ${hm(start)}`,
    e.role && `Position: ${e.role}`,
    e.uniform && `Wear: ${UNIFORM[e.uniform] || e.uniform}${e.dress ? ', ' + e.dress : ''}`,
    e.md_name && `Look for: ${e.md_name}${e.md_phone ? ' · ' + e.md_phone : ''}`,
    e.description && e.description,
    'Details: https://gr-staff-portal.vercel.app/me',
  ].filter(Boolean).join('\n');

  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//G&R a votre service//Staff app//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}@gr-staff-portal`, `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(arrive)}`, `DTEND:${stamp(end)}`,
    fold(`SUMMARY:${esc('G&R · ' + e.title)}`),
    fold(`LOCATION:${esc(e.address || e.venue)}`),
    fold(`DESCRIPTION:${esc(lines)}`),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:G&R shift', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="gr-${e.event_date}.ics"`);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(ics);
}
