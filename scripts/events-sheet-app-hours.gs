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
  buildTomorrow();
  refresh();
}

function buildTomorrow() { syncDate_(addDays_(new Date(), 1)); }

function refresh() {
  const now = new Date();
  syncDate_(now);
  if (Number(Utilities.formatDate(now, TZ, 'H')) < 6) syncDate_(addDays_(now, -1));
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
  const res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/hours_sheet', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: p.getProperty('SUPABASE_KEY'), Authorization: 'Bearer ' + p.getProperty('SUPABASE_KEY') },
    payload: JSON.stringify({ p_token: p.getProperty('SHEET_TOKEN'), p_date: ymd }),
  });
  if (res.getResponseCode() !== 200) throw new Error('App feed failed (' + res.getResponseCode() + '): ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

const BAR = { BM: 1, BB: 1, BT: 1 };
const q15 = (iso) => new Date(Math.round(new Date(iso).getTime() / 900000) * 900000);
const dayFrac = (dt) => { const [h, m] = Utilities.formatDate(dt, TZ, 'H:m').split(':').map(Number); return (h * 60 + m) / 1440; };
const ampm = (iso) => Utilities.formatDate(new Date(iso), TZ, 'h:mma').toUpperCase();

function write_(ss, name, d, rows) {
  // 1. Fresh copy of BLANK TEMPLATE, placed right after the date's own tab.
  const old = ss.getSheetByName(name);
  if (old) ss.deleteSheet(old);
  const sh = ss.getSheetByName(TEMPLATE).copyTo(ss).setName(name).showSheet();
  const own = ss.getSheetByName(Utilities.formatDate(d, TZ, 'MMMM d').toUpperCase());
  ss.setActiveSheet(sh); ss.moveActiveSheet(own ? own.getIndex() + 1 : 2);
  sh.setTabColor('#9B2226');

  // 2. Group: event → floor / bar → start time.
  const events = [];
  rows.forEach((r) => {
    let ev = events.find((e) => e.title === r.title && e.address === r.address);
    if (!ev) { ev = { title: r.title, address: r.address, blocks: { floor: [], bar: [] } }; events.push(ev); }
    ev.blocks[BAR[r.position_code] || r.department === 'bar' ? 'bar' : 'floor'].push(r);
  });

  // 3. Write values, copying the template's row formats (row 2 date, 3 title, 4 dept, 5 header, 6 start time, 7 person).
  const out = []; const fmt = []; const totals = [];
  const push = (vals, f) => { out.push(vals.concat(Array(7 - vals.length).fill(''))); fmt.push(f); };
  const dateVal = new Date(Utilities.formatDate(d, TZ, 'yyyy-MM-dd') + 'T12:00:00');
  push([], 1);
  events.forEach((ev) => {
    ['floor', 'bar'].forEach((kind) => {
      const list = ev.blocks[kind]; if (!list.length) return;
      const where = (ev.title + (ev.address ? ' - ' + ev.address.split(',')[0] : '') + (kind === 'bar' ? ' - BAR' : '')).toUpperCase();
      push([dateVal], 2); push([where], 3); push([kind === 'bar' ? 'BAR STAFF' : 'FLOOR STAFF'], 4);
      push(['Name', '', '', 'Start Time', 'End Time', 'Total', 'Note'], 5);
      const first = out.length + 1; let n = 0; let start = null;
      list.forEach((r) => {
        if (r.planned_start !== start) { start = r.planned_start; n = 0; push(['START TIME: ' + ampm(start)], 6); }
        const gone = r.attendance === 'no_show' || r.attendance === 'cancelled';
        const code = BAR[r.position_code] || r.position_code === 'MD' ? r.position_code : (kind === 'bar' ? (r.position_code || '') : ++n);
        const row = out.length + 1;
        push([code, r.full_name.toUpperCase(), !gone && !!r.punch_in,
          !gone && r.punch_in ? dayFrac(q15(r.punch_in)) : '',
          !gone && r.punch_out ? dayFrac(q15(r.punch_out)) : '',
          totalF_(row), gone ? noteFor_(r) : ''], 7);
      });
      const last = out.length;
      push(['', '', '', '', kind === 'bar' ? 'BAR STAFF TOTAL' : 'FLOOR STAFF TOTAL', '=SUM(F' + first + ':F' + last + ')'], 7);
      totals.push('F' + out.length);
      push([], 1);
    });
  });
  push(['', '', '', '', 'COMBINED', '=SUM(' + totals.join(',') + ')'], 7);

  const n = out.length;
  sh.getRange(1, 1, sh.getMaxRows(), 7).clearContent();
  sh.getRange(1, 3, sh.getMaxRows(), 1).clearDataValidations();
  sh.getRange(1, 1, n, 7).breakApart();
  sh.getRange(1, 1, n, 7).setValues(out);
  const NAVY = '#1F4E78', BLUE = '#D9EAF6', GREY = '#EDEDED', GREEN = '#E0EFD9';
  const band = (i, cols, bg, color) => sh.getRange(i + 1, 1, 1, cols).merge().setBackground(bg).setFontColor(color || '#000000')
    .setFontWeight('bold').setHorizontalAlignment('center');
  fmt.forEach((f, i) => {
    const row = sh.getRange(i + 1, 1, 1, 6);
    if (f !== 7) row.clearDataValidations();
    if (f === 1 && i === 0) band(i, 6, NAVY);
    else if (f === 1) row.setBackground('#FFFFFF').setBorder(false, false, false, false, false, false);
    else if (f === 2) { band(i, 6, NAVY, '#FFFFFF'); sh.getRange(i + 1, 1).setNumberFormat('dddd, mmmm d, yyyy'); }
    else if (f === 3) band(i, 6, BLUE);
    else if (f === 4) band(i, 6, NAVY, '#FFFFFF');
    else if (f === 5) { band(i, 3, GREY); sh.getRange(i + 1, 4, 1, 4).setBackground(GREY).setFontWeight('bold').setHorizontalAlignment('center'); }
    else if (f === 6) band(i, 6, GREEN);
  });
  out.forEach((r, i) => { if (fmt[i] === 7 && r[1]) sh.getRange(i + 1, 3).insertCheckboxes(); });
  out.forEach((r, i) => { if (/TOTAL|COMBINED/.test(r[4])) sh.getRange(i + 1, 5, 1, 2).setFontWeight('bold'); });
  sh.deleteRows(n + 3, sh.getMaxRows() - n - 2);
}

// ── Day tab + payroll ─────────────────────────────────────────

const totalF_ = (row) => '=IF(OR(D' + row + '="",E' + row + '=""),"",LET(h,24*MOD(TIMEVALUE(E' + row + ')-TIMEVALUE(D' + row + '),1),IF(ISNUMBER(SEARCH("LEFT EARLY",G' + row + ')),h,MAX(4,h))))';
const noteFor_ = (r) => r.attendance === 'no_show' ? 'NO SHOW' : r.attendance === 'cancelled' ? 'CANCELLED' : r.attendance === 'left_early' ? 'LEFT EARLY' : '';
const norm_ = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
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
  if (!day) { issues.push('No ' + label + ' tab, so hours were not copied to it or to payroll.'); return issues; }

  const pay = [];
  done.forEach((id) => {
    ['floor', 'bar'].forEach((kind) => {
      const team = byEvent[id].filter((r) => (BAR[r.position_code] || r.department === 'bar' ? 'bar' : 'floor') === kind);
      if (!team.length) return;
      const what = team[0].title + (kind === 'bar' ? ' bar' : '');
      let people = personRows_(day);
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
          day.getRange(last, 1, 1, 7).copyTo(day.getRange(last + 1, 1, 1, 7), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
          day.getRange(last + 1, 1, 1, 3).setValues([[r.position_code || '', name, !gone_(r)]]);
          day.getRange(last + 1, 6).setFormula(totalF_(last + 1));
          issues.push('Added ' + name + ' to the ' + label + ' tab (in the app team, was not on the tab).');
          people = personRows_(day); p = find_(inBlock(), r.full_name);
        }
        const key = (c) => block + '|' + p.name + '|' + c;
        const set = (col, val, prefill) => {
          const cell = day.getRange(p.row, col); const cur = cell.getValue();
          if (val === '' || cur === val || (col < 6 && sameTime_(cur, val))) return;
          const mine = wrote[key(col)] !== undefined && (cur === wrote[key(col)] || (col < 6 && sameTime_(cur, wrote[key(col)])));
          if (cur === '' || mine || (prefill && sameTime_(cur, prefill))) {
            if (col < 6) cell.setNumberFormat('h":"mm" "am/pm').setValue(tv_(val)); else cell.setValue(val);
            wrote[key(col)] = val;
          } else issues.push(name + ': the tab says ' + (cur instanceof Date ? txt_(cur) : cur) + ', the app says ' + val + '. Left the tab as is.');
        };
        if (gone_(r)) { set(7, noteFor_(r)); return; }
        const planned = new Date(r.planned_start);
        let start = q15(r.punch_in);
        const early = Math.round((planned - start) / 60000);
        const curStart = day.getRange(p.row, 4).getValue();
        if (early >= EARLY_MIN && sameTime_(curStart, txt_(start))) { /* early start already OK'd on the tab */ }
        else if (early >= EARLY_MIN) {
          issues.push(name + ' was started ' + early + ' min before call (' + txt_(start) + ', call ' + txt_(planned) + '). Written as ' + txt_(planned) + '; change it on the tab if they really started early.');
          start = planned;
        }
        set(4, txt_(start), txt_(planned));
        set(5, txt_(q15(r.punch_out)));
        if (r.attendance === 'left_early') set(7, 'LEFT EARLY');
        pay.push({ name: name, row: p.row });
      });
    });
  });
  SpreadsheetApp.flush();
  const f = day.getRange(1, 6, day.getLastRow(), 1).getValues();
  const hours = pay.filter((x) => typeof f[x.row - 1][0] === 'number').map((x) => ({ name: x.name, h: Math.round(f[x.row - 1][0] * 4) / 4 }));
  pay.filter((x) => typeof f[x.row - 1][0] !== 'number').forEach((x) => issues.push(x.name + ': the Total on the ' + label + ' tab is not a number, not added to payroll.'));
  payroll_(d, hours, issues, wrote);
  props.setProperty('wrote_' + ymd, JSON.stringify(wrote));
  return issues;
}

