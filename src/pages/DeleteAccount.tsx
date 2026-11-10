// Nov 9 · Delete my account (migration 085 · board DeleteAccountV1). Required by the App Store and Google Play.
// Staff ASK (bottom of Profile, or the public page /delete-account); Ronnie confirms on Today → Needs you.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { SwipeSheet } from '../components/SwipeSheet';

const DELETED = 'Your sign-in, photo, phone, email, emergency contact, availability and messages.';
const KEPT = 'The hours you worked and your pay records, for 6 years (tax law).';
const when = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' });

/** Small grey link at the very bottom of Profile → the request sheet. Errors (085 not run yet) → link hidden. */
export function DeleteAccountLink() {
  const [req, setReq] = useState<string | null | undefined>(undefined); // created_at of an open request
  const [open, setOpen] = useState<null | 'ask' | 'sent'>(null);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { supabase.rpc('my_delete_request').then(({ data, error }) => setReq(error ? undefined : (data as string | null) ?? null)); }, []);
  if (req === undefined) return null;

  const send = async () => {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('request_my_deletion', { p_reason: reason.trim() || null });
    setBusy(false);
    if (error) return setErr('Could not send. Check your connection and try again.');
    setReq((data as string) ?? new Date().toISOString()); setOpen('sent');
  };
  const cancel = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('cancel_my_deletion');
    setBusy(false);
    if (!error) { setReq(null); setOpen(null); }
  };

  return (
    <>
      {req
        ? <p className="del-line">Deletion requested {when(req)} · <button type="button" className="del-link" onClick={cancel} disabled={busy}>Cancel</button></p>
        : <button type="button" className="del-link del-bottom" onClick={() => { setReason(''); setErr(''); setOpen('ask'); }}>Delete my account</button>}
      {open && <>
        <div className="scrim" onClick={() => setOpen(null)} />
        <SwipeSheet onClose={() => setOpen(null)} label="Delete my account">
          {open === 'ask' ? <div className="del-sheet">
            <div className="serif" style={{ fontSize: 24 }}>Delete my account</div>
            <div className="del-box"><span className="del-k red">GETS DELETED</span>{DELETED}</div>
            <div className="del-box"><span className="del-k">G&amp;R HAS TO KEEP</span>{KEPT}</div>
            <label className="del-lab" htmlFor="del-why">Why are you leaving? <span>(optional)</span></label>
            <textarea id="del-why" className="del-why" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            {err && <p className="error sm" role="alert">{err}</p>}
            <button type="button" className="cu-btn red" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Request deletion'}</button>
            <button type="button" className="btn link" onClick={() => setOpen(null)}>Cancel</button>
          </div> : <div className="del-sheet center">
            <span className="del-ok" aria-hidden="true">✓</span>
            <div className="serif" style={{ fontSize: 24 }}>Request sent</div>
            <p>Ronnie will confirm within 30 days. Until then your account works as usual.</p>
            <button type="button" className="cu-btn line" disabled={busy} onClick={cancel}>Cancel my request</button>
            <button type="button" className="cu-btn" onClick={() => setOpen(null)}>OK</button>
          </div>}
        </SwipeSheet>
      </>}
    </>
  );
}

/** Public page /delete-account (no sign-in, no app needed). Google Play asks for this link. */
export function DeleteAccountPublic() {
  const [email, setEmail] = useState(''); const [phone, setPhone] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && phone.replace(/\D/g, '').length >= 10;
  const send = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('public_delete_request', { p_email: email.trim(), p_phone: phone.trim(), p_reason: reason.trim() || null });
    setBusy(false);
    if (error) return setErr(/check your email/i.test(error.message) ? 'Check your email and phone number.' : 'Could not send. Try again in a minute.');
    setDone(true);
  };
  return (
    <main className="v2 cu ap del-pub">
      <img src="/logo-full.png" alt="G&R à votre service" className="del-logo" />
      {done ? <div className="del-sheet center">
        <span className="del-ok" aria-hidden="true">✓</span>
        <div className="serif" style={{ fontSize: 26 }}>Request sent</div>
        <p>If this email and phone match a G&amp;R staff account, Ronnie will confirm the deletion within 30 days.</p>
      </div> : <div className="del-sheet">
        <h1 className="serif">Delete your G&amp;R staff account</h1>
        <p className="del-intro">Your sign-in and personal info are deleted. Hours and pay records are kept 6 years (tax law). You can also do this in the app: Profile → Delete my account.</p>
        <label className="del-lab" htmlFor="del-email">Email you sign in with</label>
        <input id="del-email" className="sheet-input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="del-lab" htmlFor="del-phone">Phone</label>
        <input id="del-phone" className="sheet-input" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="del-lab" htmlFor="del-why2">Why are you leaving? <span>(optional)</span></label>
        <textarea id="del-why2" className="del-why" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        {err && <p className="error sm" role="alert">{err}</p>}
        <button type="button" className="cu-btn red" disabled={!ok || busy} onClick={send}>{busy ? 'Sending…' : 'Send request'}</button>
        <small className="del-note">We check it’s really you before deleting anything.</small>
      </div>}
    </main>
  );
}
