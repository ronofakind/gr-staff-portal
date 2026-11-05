import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Staff } from './lib/supabase';
import { LangContext, type Lang } from './lib/i18n';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Shift } from './pages/Shift';
import { AdminLayout, More } from './admin/AdminLayout';
import { Today } from './admin/Today';
import { Hours } from './admin/Hours';
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
    .then(({ data }) => setMe((data as Staff) ?? null));
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
        {me.role === 'admin' && (
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Today />} />
            <Route path="week" element={<Calendar view="week" />} />
            <Route path="month" element={<Calendar view="month" />} />
            <Route path="calendar" element={<CalendarRedirect />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="messages" element={<Messages />} />
            <Route path="hours" element={<Hours />} />
            <Route path="reliability" element={<Reliability />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="more" element={<More />} />
            <Route path="day" element={<Calendar view="day" />} />
            <Route path="event/new" element={<EventForm />} />
            <Route path="event/:id" element={<EventDetail />} />
            <Route path="event/:id/edit" element={<EventForm />} />
            <Route path="event/:id/change" element={<ClientChange />} />
            <Route path="free" element={<Free />} />
            <Route path="staff" element={<StaffAdmin />} />
            <Route path="availability" element={<AdminAvail />} />
            <Route path="tiers" element={<TiersRanking tab="tiers" />} />
            <Route path="ranking" element={<TiersRanking tab="ranking" />} />
            <Route path="extras/:id" element={<Extras />} />
            <Route path="venues" element={<Venues />} />
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
        <Route path="/meeting/:id" element={<Meeting />} />
        <Route path="/hours" element={<HoursPage me={me} />} />
        <Route path="/availability" element={<StaffAvail me={me} />} />
        <Route path="/manage/:eventId" element={<Manage me={me} />} />
        <Route path="/manage/:eventId/messages" element={<MgrMessages me={me} />} />
        <Route path="/messages" element={<StaffMessages me={me} />} />
        <Route path="/profile" element={<Profile me={me} />} />
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
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 20px', lineHeight: 1.6 }}>
      <h1 className="serif">{kind === 'privacy' ? 'Privacy' : 'Terms of use'}</h1>
      {kind === 'privacy'
        ? <p>The G&amp;R Staff App is an internal tool of G&amp;R à votre service, used only by our staff and managers to schedule events and record hours. We keep the information needed for that (name, contact details, availability, shifts and hours) and do not sell or share it. When the owner connects Google Drive, the app uses that access only to create and list event folders in the company’s own Drive. Questions or requests to delete your data: rjladores@gmail.com.</p>
        : <p>The G&amp;R Staff App is for the staff, managers and owners of G&amp;R à votre service only. Use it to see your shifts, give your availability and record your hours accurately; do not share your access with anyone. The app is provided as is and may change at any time. Questions: rjladores@gmail.com.</p>}
    </div>
  );
}
