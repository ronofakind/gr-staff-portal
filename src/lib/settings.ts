import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/*
 * Push 32b · app settings (Admin → More → Settings), stored in `app_settings` (key text pk, value jsonb).
 * Every reader falls back to these defaults (today's values), so the app behaves the same while migration 038
 * isn't applied, while the settings are loading, and for keys a screen can't read (RLS: staff and managers only
 * read the keys listed in STAFF_KEYS, signed-out only "signin.ask_reset").
 */
export type Settings = {
  // Asking staff
  'ask.tiers': { a: number; ab: number }; // headcount 1–a → A · a+1–ab → A+B · more → A+B+C
  'ask.how_many': 'yes_rate';
  'ask.big_date': number; // "Big date" from this many floor staff
  'ask.hold_back': { shifts: number; days: number }; // wave 2 if worked this many shifts in the last N days
  'ask.reply_by_days': number;
  // Bookings & changes
  'bookings.late_cancel': 'after_confirmed';
  'bookings.count_told_ahead': boolean;
  /** Nov 8 · Ronnie: off while start times still come from the Events sheet mapping (wrong time slots). */
  'bookings.count_late': boolean;
  'bookings.running_late': 'event_day' | 'off';
  'bookings.new_tag_shifts': number;
  // Extras
  'extras.rule': { over: number; pct: number };
  'extras.default_billing': 'gr' | 'client';
  /** Push 61 · New event → staffing suggested from the guest count (guests per staff; MD included on the floor). */
  'staffing.ratios': { seated: number; cocktail: number; bar: number; buffer: number; md2: number; small: number };
  // Transport
  'transport.office': string;
  'transport.far_min': number;
  'transport.client_pays': boolean;
  // Hours & pay
  'hours.min': number;
  'hours.rounding': number;
  'hours.show_money': boolean;
  // Ranking weights
  'rank.tier': { A: number; B: number; C: number };
  'rank.reliability': { days: number; start: number; no_show: number; late_cancel: number; late: number; late_change: number };
  'rank.experience': { SENIOR: number; MID: number; JUNIOR: number };
  'rank.feedback': { s5: number; s4: number; s3: number; s2: number; s1: number; cap: number };
  'rank.extras': { bmo: number; newStaff: number; priority: number };
  // Managers
  'mgr.feedback': 'benjamin' | 'all';
  'mgr.announce_window': 'day_before';
  'mgr.undo': 'until_submitted' | 'off';
  'mgr.start_from_h': number;
  // Profile check-up & sign-in (push 31)
  'checkup.emergency': 'skip' | 'required';
  'checkup.home_screen': 'skip' | 'required';
  'checkup.calendar': 'skip' | 'required'; // push 33h · "Add your G&R calendar"
  'signin.code': 'choose' | 'force6';
  'signin.ask_reset': boolean;
};
export type SettingKey = keyof Settings;

export const DEFAULTS: Settings = {
  'ask.tiers': { a: 8, ab: 20 },
  'ask.how_many': 'yes_rate',
  'ask.big_date': 25,
  'ask.hold_back': { shifts: 7, days: 30 },
  'ask.reply_by_days': 2,
  'bookings.late_cancel': 'after_confirmed',
  'bookings.count_told_ahead': false,
  'bookings.count_late': false,
  'bookings.running_late': 'event_day',
  'bookings.new_tag_shifts': 3,
  'extras.rule': { over: 7, pct: 10 },
  'extras.default_billing': 'gr',
  'staffing.ratios': { seated: 15, cocktail: 25, bar: 40, buffer: 15, md2: 300, small: 50 },
  'transport.office': 'C-4865 rue Dagenais',
  'transport.far_min': 45,
  'transport.client_pays': true,
  'hours.min': 4,
  'hours.rounding': 15,
  'hours.show_money': false,
  'rank.tier': { A: 100, B: 60, C: 30 },
  'rank.reliability': { days: 90, start: 6, no_show: -3, late_cancel: -2, late: -1, late_change: -1 },
  'rank.experience': { SENIOR: 3, MID: 2, JUNIOR: 1 },
  'rank.feedback': { s5: 1, s4: 0.5, s3: 0, s2: -1, s1: -2, cap: 10 },
  'rank.extras': { bmo: 2, newStaff: -3, priority: 20 },
  'mgr.feedback': 'benjamin',
  'mgr.announce_window': 'day_before',
  'mgr.undo': 'until_submitted',
  'mgr.start_from_h': 3,
  'checkup.emergency': 'skip',
  'checkup.home_screen': 'skip',
  'checkup.calendar': 'skip',
  'signin.code': 'choose',
  'signin.ask_reset': true,
};

