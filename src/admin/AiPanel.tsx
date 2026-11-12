import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { EmailReview, type ALine } from './EmailReview';

/** Nov 7 · AI plan step 1 (migration 079). Top of Today: "✦ AI · n waiting for your OK" + Done today.
 *  ✉ client emails (hourly Claude task via /api/ai) · ⚡ app changes (trigger, instant). Nothing is applied by itself. */
type Item = {
  id: string; source: 'email' | 'app' | 'meeting'; kind: string; event_id: string | null; shift_id: string | null; staff_id: string | null;
  who: string | null; quote: string | null; lines: ALine[]; event_hint: string | null;
  email_url: string | null; sure: boolean; status: 'waiting' | 'done' | 'ignored'; done_note: string | null; created_at: string; done_at: string | null;
  events: { title: string; event_date: string } | null;
};
const TAG: Record<string, [string, string]> = {
  count_change: ['COUNT CHANGE', 'amber'], time_change: ['TIME CHANGE', 'blue'], address: ['ADDRESS', 'green'], new_event: ['NEW EVENT', 'purple'],
  cancel: ['CANCEL', 'red'], question: ['QUESTION', 'grey'], other: ['EMAIL', 'grey'], shift_cancelled: ['CANCELLED', 'red'],
};
const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 6e4); return m < 1 ? 'now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const day = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });

function primary(i: Item): { to: string; label: string } | null {
  if (i.kind === 'shift_cancelled' && i.event_id && i.events) return { to: `/admin/bookings?date=${i.events.event_date}&ev=${i.event_id}`, label: 'Pick replacement ›' };
  if (i.kind === 'new_event') return { to: '/admin/event/new', label: 'Create event ›' };
  if (i.kind === 'count_change' && i.event_id) return { to: `/admin/event/${i.event_id}/change`, label: 'Review ›' };
  if (i.event_id) return { to: `/admin/event/${i.event_id}`, label: 'Open event ›' };
  return null;
}

export function AiPanel({ bare = false }: { bare?: boolean } = {}) {
  const [items, setItems] = useState<Item[] | null>(null); const [checked, setChecked] = useState<string | null>(null);
  const [open, setOpen] = useState(true); const [err, setErr] = useState('');
  const load = async () => {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const [w, d, s] = await Promise.all([
      supabase.from('ai_items').select('*, events(title,event_date)').eq('status', 'waiting').order('created_at', { ascending: false }).limit(50),
      supabase.from('ai_items').select('*, events(title,event_date)').neq('status', 'waiting').gte('done_at', since.toISOString()).order('done_at', { ascending: false }).limit(30),
      supabase.from('ai_settings').select('inbox_checked_at').eq('id', 1).maybeSingle(),
    ]);
    if (w.error) { setItems(null); return; } // before 079: nothing shown
    setItems([...((w.data ?? []) as Item[]), ...((d.data ?? []) as Item[])]); setChecked(s.data?.inbox_checked_at ?? null);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel('ai_items').on('postgres_changes', { event: '*', schema: 'public', table: 'ai_items' }, () => load()).subscribe();
    const t = window.setInterval(load, 5 * 60e3);
    return () => { supabase.removeChannel(ch); window.clearInterval(t); };
  }, []);
  if (!items) return null;
  const waiting = items.filter((i) => i.status === 'waiting'); const done = items.filter((i) => i.status !== 'waiting');
  const set = async (i: Item, status: 'done' | 'ignored', note?: string) => {
    setErr(''); setItems((v) => (v ?? []).map((x) => (x.id === i.id ? { ...x, status, done_at: new Date().toISOString(), done_note: note ?? null } : x)));
    const { error } = await supabase.from('ai_items').update({ status, done_at: new Date().toISOString(), done_note: note ?? null }).eq('id', i.id);
    if (error) { setErr(error.message); load(); }
  };
  const next = checked ? new Date(Math.max(new Date(checked).getTime() + 3600e3, Date.now())) : null;
  if (bare) return (
    <section className="ai-bare">
      <div className="sec ai-sec"><span className="serif"><span className="ai-spark-p" aria-hidden="true">✦</span> AI · to review {waiting.length > 0 && <b className="ai-n">{waiting.length}</b>}</span>
        <span className="muted sm">{checked ? `inbox ${hm(checked)}` : 'inbox not connected'}</span></div>
      <div className="adm-card ai-card">
        {err && <p className="error">{err}</p>}
        {!waiting.length && <div className="muted sm" style={{ padding: '10px 0' }}>Nothing waiting for your OK.</div>}
        {waiting.map((i) => <Waiting key={i.id} i={i} set={set} reload={load} />)}
        {done.length > 0 && <details className="ai-dd"><summary>Done today · {done.length}</summary><DoneList done={done} load={load} /></details>}
      </div>
    </section>
  );
  return (
    <section className="ai-panel">
      <button type="button" className="ai-bar" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="ai-spark" aria-hidden="true">✦</span>
        <span className="grow"><b>{waiting.length ? `AI · ${waiting.length} waiting for your OK` : 'AI · nothing waiting'}</b>
          <small>{checked ? `Inbox checked ${hm(checked)}${next ? ' · next ' + hm(next.toISOString()) : ''}` : 'Inbox not connected yet'} · app changes live</small></span>
        <span className="ai-done-n">Done today · {done.length}</span>
      </button>
      {open && (
        <>
          {err && <p className="error">{err}</p>}
          {waiting.length > 0 && <div className="ai-lab">WAITING FOR YOUR OK</div>}
          {waiting.map((i) => <Waiting key={i.id} i={i} set={set} reload={load} />)}
          {done.length > 0 && <div className="ai-lab">DONE TODAY</div>}
          {done.length > 0 && <DoneList done={done} load={load} />}
        </>
      )}
    </section>
  );
}

