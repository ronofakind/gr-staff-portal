import { useEffect, useState, type ReactNode } from 'react';
import { supabase, type Staff } from '../lib/supabase';
import { setting } from '../lib/settings';
import { uploadPhoto } from '../lib/photo';
import { RELATIONS, saveMyProfile, setCheckupStep, type CheckupInfo } from '../lib/checkup';
import { useUsualWeek, UsualWeekList } from '../components/UsualWeek';
import {
  canPromptInstall, onInstallChange, promptInstall, isIOS, isAndroid, isInAppBrowser, chromeIntentUrl,
  homeStepApplies, setHomeSkip, clearHomeSkip, markHomeStepSeen,
} from '../lib/install';

/**
 * Push 31a/b · Profile check-up. Full screen straight after sign-in until staff_private.checkup_done_at is set
 * (staff, managers and admins). Resumes at checkup_step; every step saves as it goes.
 * Steps (fixed ids): 1 photo · 2 you · 3 emergency (can skip) · 4 languages · 5 usual week · 6 Home Screen (can skip,
 * phone browsers only, not installed) · 7 = Done screen.
 */
export function Checkup({ me, info, onFinish }: { me: Staff; info: CheckupInfo; onFinish: () => void }) {
  const ids = [1, 2, 3, 4, 5, ...(homeStepApplies() ? [6] : [])];
  const startAt = (s: number) => (s >= 7 || (s > 5 && !ids.includes(s)) ? 7 : ids.includes(s) ? s : 1);
  const [step, setStep] = useState(() => startAt(info.step));
  const [photo, setPhoto] = useState(me.photo_url);
  const go = (n: number) => {
    const next = n > 5 && !ids.includes(n) ? 7 : n;
    setStep(next); window.scrollTo(0, 0);
    setCheckupStep(next, next === 7).then(({ error }) => { if (error) console.warn('[checkup]', error.message); });
  };
  useEffect(() => { if (step === 7) setCheckupStep(7, true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const first = me.nickname || me.full_name.split(' ')[0];
  if (step === 7) return (
    <main className="v2 cu cu-done">
      <div className="cu-done-c">
        <span className="cu-check">✓</span>
        <div className="serif" style={{ fontSize: 30 }}>Thanks {first}!</div>
        <p>You’re all set. Uniform sizes and the rest can be filled in anytime in Profile.</p>
      </div>
      <div className="cu-foot"><button className="cu-btn green" onClick={onFinish}>Go to Home</button></div>
    </main>
  );

  const n = ids.indexOf(step) + 1;
  const head = (title: string, sub: string, skippable = false) => (
    <div className="cu-head">
      <div className="spread" style={{ alignItems: 'center' }}><span className="cu-kick">PROFILE CHECK-UP · {n} OF {ids.length}</span><span className="cu-req">{skippable ? 'can skip' : 'required'}</span></div>
      <div className="cu-bar">{ids.map((x, i) => <span key={x} className={i < n ? 'on' : ''} />)}</div>
      <div className="serif cu-title">{title}</div><div className="cu-sub">{sub}</div>
    </div>
  );
  const nextOf = (s: number) => ids[ids.indexOf(s) + 1] ?? 7;

  return (
    <main className="v2 cu">
      {step === 1 && <PhotoStep me={me} photo={photo} setPhoto={setPhoto} head={head('Add your photo', 'required · managers use it to find you at check-in')} onNext={() => go(nextOf(1))} />}
      {step === 2 && <YouStep me={me} info={info} head={head('Is this still right?', 'we filled in what we have')} onNext={() => go(nextOf(2))} />}
      {step === 3 && <EmergencyStep info={info} head={head('Emergency contact', 'only used if something happens at an event', setting('checkup.emergency') !== 'required')} onNext={() => go(nextOf(3))} />}
      {step === 4 && <LangStep info={info} head={head('Languages', 'how well do you speak with guests?')} onNext={() => go(nextOf(4))} />}
      {step === 5 && <WeekStep me={me} head={head('Your usual week', 'flip on the days you can usually work')} onNext={() => go(nextOf(5))} />}
      {step === 6 && <HomeScreenStep head={head('Add G&R to your Home Screen', 'opens faster · lets your phone buzz for shifts', setting('checkup.home_screen') !== 'required')} onDone={() => go(7)} />}
      <button className="cu-out" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>Log out</button>
    </main>
  );
}

/** Shown on its own (not the whole check-up) when they chose "Skip for now" on step 6 and open the app from the browser again. */
export function HomeScreenAgain({ onClose }: { onClose: () => void }) {
  useEffect(() => { markHomeStepSeen(); }, []);
  const head = (
    <div className="cu-head">
      <div className="spread" style={{ alignItems: 'center' }}><span className="cu-kick">ONE MORE THING</span><span className="cu-req">can skip</span></div>
      <div className="serif cu-title">Add G&amp;R to your Home Screen</div><div className="cu-sub">opens faster · lets your phone buzz for shifts</div>
    </div>
  );
  return <main className="v2 cu"><HomeScreenStep head={head} onDone={onClose} /></main>;
}

const Foot = ({ children }: { children: ReactNode }) => <div className="cu-foot">{children}</div>;

// ───────── 1 · Photo ─────────
function PhotoStep({ me, photo, setPhoto, head, onNext }: { me: Staff; photo: string | null; setPhoto: (u: string) => void; head: ReactNode; onNext: () => void }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const pick = async (f?: File) => {
    if (!f) return; setBusy(true); setErr('');
    try { setPhoto(await uploadPhoto(me.id, f)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {head}
      <div className="cu-body">
        <div className="cu-photo">{photo ? <img src={photo} alt={me.full_name} /> : <span><CamIcon />{busy ? 'Uploading…' : 'No photo yet'}</span>}</div>
        <label className="cu-btn">{photo ? 'Take a new photo' : 'Take a photo'}<input type="file" accept="image/*" capture="user" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        <label className="cu-btn line">Choose from my photos<input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} /></label>
        {err && <p className="error">{err}</p>}
        <p className="cu-note">Face clearly visible · plain background · no sunglasses or group photos.{photo ? ' This one looks good? Just tap Next.' : ''}</p>
      </div>
      <Foot><button className="cu-btn green" disabled={!photo || busy} onClick={onNext}>{photo ? 'Next' : 'Next · add a photo first'}</button></Foot>
    </>
  );
}

// ───────── 2 · Phone / email / neighbourhood ─────────
function YouStep({ me, info, head, onNext }: { me: Staff; info: CheckupInfo; head: ReactNode; onNext: () => void }) {
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
        if (error) throw new Error(/already|registered|exists/i.test(error.message) ? 'That email is already used by another account. Talk to Ronnie.' : error.message);
        setSentTo(newEmail); setPendingEmail(newEmail); return;
      }
      onNext();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      {head}
      <div className="cu-body">
        <label className="cu-f"><span>PHONE</span><input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(514) 555-0000" /></label>
        <label className="cu-f"><span>EMAIL</span><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setSentTo(null); }} /></label>
        {pendingEmail && !sentTo && <p className="cu-note amber">Waiting for you to confirm <b>{pendingEmail}</b>. Until you tap the link, you keep signing in with {me.email}.</p>}
        <label className="cu-f"><span>NEIGHBOURHOOD</span><input value={hood} maxLength={60} onChange={(e) => setHood(e.target.value)} placeholder="e.g. Verdun" /></label>
        <p className="cu-note">Used for rides to far events. No street address here.</p>
        {sentTo && <div className="cu-box ok"><b>Check your new email to confirm</b><span>We sent a link to {sentTo}. Tap it to switch. Until then, keep signing in with {me.email}.</span></div>}
        {err && <p className="error">{err}</p>}
      </div>
      <Foot>{sentTo
        ? <button className="cu-btn green" onClick={onNext}>Got it · next</button>
        : <button className="cu-btn green" disabled={busy || !phoneOk || !emailOk || !hoodOk} onClick={save}>{busy ? 'Saving…' : !phoneOk ? 'Next · add your phone' : !hoodOk ? 'Next · add your neighbourhood' : 'Looks right · next'}</button>}</Foot>
    </>
  );
}

