import { useEffect, useState } from 'react';
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
import { Week } from './admin/Week';
import { Day } from './admin/Day';
import { EventForm } from './admin/EventForm';
import { EventDetail } from './admin/EventDetail';
import { Free } from './admin/Free';
import { Staff as StaffAdmin } from './admin/Staff';
import { ViewAs } from './admin/ViewAs';
import { Manage } from './pages/Manage';
import { Profile } from './pages/Profile';
import { Schedule } from './pages/Schedule';
import { Availability as StaffAvail } from './pages/Availability';
import { EventPlan } from './pages/EventPlan';
import { Availability as AdminAvail } from './admin/Availability';
import { Tiers } from './admin/Tiers';
import { Incidents } from './admin/Incidents';
import { Bookings } from './admin/Bookings';
import { Hours as HoursPage } from './pages/Hours';

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Staff | null | undefined>(undefined);
  const lang: Lang = 'en'; // English only for now; French is ready in i18n.ts

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMe(session === null ? null : undefined); return; }
    supabase.from('staff').select('id,full_name,nickname,email,phone,language,role,photo_url')
      .eq('auth_user_id', session.user.id).maybeSingle()
      .then(({ data }) => setMe((data as Staff) ?? null));
  }, [session]);

  const legal = window.location.pathname.replace(/\/$/, '');
  if (legal === '/privacy' || legal === '/terms') return <Legal kind={legal.slice(1) as 'privacy' | 'terms'} />;
  if (session === undefined || (session && me === undefined)) return <div className="loading" />;

  let body: JSX.Element;
  if (!session) body = <Login />;
  else if (localStorage.getItem('gr_needs_pin')) body = <Login mustSetPin />;
  else if (!me) body = <NotStaff lang={lang} />;
  else body = (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={me.role === 'admin' ? <Navigate to="/admin" /> : <Home me={me} />} />
        <Route path="/me" element={<Home me={me} />} />
        {me.role === 'admin' && (
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Today />} />
            <Route path="week" element={<Week />} />
            <Route path="bookings" element={<Bookings />} />
            <Route path="hours" element={<Hours />} />
            <Route path="reliability" element={<Reliability />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="more" element={<More />} />
            <Route path="day" element={<Day />} />
            <Route path="event/new" element={<EventForm />} />
            <Route path="event/:id" element={<EventDetail />} />
            <Route path="event/:id/edit" element={<EventForm />} />
            <Route path="free" element={<Free />} />
            <Route path="staff" element={<StaffAdmin />} />
            <Route path="availability" element={<AdminAvail />} />
            <Route path="tiers" element={<Tiers />} />
          </Route>
        )}
        {me.role === 'admin' && <Route path="/admin/view/:staffId/*" element={<ViewAs />} />}
        <Route path="/schedule" element={<Schedule me={me} />} />
        <Route path="/shift/:id" element={<Shift />} />
        <Route path="/shift/:id/plan" element={<EventPlan />} />
        <Route path="/hours" element={<HoursPage me={me} />} />
        <Route path="/availability" element={<StaffAvail me={me} />} />
        <Route path="/manage/:eventId" element={<Manage />} />
        <Route path="/profile" element={<Profile me={me} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );

  return <LangContext.Provider value={lang}>{body}</LangContext.Provider>;
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
