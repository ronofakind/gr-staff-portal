import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { callName } from '../lib/nickname';
import { Avatar } from '../components/Avatar';
import { dLabel, isoDay, type AStaff } from './api';

/** One row of admin_invite_overview() (migration 040). */
export type InviteRow = {
  staff_id: string; has_login: boolean; code_set: boolean; last_sign_in_at: string | null; last_seen_at: string | null;
  invite_sent_at: string | null; invite_expires_at: string | null; invite_used_at: string | null; invite_revoked_at: string | null;
};
export type AppKey = 'signed' | 'waiting' | 'opened' | 'expired' | 'none' | 'noemail';
export type AppStatus = { key: AppKey; label: string; cls: 'grey' | 'gold' | 'red' | 'green'; action: 'Invite' | 'Resend' | 'Add email' | 'Add phone' | null };

const md = (iso: string) => dLabel(isoDay(new Date(iso)), { month: 'short', day: 'numeric' });

/** Push 34a · app status chip + the one action for that person. */
export function appStatus(s: AStaff, r?: InviteRow | null): AppStatus {
  const phone = !!s.phone?.replace(/\D/g, '');
  if (r?.code_set) return { key: 'signed', label: '✓ SIGNED IN', cls: 'green', action: null };
  if (!s.email) return { key: 'noemail', label: 'NO EMAIL', cls: 'red', action: 'Add email' };
  const resend = phone ? 'Resend' : 'Add phone';
  if (!r?.invite_sent_at) return { key: 'none', label: 'NOT INVITED', cls: 'grey', action: phone ? 'Invite' : 'Add phone' };
  if (r.invite_used_at) return { key: 'opened', label: `INVITED ${md(r.invite_sent_at)} · OPENED`, cls: 'gold', action: resend };
  if (r.invite_revoked_at || (r.invite_expires_at && r.invite_expires_at <= new Date().toISOString())) return { key: 'expired', label: 'LINK EXPIRED', cls: 'red', action: resend };
  return { key: 'waiting', label: `INVITED ${md(r.invite_sent_at)} · NOT OPENED`, cls: 'gold', action: resend };
}

/** Statuses for everyone (admin only). string = error to show. */
export async function loadInviteStatus(): Promise<Record<string, InviteRow> | string> {
  const { data, error } = await supabase.rpc('admin_invite_overview');
  if (error) return /function|schema|exist/i.test(error.message) ? 'App status needs migration 040 (not applied yet).' : error.message;
  return Object.fromEntries(((data ?? []) as InviteRow[]).map((r) => [r.staff_id, r]));
}

/** Is SUPABASE_SERVICE_ROLE_KEY set in Vercel? (api/go?check=1). null = still checking. */
let readyCache: boolean | null = null;
export function useInviteReady() {
  const [ready, setReady] = useState<boolean | null>(readyCache);
  useEffect(() => {
    if (readyCache !== null) return;
    fetch('/api/go?check=1').then((r) => (r.ok ? r.json() : { ready: false })).catch(() => ({ ready: false }))
      .then((d: { ready?: boolean }) => { readyCache = d.ready === true; setReady(readyCache); });
  }, []);
  return ready;
}

/** The text Ronnie pastes in WhatsApp / iMessage. No dates, no 🙏. Greeting = nickname, else first name. */
// Nov 16 · during the transition: November in the app isn't 100% accurate, texts stay the source for confirmations (in their language)
export const inviteText = (s: AStaff, token: string) => { const link = `https://${window.location.host}/go/${token}`;
  return s.language === 'fr'
    ? `Salut ${callName(s)}! Ronnie t’a ajouté à l’app G&R.\n\nTouche le lien pour créer ton compte (2 min) 👉 ${link}\nTon courriel de connexion : ${s.email}\n\nImportant : on est en transition, donc les événements de novembre ne seront pas 100 % exacts dans l’app. Pour novembre, les textos que je t’envoie restent la source officielle pour tes confirmations. À partir de décembre, tout se fera dans l’app.`
    : `Hey ${callName(s)}! Ronnie added you to the G&R staff app.\n\nTap to set up your account (2 min) 👉 ${link}\nYour sign-in email: ${s.email}\n\nImportant: we’re in transition, so November events won’t be 100% accurate in the app. For November, the texts I send you are still the official source for your confirmations. Starting in December, everything will be in the app.`; };

