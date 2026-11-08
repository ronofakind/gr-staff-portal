import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { loadOnboarding, type Onboarding } from '../lib/handbook';

/** Nov 8 · push 56 (083) · /tax · Tax & pay, payroll staff only, before the first shift.
 *  Written once through save_my_tax(); only Ronnie can read it back. The void cheque goes to the private tax-docs bucket. */
export function TaxPay({ me }: { me: Staff }) {
  const nav = useNavigate();
  const [ob, setOb] = useState<Onboarding | null | undefined>(undefined);
  const [f, setF] = useState({ legal_name: me.full_name, birthday: '', sin: '', address: '', pay_method: 'deposit' as 'deposit' | 'paypal', paypal_email: me.email ?? '' });
  const [cheque, setCheque] = useState<{ path: string; name: string } | null>(null);
  const [up, setUp] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null); const camRef = useRef<HTMLInputElement>(null);
  useEffect(() => { loadOnboarding().then(setOb); }, []);
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setErr(''); };
  const sinD = f.sin.replace(/\D/g, '');

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { setErr('File too big (12 MB max)'); return; }
    setUp(true); setErr('');
    const ext = (file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'jpg').toLowerCase();
    const path = `${me.id}/cheque-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('tax-docs').upload(path, file, { contentType: file.type || undefined });
    setUp(false);
    if (error) { setErr('Couldn’t upload: ' + error.message); return; }
    setCheque({ path, name: file.name });
  };
  const save = async () => {
    if (!f.legal_name.trim()) return setErr('Add your legal name');
    if (sinD.length !== 9) return setErr('Your SIN has 9 digits');
    if (!f.address.trim()) return setErr('Add your home address');
    if (f.pay_method === 'paypal' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.paypal_email.trim())) return setErr('Add your PayPal email');
    if (!cheque) return setErr('Add a photo of a void cheque');
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('save_my_tax', { p: { ...f, sin: sinD, cheque_path: cheque.path } });
    setBusy(false);
    if (error) { setErr(/bad sin/.test(error.message) ? 'Your SIN has 9 digits' : error.message); return; }
    setDone(true); window.scrollTo(0, 0);
  };

  if (ob === undefined) return <div className="loading" />;
  if (done || ob?.tax_done_at) return (
    <main className="v2 cu cu-done">
      <div className="cu-done-c"><span className="cu-check">✓</span>
        <div className="serif" style={{ fontSize: 28, lineHeight: 1.1 }}>Tax & pay saved</div>
        <p className="cu-note" style={{ textAlign: 'center' }}>{done ? 'Only Ronnie sees it. ' : ''}Need to change something? Text Ronnie.</p></div>
      <div className="cu-foot"><button className="cu-btn green" onClick={() => nav('/')}>Go to Home</button></div>
    </main>
  );
  if (ob?.paid_by === 'cash') return (
    <main className="v2 cu cu-done"><div className="cu-done-c"><div className="serif" style={{ fontSize: 26 }}>Nothing to fill in</div>
      <p className="cu-note" style={{ textAlign: 'center' }}>Your manager pays you after each event.</p></div>
      <div className="cu-foot"><button className="cu-btn" onClick={() => nav('/')}>Go to Home</button></div></main>
  );

  return (
    <main className="v2 cu">
      <div className="cu-head">
        <div className="spread" style={{ alignItems: 'center' }}><button type="button" className="cu-back" onClick={() => nav('/')}>✕ Later</button><span className="cu-kick">TAX & PAY</span><span className="cu-req">before your first shift</span></div>
        <div className="serif cu-title" style={{ textAlign: 'center' }}>Tax & pay</div><div className="cu-sub" style={{ textAlign: 'center' }}>Only Ronnie sees this · about 4 min</div>
      </div>
      <div className="cu-body">
        <div className="ap-card">
          <label className="ap-f">Legal name (as on your bank account)<input value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} autoComplete="name" /></label>
          <div className="row2">
            <label className="ap-f">Birthday<input type="date" value={f.birthday} onChange={(e) => set('birthday', e.target.value)} /></label>
            <label className="ap-f">SIN<input inputMode="numeric" autoComplete="off" value={f.sin} onChange={(e) => set('sin', e.target.value.replace(/[^\d ]/g, '').slice(0, 11))} placeholder="123 456 789" /></label>
          </div>
          <label className="ap-f">Home address<input value={f.address} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" placeholder="Street, apt, city, postal code" /></label>
        </div>
        <div className="ap-lv" style={{ padding: 0 }}><span>
          <button type="button" className={f.pay_method === 'deposit' ? 'on' : ''} onClick={() => set('pay_method', 'deposit')}>Direct deposit<br /><small>1st + 16th</small></button>
          <button type="button" className={f.pay_method === 'paypal' ? 'on' : ''} onClick={() => set('pay_method', 'paypal')}>PayPal<br /><small>within 48 h · your fees</small></button>
        </span></div>
        {f.pay_method === 'paypal' && <div className="ap-card"><label className="ap-f">PayPal email<input type="email" value={f.paypal_email} onChange={(e) => set('paypal_email', e.target.value)} /></label></div>}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        <div className={'tx-cheque' + (cheque ? ' ok' : '')}>
          <span className="tx-ic">🧾</span>
          <span className="grow"><b>{cheque ? 'Void cheque · added' : 'Void cheque'}</b><small>{cheque ? cheque.name : up ? 'Uploading…' : 'A photo of a cheque with VOID written on it, or your bank’s direct deposit form'}</small></span>
          {!cheque && <span className="tx-req">REQUIRED</span>}
        </div>
        <div className="ap-pick"><button type="button" disabled={up} onClick={() => camRef.current?.click()}>📷 Photo</button><button type="button" disabled={up} onClick={() => fileRef.current?.click()}>📁 {cheque ? 'Change' : 'Files'}</button></div>
      </div>
      <div className="cu-foot">
        {err && <p className="error" style={{ textAlign: 'center' }} role="alert">{err}</p>}
        <button className="cu-btn" disabled={busy || up} onClick={save}>{busy ? 'Saving…' : 'Save securely'}</button>
        <p className="cu-note lock" style={{ textAlign: 'center' }}>You can’t see it again after saving. Only Ronnie can.</p>
      </div>
    </main>
  );
}
