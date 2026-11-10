// Push 62 · G&R connector for Claude (board ClaudeConnectorV1). Remote MCP server (Streamable HTTP, JSON responses) + a small
// OAuth 2.1 server (PKCE, dynamic client registration) so Ronnie adds it once in Claude → Settings → Connectors and signs in
// with his G&R admin login. Runs inside /api/ai (Hobby plan = 12 functions max); routed by vercel.json rewrites:
//   /mcp                                         → ?mcp=rpc
//   /.well-known/oauth-protected-resource[/mcp]  → ?mcp=prm
//   /.well-known/oauth-authorization-server      → ?mcp=as
//   /oauth/register · /oauth/authorize · /oauth/token · /oauth/code → ?mcp=register|authorize|token|code
// Tokens are signed (HMAC from the service key), nothing stored. Only the admin (Ronnie) can get one.
// Writes always need confirm:true (Claude shows the preview and asks first). Never texts / emails staff, never deletes, no pay / QuickBooks.
import crypto from 'node:crypto';

const URL_ = process.env.VITE_SUPABASE_URL;
const cleanKey = (v) => (v || '').replace(/^\s*[A-Z_]+\s*=\s*/, '').replace(/[\s"'“”‘’]/g, '');
const SERVICE = cleanKey(process.env.SUPABASE_SERVICE_ROLE_KEY);
const H = (extra = {}) => ({ apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', ...extra });
const ONLY = '13791946-d8df-4146-b51e-0963f0324499'; // Ronnie (Nov 9: "only me")
const TZ = 'America/Toronto';

// ── REST helpers ──
const get = async (path) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: H() }); if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`); return r.json(); };
const post = async (table, body, prefer = 'return=representation') => { const r = await fetch(`${URL_}/rest/v1/${table}`, { method: 'POST', headers: H({ Prefer: prefer }), body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`); return prefer.includes('representation') ? r.json() : null; };
const patch = async (path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method: 'PATCH', headers: H({ Prefer: 'return=representation' }), body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${path.split('?')[0]}: ${r.status} ${await r.text()}`); return r.json(); };
const log = (entity, entity_id, change) => post('change_log', { by_staff: ONLY, entity, entity_id, change: { via: 'claude', ...change } }, 'return=minimal').catch(() => {});
const enc = encodeURIComponent;

// ── signed tokens ──
const KEY = () => crypto.createHash('sha256').update('gr-mcp:' + SERVICE).digest();
const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = (obj) => { const p = b64u(JSON.stringify(obj)); return p + '.' + crypto.createHmac('sha256', KEY()).update(p).digest('base64url'); };
const verify = (tok, kind) => {
  try {
    const [p, s] = String(tok || '').split('.'); if (!p || !s) return null;
    const want = crypto.createHmac('sha256', KEY()).update(p).digest('base64url');
    if (s.length !== want.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want))) return null;
    const o = JSON.parse(Buffer.from(p, 'base64url').toString()); if (o.t !== kind || o.exp < Date.now() / 1000 || o.sub !== ONLY) return null; return o;
  } catch { return null; }
};
const okRedirect = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && /(^|\.)claude\.(ai|com)$/.test(x.hostname); } catch { return false; } };

// ── time helpers (Montreal) ──
const offsetOf = (date) => { const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' }).formatToParts(new Date(`${date}T17:00:00Z`)).find((x) => x.type === 'timeZoneName')?.value || 'GMT-5'; const m = f.match(/GMT([+-]\d+)(?::(\d+))?/); const h = m ? Number(m[1]) : -5; return `${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:${m?.[2] || '00'}`; };
const startIso = (date, hm) => new Date(`${date}T${(hm || '17:00').slice(0, 5)}:00${offsetOf(date)}`).toISOString();
const todayMtl = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dLabel = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const hm12 = (t) => { if (!t) return 'TBC'; const [h, m] = t.slice(0, 5).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const parseHM = (s) => { if (!s) return null; const t = String(s).trim().toLowerCase(); if (t === 'tbc') return 'TBC'; const m = t.match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/); if (!m) return null; let h = Number(m[1]); const mi = Number(m[2] || 0); if (m[3]?.startsWith('p') && h < 12) h += 12; if (m[3]?.startsWith('a') && h === 12) h = 0; if (!m[3] && h >= 1 && h <= 7) h += 12; return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null; };

const ROLE = { MD: ['floor', 'MD'], W: ['floor', 'Waiter'], BUS: ['floor', 'Busboy'], BM: ['bar', 'Bar manager'], BT: ['bar', 'Bartender'], BB: ['bar', 'Barback'], WW: ['bar', 'Wine waiter'] };
const ROLE_ALIASES = { md: 'MD', manager: 'MD', w: 'W', waiter: 'W', waiters: 'W', server: 'W', bus: 'BUS', busboy: 'BUS', busboys: 'BUS', bm: 'BM', 'bar manager': 'BM', bt: 'BT', bartender: 'BT', bartenders: 'BT', bb: 'BB', barback: 'BB', barbacks: 'BB', ww: 'WW', 'wine waiter': 'WW', 'wine waiters': 'WW', wine: 'WW' };
const roleCode = (r) => ROLE[String(r || '').toUpperCase()] ? String(r).toUpperCase() : ROLE_ALIASES[String(r || '').toLowerCase().trim()] || null;
const liveShift = (s) => !s.cancelled_at && s.status !== 'cancelled' && s.status !== 'declined' && !s.attendance;

// ── tools ──
const TOOLS = [
  { name: 'today', description: "G&R today: tonight's events (booked / needed), events in the next 5 days that are short, and events missing info from the client. Read only.", inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, title: 'What needs me today' } },
  { name: 'find_event', description: 'Find G&R events by date and/or words in the venue / title. Returns each event with its id, staffing lines, booked names and what is still short. Read only. Use the id for update_event / book_staff.', inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD (optional)' }, to_date: { type: 'string', description: 'YYYY-MM-DD, for a range (optional)' }, query: { type: 'string', description: 'venue or title words (optional)' } } }, annotations: { readOnlyHint: true, title: 'Find event' } },
  { name: 'whos_free', description: 'Who said yes / is waiting for a date, best ranked first, and who is already booked that day. People marked ⌖ only work in those areas: don\'t suggest them for events elsewhere unless the event is 3 days out or less. Read only.', inputSchema: { type: 'object', required: ['date'], properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, dept: { type: 'string', enum: ['floor', 'bar', 'all'], description: 'default floor' } } }, annotations: { readOnlyHint: true, title: "Who's free" } },
  { name: 'add_event', description: 'Create a G&R event in the app (app only, not the Events sheet). ALWAYS call first with confirm=false, show Ronnie the preview, and only call again with confirm=true after he says yes. Roles: MD, W (waiter), BUS (busboy), BM (bar manager), BT (bartender), BB (barback), WW (wine waiter: floor staff billed on the bar). Start "HH:MM" 24h or "TBC". Floor and bar lines become two events (two invoices), like the app.', inputSchema: { type: 'object', required: ['date', 'venue', 'lines', 'confirm'], properties: { date: { type: 'string', description: 'YYYY-MM-DD' }, venue: { type: 'string', description: 'venue name (matched to saved venues) or "TBC"' }, client: { type: 'string' }, guests: { type: 'integer' }, event_type: { type: 'string' }, status: { type: 'string', enum: ['confirmed', 'tbc'], description: 'default confirmed' }, note: { type: 'string', description: 'event note (only Ronnie sees)' }, lines: { type: 'array', items: { type: 'object', required: ['role', 'count'], properties: { role: { type: 'string' }, count: { type: 'integer' }, start: { type: 'string' } } } }, confirm: { type: 'boolean' } } }, annotations: { destructiveHint: false, title: 'Add event' } },
  { name: 'update_event', description: 'Change an event: guests, confirmed / to be confirmed, address, end, note, or one start time for every line (only while nobody is booked or the time is TBC). Call with confirm=false first, show the change, confirm=true after Ronnie says yes. Never deletes.', inputSchema: { type: 'object', required: ['event_id', 'confirm'], properties: { event_id: { type: 'string' }, guests: { type: 'integer' }, status: { type: 'string', enum: ['confirmed', 'tbc'] }, address: { type: 'string' }, ends: { type: 'string', description: 'e.g. "~ midnight", "~ 11 PM"' }, note: { type: 'string' }, start: { type: 'string', description: 'HH:MM or TBC' }, confirm: { type: 'boolean' } } }, annotations: { destructiveHint: false, title: 'Update event' } },
  { name: 'add_staff', description: 'Add a new staff profile (active, no invite sent: Ronnie sends the invite from the app). Call with confirm=false first, confirm=true after Ronnie says yes.', inputSchema: { type: 'object', required: ['full_name', 'confirm'], properties: { full_name: { type: 'string' }, phone: { type: 'string' }, email: { type: 'string' }, department: { type: 'string', enum: ['floor', 'bar'] }, positions: { type: 'array', items: { type: 'string' } }, neighbourhood: { type: 'string' }, confirm: { type: 'boolean' } } }, annotations: { destructiveHint: false, title: 'Add staff' } },
  { name: 'book_staff', description: 'Book a staff member on an event line (status booked, nothing is sent to them; confirmations go out from the app). Warns if they work elsewhere that day or said no. Call with confirm=false first, confirm=true after Ronnie says yes.', inputSchema: { type: 'object', required: ['event_id', 'staff_name', 'confirm'], properties: { event_id: { type: 'string' }, staff_name: { type: 'string' }, role: { type: 'string', description: 'default W on floor, BT on bar' }, start: { type: 'string', description: 'HH:MM, default the line / event start' }, confirm: { type: 'boolean' } } }, annotations: { destructiveHint: false, title: 'Book staff' } },
  { name: 'change_role', description: 'Change the role of someone already booked on an event, e.g. make a waiter the MD (or the MD back to a waiter), optionally with a new start time. Nothing is sent to them. Call with confirm=false first, confirm=true after Ronnie says yes.', inputSchema: { type: 'object', required: ['event_id', 'staff_name', 'role', 'confirm'], properties: { event_id: { type: 'string' }, staff_name: { type: 'string' }, role: { type: 'string', description: 'MD, W, BUS, BM, BT, BB or WW' }, start: { type: 'string', description: 'HH:MM, optional (default: keep their time)' }, confirm: { type: 'boolean' } } }, annotations: { destructiveHint: false, title: 'Change role' } },
];

const EV_COLS = 'id,event_date,title,department,start_time,staff_needed,staffing,guests,event_type,tentative,start_tbc,details_pending,address,ends_label,shifts(id,staff_id,position_code,planned_start,status,cancelled_at,attendance,notified_at,staff!shifts_staff_id_fkey(full_name))';
const fmtEvent = (e) => {
  const live = (e.shifts || []).filter(liveShift);
  const lines = (e.staffing || []).map((l) => { const n = live.filter((s) => (s.position_code || 'W') === l.code).length; return `  · ${l.count} ${ROLE[l.code]?.[1] || l.code} ${l.tbc || e.start_tbc ? 'TBC' : hm12(l.start)} — ${Math.min(n, l.count)}/${l.count}${n < l.count ? ` (short ${l.count - n})` : ''}`; });
  const names = live.map((s) => `${s.staff?.full_name || '?'} (${s.position_code || 'W'})`).join(', ');
  return `${dLabel(e.event_date)} · ${e.title}${e.department === 'bar' ? ' · BAR' : ''}${e.tentative ? ' · to be confirmed' : ''}${e.details_pending ? ' · venue to come' : ''} · id ${e.id}\n  ${live.length}/${e.staff_needed || 0} booked · start ${e.start_tbc ? 'TBC' : hm12(e.start_time)}${e.guests ? ` · ${e.guests} guests` : ''}${e.event_type ? ` · ${e.event_type}` : ''}\n${lines.join('\n')}${names ? `\n  Booked: ${names}` : ''}`;
};

async function tool(name, a) {
  const today = todayMtl();
  if (name === 'today') {
    const evs = await get(`events?event_date=gte.${today}&event_date=lte.${addDays(today, 5)}&select=${EV_COLS}&order=event_date,start_time`);
    const tonight = evs.filter((e) => e.event_date === today);
    const short = evs.filter((e) => e.event_date !== today && (e.shifts || []).filter(liveShift).length < (e.staff_needed || 0));
    const miss = evs.filter((e) => e.start_tbc || e.details_pending);
    return [`Today is ${dLabel(today)} (${today}).`, tonight.length ? `TONIGHT\n${tonight.map(fmtEvent).join('\n')}` : 'Nothing tonight.',
      short.length ? `SHORT · next 5 days\n${short.map((e) => `· ${dLabel(e.event_date)} ${e.title}${e.department === 'bar' ? ' (bar)' : ''}: ${(e.shifts || []).filter(liveShift).length}/${e.staff_needed} (id ${e.id})`).join('\n')}` : 'Nothing short in the next 5 days.',
      miss.length ? `MISSING FROM THE CLIENT\n${miss.map((e) => `· ${dLabel(e.event_date)} ${e.title}: ${[e.start_tbc && 'start times', e.details_pending && 'venue'].filter(Boolean).join(', ')}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
  }
  if (name === 'find_event') {
    let q = `events?select=${EV_COLS}&order=event_date,start_time&limit=25`;
    if (a.date) q += `&event_date=gte.${a.date}&event_date=lte.${a.to_date || a.date}`; else q += `&event_date=gte.${today}`;
    if (a.query) q += `&title=ilike.*${enc(String(a.query).replace(/[*,()]/g, ' ').trim())}*`;
    const evs = await get(q);
    return evs.length ? evs.map(fmtEvent).join('\n\n') : 'No event found.';
  }
  if (name === 'whos_free') {
    const dept = a.dept || 'floor';
    const [av, booked, staff] = await Promise.all([
      get(`availability?for_date=eq.${a.date}&select=staff_id,status,from_time,until_time`),
      get(`shifts?select=staff_id,status,cancelled_at,events!inner(event_date,title)&events.event_date=eq.${a.date}`),
      get('staff?active=eq.true&deleted_at=is.null&role=neq.admin&select=id,full_name,department,positions,staff_private!staff_private_staff_id_fkey(tier,ranking)'),
    ]);
    const areaRule = Object.fromEntries((await get('staff_conditions?kind=eq.areas&select=staff_id,value').catch(() => [])).map((c) => [c.staff_id, String(c.value || '').split('|').filter(Boolean)])); // push 63
    const by = Object.fromEntries(staff.map((s) => [s.id, s]));
    const busy = new Map(); for (const b of booked) if (!b.cancelled_at && b.status !== 'cancelled' && b.status !== 'declined') busy.set(b.staff_id, b.events?.title);
    const fit = (s) => dept === 'all' || (dept === 'bar' ? s.department === 'bar' || (s.positions || []).some((p) => /^(BT|BB|BM)$/i.test(p)) : s.department !== 'bar');
    const rank = (s) => [s.staff_private?.tier || 'Z', s.staff_private?.ranking ?? 9999];
    const sort = (x, y) => { const [ta, ra] = rank(x); const [tb, rb] = rank(y); return ta.localeCompare(tb) || ra - rb; };
    const pick = (st) => av.filter((r) => r.status === st && by[r.staff_id] && fit(by[r.staff_id]) && !busy.has(r.staff_id)).map((r) => ({ s: by[r.staff_id], r })).sort((x, y) => sort(x.s, y.s));
    const line = ({ s, r }) => `· ${s.full_name} — ${s.staff_private?.tier || 'unranked'}${areaRule[s.id] ? ` · ⌖ only ${areaRule[s.id].join(', ')}` : ''}${r.from_time ? ` · from ${hm12(r.from_time)}` : ''}${r.until_time ? ` · until ${hm12(r.until_time)}` : ''}`;
    const yes = pick('yes'); const asked = pick('asked');
    const bk = [...busy.entries()].filter(([id]) => by[id] && fit(by[id])).map(([id, t]) => `· ${by[id].full_name} — ${t}`);
    return [`${dLabel(a.date)} · ${dept}`, `SAID YES · free (${yes.length})\n${yes.slice(0, 30).map(line).join('\n') || '—'}`, asked.length ? `ASKED · no answer yet (${asked.length})\n${asked.slice(0, 20).map(line).join('\n')}` : '', bk.length ? `ALREADY BOOKED THAT DAY (${bk.length})\n${bk.join('\n')}` : ''].filter(Boolean).join('\n\n');
  }
  if (name === 'add_event') {
    const lines = [];
    for (const l of a.lines || []) {
      const code = roleCode(l.role); if (!code) return `Unknown role "${l.role}". Use MD, W, BUS, BM, BT, BB or WW.`;
      const st = l.start ? parseHM(l.start) : 'TBC'; if (!st) return `I can't read the start time "${l.start}". Use HH:MM (24h) or TBC.`;
      const n = Math.max(0, Math.round(Number(l.count) || 0)); if (n) lines.push({ dept: ROLE[code][0], code, start: st === 'TBC' ? '17:00' : st, count: n, ...(st === 'TBC' ? { tbc: true } : {}) });
    }
    if (!lines.length) return 'Give at least one staffing line (e.g. 1 MD, 9 W at 10:00).';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) return 'Date must be YYYY-MM-DD.';
    const vq = String(a.venue || '').trim(); const tbcVenue = !vq || /^tbc|to come|unknown$/i.test(vq);
    const venues = tbcVenue ? [] : await get(`venues?archived_at=is.null&name=ilike.*${enc(vq.replace(/[*,()]/g, ' '))}*&select=id,name,address,usual_client_id,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items&limit=5`);
    const venue = venues.find((v) => v.name.toLowerCase() === vq.toLowerCase()) || (venues.length === 1 ? venues[0] : null);
    if (!tbcVenue && !venue && venues.length > 1) return `Which venue? ${venues.map((v) => v.name).join(' · ')}`;
    let client = null;
    if (a.client) { const cs = await get(`clients?name=ilike.*${enc(String(a.client).replace(/[*,()]/g, ' '))}*&select=id,name&limit=5`); client = cs.find((c) => c.name.toLowerCase() === String(a.client).toLowerCase()) || (cs.length === 1 ? cs[0] : null); if (!client && cs.length > 1) return `Which client? ${cs.map((c) => c.name).join(' · ')}`; }
    else if (venue?.usual_client_id) { client = (await get(`clients?id=eq.${venue.usual_client_id}&select=id,name`))[0] || null; }
    const title = tbcVenue ? 'Details to come' : venue?.name || vq;
    const same = await get(`events?event_date=eq.${a.date}&title=ilike.${enc(title)}&select=id,department`);
    const depts = [...new Set(lines.map((l) => l.dept))];
    const dup = same.filter((e) => depts.includes(e.department));
    const preview = `${dLabel(a.date)} · ${title}${venue ? '' : tbcVenue ? '' : ' (new venue)'} · ${a.status === 'tbc' ? 'to be confirmed' : 'confirmed'}${client ? ` · client ${client.name}` : ''}${a.guests ? ` · ${a.guests} guests` : ''}${a.event_type ? ` · ${a.event_type}` : ''}\n${lines.map((l) => `· ${l.count} ${ROLE[l.code][1]} · ${l.tbc ? 'TBC' : hm12(l.start)}${l.code === 'WW' ? ' (bar bill)' : ''}`).join('\n')}${depts.length > 1 ? '\nFloor and bar = two events (two invoices).' : ''}${dup.length ? `\n⚠ Already in the app that day: ${title} (${dup.map((e) => e.department).join(', ')}, id ${dup.map((e) => e.id).join(', ')}).` : ''}`;
    if (!a.confirm) return `PREVIEW · nothing created yet\n${preview}\n\nShow this to Ronnie. Call add_event again with confirm=true only after he says yes.`;
    if (dup.length) return `Not created: ${title} already exists that day for ${dup.map((e) => e.department).join(' + ')} (id ${dup.map((e) => e.id).join(', ')}). Use update_event, or change it in the app.`;
    const ids = [];
    for (const dept of depts) {
      const ls = lines.filter((l) => l.dept === dept); const tb = ls.some((l) => l.tbc);
      const row = { event_date: a.date, title, venue_id: venue?.id ?? null, details_pending: tbcVenue, tentative: a.status === 'tbc', start_tbc: tb && !tbcVenue, address: venue?.address ?? null, department: dept,
        start_time: ls.map((l) => l.start).sort()[0], end_time: null, ends_label: '~ midnight', staff_needed: ls.reduce((n, l) => n + l.count, 0), description: a.note || null,
        uniform_floor: venue?.uniform_floor ?? (depts.length > 1 ? 'black_shirt' : 'white_shirt'), uniform_bar: venue?.uniform_bar ?? 'black_shirt', uniform_floor_w: venue?.uniform_floor_w ?? venue?.uniform_floor ?? (depts.length > 1 ? 'black_shirt' : 'white_shirt'), uniform_bar_w: venue?.uniform_bar_w ?? 'dress', uniform_items: venue?.uniform_items ?? {},
        staffing: ls, guests: a.guests ?? null, event_type: a.event_type || null, extras_billing: 'client' };
      const [ev] = await post('events', row);
      await post('event_private', { event_id: ev.id, client: client?.name ?? null, client_id: client?.id ?? null, pay_method: 'invoice' }, 'return=minimal');
      await log('event', ev.id, { action: 'created', summary: preview.split('\n')[0] });
      ids.push(`${dept} ${ev.id}`);
    }
    return `Created in the app ✓\n${preview}\nIds: ${ids.join(' · ')}\nNothing was sent to staff. Book people or ask availability in the app (or with book_staff).`;
  }
  if (name === 'update_event') {
    const [e] = await get(`events?id=eq.${enc(a.event_id)}&select=${EV_COLS}`); if (!e) return 'No event with that id. Use find_event first.';
    const ch = {}; const say = [];
    if (a.guests != null) { ch.guests = Math.round(a.guests); say.push(`guests ${e.guests ?? '—'} → ${ch.guests}`); }
    if (a.status) { ch.tentative = a.status === 'tbc'; say.push(a.status === 'tbc' ? 'now to be confirmed' : 'now confirmed'); }
    if (a.address) { ch.address = a.address; say.push(`address → ${a.address}`); }
    if (a.ends) { ch.ends_label = a.ends; say.push(`ends ${e.ends_label || '—'} → ${a.ends}`); }
    if (a.note != null) { ch.description = a.note || null; say.push('note updated'); }
    if (a.start) {
      const st = parseHM(a.start); if (!st) return `I can't read "${a.start}". Use HH:MM (24h) or TBC.`;
      const live = (e.shifts || []).filter(liveShift);
      if (live.length && !e.start_tbc) return `Not changed: ${live.length} people are booked on ${e.title}. Change the start time in the app so the right people get the change message.`;
      if (st === 'TBC') { ch.start_tbc = true; ch.staffing = (e.staffing || []).map((l) => ({ ...l, tbc: true })); say.push('start → TBC'); }
      else { ch.start_tbc = false; ch.start_time = st; ch.staffing = (e.staffing || []).map((l) => { const { tbc, ...r } = l; void tbc; return { ...r, start: st }; }); say.push(`start → ${hm12(st)} (every line)`); }
    }
    if (!say.length) return 'Nothing to change.';
    const head = `${dLabel(e.event_date)} · ${e.title}${e.department === 'bar' ? ' (bar)' : ''}`;
    if (!a.confirm) return `PREVIEW · nothing changed yet\n${head}\n· ${say.join('\n· ')}\n\nShow this to Ronnie. Call update_event again with confirm=true only after he says yes.`;
    await patch(`events?id=eq.${e.id}`, ch);
    if (ch.start_time && !(e.shifts || []).some(liveShift)) { /* nobody booked: nothing else to move */ }
    if ('start_tbc' in ch) await patch(`shifts?event_id=eq.${e.id}`, { time_tbc: !!ch.start_tbc }).catch(() => {});
    await log('event', e.id, { action: 'updated', changes: say });
    return `Updated ✓ ${head}\n· ${say.join('\n· ')}\nNothing was sent to staff.`;
  }
  if (name === 'add_staff') {
    const nm = String(a.full_name || '').trim().replace(/\s+/g, ' '); if (nm.split(' ').length < 2) return 'Give first and last name.';
    const dg = (p) => String(p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const all = await get('staff?select=id,full_name,email,phone,active,deleted_at');
    const twin = all.find((s) => s.full_name.toLowerCase() === nm.toLowerCase() || (a.email && s.email && s.email.toLowerCase() === a.email.toLowerCase()) || (dg(a.phone) && dg(s.phone) === dg(a.phone)));
    const pos = (a.positions || []).map((p) => roleCode(p) || p).filter(Boolean);
    const preview = `${nm}${a.phone ? ` · ${a.phone}` : ''}${a.email ? ` · ${a.email}` : ''} · ${a.department || 'floor'}${pos.length ? ` · ${pos.join(', ')}` : ''}${a.neighbourhood ? ` · ${a.neighbourhood}` : ''}`;
    if (twin) return `Already in the app: ${twin.full_name}${twin.active ? '' : ' (inactive)'} (id ${twin.id}). Not added.`;
    if (!a.confirm) return `PREVIEW · nothing created yet\nNew staff: ${preview}\nNo invite is sent; Ronnie sends it from the app.\n\nCall add_staff again with confirm=true only after he says yes.`;
    const [s] = await post('staff', { full_name: nm, phone: a.phone || null, email: a.email ? a.email.toLowerCase() : null, department: a.department || 'floor', positions: pos.length ? pos : null, role: 'staff', active: true });
    if (a.neighbourhood) await post('staff_private', { staff_id: s.id, neighbourhood: a.neighbourhood }, 'return=minimal').catch(() => {});
    await log('staff', s.id, { action: 'created', name: nm });
    return `Added ✓ ${preview} (id ${s.id})\nNo invite sent. Open Staff in the app to set the tier and rate and send the invite.`;
  }
  if (name === 'book_staff') {
    const [e] = await get(`events?id=eq.${enc(a.event_id)}&select=${EV_COLS}`); if (!e) return 'No event with that id. Use find_event first.';
    const q = String(a.staff_name || '').trim(); if (q.length < 2) return 'Who?';
    const cand = await get(`staff?active=eq.true&deleted_at=is.null&full_name=ilike.*${enc(q.replace(/[*,()]/g, ' ').replace(/\s+/g, '*'))}*&select=id,full_name,department&limit=6`);
    if (!cand.length) return `No active staff matching "${q}".`;
    if (cand.length > 1 && !cand.some((c) => c.full_name.toLowerCase() === q.toLowerCase())) return `Which one? ${cand.map((c) => c.full_name).join(' · ')}`;
    const s = cand.find((c) => c.full_name.toLowerCase() === q.toLowerCase()) || cand[0];
    const code = roleCode(a.role) || (e.department === 'bar' ? 'BT' : 'W');
    const line = (e.staffing || []).find((l) => l.code === code);
    const st = a.start ? parseHM(a.start) : (line?.start || e.start_time?.slice(0, 5) || '17:00'); if (!st || st === 'TBC') return 'Give a start time HH:MM (or leave it out to use the line time).';
    const live = (e.shifts || []).filter(liveShift);
    if (live.some((x) => x.staff_id === s.id)) return `${s.full_name} is already on ${e.title}.`;
    const [other, av] = await Promise.all([
      get(`shifts?staff_id=eq.${s.id}&select=status,cancelled_at,events!inner(event_date,title)&events.event_date=eq.${e.event_date}`),
      get(`availability?staff_id=eq.${s.id}&for_date=eq.${e.event_date}&select=status`),
    ]);
    const warn = [...other.filter((x) => !x.cancelled_at && x.status !== 'cancelled' && x.status !== 'declined').map((x) => `also on ${x.events.title} that day`), ...(av[0]?.status === 'no' ? ['said NO for that date'] : [])];
    const n = live.filter((x) => (x.position_code || 'W') === code).length;
    const preview = `${s.full_name} → ${dLabel(e.event_date)} ${e.title}${e.department === 'bar' ? ' (bar)' : ''} · ${ROLE[code]?.[1] || code} · ${hm12(st)}${line ? ` · line ${n}/${line.count}${n >= line.count ? ' (full: this one is an extra)' : ''}` : ''}${warn.length ? `\n⚠ ${warn.join(' · ')}` : ''}`;
    if (!a.confirm) return `PREVIEW · nothing booked yet\n${preview}\nNothing is sent to them; confirmations go out from the app.\n\nCall book_staff again with confirm=true only after Ronnie says yes.`;
    const [sh] = await post('shifts', { event_id: e.id, staff_id: s.id, position_code: code, position_detail: code === 'W' ? 'Waiter' : null, planned_start: startIso(e.event_date, st), status: 'booked', time_tbc: !!e.start_tbc || !!e.details_pending, added_by: ONLY, added_note: 'via Claude' });
    await log('shift', sh.id, { action: 'booked', staff: s.full_name, event: e.title, date: e.event_date });
    return `Booked ✓ ${preview}\nNothing was sent to ${s.full_name.split(' ')[0]}.`;
  }
  if (name === 'change_role') {
    const [e] = await get(`events?id=eq.${enc(a.event_id)}&select=${EV_COLS}`); if (!e) return 'No event with that id. Use find_event first.';
    const code = roleCode(a.role); if (!code) return `Unknown role "${a.role}". Use MD, W, BUS, BM, BT, BB or WW.`;
    const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const live = (e.shifts || []).filter(liveShift); const q = norm(a.staff_name);
    const hits = live.filter((s) => norm(s.staff?.full_name).includes(q) || q.split(/\s+/).every((w) => norm(s.staff?.full_name).includes(w)));
    if (!hits.length) return `Nobody matching "${a.staff_name}" is booked on ${e.title}. Booked: ${live.map((s) => s.staff?.full_name).join(', ') || 'nobody'}.`;
    if (hits.length > 1) return `Which one? ${hits.map((s) => s.staff?.full_name).join(' · ')}`;
    const sh = hits[0]; const from = sh.position_code || 'W';
    const st = a.start ? parseHM(a.start) : null; if (a.start && (!st || st === 'TBC')) return 'Give the start as HH:MM, or leave it out to keep their time.';
    const curStart = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(sh.planned_start));
    const leads = live.filter((s) => s.id !== sh.id && (s.position_code || 'W') === code && (code === 'MD' || code === 'BM'));
    const line = (e.staffing || []).find((l) => l.code === code);
    const preview = `${dLabel(e.event_date)} · ${e.title}${e.department === 'bar' ? ' (bar)' : ''}\n${sh.staff?.full_name}: ${ROLE[from]?.[1] || from} → ${ROLE[code][1]}${st ? ` · start ${hm12(curStart)} → ${hm12(st)}` : ` · keeps ${hm12(curStart)}`}${leads.length ? `\n⚠ Already ${ROLE[code][1]}: ${leads.map((s) => s.staff?.full_name).join(', ')}${line ? ` (line needs ${line.count})` : ''}` : ''}${!line ? `\nNote: the event has no ${ROLE[code][1]} line; it will show as an extra on that role.` : ''}`;
    if (!a.confirm) return `PREVIEW · nothing changed yet\n${preview}\nNothing is sent to them.\n\nCall change_role again with confirm=true only after Ronnie says yes.`;
    const upd = { position_code: code, position_detail: ROLE[code][1], ...(st ? { planned_start: startIso(e.event_date, st) } : {}) };
    await patch(`shifts?id=eq.${sh.id}`, upd);
    await log('shift', sh.id, { action: 'role', staff: sh.staff?.full_name, from, to: code, ...(st ? { start: st } : {}), event: e.title, date: e.event_date });
    return `Done ✓ ${preview}\nNothing was sent to ${String(sh.staff?.full_name || '').split(' ')[0]}.`;
  }
  return `Unknown tool ${name}`;
}