/** Person rows on a day tab: { row, name, block } where block = the FLOOR STAFF / BAR STAFF row above them. */
function personRows_(sh) {
  const v = sh.getRange(1, 1, sh.getLastRow(), 5).getValues();
  const out = []; let block = -1;
  v.forEach((r, i) => {
    if (/^(FLOOR|BAR) STAFF$/i.test(String(r[0]).trim())) { block = i + 1; return; }
    if (block < 0 || !r[1] || /^name$/i.test(String(r[0]).trim()) || /TOTAL|COMBINED/i.test(String(r[4]))) return;
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

function payroll_(d, hours, issues, wrote) {
  if (!hours.length) return;
  const mon = Utilities.formatDate(d, TZ, 'MMM').toLowerCase(); const dd = Number(Utilities.formatDate(d, TZ, 'd'));
  const label = Utilities.formatDate(d, TZ, 'MMM d');
  const ps = SpreadsheetApp.openById(PAYROLL_ID);
  let sh = null; let col = -1;
  ps.getSheets().filter((s) => /^Payroll /i.test(s.getName())).forEach((s) => {
    if (sh) return;
    const hdr = s.getRange(1, 1, 1, s.getLastColumn()).getDisplayValues()[0];
    const i = hdr.findIndex((h) => { const m = String(h).trim().match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2})(st|nd|rd|th)?$/); return m && m[1].toLowerCase() === mon && Number(m[2]) === dd; });
    if (i >= 0) { sh = s; col = i + 1; }
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
