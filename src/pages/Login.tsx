import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useT } from '../lib/i18n';

type Step = 'email' | 'pin' | 'code' | 'setpin';

export function Login({ mustSetPin }: { mustSetPin?: boolean }) {
  const t = useT();
  const [step, setStep] = useState<Step>(mustSetPin ? 'setpin' : 'email');
  const [email, setEmail] = useState('');
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 'email') { setStep('pin'); setValue(''); return; }
    if (step === 'pin') return run(async () => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: value });
      if (error) throw new Error(t('badLogin'));
    });
    if (step === 'code') return run(async () => {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: value, type: 'email' });
      if (error) throw new Error(error.message);
      localStorage.setItem('gr_needs_pin', '1');
      setStep('setpin'); setValue('');
    });
    if (step === 'setpin') return run(async () => {
      const { error } = await supabase.auth.updateUser({ password: value });
      if (error) throw new Error(error.message);
      localStorage.removeItem('gr_needs_pin');
      window.location.reload();
    });
  };

  const sendCode = () => run(async () => {
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) throw new Error(error.message);
    setStep('code'); setValue('');
  });

  const digits = step !== 'email';
  return (
    <main className="login">
      <img src="/logo-full.png" alt="G&R à votre service" className="login-logo" />
      <form onSubmit={submit} className="card stack">
        {step === 'email' && (
          <label className="field">{t('email')}
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        {digits && (
          <label className="field">
            {step === 'code' ? t('codeSent') : step === 'setpin' ? t('setPin') : t('pin')}
            <input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoFocus
              autoComplete={step === 'code' ? 'one-time-code' : 'current-password'}
              className="pin" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
          </label>
        )}
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={busy}>
          {step === 'email' ? t('next') : step === 'pin' ? t('login') : step === 'code' ? t('verify') : t('savePin')}
        </button>
        {step === 'pin' && (
          <button type="button" className="btn link" onClick={sendCode} disabled={busy}>{t('firstTime')} {t('sendCode')}</button>
        )}
      </form>
    </main>
  );
}
