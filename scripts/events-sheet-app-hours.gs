/**
 * G&R — "APP · <DATE>" tabs in Events 2026, filled from the staff app.
 *
 * One-time setup (no code): in the sheet, open the "G&R app" menu → "Connect the app",
 * paste the two values it asks for, then click Allow when Google asks.
 *
 *   - 11:30 AM every day: builds tomorrow's tab (team + start times, no hours yet).
 *   - Every 15 min: refreshes today's tab, and yesterday's until 6 AM (events past midnight).
 * Hours go on the tab of the date the event STARTED. It only reads from the app; it never writes back.
 *
 * Once a team is fully ended in the app (everyone has an end time, or is no-show / cancelled):
 *   - the real day tab (e.g. OCTOBER 29) gets the start + end times, so the 5 AM invoice run finds them;
 *     anyone missing from the tab is added to their block;
 *   - the Staff Payroll 2026 sheet gets each person's Total in that date's column.
 * It never overwrites a cell someone changed by hand, and never writes an early start of 16+ min before call.
 * Anything it can't do safely is listed in red at the right of the APP tab ("NEEDS RONNIE").
 *
 * Push 38 · meetings (Teams / Zoom / office meetings, paid like a shift): each meeting on the date gets its own block,
 * "MEETING · <title>" / "MEETING · PAID · NOT INVOICED", one row per person who is paid (said Coming, or Ronnie's choice in the app).
 * Start = meeting start, End = start + its length (or the times Ronnie set in the app). No 4-hour minimum, not in COMBINED,
 * never copied to a day tab; the hours go straight to payroll, added to anything else that person worked that date.
 *
 * Push 28f · EXTRAS LOG: every refresh also appends the extras & cancellations Ronnie confirmed in the app
 * (and, once it is past 5 AM the day after an event with no answer, the app's proposal) as rows of the EXTRAS LOG tab,
 * matched to its header row (EVENT DATE · VENUE · INVOICE # · DETAILS · LOGGED AT). Each event is written once.
 */
const TZ = 'America/Toronto';
const TEMPLATE = 'BLANK TEMPLATE';
const SUPABASE_URL = 'https://oigqdecyhmeuvrpoikdv.supabase.co';
const PAYROLL_ID = '1Zt4r7gJepuELj2ywNoceCqxcqQOrE5LB5nCiLLvZVXo';
const EARLY_MIN = 16; // starts this many minutes (or more) before call need Ronnie

function onOpen() {
  SpreadsheetApp.getUi().createMenu('G&R app')
    .addItem('Connect the app', 'connect')
    .addItem('Update today now', 'syncToday')
    .addItem('Redo yesterday (day tab + payroll)', 'syncYesterday')
    .addItem('Send extras & cancellations to EXTRAS LOG', 'syncExtrasLog')
    .addItem('Send events to the app now (Sheet changes)', 'postEventsToApp')
    .addToUi();
}

function connect() {
  const ui = SpreadsheetApp.getUi();
  const a = ui.prompt('Connect the app (1 of 2)', 'Paste the Supabase "anon public" key:', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK || !a.getResponseText().trim()) return;
  const b = ui.prompt('Connect the app (2 of 2)', 'Paste the sheet_token value:', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK || !b.getResponseText().trim()) return;
  PropertiesService.getScriptProperties().setProperties({ SUPABASE_KEY: a.getResponseText().trim(), SHEET_TOKEN: b.getResponseText().trim() });
  setup();
  ui.alert('Connected. Tomorrow\'s tab is built every day at 11:30, and tabs update every 15 minutes.');
}

function setup() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('buildTomorrow').timeBased().atHour(11).nearMinute(30).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('refresh').timeBased().everyMinutes(15).create();
  if (typeof postEventsToApp === 'function') ScriptApp.newTrigger('postEventsToApp').timeBased().everyMinutes(10).create(); // push 44 · events-sheet-to-app.gs
  buildTomorrow();
  refresh();
}

function buildTomorrow() { syncDate_(addDays_(new Date(), 1)); }

function refresh() {
  const now = new Date();
  syncDate_(now);
  if (Number(Utilities.formatDate(now, TZ, 'H')) < 6) syncDate_(addDays_(now, -1));
  try { syncExtrasLog(); } catch (e) { Logger.log('EXTRAS LOG: ' + e); } // never blocks the hours sync
}

/** Rebuild today's tab now (also in the G&R app menu). */
function syncToday() { syncDate_(new Date(), true); }

/** Redo yesterday's APP tab, day tab and payroll (also in the G&R app menu). */
function syncYesterday() { syncDate_(addDays_(new Date(), -1), true); }

/** Run by hand to rebuild one date, e.g. syncOne('2026-10-28'). */
function syncOne(ymd) { syncDate_(new Date(ymd + 'T12:00:00'), true); }

// ───────────────────────────────────────────────────────────────

function syncDate_(d, force) {
  const ymd = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const rows = fetch_(ymd);
  if (!rows.length) return;
  const sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(rows)));
  const props = PropertiesService.getScriptProperties();
  const name = 'APP · ' + Utilities.formatDate(d, TZ, 'MMMM d').toUpperCase();
  const ss = SpreadsheetApp.getActive();
  if (!force && props.getProperty('sig_' + ymd) === sig && ss.getSheetByName(name)) return;
  write_(ss, name, d, rows);
  const issues = fillDayAndPayroll_(ss, d, rows);
  showIssues_(ss.getSheetByName(name), issues);
  props.setProperty('sig_' + ymd, sig);
}

