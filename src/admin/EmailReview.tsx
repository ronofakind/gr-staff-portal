import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ap12, ENDS } from './api';

/* Push 67 · client email → before / after review (board EmailCompareV1, Ronnie Nov 10).
   Only the lines that differ · every new value editable · Apply fills the event form (Ronnie presses Save there, so
   staff hear about time changes the usual way: only from 4 days before). Staff count is never changed here: Client change.
   Staff times change only when the email says so; if guests move and staff don't, a ⚠ line flags it. */

export type ALine = { label: string; old?: string | null; new?: string | null; field?: string; value?: string | null };
export type AApply = { item: string; event: string | null; who: string | null; changes: { field: string; value: string; label: string; old?: string | null }[] };
export const AI_APPLY_KEY = 'gr-ai-apply';

type Ev = { id: string; event_date: string; title: string; address: string | null; guests: number | null; end_time: string | null; ends_label: string | null;
  description: string | null; start_time: string | null; staffing: { code: string; start: string; count: number }[] | null };
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h < 6 ? h + 24 : h) * 60 + (m || 0); };
/** "17:30" · "5:30 PM" · "5 pm" · "5h30" → "17:30" (null when it isn't a time) */
const hm = (v: string | null | undefined) => {
  if (!v) return null; const m = /^\s*(\d{1,2})(?:[:h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*$/i.exec(v.trim()); if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] ?? 0); const ap = (m[3] ?? '').toLowerCase();
  if (ap.startsWith('p') && h < 12) h += 12; if (ap.startsWith('a') && h === 12) h = 0; if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`; };
const same = (a: string, b: string) => { const x = hm(a), y = hm(b); return x && y ? x === y : a.replace(/\s/g, '').toLowerCase() === b.replace(/\s/g, '').toLowerCase(); };
const staffStarts = (e: Ev) => [...new Set((e.staffing ?? []).filter((l) => !['MD', 'BM'].includes(l.code) && l.count > 0).map((l) => l.start))].sort();
const FIELD_LABEL: Record<string, string> = { staff_start: 'Staff start', guests_arrive: 'Guests arrive', end: 'Ends', guests: 'Guests', address: 'Address', venue: 'Venue', date: 'Date', notes: 'Notes' };

function nowOf(e: Ev | null, f: string): string {
  if (!e) return '—';
  if (f === 'staff_start') { const s = staffStarts(e); return s.length ? s.map((x) => ap12(x)).join(' / ') + (s.length > 1 ? ' (lines)' : '') : e.start_time ? ap12(e.start_time.slice(0, 5)) : '—'; }
  if (f === 'end') return e.ends_label ?? (e.end_time ? '~ ' + ap12(e.end_time.slice(0, 5)) : '—');
  if (f === 'guests') return e.guests ? String(e.guests) : '—';
  if (f === 'address') return e.address || '—';
  if (f === 'venue') return e.title || '—';
  if (f === 'date') return e.event_date;
  if (f === 'notes') return e.description ? e.description.slice(0, 80) + (e.description.length > 80 ? '…' : '') : '—';
  if (f === 'guests_arrive') { const m = /guests arrive[^0-9]*(\d{1,2}(:\d{2})?\s*(am|pm)?)/i.exec(e.description ?? ''); return m ? m[1] : '—'; }
  return '—';
}
const show = (f: string, v: string) => (['staff_start', 'guests_arrive', 'end'].includes(f) && hm(v) ? ap12(hm(v)!) : v);

export function EmailReview({ item, onClose, onCreate }: { item: { id: string; who: string | null; quote: string | null; email_url: string | null; event_id: string | null; kind: string; created_at: string; lines: ALine[] }; onClose: () => void; onCreate?: boolean }) {
  const nav = useNavigate();
  const [ev, setEv] = useState<Ev | null>(null);
  // Nov 11 · Ronnie: in Review, choose the event (the AI's guess, that day's events, another date) or create a new one
  const [evId, setEvId] = useState<string | null>(item.event_id);
  const dateLine = item.lines.find((l) => l.field === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(l.value ?? '')))?.value ?? null;
  const [pDate, setPDate] = useState<string>(dateLine ?? '');
  const [dayEvs, setDayEvs] = useState<{ id: string; title: string; department: string; start_time: string | null }[]>([]);
  useEffect(() => { if (item.event_id) supabase.from('events').select('event_date').eq('id', item.event_id).maybeSingle().then(({ data }) => { if (data) setPDate((data as { event_date: string }).event_date); }); }, [item.event_id]);
  useEffect(() => { if (!pDate) { setDayEvs([]); return; } supabase.from('events').select('id,title,department,start_time').eq('event_date', pDate).order('start_time').then(({ data }) => setDayEvs((data ?? []) as typeof dayEvs)); }, [pDate]);
  const rows = useMemo(() => item.lines.filter((l) => l.field && (l.value ?? l.new)).map((l) => ({ ...l, field: l.field!, value: String(l.value ?? l.new) })), [item.lines]);
  const [vals, setVals] = useState<Record<number, string>>(() => Object.fromEntries(rows.map((r, k) => [k, show(r.field, r.value)])));
  const [on, setOn] = useState<Record<number, boolean>>(() => Object.fromEntries(rows.map((_, k) => [k, true])));
  useEffect(() => {
    setEv(null); if (!evId) return;
    supabase.from('events').select('id,event_date,title,address,guests,end_time,ends_label,description,start_time,staffing').eq('id', evId).maybeSingle()
      .then(({ data }) => { if (data) setEv(data as unknown as Ev); });
  }, [evId]);
  const isNew = !evId;
  // only what's different
  const diff = rows.map((r, k) => ({ r, k, now: isNew ? '—' : nowOf(ev, r.field) })).filter(({ r, now }) => isNew || !same(now, show(r.field, r.value)));
  // ⚠ guests move, staff don't
  const arrive = diff.find((d) => d.r.field === 'guests_arrive' && on[d.k]); const staffLine = diff.find((d) => d.r.field === 'staff_start' && on[d.k]);
  const firstStaff = ev ? staffStarts(ev)[0] ?? ev.start_time?.slice(0, 5) ?? null : null;
  const gap = arrive && !staffLine && firstStaff && hm(vals[arrive.k]) ? toMin(hm(vals[arrive.k])!) - toMin(firstStaff) : null;
  const flag = gap != null && (gap < 45 || gap > 120);
  const n = diff.filter((d) => on[d.k]).length;
  const apply = () => {
    supabase.from('ai_items').update({ event_id: evId, sure: true }).eq('id', item.id).then(() => {});
    const a: AApply = { item: item.id, event: evId, who: item.who, changes: diff.filter((d) => on[d.k]).map((d) => ({ field: d.r.field, value: ['staff_start', 'guests_arrive', 'end'].includes(d.r.field) ? hm(vals[d.k]) ?? vals[d.k] : vals[d.k], label: FIELD_LABEL[d.r.field] ?? d.r.label, old: d.now && d.now !== '—' ? String(d.now) : null })) };
    try { sessionStorage.setItem(AI_APPLY_KEY, JSON.stringify(a)); } catch { /* */ }
    nav(isNew ? `/admin/event/new?ai=1${a.changes.find((c) => c.field === 'date') ? '&d=' + a.changes.find((c) => c.field === 'date')!.value : ''}` : `/admin/event/${evId}/edit?ai=1`);
  };
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card er-card" onClick={(e) => e.stopPropagation()}>
      <div className="spread"><b className="serif" style={{ fontSize: 22 }}>{isNew ? 'New event by email' : `Review · ${ev ? `${ev.title} · ${new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}` : '…'}`}</b><button className="abtn sm" onClick={onClose}>✕</button></div>
      <div className="er-pick"><b>Which event?</b>
        <input type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} />
        {pDate && !dayEvs.length && <small className="muted">no event that day</small>}
        {dayEvs.map((d) => <button key={d.id} className={'abtn sm' + (d.id === evId ? ' dark' : '')} onClick={() => setEvId(d.id)}>{d.id === evId ? '✓ ' : ''}{d.title}{d.department === 'bar' ? ' · bar' : ''}{d.start_time ? ' · ' + ap12(d.start_time.slice(0, 5)) : ''}</button>)}
        <button className={'abtn sm' + (!evId ? ' ok' : '')} onClick={() => setEvId(null)}>{!evId ? '✓ ' : ''}+ New event</button>
      </div>
      {item.quote && <div className="er-quote">✉ {item.who ? <b>{item.who}: </b> : null}“{item.quote}”{item.email_url && <> · <a href={item.email_url} target="_blank" rel="noreferrer">Open email</a></>}</div>}
      {!rows.length ? <p className="muted">This card has no lines to compare. Open the event and change it yourself.</p> : !diff.length ? <p className="muted">Everything in the email already matches the app. Nothing to apply.</p> : <>
        <div className="er-grid er-h"><span /><span /><small>IN THE APP NOW</small><span /><small className="er-blue">WHAT THE EMAIL SAYS · tap to edit</small></div>
        {diff.map(({ r, k, now }) => (
          <div key={k} className={'er-grid' + (on[k] ? '' : ' off')}>
            <input type="checkbox" checked={!!on[k]} onChange={(e) => setOn({ ...on, [k]: e.target.checked })} />
            <b>{FIELD_LABEL[r.field] ?? r.label}</b>
            <span><s className="muted">{now}</s>{!isNew && r.old && ev && now !== '—' && !same(r.old, now) && <small className="gold" style={{ display: 'block', textDecoration: 'none' }}>⚠ the email thought {r.old}: changed in the app since?</small>}</span><span className="muted">→</span>
            <input className="er-val" value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} placeholder={['staff_start', 'guests_arrive', 'end'].includes(r.field) ? 'e.g. 4:30 PM' : ''} />
          </div>))}
        {flag && <div className="er-grid er-flag"><span /><b>⚠ Staff start</b><span>{firstStaff ? ap12(firstStaff) : ''}</span><span /><span>The email doesn’t change staff times. Staff would start <b>{Math.abs(gap!)} min {gap! >= 0 ? 'before' : 'after'}</b> guests. Change it in the form if needed.</span></div>}
        <p className="muted sm">Only what’s different is shown. Staff count never changes here (fewer people → Client change). Apply opens the {isNew ? 'New event' : 'event'} form with these filled in; nothing is saved until you press Save there.</p>
        <div className="row" style={{ gap: 8 }}>
          <button className="abtn dark" disabled={!n} onClick={apply}>{isNew ? 'Create event ›' : `Apply ${n} change${n === 1 ? '' : 's'} ›`}</button>
          <button className="abtn" onClick={onClose}>Not now</button>
        </div></>}
    </div></div>
  );
}

/** EventForm: the changes from a reviewed email, to fill in once the form has loaded. */
export function takeAiApply(eventId: string | null): AApply | null {
  try { const a = JSON.parse(sessionStorage.getItem(AI_APPLY_KEY) || 'null') as AApply | null; if (!a || (a.event ?? null) !== (eventId ?? null)) return null; return a; } catch { return null; }
}
export const endLabelFor = (v: string) => { const t = hm(v); return t ? ENDS.find(([, x]) => x === t)?.[0] ?? null : ENDS.find(([l]) => l === v)?.[0] ?? null; };
export const hhmm = hm;
