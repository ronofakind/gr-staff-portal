import { Bottles } from './admin/Bottles';
import { loadTheme } from './lib/theme';
import { ConnectClaude } from './pages/ConnectClaude';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Staff } from './lib/supabase';
import { LangContext, type Lang } from './lib/i18n';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Shift } from './pages/Shift';
import { AdminLayout, More } from './admin/AdminLayout';
import { Today } from './admin/Today';
import { Debriefs } from './admin/Debriefs';
import { Rates } from './admin/Rates';
import { DayPool } from './admin/DayPool';
import { DaySheet } from './admin/DaySheet';
import { DeleteAccountPublic } from './pages/DeleteAccount';
import { Apply } from './pages/Apply';
import { Hiring } from './admin/Hiring';
import { Handbook } from './pages/Handbook';
import { TaxPay } from './pages/TaxPay';
import { Hours } from './admin/Hours';
import { Payroll } from './admin/Payroll';
import { Reliability } from './admin/Reliability';
import { Calendar, CalendarRedirect } from './admin/Calendar';
import { EventForm } from './admin/EventForm';
import { EventDetail } from './admin/EventDetail';
import { Free } from './admin/Free';
import { Staff as StaffAdmin } from './admin/Staff';
import { ViewAs } from './admin/ViewAs';
import { Manage } from './pages/Manage';
import { Profile } from './pages/Profile';
import { MyDates } from './pages/MyDates';
import { Availability as StaffAvail } from './pages/Availability';
import { EventPlan } from './pages/EventPlan';
import { BarCount } from './pages/BarCount';
import { Availability as AdminAvail } from './admin/Availability';
import { TiersRanking } from './admin/TiersRanking';
import { ClientChange } from './admin/ClientChange';
import { Incidents } from './admin/Incidents';
import { Bookings } from './admin/Bookings';
import { Messages } from './admin/Messages';
import { Hours as HoursPage } from './pages/Hours';
import { Extras } from './admin/Extras';
import { Checkup, HomeScreenAgain, CalendarAgain } from './pages/Checkup';
import { loadMyCalendar, type MyCal } from './lib/calendar';
import { CheckupContext, loadCheckup, type CheckupInfo } from './lib/checkup';
import { homeStepDue } from './lib/install';
import { loadSettings, onSettings } from './lib/settings';
import { Venues } from './admin/Venues';
import { Settings } from './admin/Settings';
import { Go } from './pages/Go';
import { Messages as StaffMessages } from './pages/Messages';
import { MgrMessages } from './pages/MgrMessages';
import { Meeting } from './pages/Meeting';
import { Meetings, MeetingForm, MeetingAdmin } from './admin/Meetings';
import { AdminTeamChat } from './admin/TeamChatCard';
import { AlertLayer } from './components/Alerts';
import { startAlerts } from './lib/alerts';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Staff | null | undefined>(undefined);
  const lang: Lang = 'en'; // English only for now; French is ready in i18n.ts
  // push 31 · profile check-up gate. undefined = loading, null = unknown (RPC missing) → never blocks.
  const [checkup, setCheckup] = useState<CheckupInfo | null | undefined>(undefined);
  const [homeAgain, setHomeAgain] = useState(homeStepDue);
  // push 33h · finished the check-up before the calendar step existed → "ONE MORE THING" once (not admins, not once added)
  const [calAgain, setCalAgain] = useState<MyCal | null>(null);
  const calChecked = useRef(false);
  // push 32 · app settings: re-render the tree when they arrive / change (plain functions read the cache).
  const [, setSettingsV] = useState(0);
  useEffect(() => onSettings(() => setSettingsV((n) => n + 1)), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadMe = (uid: string) => supabase.from('staff').select('id,full_name,nickname,email,phone,language,role,photo_url')
    .eq('auth_user_id', uid).maybeSingle()
    .then(({ data }) => { setMe((data as Staff) ?? null); if (data) loadTheme((data as Staff).id, (data as Staff).role === 'admin'); });
  const sessionUid = session?.user.id ?? (session === null ? null : undefined);
  useEffect(() => {
    if (!session) { setMe(session === null ? null : undefined); return; }
    loadMe(session.user.id);
  }, [sessionUid]); // token refreshes don't reload the profile (or re-open the gate)
  useEffect(() => { if (sessionUid !== undefined) loadSettings(true); }, [sessionUid]); // RLS decides which keys come back
  const meId = me?.id;
  useEffect(() => {
    if (!meId) { setCheckup(undefined); return; }
    loadCheckup().then(setCheckup);
    supabase.rpc('touch_last_seen').then(() => {}, () => {}); // "last opened" for the admin check-up tracker
    if (me) startAlerts(me.role); // push 42 · send what's waiting on open / after writes, app icon number, keep this phone's alerts current
  }, [meId]);

  useEffect(() => {
    // Only for people already done when the app opened (someone finishing now just saw the step inside the check-up).
    if (checkup === undefined || calChecked.current || !me) return;
    calChecked.current = true;
    if (!checkup?.done_at || me.role === 'admin') return;
    loadMyCalendar().then((c) => { if (c && !c.added_at && !c.prompt_seen_at) setCalAgain(c); });
  }, [checkup, me]);

  const legal = window.location.pathname.replace(/\/$/, '');
  if (legal === '/privacy' || legal === '/terms') return <Legal kind={legal.slice(1) as 'privacy' | 'terms'} />;
  if (legal === '/apply' || legal === '/postuler') return <Apply />; // push 55 · public, signed in or not
  if (legal === '/delete-account') return <DeleteAccountPublic />; // Nov 9 · store rule: request deletion without the app
  // push 34b · personal invite link: its own screen, signed in or not (it signs them in at the end, then goes to '/')
  const go = /^\/go\/([A-Za-z0-9_-]{10,64})$/.exec(legal);
  if (go) return <LangContext.Provider value={lang}>{session === undefined ? <div className="loading" /> : <Go token={go[1]} />}</LangContext.Provider>;
  if (session === undefined || (session && me === undefined) || (me && checkup === undefined)) return <div className="loading" />;

  let body: JSX.Element;
  if (!session) body = <Login />;
  else if (localStorage.getItem('gr_needs_pin')) body = <Login mustSetPin />;
  else if (!me) body = <NotStaff lang={lang} />;
  // Every route goes through the check-up until it's done (Log out is on every step).
  else if (checkup && !checkup.done_at) body = <Checkup me={me} info={checkup} onFinish={() => { loadMe(session.user.id); loadCheckup().then(setCheckup); }} />;
  else if (homeAgain) body = <HomeScreenAgain onClose={() => setHomeAgain(false)} />;
  else if (calAgain) body = <CalendarAgain me={me} cal={calAgain} onClose={() => setCalAgain(null)} />;
  else body = (
    <BrowserRouter>
      <AlertLayer />
      <Routes>
        <Route path="/" element={me.role === 'admin' ? <Navigate to="/admin" /> : <Home me={me} />} />
        <Route path="/me" element={<Home me={me} />} />
        {me.role === 'admin' && <Route path="/connect-claude" element={<ConnectClaude />} />}
        {me.role === 'admin' && (
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Today />} />
            <Route path="week" element={<Calendar view="week" />} />
            <Route path="month" element={<Calendar view="month" />} />
            <Route path="calendar" element={<CalendarRedirect />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="messages" element={<Messages />} />
            <Route path="hours" element={<Hours />} />
            <Route path="payroll" element={<Payroll />} />
            <Route path="reliability" element={<Reliability />} />
            <Route path="debriefs" element={<Debriefs />} />
            <Route path="rates" element={<Rates />} />
            <Route path="hiring" element={<Hiring />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="more" element={<More />} />
            <Route path="day" element={<Calendar view="day" />} />
            <Route path="event/new" element={<EventForm />} />
            <Route path="event/:id" element={<EventDetail />} />
            <Route path="pool/:date" element={<DayPool />} />{/* push 97 */}
            <Route path="day-sheet/:date" element={<DaySheet />} />{/* push 108 */}
            <Route path="event/:id/edit" element={<EventForm />} />
            <Route path="event/:id/change" element={<ClientChange />} />
            <Route path="free" element={<Free />} />
            <Route path="staff" element={<StaffAdmin />} />
            <Route path="availability" element={<AdminAvail />} />
            <Route path="tiers" element={<TiersRanking tab="tiers" />} />
            <Route path="ranking" element={<TiersRanking tab="ranking" />} />
            <Route path="extras/:id" element={<Extras />} />
            <Route path="venues" element={<Venues />} />
            <Route path="bottles" element={<Bottles />} />
            <Route path="settings" element={<Settings />} />
            <Route path="meetings" element={<Meetings />} />
            <Route path="meeting/new" element={<MeetingForm />} />
            <Route path="meeting/:id" element={<MeetingAdmin />} />
            <Route path="meeting/:id/edit" element={<MeetingForm />} />
            <Route path="team-chat/:id" element={<AdminTeamChat />} />
          </Route>
        )}
        {me.role === 'admin' && <Route path="/admin/view/:staffId/*" element={<ViewAs />} />}
        <Route path="/my-dates" element={<MyDates me={me} />} />
        <Route path="/schedule" element={<Navigate to="/my-dates" replace />} />{/* push 35a · old Schedule tab */}
        <Route path="/shift/:id" element={<Shift />} />
        <Route path="/shift/:id/plan" element={<EventPlan />} />
        <Route path="/bar/:eventId" element={<BarCount />} />
        <Route path="/meeting/:id" element={<Meeting />} />
        <Route path="/hours" element={<HoursPage me={me} />} />
        <Route path="/availability" element={<StaffAvail me={me} />} />
        <Route path="/manage/:eventId" element={<Manage me={me} />} />
        <Route path="/manage/:eventId/messages" element={<MgrMessages me={me} />} />
        <Route path="/messages" element={<StaffMessages me={me} />} />
        <Route path="/profile" element={<Profile me={me} />} />
        <Route path="/handbook" element={<Handbook me={me} />} />
        <Route path="/tax" element={<TaxPay me={me} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );

  return <LangContext.Provider value={lang}><CheckupContext.Provider value={{ info: checkup ?? null, reload: () => loadCheckup().then(setCheckup) }}>{body}</CheckupContext.Provider></LangContext.Provider>;
}

function NotStaff({ lang }: { lang: Lang }) {
  return (
    <main className="login">
      <img src="/logo-mark.png" alt="G&R" className="login-logo mark" />
      <div className="card stack">
        <p>{lang === 'fr' ? "Ce courriel n'est pas dans l'équipe G&R. Parle à Ronnie." : "This email isn't on the G&R team. Talk to Ronnie."}</p>
        <button className="btn" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>{lang === 'fr' ? 'Déconnexion' : 'Log out'}</button>
      </div>
    </main>
  );
}

function Legal({ kind }: { kind: 'privacy' | 'terms' }) {
  const S = ({ t, children }: { t: string; children: ReactNode }) => <><h2 className="serif" style={{ fontSize: 20, margin: '26px 0 6px' }}>{t}</h2>{children}</>;
  if (kind === 'terms') return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px', lineHeight: 1.6 }}>
      <h1 className="serif">Terms of use</h1>
      <p>The G&amp;R Staff App is for the staff, managers and owners of G&amp;R à votre service only. Use it to see your shifts, give your availability and record your hours accurately; do not share your access with anyone. The app is provided as is and may change at any time. Questions: gravotreservice@gmail.com.</p>
    </div>
  );
  // Nov 9 · full privacy page (Google Play / App Store: must say what is collected, why, who sees it, how long, how to delete)
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px 60px', lineHeight: 1.6 }}>
      <img src="/logo-full.png" alt="G&amp;R à votre service" style={{ height: 56, display: 'block', margin: '0 auto 18px', mixBlendMode: 'multiply' }} />
      <h1 className="serif" style={{ marginBottom: 4 }}>Privacy</h1>
      <p style={{ marginTop: 0, color: 'var(--muted)' }}>G&amp;R Staff app · G&amp;R à votre service, Montréal · updated November 9, 2026</p>
      <p>The G&amp;R Staff app is the private work app of G&amp;R à votre service, an event staffing company in Montréal. Only people who work with us (staff, managers and the owners) can sign in. This page explains what the app keeps about you, why, who can see it, and how to have it deleted.</p>
      <S t="What we collect and why">
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li><b>Your name, nickname, email and phone</b>: to sign you in, book you and reach you about your shifts.</li>
          <li><b>Your photo</b>: so your manager and team recognise you on the night.</li>
          <li><b>Your availability, shifts, check-in and end times, and hours</b>: to schedule events and pay you correctly.</li>
          <li><b>Your messages</b> with the office and your team: to answer questions and organise each event.</li>
          <li><b>Your emergency contact and neighbourhood</b> (optional): in case something happens at work, and to plan rides to far events.</li>
          <li><b>Your sizes, languages and transport</b>: for uniforms, client needs and getting to events.</li>
          <li><b>Pay and tax details</b>: legal name, date of birth, address, social insurance number (SIN), how you want to be paid, and a photo of a void cheque or your PayPal email. Used only to pay you and to prepare your tax slips.</li>
          <li><b>Basic technical data</b>: when you last opened the app and, if you turn them on, the codes that let us send you phone notifications.</li>
        </ul>
        <p>We don’t use your location, we don’t track you on other apps or websites, and the app has no ads.</p>
      </S>
      <S t="Who can see it">
        <p style={{ margin: 0 }}>The owners (Ronnie and Georges) can see everything. Managers only see, for their own team on the night: name, photo, position, start and end times and notes about the shift. Other staff only see the names and photos of people on the same event. Pay and tax details, your SIN, your emergency contact and your ratings are never shown to managers or other staff.</p>
        <p>We do not sell or rent your information, and we don’t share it with anyone outside G&amp;R, except when the law requires it (for example tax slips sent to the government).</p>
      </S>
      <S t="Where it’s kept">
        <p style={{ margin: 0 }}>The app runs on Vercel and stores its data with Supabase, both in North America. Everything travels encrypted (HTTPS) and access is limited by account. Sign-in codes are never stored in a readable form.</p>
      </S>
      <S t="How long we keep it">
        <p style={{ margin: 0 }}>While you work with us. When your account is deleted, your sign-in and personal information are deleted. Hours, pay and tax records are kept for 6 years, as Canadian and Québec tax law requires, then deleted.</p>
      </S>
      <S t="Deleting your account">
        <p style={{ margin: 0 }}>In the app: Profile → Delete my account. Without the app: <a href="/delete-account">gr-staff-portal.vercel.app/delete-account</a>. We confirm within 30 days. You can also ask us to see or correct what we hold about you.</p>
      </S>
      <S t="Contact">
        <p style={{ margin: 0 }}>G&amp;R à votre service · Montréal, Québec · <a href="mailto:gravotreservice@gmail.com">gravotreservice@gmail.com</a></p>
      </S>
    </div>
  );
}
