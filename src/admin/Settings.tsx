import { useState } from 'react';
import { DEFAULTS, saveSetting, savedAt, useSettings, type SettingKey, type Settings as S } from '../lib/settings';
import { signed } from './score';

/*
 * Push 32b · Admin → More → Settings. Tap a value to change it; it saves right away and applies to new events and
 * asks from now on. Rows marked "fixed" are rules in the code (shown so the whole picture is in one place);
 * "saved · not used yet" rows are stored for later pushes and change nothing today.
 */
type Field = { f: string; label: string; unit?: string; step?: number };
type Row = {
  label: string; sub?: string;
  k?: SettingKey; show: (v: never) => string;
  kind?: 'num' | 'choice' | 'bool' | 'obj' | 'text';
  unit?: string; min?: number; max?: number; step?: number;
  choices?: [string | number, string][]; fields?: Field[];
  /** stored, shown, but nothing in the app reads it yet */
  storedOnly?: boolean;
};
type Section = { title: string; sub?: string; off?: string; rows: Row[] };

const n = (x: number) => String(x).replace('-', '−');
const rangeTiers = (t: S['ask.tiers']) => `1–${t.a} A · ${t.a + 1}–${t.ab} A+B · ${t.ab + 1}+ A+B+C`;

const SECTIONS: Section[] = [
  { title: 'Asking staff', sub: 'availability asks', rows: [
    { label: 'Tiers asked by headcount', k: 'ask.tiers', kind: 'obj', show: rangeTiers as (v: never) => string, fields: [{ f: 'a', label: 'A only up to', unit: 'staff' }, { f: 'ab', label: 'A+B up to', unit: 'staff' }] },
    { label: 'Ask how many', sub: 'based on each person’s yes rate', show: () => 'enough for the yes needed' },
    { label: '“Big date”', sub: 'for “only big dates” people', k: 'ask.big_date', kind: 'num', unit: 'waiters', min: 5, max: 200, show: ((v: number) => `${v}+ waiters`) as (v: never) => string },
    { label: 'Hold back if worked', sub: 'go to wave 2', k: 'ask.hold_back', kind: 'obj', show: ((v: S['ask.hold_back']) => `${v.shifts}+ shifts / ${v.days} days`) as (v: never) => string, fields: [{ f: 'shifts', label: 'Shifts', unit: '+' }, { f: 'days', label: 'In the last', unit: 'days' }] },
    { label: 'Default reply-by', k: 'ask.reply_by_days', kind: 'choice', storedOnly: true, choices: [[1, '1 day before'], [2, '2 days before'], [3, '3 days before'], [5, '5 days before'], [7, '1 week before']], show: ((v: number) => `${v} day${v === 1 ? '' : 's'} before`) as (v: never) => string },
  ] },
  { title: 'Bookings & changes', rows: [
    { label: 'Late cancel / late change', show: () => 'after they confirmed' },
    { label: 'Count “told ahead” as late', sub: 'arrived by the time they gave in I’m running late', k: 'bookings.count_told_ahead', kind: 'bool', show: ((v: boolean) => (v ? 'On' : 'Off')) as (v: never) => string },
    { label: 'Running-late button', sub: 'staff Home, until they’re started', k: 'bookings.running_late', kind: 'choice', choices: [['event_day', 'All day on the event day'], ['off', 'Off']], show: ((v: string) => (v === 'off' ? 'Off' : 'All day on the event day')) as (v: never) => string },
    { label: 'New-staff tag', sub: 'NEW on Ranking, manager team screen', k: 'bookings.new_tag_shifts', kind: 'num', unit: 'shifts', min: 0, max: 20, show: ((v: number) => `first ${v} shifts`) as (v: never) => string },
  ] },
  { title: 'Extras', rows: [
    { label: 'Book extras on events', k: 'extras.rule', kind: 'obj', fields: [{ f: 'over', label: 'Over', unit: 'staff' }], show: ((v: S['extras.rule']) => `over ${v.over} staff`) as (v: never) => string },
    { label: 'Extras', k: 'extras.rule', kind: 'obj', fields: [{ f: 'pct', label: 'Percent', unit: '%' }], show: ((v: S['extras.rule']) => `${v.pct}% · rounded up`) as (v: never) => string },
    { label: 'Default billing', sub: 'each client can override', k: 'extras.default_billing', kind: 'choice', choices: [['gr', 'On G&R'], ['client', 'Client pays']], show: ((v: string) => (v === 'client' ? 'Client pays' : 'On G&R')) as (v: never) => string },
  ] },
  { title: 'Transport', rows: [
    { label: 'Office (start point)', k: 'transport.office', kind: 'text', storedOnly: true, show: ((v: string) => v) as (v: never) => string },
    { label: 'Far event from', k: 'transport.far_min', kind: 'num', unit: 'min drive', min: 10, max: 240, step: 5, storedOnly: true, show: ((v: number) => `${v} min drive`) as (v: never) => string },
    { label: 'Paid travel', show: () => 'one way × 2 · nearest 15 min' },
    { label: 'Gas per car', sub: 'New event → Transport', show: () => 'set on each event' },
    { label: 'Client pays transport by default', sub: 'new clients and new events', k: 'transport.client_pays', kind: 'bool', show: ((v: boolean) => (v ? 'On' : 'Off')) as (v: never) => string },
  ] },
  { title: 'Messages to staff', off: 'not live yet (push 24)', rows: [
    { label: 'Quiet hours', sub: 'today / tomorrow changes still go out', show: () => '11 PM – 7 AM' },
    { label: 'Reminder before reply-by', show: () => '3 h' },
    { label: 'Max ask notifications', show: () => '1 per person per day' },
    { label: 'Personal link expires', show: () => '3 days or after the shift' },
  ] },
  { title: 'Hours & pay', rows: [
    { label: 'Minimum paid', sub: 'except LEFT EARLY', k: 'hours.min', kind: 'num', unit: 'h', min: 0, max: 8, step: 0.5, show: ((v: number) => `${v} h`) as (v: never) => string },
    { label: 'Rounding', k: 'hours.rounding', kind: 'choice', choices: [[5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min']], show: ((v: number) => `${v} min`) as (v: never) => string },
    { label: 'Pay periods', show: () => '1–15 · 16–end' },
    { label: 'Paid on', show: () => '16th · 1st' },
    { label: 'Show money on staff phones', sub: 'hours only (Ronnie)', k: 'hours.show_money', kind: 'bool', storedOnly: true, show: ((v: boolean) => (v ? 'On' : 'Off')) as (v: never) => string },
  ] },
  { title: 'Ranking', sub: 'score weights', rows: [
    { label: 'Tier', k: 'rank.tier', kind: 'obj', fields: [{ f: 'A', label: 'A' }, { f: 'B', label: 'B' }, { f: 'C', label: 'C' }], show: ((v: S['rank.tier']) => `A ${v.A} · B ${v.B} · C ${v.C}`) as (v: never) => string },
    { label: 'Reliability', k: 'rank.reliability', kind: 'obj', fields: [{ f: 'days', label: 'Window', unit: 'days' }, { f: 'start', label: 'Start' }, { f: 'no_show', label: 'No-show' }, { f: 'late_cancel', label: 'Late cancel' }, { f: 'late', label: 'Late' }, { f: 'late_change', label: 'Late change' }],
      show: ((v: S['rank.reliability']) => `(${v.days} days) start ${v.start} · no-show ${n(v.no_show)} · late cancel ${n(v.late_cancel)} · late ${n(v.late)}`) as (v: never) => string },
    { label: 'Experience', k: 'rank.experience', kind: 'obj', fields: [{ f: 'SENIOR', label: 'Senior' }, { f: 'MID', label: 'Mid' }, { f: 'JUNIOR', label: 'Junior' }], show: ((v: S['rank.experience']) => `Senior ${v.SENIOR} · Mid ${v.MID} · Junior ${v.JUNIOR}`) as (v: never) => string },
    { label: 'Manager feedback', sub: 'last 10 · push 30', k: 'rank.feedback', kind: 'obj', fields: [{ f: 's5', label: '5★', step: 0.5 }, { f: 's4', label: '4★', step: 0.5 }, { f: 's3', label: '3★', step: 0.5 }, { f: 's2', label: '2★', step: 0.5 }, { f: 's1', label: '1★', step: 0.5 }, { f: 'cap', label: 'Cap ±' }],
      show: ((v: S['rank.feedback']) => `5★ ${signed(v.s5)} · 4★ ${signed(v.s4)} · 3★ ${signed(v.s3)} · 2★ ${signed(v.s2)} · 1★ ${signed(v.s1)} · cap ±${v.cap}`) as (v: never) => string },
    { label: 'Extras', k: 'rank.extras', kind: 'obj', fields: [{ f: 'bmo', label: 'BMO' }, { f: 'newStaff', label: 'New' }, { f: 'priority', label: 'Priority' }], show: ((v: S['rank.extras']) => `BMO ${signed(v.bmo)} · new ${signed(v.newStaff)} · priority ${signed(v.priority)}`) as (v: never) => string },
  ] },
  { title: 'Managers', rows: [
    { label: 'Manager feedback for', sub: 'test first, then all managers', k: 'mgr.feedback', kind: 'choice', choices: [['benjamin', 'Benjamin only'], ['all', 'All managers']], show: ((v: string) => (v === 'all' ? 'All managers' : 'Benjamin only')) as (v: never) => string },
    { label: 'Announcements window', show: () => 'day before → event end' },
    { label: 'Undo start / end', k: 'mgr.undo', kind: 'choice', choices: [['until_submitted', 'Until hours submitted'], ['off', 'Off']], show: ((v: string) => (v === 'off' ? 'Off' : 'until hours submitted')) as (v: never) => string },
    { label: 'Can start people from', k: 'mgr.start_from_h', kind: 'choice', choices: [[1, '1 h before call'], [2, '2 h before call'], [3, '3 h before call'], [4, '4 h before call'], [6, '6 h before call']], show: ((v: number) => `${v} h before call`) as (v: never) => string },
  ] },
  { title: 'Profile check-up & sign-in', sub: 'push 31', rows: [
    { label: 'Emergency contact', sub: 'skipped → reminder card on their Home', k: 'checkup.emergency', kind: 'choice', choices: [['skip', 'Can skip'], ['required', 'Required']], show: ((v: string) => (v === 'required' ? 'Required' : 'Can skip')) as (v: never) => string },
    { label: 'Home Screen step', sub: 'only shows if opened in the browser', k: 'checkup.home_screen', kind: 'choice', choices: [['skip', 'Can skip'], ['required', 'Required']], show: ((v: string) => (v === 'required' ? 'Required' : 'Can skip')) as (v: never) => string },
    { label: 'Sign-in code', sub: 'or force 6 digits for everyone', k: 'signin.code', kind: 'choice', choices: [['choose', 'Staff choose 4 or 6'], ['force6', '6 digits for everyone']], show: ((v: string) => (v === 'force6' ? '6 digits for everyone' : 'Staff choose 4 or 6')) as (v: never) => string },
    { label: '“Ask Ronnie to reset”', sub: 'for people who can’t open their email', k: 'signin.ask_reset', kind: 'choice', choices: [['on', 'On'], ['off', 'Off']], show: ((v: boolean) => (v ? 'On' : 'Off')) as (v: never) => string },
  ] },
];

const tLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }).replace(/\./g, '').toUpperCase();

export function Settings() {
  const get = useSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null); const [err, setErr] = useState('');
  const last = Object.keys(DEFAULTS).map((k) => savedAt(k as SettingKey)).filter(Boolean).sort().pop() ?? null;
  const save = async <K extends SettingKey>(k: K, v: S[K]) => {
    setErr('');
    try { await saveSetting(k, v); setSaved(tLabel(new Date().toISOString())); setOpen(null); }
    catch (e) { setErr(/app_settings|does not exist|schema cache/i.test((e as Error).message) ? 'Settings can’t be saved until migration 038 is applied.' : (e as Error).message); }
  };
  return (
    <div className="stack-lg st-page">
      <div className="toolbar">
        <div><h1 className="serif-h">Settings</h1><span className="muted sm">Admin → More → Settings · tap a value to change it · applies to new events and asks from now on</span></div>
        {saved ? <span className="okc strong sm">✓ Saved {saved}</span> : last ? <span className="muted sm">Last change {new Date(last).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }).replace('.', '')} · {tLabel(last)}</span> : null}
      </div>
      {err && <p className="error">{err}</p>}
      <div className="st-grid">
        {SECTIONS.map((sec) => (
          <section key={sec.title} className={'adm-card st-sec' + (sec.off ? ' off' : '')} aria-disabled={sec.off ? true : undefined}>
            <div className="st-sec-h"><span className="serif">{sec.title}</span>{sec.sub && <small className="muted">{sec.sub}</small>}{sec.off && <span className="tag st-off">{sec.off}</span>}</div>
            {sec.rows.map((r, i) => {
              const id = sec.title + i; const v = r.k ? get(r.k) : null; const editable = !!r.k && !sec.off;
              return (
                <div key={id} className={'st-row' + (open === id ? ' open' : '')}>
                  <div className="st-l"><b>{r.label}</b>{r.sub && <small>{r.sub}</small>}</div>
                  {editable ? (r.kind === 'bool'
                    ? <button type="button" role="switch" aria-checked={!!v} aria-label={r.label} className={'sw' + (v ? ' on' : '')} onClick={() => save(r.k!, !v as never)}><span className="sw-track"><span className="sw-knob" /></span><span className="sw-lbl">{v ? 'ON' : 'OFF'}</span></button>
                    : <button type="button" className="st-v" onClick={() => setOpen(open === id ? null : id)}>{r.show(v as never)}{r.kind === 'choice' ? ' ▾' : ''}</button>)
                    : <span className={'st-v fixed'}>{r.show(null as never)}</span>}
                  {r.storedOnly && !sec.off && <small className="st-note">saved · not used by the app yet</small>}
                  {!r.k && !sec.off && <small className="st-note">fixed</small>}
                  {open === id && r.k && <Editor row={r} value={v} onCancel={() => setOpen(null)} onSave={(x) => save(r.k!, x as never)} />}
                </div>
              );
            })}
          </section>
        ))}
      </div>
      <p className="muted sm">Defaults are today’s values; a setting that was never changed keeps them. Staff and managers only read the settings their screens need.</p>
    </div>
  );
}

