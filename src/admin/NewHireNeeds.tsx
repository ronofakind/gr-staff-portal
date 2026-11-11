// push 71 · Today → Needs you: new hires day 3+ (progress + Text), STUCK at 5+, first gig → QuickBooks + payroll (one Yes),
// Junior after 4 shifts → "Add table service?".
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { loadNewHires, progressOf, juniorOnly, missingFor, missingText, type NewHire } from '../lib/newHires';
import { cardsFor } from '../lib/handbook';

type Sh = { staff_id: string; planned_start: string; status: string; attendance: string | null; punches: { punch_in: string | null; punch_out: string | null } | null; events: { event_date: string; title: string } | null };
type Person = { id: string; full_name: string; phone: string | null; handbook_roles: string[] };
const dLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const first = (n: string) => n.split(' ')[0];

export function NewHireNeeds({ tick, onCount }: { tick: number; onCount?: (n: number) => void }) {
  const [hires, setHires] = useState<Record<string, NewHire>>({});
  const [people, setPeople] = useState<Record<string, Person>>({});
  const [shifts, setShifts] = useState<Sh[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [t, setT] = useState(0);
  useEffect(() => {
    (async () => {
      const h = await loadNewHires(); setHires(h);
      const ids = Object.keys(h); if (!ids.length) return;
      const [p, ob, sh, ar] = await Promise.all([
        supabase.from('staff').select('id,full_name,phone').in('id', ids),
        supabase.from('staff_onboarding').select('staff_id,handbook_roles').in('staff_id', ids),
        supabase.from('shifts').select('staff_id,planned_start,status,attendance,punches(punch_in,punch_out),events(event_date,title)').in('staff_id', ids).neq('status', 'declined'),
        supabase.from('admin_archive').select('key,sig').like('key', 'nh:%'),
      ]);
      const roles = new Map(((ob.data ?? []) as { staff_id: string; handbook_roles: string[] }[]).map((r) => [r.staff_id, r.handbook_roles]));
      setPeople(Object.fromEntries(((p.data ?? []) as { id: string; full_name: string; phone: string | null }[]).map((x) => [x.id, { ...x, handbook_roles: roles.get(x.id) ?? [] }])));
      setShifts((sh.data ?? []) as unknown as Sh[]);
      setHidden(new Set(((ar.data ?? []) as { key: string; sig: string }[]).map((a) => a.key + '|' + a.sig)));
    })();
  }, [tick, t]);

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const cards: JSX.Element[] = [];
  const hide = async (key: string, sig: string, label: string) => { await supabase.from('admin_archive').upsert({ key, sig, label, archived_at: new Date().toISOString() }); setT((x) => x + 1); };

  for (const h of Object.values(hires)) {
    const p = people[h.staff_id]; if (!p) continue;
    const mine = shifts.filter((s) => s.staff_id === h.staff_id && !s.attendance);
    // 1 · day 3+ still not finished → progress + Text (day 5+ = STUCK)
    const pr = progressOf(h, cardsFor({ handbook_roles: p.handbook_roles as never, paid_by: h.paid_by }).length);
    if (pr.open && pr.days >= 3) {
      const stuck = pr.days >= 5;
      const left = [!h.hb_done_at ? `Handbook ${pr.read}/${pr.n}` : null, h.paid_by === 'payroll' && !h.tax_done_at ? 'Tax & pay missing' : null].filter(Boolean).join(' · ');
      const msg = `Hi ${first(p.full_name)}! Just a reminder to finish getting started in the G&R app (${!h.hb_done_at ? 'the G&R Standard' : 'your tax and pay info'}) so we can start booking you: https://gr-staff-portal.vercel.app`;
      const tel = (p.phone ?? '').replace(/[^\d+]/g, '');
      cards.push(
        <div key={'ob' + h.staff_id} className={'nh-card' + (stuck ? ' stuck' : '')}>
          <div className="nh-top"><b>{p.full_name}</b>{stuck ? <i className="nh-tag red">STUCK · {pr.days} DAYS</i> : <i className="nh-tag">DAY {pr.days}</i>}</div>
          <div className="nh-bar"><i style={{ width: Math.round(pr.pct * 100) + '%' }} /></div>
          <small className="muted">{Math.round(pr.pct * 100)}% · {left}</small>
          <div className="nh-acts">
            {tel ? <a className="abtn sm dark" href={`sms:${tel}?&body=${encodeURIComponent(msg)}`}>Text {first(p.full_name)}</a> : <span className="muted sm">No phone</span>}
            <Link className="lnk sm" to="/admin/hiring">Hiring ›</Link>
          </div>
        </div>);
    }
    // 2 · first gig → QuickBooks + payroll (one Yes)
    const next = mine.filter((s) => s.events && s.events.event_date >= today).sort((a, b) => a.planned_start.localeCompare(b.planned_start))[0];
    const worked = mine.some((s) => s.punches?.punch_in);
    if (!h.firstgig_at && h.paid_by === 'payroll' && (next || worked)) {
      const gig = next?.events?.event_date ?? mine.find((s) => s.punches?.punch_in)?.events?.event_date ?? today;
      const miss = missingFor(h).filter((x) => x !== 'handbook');
      cards.push(
        <div key={'fg' + h.staff_id} className="nh-card">
          <div className="nh-top"><b>{first(p.full_name)}’s first gig is {dLabel(gig)}</b><i className="nh-tag gold">FIRST GIG</i></div>
          <span className="muted sm">Add to QuickBooks (supplier · ALL CAPS · T4A on) + the payroll sheet ({dLabel(gig)} pay period)?{miss.length ? ` QuickBooks waits for their tax & pay (${missingText(miss)}).` : ''}</span>
          <div className="nh-acts">
            <button className="abtn sm dark" onClick={async () => {
              await supabase.from('staff_onboarding').update({ firstgig_at: new Date().toISOString(), payroll_status: 'sending', payroll_for: gig, payroll_note: null }).eq('staff_id', h.staff_id);
              if (h.has_tax && !h.qb_status) await supabase.from('staff_tax').update({ qb_status: 'sending', qb_at: new Date().toISOString(), qb_note: null }).eq('staff_id', h.staff_id);
              setT((x) => x + 1);
            }}>Yes, add {first(p.full_name)}</button>
          </div>
        </div>);
    }
    // 3 · Junior after 4 shifts → table service?
    const done = mine.filter((s) => s.punches?.punch_in && s.events && s.events.event_date < today).length;
    if (juniorOnly(h) && done >= 4 && !hidden.has('nh:tbl:' + h.staff_id + '|' + done)) {
      cards.push(
        <div key={'tb' + h.staff_id} className="nh-card">
          <div className="nh-top"><b>{first(p.full_name)} has done {done} cocktails</b><i className="nh-tag">JUNIOR</i></div>
          <span className="muted sm">Add table service? Yes = all event types (sit-down dinners too).</span>
          <div className="nh-acts">
            <button className="abtn sm dark" onClick={async () => { await supabase.from('staff_onboarding').update({ table_ok_at: new Date().toISOString() }).eq('staff_id', h.staff_id); setT((x) => x + 1); }}>Add table service</button>
            <button className="lnk sm" onClick={() => hide('nh:tbl:' + h.staff_id, String(done), `${p.full_name} · table service · not yet`)}>Not yet</button>
          </div>
        </div>);
    }
    // 4 · payroll sheet result
    if (h.payroll_status === 'error') cards.push(
      <div key={'pe' + h.staff_id} className="nh-card stuck"><div className="nh-top"><b>{first(p.full_name)} · payroll sheet</b><i className="nh-tag red">NOT ADDED</i></div>
        <span className="muted sm">{h.payroll_note ?? 'Check the payroll sheet.'}</span>
        <div className="nh-acts"><button className="abtn sm" onClick={async () => { await supabase.from('staff_onboarding').update({ payroll_status: 'sending', payroll_note: null }).eq('staff_id', h.staff_id); setT((x) => x + 1); }}>Try again</button></div></div>);
  }
  useEffect(() => { onCount?.(cards.length); });
  if (!cards.length) return null;
  return <div className="nh-list">{cards}</div>;
}
