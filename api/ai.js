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
// push 67 · machine-readable field per line so Ronnie's review can compare with the app and fill the event form
const FIELDS = new Set(['staff_start', 'guests_arrive', 'end', 'guests', 'address', 'venue', 'date', 'notes']);

async function okToken(t) {
  if (!t || String(t).length < 20) return false;
  const rows = await get('ai_settings?id=eq.1&select=token');
  return rows[0]?.token === String(t);
}

import { mcpHandler } from './_mcp.js';

export default async function handler(req, res) {
  if (req.query.mcp) return mcpHandler(req, res); // push 62 · Claude connector (see _mcp.js)
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !SERVICE) return res.status(503).json({ error: 'not set up' });
  try {
    const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}) : {};
    const token = req.method === 'POST' ? body.token : req.query.token;
    if (!(await okToken(token))) return res.status(401).json({ error: 'bad token' });

    // Nov 9 · push 58 · new suppliers for QuickBooks: Ronnie clicked "Add to QuickBooks" (staff_tax.qb_status = 'sending').
    // Full fields incl. SIN (the task puts it straight into QuickBooks and never prints it).
    if (req.method === 'GET' && req.query.vendors) {
      const rows = await get('staff_tax?qb_status=eq.sending&select=staff_id,first_name,middle_name,last_name,legal_name,email,phone,street,apt,city,province,postal_code,address,sin,qb_at');
      // push 71 · first gig → payroll sheet: new hires Ronnie said Yes to (staff_onboarding.payroll_status = 'sending')
      const pr = await get('staff_onboarding?payroll_status=eq.sending&select=staff_id,payroll_for,staff:staff!staff_onboarding_staff_id_fkey(full_name)');
      const payroll = pr.map((r) => ({ staff_id: r.staff_id, name: r.staff?.full_name ?? null, gig_date: r.payroll_for }));
      // push 79e · approved expenses not yet copied to the payroll sheet
      const ex = await get('expenses?status=eq.approved&sheet_status=is.null&select=id,kind,amount,exp_date,staff:staff!expenses_staff_id_fkey(full_name)&order=exp_date&limit=50');
      const expenses = ex.map((e) => ({ id: e.id, name: e.staff?.full_name ?? null, kind: e.kind, amount: Number(e.amount), date: e.exp_date }));
      return res.json({ vendors: rows, payroll, expenses });
    }

    // push 92 · bar BEO, read ONCE per event: 8 AM the morning of the event (Ronnie, Nov 11). After that the bar manager changes quantities in the app.
    //   GET ?beo=1 → today's bar events not read yet, from 8 AM Montreal time (phase 'initial')
    if (req.method === 'GET' && req.query.beo) {
      const tz = 'America/Toronto'; const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
      const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
      const evs = hour < 8 ? [] : await get(`events?department=eq.bar&event_date=eq.${today}&select=id,event_date,title,start_time,drive_folder_url,venues(name),bar_counts(beo_file,beo_modified,beo_read_at,beo_initial_at,beo_final_at)&order=start_time`);
      const ids = evs.map((e) => e.id).join(',') || '00000000-0000-0000-0000-000000000000';
      const started = new Set((await get(`bar_moves?step=eq.start&undone_at=is.null&event_id=in.(${ids})&select=event_id`)).map((m) => m.event_id));
      const out = [];
      for (const e of evs) {
        const c = (Array.isArray(e.bar_counts) ? e.bar_counts[0] : e.bar_counts) ?? {};
        if (c.beo_initial_at || c.beo_read_at) continue; // already read (or preloaded by hand)
        out.push({ id: e.id, phase: 'initial', date: e.event_date, start: e.start_time ? e.start_time.slice(0, 5) : null, title: e.title, venue: e.venues?.name ?? null, folder: e.drive_folder_url,
          started: started.has(e.id), beo_file: c.beo_file ?? null, beo_modified: c.beo_modified ?? null });
      }
      // the G&R bottle list, so the BEO bottles use the same names (no prices)
      const catalog = out.length ? (await get('bar_catalog?archived_at=is.null&select=name,size,kind&order=kind,name')) : [];
      return res.json({ events: out, catalog });
    }

    // push 80 · meeting notes Ronnie sent to an event ("Add to the event"): GET ?notes=1
    if (req.method === 'GET' && req.query.notes) {
      const ns = await get('meeting_notes?apply_status=eq.sending&deleted_at=is.null&select=id,body,meeting_id,created_at,author:staff!meeting_notes_author_id_fkey(full_name),meetings(title,starts_at)&limit=20');
      const out = [];
      for (const n of ns) {
        const [kids, evs] = await Promise.all([
          get(`meeting_notes?parent_id=eq.${n.id}&deleted_at=is.null&select=body`),
          get(`meeting_events?meeting_id=eq.${n.meeting_id}&select=events(id,title,event_date,department,guests,address,start_time,end_time,venues(name))`),
        ]);
        out.push({ id: n.id, body: n.body, added: kids.map((k) => k.body), author: n.author?.full_name ?? null, meeting: n.meetings?.title ?? null, meeting_at: n.meetings?.starts_at ?? null,
          events: evs.map((e) => e.events).filter(Boolean).map((e) => ({ id: e.id, date: e.event_date, title: e.title, venue: e.venues?.name ?? null, dept: e.department, guests: e.guests ?? null,
            address: e.address ?? null, start: e.start_time ? e.start_time.slice(0, 5) : null, end: e.end_time ? e.end_time.slice(0, 5) : null })) });
      }
      return res.json({ notes: out });
    }

    // Nov 8 · push 55b · AI first read of new applications. GET ?apps=1 → new ones not read yet, with a 1-hour CV link.
    if (req.method === 'GET' && req.query.apps) {
      const apps = await get('applications?status=eq.new&ai_at=is.null&select=id,created_at,first_name,last_name,email,phone,roles,worked_in,years,lang_fr,lang_en,days,transport,neighbourhood,cv_path,cv_name,no_cv_note,referrer_id,referrer_text&order=created_at&limit=10');
      const [past, staff] = await Promise.all([
        get('applications?select=id,email,phone,status,created_at'),
        get('staff?select=id,full_name,email,phone,active'),
      ]);
      const dg = (p) => (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      const out = [];
      for (const a of apps) {
        let cv_url = null;
        if (a.cv_path) {
          const r = await fetch(`${URL_}/storage/v1/object/sign/applications/${a.cv_path}`, { method: 'POST', headers: H(), body: JSON.stringify({ expiresIn: 3600 }) });
          if (r.ok) { const j = await r.json(); cv_url = `${URL_}/storage/v1${j.signedURL}`; }
        }
        const same = (x) => (a.email && x.email && x.email.toLowerCase() === a.email.toLowerCase()) || (dg(a.phone) && dg(x.phone) === dg(a.phone));
        out.push({ ...a, cv_path: undefined, cv_url,
          applied_before: past.filter((x) => x.id !== a.id && x.created_at < a.created_at && same(x)).map((x) => ({ status: x.status, date: x.created_at.slice(0, 10) })),
          staff_match: staff.filter(same).map((x) => ({ name: x.full_name, active: x.active })),
          referrer: a.referrer_id ? staff.find((x) => x.id === a.referrer_id)?.full_name ?? null : null });
      }
      return res.json({ apps: out });
    }

    if (req.method === 'GET') {
      const past = Math.min(Number(req.query.past) || 0, 90); // Nov 8 · ?past=45 → also past events (invoice matching)
      const today = new Date(Date.now() - past * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      const until = new Date(Date.now() + 60 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
      const since = new Date(Date.now() - 14 * 864e5).toISOString();
      const [evs, priv, items, clients, st] = await Promise.all([
        get(`events?event_date=gte.${today}&event_date=lte.${until}&select=id,event_date,title,address,guests,department,start_time,end_time,staffing,venues(name)&order=event_date`),
        get('event_private?select=event_id,clients(name)'),
        get(`ai_items?created_at=gte.${since}&select=dedupe_key`),
        get('clients?archived_at=is.null&select=name'),
        get('ai_settings?id=eq.1&select=inbox_checked_at'),
      ]);
      const cl = Object.fromEntries(priv.map((p) => [p.event_id, p.clients?.name ?? null]));
      return res.json({
        events: evs.map((e) => ({ id: e.id, date: e.event_date, title: e.title, venue: e.venues?.name ?? null, client: cl[e.id] ?? null,
          guests: e.guests ?? null, dept: e.department, address: e.address ?? null,
          start: e.start_time ? e.start_time.slice(0, 5) : null, end: e.end_time ? e.end_time.slice(0, 5) : null,
          staff_starts: [...new Set((e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code) && l.count > 0).map((l) => l.start))].sort() })),
        keys: items.map((i) => i.dedupe_key).filter(Boolean),
        clients: clients.map((c) => c.name),
        inbox_checked_at: st[0]?.inbox_checked_at ?? null,
      });
    }

    if (req.method === 'POST') {
      const list = Array.isArray(body.items) ? body.items.slice(0, 40) : [];
      const rows = list.filter((i) => i && i.dedupe_key && i.who).map((i) => ({
        source: String(i.dedupe_key).startsWith('note:') ? 'meeting' : 'email', kind: KINDS.has(i.kind) ? i.kind : 'other', dedupe_key: s(i.dedupe_key, 200), // push 80 · meeting notes
        event_id: /^[0-9a-f-]{36}$/i.test(i.event_id || '') ? i.event_id : null,
        who: s(i.who, 120), quote: s(i.quote, 400), event_hint: s(i.event_hint, 160), email_url: /^https:\/\/mail\.google\.com\//.test(i.email_url || '') ? s(i.email_url, 400) : null,
        lines: Array.isArray(i.lines) ? i.lines.slice(0, 6).map((l) => ({ label: s(l?.label, 40), old: s(l?.old, 120), new: s(l?.new, 160), ...(FIELDS.has(l?.field) ? { field: l.field, value: s(l?.value, 160) } : {}) })) : [],
        sure: i.sure !== false,
      }));
      // Nov 8 · push 54 (081) · QuickBooks invoices once SENT → profit per event. { qb_id, doc_number, event_id, customer, txn_date, sent_at, subtotal, total }
      let invoices = 0;
      if (Array.isArray(body.invoices) && body.invoices.length) {
        const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
        const inv = body.invoices.slice(0, 200).filter((i) => i && i.qb_id && i.sent_at).map((i) => ({
          qb_id: s(i.qb_id, 40), doc_number: s(i.doc_number, 40), customer: s(i.customer, 160),
          event_id: /^[0-9a-f-]{36}$/i.test(i.event_id || '') ? i.event_id : null,
          txn_date: /^\d{4}-\d{2}-\d{2}$/.test(i.txn_date || '') ? i.txn_date : null, sent_at: s(i.sent_at, 40),
          subtotal: num(i.subtotal), total: num(i.total), updated_at: new Date().toISOString() }));
        if (inv.length) {
          const r = await fetch(`${URL_}/rest/v1/event_invoices?on_conflict=qb_id`, { method: 'POST', headers: H({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(inv) });
          if (!r.ok) throw new Error(`invoices ${r.status} ${(await r.text()).slice(0, 200)}`);
          invoices = inv.length;
        }
      }
      // push 55b · AI first read: { apps: [{ id, summary, level: JUNIOR|MID|SENIOR, flags: [] }] }
      let reads = 0;
      if (Array.isArray(body.apps)) {
        for (const a of body.apps.slice(0, 20)) {
          if (!/^[0-9a-f-]{36}$/i.test(a?.id || '') || !a.summary) continue;
          const flags = Array.isArray(a.flags) ? a.flags.slice(0, 4).map((f) => '⚠ ' + s(f, 160)).join('\n') : '';
          const r = await fetch(`${URL_}/rest/v1/applications?id=eq.${a.id}`, { method: 'PATCH', headers: H({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ ai_summary: (s(a.summary, 600) + (flags ? '\n' + flags : '')), ai_level: ['JUNIOR', 'MID', 'SENIOR'].includes(a.level) ? a.level : null, ai_at: new Date().toISOString() }) });
          if (r.ok) reads++;
        }
      }
      // push 58 · QuickBooks results: { vendors: [{ staff_id, status: 'done'|'error', qb_vendor_id, note }] }
      let vendors = 0;
      if (Array.isArray(body.vendors)) {
        for (const v of body.vendors.slice(0, 30)) {
          if (!/^[0-9a-f-]{36}$/i.test(v?.staff_id || '') || !['done', 'error'].includes(v.status)) continue;
          const r = await fetch(`${URL_}/rest/v1/staff_tax?staff_id=eq.${v.staff_id}&qb_status=eq.sending`, { method: 'PATCH', headers: H({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ qb_status: v.status, qb_vendor_id: s(v.qb_vendor_id, 40), qb_note: s(v.note, 300), qb_at: new Date().toISOString() }) });
          if (r.ok) vendors++;
        }
      }
      // push 71 · payroll sheet results: { payroll: [{ staff_id, status: 'done'|'error', note }] }
      let payroll = 0;
      if (Array.isArray(body.payroll)) {
        for (const v of body.payroll.slice(0, 30)) {
          if (!/^[0-9a-f-]{36}$/i.test(v?.staff_id || '') || !['done', 'error'].includes(v.status)) continue;
          const r = await fetch(`${URL_}/rest/v1/staff_onboarding?staff_id=eq.${v.staff_id}&payroll_status=eq.sending`, { method: 'PATCH', headers: H({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ payroll_status: v.status, payroll_note: s(v.note, 300), payroll_at: new Date().toISOString() }) });
          if (r.ok) payroll++;
        }
      }
      // push 80 · meeting notes turned into review cards: { notes: [{ id, status: 'done'|'error' }] }
      let notes = 0;
      if (Array.isArray(body.notes)) {
        for (const v of body.notes.slice(0, 20)) {
          if (!/^[0-9a-f-]{36}$/i.test(v?.id || '') || !['done', 'error'].includes(v.status)) continue;
          const r = await fetch(`${URL_}/rest/v1/meeting_notes?id=eq.${v.id}&apply_status=eq.sending`, { method: 'PATCH', headers: H({ Prefer: 'return=minimal' }), body: JSON.stringify({ apply_status: v.status }) });
          if (r.ok) notes++;
        }
      }
      // push 79e · expenses copied to the payroll sheet: { expenses: [{ id, status: 'done'|'error', note }] }
      let expenses = 0;
      if (Array.isArray(body.expenses)) {
        for (const v of body.expenses.slice(0, 50)) {
          if (!/^[0-9a-f-]{36}$/i.test(v?.id || '') || !['done', 'error'].includes(v.status)) continue;
          const r = await fetch(`${URL_}/rest/v1/expenses?id=eq.${v.id}&status=eq.approved`, { method: 'PATCH', headers: H({ Prefer: 'return=minimal' }),
            body: JSON.stringify({ sheet_status: v.status, sheet_note: s(v.note, 300), sheet_at: new Date().toISOString() }) });
          if (r.ok) expenses++;
        }
      }
      // push 89 · bar BEO read: { beo: [{ event_id, file_id, name, modified, items: [{ name, size, kind, qty }] }] }
      let beo = 0;
      if (Array.isArray(body.beo)) {
        for (const v of body.beo.slice(0, 20)) {
          if (!/^[0-9a-f-]{36}$/i.test(v?.event_id || '')) continue;
          if (['initial', 'final'].includes(v.phase)) await fetch(`${URL_}/rest/v1/rpc/bar_beo_checked`, { method: 'POST', headers: H(), body: JSON.stringify({ p_event: v.event_id, p_phase: v.phase }) });
          if (!Array.isArray(v.items) || !v.items.length) { beo++; continue; } // no BAR BEO in the folder (or unchanged): only stamped
          const items = v.items.slice(0, 150).map((i) => ({ name: s(i?.name, 120), size: s(i?.size, 30), kind: s(i?.kind, 10), qty: i?.qty == null || isNaN(Number(i.qty)) ? null : Number(i.qty) }));
          const r = await fetch(`${URL_}/rest/v1/rpc/bar_beo_apply`, { method: 'POST', headers: H(), body: JSON.stringify({ p_event: v.event_id, p_file: s(v.file_id, 120), p_name: s(v.name, 200), p_modified: s(v.modified, 60), p_items: items }) });
          if (r.ok) beo++;
        }
      }
      let added = 0;
      if (rows.length) {
        const r = await fetch(`${URL_}/rest/v1/ai_items?on_conflict=dedupe_key`, { method: 'POST', headers: H({ Prefer: 'resolution=ignore-duplicates,return=representation' }), body: JSON.stringify(rows) });
        if (!r.ok) throw new Error(`insert ${r.status} ${(await r.text()).slice(0, 200)}`);
        added = (await r.json()).length;
      }
      if (body.checked) await fetch(`${URL_}/rest/v1/ai_settings?id=eq.1`, { method: 'PATCH', headers: H(), body: JSON.stringify({ inbox_checked_at: new Date().toISOString() }) });
      return res.json({ added, skipped: rows.length - added, invoices, reads, vendors, payroll, expenses, notes, beo });
    }
    return res.status(405).json({ error: 'GET or POST' });
  } catch (e) {
    console.error('[ai]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
