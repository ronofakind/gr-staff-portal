/**
 * Push 44 · compare what the Events sheet says (sheet_events, posted by the sheet script every 10 min)
 * with the app's events, and list each difference as a "Sheet change" card. Pure: no database calls.
 */
export type SheetStaff = { name: string; code: string; start: string | null; row?: number };
export type SheetEvent = {
  id: number; event_date: string; department: 'floor' | 'bar'; title: string; venue: string | null; address: string | null;
  details: string[]; lines: { code: string; start: string | null; count: number }[]; staff: SheetStaff[]; sheet_row: number | null;
};
export type DStaff = { id: string; full_name: string; nickname?: string | null; active: boolean };
export type DShift = {
  id: string; event_id: string; staff_id: string; position_code: string | null; planned_start: string; status: string;
  attendance: string | null; notified_at: string | null; cancelled_at?: string | null; punches: { punch_in: string | null } | null;
};
export type DEvent = {
  id: string; event_date: string; title: string; department: string; address: string | null; venue_id: string | null;
  sheet_ref?: string | null; event_private: { client: string | null } | null; shifts: DShift[];
};

export type Change =
  | { kind: 'added'; key: string; sig: string; e: DEvent; staffId: string; name: string; code: string; start: string; from?: { e: DEvent; s: DShift } }
  | { kind: 'removed'; key: string; sig: string; e: DEvent; s: DShift; name: string }
  | { kind: 'time'; key: string; sig: string; e: DEvent; old: string; new: string; people: { s: DShift; name: string }[] }
  | { kind: 'new_event'; key: string; sig: string; se: SheetEvent; staff: { staffId: string; code: string; start: string | null }[]; unmatched: string[] }
  | { kind: 'check_name'; key: string; sig: string; se: SheetEvent; name: string; e: DEvent | null; code: string; start: string | null; suggest: DStaff[] };

/** Upper case, no accents, letters and spaces only. */
export const norm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** "HH:MM" Montreal time of an ISO timestamp. */
export const mtlHm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const STOP = new Set(['LE', 'LA', 'LES', 'DE', 'DU', 'DES', 'THE', 'AND', 'ET', 'C', 'BAR', 'SERVICE', 'EVENT']);
const toks = (s: string | null | undefined) => norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t));
/** Shared words (a word counts when one starts with the other, 4+ letters, e.g. PRINCIPAL ~ PRINCIPALE). */
export function sim(a: string | null | undefined, b: string | null | undefined) {
  const A = toks(a); const B = toks(b); if (!A.length || !B.length) return 0;
  let n = 0;
  for (const x of A) if (B.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))) n++;
  return n / Math.max(A.length, B.length);
}

export function staffMatcher(staff: DStaff[], aliases: { alias: string; staff_id: string }[]) {
  const by = new Map<string, string | null>(); // null = ambiguous
  const put = (k: string, id: string) => { if (!k) return; by.set(k, by.has(k) && by.get(k) !== id ? null : id); };
  const act = staff.filter((s) => s.active);
  for (const s of act) put(norm(s.full_name), s.id);
  const firstLast = (n: string) => { const w = n.split(' '); return w.length > 1 ? w[0] + ' ' + w[w.length - 1] : ''; };
  const fl = new Map<string, string | null>();
  for (const s of act) { const k = firstLast(norm(s.full_name)); if (k) fl.set(k, fl.has(k) && fl.get(k) !== s.id ? null : s.id); }
  const al = new Map(aliases.map((a) => [a.alias, a.staff_id]));
  const nick = new Map<string, string | null>();
  for (const s of act) if (s.nickname) { const k = norm(s.nickname); nick.set(k, nick.has(k) ? null : s.id); }
  return {
    match(name: string): string | null {
      const n = norm(name);
      return al.get(n) ?? by.get(n) ?? fl.get(firstLast(n)) ?? nick.get(n) ?? null;
    },
    suggest(name: string): DStaff[] {
      const n = norm(name);
      return act.map((s) => ({ s, v: sim(n, s.full_name) + (s.nickname && norm(s.nickname) === n ? 1 : 0) + (norm(s.full_name).startsWith(n.split(' ')[0] ?? '') ? 0.2 : 0) }))
        .filter((x) => x.v > 0.2).sort((a, b) => b.v - a.v).slice(0, 3).map((x) => x.s);
    },
  };
}

const live = (s: DShift) => s.status !== 'declined' && !s.attendance && !s.cancelled_at;

/** Pair each sheet block with an app event (same date + department), best name match first. */
export function pairEvents(sheet: SheetEvent[], app: DEvent[], match: (name: string) => string | null) {
  const pairs = new Map<number, DEvent>();
  const groups = new Map<string, { s: SheetEvent[]; a: DEvent[] }>();
  for (const s of sheet) { const k = s.event_date + '|' + s.department; if (!groups.has(k)) groups.set(k, { s: [], a: [] }); groups.get(k)!.s.push(s); }
  for (const a of app) { const k = a.event_date + '|' + (a.department === 'bar' ? 'bar' : 'floor'); groups.get(k)?.a.push(a); }
  for (const { s, a } of groups.values()) {
    if (s.length === 1 && a.length === 1) { pairs.set(s[0].id, a[0]); continue; }
    const cand: { x: SheetEvent; y: DEvent; v: number }[] = [];
    for (const x of s) {
      const ids = new Set(x.staff.map((p) => match(p.name)).filter(Boolean) as string[]);
      for (const y of a) {
        const live = y.shifts.filter((sh) => sh.status !== 'declined');
        const overlap = live.length && ids.size ? live.filter((sh) => ids.has(sh.staff_id)).length / Math.max(live.length, ids.size) : 0;
        const v = (x.sheet_row && y.sheet_ref === `EVENTS!A${x.sheet_row}` ? 5 : 0)
          + Math.max(sim(x.venue, y.title), sim(x.title, y.title)) * 2 + sim(x.title, y.event_private?.client) + overlap * 2;
        cand.push({ x, y, v });
      }
    }
    cand.sort((p, q) => q.v - p.v);
    const usedS = new Set<number>(); const usedA = new Set<string>();
    for (const c of cand) if (c.v > 0.3 && !usedS.has(c.x.id) && !usedA.has(c.y.id)) { pairs.set(c.x.id, c.y); usedS.add(c.x.id); usedA.add(c.y.id); }
  }
  return pairs;
}

