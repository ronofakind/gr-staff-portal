import { loadOnboarding } from '../lib/handbook';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, type Staff } from '../lib/supabase';
import { setting } from '../lib/settings';
import { uploadPhoto } from '../lib/photo';
import { RELATIONS, saveMyProfile, setCheckupStep, setUsualWeekSkipped, type CheckupInfo } from '../lib/checkup';
import { useUsualWeek, UsualWeekList } from '../components/UsualWeek';
import { Avatar } from '../components/Avatar';
import {
  canPromptInstall, onInstallChange, promptInstall, isIOS, isAndroid, isInAppBrowser, chromeIntentUrl,
  homeStepApplies, setHomeSkip, clearHomeSkip, markHomeStepSeen,
} from '../lib/install';
import { useMyCalendar, addCalendar, calendarPromptSeen, defaultCalOs, type MyCal, type CalOs } from '../lib/calendar';
import { callName } from '../lib/nickname';
import { Brand, brandify } from '../components/Brand';

/**
 * Push 31a/b · Profile check-up. Full screen straight after sign-in until staff_private.checkup_done_at is set
 * (staff, managers and admins). Resumes at checkup_step; every step saves as it goes.
 * Steps (fixed ids): 1 photo · 2 you · 3 emergency (can skip) · 4 languages · 5 usual week · 6 Home Screen (can skip,
 * phone browsers only, not installed) · 8 G&R calendar (push 33h, can skip, not for admins, skipped once added) ·
 * 9 A note from Ronnie (push 33h, not counted in "N OF M") · 7 = Done screen.
 * 7 stays "Done" so everyone already at checkup_step = 7 is still done; the new screens got new ids (migration 039).
 */
const ORDER = [1, 2, 3, 4, 5, 6, 8, 9];

