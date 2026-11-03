/**
 * G&R — push 44 · EVENTS tab → staff app ("Sheet changes" on the admin Today page).
 *
 * Every 10 minutes this reads the EVENTS tab (today → +60 days) and sends the app what each event block says:
 * date, name, venue, staff lines (role · time · how many) and the names in columns E–G.
 * The app only SHOWS the differences to Ronnie (Approve / Ignore). Nothing in the app changes on its own,
 * and this file never writes anything to the sheet.
 *
 * Lives in the same Apps Script project as events-sheet-app-hours.gs (uses its SUPABASE_URL, TZ and the
 * SUPABASE_KEY / SHEET_TOKEN saved by "G&R app → Connect the app"). Turn it on once: G&R app menu → "Send events to the app now" (also turns on the 10-minute timer), or run startSheetChanges.
 *
 * Reading rules (EVENTS tab, see the G&R reference doc):
 *  - a block = a date row ("Saturday, November 07, 2026") → a name row → the header row (DETAILS … STAFF NAMES …);
 *    blocks without a header row are personal notes and are skipped;
 *  - skipped blocks: TO DO, MEETING (meetings live in the app's Meetings), MOVED, CANCELLED, NOT HAPPENING;
 *  - a staff line = a "4 Waiters" / "1 MD" / "1 Bar Manager" cell in C with its time in D; names in E, F, G on that row
 *    and the rows under it, until the next staff line; never column H (notes);
 *  - rows with BACKUP / BACKUPS in H are backups → not sent; red names (#ff0000) = cancelled → not sent; cooks are skipped;
 *  - department per line: Bar manager / Bartender / Barback = bar, everything else floor. One block can give both.
 */
const SC_DAYS = 60;

function startSheetChanges() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'postEventsToApp').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('postEventsToApp').timeBased().everyMinutes(10).create();
  return postEventsToApp();
}

function stopSheetChanges() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'postEventsToApp').forEach((t) => ScriptApp.deleteTrigger(t));
}

function postEventsToApp() {
  const from = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const to = Utilities.formatDate(addDays_(new Date(), SC_DAYS), TZ, 'yyyy-MM-dd');
  const sh = SpreadsheetApp.getActive().getSheetByName('EVENTS');
  const rg = sh.getRange(1, 1, sh.getLastRow(), 8);
  const events = parseEvents_(rg.getDisplayValues(), rg.getFontColors(), from, to);
  const p = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/sheet_events_post', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: p.getProperty('SUPABASE_KEY'), Authorization: 'Bearer ' + p.getProperty('SUPABASE_KEY') },
    payload: JSON.stringify({ p_token: p.getProperty('SHEET_TOKEN'), p_from: from, p_to: to, p_events: events }),
  });
  if (res.getResponseCode() !== 200) throw new Error('Sheet changes post failed (' + res.getResponseCode() + '): ' + res.getContentText());
  Logger.log('Sent ' + events.length + ' event blocks (' + from + ' → ' + to + ')');
  // first run (from the G&R app menu) also turns on the 10-minute timer
  if (!ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'postEventsToApp')) ScriptApp.newTrigger('postEventsToApp').timeBased().everyMinutes(10).create();
  return events.length;
}

/** Run by hand to see what would be sent, without sending (View → Logs). */
function testSheetChanges() {
  const from = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const to = Utilities.formatDate(addDays_(new Date(), 14), TZ, 'yyyy-MM-dd');
  const sh = SpreadsheetApp.getActive().getSheetByName('EVENTS');
  const rg = sh.getRange(1, 1, sh.getLastRow(), 8);
  parseEvents_(rg.getDisplayValues(), rg.getFontColors(), from, to).forEach((e) =>
    Logger.log(e.date + ' · ' + e.dept + ' · ' + e.title + (e.venue ? ' (' + e.venue + ')' : '') + ' · ' + e.staff.length + ' names'));
}

// ── parser (plain JS, no Apps Script calls, so it can be tested anywhere) ─────────────────────────────

const SC_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const SC_SKIP = /\b(TO DO|TODO|MEETING|MOVED|CANCELL?ED|NOT HAPP[EI]N+ING|PERSONAL)\b/i;

function scDate_(a) {
  const m = String(a || '').trim().match(/^(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (!m || !SC_MONTHS[m[1].toLowerCase()]) return null;
  return m[3] + '-' + ('0' + SC_MONTHS[m[1].toLowerCase()]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
}

function scTime_(raw) {
  const m = String(raw || '').trim().toUpperCase().replace(/\s|\./g, '').match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)?$/);
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] || 0);
  if (m[3] === 'PM' && h < 12) h += 12; if (m[3] === 'AM' && h === 12) h = 0;
  if (!m[3] && h < 11) h += 12; // "5:00" in an evening block = 5 PM
  if (h > 23 || mi > 59) return null;
  return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
}

