import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { NICK_RE, cleanNick } from '../lib/nickname';
import { dLabel, tTime, type AEvent } from './api';

/*
 * Push 33g · confirmation tracker (event page) + "haven't confirmed after 6 h" (Needs you).
 * Push 33d · "Nickname changed" cards (admin Home).
 * Hours count from shifts.confirm_sent_at (migration 039). Nothing is auto-cancelled and the app never sends texts:
 * Text opens Ronnie's Messages with the reminder filled in.
 */
type Row = { id: string; event_id: string; staff_id?: string; status: string; confirmed_by?: string | null; attendance: string | null; planned_start: string; confirm_sent_at?: string | null; time_tbc?: boolean | null;
  staff: { full_name: string; nickname: string | null; phone: string | null } | null; events?: { details_pending?: boolean } | null };
export type CState = 'ok' | 'grey' | 'gold' | 'red' | 'unsent' | 'pending';
export const hoursSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3600e3));
export function stateOf(r: { status: string; confirm_sent_at?: string | null }, pending: boolean): CState {
  if (r.status === 'confirmed') return 'ok';
  if (pending) return 'pending';
  if (!r.confirm_sent_at) return 'unsent';
  const h = hoursSince(r.confirm_sent_at);
  return h >= 24 ? 'red' : h >= 6 ? 'gold' : 'grey';
}
/** sms: link with the reminder (Ronnie sends it himself). */
export function remindSms(phone: string | null | undefined, name: string, date: string, venue: string, start: string) {
  const tel = (phone ?? '').replace(/[^\d+]/g, '');
  const body = `Hi ${name}! Just a reminder to confirm your shift ${dLabel(date, { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')} at ${venue} (${tTime(start).toUpperCase()}) in the G&R app. Thanks!`;
  return `sms:${tel}?&body=${encodeURIComponent(body)}`;
}