// ───────── push 76 · FR / EN switch: starts in their language on file (staff.language), their pick becomes their language everywhere ─────────
type CL = 'fr' | 'en';
const CuLang = createContext<{ lang: CL; setLang: (l: CL) => void }>({ lang: 'en', setLang: () => {} });
/** L('English', 'Français') */
const useL = () => { const { lang } = useContext(CuLang); return (en: string, fr: string) => (lang === 'fr' ? fr : en); };
function useLangState(me: Staff) {
  const [lang, set] = useState<CL>(me.language === 'fr' ? 'fr' : 'en');
  const setLang = (l: CL) => { set(l); if (me.language !== l) { me.language = l; supabase.from('staff').update({ language: l }).eq('id', me.id).then(({ error }) => { if (error) console.warn('[checkup lang]', error.message); }); } };
  return { lang, setLang };
}
function LangSwitch() {
  const { lang, setLang } = useContext(CuLang);
  return <span className="cu-lang-sw" role="group" aria-label="Language">{(['fr', 'en'] as const).map((l) => <button key={l} type="button" className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}</span>;
}
const REL_FR: Record<string, string> = { Parent: 'Parent', Partner: 'Conjoint·e', Sibling: 'Frère / sœur', Friend: 'Ami·e', Other: 'Autre' };
export function Checkup(props: { me: Staff; info: CheckupInfo; onFinish: () => void }) {
  const lv = useLangState(props.me);
  return <CuLang.Provider value={lv}><CheckupInner {...props} /></CuLang.Provider>;
}
function CheckupInner({ me, info, onFinish }: { me: Staff; info: CheckupInfo; onFinish: () => void }) {
  const L = useL();
  const { cal, setCal } = useMyCalendar(me.role === 'admin');
  // Decided once (tapping Add mid-step must not remove the step under them).
  const [calOn, setCalOn] = useState<boolean | null>(null);
  useEffect(() => { if (cal !== undefined && calOn === null) setCalOn(!!cal && !cal.added_at); }, [cal, calOn]);
  // push 55 · new hires already gave their languages on the application (Hiring → Accept saves them) → no Languages step.
  // Decided once, so finishing the step mid-flow doesn't renumber the steps.
  const [langsDone] = useState(() => !!(info.languages?.fr && info.languages?.en));
  const ids = [1, 2, 3, ...(langsDone ? [] : [4]), 5, ...(homeStepApplies() ? [6] : []), ...(calOn ? [8] : []), 9];
  const startAt = (s: number) => (s === 7 ? 7 : ids.includes(s) ? s : ORDER.includes(s) ? ORDER.slice(ORDER.indexOf(s) + 1).find((x) => ids.includes(x)) ?? 7 : 1);
  const [step, setStep] = useState<number | null>(null);
  useEffect(() => { if (calOn !== null && step === null) setStep(startAt(info.step)); }, [calOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const [photo, setPhoto] = useState(me.photo_url);
  // push 58 · new hire (accepted through Hiring) → "Does this look right?" + the welcome note
  const [isNew, setIsNew] = useState(false);
  useEffect(() => { loadOnboarding().then((o) => setIsNew(!!o)); }, []);
  const go = (n: number) => {
    setStep(n); window.scrollTo(0, 0);
    setCheckupStep(n, n === 7).then(({ error }) => { if (error) console.warn('[checkup]', error.message); });
  };
  useEffect(() => { if (step === 7) setCheckupStep(7, true); }, [step === 7]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = callName(me);
  if (step === null) return <div className="loading" />;
  if (step === 7) return (
    <main className="v2 cu cu-done">
      <div className="cu-done-c">
        <span className="cu-check">✓</span>
        <div className="serif" style={{ fontSize: 30 }}>{L('Thanks', 'Merci')} {first}!</div>
      </div>
      <div className="cu-foot"><button className="cu-btn green" onClick={onFinish}>{L('Go to Home', 'Aller à l’accueil')}</button></div>
    </main>
  );
  if (step === 9) return <RonnieNote name={first} welcome={isNew} onNext={() => go(7)} />;

  const counted = ids.filter((x) => x !== 9);
  const n = counted.indexOf(step) + 1;
  const head = (title: string, sub: string, skippable = false, hero?: ReactNode) => (
    <div className="cu-head">
      <div className="spread" style={{ alignItems: 'center' }}><span className="row" style={{ gap: 10, alignItems: 'center' }}>{n > 1 && <button type="button" className="cu-back" onClick={() => go(counted[n - 2])}>‹ {L('Back', 'Retour')}</button>}<span className="cu-kick">{isNew ? L('SET UP', 'CONFIGURATION') : L('PROFILE CHECK-UP', 'MISE À JOUR DU PROFIL')} · {n} {L('OF', 'DE')} {counted.length}</span></span><span className="row" style={{ gap: 8, alignItems: 'center' }}><LangSwitch /><span className="cu-req">{skippable ? L('can skip', 'facultatif') : L('required', 'obligatoire')}</span></span></div>
      <div className="cu-bar">{counted.map((x, i) => <span key={x} className={i < n ? 'on' : ''} />)}</div>
      {hero}
      <div className="serif cu-title">{brandify(title)}</div><div className="cu-sub">{sub}</div>
    </div>
  );
  const nextOf = (s: number) => ids[ids.indexOf(s) + 1] ?? 7;

  return (
    <main className="v2 cu">
      {step === 1 && <PhotoStep me={me} photo={photo} setPhoto={setPhoto} head={head(L('Add your photo', 'Ajoute ta photo'), L('required · managers use it to find you at check-in', 'obligatoire · les responsables s’en servent pour te trouver à l’arrivée'))} onNext={() => go(nextOf(1))} />}
      {step === 2 && <YouStep me={me} info={info} head={head(isNew ? L('Does this look right?', 'Est-ce que c’est bon ?') : L('Is this still right?', 'Est-ce toujours bon ?'), isNew ? L('We filled in what you gave us. Tap anything to change it.', 'On a rempli avec ce que tu nous as donné. Touche pour modifier.') : L('we filled in what we have', 'on a rempli ce qu’on a'))} onNext={() => go(nextOf(2))} />}
      {step === 3 && <EmergencyStep info={info} head={head(L('Emergency contact', 'Contact d’urgence'), L('only used if something happens at an event', 'utilisé seulement s’il arrive quelque chose pendant un événement'), setting('checkup.emergency') !== 'required')} onNext={() => go(nextOf(3))} />}
      {step === 4 && <LangStep info={info} head={head(L('Languages', 'Langues'), L('how well do you speak with guests?', 'à quel point parles-tu avec les invités ?'))} onNext={() => go(nextOf(4))} />}
      {step === 5 && <WeekStep me={me} head={head(L('Your usual week', 'Ta semaine habituelle'), L('flip on the days you can usually work', 'active les jours où tu peux habituellement travailler'), true)} onNext={() => go(nextOf(5))} />}
      {step === 6 && <HomeScreenStep head={head(L('Get the G&R app', 'Installe l’app G&R'), L('Opens in one tap · buzzes you when you’re booked', 'S’ouvre en un toucher · te prévient quand tu es réservé·e'), setting('checkup.home_screen') !== 'required', <AppTile />)} onDone={() => go(nextOf(6))} />}
      {step === 8 && cal && <CalendarStep me={me} cal={cal} onCal={setCal} head={head(L('Your G&R calendar', 'Ton calendrier G&R'), L('Confirmed shifts show up on their own, with reminders', 'Tes quarts confirmés s’ajoutent seuls, avec des rappels'), setting('checkup.calendar') !== 'required')} required={setting('checkup.calendar') === 'required'} onDone={() => go(nextOf(8))} />}
      <button className="cu-out" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>{L('Log out', 'Déconnexion')}</button>
    </main>
  );
}

/** Push 33h · staff who had already finished the check-up: the calendar step once as "ONE MORE THING", then the note from Ronnie. */
export function CalendarAgain(props: { me: Staff; cal: MyCal; onClose: () => void }) {
  const lv = useLangState(props.me);
  return <CuLang.Provider value={lv}><CalendarAgainInner {...props} /></CuLang.Provider>;
}
function CalendarAgainInner({ me, cal, onClose }: { me: Staff; cal: MyCal; onClose: () => void }) {
  const L = useL();
  const [c, setC] = useState(cal); const [note, setNote] = useState(false);
  if (note) return <RonnieNote name={callName(me)} onNext={onClose} />;
  const head = (
    <div className="cu-head">
      <div className="spread" style={{ alignItems: 'center' }}><span className="cu-kick">{L('ONE MORE THING', 'UNE DERNIÈRE CHOSE')}</span><span className="row" style={{ gap: 8, alignItems: 'center' }}><LangSwitch /><span className="cu-req">{L('can skip', 'facultatif')}</span></span></div>
      <div className="serif cu-title">{L('Your', 'Ton calendrier')} <Brand />{L(' calendar', '')}</div><div className="cu-sub">{L('Confirmed shifts show up on their own, with reminders', 'Tes quarts confirmés s’ajoutent seuls, avec des rappels')}</div>
    </div>
  );
  return <main className="v2 cu"><CalendarStep me={me} cal={c} onCal={setC} head={head} onDone={() => { window.scrollTo(0, 0); setNote(true); }} /></main>;
}

/** Shown on its own (not the whole check-up) when they chose "Skip for now" on step 6 and open the app from the browser again. */
export function HomeScreenAgain({ onClose }: { onClose: () => void }) {
  useEffect(() => { markHomeStepSeen(); }, []);
  const head = (
    <div className="cu-head">
      <div className="spread" style={{ alignItems: 'center' }}><span className="cu-kick">ONE MORE THING</span><span className="cu-req">can skip</span></div>
      <AppTile /><div className="serif cu-title">Get the <Brand /> app</div><div className="cu-sub">Opens in one tap · buzzes you when you’re booked</div>
    </div>
  );
  return <main className="v2 cu"><HomeScreenStep head={head} onDone={onClose} /></main>;
}

const Foot = ({ children }: { children: ReactNode }) => <div className="cu-foot">{children}</div>;

// ───────── 1 · Photo ─────────
function PhotoStep({ me, photo, setPhoto, head, onNext }: { me: Staff; photo: string | null; setPhoto: (u: string) => void; head: ReactNode; onNext: () => void }) {
  const L = useL();
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [local, setLocal] = useState<string | null>(null);
  // Show the picture right away; shrink + upload in the background (Ronnie, Nov 4: the wait after taking it felt slow).
  const pick = async (f?: File) => {
    if (!f) return; setBusy(true); setErr(''); const u = URL.createObjectURL(f); setLocal(u);
    try { setPhoto(await uploadPhoto(me.id, f)); } catch (e) { setErr((e as Error).message); setLocal(null); } finally { setBusy(false); }
  };
  const shown = (busy && local) || photo;
  return (
    <>
      {head}
      <div className="cu-body">
        <div className="cu-photo">{shown ? <img src={shown} alt={me.full_name} /> : <span><CamIcon />{L('No photo yet', 'Pas encore de photo')}</span>}{busy && <i className="cu-saving">{L('Saving…', 'Enregistrement…')}</i>}</div>
        <label className="cu-btn">{photo ? L('Take a new photo', 'Prendre une nouvelle photo') : L('Take a photo', 'Prendre une photo')}<input type="file" accept="image/*" capture="user" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        <label className="cu-btn line">{L('Choose from my photos', 'Choisir dans mes photos')}<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        {err && <p className="error">{err}</p>}
        <p className="cu-note">{L('Face clearly visible · plain background · no sunglasses or group photos.', 'Visage bien visible · fond uni · pas de lunettes de soleil ni de photo de groupe.')}{photo ? L(' This one looks good? Just tap Next.', ' Celle-ci est bonne ? Touche Continuer.') : ''}</p>
      </div>
      <Foot><button className="cu-btn green" disabled={!photo || busy} onClick={onNext}>{photo ? L('Next', 'Continuer') : L('Next · add a photo first', 'Continuer · ajoute une photo d’abord')}</button></Foot>
    </>
  );
}

// ───────── 2 · Phone / email / neighbourhood ─────────
function YouStep({ me, info, head, onNext }: { me: Staff; info: CheckupInfo; head: ReactNode; onNext: () => void }) {
  const L = useL();
  const [phone, setPhone] = useState(me.phone ?? '');
  const [email, setEmail] = useState(me.email ?? '');
  const [hood, setHood] = useState(info.neighbourhood ?? '');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setPendingEmail((data.user as { new_email?: string } | null)?.new_email ?? null)); }, []);
  const phoneOk = phone.replace(/\D/g, '').length >= 10;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const hoodOk = hood.trim().length >= 2;
  const save = async () => {
    setBusy(true); setErr('');
    try {
      if (phone.trim() !== (me.phone ?? '')) { const { error } = await supabase.from('staff').update({ phone: phone.trim() }).eq('id', me.id); if (error) throw error; me.phone = phone.trim(); }
      const { error: e2 } = await saveMyProfile({ neighbourhood: hood.trim() }); if (e2) throw e2;
      info.neighbourhood = hood.trim();
      const newEmail = email.trim().toLowerCase();
      if (newEmail !== (me.email ?? '').toLowerCase()) {
        // Sign-in email changes only through Supabase Auth (confirm link). staff.email follows once confirmed (036 trigger).
        const { error } = await supabase.auth.updateUser({ email: newEmail }, { emailRedirectTo: window.location.origin });
        if (error) throw new Error(/already|registered|exists/i.test(error.message) ? L('That email is already used by another account. Talk to Ronnie.', 'Ce courriel est déjà utilisé par un autre compte. Parle à Ronnie.') : error.message);
        setSentTo(newEmail); setPendingEmail(newEmail); return;
      }
      onNext();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {head}
      <div className="cu-body">
        <label className="cu-f"><span>{L('PHONE', 'TÉLÉPHONE')}</span><input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(514) 555-0000" /></label>
        <label className="cu-f"><span>{L('EMAIL', 'COURRIEL')}</span><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setSentTo(null); }} /></label>
        {pendingEmail && !sentTo && <p className="cu-note amber">{L('Waiting for you to confirm', 'En attente de ta confirmation de')} <b>{pendingEmail}</b>. {L('Until you tap the link, you keep signing in with', 'Tant que tu n’as pas touché le lien, tu te connectes avec')} {me.email}.</p>}
        <label className="cu-f"><span>{L('NEIGHBOURHOOD', 'QUARTIER')}</span><input value={hood} maxLength={60} onChange={(e) => setHood(e.target.value)} placeholder={L('e.g. Verdun', 'ex. Verdun')} /></label>
        <p className="cu-note">{L('Used for rides to far events. No street address here.', 'Sert au covoiturage pour les événements loin. Pas d’adresse ici.')}</p>
        {sentTo && <div className="cu-box ok"><b>{L('Check your new email to confirm', 'Vérifie ton nouveau courriel pour confirmer')}</b><span>{L('We sent a link to', 'On a envoyé un lien à')} {sentTo}. {L('Tap it to switch. Until then, keep signing in with', 'Touche-le pour changer. D’ici là, connecte-toi avec')} {me.email}.</span></div>}
        {err && <p className="error">{err}</p>}
      </div>
      <Foot>{sentTo
        ? <button className="cu-btn green" onClick={onNext}>{L('Got it · next', 'Compris · continuer')}</button>
        : <button className="cu-btn green" disabled={busy || !phoneOk || !emailOk || !hoodOk} onClick={save}>{busy ? L('Saving…', 'Enregistrement…') : !phoneOk ? L('Next · add your phone', 'Continuer · ajoute ton téléphone') : !hoodOk ? L('Next · add your neighbourhood', 'Continuer · ajoute ton quartier') : L('Looks right · next', 'C’est bon · continuer')}</button>}</Foot>
    </>
  );
}