function Editor({ row, value, onSave, onCancel }: { row: Row; value: unknown; onSave: (v: unknown) => void; onCancel: () => void }) {
  const [txt, setTxt] = useState(row.kind === 'text' || row.kind === 'num' ? String(value ?? '') : '');
  const [obj, setObj] = useState<Record<string, string>>(() => (row.kind === 'obj' && value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, number>).map(([k, x]) => [k, String(x)])) : {}));
  const [bad, setBad] = useState('');
  if (row.kind === 'choice') {
    const cur = row.k === 'signin.ask_reset' ? (value ? 'on' : 'off') : String(value);
    return (
      <div className="st-ed">
        {row.choices!.map(([k, l]) => <button type="button" key={String(k)} className={'uchip' + (String(k) === cur ? ' on' : '')} onClick={() => onSave(row.k === 'signin.ask_reset' ? k === 'on' : k)}>{l}</button>)}
        <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>
      </div>
    );
  }
  const done = () => {
    if (row.kind === 'text') { if (!txt.trim()) return setBad('Can’t be empty.'); return onSave(txt.trim()); }
    if (row.kind === 'num') {
      const x = Number(txt); if (!Number.isFinite(x) || (row.min != null && x < row.min) || (row.max != null && x > row.max)) return setBad(`Between ${row.min} and ${row.max}.`);
      return onSave(x);
    }
    const out: Record<string, number> = { ...(value as Record<string, number>) };
    for (const f of row.fields!) { const x = Number(obj[f.f]); if (obj[f.f] === '' || !Number.isFinite(x)) return setBad(`${f.label}: a number, please.`); out[f.f] = x; }
    if (row.k === 'ask.tiers' && !(out.a >= 1 && out.ab > out.a)) return setBad('A+B must be more than A.');
    if (row.k === 'ask.hold_back' && !(out.shifts >= 1 && out.days >= 1)) return setBad('At least 1 shift and 1 day.');
    if (row.k === 'extras.rule' && !(out.pct >= 0 && out.pct <= 100 && out.over >= 0)) return setBad('Percent between 0 and 100.');
    if (row.k === 'rank.feedback' && !(out.cap >= 0)) return setBad('The cap is a positive number.');
    onSave(out);
  };
  return (
    <div className="st-ed" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); done(); } if (e.key === 'Escape') onCancel(); }}>
      {row.kind === 'obj' ? row.fields!.map((f) => (
        <label key={f.f} className="st-in"><span>{f.label}</span><input inputMode="decimal" value={obj[f.f] ?? ''} onChange={(e) => { setObj({ ...obj, [f.f]: e.target.value.replace(/[^\d.\-]/g, '') }); setBad(''); }} />{f.unit && <small>{f.unit}</small>}</label>
      )) : <label className="st-in wide"><input autoFocus inputMode={row.kind === 'num' ? 'decimal' : undefined} value={txt} onChange={(e) => { setTxt(row.kind === 'num' ? e.target.value.replace(/[^\d.]/g, '') : e.target.value); setBad(''); }} />{row.unit && <small>{row.unit}</small>}</label>}
      <button type="button" className="abtn sm dark" onClick={done}>Save</button>
      <button type="button" className="link-btn" onClick={onCancel}>Cancel</button>
      {bad && <small className="error" style={{ flexBasis: '100%' }}>{bad}</small>}
    </div>
  );
}