/**
 * Invite pop-up (AdminInviteV1 · B). One person, or one after the other for a group ("Next: Juliette ›" after each copy).
 * onFix: person has no email / phone → open their profile editor.
 */
export function InviteModal({ queue, onClose, onChanged, onFix, textFor, title }: { queue: AStaff[]; onClose: () => void; onChanged: () => void; onFix?: (s: AStaff) => void;
  /** push 55 · Hiring → Accept uses the welcome text instead */ textFor?: (s: AStaff, token: string) => string; title?: string }) {
  const [i, setI] = useState(0);
  const s = queue[i];
  const ready = useInviteReady();
  const [token, setToken] = useState<string | null>(null);
  const [text, setText] = useState(''); const [err, setErr] = useState('');
  const [copiedOn, setCopiedOn] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const missing = !s?.email ? 'email' : !s.phone?.replace(/\D/g, '') ? 'phone' : null;

  useEffect(() => {
    setToken(null); setText(''); setErr(''); setCopiedOn(null);
    if (!s || missing || ready !== true) return;
    supabase.rpc('admin_invite_link', { p_staff: s.id }).then(({ data, error }) => {
      if (error) { setErr(/function|schema|exist/i.test(error.message) ? 'Needs migration 040 (not applied yet).' : error.message); return; }
      const t = (data as { token: string }).token; setToken(t); setText((textFor ?? inviteText)(s, t));
    });
  }, [s?.id, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s) return null;
  const next = queue[i + 1];
  const copy = async () => {
    if (!token) return;
    setBusy(true); setErr('');
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      try { box.current?.select(); ok = document.execCommand('copy'); } catch { ok = false; }
    }
    if (!ok) { setBusy(false); setErr('Couldn’t copy. Select the text and copy it by hand.'); return; }
    const { data, error } = await supabase.rpc('admin_mark_invited', { p_token: token });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setCopiedOn(md(String(data ?? new Date().toISOString()))); onChanged();
  };

  return (
    <div className="bk-modal" onClick={onClose}>
      <div className="adm-card inv-pop" role="dialog" aria-label={`Invite ${callName(s)}`} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 10 }}><Avatar name={s.full_name} url={s.photo_url} size={36} /><span className="serif" style={{ fontSize: 26 }}>{title ?? `Invite ${callName(s)}`}</span></div>
          <div className="row" style={{ gap: 8 }}>{queue.length > 1 && <span className="muted sm">{i + 1} of {queue.length}</span>}<button className="sq" aria-label="Close" onClick={onClose}>×</button></div>
        </div>
        {ready === true && <MacPanel queue={queue} cur={s} curToken={token} curText={text} textFor={textFor} onChanged={onChanged} />}
        {missing ? <>
          <div className="cu-box amber"><b>{missing === 'email' ? 'Add their email first' : 'Add their phone first'}</b>
            <span>{missing === 'email' ? 'The email is what they sign in with.' : 'The phone is where the text goes.'}</span></div>
          <div className="row wrap">
            {onFix && <button className="abtn dark" onClick={() => onFix(s)}>{missing === 'email' ? 'Add email' : 'Add phone'}</button>}
            {next && <button className="abtn" onClick={() => setI(i + 1)}>Next: {callName(next)} ›</button>}
          </div>
        </> : <>
          <div className="sm">To <b>{s.phone}</b> <span className="muted">· WhatsApp · signs in with</span> <b>{s.email}</b></div>
          {ready === false ? (
            <div className="cu-box amber inv-setup"><b>Invite links need setup</b>
              <span>The personal link can’t sign anyone in yet. Add the Supabase service role key in Vercel (Settings → Environment Variables → <code>SUPABASE_SERVICE_ROLE_KEY</code>, Production + Preview), then redeploy.</span></div>
          ) : <>
            <textarea ref={box} className="inv-text" rows={5} value={text} disabled={!token} placeholder={err ? '' : 'Making their link…'} onChange={(e) => setText(e.target.value)} />
            <span className="muted sm">Text is editable. Link works once, for 7 days. No dates in the text: they find their bookings in the app.</span>
          </>}
          {err && <p className="error">{err}</p>}
          <div className="inv-btns">
            <button className="abtn ok inv-copy" disabled={!token || busy || ready !== true} onClick={copy}>{copiedOn ? '✓ Copied · Invited ' + copiedOn : busy ? 'Copying…' : 'Copy text'}</button>
          </div>
          {copiedOn && next && <button className="abtn dark" style={{ alignSelf: 'flex-end' }} onClick={() => setI(i + 1)}>Next: {callName(next)} ›</button>}
          {copiedOn && !next && <button className="abtn" style={{ alignSelf: 'flex-end' }} onClick={onClose}>Done</button>}
          {!copiedOn && next && <button className="lnk sm" style={{ alignSelf: 'flex-end' }} onClick={() => setI(i + 1)}>Skip · Next: {callName(next)} ›</button>}
          <span className="muted sm">Or copy → paste in WhatsApp / iMessage yourself. Copying marks them <b>Invited · {copiedOn ?? md(new Date().toISOString())}</b>. Group invite: “Next: {next ? callName(next) : 'Juliette'} ›” after each copy.</span>
        </>}
      </div>
    </div>
  );
}

