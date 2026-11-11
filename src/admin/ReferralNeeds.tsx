// push 75 · Today → Needs you: a new hire typed who referred them → "Is that Melanie Jobin?" Yes · Pick someone else · Skip.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type App = { id: string; first_name: string; last_name: string | null; referrer_text: string; staff_id: string };
type S = { id: string; full_name: string; nickname: string | null };
const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').trim();
/** Best guess for a typed name: full match > first + last start > first name start / nickname. */
function guess(text: string, staff: S[]): S | null {
  const t = norm(text); if (!t) return null; const tw = t.split(/\s+/);
  let best: S | null = null; let bs = 0;
  for (const s of staff) {
    const n = norm(s.full_name); const w = n.split(/\s+/); const nick = norm(s.nickname ?? '');
    let sc = 0;
    if (n === t) sc = 100;
    else if (tw.length > 1 && w[0].startsWith(tw[0]) && w.slice(1).some((x) => x.startsWith(tw[tw.length - 1]))) sc = 80;
    else if (nick && (nick === t || nick === tw[0])) sc = 70;
    else if (w[0] === tw[0]) sc = 60;
    else if (tw[0].length >= 3 && w[0].startsWith(tw[0])) sc = 50;
    if (sc > bs) { bs = sc; best = s; }
  }
  return best;
}

export function ReferralNeeds({ tick = 0, onCount }: { tick?: number; onCount?: (n: number) => void }) {
  const [apps, setApps] = useState<App[]>([]); const [staff, setStaff] = useState<S[]>([]); const [t, setT] = useState(0);
  const [pick, setPick] = useState<string | null>(null); const [q, setQ] = useState('');
  useEffect(() => { (async () => {
    const { data, error } = await supabase.from('applications').select('id,first_name,last_name,referrer_text,staff_id').eq('status', 'accepted').is('referral_status', null).is('referrer_id', null).not('referrer_text', 'is', null).not('staff_id', 'is', null).limit(20);
    if (error) { setApps([]); return; }
    setApps(((data ?? []) as App[]).filter((a) => a.referrer_text.trim()));
    const { data: st } = await supabase.from('staff').select('id,full_name,nickname').eq('active', true).order('full_name');
    setStaff((st ?? []) as S[]);
  })(); }, [tick, t]);
  useEffect(() => { onCount?.(apps.length); });
  if (!apps.length) return null;
  const done = async (a: App, who: S | null) => {
    await supabase.from('staff_private').upsert(who ? { staff_id: a.staff_id, knows_staff_id: who.id, knows_text: 'referred them' } : { staff_id: a.staff_id, knows_staff_id: null, knows_text: `referred by ${a.referrer_text.trim()}` });
    await supabase.from('applications').update({ referral_status: who ? 'matched' : 'skipped' }).eq('id', a.id);
    setPick(null); setQ(''); setT((x) => x + 1);
  };
  return <>{apps.map((a) => { const g = guess(a.referrer_text, staff.filter((s) => s.id !== a.staff_id));
    const list = q ? staff.filter((s) => s.id !== a.staff_id && norm(s.full_name).includes(norm(q))).slice(0, 8) : [];
    return <div key={a.id} className="nh-card">
      <div className="nh-top"><b>{a.first_name} says “{a.referrer_text.trim()}” referred them</b><i className="nh-tag">KNOWS</i></div>
      <span className="muted sm">{g ? <>Is that <b>{g.full_name}</b>?</> : 'No match in your staff list.'} It shows as “Knows …” on their profile and for MDs on their first shifts.</span>
      {pick === a.id && <div className="stack" style={{ gap: 4 }}>
        <input className="ef-in" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "8px 10px", font: "inherit" }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search staff…" />
        {list.map((s) => <button key={s.id} type="button" className="lnk" style={{ textAlign: 'left' }} onClick={() => done(a, s)}>{s.full_name}</button>)}
      </div>}
      <div className="nh-acts">
        {g && <button className="abtn sm dark" onClick={() => done(a, g)}>Yes, {g.full_name.split(' ')[0]}</button>}
        <button className="abtn sm" onClick={() => { setPick(pick === a.id ? null : a.id); setQ(''); }}>Pick someone else</button>
        <button className="lnk sm" onClick={() => done(a, null)}>Skip · keep “referred by {a.referrer_text.trim()}”</button>
      </div>
    </div>; })}</>;
}