export function ConfirmTracker({ evs, venue }: { evs: AEvent[]; venue: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [more, setMore] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(id); }, []);
  const ids = evs.map((e) => e.id).join(',');
  useEffect(() => {
    const q = (cols: string) => supabase.from('shifts').select(cols).in('event_id', evs.map((e) => e.id)).neq('status', 'declined').is('attendance', null).order('planned_start');
    const base = 'id,event_id,staff_id,status,attendance,planned_start,time_tbc,events(details_pending),staff:staff!shifts_staff_id_fkey(full_name,nickname,phone)';
    q(base + ',confirm_sent_at,confirmed_by').then(async (r) => {
      const res = r.error ? await q(base) : r; // migration 039 not applied yet → no hours, only confirmed / waiting
      setRows(((res.data ?? []) as unknown as Row[]).filter((x) => x.staff));
    });
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nov 4 · Ronnie confirms for them (they texted). Same as their own Confirm; nothing is sent.
  const markConfirmed = async (id: string, on: boolean) => {
    const { error } = await supabase.rpc('admin_mark_confirmed', { p_shift: id, p_on: on });
    if (error) { alert(error.message); return; }
    setRows((l) => (l ?? []).map((x) => (x.id === id ? { ...x, status: on ? 'confirmed' : 'booked', confirmed_by: on ? 'me' : null } : x)));
  };
  if (!rows) return <div className="muted sm">Loading…</div>;
  if (!rows.length) return <div className="muted sm">Nobody booked yet.</div>;
  const pendingOf = (r: Row) => !!r.events?.details_pending || !!r.time_tbc;
  const rank: Record<CState, number> = { red: 0, gold: 1, grey: 2, unsent: 3, pending: 4, ok: 5 };
  const list = rows.map((r) => ({ r, st: stateOf(r, pendingOf(r)) })).sort((a, b) => rank[a.st] - rank[b.st] || a.r.staff!.full_name.localeCompare(b.r.staff!.full_name));
  const n = (s: CState) => list.filter((x) => x.st === s).length;
  const ok = n('ok'); const total = list.length;
  const confirmedShown = 3;
  const okRows = list.filter((x) => x.st === 'ok');
  const shown = [...list.filter((x) => x.st !== 'ok'), ...(more ? okRows : okRows.slice(0, confirmedShown))];
  const seg = (s: CState[], cls: string) => { const k = list.filter((x) => s.includes(x.st)).length; return k ? <i className={cls} style={{ flex: k }} /> : null; };
  return (
    <div className="ct">
      <div className="ct-h"><b>Confirmations</b><span className="muted sm">{ok} of {total}</span></div>
      <div className="ct-bar">{seg(['ok'], 'ok')}{seg(['grey', 'unsent', 'pending'], 'grey')}{seg(['gold'], 'gold')}{seg(['red'], 'red')}</div>
      {shown.map(({ r, st }) => {
        const h = r.confirm_sent_at ? hoursSince(r.confirm_sent_at) : 0;
        const name = r.staff!.nickname || r.staff!.full_name.split(' ')[0];
        return (
          <div key={r.id} className="ct-row">
            <b className="grow">{r.staff!.full_name}</b>
            {r.staff_id && <Link className="abtn sm" to={`/admin/messages?staff=${r.staff_id}`} title={`Message ${r.staff!.full_name}`} aria-label={`Message ${r.staff!.full_name}`}>✉</Link>}
            {st === 'ok' ? <span className="ct-tag ok">{r.confirmed_by ? '✓ by Ronnie · texted' : '✓ Confirmed'}</span>
              : st === 'red' ? <span className="ct-tag red">Overdue · {h} h</span>
              : st === 'gold' ? <span className="ct-tag gold">Waiting · {h} h</span>
              : st === 'grey' ? <span className="ct-tag">Waiting · {h} h</span>
              : st === 'pending' ? <span className="ct-tag">Details coming</span>
              : <span className="ct-tag">Not sent yet</span>}
            {(st === 'gold' || st === 'red') && (r.staff!.phone
              ? <a className="abtn sm dark" href={remindSms(r.staff!.phone, name, evs[0].event_date, venue, r.planned_start)}>Text</a>
              : <span className="abtn sm" aria-disabled title="No phone on file">Text</span>)}
            {st !== 'ok' && st !== 'pending' && <button className="abtn sm dark" title="They confirmed by text" onClick={() => markConfirmed(r.id, true)}>✓ Mark confirmed</button>}
            {st === 'ok' && r.confirmed_by && <button className="lnk sm" onClick={() => markConfirmed(r.id, false)}>Undo</button>}
          </div>
        );
      })}
      {okRows.length > confirmedShown && <button className="lnk sm" onClick={() => setMore(!more)}>{more ? 'Show less' : `+ ${okRows.length - confirmedShown} more confirmed`}</button>}
      <div className="muted sm">Grey = waiting under 6 h · gold = 6 h+, time to text · red = past 24 h. Nothing is cancelled by itself.</div>
    </div>
  );
}

/** Needs you: "2 people haven't confirmed after 6 h · 1 is overdue" (one line for all upcoming events). */
/** skipOverdue (push 47): people past 24 h are on the NOT CONFIRMED card instead. */
export async function lateConfirmations(today: string, skipOverdue = false): Promise<{ title: string; sub: string; to: string } | null> {
  const cut = new Date(Date.now() - 6 * 3600e3).toISOString();
  const { data, error } = await supabase.from('shifts')
    .select('id,event_id,confirm_sent_at,staff:staff!shifts_staff_id_fkey(full_name),events!inner(title,event_date,details_pending)')
    .eq('status', 'booked').is('attendance', null).not('confirm_sent_at', 'is', null).lte('confirm_sent_at', cut)
    .gte('events.event_date', today).order('confirm_sent_at');
  if (error || !Array.isArray(data) || !data.length) return null; // 039 not applied → nothing
  type R = { event_id: string; confirm_sent_at: string; staff: { full_name: string } | null; events: { title: string; event_date: string; details_pending?: boolean } };
  const rows = (data as unknown as R[]).filter((r) => r.events && !r.events.details_pending && !(skipOverdue && hoursSince(r.confirm_sent_at) >= 24));
  if (!rows.length) return null;
  const over = rows.filter((r) => hoursSince(r.confirm_sent_at) >= 24).length;
  const names = rows.slice(0, 4).map((r) => `${(r.staff?.full_name ?? '?').split(' ')[0]} (${r.events.title} ${dLabel(r.events.event_date)})`).join(', ');
  return {
    title: `${rows.length} ${rows.length === 1 ? 'person hasn’t' : 'people haven’t'} confirmed after 6 h${over ? ` · ${over} ${over === 1 ? 'is' : 'are'} overdue` : ''}`,
    sub: names + (rows.length > 4 ? ` +${rows.length - 4}` : ''),
    to: `/admin/event/${rows[0].event_id}`,
  };
}

// ───────── 33d · Nickname changed (admin Home) ─────────
type Nick = { id: string; staff_id: string; full_name: string; old_nickname: string | null; new_nickname: string | null; changed_at: string };
export function NicknameCards() {
  const [list, setList] = useState<Nick[]>([]);
  const [edit, setEdit] = useState<string | null>(null); const [val, setVal] = useState(''); const [err, setErr] = useState('');
  const load = () => supabase.rpc('admin_nickname_changes').then(({ data, error }) => { if (!error && Array.isArray(data)) setList(data as Nick[]); });
  useEffect(() => { load(); }, []);
  if (!list.length) return null;
  const ok = async (id: string) => { setList((l) => l.filter((x) => x.id !== id)); await supabase.rpc('admin_nickname_seen', { p_id: id }); };
  const save = async (n: Nick, v: string) => {
    setErr('');
    const clean = cleanNick(v);
    if (clean && !NICK_RE.test(clean)) return setErr('Letters only, 2 to 15 characters.');
    const { error } = await supabase.rpc('admin_set_nickname', { p_staff: n.staff_id, p_nickname: clean });
    if (error) return setErr(error.message);
    setEdit(null); load();
  };
  const first = (n: Nick) => n.full_name.split(' ')[0];
  return (
    <>
      {list.map((n) => (
        <div key={n.id} className="adm-card nick-card">
          <div className="row" style={{ justifyContent: 'space-between' }}><b>Nickname changed</b><span className="muted sm">{dLabel(n.changed_at.slice(0, 10), { month: 'short', day: 'numeric' })} · {tTime(n.changed_at)}</span></div>
          <div className="sm"><b>{n.full_name}</b> {n.new_nickname ? <>now goes by <b>“{n.new_nickname}”</b></> : <>cleared their nickname (uses “{first(n)}”)</>}</div>
          <div className="muted sm">was: {n.old_nickname ?? first(n)}</div>
          {edit === n.id ? (
            <div className="row wrap" style={{ gap: 8 }}>
              <input className="tin" style={{ width: 160 }} autoFocus maxLength={15} value={val} placeholder={first(n)} onChange={(e) => setVal(e.target.value)} />
              <button className="abtn sm dark" onClick={() => save(n, val)}>Save</button>
              <button className="abtn sm" onClick={() => save(n, '')}>Reset to {first(n)}</button>
              <button className="lnk sm" onClick={() => setEdit(null)}>Cancel</button>
              {err && <span className="error sm">{err}</span>}
            </div>
          ) : (
            <div className="row2"><button className="abtn sm dark" onClick={() => ok(n.id)}>OK</button><button className="abtn sm" onClick={() => { setEdit(n.id); setVal(n.new_nickname ?? ''); setErr(''); }}>Edit / reset</button></div>
          )}
        </div>
      ))}
      <div className="muted sm" style={{ padding: '0 6px' }}>Payroll, invoices, QuickBooks and sheets always use the full name.</div>
    </>
  );
}