function Waiting({ i, set, reload }: { i: Item; set: (i: Item, st: 'done' | 'ignored', note?: string) => void; reload: () => void }) {
  const [rev, setRev] = useState(false); const [newEv, setNewEv] = useState(false); const canReview = (i.source === 'email' || i.source === 'meeting') && i.lines.some((l) => l.field) && ['count_change', 'time_change', 'address', 'new_event', 'other'].includes(i.kind);

            const [t, tone] = TAG[i.kind] ?? TAG.other; const p = primary(i);
            return (
              <div key={i.id} className="ai-item">
                <div className="ai-top"><span aria-hidden="true">{i.source === 'email' ? '✉' : i.source === 'meeting' ? '📝' : '⚡'}</span><span className={'ai-tag ' + tone}>{t}</span><b>{i.who}</b><span className="muted sm">{ago(i.created_at)}</span>{!i.sure && <span className="ai-look">needs a look</span>}</div>
                {i.quote && <div className="ai-quote">“{i.quote}”</div>}
                {i.kind !== 'shift_cancelled' ? <EventPick i={i} onPicked={reload} onNew={canReview ? () => { setNewEv(true); setRev(true); } : undefined} /> : (i.events || i.event_hint) && <div className="ai-line"><span>Event</span><b>{i.events ? `${day(i.events.event_date)} · ${i.events.title}` : i.event_hint}</b></div>}
                {i.lines.filter((l) => l.label !== 'Shift' || !i.events).map((l, k) => (
                  <div key={k} className="ai-line"><span>{l.label}</span><span>{l.old ? <><s>{l.old}</s> → </> : null}<b>{l.new}</b></span></div>
                ))}
                <div className="ai-acts">
                  {canReview ? <button className="abtn dark sm" onClick={() => setRev(true)}>{!i.event_id ? 'Review & create event ›' : 'Review changes ›'}</button> : p && <Link className="abtn dark sm" to={p.to}>{p.label}</Link>}
                  {canReview && i.kind === 'count_change' && i.event_id && <Link className="abtn sm" to={`/admin/event/${i.event_id}/change`}>Client change ›</Link>}
                  <button className="abtn sm" onClick={() => set(i, 'done')}>Done</button>
                  <button className="abtn sm" onClick={() => set(i, 'ignored')}>Ignore</button>
                  <span className="grow" />
                  {i.email_url && <a className="ai-link" href={i.email_url} target="_blank" rel="noreferrer">Open email ›</a>}
                </div>
                {rev && <EmailReview item={newEv ? { ...i, event_id: null } : i} onClose={() => { setRev(false); setNewEv(false); }} />}
              </div>
            );
          }