// ───────── 3 · Emergency contact (admin only) ─────────
export function EmergencyForm({ info, onSaved, onSkip, saveLabel }: { info: CheckupInfo; onSaved: () => void; onSkip?: () => void; saveLabel?: string }) {
  const L = useL();
  const [name, setName] = useState(info.emergency_name ?? '');
  const [rel, setRel] = useState(info.emergency_relation ?? '');
  const [phone, setPhone] = useState(info.emergency_phone ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = name.trim().length >= 2 && !!rel && phone.replace(/\D/g, '').length >= 7;
  const save = async () => {
    setBusy(true); setErr('');
    const { error } = await saveMyProfile({ emergency_name: name.trim(), emergency_relation: rel, emergency_phone: phone.trim() });
    if (!error) Object.assign(info, { emergency_name: name.trim(), emergency_relation: rel, emergency_phone: phone.trim() }); // kept if they go ‹ Back
    setBusy(false);
    if (error) return setErr(error.message);
    Object.assign(info, { emergency_name: name.trim(), emergency_relation: rel, emergency_phone: phone.trim() });
    onSaved();
  };
  return (
    <>
      <div className="cu-body">
        <label className="cu-f"><span>{L('NAME', 'NOM')}</span><input value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder={L('Their full name', 'Son nom complet')} /></label>
        <div className="cu-f"><span>{L('RELATION', 'LIEN')}</span>
          <div className="cu-chips">{RELATIONS.map((r) => <button key={r} type="button" className={rel === r ? 'on' : ''} aria-pressed={rel === r} onClick={() => setRel(r)}>{rel === r && '✓ '}{L(r, REL_FR[r] ?? r)}</button>)}</div></div>
        <label className="cu-f"><span>{L('PHONE', 'TÉLÉPHONE')}</span><input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(514) 555-0000" /></label>
        <p className="cu-note lock">{L('Only Ronnie sees this. Never shown to managers or other staff.', 'Seul Ronnie le voit. Jamais montré aux responsables ni aux autres.')}</p>
        {err && <p className="error">{err}</p>}
      </div>
      <Foot>
        <button className="cu-btn green" disabled={!ok || busy} onClick={save}>{busy ? L('Saving…', 'Enregistrement…') : saveLabel ?? L('Next', 'Continuer')}</button>
        {onSkip && <button className="cu-skip" onClick={onSkip}><span>{L('Skip for now', 'Plus tard')}</span><small>{L('We’ll remind you on Home later', 'On te le rappellera sur l’accueil')}</small></button>}
      </Foot>
    </>
  );
}
function EmergencyStep({ info, head, onNext }: { info: CheckupInfo; head: ReactNode; onNext: () => void }) {
  // Settings → Profile check-up: "Required" hides Skip for now (push 32)
  return <>{head}<EmergencyForm info={info} onSaved={onNext} onSkip={setting('checkup.emergency') === 'required' ? undefined : onNext} /></>;
}

// ───────── 4 · Languages (FR + EN only) ─────────
const LV: [number, string, string][] = [[1, 'Basic', 'De base'], [2, 'Good', 'Bon'], [3, 'Fluent', 'Couramment']];
function LangStep({ info, head, onNext }: { info: CheckupInfo; head: ReactNode; onNext: () => void }) {
  const L = useL();
  const [l, setL] = useState<Record<string, number>>(() => ({ ...(info.languages ?? {}) }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = !!l.fr && !!l.en;
  const save = async () => {
    setBusy(true); setErr('');
    const v = { fr: l.fr, en: l.en };
    const { error } = await saveMyProfile({ languages: v });
    setBusy(false);
    if (error) return setErr(error.message);
    info.languages = v; onNext();
  };
  return (
    <>
      {head}
      <div className="cu-body">
        {([['fr', 'French', 'Français'], ['en', 'English', 'Anglais']] as const).map(([k, name, nfr]) => (
          <div key={k} className="cu-lang"><b>{L(name, nfr)}</b>
            <div className="seg">{LV.map(([n, lab, lfr]) => <button key={n} type="button" className={l[k] === n ? 'on' : ''} aria-pressed={l[k] === n} onClick={() => setL({ ...l, [k]: n })}>{L(lab, lfr)}</button>)}</div></div>
        ))}
        <p className="cu-note">{L('Basic = a few words · Good = easy conversation · Fluent = no problem at all.', 'De base = quelques mots · Bon = conversation facile · Couramment = aucun problème.')}</p>
        {err && <p className="error">{err}</p>}
      </div>
      <Foot><button className="cu-btn green" disabled={!ok || busy} onClick={save}>{busy ? L('Saving…', 'Enregistrement…') : ok ? L('Next', 'Continuer') : L('Next · pick both', 'Continuer · choisis les deux')}</button></Foot>
    </>
  );
}

// ───────── 5 · Usual week (same as Availability) · push 34d: can skip ─────────
function WeekStep({ me, head, onNext }: { me: Staff; head: ReactNode; onNext: () => void }) {
  const L = useL();
  const { week, setDay, loaded, err } = useUsualWeek(me.id);
  return (
    <>
      {head}
      <div className="cu-body">
        {loaded ? <UsualWeekList week={week} setDay={setDay} plural /> : <div className="card muted sm">{L('Loading…', 'Chargement…')}</div>}
        {err && <p className="error">{err}</p>}
        <p className="cu-note">{L('Same as My usual week in Availability. Already set? It shows here, just tap Next.', 'Comme « Ma semaine habituelle » dans Disponibilités. Déjà fait ? Ça s’affiche ici, touche Continuer.')}</p>
      </div>
      <Foot>
        <button className="cu-btn green" disabled={!loaded} onClick={() => { setUsualWeekSkipped(false); onNext(); }}>{L('Next', 'Continuer')}</button>
        <button className="cu-skip" onClick={() => { setUsualWeekSkipped(true); onNext(); }}><span>{L('Skip for now', 'Plus tard')}</span><small>{L('We’ll remind you on Home later', 'On te le rappellera sur l’accueil')}</small></button>
      </Foot>
    </>
  );
}

/** push 34d · Home → "🗓 Set your usual week ›": the same switches, full screen. Done (even with all days off) removes the card. */
export function UsualWeekScreen({ me, onClose }: { me: Staff; onClose: (answered: boolean) => void }) {
  const { week, setDay, loaded, err } = useUsualWeek(me.id);
  return (
    <div className="cu-overlay">
      <main className="v2 cu">
        <div className="cu-head">
          <div className="spread" style={{ alignItems: 'center' }}><span className="cu-kick">MY USUAL WEEK</span><button className="sq" aria-label="Close" onClick={() => onClose(false)}>×</button></div>
          <div className="serif cu-title">Your usual week</div><div className="cu-sub">flip on the days you can usually work</div>
        </div>
        <div className="cu-body">
          {loaded ? <UsualWeekList week={week} setDay={setDay} plural /> : <div className="card muted sm">Loading…</div>}
          {err && <p className="error">{err}</p>}
          <p className="cu-note">Same as My usual week in Availability. Ronnie only asks you for days you’re usually free.</p>
        </div>
        <Foot><button className="cu-btn green" disabled={!loaded} onClick={async () => { await setUsualWeekSkipped(false); onClose(true); }}>Done</button></Foot>
      </main>
    </div>
  );
}

// ───────── 6 · Home Screen ─────────
function HomeScreenStep({ head, onDone }: { head: ReactNode; onDone: () => void }) {
  const L = useL();
  const [os, setOs] = useState<'ios' | 'android'>(isAndroid() && !isIOS() ? 'android' : 'ios');
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((x) => x + 1)), []);
  const inApp = isInAppBrowser();
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.origin); setCopied(true); } catch { setCopied(false); } };
  const install = async () => { if (await promptInstall()) { clearHomeSkip(); onDone(); } };
  const oneTap = canPromptInstall() && !inApp;
  return (
    <>
      {head}
      <div className="cu-body">
        <div className="seg cu-os">
          <button className={os === 'ios' ? 'on' : ''} onClick={() => setOs('ios')}><AppleIcon /> iPhone</button>
          <button className={os === 'android' ? 'on' : ''} onClick={() => setOs('android')}><DroidIcon /> Android</button>
        </div>
        {inApp && (
          <div className="cu-box amber">
            <b>{L('Open this page in', 'Ouvre d’abord cette page dans')} {os === 'ios' ? 'Safari' : 'Chrome'}{L(' first', '')}</b>
            <span>{L('You opened', 'Tu as ouvert')} <Brand /> {L('inside another app (WhatsApp, Instagram, Messenger…). Adding to the Home Screen only works from', 'dans une autre app (WhatsApp, Instagram, Messenger…). L’ajout à l’écran d’accueil ne marche que depuis')} {os === 'ios' ? 'Safari' : 'Chrome'}.</span>
            {os === 'android' && <a className="cu-btn" href={chromeIntentUrl()}>{L('Open in Chrome', 'Ouvrir dans Chrome')}</a>}
            <button className="cu-btn line" onClick={copy}>{copied ? L('✓ Link copied', '✓ Lien copié') : L('Copy the link', 'Copier le lien')}</button>
            <span>{os === 'ios' ? L('Then open Safari, paste it in the address bar and come back to this step. Or tap ⋯ / the compass and choose “Open in Safari”.', 'Ouvre ensuite Safari, colle-le dans la barre d’adresse et reviens à cette étape. Ou touche ⋯ / la boussole et choisis « Ouvrir dans Safari ».') : L('Or tap ⋮ and choose “Open in Chrome”, or paste the link in Chrome.', 'Ou touche ⋮ et choisis « Ouvrir dans Chrome », ou colle le lien dans Chrome.')}</span>
          </div>
        )}
        {os === 'ios' ? (
          <div className="cu-strip">
            <span><em><MenuIcon /></em><b>{L('Tap ≡', 'Touche ≡')}</b></span><i>›</i>
            <span><em><ShareIcon /></em><b>{L('Share', 'Partager')}</b></span><i>›</i>
            <span><em><ChevronIcon /></em><b>{L('View More', 'Plus')}</b></span><i>›</i>
            <span><em><PlusSqIcon /></em><b>{L('Add to Home', 'Sur l’écran')}<br />{L('Screen', 'd’accueil')}</b></span>
          </div>
        ) : <>
          {oneTap && <><button className="cu-btn green" onClick={install}><PlusIcon /> {L('Install', 'Installer')} <Brand /></button><p className="cu-note" style={{ textAlign: 'center' }}>{L('Most Android phones: one tap, then', 'La plupart des Android : un toucher, puis')} <b>{L('Install', 'Installer')}</b></p></>}
          {oneTap && <p className="cu-note" style={{ textAlign: 'center', marginTop: 6 }}>{L('No button? In Chrome:', 'Pas de bouton ? Dans Chrome :')}</p>}
          <div className="cu-strip">
            <span><em><DotsIcon /></em><b>{L('Tap ⋮', 'Touche ⋮')}</b></span><i>›</i>
            <span><em><PlusIcon /></em><b>{L('Add to Home', 'Ajouter à l’écran')}<br />{L('screen', 'd’accueil')}</b></span><i>›</i>
            <span><em><CheckIcon /></em><b>{L('Install', 'Installer')}</b></span>
          </div>
        </>}
      </div>
      <Foot>
        <button className={'cu-btn ' + (oneTap && os === 'android' ? 'line' : 'green')} onClick={() => { clearHomeSkip(); onDone(); }}>{L('Done · I added it', 'C’est fait · je l’ai ajoutée')}</button>
        {setting('checkup.home_screen') !== 'required' && <button className="cu-skip" onClick={() => { setHomeSkip(); onDone(); }}><span>{L('Skip for now', 'Plus tard')}</span></button>}
      </Foot>
    </>
  );
}