// ── HTTP ──
const base = (req) => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
const form = (req) => { const b = req.body; if (!b) return {}; if (typeof b === 'string') return Object.fromEntries(new URLSearchParams(b)); return b; };

export async function mcpHandler(req, res) {
  const op = String(req.query.mcp);
  const B = base(req);
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id'); res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (op === 'prm') return res.json({ resource: `${B}/mcp`, authorization_servers: [B], bearer_methods_supported: ['header'], resource_name: 'G&R à votre service' });
  if (op === 'as') return res.json({ issuer: B, authorization_endpoint: `${B}/oauth/authorize`, token_endpoint: `${B}/oauth/token`, registration_endpoint: `${B}/oauth/register`,
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['gr'] });
  if (op === 'register') {
    const b = form(req); const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
    if (!uris.length || !uris.every(okRedirect)) return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'Only Claude can connect.' });
    return res.status(201).json({ client_id: 'claude-' + crypto.randomBytes(8).toString('hex'), client_id_issued_at: Math.floor(Date.now() / 1000), redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_name: b.client_name || 'Claude' });
  }
  if (op === 'authorize') { // → the app's sign-in-protected "Allow Claude?" page
    const q = new URLSearchParams(req.query); q.delete('mcp');
    if (!okRedirect(q.get('redirect_uri') || '') || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return res.status(400).send('Bad request: only Claude can connect (PKCE S256).');
    res.setHeader('Location', `/connect-claude?${q}`); return res.status(302).end();
  }
  if (op === 'code') { // POST from /connect-claude with the signed-in admin's session
    if (req.method !== 'POST') return res.status(405).end();
    const b = form(req);
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SERVICE, Authorization: `Bearer ${b.access_token}` } });
    if (!u.ok) return res.status(401).json({ error: 'Sign in to the G&R app first.' });
    const uid = (await u.json()).id;
    const st = await get(`staff?auth_user_id=eq.${uid}&select=id,role,active`);
    if (st[0]?.id !== ONLY || st[0].role !== 'admin' || !st[0].active) return res.status(403).json({ error: 'Only Ronnie can connect Claude to G&R.' });
    if (!okRedirect(b.redirect_uri || '') || !b.code_challenge) return res.status(400).json({ error: 'bad request' });
    const code = sign({ t: 'code', sub: ONLY, ru: b.redirect_uri, cc: b.code_challenge, cid: b.client_id || '', exp: Math.floor(Date.now() / 1000) + 300 });
    const r = new URL(b.redirect_uri); r.searchParams.set('code', code); if (b.state) r.searchParams.set('state', b.state);
    return res.json({ redirect: r.toString() });
  }
  if (op === 'token') {
    if (req.method !== 'POST') return res.status(405).end();
    const b = form(req); const now = Math.floor(Date.now() / 1000);
    const issue = () => res.json({ access_token: sign({ t: 'at', sub: ONLY, exp: now + 30 * 86400 }), token_type: 'Bearer', expires_in: 30 * 86400, refresh_token: sign({ t: 'rt', sub: ONLY, exp: now + 180 * 86400 }), scope: 'gr' });
    if (b.grant_type === 'authorization_code') {
      const c = verify(b.code, 'code'); if (!c) return res.status(400).json({ error: 'invalid_grant' });
      if (b.redirect_uri && b.redirect_uri !== c.ru) return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri' });
      const ch = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
      if (ch !== c.cc) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE' });
      return issue();
    }
    if (b.grant_type === 'refresh_token') { if (!verify(b.refresh_token, 'rt')) return res.status(400).json({ error: 'invalid_grant' }); return issue(); }
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }

  // ── /mcp (JSON-RPC) ──
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!verify(auth, 'at')) { res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${B}/.well-known/oauth-protected-resource"`); return res.status(401).json({ error: 'unauthorized' }); }
  if (req.method === 'GET') return res.status(405).setHeader('Allow', 'POST').end();
  if (req.method === 'DELETE') return res.status(200).end();
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const one = async (m) => {
    if (!m || m.id === undefined || m.id === null) return null; // notifications
    const ok = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    try {
      if (m.method === 'initialize') return ok({ protocolVersion: m.params?.protocolVersion || '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'G&R à votre service', version: '1.0.0' },
        instructions: "G&R à votre service staff app (Montreal event staffing). Ronnie is the owner. Dates are Montreal time; today's date comes from the `today` tool. Every write tool must be called first with confirm=false: show Ronnie the preview and only call again with confirm=true after he says yes. Nothing here texts or emails staff." });
      if (m.method === 'ping') return ok({});
      if (m.method === 'tools/list') return ok({ tools: TOOLS });
      if (m.method === 'tools/call') {
        const t = TOOLS.find((x) => x.name === m.params?.name); if (!t) return { jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Unknown tool' } };
        try { return ok({ content: [{ type: 'text', text: await tool(t.name, m.params?.arguments || {}) }] }); }
        catch (err) { return ok({ content: [{ type: 'text', text: 'Error: ' + (err?.message || err) }], isError: true }); }
      }
      if (m.method === 'resources/list') return ok({ resources: [] });
      if (m.method === 'prompts/list') return ok({ prompts: [] });
      return { jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } };
    } catch (err) { return { jsonrpc: '2.0', id: m.id, error: { code: -32603, message: String(err?.message || err) } }; }
  };
  if (Array.isArray(body)) { const out = (await Promise.all(body.map(one))).filter(Boolean); return out.length ? res.json(out) : res.status(202).end(); }
  const r = await one(body); return r ? res.json(r) : res.status(202).end();
}