// ───────── 3 · Emergency contact (admin only) ─────────
export function EmergencyForm({ info, onSaved, onSkip, saveLabel = 'Next' }: { info: CheckupInfo; onSaved: () => void; onSkip?: () => void; saveLabel?: string }) {
  const [name, setName] = useState(info.emergency_name ?? '');
  const [rel, setRel] = useState(info.emergency_relation ?? '');
  const [phone, setPhone] = useState(info.emergency_phone ?? '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ok = name.trim().length >= 2 && !!rel && phone.replace(/\D/g, '').length >= 7;
  const save = async () => {
    setBusy(true); setErr('');
    const { error } = await saveMyProfile({ emergency_name: name.trim(), emergency_relation: rel, emergency_phone: phone.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    Object.assign(info, { emergency_name: name.trim(), emergency_relation: rel, emergency_phone: phone.trim() });
    onSaved();
  };
  return (
    <>
      <div className="cu-body">
        <label className="cu-f"><span>NAME</span><input value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder="Their full name" /></label>
        <div className="cu-f"><span>RELATION</span>
          <div className="cu-chips">{RELATIONS.map((r) => <button key={r} type="button" className={rel === r ? 'on' : ''} aria-pressed={rel === r} onClick={() => setRel(r)}>{rel === r && '✓ '}{r}</button>)}</div></div>
        <label className="cu-f"><span>PHONE</span><input type="tel" inputMode="tel" autoComplete="off" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(514) 555-0000" /></label>
        <p className="cu-note lock">Only Ronnie sees this. Never shown to managers or other staff.</p>
        {err && <p className="error">{err}</p>}
      </div>
      <Foot>
        <button className="cu-btn green" disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : saveLabel}</button>
        {onSkip && <button className="cu-skip" onClick={onSkip}><span>Skip for now</span><small>We’ll remind you on Home later</small></button>}
      </Foot>
    </>
  );
}
function EmergencyStep({ info, head, onNext }: { info: CheckupInfo; head: ReactNode; onNext: () => void }) {
  // Settings → Profile check-up: "Required" hides Skip for now (push 32)
  return <>{head}<EmergencyForm info={info} onSaved={onNext} onSkip={setting('checkup.emergency') === 'required' ? undefined : onNext} /></>;
}

// ───────── 4 · Languages (FR + EN only) ─────────
const LV: [number, string][] = [[1, 'Basic'], [2, 'Good'], [3, 'Fluent']];
function LangStep({ info, head, onNext }: { info: CheckupInfo; head: ReactNode; onNext: () => void }) {
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
        {([['fr', 'French'], ['en', 'English']] as const).map(([k, name]) => (
          <div key={k} className="cu-lang"><b>{name}</b>
            <div className="seg">{LV.map(([n, lab]) => <button key={n} type="button" className={l[k] === n ? 'on' : ''} aria-pressed={l[k] === n} onClick={() => setL({ ...l, [k]: n })}>{lab}</button>)}</div></div>
        ))}
        <p className="cu-note">Basic = a few words · Good = easy conversation · Fluent = no problem at all.</p>
        {err && <p className="error">{err}</p>}
      </div>
      <Foot><button className="cu-btn green" disabled={!ok || busy} onClick={save}>{busy ? 'Saving…' : ok ? 'Next' : 'Next · pick both'}</button></Foot>
    </>
  );
}

// ───────── 5 · Usual week (same as Availability) ─────────
function WeekStep({ me, head, onNext }: { me: Staff; head: ReactNode; onNext: () => void }) {
  const { week, setDay, loaded, err } = useUsualWeek(me.id);
  return (
    <>
      {head}
      <div className="cu-body">
        {loaded ? <UsualWeekList week={week} setDay={setDay} plural /> : <div className="card muted sm">Loading…</div>}
        {err && <p className="error">{err}</p>}
        <p className="cu-note">Same as My usual week in Availability. Already set? It shows here, just tap Next.</p>
      </div>
      <Foot><button className="cu-btn green" disabled={!loaded} onClick={onNext}>Next</button></Foot>
    </>
  );
}

// ───────── 6 · Home Screen ─────────
function HomeScreenStep({ head, onDone }: { head: ReactNode; onDone: () => void }) {
  const [os, setOs] = useState<'ios' | 'android'>(isAndroid() && !isIOS() ? 'android' : 'ios');
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force((x) => x + 1)), []);
  const inApp = isInAppBrowser();
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(window.location.origin); setCopied(true); } catch { setCopied(false); } };
  const install = async () => { if (await promptInstall()) { clearHomeSkip(); onDone(); } };
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
            <b>Open this page in {os === 'ios' ? 'Safari' : 'Chrome'} first</b>
            <span>You opened G&amp;R inside another app (WhatsApp, Instagram, Messenger…). Adding to the Home Screen only works from {os === 'ios' ? 'Safari' : 'Chrome'}.</span>
            {os === 'android' && <a className="cu-btn" href={chromeIntentUrl()}>Open in Chrome</a>}
            <button className="cu-btn line" onClick={copy}>{copied ? '✓ Link copied' : 'Copy the link'}</button>
            <span>{os === 'ios' ? 'Then open Safari, paste it in the address bar and come back to this step. Or tap ⋯ / the compass and choose “Open in Safari”.' : 'Or tap ⋮ and choose “Open in Chrome”, or paste the link in Chrome.'}</span>
          </div>
        )}
        {os === 'ios' ? (
          <ol className="cu-steps">
            <li><i>1</i><span>Tap <b>☰</b> in the address bar at the bottom</span><em><MenuIcon /></em></li>
            <li><i>2</i><span>Tap <b>Share</b></span><em><ShareIcon /></em></li>
            <li><i>3</i><span>Tap <b>View More</b> (the arrow)</span><em><ChevronIcon /></em></li>
            <li><i>4</i><span>Scroll down, tap <b className="red-out">Add to Home Screen</b></span><em><PlusSqIcon /></em></li>
            <li><i>5</i><span>Tap <b>Add</b>, then open <b>G&amp;R</b> from your Home Screen</span><em><img src="/apple-touch-icon.png" alt="" className="cu-app" /></em></li>
          </ol>
        ) : <>
          {canPromptInstall() && !inApp && <><button className="cu-btn big" onClick={install}><PlusIcon /> Install G&amp;R</button><p className="cu-note">Most Android phones: one tap, then <b>Install</b>.</p></>}
          <div className="cu-kick" style={{ marginTop: 6 }}>{canPromptInstall() && !inApp ? 'NO BUTTON? DO IT BY HAND' : 'DO IT BY HAND'}</div>
          <ol className="cu-steps">
            <li><i>1</i><span>Tap <b>⋮</b> at the top right of Chrome</span><em><DotsIcon /></em></li>
            <li><i>2</i><span>Tap <b>Add to Home screen</b> (or <b>Install app</b>)</span><em><PlusIcon /></em></li>
            <li><i>3</i><span>Tap <b>Install</b> / <b>Add</b>, then open <b>G&amp;R</b> from your Home screen</span><em><img src="/icon-192.png" alt="" className="cu-app" /></em></li>
          </ol>
        </>}
      </div>
      <Foot>
        <button className="cu-btn green" onClick={() => { clearHomeSkip(); onDone(); }}>Done · I added it</button>
        {setting('checkup.home_screen') !== 'required' && <button className="cu-skip" onClick={() => { setHomeSkip(); onDone(); }}><span>Skip for now</span></button>}
      </Foot>
    </>
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
const DotsIcon = () => <svg {...sv}><circle cx="12" cy="5" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="19" r="1.2" fill="currentColor" /></svg>;
const AppleIcon = () => <svg {...sv} width={14} height={14}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>;
const DroidIcon = () => <svg {...sv} width={14} height={14}><path d="M6 10a6 6 0 0 1 12 0v8H6z" /><path d="M8 4l1.5 2.5M16 4l-1.5 2.5" /><circle cx="10" cy="11" r=".6" fill="currentColor" /><circle cx="14" cy="11" r=".6" fill="currentColor" /></svg>;
