import { useEffect, useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { LineIcon } from '../components/LineIcon';

/** Nov 8 · push 55 (082) · public apply page (ApplyFlowV2): landing → 4 steps → thank you. No login.
 *  Link only sent by Ronnie, or a staff member's Refer a friend (/apply?r=<staff id>). Nothing is texted or emailed. */
type L = 'en' | 'fr';
const T = {
  en: {
    head: "Montreal’s finest rooms\nneed a great team.", sub: '',
    r1: 'You choose the events you work', r2: 'Paid on the 1st and the 16th', r3: 'Galas, weddings, private homes',
    start: 'Apply · 3 minutes', reply: 'We reply within a few days', invited: 'invited you', back: '‹ Back', apply: 'APPLY', of: 'OF', next: 'Next',
    t1: 'About you', s1: 'So we can reach you', first: 'First name', last: 'Last name', email: 'Email', phone: 'Mobile', hood: 'Neighbourhood · for rides', hoodPh: 'Plateau, Verdun, Laval…', adult: "I'm 18 or older",
    t2: 'Your experience', s2: 'No experience is OK', q_roles: 'I want to work as', q_worked: "I've worked in", q_years: 'Years', yearsNote: 'None yet → you start on cocktail events',
    roles: { waiter: 'Waiter', bartender: 'Bartender', barback: 'Barback', manager: 'Manager' },
    worked: { fine_dining: 'Fine dining', banquets: 'Banquets', catering: 'Catering', hotel: 'Hotel', cocktail_bar: 'Cocktail bar', cafe: 'Café', none: 'Not yet' },
    years: { none: 'None', lt1: '< 1', '1-2': '1–2', '3-5': '3–5', '5+': '5+' },
    t3: 'Languages', s3: 'And how you get around', lv: ['Basic', 'Good', 'Fluent'], q_days: 'I can usually work', q_go: 'Getting there',
    days: { weekday_days: 'Weekday days', weekday_evenings: 'Weekday evenings', weekends: 'Weekends', anytime: 'Anytime' }, go: { car: 'I have a car', transit: 'Transit' },
    t4: 'Your CV', s4: 'PDF, Word or a photo of it', photo: '📷 Photo', lib: '🖼 Library', files: '📁 Files', change: 'Change', added: 'added', uploading: 'Uploading…',
    nocv: 'No CV? Tell us in 2 lines', nocvPh: 'Where you worked, what you did…', withcv: 'I have a CV after all', refBy: 'Referred by', fromLink: '✓ from their link', refQ: 'Who told you about G&R? (optional)',
    consent: 'G&R keeps my application to review it. Not hired → deleted after 12 months.', send: 'Send my application', sending: 'Sending…',
    thanks: 'Thank you', got: "Your application is with Ronnie.\nYou'll hear from us by text within a few days.", nextT: 'What happens next',
    steps: ['We review your application', "If it's a fit, you get your G&R app link", 'Set up your profile + handbook (15 min)', 'Event requests start coming in'],
    noSin: "No SIN or bank info now — only after you're hired, in your own secure account.",
    existT: "You're already on the team", existS: 'This email or phone is already a G&R staff account. Sign in to the app instead.', signIn: 'Open the app',
    err: { name: 'Add your first and last name', email: 'Check your email', phone: 'Add your mobile number', adult: 'You need to be 18 or older', roles: 'Pick at least one role', years: 'Pick your years', cv: 'Add your CV, or tell us in 2 lines', consent: 'Tick the box to send', type: 'That file type doesn’t work. Use PDF, Word or a photo.', size: 'File too big (12 MB max)', net: 'Couldn’t send. Check your connection and try again.' },
  },
  fr: {
    head: 'Les plus beaux lieux\nde Montréal cherchent\nune belle équipe.', sub: '',
    r1: 'Vous choisissez vos événements', r2: 'Payé le 1er et le 16', r3: 'Galas, mariages, résidences privées',
    start: 'Postuler · 3 minutes', reply: 'On vous répond en quelques jours', invited: 'vous invite', back: '‹ Retour', apply: 'POSTULER', of: 'DE', next: 'Suivant',
    t1: 'À propos de vous', s1: 'Pour vous joindre', first: 'Prénom', last: 'Nom', email: 'Courriel', phone: 'Cellulaire', hood: 'Quartier · pour le covoiturage', hoodPh: 'Plateau, Verdun, Laval…', adult: "J'ai 18 ans ou plus",
    t2: 'Votre expérience', s2: "Pas d'expérience ? C'est correct", q_roles: 'Je veux travailler comme', q_worked: "J'ai travaillé en", q_years: 'Années', yearsNote: 'Aucune → vous commencez par des cocktails dînatoires',
    roles: { waiter: 'Serveur·se', bartender: 'Barman·aid', barback: 'Barback', manager: 'Gérant·e' },
    worked: { fine_dining: 'Gastronomie', banquets: 'Banquets', catering: 'Traiteur', hotel: 'Hôtel', cocktail_bar: 'Bar à cocktails', cafe: 'Café', none: 'Pas encore' },
    years: { none: 'Aucune', lt1: '< 1', '1-2': '1–2', '3-5': '3–5', '5+': '5+' },
    t3: 'Langues', s3: 'Et comment vous vous déplacez', lv: ['De base', 'Bon', 'Courant'], q_days: 'Je peux habituellement', q_go: 'Pour vous déplacer',
    days: { weekday_days: 'Jours de semaine', weekday_evenings: 'Soirs de semaine', weekends: 'Fins de semaine', anytime: 'En tout temps' }, go: { car: "J'ai une auto", transit: 'Transport en commun' },
    t4: 'Votre CV', s4: "PDF, Word ou une photo", photo: '📷 Photo', lib: '🖼 Photos', files: '📁 Fichiers', change: 'Changer', added: 'ajouté', uploading: 'Envoi…',
    nocv: 'Pas de CV ? Dites-le en 2 lignes', nocvPh: 'Où vous avez travaillé, ce que vous faisiez…', withcv: "J'ai un CV finalement", refBy: 'Référé·e par', fromLink: '✓ par son lien', refQ: 'Qui vous a parlé de G&R ? (facultatif)',
    consent: 'G&R garde ma candidature pour l’étudier. Pas embauché·e → supprimée après 12 mois.', send: 'Envoyer ma candidature', sending: 'Envoi…',
    thanks: 'Merci', got: 'On a bien reçu votre candidature.\nOn vous texte d’ici quelques jours.', nextT: 'La suite',
    steps: ['On étudie votre candidature', 'Si ça clique, vous recevez votre lien vers l’app G&R', 'Profil + guide de l’employé (15 min)', 'Les demandes d’événements arrivent'],
    noSin: 'Pas de NAS ni d’info bancaire maintenant — seulement une fois embauché·e, dans votre compte sécurisé.',
    existT: 'Vous faites déjà partie de l’équipe', existS: 'Ce courriel ou ce numéro a déjà un compte G&R. Connectez-vous à l’app.', signIn: 'Ouvrir l’app',
    err: { name: 'Ajoutez votre prénom et votre nom', email: 'Vérifiez votre courriel', phone: 'Ajoutez votre cellulaire', adult: 'Il faut avoir 18 ans ou plus', roles: 'Choisissez au moins un poste', years: 'Choisissez vos années', cv: 'Ajoutez votre CV ou écrivez 2 lignes', consent: 'Cochez la case pour envoyer', type: 'Ce type de fichier ne marche pas. PDF, Word ou une photo.', size: 'Fichier trop lourd (12 Mo max)', net: "Impossible d'envoyer. Vérifiez votre connexion et réessayez." },
  },
};
type F = {
  first_name: string; last_name: string; email: string; phone: string; neighbourhood: string; adult: boolean;
  roles: string[]; worked_in: string[]; years: string; lang_fr: number; lang_en: number; days: string[]; transport: string;
  cv_path: string; cv_name: string; cv_size: number; no_cv: boolean; no_cv_note: string; referrer_text: string; consent: boolean;
};
const EMPTY: F = { first_name: '', last_name: '', email: '', phone: '', neighbourhood: '', adult: false, roles: [], worked_in: [], years: '', lang_fr: 0, lang_en: 0, days: [], transport: '',
  cv_path: '', cv_name: '', cv_size: 0, no_cv: false, no_cv_note: '', referrer_text: '', consent: false };
const LS = 'gr_apply_draft';
const load = (): F => { try { const r = localStorage.getItem(LS); return r ? { ...EMPTY, ...JSON.parse(r) } : EMPTY; } catch { return EMPTY; } };
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function Apply() {
  const qs = new URLSearchParams(window.location.search);
  const [lang, setLang] = useState<L>(() => (qs.get('lang') === 'fr' || (!qs.get('lang') && navigator.language?.startsWith('fr')) ? 'fr' : 'en'));
  const t = T[lang];
  const [step, setStep] = useState(0);
  const [f, setF] = useState<F>(load);
  const [ref, setRef] = useState<{ id: string; first: string } | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [up, setUp] = useState(false);
  const [done, setDone] = useState<'ok' | 'existing' | null>(null);
  const camRef = useRef<HTMLInputElement>(null); const libRef = useRef<HTMLInputElement>(null); const fileRef = useRef<HTMLInputElement>(null);
  const hp = useRef<HTMLInputElement>(null);

  useEffect(() => { document.title = 'G&R · Apply'; const r = qs.get('r'); if (r) fetch('/api/apply?r=' + encodeURIComponent(r)).then((x) => x.json()).then((d) => setRef(d.referrer ?? null)).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(f)); } catch { /* private mode */ } }, [f]);
  const set = <K extends keyof F>(k: K, v: F[K]) => { setF((x) => ({ ...x, [k]: v })); setErr(''); };
  const tog = (k: 'roles' | 'worked_in' | 'days', v: string) => set(k, f[k].includes(v) ? f[k].filter((x) => x !== v) : k === 'worked_in' && v === 'none' ? ['none'] : [...f[k].filter((x) => !(k === 'worked_in' && x === 'none')), v]);
  const go = (n: number) => { setStep(n); setErr(''); window.scrollTo(0, 0); };

  const check = (n: number): string => {
    if (n === 1) { if (!f.first_name.trim() || !f.last_name.trim()) return t.err.name; if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return t.err.email; if (f.phone.replace(/\D/g, '').length < 10) return t.err.phone; if (!f.adult) return t.err.adult; }
    if (n === 2) { if (!f.roles.length) return t.err.roles; if (!f.years) return t.err.years; }
    if (n === 4) { if (!f.cv_path && !(f.no_cv && f.no_cv_note.trim())) return t.err.cv; if (!f.consent) return t.err.consent; }
    return '';
  };
  const next = () => { const e = check(step); if (e) { setErr(e); return; } go(step + 1); };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    let type = file.type; if (!type && /\.heic$/i.test(file.name)) type = 'image/heic';
    if (file.size > 12 * 1024 * 1024) { setErr(t.err.size); return; }
    setUp(true); setErr('');
    try {
      const r = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cv', name: file.name, type, size: file.size }) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error === 'type' ? t.err.type : d.error === 'size' ? t.err.size : t.err.net); return; }
      const { error } = await supabase.storage.from('applications').uploadToSignedUrl(d.path, d.token, file, { contentType: type });
      if (error) { setErr(t.err.net); return; }
      setF((x) => ({ ...x, cv_path: d.path, cv_name: file.name, cv_size: file.size, no_cv: false }));
    } catch { setErr(t.err.net); } finally { setUp(false); }
  };

  const send = async () => {
    const e = check(4); if (e) { setErr(e); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'send', lang, ...f, first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: f.email.trim(),
        lang_fr: f.lang_fr || null, lang_en: f.lang_en || null, transport: f.transport || null,
        cv_path: f.cv_path || null, no_cv_note: f.no_cv ? f.no_cv_note : null, referrer_id: ref?.id ?? null, website: hp.current?.value ?? '' }) });
      const d = await r.json();
      if (!r.ok) { const k = d.error as keyof typeof t.err; setErr(t.err[k] ?? t.err.net); return; }
      setDone(d.existing ? 'existing' : 'ok'); if (!d.existing) { try { localStorage.removeItem(LS); } catch { /* */ } } window.scrollTo(0, 0);
    } catch { setErr(t.err.net); } finally { setBusy(false); }
  };

  const Lang = ({ light }: { light?: boolean }) => (
    <span className={'ap-lang' + (light ? ' light' : '')}>{(['en', 'fr'] as L[]).map((x) => <button key={x} className={lang === x ? 'on' : ''} onClick={() => setLang(x)}>{x.toUpperCase()}</button>)}</span>
  );
  const Head = ({ title, sub }: { title: string; sub: string }) => (
    <div className="ap2-head">
      <div className="ap2-nav"><button type="button" onClick={() => go(step - 1)} aria-label={t.back}>‹</button><img src="/logo-mark.png" alt="G&R" /><span>{step} / 4</span></div>
      <div className="ap2-bar"><i style={{ width: `${step * 25}%` }} /></div>
      <div className="ap2-title"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
    </div>
  );
  const Foot = ({ children }: { children: ReactNode }) => <div className="cu-foot">{err && <p className="error" style={{ textAlign: 'center' }} role="alert">{err}</p>}{children}</div>;
  const Chips = ({ k, opts }: { k: 'roles' | 'worked_in' | 'days'; opts: Record<string, string> }) => (
    <div className="ap-chips">{Object.entries(opts).map(([v, l]) => <button type="button" key={v} className={f[k].includes(v) ? 'on' : ''} aria-pressed={f[k].includes(v)} onClick={() => tog(k, v)}>{l}</button>)}</div>
  );
  const One = ({ v, opts, onPick }: { v: string; opts: Record<string, string>; onPick: (x: string) => void }) => (
    <div className="ap-chips">{Object.entries(opts).map(([x, l]) => <button type="button" key={x} className={v === x ? 'on' : ''} aria-pressed={v === x} onClick={() => onPick(x)}>{l}</button>)}</div>
  );
  const Lv = ({ label, v, onPick }: { label: string; v: number; onPick: (n: number) => void }) => (
    <div className="ap-lv"><b>{label}</b><span>{t.lv.map((x, i) => <button type="button" key={x} className={v === i + 1 ? 'on' : ''} onClick={() => onPick(v === i + 1 ? 0 : i + 1)}>{x}</button>)}</span></div>
  );
  const Check = ({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: ReactNode; small?: boolean }) => (
    <button type="button" className={'ap-check' + (small ? ' small' : '')} role="checkbox" aria-checked={on} onClick={onClick}><span className={on ? 'on' : ''}>{on ? '✓' : ''}</span><span>{children}</span></button>
  );

  if (done) return (
    <main className="v2 hb2 dark">
      <div className="hb2-frame" aria-hidden="true" />
      <div className="hb2-center">
        <img src="/logo-white.png" alt="G&R" className="hb2-logo" /><span className="hb2-rule" />
        {done === 'ok' ? <>
          <h1 className="hb2-h1">{t.thanks},<br />{f.first_name.trim().split(' ')[0]}.</h1>
          <p className="hb2-p" style={{ whiteSpace: 'pre-line' }}>{t.got}</p>
          <div className="ap2-steps">{t.steps.map((x, i) => <span key={i}><i>{i + 1}</i>{x}</span>)}</div>
        </> : <>
          <h1 className="hb2-h1">{t.existT}</h1>
          <p className="hb2-p">{t.existS}</p>
        </>}
      </div>
      <div className="hb2-foot">{done === 'ok' ? <p className="hb2-p" style={{ fontSize: 12, textAlign: 'center' }}>{t.noSin}</p> : <a className="hb2-btn cream" href="/">{t.signIn}</a>}</div>
    </main>
  );

  if (step === 0) return (
    <main className="v2 ap2-land">
      <div className="ap2-hero" />
      <div className="ap2-langrow"><Lang light /></div>
      <div className="ap2-land-b">
        {ref && <span className="ap2-inv">{ref.first} {t.invited}</span>}
        <h1>{t.head.split('\n').map((x, i) => <span key={i}>{x}<br /></span>)}</h1>
        <div className="ap2-why">{[['cal', t.r1], ['pay', t.r2], ['wine', t.r3]].map(([k, x]) => <span key={k}><LineIcon name={k} size={17} color="#D9B76A" />{x}</span>)}</div>
        <button className="hb2-btn cream" onClick={() => go(1)}>{t.start}</button>
        <p>{t.reply}</p>
      </div>
    </main>
  );

  return (
    <main className="v2 cu ap">
      {step === 1 && <>
        <Head title={t.t1} sub={t.s1} />
        <div className="cu-body">
          <div className="ap-card">
            <div className="row2"><label className="ap-f">{t.first}<input value={f.first_name} onChange={(e) => set('first_name', e.target.value)} autoComplete="given-name" /></label><label className="ap-f">{t.last}<input value={f.last_name} onChange={(e) => set('last_name', e.target.value)} autoComplete="family-name" /></label></div>
            <label className="ap-f">{t.email}<input type="email" inputMode="email" value={f.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" /></label>
            <label className="ap-f">{t.phone}<input type="tel" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" placeholder="514 555 0192" /></label>
            <label className="ap-f">{t.hood}<input value={f.neighbourhood} onChange={(e) => set('neighbourhood', e.target.value)} placeholder={t.hoodPh} /></label>
          </div>
          <Check on={f.adult} onClick={() => set('adult', !f.adult)}>{t.adult}</Check>
          <input ref={hp} name="website" tabIndex={-1} autoComplete="off" className="ap-hp" aria-hidden="true" />
        </div>
        <Foot><button className="cu-btn" onClick={next}>{t.next}</button></Foot>
      </>}
      {step === 2 && <>
        <Head title={t.t2} sub={t.s2} />
        <div className="cu-body">
          <div className="ap-q"><b>{t.q_roles}</b><Chips k="roles" opts={t.roles} /></div>
          <div className="ap-q"><b>{t.q_worked}</b><Chips k="worked_in" opts={t.worked} /></div>
          <div className="ap-q"><b>{t.q_years}</b><One v={f.years} opts={t.years} onPick={(x) => set('years', x)} /><small className="muted">{t.yearsNote}</small></div>
        </div>
        <Foot><button className="cu-btn" onClick={next}>{t.next}</button></Foot>
      </>}
      {step === 3 && <>
        <Head title={t.t3} sub={t.s3} />
        <div className="cu-body">
          <div className="ap-card"><Lv label="Français" v={f.lang_fr} onPick={(n) => set('lang_fr', n)} /><Lv label="English" v={f.lang_en} onPick={(n) => set('lang_en', n)} /></div>
          <div className="ap-q"><b>{t.q_go}</b><One v={f.transport} opts={t.go} onPick={(x) => set('transport', f.transport === x ? '' : x)} /></div>
        </div>
        <Foot><button className="cu-btn" onClick={next}>{t.next}</button></Foot>
      </>}
      {step === 4 && <>
        <Head title={t.t4} sub={t.s4} />
        <div className="cu-body">
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={libRef} type="file" accept="image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          {!f.no_cv ? (
            <div className="ap-drop">
              {f.cv_path && <div className="ap-file"><span>📄</span><span className="grow"><b>{f.cv_name}</b><small>{kb(f.cv_size)} · ✓ {t.added}</small></span><button type="button" className="ap-red-t" onClick={() => fileRef.current?.click()}>{t.change}</button></div>}
              {up ? <div className="muted sm">{t.uploading}</div> : <div className="ap-pick">
                <button type="button" onClick={() => camRef.current?.click()}>{t.photo}</button>
                <button type="button" onClick={() => libRef.current?.click()}>{t.lib}</button>
                <button type="button" onClick={() => fileRef.current?.click()}>{t.files}</button>
              </div>}
              {!f.cv_path && <button type="button" className="lnk muted sm" style={{ textDecoration: 'underline' }} onClick={() => set('no_cv', true)}>{t.nocv}</button>}
            </div>
          ) : (
            <div className="ap-card">
              <label className="ap-f">{t.nocv}<textarea rows={3} value={f.no_cv_note} onChange={(e) => set('no_cv_note', e.target.value)} placeholder={t.nocvPh} maxLength={600} /></label>
              <button type="button" className="lnk muted sm" style={{ textDecoration: 'underline', alignSelf: 'flex-start' }} onClick={() => set('no_cv', false)}>{t.withcv}</button>
            </div>
          )}
          {ref ? (
            <div className="ap-card ap-ref"><span className="ap-av">{ref.first[0]}</span><span className="grow"><small>{t.refBy}</small><b>{ref.first}</b></span><span className="ap-green sm">{t.fromLink}</span></div>
          ) : (
            <div className="ap-card"><label className="ap-f">{t.refQ}<input value={f.referrer_text} onChange={(e) => set('referrer_text', e.target.value)} maxLength={80} /></label></div>
          )}
          <Check small on={f.consent} onClick={() => set('consent', !f.consent)}>{t.consent}</Check>
        </div>
        <Foot><button className="cu-btn ap-red" disabled={busy || up} onClick={send}>{busy ? t.sending : t.send}</button></Foot>
      </>}
    </main>
  );
}