// ───────── 8 · G&R calendar (push 33h) ─────────
type Prev = { dow: string; day: number; venue: string; time: string };
const SAMPLE: Prev[] = [{ dow: 'THU', day: 5, venue: 'Le 9e', time: '5:00 PM' }, { dow: 'FRI', day: 6, venue: 'Maison Principale', time: '3:00 PM' }];
/** The calendar step body (check-up step 8, "One more thing", and Profile → Add my G&R calendar). */
export function CalendarBody({ me, cal, onCal, onAdded }: { me: Staff; cal: MyCal; onCal: (c: MyCal) => void; onAdded?: () => void }) {
  const L = useL();
  const [os, setOs] = useState<CalOs>(defaultCalOs);
  const [prev, setPrev] = useState<Prev[] | null>(null);
  useEffect(() => {
    supabase.from('shifts').select('planned_start,time_tbc,events!inner(event_date,title,details_pending,venues(name))').eq('staff_id', me.id).neq('status', 'declined')
      .gte('planned_start', new Date().toISOString()).order('planned_start').limit(6)
      .then(({ data }) => {
        type R = { planned_start: string; time_tbc: boolean | null; events: { event_date: string; title: string; details_pending?: boolean; venues: { name: string } | null } };
        const rows = ((data ?? []) as unknown as R[]).filter((r) => r.events && !r.events.details_pending && !r.time_tbc).slice(0, 2);
        setPrev(rows.length === 2 ? rows.map((r) => { const d = new Date(r.events.event_date + 'T12:00:00');
          return { dow: d.toLocaleDateString('en-CA', { weekday: 'short' }).replace('.', '').toUpperCase(), day: d.getDate(), venue: r.events.venues?.name ?? r.events.title,
            time: new Date(r.planned_start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) }; }) : SAMPLE);
      }, () => setPrev(SAMPLE));
  }, [me.id]);
  const add = async () => { onCal(await addCalendar(cal, os)); onAdded?.(); };
  const p = (prev ?? SAMPLE)[0];
  return (
    <>
      <div className="cal-prev">
        <div className="cu-kick">{L('IN YOUR CALENDAR', 'DANS TON CALENDRIER')}{prev === SAMPLE ? L(' · EXAMPLE', ' · EXEMPLE') : ''}</div>
        <div className="cal-prev-row"><span className="d"><small>{p.dow}</small><b>{p.day}</b></span><span className="ev"><b>{p.venue} · <Brand /> {L('shift', 'quart')}</b><small>{p.time} · {L('reminder the day before', 'rappel la veille')}</small></span></div>
      </div>
      {cal.added_at
        ? <div className="cal-added"><span>✓</span>{L('Added · you’re all set', 'Ajouté · tout est prêt')}</div>
        : <><button className="cu-btn green" onClick={add}>{L('Add to my calendar', 'Ajouter à mon calendrier')}</button>
            <p className="cu-note" style={{ textAlign: 'center' }}>{os === 'ios' ? L('Your iPhone asks “Subscribe?” · tap Subscribe', 'Ton iPhone demande « S’abonner ? » · touche S’abonner') : L('Opens Google Calendar · tap Add', 'Ouvre Google Agenda · touche Ajouter')}</p></>}
      <p className="cu-note" style={{ textAlign: 'center' }}>
        {cal.added_at && <>{L('Didn’t see', 'Pas vu')} “{os === 'ios' ? L('Subscribe', 'S’abonner') : L('Add', 'Ajouter')}”? <button type="button" className="cu-os-link in" onClick={add}><u>{L('Try again', 'Réessayer')}</u></button> · </>}
        <button type="button" className="cu-os-link in" onClick={() => setOs(os === 'ios' ? 'android' : 'ios')}>{os === 'ios' ? L('Google Calendar?', 'Google Agenda ?') : L('iPhone calendar?', 'Calendrier iPhone ?')}</button>
      </p>
    </>
  );
}
function CalendarStep({ me, cal, onCal, head, required = false, onDone }: { me: Staff; cal: MyCal; onCal: (c: MyCal) => void; head: ReactNode; required?: boolean; onDone: () => void }) {
  const L = useL();
  useEffect(() => { calendarPromptSeen(); }, []); // shown once: the "ONE MORE THING" copy won't come back
  return (
    <>
      {head}
      <div className="cu-body"><CalendarBody me={me} cal={cal} onCal={onCal} /></div>
      <Foot>
        {cal.added_at && <button className="cu-btn green" onClick={onDone}>{L('Next', 'Continuer')}</button>}
        {!cal.added_at && !required && <button className="cu-skip" onClick={onDone}><span>{L('Skip for now', 'Plus tard')}</span></button>}
      </Foot>
    </>
  );
}

