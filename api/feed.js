// GET /api/feed?t=<calendar token> → the person's "G&R shifts" calendar (subscription, push 33b).
// iPhone subscribes with webcal://<host>/api/feed?t=…, Google with calendar.google.com/calendar/r?cid=<webcal url>.
// Only confirmed shifts with final details (RPC calendar_feed, SECURITY DEFINER, anon key, same pattern as api/cal.js).
// Each shift keeps UID = shift id, so a change updates the same entry and a cancel / decline drops it from the feed.
// Push 38: + meetings the person said Coming to (RPC calendar_feed_meetings, migration 043). UID = meeting id, so a new time /
// link updates the same entry, and Can't make it / a cancel drops it. Until 043 is applied the feed is shifts only.
const URL_ = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_KEY;

// Same uniform words as api/cal.js.
const UNIFORM = {
  white_shirt: 'White dress shirt + black tie', black_shirt: 'Black dress shirt + black tie',
  dress: 'Black cocktail dress', black_tshirt: 'Black T-shirt',
};
const ROLE = { MD: 'MD', W: 'Waiter', BUS: 'Busboy', BM: 'Bar manager', BT: 'Bartender', BB: 'Barback' };
const RED = '#9B2226'; // G&R red (suggested; the person can change it)

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** RFC 5545 folding at 75 octets, never inside a UTF-8 character (emojis in the notes). */
const fold = (line) => {
  const out = []; let cur = ''; let n = 0; const max = 74;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (n + b > (out.length ? max - 1 : max)) { out.push(cur); cur = ''; n = 0; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
};
const hm = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit' });
const roleOf = (s) => (s.role && !/^\d+$/.test(s.role) ? ROLE[s.role] || s.role : 'Waiter').replace(/^bar\s*-\s*/i, '');

function uniformLines(s) {
  const u = String(s.uniform || '');
  if (!u) return [];
  const base = u.startsWith('custom:') ? u.slice(7) : UNIFORM[u] || u;
  const items = [
    base,
    ...(u === 'dress' ? [] : ['Black dress pants (no jeans)']),
    'Black dress shoes (no running shoes)',
    ...(u === 'dress' || u === 'black_tshirt' ? [] : ['Black apron']),
    ...String(s.dress || '').split(/[\n,]+/).map((x) => x.trim()).filter((x) => x && !/shirt|tie\b|pants|shoes|apron|belt|dress\b/i.test(x)),
  ];
  return [`👔 UNIFORM: ${base.toUpperCase()}`, ...items.map((x) => `• ${x}`)];
}

function vevent(s, now) {
  const start = new Date(s.start);
  const end = new Date(start.getTime() + 3600e3); // Ronnie: every shift is a 1-hour block; end times vary
  const first = (s.md_name || '').split(' ')[0];
  const notes = [
    s.address && `📍 ${s.address}`,
    `🕔 Starts at ${hm(s.start)}. End times vary by event. Thanks!`,
    ...uniformLines(s),
    first && `📞 CONTACT: ${first}${s.md_phone ? ` · ${s.md_phone}` : ''}`,
    'Details, team and changes in the G&R app.',
  ].filter(Boolean);
  const seq = Math.max(0, Math.floor((new Date(s.updated || now).getTime() - Date.UTC(2026, 0, 1)) / 1000));
  return [
    'BEGIN:VEVENT',
    `UID:${s.uid}@gr-staff-portal`,
    `DTSTAMP:${stamp(now)}`,
    `LAST-MODIFIED:${stamp(s.updated || now)}`,
    `SEQUENCE:${seq}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    fold(`SUMMARY:${esc(`${s.venue} · G&R shift (${roleOf(s)})`)}`),
    fold(`LOCATION:${esc(s.address || s.venue)}`),
    fold(`DESCRIPTION:${esc(notes.join('\n'))}`),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:G&R shift tomorrow', 'TRIGGER:-P1D', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:G&R shift in 2 hours', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}

const PLACE = { teams: 'Microsoft Teams', zoom: 'Zoom' };
/** Push 38 · a meeting: real start and end, location = the Teams / Zoom link or the address, notes = what it's about + link. */
function mevent(m, now) {
  const link = /^https?:\/\//i.test(String(m.link || '').trim()) ? String(m.link).trim() : '';
  const where = m.place_kind === 'in_person' ? (m.address || 'In person') : (link || PLACE[m.place_kind] || 'Online');
  const notes = [
    m.about && String(m.about),
    m.place_kind === 'in_person' ? m.address && `📍 ${m.address}` : link ? `▶ Join on ${PLACE[m.place_kind] || 'the call'}: ${link}` : `${PLACE[m.place_kind] || 'Online'} · link in the G&R app`,
    'G&R meeting (paid). Notes and who is coming in the G&R app.',
  ].filter(Boolean);
  const seq = Math.max(0, Math.floor((new Date(m.updated || now).getTime() - Date.UTC(2026, 0, 1)) / 1000));
  return [
    'BEGIN:VEVENT',
    `UID:meeting-${m.uid}@gr-staff-portal`,
    `DTSTAMP:${stamp(now)}`,
    `LAST-MODIFIED:${stamp(m.updated || now)}`,
    `SEQUENCE:${seq}`,
    `DTSTART:${stamp(m.start)}`,
    `DTEND:${stamp(m.end)}`,
    fold(`SUMMARY:${esc(m.title)}`),
    fold(`LOCATION:${esc(where)}`),
    ...(link && m.place_kind !== 'in_person' ? [fold(`URL:${link}`)] : []),
    fold(`DESCRIPTION:${esc(notes.join('\n'))}`),
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:G&R meeting in 10 minutes', 'TRIGGER:-PT10M', 'END:VALARM',
    'END:VEVENT',
  ].join('\r\n');
}

export default async function handler(req, res) {
  const t = String(req.query.t || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(t) || !URL_ || !KEY) { res.status(404).send('Not found'); return; }
  const r = await fetch(`${URL_}/rest/v1/rpc/calendar_feed`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: t }),
  });
  const feed = r.ok ? await r.json() : null;
  if (!feed) { res.status(404).send('This calendar link is no longer active. Open the G&R app to add it again.'); return; }
  let meetings = [];
  try {
    const rm = await fetch(`${URL_}/rest/v1/rpc/calendar_feed_meetings`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: t }),
    });
    const mj = rm.ok ? await rm.json() : null; // 404 until migration 043 is applied
    if (Array.isArray(mj)) meetings = mj;
  } catch { /* shifts only */ }

  const now = Date.now();
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//G&R a votre service//Staff app shifts//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:G&R shifts', 'NAME:G&R shifts',
    fold(`X-WR-CALDESC:${esc('Your confirmed G&R shifts. Details, team and changes in the G&R app.')}`),
    'X-WR-TIMEZONE:America/Toronto',
    `X-APPLE-CALENDAR-COLOR:${RED}`, 'COLOR:darkred',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
    ...(Array.isArray(feed.shifts) ? feed.shifts : []).map((s) => vevent(s, now)),
    ...meetings.map((m) => mevent(m, now)),
    'END:VCALENDAR',
  ].join('\r\n') + '\r\n';

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="gr-shifts.ics"');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).send(ics);
}