export function diff(sheet: SheetEvent[], app: DEvent[], staff: DStaff[], aliases: { alias: string; staff_id: string }[]): Change[] {
  const m = staffMatcher(staff, aliases);
  const nameOf = new Map(staff.map((s) => [s.id, s.full_name]));
  const pairs = pairEvents(sheet, app, m.match);
  const out: Change[] = [];
  // who the sheet puts where, per date (to tell a move from an add + a remove)
  const sheetDay = new Map<string, Map<string, SheetEvent>>(); // date → staffId → block
  for (const se of sheet) for (const p of se.staff) {
    const id = m.match(p.name); if (!id) continue;
    if (!sheetDay.has(se.event_date)) sheetDay.set(se.event_date, new Map());
    if (!sheetDay.get(se.event_date)!.has(id)) sheetDay.get(se.event_date)!.set(id, se);
  }
  const appDay = new Map<string, { e: DEvent; s: DShift }[]>(); // date → live shifts
  for (const e of app) for (const s of e.shifts) if (live(s)) { if (!appDay.has(e.event_date)) appDay.set(e.event_date, []); appDay.get(e.event_date)!.push({ e, s }); }

  for (const se of sheet) {
    const e = pairs.get(se.id) ?? null;
    const seen = new Set<string>(); const want: { id: string; p: SheetStaff }[] = []; const unmatched: SheetStaff[] = [];
    for (const p of se.staff) { const id = m.match(p.name); if (!id) { unmatched.push(p); continue; } if (!seen.has(id)) { seen.add(id); want.push({ id, p }); } }
    for (const p of unmatched) {
      const key = `sheet:name:${se.event_date}:${se.department}:${norm(p.name)}`;
      out.push({ kind: 'check_name', key, sig: norm(p.name), se, name: p.name, e, code: p.code, start: p.start, suggest: m.suggest(p.name) });
    }
    if (!e) {
      if (!se.staff.length && !se.lines.length) continue;
      const sig = JSON.stringify([se.title, se.venue, want.map((w) => w.id + w.p.code + w.p.start).sort()]);
      out.push({ kind: 'new_event', key: `sheet:new:${se.event_date}:${se.department}:${norm(se.title)}`, sig, se,
        staff: want.map((w) => ({ staffId: w.id, code: w.p.code, start: w.p.start })), unmatched: unmatched.map((u) => u.name) });
      continue;
    }
    const mine = e.shifts.filter(live);
    // added (or moved here from another event the same day)
    for (const { id, p } of want) {
      if (mine.some((s) => s.staff_id === id)) continue;
      const other = (appDay.get(e.event_date) ?? []).find((x) => x.s.staff_id === id && x.e.id !== e.id);
      const start = p.start ?? mtlHm(mine[0]?.planned_start ?? new Date().toISOString());
      out.push({ kind: 'added', key: `sheet:add:${e.id}:${id}`, sig: p.code + start + (other?.e.id ?? ''), e, staffId: id, name: nameOf.get(id) ?? p.name, code: p.code, start, from: other });
    }
    // removed (not when the sheet has them on another event that day: that's the move above)
    for (const s of mine) {
      if (seen.has(s.staff_id) || s.punches?.punch_in) continue;
      const elsewhere = sheetDay.get(e.event_date)?.get(s.staff_id);
      if (elsewhere && elsewhere.id !== se.id && pairs.get(elsewhere.id)) continue;
      out.push({ kind: 'removed', key: `sheet:rm:${e.id}:${s.staff_id}`, sig: s.id, e, s, name: nameOf.get(s.staff_id) ?? '?' });
    }
    // start time changed, grouped by old → new
    const byMove = new Map<string, { s: DShift; name: string }[]>();
    for (const { id, p } of want) {
      const s = mine.find((x) => x.staff_id === id); if (!s || !p.start || s.punches?.punch_in) continue;
      const old = mtlHm(s.planned_start); if (old === p.start) continue;
      const k = old + '>' + p.start; if (!byMove.has(k)) byMove.set(k, []); byMove.get(k)!.push({ s, name: nameOf.get(id) ?? p.name });
    }
    for (const [k, people] of byMove) {
      const [old, nw] = k.split('>');
      out.push({ kind: 'time', key: `sheet:time:${e.id}:${old}`, sig: nw + '|' + people.map((x) => x.s.id).sort().join(','), e, old, new: nw, people });
    }
  }
  const order = { new_event: 0, added: 1, removed: 2, time: 3, check_name: 4 } as const;
  return out.sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || order[a.kind] - order[b.kind]);
}
export const dateOf = (c: Change) => ('e' in c && c.e ? c.e.event_date : (c as { se: SheetEvent }).se.event_date);
