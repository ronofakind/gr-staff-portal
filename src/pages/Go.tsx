import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { pinPassword, saveMyPinLen, type PinLen } from '../lib/pin';
import { ChooseCode } from '../components/PinPad';
import { isInAppBrowser, isIOS, isAndroid, chromeIntentUrl } from '../lib/install';

type Peek = { state: 'ok' | 'expired' | 'used' | 'unknown' | 'setup' | 'error'; name?: string; email?: string };

/**
 * Push 34b · /go/<token>: the personal link from Ronnie's text.
 * Opening the page never uses the link (GET /api/go only peeks), so WhatsApp / iMessage previews can't burn it.
 * They choose their code first; on the second entry: POST /api/go (link used) → verifyOtp(token_hash) → session →
 * the code becomes their password (same as push 31) → '/' → check-up → Home. No email code at any point.
 */
export function Go({ token }: { token: string }) {
  const [peek, setPeek] = useState<Peek | null>(null);
  const [screen, setScreen] = useState<'code' | 'dead' | 'asked'>('code');
  const [stay, setStay] = useState(false); // in-app browser: "Continue here" pressed
  const [copied, setCopied] = useState(false); const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/go?t=${encodeURIComponent(token)}`).then((r) => r.json()).catch(() => ({ state: 'error' }))
      .then(async (p: Peek) => {
        // Tapping an old link while already signed in → just open the app.
        if (p.state === 'used' || p.state === 'expired') {
          const { data } = await supabase.auth.getSession();
          if (data.session && (!p.email || data.session.user.email?.toLowerCase() === p.email)) { window.location.replace('/'); return; }
        }
        setPeek(p);
        if (p.state !== 'ok') setScreen('dead');
        if (p.email) { try { localStorage.setItem('gr_email', p.email); } catch { /* private mode */ } }
      });
  }, [token]);

  const save = async (code: string, len: PinLen) => {
    const r = await fetch('/api/go', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token }) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 410) { setScreen('dead'); setPeek({ ...peek!, state: 'expired' }); return; }
    if (!r.ok || !d.token_hash) throw new Error('Something went wrong. Try again in a minute.');
    // From here they are signed in; if anything below fails, '/' shows "choose your code" again (gr_needs_pin).
    try { localStorage.setItem('gr_needs_pin', '1'); localStorage.setItem('gr_email', d.email); } catch { /* private mode */ }
    const { error } = await supabase.auth.verifyOtp({ token_hash: d.token_hash, type: 'magiclink' });
    if (error) { setScreen('dead'); setPeek({ ...peek!, state: 'expired' }); return; }
    const up = await supabase.auth.updateUser({ password: pinPassword(code) });
    if (up.error) { window.location.replace('/'); return; }
    await saveMyPinLen(d.email, len);
    try { localStorage.removeItem('gr_needs_pin'); } catch { /* private mode */ }
    window.location.replace('/');
  };
  const notYou = () => {
    try { localStorage.removeItem('gr_email'); } catch { /* private mode */ }
    supabase.auth.signOut().finally(() => window.location.replace('/'));
  };
  const withEmail = () => {
    try { sessionStorage.setItem('gr_login_step', 'forgot'); } catch { /* private mode */ }
    supabase.auth.signOut().finally(() => window.location.replace('/'));
  };
  const askRonnie = async () => {
    setBusy(true);
    try { await supabase.rpc('request_new_invite', { p_token: token }); } catch { /* always looks ok */ }
    setBusy(false); setScreen('asked');
  };
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setCopied(false); } };

  if (!peek) return <div className="loading" />;
  const ios = isIOS() || !isAndroid();

  return (
    <main className="v2 login2 go-page">
      <img src="/logo-mark.png" alt="G&R" className="login2-logo" />

      {screen === 'code' && <>
        <div className="go-hi">
          <span className="serif">Welcome, {peek.name}!</span>
          <span className="pin-sub">{peek.email} · <button type="button" className="pin-u" onClick={notYou}>not you?</button></span>
        </div>
        {isInAppBrowser() && !stay ? (
          <div className="cu-box amber">
            <b>Open this page in {ios ? 'Safari' : 'Chrome'} first</b>
            <span>You opened G&amp;R inside another app (WhatsApp, Instagram, Messenger…). It works best in {ios ? 'Safari' : 'Chrome'}, where you can also add it to your Home Screen.</span>
            {!ios && <a className="cu-btn" href={chromeIntentUrl()}>Open in Chrome</a>}
            <button className="cu-btn line" onClick={copy}>{copied ? '✓ Link copied' : 'Copy the link'}</button>
            <span>{ios ? 'Then open Safari and paste it in the address bar. Or tap ⋯ / the compass and choose “Open in Safari”.' : 'Or tap ⋮ and choose “Open in Chrome”, or paste the link in Chrome.'}</span>
            <button type="button" className="pin-link" onClick={() => setStay(true)}>Continue here</button>
          </div>
        ) : <>
          <ChooseCode title="CHOOSE YOUR SIGN-IN CODE" sub="Type it twice. You’ll use your email + this code to sign in." onSave={save} />
        </>}
      </>}

      {screen === 'dead' && (
        <div className="login2-body go-dead">
          {peek.state === 'setup' || peek.state === 'error' ? <>
            <span className="serif">This link isn’t ready yet</span>
            <p className="login2-p">Sign in with your email for now. We’ll email you a code, then you choose yours.</p>
            <button className="cu-btn green" onClick={withEmail}>Sign in with my email</button>
          </> : <>
            <span className="serif">This link has expired</span>
            <p className="login2-p">Invite links work once, for 7 days. Ask Ronnie for a new one, or sign in with your email.</p>
            <button className="cu-btn green" onClick={withEmail}>Sign in with my email</button>
            {peek.state !== 'unknown' && <button type="button" className="pin-link" disabled={busy} onClick={askRonnie}>Ask Ronnie for a new link</button>}
          </>}
        </div>
      )}

      {screen === 'asked' && (
        <div className="login2-body go-dead">
          <span className="cu-check">✓</span>
          <span className="serif">Ronnie got your request</span>
          <p className="login2-p">He’ll text you a new link. You can also sign in with your email any time.</p>
          <button className="cu-btn line" onClick={withEmail}>Sign in with my email</button>
        </div>
      )}
    </main>
  );
}