// ───────── A note from Ronnie (push 33h, after the last step, before Done) ─────────
/** Ronnie's own staff photo (public avatars bucket, same path his Profile photo upload overwrites). */
const RONNIE_PHOTO = 'https://oigqdecyhmeuvrpoikdv.supabase.co/storage/v1/object/public/avatars/13791946-d8df-4146-b51e-0963f0324499.jpg';

export function RonnieNote({ name, onNext, welcome }: { name: string; onNext: () => void; welcome?: boolean }) {
  const L = useL();
  return (
    <main className="v2 cu">
      <div className="cu-head"><div className="spread" style={{ alignItems: 'center' }}><span className="cu-kick">{L('A NOTE FROM RONNIE', 'UN MOT DE RONNIE')}</span><LangSwitch /></div>
        <div className="row" style={{ gap: 12, alignItems: 'center', marginTop: 6 }}><Avatar name="Ronnie" url={RONNIE_PHOTO} size={56} /><div><b>Ronnie</b><div className="cu-sub" style={{ marginTop: 0 }}><Brand /> à votre service</div></div></div>
      </div>
      <div className="cu-body">
        <div className="ronnie-note">
          <p>{L('Hi', 'Salut')} {name},</p>
          {welcome ? <>
            <p>{L('Welcome to the', 'Bienvenue dans la')} <Brand /> {L('familia. Everything you need is here: your events, your hours and every detail of the night.', 'familia. Tout ce qu’il te faut est ici : tes événements, tes heures et chaque détail de la soirée.')}</p>
            <p>{L('If something looks off, send me a screenshot. Ideas are welcome too.', 'Si quelque chose cloche, envoie-moi une capture d’écran. Les idées sont aussi les bienvenues.')}</p>
          </> : <>
          <p>{L('I built this app myself so everything you need (your shifts, hours and event details) is in one place. It’s brand new, and I’m still learning as I go, so thank you for your patience.', 'J’ai créé cette app moi-même pour que tout ce qu’il te faut (tes quarts, tes heures et les détails des événements) soit au même endroit. Elle est toute nouvelle et j’apprends en chemin, alors merci de ta patience.')}</p>
          <p>{L('If something looks off or doesn’t work, take a screenshot and send it to me. Ideas are welcome too. This app is for our', 'Si quelque chose cloche ou ne marche pas, prends une capture d’écran et envoie-la-moi. Les idées sont aussi les bienvenues. Cette app est pour notre')} <Brand /> {L('familia, and your feedback makes it better.', 'familia, et tes commentaires la rendent meilleure.')}</p>
          <p>{L('Thanks for being part of the team. ❤️', 'Merci de faire partie de l’équipe. ❤️')}</p>
          </>}
          <p className="sig">Ronnie</p>
        </div>
      </div>
      <Foot><button className="cu-btn green" onClick={onNext}>{L('Thanks, let’s go', 'Merci, on y va')}</button></Foot>
    </main>
  );
}