function DoneList({ done, load }: { done: Item[]; load: () => void }) {
  return (
    <div className="ai-donelist">
      {done.map((i) => (
        <div key={i.id} className={i.status === 'ignored' ? 'ign' : ''}>
          <span className="ok">{i.status === 'done' ? '✓' : '·'}</span>
          <span className="grow">{i.who} · {(TAG[i.kind] ?? TAG.other)[0].toLowerCase()}{i.events ? ` · ${i.events.title}` : ''} · {i.status === 'done' ? 'done' : 'ignored'}</span>
          <span className="muted sm">{i.done_at ? hm(i.done_at) : ''}</span>
          <button className="ai-undo" onClick={async () => { await supabase.from('ai_items').update({ status: 'waiting', done_at: null }).eq('id', i.id); load(); }}>Undo</button>
        </div>
      ))}
    </div>
  );
}

/** Nov 11 · Ronnie: "I should be able to choose which event the change goes to" + "if there is no event, the option to create it".
 *  The AI's guess first, then every event that day (floor + bar), another date, or a new event. Saved on the card (ai_items.event_id). */
function EventPick({ i, onPicked, onNew }: { i: Item; onPicked: () => void; onNew?: () => void }) {
  const nav = useNavigate();
  const dateLine = i.lines.find((l) => l.field === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(l.value ?? '')))?.value as string | undefined;
  const [date, setDate] = useState(i.events?.event_date ?? dateLine ?? '');
  const [evs, setEvs] = useState<{ id: string; title: string; department: string; start_time: string | null }[]>([]);
  const [open, setOpen] = useState(!i.event_id); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!date) { setEvs([]); return; } supabase.from('events').select('id,title,department,start_time').eq('event_date', date).order('start_time')
    .then(({ data }) => setEvs((data ?? []) as typeof evs)); }, [date]);
  const pick = async (id: string | null) => { setBusy(true); await supabase.from('ai_items').update({ event_id: id, sure: true }).eq('id', i.id); setBusy(false); setOpen(false); onPicked(); };
  const t12 = (t: string | null) => { if (!t) return ''; const h = Number(t.slice(0, 2)); return ` · ${h % 12 || 12}${t.slice(2, 5) !== ':00' ? t.slice(2, 5) : ''} ${h < 12 ? 'AM' : 'PM'}`; };
  const unsure = !i.event_id || !i.sure;
  return (
    <div className={'ai-line ai-pick' + (unsure ? ' unsure' : '')}>
      <span>Event</span>
      {!open ? <span className="grow"><b>{i.events ? `${day(i.events.event_date)} · ${i.events.title}` : i.event_hint ?? 'No event yet'}</b>
        {unsure && <em className="gold"> · {i.event_id ? 'the AI isn’t sure' : 'choose the event'}</em>} <button className="lnk sm" onClick={() => setOpen(true)}>Change ›</button></span>
      : <span className="grow ai-pickrow">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {date && !evs.length && <small className="muted">no event that day</small>}
        {evs.map((e) => <button key={e.id} disabled={busy} className={'abtn sm' + (e.id === i.event_id ? ' dark' : '')} onClick={() => pick(e.id)}>{e.id === i.event_id ? '✓ ' : ''}{e.title}{e.department === 'bar' ? ' · bar' : ''}{t12(e.start_time)}</button>)}
        <button className="abtn sm ok" disabled={busy} onClick={async () => { await pick(null); if (onNew) onNew(); else nav(`/admin/event/new${date ? `?d=${date}` : ''}`); }}>+ Create a new event</button>
        {i.event_id && <button className="lnk muted sm" onClick={() => setOpen(false)}>Cancel</button>}
      </span>}
    </div>);
}
