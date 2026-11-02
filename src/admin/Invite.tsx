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
export const inviteText = (s: AStaff, token: string) =>
  `Hey ${callName(s)}! Ronnie added you to the G&R staff app.\n\nTap to set up your account (2 min) 👉 ${window.location.host}/go/${token}\nYour sign-in email: ${s.email}`;

/**
 * Invite pop-up (AdminInviteV1 · B). One person, or one after the other for a group ("Next: Juliette ›" after each copy).
 * onFix: person has no email / phone → open their profile editor.
 */
export function InviteModal({ queue, onClose, onChanged, onFix }: { queue: AStaff[]; onClose: () => void; onChanged: () => void; onFix?: (s: AStaff) => void }) {
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
      const t = (data as { token: string }).token; setToken(t); setText(inviteText(s, t));
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
          <div className="row" style={{ gap: 10 }}><Avatar name={s.full_name} url={s.photo_url} size={36} /><span className="serif" style={{ fontSize: 26 }}>Invite {callName(s)}</span></div>
          <div className="row" style={{ gap: 8 }}>{queue.length > 1 && <span className="muted sm">{i + 1} of {queue.length}</span>}<button className="sq" aria-label="Close" onClick={onClose}>×</button></div>
        </div>
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
            <button className="abtn inv-mac" disabled title="after push 24"><span>Send from Mac mini</span><small>after push 24</small></button>
          </div>
          {copiedOn && next && <button className="abtn dark" style={{ alignSelf: 'flex-end' }} onClick={() => setI(i + 1)}>Next: {callName(next)} ›</button>}
          {copiedOn && !next && <button className="abtn" style={{ alignSelf: 'flex-end' }} onClick={onClose}>Done</button>}
          {!copiedOn && next && <button className="lnk sm" style={{ alignSelf: 'flex-end' }} onClick={() => setI(i + 1)}>Skip · Next: {callName(next)} ›</button>}
          <span className="muted sm">Copy → paste in WhatsApp / iMessage yourself. Copying marks them <b>Invited · {copiedOn ?? md(new Date().toISOString())}</b>. Group invite: “Next: {next ? callName(next) : 'Juliette'} ›” after each copy.</span>
        </>}
      </div>
    </div>
  );
}

/** Chip used on the Staff list and the staff profile. */
export const AppChip = ({ st }: { st: AppStatus }) => <i className={'app-chip ' + st.cls}>{st.label}</i>;
