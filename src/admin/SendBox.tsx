// push 72 · Send levels. Plain Save tells nobody; changes wait in change_outbox until a send button.
// SendBox = the "About to send" box · PendingBar = "n changes not sent yet" · SeenLine = "Last change seen 5 of 8" ·
// UnseenNeeds = Today line for changes tonight / tomorrow nobody tapped Got it on · StartLabelGuard = confirmations with no start time.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Row = { id: string; staff_id: string; full_name: string; phone: string | null; event_id: string | null; event_title: string; event_date: string; kind: string; level: 'buzz' | 'soft' | 'silent'; message: string };
const LV: Record<string, string> = { buzz: 'Buzz · phone alert', soft: 'Soft · in the app, no buzz', silent: 'Nothing · the page just updates' };
const dl = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const sms = (p: string | null, body: string) => { const t = (p ?? '').replace(/[^\d+]/g, ''); return t ? `sms:${t}?&body=${encodeURIComponent(body)}` : null; };

export async function pendingCount(events?: string[] | null) {
  const { data, error } = await supabase.rpc('admin_pending_changes', { p_events: events?.length ? events : null });
  return error ? 0 : ((data ?? []) as Row[]).length;
}

export function SendBox({ events, onClose, onSent }: { events?: string[] | null; onClose: () => void; onSent?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { supabase.rpc('admin_pending_changes', { p_events: events?.length ? events : null }).then(({ data, error }) => { if (error) setErr(error.message); setRows((data ?? []) as Row[]); }); }, [events]);
  const by = (lv: string) => (rows ?? []).filter((r) => r.level === lv);
  const send = async (mode: 'auto' | 'soft' | 'buzz') => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('admin_send_changes', { p_events: events?.length ? events : null, p_mode: mode });
    setBusy(false); if (error) { setErr(error.message); return; }
    onSent?.(); onClose();
  };
  return (
    <div className="bk-modal" onClick={onClose}><div className="adm-card sb-box" onClick={(e) => e.stopPropagation()}>
      <div className="spread"><b className="serif" style={{ fontSize: 22 }}>About to send</b><button className="abtn sm" onClick={onClose}>✕</button></div>
      {!rows ? <span className="muted">Loading…</span> : !rows.length ? <span className="muted">Nothing waiting to send. Every change is already out.</span> : <>
        <div className="sb-counts">
          {(['buzz', 'soft', 'silent'] as const).map((lv) => <button key={lv} type="button" className={'sb-count ' + lv + (open === lv ? ' on' : '')} onClick={() => setOpen(open === lv ? null : lv)}>
            <b>{by(lv).length}</b><span>{lv === 'silent' ? 'nothing' : lv}</span></button>)}
        </div>
        <small className="muted">Tap a number to see who and the exact message. Buzz = changes ≤ 4 days on confirmed shifts, new bookings and removals. Soft = confirmed shifts further out. Nothing = not confirmed yet.</small>
        {open && <div className="sb-list"><div className="kick">{LV[open]}</div>
          {by(open).length ? by(open).map((r) => <div key={r.id} className="sb-row"><b>{r.full_name}</b><small className="muted">{dl(r.event_date)} · {r.event_title}</small><span className="sm">{r.message}</span></div>) : <span className="muted sm">Nobody.</span>}
        </div>}
        <div className="sb-acts">
          <button className="abtn dark" disabled={busy} onClick={() => send('auto')}>Send</button>
          <button className="abtn" disabled={busy} onClick={() => send('soft')}>All soft</button>
          <button className="abtn" disabled={busy} onClick={() => send('buzz')}>All buzz</button>
          <button className="lnk sm" onClick={onClose}>Not now</button>
        </div>
        <small className="muted">Send follows the rules. All soft / All buzz force that level for everyone in this send. Nothing stays nothing unless you pick All buzz.</small>
      </>}
      {err && <span className="err sm">{err}</span>}
    </div></div>);
}