type OutRow = { id: string; staff_id: string; status: string; channel: string | null; test: boolean; sent_at: string | null; error: string | null; created_at: string };
const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
/** Nov 16 · migration 129 · invites sent from the Mac mini (only invites). Send = Ronnie's approval; a scheduled task on the Mac mini sends within the hour.
 *  Test mode (on until Ronnie turns it off): texts go to his own phone, "[TEST → name]", link hidden. */
function MacPanel({ queue, cur, curToken, curText, textFor, onChanged }: { queue: AStaff[]; cur: AStaff; curToken: string | null; curText: string; textFor?: (s: AStaff, token: string) => string; onChanged: () => void }) {
  const [via, setVia] = useState<Record<string, string | null>>({}); const [test, setTest] = useState<boolean | null>(null);
  const [rows, setRows] = useState<OutRow[]>([]); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const ids = queue.map((x) => x.id); const key = ids.join(',');
  const loadRows = () => supabase.from('text_outbox').select('id,staff_id,status,channel,test,sent_at,error,created_at').eq('kind', 'invite').in('staff_id', ids).order('created_at', { ascending: false }).limit(200)
    .then(({ data }) => { setRows((data ?? []) as OutRow[]); if ((data ?? []).some((r) => (r as OutRow).status === 'sent')) onChanged(); });
  useEffect(() => {
    supabase.from('staff_private').select('staff_id,text_via').in('staff_id', ids).then(({ data }) => setVia(Object.fromEntries(((data ?? []) as { staff_id: string; text_via: string | null }[]).map((r) => [r.staff_id, r.text_via]))));
    supabase.from('app_settings').select('value').eq('key', 'mac.invite_test').maybeSingle().then(({ data }) => setTest(((data as { value?: { on?: boolean } } | null)?.value?.on) !== false));
    loadRows(); const t = setInterval(loadRows, 20000); return () => clearInterval(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ok = (p: AStaff) => !!p.email && !!p.phone?.replace(/\D/g, '');
  const ch = (p: AStaff) => (via[p.id] === 'imessage' || via[p.id] === 'whatsapp' ? via[p.id] : null);
  const last = (p: AStaff) => rows.find((r) => r.staff_id === p.id && r.status !== 'skipped' && (test || !r.test));
  const todo = queue.filter((p) => ok(p) && ch(p) && last(p)?.status !== 'queued' && !(last(p)?.status === 'sent' && !last(p)?.test));
  const setCh = async (p: AStaff, v: string) => { setVia((m) => ({ ...m, [p.id]: v || null })); await supabase.from('staff_private').upsert({ staff_id: p.id, text_via: v || null }); };
  const togTest = async () => { const v = !test; if (!v && !confirm('Turn test mode off? Invites will go to the staff’s own phones.')) return;
    const { error } = await supabase.from('app_settings').upsert({ key: 'mac.invite_test', value: { on: v }, updated_at: new Date().toISOString() }); if (error) { setErr(error.message); return; } setTest(v); };
  const items = async (list: AStaff[]) => { const out: { staff_id: string; token: string; body: string; channel: string | null }[] = [];
    for (const p of list) { let tok = p.id === cur.id ? curToken : null;
      if (!tok) { const { data, error } = await supabase.rpc('admin_invite_link', { p_staff: p.id }); if (error) throw new Error(`${p.full_name}: ${error.message}`); tok = (data as { token: string }).token; }
      out.push({ staff_id: p.id, token: tok!, body: p.id === cur.id && curText ? curText : (textFor ?? inviteText)(p, tok!), channel: ch(p) }); }
    return out; };
  const send = async (both: boolean) => { setBusy(true); setErr(''); setMsg('');
    try { const list = both ? [cur] : todo; const its = await items(list);
      const { data, error } = await supabase.rpc('admin_queue_invites', { p_items: its, p_test_both: both }); if (error) throw error;
      setMsg(both ? 'Test queued: one iMessage + one WhatsApp to your phone · the Mac mini sends within the hour.' : `${data} invite${data === 1 ? '' : 's'} queued${test ? ' (test: to your phone)' : ''} · the Mac mini sends within the hour.`); await loadRows();
    } catch (x) { setErr((x as Error).message); } setBusy(false); };
  const chip = (p: AStaff) => { const r = last(p); if (!ok(p)) return <i className="app-chip red">{!p.email ? 'NO EMAIL' : 'NO PHONE'}</i>;
    if (!r) return null; const t = r.test ? ' · test' : '';
    return r.status === 'queued' ? <i className="app-chip gold">Waiting for Mac mini{t}</i> : r.status === 'sent' ? <i className="app-chip green">✓ Sent {hm(r.sent_at ?? r.created_at)}{t}</i>
      : <i className="app-chip red" title={r.error ?? ''}>✕ Failed{r.error ? ` · ${r.error}` : ''}{t}</i>; };
  return (
    <div className="inv-mac2">
      <div className="row" style={{ alignItems: 'center', gap: 8 }}><b>Send from Mac mini</b><span className="grow" />
        {test !== null && <><span className={'inv-test' + (test ? ' on' : '')}>{test ? 'TEST MODE · texts go to you only' : 'LIVE · texts go to staff'}</span><button className="lnk sm" onClick={togTest}>{test ? 'Turn off' : 'Back to test'}</button></>}</div>
      <div className="inv-mlist">{queue.map((p) => <div key={p.id} className={'inv-mrow' + (p.id === cur.id ? ' cur' : '')}><span className="grow">{p.full_name} <small className="muted">{p.language === 'fr' ? 'FR' : 'EN'}</small></span>
        <select value={ch(p) ?? ''} onChange={(e) => setCh(p, e.target.value)}><option value="">Texts via…</option><option value="imessage">iMessage</option><option value="whatsapp">WhatsApp</option></select>{chip(p)}</div>)}</div>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="abtn dark" disabled={busy || !todo.length || test === null} onClick={() => send(false)}>Send {todo.length} from Mac mini{test ? ' (test)' : ''}</button>
        {test && <button className="abtn" disabled={busy || !ok(cur) || !curToken} onClick={() => send(true)}>Send me a test · iMessage + WhatsApp</button>}</div>
      <span className="muted sm">Same text as below, each person’s own link and language. Pressing Send = your OK for these. The Mac mini sends at the top of the next hour (8 AM–10 PM); status updates here. {test ? 'Test: link hidden, nobody else gets anything.' : 'They show “Invited” once sent.'}</span>
      {msg && <span className="okc sm">{msg}</span>}{err && <p className="error">{err}</p>}
    </div>);
}

/** Chip used on the Staff list and the staff profile. */
export const AppChip = ({ st }: { st: AppStatus }) => <i className={'app-chip ' + st.cls}>{st.label}</i>;
