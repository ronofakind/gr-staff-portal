/**
 * G&R — "APP · <DATE>" tabs in Events 2026, filled from the staff app.
 *
 * Paste this whole file into Events 2026 → Extensions → Apps Script (replace what's there), then:
 *   1. Project Settings (gear) → Script properties → add:
 *        SUPABASE_URL  = https://oigqdecyhmeuvrpoikdv.supabase.co
 *        SUPABASE_KEY  = the "anon public" key (Supabase → Project Settings → API)
 *        SHEET_TOKEN   = the value of sheet_token (Supabase → Table Editor → app_secrets)
 *   2. Pick "setup" in the function menu, click Run, and allow access. Done.
 *
 * What it does (America/Toronto):
 *   - 11:30 AM every day: builds tomorrow's tab (team + start times, no hours yet).
 *   - Every 15 min: refreshes today's tab, and yesterday's until 6 AM (events past midnight).
 *     A tab is only rewritten when something changed in the app.
 * Hours go on the tab of the date the event STARTED. It only reads from the app; it never writes back.
 */
const TZ = 'America/Toronto';
const TEMPLATE = 'BLANK TEMPLATE';

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
  props.setProperty('sig_' + ymd, sig);
}

function fetch_(ymd) {
  const p = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(p.getProperty('SUPABASE_URL') + '/rest/v1/rpc/hours_sheet', {
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
  const push = (vals, f) => { out.push(vals.concat(Array(6 - vals.length).fill(''))); fmt.push(f); };
  const dateVal = new Date(Utilities.formatDate(d, TZ, 'yyyy-MM-dd') + 'T12:00:00');
  push([], 1);
  events.forEach((ev) => {
    ['floor', 'bar'].forEach((kind) => {
      const list = ev.blocks[kind]; if (!list.length) return;
      const where = (ev.title + (ev.address ? ' - ' + ev.address.split(',')[0] : '') + (kind === 'bar' ? ' - BAR' : '')).toUpperCase();
      push([dateVal], 2); push([where], 3); push([kind === 'bar' ? 'BAR STAFF' : 'FLOOR STAFF'], 4);
      push(['Name', '', '', 'Start Time', 'End Time', 'Total'], 5);
      const first = out.length + 1; let n = 0; let start = null;
      list.forEach((r) => {
        if (r.planned_start !== start) { start = r.planned_start; n = 0; push(['START TIME: ' + ampm(start)], 6); }
        const gone = r.attendance === 'no_show' || r.attendance === 'cancelled';
        const code = BAR[r.position_code] || r.position_code === 'MD' ? r.position_code : (kind === 'bar' ? (r.position_code || '') : ++n);
        const row = out.length + 1;
        push([code, r.full_name.toUpperCase(), !gone,
          !gone && r.punch_in ? dayFrac(q15(r.punch_in)) : '',
          !gone && r.punch_out ? dayFrac(q15(r.punch_out)) : '',
          '=IF(OR(D' + row + '="",E' + row + '=""),"",24*MOD(TIMEVALUE(E' + row + ')-TIMEVALUE(D' + row + '),1))'], 7);
      });
      const last = out.length;
      push(['', '', '', '', kind === 'bar' ? 'BAR STAFF TOTAL' : 'FLOOR STAFF TOTAL', '=SUM(F' + first + ':F' + last + ')'], 7);
      totals.push('F' + out.length);
      push([], 1);
    });
  });
  push(['', '', '', '', 'COMBINED', '=SUM(' + totals.join(',') + ')'], 7);

  const n = out.length;
  const S = 919; // scratch rows 919-925 keep the template's formats for rows 1-7 while we write
  sh.getRange(1, 1, 7, 6).copyFormatToRange(sh, 1, 6, S, S + 6);
  sh.getRange(1, 1, S - 1, 6).clearContent();
  sh.getRange(1, 3, S - 1, 1).clearDataValidations();
  fmt.forEach((f, i) => sh.getRange(S + f - 1, 1, 1, 6).copyFormatToRange(sh, 1, 6, i + 1, i + 1));
  sh.getRange(1, 1, n, 6).setValues(out);
  out.forEach((r, i) => { if (fmt[i] === 7 && r[1]) sh.getRange(i + 1, 3).insertCheckboxes(); });
  out.forEach((r, i) => { if (/TOTAL|COMBINED/.test(r[4])) sh.getRange(i + 1, 5, 1, 2).setFontWeight('bold'); });
  sh.deleteRows(n + 3, sh.getMaxRows() - n - 2);
}

function addDays_(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