/** "3 changes not sent yet · Review & send" for these events (or all). Hidden when nothing waits. */
export function PendingBar({ events, tick = 0, onSent, label }: { events?: string[] | null; tick?: number; onSent?: () => void; label?: string }) {
  const [n, setN] = useState(0); const [box, setBox] = useState(false); const [t, setT] = useState(0);
  const key = (events ?? []).join(',');
  useEffect(() => { pendingCount(events).then(setN); }, [key, tick, t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!n && !box) return null;
  return <>
    {n > 0 && <div className="sb-bar"><span className="grow"><b>{n} change{n > 1 ? 's' : ''} not sent yet</b>{label ? ` · ${label}` : ''}<small className="muted"> Staff don't see them until you send.</small></span>
      <button className="abtn sm dark" onClick={() => setBox(true)}>Review &amp; send</button></div>}
    {box && <SendBox events={events} onClose={() => { setBox(false); setT((x) => x + 1); }} onSent={() => { setT((x) => x + 1); onSent?.(); }} />}
  </>;
}

/** Event page: "Last change seen: 5 of 8" → who hasn't, with Text. Admin only. */
export function SeenLine({ eventId, tick = 0 }: { eventId: string; tick?: number }) {
  const [rows, setRows] = useState<{ staff_id: string; full_name: string; phone: string | null; seen_at: string | null; sent_at: string }[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => { supabase.rpc('admin_change_seen', { p_event: eventId }).then(({ data }) => setRows((data ?? []) as typeof rows)); }, [eventId, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return null;
  const seen = rows.filter((r) => r.seen_at).length; const not = rows.filter((r) => !r.seen_at);
  return <div className="sb-seen">
    <button type="button" className="lnk" onClick={() => setOpen(!open)}>Last change seen: <b className={not.length ? 'gold' : 'okc'}>{seen} of {rows.length}</b>{not.length ? ' ›' : ' ✓'}</button>
    {open && not.map((r) => { const h = sms(r.phone, `Hi ${r.full_name.split(' ')[0]}! There's a change on your shift in the G&R app, please open it and tap Got it.`);
      return <div key={r.staff_id} className="sb-row in"><b>{r.full_name}</b>{h ? <a className="abtn sm" href={h}>Text</a> : <small className="muted">no phone</small>}</div>; })}
  </div>;
}

/** Today → Needs you: changes for tonight / tomorrow nobody has seen yet. */
export function UnseenNeeds({ tick = 0, onCount }: { tick?: number; onCount?: (n: number) => void }) {
  const [rows, setRows] = useState<{ staff_id: string; full_name: string; phone: string | null; event_title: string; event_date: string }[]>([]);
  useEffect(() => { supabase.rpc('admin_unseen_changes').then(({ data, error }) => setRows(error ? [] : (data ?? []) as typeof rows)); }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onCount?.(rows.length ? 1 : 0); });
  if (!rows.length) return null;
  return <div className="nh-card"><div className="nh-top"><b>{rows.length} {rows.length > 1 ? 'people haven’t' : 'person hasn’t'} seen a change</b><i className="nh-tag gold">TONIGHT / TOMORROW</i></div>
    {rows.map((r) => { const h = sms(r.phone, `Hi ${r.full_name.split(' ')[0]}! Your ${dl(r.event_date)} shift changed, please open the G&R app and tap Got it.`);
      return <div key={r.staff_id + r.event_title} className="sb-row in"><span className="grow"><b>{r.full_name}</b> <small className="muted">{dl(r.event_date)} · {r.event_title}</small></span>{h ? <a className="abtn sm" href={h}>Text</a> : <small className="muted">no phone</small>}</div>; })}
  </div>;
}

/** Confirmations: shifts with no start time → "Add times" or "Send anyway" with a rough label, then onOk() (the real send). */
export function StartLabelGuard({ ids, onOk, onCancel, onAddTimes }: { ids: string[]; onOk: () => void; onCancel: () => void; onAddTimes?: () => void }) {
  const [miss, setMiss] = useState<string[] | null>(null);
  const [lbl, setLbl] = useState<'evening' | 'afternoon' | 'daytime'>('evening'); const [busy, setBusy] = useState(false);
  useEffect(() => { (async () => {
    const { data, error } = await supabase.from('shifts').select('id,time_tbc,start_label').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const m = error ? [] : ((data ?? []) as { id: string; time_tbc: boolean; start_label: string | null }[]).filter((x) => x.time_tbc && !x.start_label).map((x) => x.id);
    if (!m.length) onOk(); else setMiss(m);
  })(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!miss?.length) return null;
  return <div className="bk-modal" onClick={onCancel}><div className="adm-card sb-box" onClick={(e) => e.stopPropagation()}>
    <b className="serif" style={{ fontSize: 20 }}>No start time for {miss.length} {miss.length > 1 ? 'people' : 'person'}</b>
    <span className="muted sm">Add the times first, or send anyway with a rough time. They can still confirm; when you add the exact time it goes out as a change.</span>
    <div className="seg">{(['evening', 'afternoon', 'daytime'] as const).map((x) => <button key={x} type="button" className={lbl === x ? 'on' : ''} onClick={() => setLbl(x)}>{x[0].toUpperCase() + x.slice(1)}</button>)}</div>
    <small className="muted">Staff see “Starts: {lbl} · exact time coming”.</small>
    <div className="sb-acts">
      {onAddTimes && <button className="abtn" onClick={onAddTimes}>Add times</button>}
      <button className="abtn dark" disabled={busy} onClick={async () => { setBusy(true); await supabase.from('shifts').update({ start_label: lbl }).in('id', miss); setBusy(false); onOk(); }}>Send anyway</button>
      <button className="lnk sm" onClick={onCancel}>Cancel</button>
    </div>
  </div></div>;
}