function fetch_(ymd) {
  const p = PropertiesService.getScriptProperties();
  const call = (body) => UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/hours_sheet', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: p.getProperty('SUPABASE_KEY'), Authorization: 'Bearer ' + p.getProperty('SUPABASE_KEY') },
    payload: JSON.stringify(body),
  });
  const base = { p_token: p.getProperty('SHEET_TOKEN'), p_date: ymd };
  let res = call(Object.assign({ p_meetings: true }, base)); // push 38: meetings too
  if (res.getResponseCode() !== 200 && /p_meetings|function|schema cache/i.test(res.getContentText())) res = call(base); // migration 043 not applied yet
  if (res.getResponseCode() !== 200) throw new Error('App feed failed (' + res.getResponseCode() + '): ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

const BAR = { BM: 1, BB: 1, BT: 1 };
/** floor | bar | meeting (push 38) */
const kindOf_ = (r) => r.kind === 'meeting' ? 'meeting' : BAR[r.position_code] || r.department === 'bar' ? 'bar' : 'floor';
/** Block title on the APP tab, e.g. "LE ANDOVER - 1234 RUE X - BAR" (also used to find a person's row in their own block). */
const where_ = (title, address, kind) => (title + (address ? ' - ' + String(address).split(',')[0] : '') + (kind === 'bar' ? ' - BAR' : '')).toUpperCase();
const q15 = (iso) => new Date(Math.round(new Date(iso).getTime() / 900000) * 900000);
const dayFrac = (dt) => { const [h, m] = Utilities.formatDate(dt, TZ, 'H:m').split(':').map(Number); return (h * 60 + m) / 1440; };
const ampm = (iso) => Utilities.formatDate(new Date(iso), TZ, 'h:mma').toUpperCase();

function write_(ss, name, d, rows) {
  // 1. Fresh sheet, placed right after the date's own tab. Day tab v2 layout (push 26, Oct 31 2026).
  const old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  const sh = ss.insertSheet(name);
  const own = ss.getSheetByName(Utilities.formatDate(d, TZ, 'MMMM d').toUpperCase());
  ss.setActiveSheet(sh); ss.moveActiveSheet(own ? own.getIndex() + 1 : 2);
  sh.setTabColor('#9B2226');
  const tr = rows.some((r) => Number(r.travel_h) > 0 || Number(r.gas) > 0);
  const L = tr ? LAYOUT_TR : LAYOUT_V2;

  // 2. Group: event → floor / bar → start time.
  const events = [];
  rows.forEach((r) => {
    let ev = events.find((e) => e.title === r.title && e.address === r.address);
    if (!ev) { ev = { title: r.title, address: r.address, blocks: { floor: [], bar: [], meeting: [] } }; events.push(ev); }
    ev.blocks[kindOf_(r)].push(r);
  });

  // 3. Rows. kind: blank | date | title | dept | head | start | person | total
  const out = []; const kinds = []; const sumRows = [];
  const W = L.cols;
  const push = (vals, k) => { const v = Array(W).fill(''); vals.forEach((x, i) => { if (x !== undefined) v[i] = x; }); out.push(v); kinds.push(k); };
  const dateVal = new Date(Utilities.formatDate(d, TZ, 'yyyy-MM-dd') + 'T12:00:00');
  push([], 'blank');
  events.forEach((ev) => {
    ['floor', 'bar', 'meeting'].forEach((kind) => {
      const list = ev.blocks[kind]; if (!list.length) return;
      const mtg = kind === 'meeting';
      const where = where_(ev.title, ev.address, kind);
      push(['', dateVal], 'date'); push(['', where], 'title'); push(['', mtg ? 'MEETING · PAID · NOT INVOICED' : kind === 'bar' ? 'BAR STAFF' : 'FLOOR STAFF'], 'dept');
      push(headers_(L), 'head');
      const first = out.length + 1; let n = 0; let start = null;
      list.forEach((r) => {
        if (r.planned_start !== start) { start = r.planned_start; n = 0; push(['', 'START TIME: ' + ampm(start)], 'start'); }
        const gone = gone_(r);
        const code = mtg ? '' : BAR[r.position_code] || r.position_code === 'MD' ? r.position_code : (kind === 'bar' ? (r.position_code || '') : ++n);
        const row = out.length + 1; const v = [];
        v[0] = code; v[1] = r.full_name.toUpperCase();
        v[L.start - 1] = !gone && r.punch_in ? dayFrac(q15(r.punch_in)) : '';
        v[L.end - 1] = !gone && r.punch_out ? dayFrac(q15(r.punch_out)) : '';
        v[L.worked - 1] = mtg ? meetingF_(row, L) : workedF_(row, L);
        if (L.travel) v[L.travel - 1] = gone || mtg ? 0 : Number(r.travel_h) || '';
        v[L.total - 1] = totalF_(row, L);
        if (L.gas) v[L.gas - 1] = mtg ? '' : Number(r.gas) || '';
        v[L.note - 1] = mtg ? 'MEETING' : noteFor_(r);
        push(v, 'person');
      });
      const last = out.length; const t = [];
      t[L.end - 1] = mtg ? 'MEETING TOTAL' : kind === 'bar' ? 'BAR TOTAL' : 'FLOOR TOTAL';
      sumCols_(L).forEach((c) => { t[c - 1] = '=SUM(' + col_(c) + first + ':' + col_(c) + last + ')'; });
      push(t, 'total'); if (!mtg) sumRows.push(out.length); // COMBINED = event staff only (what gets invoiced)
      push([], 'blank');
    });
  });
  const c = []; c[L.end - 1] = 'COMBINED';
  sumCols_(L).forEach((k) => { c[k - 1] = sumRows.length ? '=SUM(' + sumRows.map((r) => col_(k) + r).join(',') + ')' : 0; });
  push(c, 'total');

  const n = out.length;
  if (sh.getMaxColumns() < W + 2) sh.insertColumnsAfter(sh.getMaxColumns(), W + 2 - sh.getMaxColumns());
  if (sh.getMaxRows() < n + 2) sh.insertRowsAfter(sh.getMaxRows(), n + 2 - sh.getMaxRows());
  sh.getRange(1, 1, n, W).setValues(out);
  styleTab_(sh, kinds, L);
  if (sh.getMaxRows() > n + 2) sh.deleteRows(n + 3, sh.getMaxRows() - n - 2);
}

// ── Day tab v2 layout (push 26) ───────────────────────────────
// Old tabs (before Nov 2026): A # · B Name · C checkbox · D Start · E End · F Total · G Note.
// v2:            A # · B Name · C Start · D End · E Hours worked · F Total hours · G Note.
// v2 transport:  A # · B Name · C Start · D End · E Hours worked · F Travel · G Total hours · H Gas · I Note.
const LAYOUT_OLD = { v: 1, name: 2, chk: 3, start: 4, end: 5, worked: 6, travel: 0, total: 6, gas: 0, note: 7, cols: 7 };
const LAYOUT_V2 = { v: 2, name: 2, chk: 0, start: 3, end: 4, worked: 5, travel: 0, total: 6, gas: 0, note: 7, cols: 7 };
const LAYOUT_TR = { v: 2, name: 2, chk: 0, start: 3, end: 4, worked: 5, travel: 6, total: 7, gas: 8, note: 9, cols: 9 };
const col_ = (c) => String.fromCharCode(64 + c);
const headers_ = (L) => { const h = ['', 'Name']; h[L.start - 1] = 'Start Time'; h[L.end - 1] = 'End Time'; h[L.worked - 1] = 'Hours worked';
  if (L.travel) h[L.travel - 1] = 'Travel'; h[L.total - 1] = 'Total hours'; if (L.gas) h[L.gas - 1] = 'Gas'; h[L.note - 1] = 'Note'; return h; };
const sumCols_ = (L) => [L.worked, L.travel, L.total, L.gas].filter((c, i, a) => c && a.indexOf(c) === i);

/** Which layout a day tab uses, read from its first header row ("Name" in A or B). */
function layoutOf_(sh) {
  const v = sh.getRange(1, 1, Math.min(sh.getLastRow(), 40), Math.min(sh.getLastColumn(), 10)).getDisplayValues();
  const hr = v.find((r) => /^name$/i.test(String(r[0]).trim()) || /^name$/i.test(String(r[1]).trim()));
  if (!hr) return LAYOUT_OLD;
  const at = (re) => { const i = hr.findIndex((x) => re.test(String(x).trim())); return i < 0 ? 0 : i + 1; };
  if (!at(/^hours worked$/i)) return LAYOUT_OLD;
  return { v: 2, name: 2, chk: 0, start: at(/^start/i), end: at(/^end/i), worked: at(/^hours worked$/i), travel: at(/^travel$/i),
    total: at(/^total hours$/i), gas: at(/^gas$/i), note: at(/^note$/i), cols: Math.max(at(/^note$/i), 7) };
}

/** Day tab v2 look: merged B→last column on date/title/dept/START TIME rows, grid only on the blocks. */
function styleTab_(sh, kinds, L) {
  const W = L.cols; const n = kinds.length;
  sh.getRange(1, 1, n, W).breakApart().setBorder(false, false, false, false, false, false).setBackground(null).setFontWeight('normal').setFontColor('#000000');
  sh.setColumnWidth(1, 34); sh.setColumnWidth(2, 250);
  for (let c = 3; c <= W; c++) sh.setColumnWidth(c, c === L.note ? 200 : 96);
  const box = (r) => r.setBorder(true, true, true, true, true, true, '#000000', SpreadsheetApp.BorderStyle.SOLID);
  kinds.forEach((k, i) => {
    const row = i + 1;
    if (k === 'date' || k === 'title' || k === 'dept' || k === 'start') {
      const r = sh.getRange(row, 2, 1, W - 1).merge(); box(r);
      r.setFontWeight('bold').setHorizontalAlignment(k === 'dept' || k === 'start' ? 'center' : 'left');
      if (k === 'date') r.setNumberFormat('dddd, mmmm d, yyyy');
    } else if (k === 'head') {
      const r = sh.getRange(row, 2, 1, W - 1); box(r); r.setFontWeight('bold');
      sh.getRange(row, 3, 1, W - 3).setHorizontalAlignment('center');
      if (L.travel) sh.getRange(row, L.travel).setBackground('#FFF6E0').setFontColor('#8A6A12');
      if (L.gas) sh.getRange(row, L.gas).setBackground('#FFF6E0').setFontColor('#8A6A12');
      sh.getRange(row, L.total).setBackground('#EAF5EF').setFontColor('#1B7F5C');
    } else if (k === 'person') {
      box(sh.getRange(row, 1, 1, W));
      sh.getRange(row, 1).setHorizontalAlignment('center');
      sh.getRange(row, 3, 1, W - 3).setHorizontalAlignment('center');
      sh.getRange(row, L.start, 1, 2).setNumberFormat('h":"mm" "am/pm');
      sh.getRange(row, L.total).setBackground('#EAF5EF').setFontColor('#1B7F5C').setFontWeight('bold');
      if (L.travel) sh.getRange(row, L.travel).setBackground('#FFF6E0');
      if (L.gas) sh.getRange(row, L.gas).setBackground('#FFF6E0').setNumberFormat('$0');
    } else if (k === 'total') {
      const last = Math.max(L.total, L.gas || 0);
      box(sh.getRange(row, L.end, 1, last - L.end + 1)); sh.getRange(row, L.end, 1, last - L.end + 1).setFontWeight('bold').setHorizontalAlignment('center');
      sh.getRange(row, L.end).setFontSize(9);
      sh.getRange(row, L.total).setBackground('#EAF5EF').setFontColor('#1B7F5C');
      if (L.travel) sh.getRange(row, L.travel).setBackground('#FFF6E0');
      if (L.gas) sh.getRange(row, L.gas).setBackground('#FFF6E0').setNumberFormat('$0');
    }
  });
}

// ── Day tab + payroll ─────────────────────────────────────────

/** Hours worked: 15-min times, 4 h minimum unless the Note says LEFT EARLY. */
const workedF_ = (row, L) => { const S = col_(L.start) + row, E = col_(L.end) + row, N = col_(L.note) + row;
  return '=IF(OR(' + S + '="",' + E + '=""),"",LET(h,24*MOD(TIMEVALUE(' + E + ')-TIMEVALUE(' + S + '),1),IF(ISNUMBER(SEARCH("LEFT EARLY",' + N + ')),h,MAX(4,h))))'; };
/** Push 38 · meeting rows: real time between start and end, no 4-hour minimum. */
const meetingF_ = (row, L) => { const S = col_(L.start) + row, E = col_(L.end) + row;
  return '=IF(OR(' + S + '="",' + E + '=""),"",24*MOD(TIMEVALUE(' + E + ')-TIMEVALUE(' + S + '),1))'; };
/** Total hours = worked + travel (v2); the old layout's Total is the worked formula itself. */
const totalF_ = (row, L) => { L = L || LAYOUT_OLD; if (L.v === 1) return workedF_(row, L);
  const w = col_(L.worked) + row; return L.travel ? '=IF(' + w + '="","",' + w + '+N(' + col_(L.travel) + row + '))' : '=IF(' + w + '="","",' + w + ')'; };
const noteFor_ = (r) => r.attendance === 'no_show' ? 'NO SHOW' : r.attendance === 'cancelled' ? 'CANCELLED' : r.attendance === 'left_early' ? 'LEFT EARLY' : '';
const norm_ = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
const gone_ = (r) => r.attendance === 'no_show' || r.attendance === 'cancelled';
/** "4:30 p.m." label; written to the sheet as a time value (day fraction), never as text. */
const txt_ = (dt) => Utilities.formatDate(dt, TZ, 'h:mm a').toLowerCase().replace('am', 'a.m.').replace('pm', 'p.m.');
const sameTime_ = (a, b) => { try { return a !== '' && b !== '' && Math.abs(tv_(a) - tv_(b)) < 1e-6; } catch (e) { return false; } };
function tv_(v) {
  if (v instanceof Date) return (v.getHours() * 60 + v.getMinutes()) / 1440;
  if (typeof v === 'number') return v % 1;
  const m = String(v).toLowerCase().replace(/\./g, '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/);
  if (!m) throw new Error('bad time ' + v);
  let h = Number(m[1]) % 12; if (m[3] === 'pm' || (!m[3] && Number(m[1]) >= 12)) h += 12; if (!m[3] && Number(m[1]) === 12) h = 12;
  return (h * 60 + Number(m[2])) / 1440;
}

/** v2 day tab without Travel / Gas → add them (F Travel, H Gas), fix formulas, headers, totals and colours. */
function addTransportCols_(day) {
  let L = layoutOf_(day);
  if (L.v !== 2 || L.travel) return L;
  day.insertColumnAfter(L.worked);             // new Travel = worked + 1, Total shifts right
  day.insertColumnAfter(L.worked + 2);         // new Gas after Total hours
  const T = { v: 2, name: 2, chk: 0, start: L.start, end: L.end, worked: L.worked, travel: L.worked + 1, total: L.worked + 2, gas: L.worked + 3, note: L.note + 2, cols: L.cols + 2 };
  const n = day.getLastRow(); const v = day.getRange(1, 1, n, T.cols).getDisplayValues();
  let first = 0;
  v.forEach((r, i) => {
    const row = i + 1; const b = String(r[1]).trim();
    if (/^name$/i.test(b)) {
      day.getRange(row, T.travel).setValue('Travel').setBackground('#FFF6E0').setFontColor('#8A6A12').setFontWeight('bold').setHorizontalAlignment('center');
      day.getRange(row, T.gas).setValue('Gas').setBackground('#FFF6E0').setFontColor('#8A6A12').setFontWeight('bold').setHorizontalAlignment('center');
      first = row + 1; return;
    }
    if (/TOTAL|COMBINED/i.test(String(r[T.end - 1]))) {
      const f = day.getRange(row, T.worked).getFormula();
      [T.travel, T.total, T.gas].forEach((c) => { if (f) day.getRange(row, c).setFormula(f.replace(new RegExp(col_(T.worked) + '(\\d+)', 'g'), col_(c) + '$1')); });
      day.getRange(row, T.travel, 1, 3).setFontWeight('bold').setHorizontalAlignment('center');
      day.getRange(row, T.gas).setNumberFormat('$0');
      return;
    }
    if (first && r[1] && !/^START TIME/i.test(b) && !/(FLOOR|BAR) STAFF/i.test(b)) {
      day.getRange(row, T.total).setFormula(totalF_(row, T));
      day.getRange(row, T.travel).setBackground('#FFF6E0'); day.getRange(row, T.gas).setBackground('#FFF6E0').setNumberFormat('$0');
    }
  });
  return layoutOf_(day);
}

/** Fills the real day tab and the payroll sheet for teams that are fully ended. Returns the list of things for Ronnie. */
function fillDayAndPayroll_(ss, d, rows) {
  const issues = [];
  const props = PropertiesService.getScriptProperties();
  const ymd = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const label = Utilities.formatDate(d, TZ, 'MMMM d').toUpperCase();
  const wrote = JSON.parse(props.getProperty('wrote_' + ymd) || '{}'); // what this script wrote last time, so hand edits win
  const byEvent = {};
  rows.forEach((r) => (byEvent[r.event_id] = byEvent[r.event_id] || []).push(r));
  const done = Object.keys(byEvent).filter((id) => byEvent[id].every((r) => gone_(r) || (r.punch_in && r.punch_out)));
  if (!done.length) return issues;
  const day = ss.getSheetByName(label);
  if (!day) { payrollFromApp_(ss, d, label, done, byEvent, issues, wrote); props.setProperty('wrote_' + ymd, JSON.stringify(wrote)); return issues; }

  let L = layoutOf_(day);
  const transport = done.some((id) => byEvent[id].some((r) => Number(r.travel_h) > 0 || Number(r.gas) > 0));
  if (transport && L.v === 2 && !L.travel) L = addTransportCols_(day);
  if (transport && !L.travel) issues.push('Transport event: the ' + label + ' tab is in the old layout, so travel / gas were not added to it. Payroll still gets the travel hours.');

  const pay = []; const gas = []; const direct = [];
  done.forEach((id) => {
    if (byEvent[id][0].kind === 'meeting') { // push 38: never on the day tab; app hours straight to payroll
      byEvent[id].forEach((r) => { if (r.punch_in && r.punch_out) direct.push({ name: r.full_name.toUpperCase(), h: Math.round((new Date(r.punch_out) - new Date(r.punch_in)) / 900000) / 4 }); });
      return;
    }
    ['floor', 'bar'].forEach((kind) => {
      const team = byEvent[id].filter((r) => kindOf_(r) === kind);
      if (!team.length) return;
      const what = team[0].title + (kind === 'bar' ? ' bar' : '');
      let people = personRows_(day, L);
      const votes = {};
      team.forEach((r) => { const p = find_(people, r.full_name); if (p) votes[p.block] = (votes[p.block] || 0) + 1; });
      const block = Object.keys(votes).sort((x, y) => votes[y] - votes[x])[0];
      if (block === undefined) { issues.push(what + ': none of the team is on the ' + label + ' tab, nothing copied.'); return; }
      const inBlock = () => people.filter((x) => String(x.block) === block);
      team.forEach((r) => {
        const name = r.full_name.toUpperCase();
        let p = find_(inBlock(), r.full_name) || find_(people, r.full_name);
        if (!p) {
          const last = Math.max.apply(null, inBlock().map((x) => x.row));
          day.insertRowAfter(last);
          day.getRange(last, 1, 1, L.cols).copyTo(day.getRange(last + 1, 1, 1, L.cols), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
          day.getRange(last + 1, 1, 1, 2).setValues([[r.position_code || '', name]]);
          if (L.chk) day.getRange(last + 1, L.chk).setValue(!gone_(r));
          day.getRange(last + 1, L.worked).setFormula(workedF_(last + 1, L));
          if (L.total !== L.worked) day.getRange(last + 1, L.total).setFormula(totalF_(last + 1, L));
          issues.push('Added ' + name + ' to the ' + label + ' tab (in the app team, was not on the tab).');
          people = personRows_(day, L); p = find_(inBlock(), r.full_name);
        }
        const key = (c) => block + '|' + p.name + '|' + c;
        const isTime = (c) => c === L.start || c === L.end;
        const set = (c, val, prefill) => {
          if (!c) return;
          const cell = day.getRange(p.row, c); const cur = cell.getValue();
          if (val === '' || cur === val || (isTime(c) && sameTime_(cur, val))) return;
          const mine = wrote[key(c)] !== undefined && (cur === wrote[key(c)] || (isTime(c) && sameTime_(cur, wrote[key(c)])));
          if (cur === '' || mine || (prefill && sameTime_(cur, prefill))) {
            if (isTime(c)) cell.setNumberFormat('h":"mm" "am/pm').setValue(tv_(val)); else cell.setValue(val);
            wrote[key(c)] = val;
          } else issues.push(name + ': the tab says ' + (cur instanceof Date ? txt_(cur) : cur) + ', the app says ' + val + '. Left the tab as is.');
        };
        if (gone_(r)) { set(L.note, noteFor_(r)); if (L.travel) set(L.travel, 0); return; }
        const planned = new Date(r.planned_start);
        let start = q15(r.punch_in);
        const early = Math.round((planned - start) / 60000);
        const curStart = day.getRange(p.row, L.start).getValue();
        if (early >= EARLY_MIN && sameTime_(curStart, txt_(start))) { /* early start already OK'd on the tab */ }
        else if (early >= EARLY_MIN) {
          issues.push(name + ' was started ' + early + ' min before call (' + txt_(start) + ', call ' + txt_(planned) + '). Written as ' + txt_(planned) + '; change it on the tab if they really started early.');
          start = planned;
        }
        set(L.start, txt_(start), txt_(planned));
        set(L.end, txt_(q15(r.punch_out)));
        if (r.attendance === 'left_early') set(L.note, 'LEFT EARLY');
        if (L.travel && Number(r.travel_h) > 0) set(L.travel, Number(r.travel_h));
        if (L.gas && Number(r.gas) > 0) set(L.gas, Number(r.gas));
        if (Number(r.gas) > 0) gas.push({ name: name, amt: Number(r.gas) });
        pay.push({ name: name, row: p.row, travel: L.travel ? 0 : Number(r.travel_h) || 0 });
      });
    });
  });
  SpreadsheetApp.flush();
  const f = day.getRange(1, L.total, day.getLastRow(), 1).getValues();
  const hours = pay.filter((x) => typeof f[x.row - 1][0] === 'number').map((x) => ({ name: x.name, h: Math.round((f[x.row - 1][0] + x.travel) * 4) / 4 }));
  pay.filter((x) => typeof f[x.row - 1][0] !== 'number').forEach((x) => issues.push(x.name + ': the Total on the ' + label + ' tab is not a number, not added to payroll.'));
  payroll_(d, hours.concat(direct), issues, wrote, gas);
  props.setProperty('wrote_' + ymd, JSON.stringify(wrote));
  return issues;
}

/** Default from Nov 1, 2026 (Ronnie: no more date tabs, the APP tab is the hours tab): payroll is filled straight from the APP tab's Total hours. */
function payrollFromApp_(ss, d, label, done, byEvent, issues, wrote) {
  const app = ss.getSheetByName('APP · ' + label);
  if (!app) { issues.push('No ' + label + ' tab and no APP tab, nothing added to payroll.'); return; }
  SpreadsheetApp.flush();
  const AL = layoutOf_(app);
  const v = app.getRange(1, 1, app.getLastRow(), AL.cols).getValues();
  // Block title of each row (the row after a date row), so someone on two events / a meeting gets the right row each time.
  const blockOf = []; let cur = ''; let next = false;
  v.forEach((r, i) => { if (r[1] instanceof Date) next = true; else if (next) { cur = String(r[1]).trim().toUpperCase(); next = false; } blockOf[i] = cur; });
  const rowOf = (r) => { const n = norm_(r.full_name); const w = where_(r.title, r.address, kindOf_(r));
    const i = v.findIndex((x, k) => blockOf[k] === w && norm_(x[AL.name - 1]) === n);
    return i >= 0 ? i : v.findIndex((x) => norm_(x[AL.name - 1]) === n); };
  const hours = []; const gas = [];
  done.forEach((id) => byEvent[id].forEach((r) => {
    if (gone_(r) || !r.punch_in || !r.punch_out) return;
    const name = r.full_name.toUpperCase(); const i = rowOf(r);
    const t = i >= 0 ? v[i][AL.total - 1] : '';
    if (typeof t !== 'number') { issues.push(name + ': no Total hours on the APP tab, not added to payroll.'); return; }
    hours.push({ name: name, h: Math.round((t + (AL.travel ? 0 : Number(r.travel_h) || 0)) * 4) / 4 });
    if (Number(r.gas) > 0) gas.push({ name: name, amt: Number(r.gas) });
  }));
  payroll_(d, hours, issues, wrote, gas);
}

/** Person rows on a day tab: { row, name, block } where block = the FLOOR STAFF / BAR STAFF row above them. */
function personRows_(sh, L) {
  L = L || layoutOf_(sh);
  const v = sh.getRange(1, 1, sh.getLastRow(), L.cols).getValues();
  const out = []; let block = -1;
  v.forEach((r, i) => {
    const a = String(r[0]).trim(); const b = String(r[1]).trim();
    if (r[0] instanceof Date || r[1] instanceof Date || /^(mon|tues|wednes|thurs|fri|satur|sun)day,/i.test(a) || /^(mon|tues|wednes|thurs|fri|satur|sun)day,/i.test(b)) { block = -1; return; }
    if (/^(FLOOR|BAR) STAFF$/i.test(a) || /^(FLOOR|BAR) STAFF$/i.test(b)) { block = i + 1; return; }
    if (block < 0 || !r[1] || /^name$/i.test(a) || /^name$/i.test(b) || /^START TIME/i.test(a) || /^START TIME/i.test(b)) return;
    if (/TOTAL|COMBINED/i.test(String(r[L.end - 1])) || /TOTAL|COMBINED/i.test(String(r[4]))) return;
    if (r[1] instanceof Date) return;
    out.push({ row: i + 1, name: norm_(r[1]), block: block });
  });
  return out;
}

/** Exact name, else same first + last name if only one person matches. */
function find_(list, fullName) {
  const n = norm_(fullName);
  const hit = list.find((x) => x.name === n);
  if (hit) return hit;
  const w = n.split(' ');
  const c = list.filter((x) => { const y = x.name.split(' '); return y[0] === w[0] && y[y.length - 1] === w[w.length - 1]; });
  return c.length === 1 ? c[0] : null;
}

function payroll_(d, hours, issues, wrote, gas) {
  if (!hours.length && !(gas && gas.length)) return;
  // Push 38: one payroll cell per person and date → add up everything they did that date (shifts + meetings).
  const sum = {}; const order = [];
  hours.forEach((x) => { if (!(x.name in sum)) { sum[x.name] = 0; order.push(x.name); } sum[x.name] += x.h; });
  hours = order.map((n) => ({ name: n, h: Math.round(sum[n] * 4) / 4 }));
  const mon = Utilities.formatDate(d, TZ, 'MMM').toLowerCase(); const dd = Number(Utilities.formatDate(d, TZ, 'd'));
  const label = Utilities.formatDate(d, TZ, 'MMM d');
  const ps = SpreadsheetApp.openById(PAYROLL_ID);
  let sh = null; let col = -1; let dateHdr = '';
  ps.getSheets().filter((s) => /^Payroll /i.test(s.getName())).forEach((s) => {
    if (sh) return;
    const hdr = s.getRange(1, 1, 1, s.getLastColumn()).getDisplayValues()[0];
    const i = hdr.findIndex((h) => { const m = String(h).trim().match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?$/); return m && m[1].toLowerCase() === mon && Number(m[2]) === dd; });
    if (i >= 0) { sh = s; col = i + 1; dateHdr = String(hdr[i]).trim(); }
  });
  if (!sh) { issues.push('Payroll: no ' + label + ' column yet, so hours were not added.'); return; }
  const n = sh.getLastRow();
  const names = sh.getRange(1, 2, n, 1).getValues().map((r, i) => ({ row: i + 1, name: norm_(r[0]) })).filter((x) => x.name && x.row > 2);
  const vals = sh.getRange(1, col, n, 1).getValues();
  hours.forEach((x) => {
    const p = find_(names, x.name);
    if (!p) { issues.push('Payroll: ' + x.name + ' is not on the payroll sheet. Add them, then ' + x.h + ' h on ' + label + '.'); return; }
    const cur = vals[p.row - 1][0]; const k = 'pay|' + p.name;
    if (typeof cur === 'number' && Math.abs(cur - x.h) < 0.001) { wrote[k] = x.h; return; }
    if (cur === '' || cur === wrote[k]) { sh.getRange(p.row, col).setValue(x.h); wrote[k] = x.h; }
    else issues.push('Payroll: ' + x.name + ' already has ' + cur + ' h on ' + label + ', the day tab says ' + x.h + '. Left payroll as is.');
  });
  if (!gas || !gas.length) return;
  // Gas for drivers (push 26): its own column, header 'Gas "Oct 31st"' in row 2, between RATE and TOTAL PAY (TOTAL PAY sums those columns).
  const h2 = sh.getRange(2, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  const rate = h2.findIndex((x) => /^RATE$/i.test(String(x).trim())); const tp = h2.findIndex((x) => /^TOTAL PAY$/i.test(String(x).trim()));
  const want = 'Gas "' + dateHdr + '"';
  let gc = h2.findIndex((x) => String(x).trim().toLowerCase() === want.toLowerCase()) + 1;
  if (!gc && rate >= 0 && tp > rate) {
    for (let c = rate + 1; c < tp; c++) { if (!String(h2[c]).trim()) { gc = c + 1; break; } }
    if (gc) sh.getRange(2, gc).setValue(want);
  }
  if (!gc) { issues.push('Payroll: no free column for ' + want + ' (between RATE and TOTAL PAY). Gas not added: ' + gas.map((g) => g.name + ' $' + g.amt).join(', ')); return; }
  const gv = sh.getRange(1, gc, n, 1).getValues();
  gas.forEach((g) => {
    const p = find_(names, g.name);
    if (!p) { issues.push('Payroll: ' + g.name + ' is not on the payroll sheet, gas $' + g.amt + ' not added.'); return; }
    const cur = gv[p.row - 1][0]; const k = 'gas|' + p.name;
    if (cur === g.amt) { wrote[k] = g.amt; return; }
    if (cur === '' || cur === wrote[k]) { sh.getRange(p.row, gc).setValue(g.amt); wrote[k] = g.amt; }
    else issues.push('Payroll: ' + g.name + ' already has ' + cur + ' in ' + want + ', the app says $' + g.amt + '. Left it.');
  });
}

/** Red list at the right of the APP tab. */
function showIssues_(sh, issues) {
  if (!sh) return;
  if (sh.getMaxRows() < issues.length + 2) sh.insertRowsAfter(sh.getMaxRows(), issues.length + 2 - sh.getMaxRows());
  sh.getRange(1, 9, sh.getMaxRows(), 1).clearContent();
  if (!issues.length) { sh.getRange(1, 9).setValue('✓ Copied to the day tab and payroll').setFontColor('#1B7F5C').setFontWeight('bold'); return; }
  sh.getRange(1, 9).setValue('NEEDS RONNIE (' + issues.length + ')').setFontColor('#9B2226').setFontWeight('bold');
  sh.getRange(2, 9, issues.length, 1).setValues(issues.map((t) => [t])).setFontColor('#9B2226').setWrap(true);
  sh.setColumnWidth(9, 420);
}

function addDays_(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

/** Test the v2 day-tab fill on a scratch copy (run by hand from the editor): testV2('2026-10-30'). Deletes the scratch tab after. */
function testV2(ymd) {
  ymd = ymd || Utilities.formatDate(addDays_(new Date(), -1), TZ, 'yyyy-MM-dd');
  const ss = SpreadsheetApp.getActive(); const d = new Date(ymd + 'T12:00:00');
  const rows = fetch_(ymd); const label = 'TEST V2 ' + ymd;
  const old = ss.getSheetByName(label); if (old) ss.deleteSheet(old);
  const sh = ss.getSheetByName(TEMPLATE).copyTo(ss).setName(label).showSheet();
  const names = rows.filter((r) => !gone_(r)).map((r) => [r.position_code || '', r.full_name.toUpperCase()]);
  sh.getRange(2, 2).setValue('TEST'); sh.getRange(3, 2).setValue(rows[0].title);
  sh.getRange(7, 1, names.length, 2).setValues(names);
  const L = layoutOf_(sh); const people = personRows_(sh, L);
  Logger.log(JSON.stringify({ L: L, people: people.length, rows: rows.length, travel: rows.map((r) => r.travel_h), gas: rows.map((r) => r.gas) }));
  ss.deleteSheet(sh);
}

/** Test adding Travel / Gas to a v2 tab on a scratch copy (run by hand). Logs the result and deletes the scratch tab. */
function testTransport() {
  const ss = SpreadsheetApp.getActive(); const label = 'TEST TRANSPORT';
  const old = ss.getSheetByName(label); if (old) ss.deleteSheet(old);
  const sh = ss.getSheetByName(TEMPLATE).copyTo(ss).setName(label).showSheet();
  sh.getRange(2, 2).setValue('Friday, October 30, 2026'); sh.getRange(3, 2).setValue('TEST - LE ANDOVER'); sh.getRange(6, 2).setValue('START TIME: 4:00PM');
  sh.getRange(7, 1, 2, 4).setValues([[1, 'KANE TEST', 0.6666667, 0.96875], [2, 'EMILY TEST', 0.6666667, 0.7916667]]);
  sh.getRange(9, 4).setValue('FLOOR TOTAL'); sh.getRange(9, 5).setFormula('=SUM(E7:E8)'); sh.getRange(9, 6).setFormula('=SUM(F7:F8)');
  const L = addTransportCols_(sh);
  sh.getRange(7, L.travel, 2, 1).setValues([[2.5], [2.5]]); sh.getRange(7, L.gas).setValue(20);
  SpreadsheetApp.flush();
  Logger.log(JSON.stringify({ L: L, hdr: sh.getRange(5, 1, 1, 9).getValues()[0], r7: sh.getRange(7, 1, 1, 9).getValues()[0], r8: sh.getRange(8, 1, 1, 9).getValues()[0],
    tot: sh.getRange(9, 1, 1, 9).getValues()[0], f7: sh.getRange(7, 1, 1, 9).getFormulas()[0], f9: sh.getRange(9, 1, 1, 9).getFormulas()[0] }));
  ss.deleteSheet(sh);
}

// ───────────────────────────────────────────────────────────────
// Push 28f · EXTRAS LOG

const EXTRAS_TAB = 'EXTRAS LOG';
const XCOLS = { date: 'EVENT DATE', venue: 'VENUE', invoice: 'INVOICE #', details: 'DETAILS', logged: 'LOGGED AT' };

/** Rows the app wants in EXTRAS LOG (confirmed, not logged yet + 5 AM proposals), last 7 days. */
function fetchExtras_(sinceIso) {
  const p = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/extras_log_feed', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: p.getProperty('SUPABASE_KEY'), Authorization: 'Bearer ' + p.getProperty('SUPABASE_KEY') },
    payload: JSON.stringify({ p_token: p.getProperty('SHEET_TOKEN'), p_since: sinceIso }),
  });
  if (res.getResponseCode() === 404) return []; // migration 034 not applied yet
  if (res.getResponseCode() !== 200) throw new Error('Extras feed failed (' + res.getResponseCode() + '): ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function markExtras_(eventId, row, text) {
  const p = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/extras_log_mark', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: p.getProperty('SUPABASE_KEY'), Authorization: 'Bearer ' + p.getProperty('SUPABASE_KEY') },
    payload: JSON.stringify({ p_token: p.getProperty('SHEET_TOKEN'), p_event: eventId, p_row: row, p_text: text }),
  });
  if (res.getResponseCode() >= 300) throw new Error('Extras mark failed (' + res.getResponseCode() + '): ' + res.getContentText());
}

/** Header row of EXTRAS LOG (first of the top 10 rows that has EVENT DATE) → { row, col: { date, venue, … } } (1-based, 0 = missing). */
function extrasHeader_(sh) {
  const top = sh.getRange(1, 1, Math.min(10, Math.max(1, sh.getLastRow())), Math.max(1, sh.getLastColumn())).getValues();
  for (let r = 0; r < top.length; r++) {
    const cells = top[r].map((v) => norm_(v));
    if (cells.indexOf(norm_(XCOLS.date)) < 0) continue;
    const col = {};
    Object.keys(XCOLS).forEach((k) => { col[k] = cells.indexOf(norm_(XCOLS[k])) + 1; });
    if (!col.details) col.details = cells.findIndex((c) => c.indexOf(norm_('EXTRAS')) === 0) + 1; // "EXTRAS / CANCELLATIONS (Ronnie's words)"
    return { row: r + 1, col: col };
  }
  return null;
}

/** Append the app's extras & cancellations to EXTRAS LOG (refresh + menu). Each event once (script property + extras_log_mark). */
function syncExtrasLog() { return syncExtrasLog_(SpreadsheetApp.getActive(), false); }

function syncExtrasLog_(ss, dryRun) {
  const sh = ss.getSheetByName(EXTRAS_TAB);
  if (!sh) { Logger.log('No "' + EXTRAS_TAB + '" tab: nothing written.'); return []; }
  const h = extrasHeader_(sh);
  if (!h || !h.col.date || !h.col.details) { Logger.log('EXTRAS LOG: header row with EVENT DATE and DETAILS not found.'); return []; }
  const rows = fetchExtras_(new Date(Date.now() - 7 * 864e5).toISOString());
  const props = PropertiesService.getScriptProperties();
  const width = Math.max(sh.getLastColumn(), h.col.date, h.col.venue, h.col.invoice, h.col.details, h.col.logged);
  const out = [];
  rows.forEach((r) => {
    if (props.getProperty('xlog_' + r.event_id)) { if (!dryRun) markExtras_(r.event_id, Number(props.getProperty('xlog_' + r.event_id)), r.details); return; } // written before, mark failed then
    const line = new Array(width).fill('');
    const venue = r.venue + (r.department === 'bar' ? ' · BAR' : '');
    const details = r.details + (r.source === 'proposal' ? ' · app proposal (no answer by 5 AM)' : '');
    line[h.col.date - 1] = r.event_date; // text like the rows above (2026-10-10)
    if (h.col.venue) line[h.col.venue - 1] = venue;
    if (h.col.invoice) line[h.col.invoice - 1] = r.invoice_no || '';
    line[h.col.details - 1] = details;
    if (h.col.logged) line[h.col.logged - 1] = Utilities.formatDate(new Date(), 'America/Toronto', 'yyyy-MM-dd HH:mm');
    out.push({ r: r, line: line, details: details });
  });
  if (dryRun) { Logger.log(JSON.stringify({ header: h, rows: out.map((x) => x.line) })); return out; }
  out.forEach((x) => {
    const at = Math.max(sh.getLastRow(), h.row) + 1;
    if (h.col.date) sh.getRange(at, h.col.date).setNumberFormat('@'); // keep dates as text, like the rows above
    if (h.col.logged) sh.getRange(at, h.col.logged).setNumberFormat('@');
    sh.getRange(at, 1, 1, width).setValues([x.line]);
    props.setProperty('xlog_' + x.r.event_id, String(at));
    markExtras_(x.r.event_id, at, x.details);
  });
  return out;
}

/** Run by hand from the editor: shows what would be appended to EXTRAS LOG (writes nothing, marks nothing). */
function testExtrasLog() {
  const out = syncExtrasLog_(SpreadsheetApp.getActive(), true);
  Logger.log((out ? out.length : 0) + ' row(s) would be appended to ' + EXTRAS_TAB);
}
