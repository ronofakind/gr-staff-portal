import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { loadOnboarding, type Onboarding } from '../lib/handbook';
import { LineIcon } from '../components/LineIcon';

/** Nov 9 · push 58 (085) · /tax · Tax and pay = the QuickBooks supplier fields (OnbTaxQuickBooksV1), payroll staff only, before the first shift.
 *  Page 1: you, as on your SIN (name, email, phone filled in from the profile; address required). Page 2: SIN, deposit / PayPal, void cheque (required),
 *  SIN card photo (optional). Written once through save_my_tax(); only Ronnie can read it back. Files go to the private tax-docs bucket. */
type F = { first_name: string; middle_name: string; last_name: string; email: string; phone: string; street: string; apt: string; city: string; province: string; postal_code: string;
  sin: string; pay_method: 'deposit' | 'paypal'; paypal_email: string };
const PROV = ['QC', 'ON', 'NB', 'NS', 'PE', 'NL', 'MB', 'SK', 'AB', 'BC', 'YT', 'NT', 'NU'];

export function TaxPay({ me }: { me: Staff }) {
  const nav = useNavigate();
  const [ob, setOb] = useState<Onboarding | null | undefined>(undefined);
  const parts = me.full_name.trim().split(/\s+/);
  const [f, setF] = useState<F>({ first_name: parts[0] ?? '', middle_name: parts.length > 2 ? parts.slice(1, -1).join(' ') : '', last_name: parts.length > 1 ? parts[parts.length - 1] : '',
    email: me.email ?? '', phone: me.phone ?? '', street: '', apt: '', city: 'Montréal', province: 'QC', postal_code: '', sin: '', pay_method: 'deposit', paypal_email: me.email ?? '' });
  const [page, setPage] = useState(1);
  const [cheque, setCheque] = useState<{ path: string; name: string } | null>(null);
  const [sinCard, setSinCard] = useState<{ path: string; name: string } | null>(null);
  const [up, setUp] = useState<'' | 'cheque' | 'sin'>(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  const chequeRef = useRef<HTMLInputElement>(null); const camRef = useRef<HTMLInputElement>(null); const sinRef = useRef<HTMLInputElement>(null);
  useEffect(() => { loadOnboarding().then(setOb); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [page]);
  const set = (k: keyof F, v: string) => { setF((x) => ({ ...x, [k]: v })); setErr(''); };
  const sinD = f.sin.replace(/\D/g, '');

  const upload = async (file: File | undefined, kind: 'cheque' | 'sin') => {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { setErr('File too big (12 MB max)'); return; }
    setUp(kind); setErr('');
    const ext = (file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? 'jpg').toLowerCase();
    const path = `${me.id}/${kind === 'cheque' ? 'cheque' : 'sin-card'}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('tax-docs').upload(path, file, { contentType: file.type || undefined });
    setUp('');
    if (error) { setErr('Couldn’t upload: ' + error.message); return; }
    (kind === 'cheque' ? setCheque : setSinCard)({ path, name: file.name });
  };
  const page1 = () => {
    if (!f.first_name.trim() || !f.last_name.trim()) return setErr('Add your first and last name, as on your SIN');
    if (!f.street.trim()) return setErr('Add your street address');
    if (!f.city.trim()) return setErr('Add your city');
    if (!/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/.test(f.postal_code.trim())) return setErr('Check your postal code (e.g. H2W 2M5)');
    setErr(''); setPage(2);
  };
  const save = async () => {
    if (sinD.length !== 9) return setErr('Your SIN has 9 digits');
    if (f.pay_method === 'paypal' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.paypal_email.trim())) return setErr('Add your PayPal email');
    if (!cheque) return setErr('Add a photo of a void cheque');
    setBusy(true); setErr('');
    const pc = f.postal_code.trim().toUpperCase().replace(/^(\w{3})\s?(\w{3})$/, '$1 $2');
    const { error } = await supabase.rpc('save_my_tax', { p: { ...f, postal_code: pc, sin: sinD, cheque_path: cheque.path, sin_card_path: sinCard?.path ?? '' } });
    setBusy(false);
    if (error) { setErr(/bad sin/.test(error.message) ? 'Your SIN has 9 digits' : /address/.test(error.message) ? 'Check your address' : error.message); return; }
    setDone(true); window.scrollTo(0, 0);
  };

  if (ob === undefined) return <div className="loading" />;
  if (done || ob?.tax_done_at) return (
    <main className="v2 hb2 dark"><div className="hb2-frame" aria-hidden="true" />
      <div className="hb2-center"><div className="hb2-seal"><LineIcon name="lock" size={28} color="#D9B76A" /></div>
        <h1 className="hb2-h1">Tax and pay saved</h1><p className="hb2-p">{done ? 'Only Ronnie sees it. ' : ''}Need to change something? Text Ronnie.</p></div>
      <div className="hb2-foot"><button className="hb2-btn cream" onClick={() => nav('/')}>Go to Home</button></div></main>
  );
  if (ob?.paid_by === 'cash') return (
    <main className="v2 hb2 dark"><div className="hb2-frame" aria-hidden="true" />
      <div className="hb2-center"><h1 className="hb2-h1">Nothing to fill in</h1><p className="hb2-p">Your manager pays you after each event.</p></div>
      <div className="hb2-foot"><button className="hb2-btn cream" onClick={() => nav('/')}>Go to Home</button></div></main>
  );

  const Field = ({ k, label, opt, ...rest }: { k: keyof F; label: string; opt?: boolean } & InputHTMLAttributes<HTMLInputElement>) => (
    <label className="tx2-f"><span>{label}{opt && <i> · optional</i>}</span><input value={f[k]} onChange={(e) => set(k, e.target.value)} {...rest} /></label>);
  return (
    <main className="v2 hb2">
      <div className="hb2-head">
        <div className="hb2-bar-row"><button onClick={() => (page === 2 ? setPage(1) : nav('/'))}>{page === 2 ? '‹ Back' : '✕ Later'}</button><b>TAX AND PAY · {page} OF 2</b><span className="row" style={{ gap: 4, alignItems: 'center' }}><LineIcon name="lock" size={13} />Private</span></div>
        <div className="hb2-progress"><i style={{ width: page === 1 ? '50%' : '100%' }} /></div>
      </div>
      <input ref={chequeRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { upload(e.target.files?.[0], 'cheque'); e.target.value = ''; }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { upload(e.target.files?.[0], 'cheque'); e.target.value = ''; }} />
      <input ref={sinRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { upload(e.target.files?.[0], 'sin'); e.target.value = ''; }} />
      {page === 1 ? (
        <div className="hb2-body tx2">
          <div><h1 className="hb2-t">You, as on your SIN</h1><p className="hb2-small" style={{ marginTop: 6 }}>Your name, email and mobile are filled in from your profile. Check them, then add your address.</p></div>
          <div className="tx2-grid">{Field({ k: 'first_name', label: 'First name', autoComplete: 'given-name' })}{Field({ k: 'middle_name', label: 'Middle name', opt: true, autoComplete: 'additional-name' })}</div>
          {Field({ k: 'last_name', label: 'Last name', autoComplete: 'family-name' })}
          {Field({ k: 'street', label: 'Street address', autoComplete: 'address-line1', placeholder: '4120 rue Saint-Denis' })}
          <div className="tx2-grid">{Field({ k: 'apt', label: 'Apt', opt: true, autoComplete: 'address-line2' })}{Field({ k: 'city', label: 'City', autoComplete: 'address-level2' })}</div>
          <div className="tx2-grid">
            <label className="tx2-f"><span>Province</span><select value={f.province} onChange={(e) => set('province', e.target.value)}>{PROV.map((p) => <option key={p}>{p}</option>)}</select></label>
            {Field({ k: 'postal_code', label: 'Postal code', autoComplete: 'postal-code', placeholder: 'H2W 2M5', maxLength: 7 })}
          </div>
          {Field({ k: 'email', label: 'Email', type: 'email', inputMode: 'email', autoComplete: 'email' })}
          {Field({ k: 'phone', label: 'Mobile', type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
        </div>
      ) : (
        <div className="hb2-body tx2">
          <div><h1 className="hb2-t">Getting paid</h1><p className="hb2-small" style={{ marginTop: 6 }}>Paid on the 1st and the 16th by 9304-0160 Quebec Inc.</p></div>
          {Field({ k: 'sin', label: 'Social insurance number', inputMode: 'numeric', autoComplete: 'off', placeholder: '123 456 789', maxLength: 11 })}
          <div className="tx2-seg">{(['deposit', 'paypal'] as const).map((m) => <button key={m} className={f.pay_method === m ? 'on' : ''} onClick={() => set('pay_method', m)}>{m === 'deposit' ? 'Direct deposit' : 'PayPal'}<small>{m === 'deposit' ? '1st and 16th' : 'within 48 h · your fees'}</small></button>)}</div>
          {f.pay_method === 'paypal' && Field({ k: 'paypal_email', label: 'PayPal email', type: 'email', inputMode: 'email' })}
          <div className={'tx2-file' + (cheque ? ' ok' : '')}>
            <LineIcon name="cheque" size={22} color={cheque ? '#2F6B4F' : undefined} />
            <span className="grow"><b>{cheque ? 'Void cheque · added' : 'Void cheque'}</b><small>{up === 'cheque' ? 'Uploading…' : cheque ? cheque.name : 'A photo of a cheque marked VOID, or your bank’s deposit form'}</small></span>
            {!cheque && <i>Required</i>}
          </div>
          <div className="tx2-pick"><button disabled={!!up} onClick={() => camRef.current?.click()}>Take a photo</button><button disabled={!!up} onClick={() => chequeRef.current?.click()}>{cheque ? 'Change' : 'Choose a file'}</button></div>
          <button className={'tx2-file opt' + (sinCard ? ' ok' : '')} disabled={!!up} onClick={() => sinRef.current?.click()}>
            <LineIcon name="idcard" size={22} color={sinCard ? '#2F6B4F' : '#7A7268'} />
            <span className="grow"><b>Photo of your SIN card</b><small>{up === 'sin' ? 'Uploading…' : sinCard ? sinCard.name : 'Optional'}</small></span><u>{sinCard ? 'Change' : 'Add'}</u>
          </button>
          <p className="hb2-small">You’re a contractor: you get a T4A at the end of the year. Only Ronnie sees this. You can’t see your SIN again after saving.</p>
        </div>
      )}
      <div className="hb2-foot light">
        {err && <p className="error" style={{ textAlign: 'center' }} role="alert">{err}</p>}
        {page === 1 ? <button className="hb2-btn" onClick={page1}>Continue</button>
          : <button className="hb2-btn" disabled={busy || !!up} onClick={save}>{busy ? 'Saving…' : 'Save securely'}</button>}
      </div>
    </main>
  );
}