// ───────── simple inline icons (no screenshots) ─────────
const sv = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
const CamIcon = () => <svg {...sv} width={30} height={30}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>;
const MenuIcon = () => <svg {...sv}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
const ShareIcon = () => <svg {...sv}><path d="M12 15V3M8 7l4-4 4 4" /><path d="M6 11H5v10h14V11h-1" /></svg>;
const ChevronIcon = () => <svg {...sv}><circle cx="12" cy="12" r="9" /><path d="m8 11 4 4 4-4" /></svg>;
const PlusSqIcon = () => <svg {...sv}><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" /></svg>;
const PlusIcon = () => <svg {...sv}><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
const CheckIcon = () => <svg {...sv}><path d="M5 12l5 5 9-10" /></svg>;
const AppTile = () => <div className="cu-tile"><span><img src="/apple-touch-icon.png" alt="" /></span><small>G&amp;R</small></div>;
const DotsIcon = () => <svg {...sv}><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></svg>;
const AppleIcon = () => <svg {...sv} width={14} height={14}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>;
const DroidIcon = () => <svg {...sv} width={14} height={14}><path d="M6 10a6 6 0 0 1 12 0v8H6z" /><path d="M8 4l1.5 2.5M16 4l-1.5 2.5" /><circle cx="10" cy="11" r=".6" fill="currentColor" /><circle cx="14" cy="11" r=".6" fill="currentColor" /></svg>;