/** Keys staff and manager screens read (same list as the RLS whitelist in migration 038, + checkup.calendar in 039). */
export const STAFF_KEYS: SettingKey[] = ['bookings.running_late', 'bookings.new_tag_shifts', 'hours.min', 'hours.rounding',
  'mgr.feedback', 'mgr.undo', 'mgr.start_from_h', 'checkup.emergency', 'checkup.home_screen', 'checkup.calendar', 'signin.code', 'signin.ask_reset'];
/** Allowed string values (anything else in the table falls back to the default). */
const CHOICES: Partial<Record<SettingKey, string[]>> = {
  'ask.how_many': ['yes_rate'], 'bookings.late_cancel': ['after_confirmed'], 'bookings.running_late': ['event_day', 'off'],
  'extras.default_billing': ['gr', 'client'], 'mgr.feedback': ['benjamin', 'all'], 'mgr.announce_window': ['day_before'],
  'mgr.undo': ['until_submitted', 'off'], 'checkup.emergency': ['skip', 'required'], 'checkup.home_screen': ['skip', 'required'],
  'checkup.calendar': ['skip', 'required'], 'signin.code': ['choose', 'force6'],
};

type Row = { key: string; value: unknown; updated_at?: string | null };
let raw: Record<string, unknown> = {};
let stamp: Record<string, string | null> = {};
let loading: Promise<void> | null = null;
let ready = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

/** The stored value checked against the default's shape (objects merge field by field, numbers must be numbers). */
function clean<K extends SettingKey>(k: K, v: unknown): Settings[K] {
  const d = DEFAULTS[k] as unknown;
  if (v === undefined || v === null) return d as Settings[K];
  if (isObj(d)) {
    if (!isObj(v)) return d as Settings[K];
    const out: Record<string, unknown> = { ...d };
    for (const f of Object.keys(d)) if (typeof v[f] === typeof d[f] && (typeof d[f] !== 'number' || num(v[f]))) out[f] = v[f];
    return out as Settings[K];
  }
  if (typeof d === 'number') return (num(v) ? v : d) as Settings[K];
  if (typeof d === 'boolean') return (typeof v === 'boolean' ? v : d) as Settings[K];
  if (typeof d === 'string') { const ok = CHOICES[k]; return (typeof v === 'string' && (!ok || ok.includes(v)) ? v : d) as Settings[K]; }
  return d as Settings[K];
}

/** Sync read (defaults until loadSettings() has finished). Safe to call from plain functions. */
export function setting<K extends SettingKey>(k: K): Settings[K] { return clean(k, raw[k]); }
/** When a key was last saved (null = never saved / default). */
export const savedAt = (k: SettingKey) => stamp[k] ?? null;
export const settingsReady = () => ready;

/** Loads once and caches. `force` reloads (after sign-in / sign-out, since RLS decides which keys come back). */
export function loadSettings(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    try {
      const { data, error } = await supabase.from('app_settings').select('key,value,updated_at');
      if (!error && Array.isArray(data)) {
        const r: Record<string, unknown> = {}; const s: Record<string, string | null> = {};
        for (const row of data as Row[]) if (row && typeof row.key === 'string') { r[row.key] = row.value; s[row.key] = row.updated_at ?? null; }
        raw = r; stamp = s;
      }
    } catch { /* table missing (038 not applied) or offline → defaults */ }
    ready = true; notify();
  })();
  return loading;
}

/** Admin only (RLS): save one key. */
export async function saveSetting<K extends SettingKey>(k: K, value: Settings[K]) {
  const { data, error } = await supabase.from('app_settings').upsert({ key: k, value, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select('key,value,updated_at').maybeSingle();
  if (error) throw error;
  raw = { ...raw, [k]: value }; stamp = { ...stamp, [k]: (data as Row | null)?.updated_at ?? new Date().toISOString() }; notify();
}

/** Re-renders when settings load or change. `s('hours.min')` → value with today's default as fallback. */
export function useSettings() {
  const [, setV] = useState(0);
  useEffect(() => { const f = () => setV((n) => n + 1); subs.add(f); loadSettings(); return () => { subs.delete(f); }; }, []);
  return setting;
}
/** Subscribe outside React (App uses it to re-render the tree once settings arrive). */
export function onSettings(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

// ── Helpers used by several screens ──
/** Headcount → tiers to ask (1–8 A · 9–20 A+B · 21+ A+B+C by default). */
export const tiersForCount = (n: number): ('A' | 'B' | 'C')[] => { const t = setting('ask.tiers'); return n <= t.a ? ['A'] : n <= t.ab ? ['A', 'B'] : ['A', 'B', 'C']; };
/** Auto extras for a floor headcount: over 7 → 10 % rounded up. */
export const autoExtras = (floor: number) => { const r = setting('extras.rule'); return floor > r.over ? Math.ceil((floor * r.pct) / 100) : 0; };
/** Paid hours from real hours: rounding (min) and minimum (h). */
export const roundTo = (ms: number) => { const r = Math.max(1, setting('hours.rounding')); return (Math.round(ms / (r * 60000)) * r) / 60; };