/** "4 Waiters" → {count, code}; null when C is not a staff line. code null = skip (cooks). */
function scLine_(c) {
  const m = String(c || '').trim().match(/^(\d{1,3})\s+(.+)$/);
  if (!m) return null;
  const r = m[2].toLowerCase();
  let code = 'W';
  if (/cook|chef|kitchen|dish/.test(r)) code = null;
  else if (/bar\s*manager|\bbm\b/.test(r)) code = 'BM';
  else if (/bar\s*back|\bbb\b/.test(r)) code = 'BB';
  else if (/bartender|barmaid|mixolog|\bbt\b/.test(r)) code = 'BT';
  else if (/\bmd\b|ma[iî]tre|head\s*waiter/.test(r)) code = 'MD';
  else if (/bus/.test(r)) code = 'BUS';
  else if (!/waiter|server|serveur|staff|captain|runner|host/.test(r)) return null; // not a staff line (e.g. "10 tables")
  return { count: Number(m[1]), code: code };
}

const scDept_ = (code) => (code === 'BM' || code === 'BB' || code === 'BT' ? 'bar' : 'floor');
const scIsName_ = (s) => /^[A-Za-zÀ-ÿ'’\-. ]{2,60}$/.test(s) && /[A-Za-zÀ-ÿ].*[A-Za-zÀ-ÿ]/.test(s) && !/^(TBC|TBD|N\/A|NONE|OPEN)$/i.test(s.trim());

/** values / fonts = EVENTS!A1:H<last> display values and font colours. Returns one object per block per department. */
function parseEvents_(values, fonts, fromYmd, toYmd) {
  const out = [];
  const n = values.length;
  let i = 0;
  while (i < n) {
    const date = scDate_(values[i][0]);
    if (!date) { i++; continue; }
    const dateRow = i + 1;
    // block = until the next date row
    let j = i + 1; while (j < n && !scDate_(values[j][0])) j++;
    const rows = values.slice(i + 1, j); const fr = fonts.slice(i + 1, j);
    i = j;
    if (date < fromYmd || date > toYmd) continue;
    const t = rows.findIndex((r) => String(r[0] || '').trim() !== '');
    if (t < 0) continue;
    const title = String(rows[t][0]).trim();
    const h = rows.findIndex((r) => String(r[0] || '').trim().toUpperCase() === 'DETAILS' && /STAFF/i.test(r.join(' ')));
    if (h < 0 || SC_SKIP.test(title)) continue;
    const byDept = {};
    const get = (d) => (byDept[d] = byDept[d] || { date: date, dept: d, title: title, venue: '', address: '', details: [], lines: [], staff: [], row: dateRow });
    let line = null; const details = []; let venue = ''; let address = '';
    for (let k = h + 1; k < rows.length; k++) {
      const r = rows[k].map((x) => String(x == null ? '' : x).trim());
      const a = r[0];
      if (a) {
        const mv = a.match(/^(venue|location)\s*:\s*(.*)$/i); const ma = a.match(/^address\s*:\s*(.*)$/i);
        if (mv && !venue) venue = mv[2].trim(); else if (ma && !address) address = ma[1].trim(); else if (details.length < 6) details.push(a);
      }
      const nl = scLine_(r[2]);
      if (nl) {
        line = nl.code ? { code: nl.code, start: scTime_(r[3]) || (line && line.start) || null, count: nl.count } : { code: null };
        if (line.code) get(scDept_(line.code)).lines.push({ code: line.code, start: line.start, count: line.count });
      }
      if (!line || !line.code) continue;
      if (/BACKUP/i.test(r[7] || '')) continue;
      for (let c = 4; c <= 6; c++) {
        const name = r[c];
        if (!name || !scIsName_(name)) continue;
        const col = String((fr[k] && fr[k][c]) || '').toLowerCase();
        if (col === '#ff0000') continue; // red = cancelled
        get(scDept_(line.code)).staff.push({ name: name.replace(/\s+/g, ' '), code: line.code, start: line.start, row: dateRow + 1 + k });
      }
    }
    Object.keys(byDept).forEach((d) => { const e = byDept[d]; e.venue = venue; e.address = address; e.details = details; out.push(e); });
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { parseEvents_, scLine_, scTime_, scDate_ };
