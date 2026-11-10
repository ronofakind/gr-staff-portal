import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { allStaff, isoDay, dLabel, type AStaff } from './api';
import { InviteModal } from './Invite';
import { cardsFor } from '../lib/handbook';

/** Nov 8 · push 55 (migration 082) · Hiring: applications from /apply → Accept · Keep for later · Reject (nothing sent).
 *  Accept → adds them to Staff + their start rate, then the welcome text with their personal app link (copied, sent by Ronnie). */
export type App = {
  id: string; created_at: string; status: 'new' | 'kept' | 'accepted' | 'rejected'; lang: string | null;
  first_name: string; last_name: string; email: string | null; phone: string | null; neighbourhood: string | null;
  roles: string[]; worked_in: string[]; years: string | null; lang_fr: number | null; lang_en: number | null; days: string[]; transport: string | null;
  cv_path: string | null; cv_name: string | null; no_cv_note: string | null; referrer_id: string | null; referrer_text: string | null; note: string | null;
  ai_summary: string | null; ai_level: string | null; decided_at: string | null; level: string | null; start_rate: number | null;
  handbook_roles: string[]; paid_by: 'payroll' | 'cash' | null; admin_note: string | null; staff_id: string | null;
};
const COLS = 'id,created_at,status,lang,first_name,last_name,email,phone,neighbourhood,roles,worked_in,years,lang_fr,lang_en,days,transport,cv_path,cv_name,no_cv_note,referrer_id,referrer_text,note,ai_summary,ai_level,decided_at,level,start_rate,handbook_roles,paid_by,admin_note,staff_id';
const ROLE: Record<string, string> = { waiter: 'Waiter', bartender: 'Bartender', barback: 'Barback', cook: 'Cook', manager: 'Manager' };
const WORK: Record<string, string> = { fine_dining: 'Fine dining', banquets: 'Banquets', catering: 'Catering', hotel: 'Hotel', cocktail_bar: 'Cocktail bar', cafe: 'Café', none: 'Not yet' };
const YRS: Record<string, string> = { none: 'no experience', lt1: '< 1 year', '1-2': '1–2 years', '3-5': '3–5 years', '5+': '5+ years' };
const DAY: Record<string, string> = { weekday_days: 'weekday days', weekday_evenings: 'weekday evenings', weekends: 'weekends', anytime: 'anytime' };
const LV = ['', 'basic', 'good', 'fluent'];
const digits = (p: string | null) => (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
export const fullName = (a: App) => `${a.first_name} ${a.last_name}`.trim();
const ago = (iso: string) => { const m = Math.round((Date.now() - +new Date(iso)) / 60000); return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : dLabel(isoDay(new Date(iso)), { month: 'short', day: 'numeric' }); };
export const applyLink = () => `https://${window.location.host}/apply`;

export function useApplications(tick = 0) {
  const [rows, setRows] = useState<App[] | null>(null); const [staff, setStaff] = useState<AStaff[]>([]); const [t2, setT2] = useState(0);
  useEffect(() => {
    supabase.from('applications').select(COLS).order('created_at', { ascending: false }).limit(500)
      .then(({ data, error }) => setRows(error ? null : (data ?? []).map((a) => ({ ...(a as App), start_rate: (a as App).start_rate == null ? null : Number((a as App).start_rate) }))));
    allStaff().then(setStaff).catch(() => {});
  }, [tick, t2]);
  useEffect(() => {
    const ch = supabase.channel('apps').on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => setT2((x) => x + 1)).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);
  return { rows, staff, reload: () => setT2((x) => x + 1) };
}

/** Flags shown on a card: worked for G&R before · applied before · referred by. */
function flagsFor(a: App, all: App[], staff: AStaff[]) {
  const f: { t: string; cls: string }[] = [];
  const p = digits(a.phone); const e = a.email?.toLowerCase();
  const was = staff.find((s) => !s.active && ((e && s.email?.toLowerCase() === e) || (p && digits(s.phone) === p)));
  if (was) f.push({ t: `Worked for G&R before · ${was.full_name}`, cls: 'gold' });
  const prev = all.filter((x) => x.id !== a.id && x.created_at < a.created_at && ((e && x.email?.toLowerCase() === e) || (p && digits(x.phone) === p)));
  if (prev.length) f.push({ t: `Applied before · ${prev[0].status === 'rejected' ? 'rejected' : prev[0].status} ${dLabel(isoDay(new Date(prev[0].created_at)), { month: 'short', year: 'numeric' })}`, cls: prev[0].status === 'rejected' ? 'red' : 'grey' });
  return f;
}
const refName = (a: App, staff: AStaff[]) => (a.referrer_id ? staff.find((s) => s.id === a.referrer_id)?.full_name ?? 'a staff member' : a.referrer_text);

async function openCv(path: string) {
  const w = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('applications').createSignedUrl(path, 600);
  if (error || !data) { w?.close(); alert('Couldn’t open the CV: ' + (error?.message ?? '')); return; }
  if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

/** One application, short (Today) or full (Hiring page / sheet). */
export function AppCard({ a, all, staff, full, onOpen }: { a: App; all: App[]; staff: AStaff[]; full?: boolean; onOpen?: () => void }) {
  const flags = flagsFor(a, all, staff); const ref = refName(a, staff);
  const line = [a.roles.map((r) => ROLE[r] ?? r).join(' · '), a.years ? YRS[a.years] : null].filter(Boolean).join(' · ');
  return (
    <div className={'hr-card' + (full ? ' full' : '')} onClick={onOpen} role={onOpen ? 'button' : undefined}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span className="hr-av">{a.first_name[0]}{a.last_name[0]}</span>
        <span className="grow"><b>{fullName(a)}</b><small className="muted">{line || '—'}</small></span>
        <span className="muted sm">{ago(a.created_at)}</span>
      </div>
      {a.ai_summary ? <div className="hr-ai"><b>AI · first read{a.ai_level ? ` · suggests ${a.ai_level.toLowerCase()}` : ''}</b><span style={{ whiteSpace: 'pre-line' }}>{a.ai_summary}</span></div> : full ? <div className="muted sm">AI first read: within the hour (the hourly check reads the CV).</div> : null}
      {(ref || flags.length > 0) && <div className="row wrap" style={{ gap: 6 }}>{ref && <i className="hr-tag ok">Referred by {ref}</i>}{flags.map((f) => <i key={f.t} className={'hr-tag ' + f.cls}>{f.t}</i>)}</div>}
      {full && <div className="hr-grid">
        <span>Worked in</span><b>{a.worked_in.map((w) => WORK[w] ?? w).join(' · ') || '—'}</b>
        <span>Languages</span><b>{[a.lang_fr ? `FR ${LV[a.lang_fr]}` : null, a.lang_en ? `EN ${LV[a.lang_en]}` : null].filter(Boolean).join(' · ') || '—'}</b>
        <span>Usually free</span><b>{a.days.map((d) => DAY[d] ?? d).join(' · ') || '—'}</b>
        <span>Getting there</span><b>{a.transport === 'car' ? 'Has a car' : a.transport === 'transit' ? 'Transit' : '—'}{a.neighbourhood ? ` · ${a.neighbourhood}` : ''}</b>
        <span>Phone</span><b><a href={`tel:${a.phone}`}>{a.phone}</a></b>
        <span>Email</span><b>{a.email}</b>
        <span>Wrote in</span><b>{a.lang === 'fr' ? 'French' : 'English'}</b>
      </div>}
      {full && (a.cv_path ? <button className="abtn" onClick={(e) => { e.stopPropagation(); openCv(a.cv_path!); }}>📄 Open CV{a.cv_name ? ` · ${a.cv_name}` : ''}</button>
        : a.no_cv_note ? <div className="hr-ai"><b>No CV · in their words</b><span>{a.no_cv_note}</span></div> : null)}
    </div>
  );
}

const LEVELS = [
  { k: 'JUNIOR', l: 'Junior', rate: 18, sub: 'no experience · $18 · cocktail dînatoire only' },
  { k: 'MID', l: 'Mid', rate: 20, sub: 'some experience · $20' },
  { k: 'SENIOR', l: 'Senior', rate: 22, sub: 'a lot of experience · $21–25' },
];
const HB = [{ k: 'floor', l: 'Floor' }, { k: 'bar', l: 'Bar' }, { k: 'busboy', l: 'Busboy / barback' }];
const guessLevel = (a: App) => (a.ai_level && LEVELS.some((x) => x.k === a.ai_level) ? a.ai_level : !a.years || a.years === 'none' || a.years === 'lt1' ? 'JUNIOR' : a.years === '1-2' || a.years === '3-5' ? 'MID' : 'SENIOR');
const guessHb = (a: App) => [...new Set(a.roles.flatMap((r) => (r === 'waiter' || r === 'manager' ? ['floor'] : r === 'bartender' ? ['bar'] : r === 'barback' ? ['busboy'] : [])))];
const welcome = (lang: 'fr' | 'en') => (s: AStaff, token: string) => {
  const first = s.full_name.split(' ')[0]; const link = `https://${window.location.host}/go/${token}`;
  return lang === 'fr'
    ? `Salut ${first} ! Bienvenue chez G&R 🎉\n\nVoici ton lien vers l’app G&R. Crée ton profil (5 min) et lis le guide de l’employé — ensuite les demandes d’événements arrivent directement dans l’app 👉 ${link}\nTon courriel de connexion : ${s.email}`
    : `Hi ${first}! Welcome to G&R 🎉\n\nHere’s your link to the G&R app. Set up your profile (5 min) and read the handbook — then you’ll start getting event requests right in the app 👉 ${link}\nYour sign-in email: ${s.email}`;
};

/** Review sheet: full card + Accept (level, handbook roles, paid by) · Keep for later · Reject. */
export function AppSheet({ a, all, staff, onClose, onDone }: { a: App; all: App[]; staff: AStaff[]; onClose: () => void; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<'view' | 'accept' | 'reject'>('view');
  const [level, setLevel] = useState(guessLevel(a)); const [rate, setRate] = useState(String(LEVELS.find((x) => x.k === guessLevel(a))!.rate));
  const [hb, setHb] = useState<string[]>(guessHb(a)); const [paid, setPaid] = useState<'payroll' | 'cash'>('payroll');
  const [refRate, setRefRate] = useState<number | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<AStaff | null>(null); const [why, setWhy] = useState('');
  const refStaff = a.referrer_id ? staff.find((s) => s.id === a.referrer_id) : null;
  useEffect(() => {
    if (!a.referrer_id) return;
    supabase.from('staff_rates').select('rate,from_date').eq('staff_id', a.referrer_id).lte('from_date', isoDay(new Date())).order('from_date', { ascending: false }).limit(1)
      .then(({ data }) => setRefRate(data?.[0] ? Number(data[0].rate) : null));
  }, [a.referrer_id]);
  const pickLevel = (k: string) => { setLevel(k); setRate(String(LEVELS.find((x) => x.k === k)!.rate)); };

  const decide = async (status: 'kept' | 'rejected', note?: string) => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('applications').update({ status, decided_at: new Date().toISOString(), admin_note: note || a.admin_note, updated_at: new Date().toISOString() }).eq('id', a.id);
    setBusy(false); if (error) { setErr(error.message); return; }
    onDone(status === 'kept' ? `${a.first_name} · kept for later` : `${a.first_name} · rejected · nothing sent`);
  };

  const accept = async () => {
    const r = Number(rate.replace(',', '.'));
    if (!(r >= 15 && r <= 60)) { setErr('Check the rate'); return; }
    if (!hb.length) { setErr('Pick at least one handbook role'); return; }
    setBusy(true); setErr('');
    const both = hb.includes('floor') && hb.includes('bar');
    const dept = both || hb.includes('floor') ? 'floor' : 'bar';
    const row = { full_name: fullName(a), email: a.email?.toLowerCase() ?? null, phone: a.phone, language: a.lang === 'fr' ? 'fr' : 'en', department: dept, role: 'staff', active: true,
      positions: both ? ['BAR'] : [], transport: a.transport === 'car' ? 'car' : a.transport === 'transit' ? 'transit' : null };
    let ins = await supabase.from('staff').insert(row).select('id').single();
    if (ins.error && /transport/.test(ins.error.message)) { const { transport: _t, ...r2 } = row; ins = await supabase.from('staff').insert(r2).select('id').single(); } // eslint-disable-line @typescript-eslint/no-unused-vars
    if (ins.error) { setBusy(false); setErr(/duplicate|unique/i.test(ins.error.message) ? 'This email is already on a staff profile (maybe inactive). Open Staff and reactivate them instead.' : ins.error.message); return; }
    const sid = (ins.data as { id: string }).id;
    const lv = LEVELS.find((x) => x.k === level)!;
    const sameAsRef = refStaff && refRate != null && r === refRate;
    await supabase.from('staff_rates').upsert({ staff_id: sid, rate: r, from_date: isoDay(new Date()), reason: `Start · ${lv.l}${sameAsRef ? ` · same as ${refStaff!.full_name.split(' ')[0]}` : ''}`, source: 'app' }, { onConflict: 'staff_id,from_date' });
    // Application → profile check-up: neighbourhood + languages are already filled in for them (staff_private, same fields the check-up saves).
    const langs = a.lang_fr && a.lang_en ? { fr: a.lang_fr, en: a.lang_en } : null;
    await supabase.from('staff_private').upsert({ staff_id: sid, neighbourhood: a.neighbourhood?.trim() || null, ...(langs ? { languages: langs } : {}), notes: `Hired ${isoDay(new Date())} · ${lv.l} · ${paid === 'cash' ? 'cash' : 'payroll'}${refStaff ? ` · referred by ${refStaff.full_name}` : ''}` });
    await supabase.from('staff_onboarding').upsert({ staff_id: sid, level, handbook_roles: hb, paid_by: paid }); // push 56 · handbook by role + tax & pay
    const up = await supabase.from('applications').update({ status: 'accepted', decided_at: new Date().toISOString(), level, start_rate: r, handbook_roles: hb, paid_by: paid, staff_id: sid, updated_at: new Date().toISOString() }).eq('id', a.id);
    setBusy(false); if (up.error) { setErr(up.error.message); return; }
    setInvite({ id: sid, full_name: row.full_name, email: row.email, phone: row.phone, language: row.language as 'fr' | 'en', department: dept as 'floor' | 'bar', role: 'staff', positions: row.positions, active: true, photo_url: null, staff_private: null });
  };

  if (invite) return <InviteModal queue={[invite]} textFor={welcome(a.lang === 'fr' ? 'fr' : 'en')} title={`Welcome ${a.first_name}`} onClose={() => onDone(`${a.first_name} · accepted · added to Staff`)} onChanged={() => {}} />;
  return (
    <div className="t4-edit-wrap" onClick={onClose}><div className="t4-edit hr-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ alignItems: 'center' }}><span className="kick grow">APPLICATION · {a.status === 'new' ? 'NEW' : a.status.toUpperCase()}</span><button className="sq" aria-label="Close" onClick={onClose}>×</button></div>
      <AppCard a={a} all={all} staff={staff} full />
      {mode === 'view' && a.status !== 'accepted' && <div className="hr-acts">
        <button className="abtn ok" onClick={() => setMode('accept')}>✓ Accept</button>
        {a.status !== 'kept' && <button className="abtn" disabled={busy} onClick={() => decide('kept')}>Keep for later</button>}
        <button className="abtn" onClick={() => setMode('reject')}>Reject</button>
      </div>}
      {mode === 'reject' && <div className="stack" style={{ gap: 8 }}>
        <b>Reject {a.first_name}?</b><span className="muted sm">Nothing is sent to them. Kept 12 months, then deleted.</span>
        <input className="t4-search" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why (only you see this · optional)" maxLength={200} />
        <div className="row" style={{ gap: 8 }}><button className="abtn dark" disabled={busy} onClick={() => decide('rejected', why.trim())}>Reject · nothing sent</button><button className="lnk muted" onClick={() => setMode('view')}>Cancel</button></div>
      </div>}
      {mode === 'accept' && <div className="stack" style={{ gap: 12 }}>
        <div className="hr-q"><b>Level</b><div className="hr-opts">{LEVELS.map((x) => <button key={x.k} className={level === x.k ? 'on' : ''} onClick={() => pickLevel(x.k)}><b>{x.l}</b><small>{x.sub}</small></button>)}</div></div>
        <label className="rt-f">Start rate ($/h)<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
        {refStaff && refRate != null && <div className="cu-box amber"><span>Referred by <b>{refStaff.full_name}</b> · {refStaff.full_name.split(' ')[0]} is at <b>${refRate}</b>/h. Same experience → same rate.</span>
          {Number(rate) !== refRate && <button className="abtn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRate(String(refRate))}>Use ${refRate}</button>}</div>}
        <div className="hr-q"><b>Handbook · which parts</b><div className="hr-chips">{HB.map((x) => <button key={x.k} className={hb.includes(x.k) ? 'on' : ''} onClick={() => setHb(hb.includes(x.k) ? hb.filter((y) => y !== x.k) : [...hb, x.k])}>{x.l}</button>)}</div></div>
        <div className="hr-q"><b>Paid by</b><div className="hr-chips">{(['payroll', 'cash'] as const).map((x) => <button key={x} className={paid === x ? 'on' : ''} onClick={() => setPaid(x)}>{x === 'payroll' ? 'Payroll' : 'Cash · by their manager'}</button>)}</div>
          <small className="muted">{paid === 'cash' ? 'No SIN, address or void cheque asked. Not added to QuickBooks / payroll.' : 'Tax & pay step (SIN, address, void cheque) before their first shift.'}</small></div>
        <div className="muted sm">Adds {a.first_name} to Staff with this rate, then gives you the welcome text with their personal app link to copy.</div>
        {err && <p className="error">{err}</p>}
        <div className="row" style={{ gap: 8 }}><button className="abtn ok" disabled={busy} onClick={accept}>{busy ? 'Adding…' : `Accept ${a.first_name} · $${rate}/h`}</button><button className="lnk muted" onClick={() => setMode('view')}>Cancel</button></div>
      </div>}
      {mode !== 'accept' && err && <p className="error">{err}</p>}
      {a.status === 'accepted' && <div className="cu-box ok"><b>Accepted {a.decided_at ? dLabel(isoDay(new Date(a.decided_at)), { month: 'short', day: 'numeric' }) : ''}</b><span>{a.level ? LEVELS.find((x) => x.k === a.level)?.l : ''}{a.start_rate ? ` · $${a.start_rate}/h` : ''}{a.paid_by ? ` · ${a.paid_by}` : ''}{a.handbook_roles.length ? ` · handbook: ${a.handbook_roles.join(', ')}` : ''}</span></div>}
    </div></div>
  );
}

function CopyLink() {
  const [ok, setOk] = useState(false);
  return <button className="lnk" onClick={() => { navigator.clipboard?.writeText(applyLink()).then(() => { setOk(true); setTimeout(() => setOk(false), 1800); }); }}>{ok ? '✓ Link copied' : 'Copy apply link'}</button>;
}

/** push 56 · accepted, not finished: set up (check-up) · handbook x/N · tax & pay. 5 days + → red (your Needs you). */
type ObRow = { staff_id: string; created_at: string; handbook_roles: string[]; paid_by: 'payroll' | 'cash'; hb_seen: string[]; hb_done_at: string | null; tax_done_at: string | null;
  staff: { full_name: string; phone: string | null } | null; setup: boolean };
export function useOnboardingProgress(tick = 0) {
  const [rows, setRows] = useState<ObRow[] | null>(null);
  useEffect(() => {
    supabase.from('staff_onboarding').select('staff_id,created_at,handbook_roles,paid_by,hb_seen,hb_done_at,tax_done_at,staff:staff!staff_onboarding_staff_id_fkey(full_name,phone)').order('created_at', { ascending: false }).limit(100)
      .then(async ({ data, error }) => {
        if (error) { setRows(null); return; }
        const list = (data ?? []) as unknown as Omit<ObRow, 'setup'>[];
        const { data: sp } = list.length ? await supabase.from('staff_private').select('staff_id,checkup_done_at').in('staff_id', list.map((r) => r.staff_id)) : { data: [] };
        const done = new Set(((sp ?? []) as { staff_id: string; checkup_done_at: string | null }[]).filter((x) => x.checkup_done_at).map((x) => x.staff_id));
        setRows(list.map((r) => ({ ...r, setup: done.has(r.staff_id) })));
      });
  }, [tick]);
  return rows;
}
const obOpen = (r: ObRow) => !r.setup || !r.hb_done_at || (r.paid_by === 'payroll' && !r.tax_done_at);
const daysSince = (iso: string) => Math.floor((Date.now() - +new Date(iso)) / 864e5);
export function OnboardingList({ rows, all }: { rows: ObRow[]; all?: boolean }) {
  const list = all ? rows : rows.filter(obOpen);
  if (!list.length) return null;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="kick">GETTING STARTED · {list.length}</span>
      {list.map((r) => {
        const n = cardsFor(r).length; const read = Math.min(r.hb_seen.length, n); const d = daysSince(r.created_at); const stuck = obOpen(r) && d >= 5;
        const where = !r.setup ? 'set up' : !r.hb_done_at ? 'handbook' : r.paid_by === 'payroll' && !r.tax_done_at ? 'tax & pay' : '';
        return (
          <div key={r.staff_id} className={'ob-row' + (stuck ? ' stuck' : '')}>
            <span className="grow"><b>{r.staff?.full_name ?? '—'}</b>{obOpen(r) && (() => { const tot = n + (r.paid_by === 'payroll' ? 2 : 0) + 1; const dn = (r.hb_done_at ? n : read) + (r.paid_by === 'payroll' && r.tax_done_at ? 2 : 0) + (r.setup ? 1 : 0);
              return <span className="nh-bar" style={{ margin: '4px 0', maxWidth: 220 }}><i style={{ width: Math.round((dn / tot) * 100) + '%' }} /></span>; })()}<small className="muted">{obOpen(r) ? `${stuck ? 'stuck on' : 'on'} ${where} · accepted ${d === 0 ? 'today' : d + ' day' + (d > 1 ? 's' : '') + ' ago'}` : '✓ ready'} · {r.paid_by}</small></span>
            <span className="ob-steps">
              <i className={r.setup ? 'ok' : ''}>Set up</i>
              <i className={r.hb_done_at ? 'ok' : read ? 'mid' : ''}>Handbook {r.hb_done_at ? '✓' : `${read}/${n}`}</i>
              {r.paid_by === 'payroll' && <i className={r.tax_done_at ? 'ok' : ''}>Tax & pay{r.tax_done_at ? ' ✓' : ''}</i>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Today → Hiring section body. */
export function HiringToday({ tick }: { tick: number }) {
  const { rows, staff, reload } = useApplications(tick); const ob = useOnboardingProgress(tick);
  const [open, setOpen] = useState<App | null>(null); const [toast, setToast] = useState('');
  if (rows === null) return <div className="muted sm">Hiring starts after migration 082.</div>;
  const fresh = rows.filter((a) => a.status === 'new'); const kept = rows.filter((a) => a.status === 'kept').length;
  return (
    <div className="adm-card t4-card stack" style={{ gap: 8 }}>
      {ob && <OnboardingList rows={ob} />}
      {!fresh.length && <div className="muted sm" style={{ padding: '6px 0' }}>No new applications.{kept ? ` ${kept} kept for later.` : ''}</div>}
      {fresh.slice(0, 6).map((a) => <AppCard key={a.id} a={a} all={rows} staff={staff} onOpen={() => setOpen(a)} />)}
      <div className="row" style={{ justifyContent: 'space-between' }}><CopyLink />{fresh.length > 6 && <span className="muted sm">+{fresh.length - 6} more</span>}</div>
      {toast && <div className="muted sm">{toast}</div>}
      {open && <AppSheet a={open} all={rows} staff={staff} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setToast(m); reload(); }} />}
    </div>
  );
}
export function useNewApplicationsCount(tick: number) {
  const [n, setN] = useState(0);
  useEffect(() => { supabase.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'new').then(({ count }) => setN(count ?? 0)); }, [tick]);
  return n;
}

/** /admin/hiring */
export function Hiring() {
  const { rows, staff, reload } = useApplications(); const ob = useOnboardingProgress();
  const [tab, setTab] = useState<App['status']>('new'); const [open, setOpen] = useState<App | null>(null); const [toast, setToast] = useState('');
  const counts = useMemo(() => (rows ?? []).reduce<Record<string, number>>((m, a) => { m[a.status] = (m[a.status] ?? 0) + 1; return m; }, {}), [rows]);
  const list = (rows ?? []).filter((a) => a.status === tab);
  return (
    <div className="stack-lg">
      <div className="toolbar"><div><div className="kick">PEOPLE</div><h1 className="serif-h">Hiring</h1></div>
        <div className="row" style={{ gap: 10, alignItems: 'center' }}><CopyLink /><a className="abtn" href="/apply" target="_blank" rel="noreferrer">Open the apply page ↗</a></div></div>
      {rows === null ? <div className="muted">Hiring starts after migration 082.</div> : <>
        <div className="row wrap" style={{ gap: 6 }}>{(['new', 'kept', 'accepted', 'rejected'] as const).map((k) => <button key={k} className={'abtn sm' + (tab === k ? ' dark' : '')} onClick={() => setTab(k)}>{k === 'new' ? 'New' : k === 'kept' ? 'Kept for later' : k === 'accepted' ? 'Accepted' : 'Rejected'}{counts[k] ? ` · ${counts[k]}` : ''}</button>)}</div>
        {toast && <div className="cu-box ok">{toast}</div>}
        {tab === 'accepted' && ob && ob.length > 0 && <div className="adm-card"><OnboardingList rows={ob} all /></div>}
        <div className="hr-list">{list.map((a) => <AppCard key={a.id} a={a} all={rows} staff={staff} onOpen={() => setOpen(a)} />)}
          {!list.length && <div className="muted sm">Nothing here.</div>}</div>
      </>}
      {open && rows && <AppSheet a={open} all={rows} staff={staff} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setToast(m); reload(); }} />}
    </div>
  );
}

/** push 58 · staff profile: tax and pay exactly as it goes to QuickBooks (ALL CAPS) + Add to QuickBooks. Admin only; SIN hidden until Show. */
type Tax = { first_name: string | null; middle_name: string | null; last_name: string | null; legal_name: string | null; email: string | null; phone: string | null;
  street: string | null; apt: string | null; city: string | null; province: string | null; postal_code: string | null; address: string | null; birthday: string | null;
  sin: string; pay_method: 'deposit' | 'paypal'; paypal_email: string | null; cheque_path: string | null; sin_card_path: string | null; updated_at: string;
  qb_status: 'sending' | 'done' | 'error' | null; qb_vendor_id: string | null; qb_note: string | null; qb_at: string | null };
export function TaxCard({ staffId }: { staffId: string }) {
  const [t, setT] = useState<Tax | null>(null); const [show, setShow] = useState(false); const [tick, setTick] = useState(0);
  const [ob, setOb] = useState<{ paid_by: string; hb_done_at: string | null; payroll_status: string | null; payroll_for: string | null; level: string | null; table_ok_at: string | null } | null>(null);
  useEffect(() => { supabase.from('staff_tax').select('*').eq('staff_id', staffId).maybeSingle().then(({ data }) => setT((data as Tax) ?? null));
    supabase.from('staff_onboarding').select('paid_by,hb_done_at,payroll_status,payroll_for,level,table_ok_at').eq('staff_id', staffId).maybeSingle().then(({ data }) => setOb(data ?? null)); }, [staffId, tick]);
  // push 71 · booked before the paperwork: what's still missing (stays flagged until pay)
  const obLine = ob && <>{ob.payroll_status && <span className="muted sm">Payroll sheet: {ob.payroll_status === 'done' ? '✓ added' : ob.payroll_status === 'sending' ? `adding (${ob.payroll_for ?? ''} pay period)` : 'not added, see Today'}</span>}
    {(ob.level ?? '').toUpperCase() === 'JUNIOR' && <span className="row" style={{ gap: 8, alignItems: 'center' }}><span className="muted sm">{ob.table_ok_at ? 'Junior · table service OK' : 'Junior · cocktail dînatoire + canapés only'}</span>
      <button className="lnk sm" onClick={async () => { await supabase.from('staff_onboarding').update({ table_ok_at: ob.table_ok_at ? null : new Date().toISOString() }).eq('staff_id', staffId); setTick((x) => x + 1); }}>{ob.table_ok_at ? 'Back to cocktail only' : 'Add table service'}</button></span>}</>;
  if (!t) return ob ? (
    <div className="adm-card stack" style={{ gap: 8 }}>
      <span className="kick">TAX AND PAY · ONLY YOU SEE THIS</span>
      {ob.paid_by === 'payroll' ? <div className="pay-miss"><b>Not sent yet</b><span>No SIN · no void cheque / PayPal · no address{ob.hb_done_at ? '' : ' · handbook not done'}. You can still book them; it's flagged before pay.</span></div>
        : <span className="muted sm">Paid cash · no tax and pay needed.{ob.hb_done_at ? '' : ' Handbook not done.'}</span>}
      {obLine}
    </div>) : null;
  const open = async (path: string | null) => { if (!path) return; const w = window.open('', '_blank'); const { data } = await supabase.storage.from('tax-docs').createSignedUrl(path, 600); if (data && w) w.location.href = data.signedUrl; else w?.close(); };
  const up = (x: string | null | undefined) => (x ?? '').toUpperCase();
  const name = up([t.first_name, t.middle_name, t.last_name].filter(Boolean).join(' ') || t.legal_name);
  const addr = t.street ? up(`${t.street}${t.apt ? ', APT ' + t.apt : ''}, ${t.city} ${t.province} ${t.postal_code}, CANADA`) : up(t.address);
  const sin = t.sin.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  const setQb = async (status: 'sending' | null) => { await supabase.from('staff_tax').update({ qb_status: status, qb_at: status ? new Date().toISOString() : null, qb_note: null }).eq('staff_id', staffId); setTick((x) => x + 1); };
  const tag = t.qb_status === 'done' ? ['IN QUICKBOOKS', 'ok'] : t.qb_status === 'sending' ? ['SENDING', ''] : t.qb_status === 'error' ? ['QUICKBOOKS ERROR', 'red'] : ['READY FOR QUICKBOOKS', 'gold'];
  return (
    <div className="adm-card stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8 }}><span className="kick grow">TAX AND PAY · ONLY YOU SEE THIS · {dLabel(isoDay(new Date(t.updated_at)), { month: 'short', day: 'numeric' })}</span><i className={'hr-tag ' + tag[1]}>{tag[0]}</i></div>
      <div className="hr-grid">
        <span>Supplier name</span><b>{name}</b>
        {t.email && <><span>Email</span><b>{up(t.email)}</b></>}
        {t.phone && <><span>Phone</span><b>{t.phone}</b></>}
        <span>Address</span><b>{addr}</b>
        <span>SIN</span><b>{show ? sin : '••• ••• ' + t.sin.slice(-3)} <button className="lnk" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></b>
        <span>Paid by</span><b>{t.pay_method === 'paypal' ? `PayPal · ${t.paypal_email ?? ''}` : 'Direct deposit'}</b>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {t.cheque_path && <button className="abtn sm" onClick={() => open(t.cheque_path)}>Open void cheque</button>}
        {t.sin_card_path && <button className="abtn sm" onClick={() => open(t.sin_card_path)}>Open SIN card</button>}
      </div>
      {t.qb_status === null && <div className="row" style={{ gap: 10, alignItems: 'center' }}><button className="abtn dark" onClick={() => setQb('sending')}>Add to QuickBooks</button><span className="muted sm">Supplier · ALL CAPS · T4A on · Individual</span></div>}
      {t.qb_status === 'sending' && <div className="cu-box amber"><span>Sending to QuickBooks · done by 8 AM (it checks for a duplicate first). <button className="lnk" onClick={() => setQb(null)}>Cancel</button></span></div>}
      {t.qb_status === 'error' && <div className="cu-box amber"><b>QuickBooks didn’t take it</b><span>{t.qb_note}</span><button className="abtn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setQb('sending')}>Try again</button></div>}
      {t.qb_status === 'done' && <div className="cu-box ok"><b>✓ In QuickBooks{t.qb_vendor_id ? ` · supplier #${t.qb_vendor_id}` : ''}</b>
        <span>{t.qb_note ?? 'T4A on.'} {t.qb_vendor_id && <a href={`https://qbo.intuit.com/app/vendordetail?nameId=${t.qb_vendor_id}`} target="_blank" rel="noreferrer">Open in QuickBooks ↗</a>}</span></div>}
      {obLine}
    </div>
  );
}
