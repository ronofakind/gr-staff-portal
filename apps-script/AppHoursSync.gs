/**
 * G&R staff app → Staff Payroll 2026
 * Every night at 5 AM (Montreal) this copies the hours managers entered in the staff app
 * into the matching payroll tab + date column.
 *
 * Rules
 *  - Only fills empty cells, or cells this script wrote before (so app corrections flow through).
 *  - If you typed a different number in a cell yourself, your number wins and the sync leaves it alone.
 *  - No-shows / cancelled get nothing. Everything is written to the "App sync log" tab.
 *  - Looks back 7 days, so late fixes by the manager are picked up the next night.
 */
const SB_URL = 'https://oigqdecyhmeuvrpoikdv.supabase.co';
const TZ = 'America/Toronto';
const LOOKBACK_DAYS = 7;
const LOG_TAB = 'App sync log';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Staff app')
    .addItem('Sync hours now', 'syncAppHours')
    .addSeparator()
    .addItem('Setup: paste keys…', 'setupKeys')
    .addItem('Setup: turn on 5 AM sync', 'installNightlyTrigger')
    .addToUi();
}

function setupKeys() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const a = ui.prompt('Staff app sync (1/2)', 'Paste the Supabase publishable (anon) key:', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  const b = ui.prompt('Staff app sync (2/2)', 'Paste the payroll token (from the Supabase SQL query):', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;
  props.setProperty('SB_KEY', a.getResponseText().trim());
  props.setProperty('PAYROLL_TOKEN', b.getResponseText().trim());
  ui.alert('Saved. Now use Staff app → "Sync hours now" to test.');
}

function installNightlyTrigger() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'syncAppHours').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncAppHours').timeBased().atHour(5).nearMinute(0).everyDays(1).inTimezone(TZ).create();
  try { SpreadsheetApp.getUi().alert('Done. Hours will sync every night around 5 AM.'); } catch (e) { /* run from editor */ }
}

function syncAppHours() {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('SB_KEY'); const token = props.getProperty('PAYROLL_TOKEN');
  if (!key || !token) throw new Error('Run Staff app → Setup: paste keys first.');

  const fmt = (d) => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const to = new Date(); const from = new Date(to.getTime() - LOOKBACK_DAYS * 864e5);
  const res = UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/payroll_export', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify({ p_token: token, p_from: fmt(from), p_to: fmt(to) }),
  });
  if (res.getResponseCode() !== 200) throw new Error('App returned ' + res.getResponseCode() + ': ' + res.getContentText());
  const rows = JSON.parse(res.getContentText()); // [{event_date, full_name, hours, event_title}]

  const ss = SpreadsheetApp.getActive();
  const log = ss.getSheetByName(LOG_TAB) || (() => {
    const s = ss.insertSheet(LOG_TAB); s.appendRow(['When', 'Event date', 'Name', 'Hours', 'Tab', 'Cell', 'Result', 'Event']); s.setFrozenRows(1); return s;
  })();
  // What this script wrote before: key "tab!cell" -> value
  const prev = {};
  log.getDataRange().getValues().slice(1).forEach((r) => { if (String(r[6]).indexOf('written') === 0 || r[6] === 'updated') prev[r[4] + '!' + r[5]] = Number(r[3]); });

  const tabs = ss.getSheets().filter((s) => /^payroll/i.test(s.getName()));
  const cache = {};
  const out = [];
  const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');

  rows.forEach((r) => {
    const hours = Math.round(Number(r.hours) * 100) / 100;
    const target = findCell(tabs, cache, r.event_date, r.full_name);
    if (!target.sheet) { out.push([now, r.event_date, r.full_name, hours, target.tab || '', '', target.reason, r.event_title]); return; }
    const cell = target.sheet.getRange(target.row, target.col);
    const a1 = cell.getA1Notation(); const k = target.sheet.getName() + '!' + a1;
    const cur = cell.getValue();
    let result;
    if (cur === '' || cur === null) { cell.setValue(hours); result = 'written'; }
    else if (Number(cur) === hours) { result = 'already there'; }
    else if (prev[k] !== undefined && Number(cur) === prev[k]) { cell.setValue(hours); result = 'updated'; }
    else { result = 'kept your value (' + cur + ')'; }
    if (result !== 'already there') out.push([now, r.event_date, r.full_name, hours, target.sheet.getName(), a1, result, r.event_title]);
  });
  if (out.length) log.getRange(log.getLastRow() + 1, 1, out.length, out[0].length).setValues(out);
  else log.appendRow([now, '', '', '', '', '', 'nothing new', '']);
}

/* ---------- matching helpers (tolerant to reordered tabs, columns and rows) ---------- */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
}

function findCell(tabs, cache, isoDate, name) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const mon = MONTHS[m - 1];
  for (const sh of tabs) {
    const title = sh.getName().toLowerCase();
    if (title.indexOf(String(y)) < 0 || title.indexOf(mon) < 0) continue;
    const info = cache[sh.getName()] || (cache[sh.getName()] = readTab(sh));
    const col = info.dates[mon + '-' + d];
    if (!col) continue;
    const want = norm(name);
    let row = 0;
    for (const p of info.people) {
      const same = p.tokens.length === want.length && want.every((t) => p.tokens.indexOf(t) >= 0);
      if (same) { row = p.row; break; }
    }
    if (!row) {
      const loose = info.people.filter((p) => want.every((t) => p.tokens.indexOf(t) >= 0));
      if (loose.length === 1) row = loose[0].row;
    }
    if (!row) return { tab: sh.getName(), reason: 'NAME NOT FOUND in tab' };
    return { sheet: sh, row: row, col: col };
  }
  return { reason: 'NO TAB / DATE COLUMN for ' + isoDate };
}

function readTab(sh) {
  const values = sh.getDataRange().getValues();
  const dates = {};
  (values[0] || []).forEach((v, i) => {
    let mon, day;
    if (v instanceof Date) { mon = MONTHS[v.getMonth()]; day = v.getDate(); }
    else {
      const m = String(v).trim().toLowerCase().match(/^([a-z]+)\.?\s*(\d{1,2})(st|nd|rd|th)?$/);
      if (m) { mon = m[1].slice(0, 3); day = Number(m[2]); }
    }
    if (mon && day) dates[mon + '-' + day] = i + 1;
  });
  const people = [];
  for (let r = 2; r < values.length; r++) {
    const n = values[r][1];
    if (n) people.push({ row: r + 1, tokens: norm(n) });
  }
  return { dates, people };
}
