import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { setting, useSettings } from '../lib/settings';
import { useT } from '../lib/i18n';
import { pinPassword, resolvePinLen, rememberPinLen, saveMyPinLen, type PinLen } from '../lib/pin';
import { PinDots, NumPad, ChooseCode } from '../components/PinPad';

type Step = 'email' | 'pin' | 'forgot' | 'code' | 'setpin' | 'asked';

/**
 * Sign in (push 31d/e): email → 4 or 6 dots (signs in on the last digit) · Forgot your code? → email code → choose a new code.
 * "No access to that email?" → request_pin_reset → a Needs you card for Ronnie (nothing is emailed until he presses Send).
 */
export function Login({ mustSetPin }: { mustSetPin?: boolean }) {
  const t = useT(); useSettings(); // push 32: "Ask Ronnie to reset" on/off (readable signed out)
  const saved = localStorage.getItem('gr_email') ?? '';
  // push 34b · "Sign in with my email" on an expired invite link → straight to the email-code step
  const [viaInvite] = useState(() => { try { const v = sessionStorage.getItem('gr_login_step') === 'forgot'; sessionStorage.removeItem('gr_login_step'); return v; } catch { return false; } });
  const [step, setStep] = useState<Step>(mustSetPin ? 'setpin' : saved ? (viaInvite ? 'forgot' : 'pin') : 'email');
  const [email, setEmail] = useState(saved);
  const [len, setLen] = useState<PinLen>(6); const [known, setKnown] = useState(true); const [lenReady, setLenReady] = useState(!saved || !!mustSetPin);
  const [value, setValue] = useState('');
  const [err, setErr] = useState(''); const [shake, setShake] = useState(false);
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);

  // How many dots for this email (device memory, then the pin_length RPC)
  useEffect(() => {
    if (step !== 'pin' || !email.trim()) return;
    let live = true; setLenReady(false);
    resolvePinLen(email).then((r) => { if (!live) return; setLen(r.len); setKnown(r.known); setLenReady(true); });
    return () => { live = false; };
  }, [step, email]);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const wrong = (msg: string) => { setErr(msg); setShake(true); window.setTimeout(() => setShake(false), 450); };

  const signIn = (code: string) => run(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pinPassword(code) });
    if (error) { setValue(''); wrong(/rate|too many/i.test(error.message) ? 'Too many tries. Wait a few minutes, or use Forgot your code?' : t('badLogin')); return; }
    localStorage.setItem('gr_email', email.trim());
    rememberPinLen(email, code.length as PinLen);
    if (window.location.pathname !== '/') window.location.replace('/');
  });
  const digit = (d: string) => {
    if (busy || value.length >= len) return;
    const nv = value + d; setValue(nv); setErr('');
    if (nv.length === len) signIn(nv);
  };

  const sendCode = () => run(async () => {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } });
    if (error) throw new Error(/rate|seconds/i.test(error.message) ? 'An email was just sent. Wait a minute before asking for another one.' : error.message);
    localStorage.setItem('gr_email', email.trim());
    setSent(true); setStep('code'); setValue('');
  });
  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: value, type: 'email' });
      if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or expired. Ask for a new one.' : error.message);
      localStorage.setItem('gr_needs_pin', '1');
      setStep('setpin'); setValue('');
    });
  };
  const askRonnie = () => run(async () => {
    await supabase.rpc('request_pin_reset', { p_email: email.trim() }); // always "ok": never tells whether the email exists
    setStep('asked');
  });
  const saveCode = async (code: string, l: PinLen) => {
    const { error } = await supabase.auth.updateUser({ password: pinPassword(code) });
    if (error) throw new Error(error.message);
    const { data } = await supabase.auth.getUser();
    await saveMyPinLen(data.user?.email ?? email, l);
    localStorage.removeItem('gr_needs_pin');
    window.location.replace('/');
  };
  const notYou = () => { localStorage.removeItem('gr_email'); setEmail(''); setValue(''); setErr(''); setStep('email'); };

  return (
    <main className="v2 login2">
      <img src="/logo-mark.png" alt="G&R" className="login2-logo" />

      {step === 'email' && (
        <form className="login2-body" onSubmit={(e) => { e.preventDefault(); if (email.trim()) { setStep('pin'); setValue(''); setErr(''); } }}>
          <span className="pin-kick">SIGN IN</span>
          <label className="cu-f"><span>{t('email').toUpperCase()}</span>
            <input type="email" autoComplete="email" inputMode="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" /></label>
          <button className="cu-btn">{t('next')}</button>
        </form>
      )}

      {step === 'pin' && (
        <div className="pin-screen">
          <div className="pin-head"><span className="pin-sub">{email} · <button type="button" className="pin-u" onClick={notYou}>{t('notYou').replace('?', '').toLowerCase()}?</button></span>
            <span className="pin-kick" style={{ marginTop: 10 }}>ENTER YOUR CODE</span></div>
          <PinDots len={len} filled={value.length} shake={shake} />
          {err ? <p className="error center-t">{err}</p> : <span className="pin-hint">{busy ? 'Signing in…' : ' '}</span>}
          {lenReady && !known && <button type="button" className="pin-link sm" onClick={() => { setLen(len === 6 ? 4 : 6); setValue(''); setErr(''); }}>{len === 6 ? 'I use a 4-digit code' : 'I use a 6-digit code'}</button>}
          <button type="button" className="pin-link" onClick={() => { setStep('forgot'); setErr(''); setValue(''); setSent(false); }}>Forgot your code?</button>
          <NumPad disabled={busy || !lenReady} onDigit={digit} onBack={() => setValue((x) => x.slice(0, -1))} />
        </div>
      )}

      {step === 'forgot' && (
        <div className="login2-body">
          <span className="pin-kick">FORGOT YOUR CODE?</span>
          <p className="login2-p">We’ll email a 6-digit reset code to <b>{email}</b>.</p>
          <button className="cu-btn" disabled={busy} onClick={sendCode}>{busy ? 'Sending…' : 'Email me a reset code'}</button>
          <p className="pin-hint left">First time here? Same thing: we email you a code, then you choose yours.</p>
          {err && <p className="error">{err}</p>}
          {setting('signin.ask_reset') && <div className="login2-ask">
            <b>No access to that email?</b>
            <span>Ronnie can send a reset link (or fix your email first).</span>
            <button className="cu-btn line" disabled={busy} onClick={askRonnie}>Ask Ronnie to reset</button>
          </div>}
          <button type="button" className="pin-link" onClick={() => { setStep('pin'); setErr(''); }}>‹ Back to sign in</button>
        </div>
      )}

      {step === 'code' && (
        <form className="login2-body" onSubmit={verify}>
          <span className="pin-kick">FORGOT YOUR CODE?</span>
          {sent && <p className="login2-p">Sent to <b>{email}</b>.</p>}
          <div className="login2-box">
            <span className="pin-hint left">Check your email: tap the link, or type the code</span>
            <input className="otp-in" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus aria-label="Code from the email"
              value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
            <button className="cu-btn green" disabled={busy || value.length < 6}>{busy ? 'Checking…' : t('verify')}</button>
          </div>
          <p className="pin-hint left">Then: choose a new code (4 or 6 digits) and you’re signed in.</p>
          {err && <p className="error">{err}</p>}
          <button type="button" className="pin-link" disabled={busy} onClick={sendCode}>Send a new code</button>
          <button type="button" className="pin-link" onClick={() => { setStep('forgot'); setErr(''); setValue(''); }}>‹ Back</button>
        </form>
      )}

      {step === 'asked' && (
        <div className="login2-body">
          <span className="cu-check">✓</span>
          <span className="serif" style={{ fontSize: 26, textAlign: 'center' }}>Ronnie got your request</span>
          <p className="login2-p" style={{ textAlign: 'center' }}>He’ll send a reset link to your email, or fix your email first and then send it. You don’t need to do anything else now.</p>
          <button type="button" className="pin-link" onClick={() => { setStep('pin'); setErr(''); }}>‹ Back to sign in</button>
        </div>
      )}

      {step === 'setpin' && <ChooseCode onSave={saveCode} />}
    </main>
  );
}
