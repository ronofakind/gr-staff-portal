import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Staff } from './lib/supabase';
import { LangContext, type Lang } from './lib/i18n';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Shift } from './pages/Shift';
import { AdminLayout } from './admin/AdminLayout';
import { Week } from './admin/Week';
import { Day } from './admin/Day';
import { EventForm } from './admin/EventForm';
import { Staff as StaffAdmin } from './admin/Staff';
import { ViewAs } from './admin/ViewAs';
import { Manage } from './pages/Manage';
import { Profile } from './pages/Profile';

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
    supabase.from('staff').select('id,full_name,email,phone,language,role,photo_url')
      .eq('auth_user_id', session.user.id).maybeSingle()
      .then(({ data }) => setMe((data as Staff) ?? null));
  }, [session]);

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
            <Route index element={<Week />} />
            <Route path="day" element={<Day />} />
            <Route path="event/:id" element={<EventForm />} />
            <Route path="staff" element={<StaffAdmin />} />
          </Route>
        )}
        {me.role === 'admin' && <Route path="/admin/view/:staffId/*" element={<ViewAs />} />}
        <Route path="/shift/:id" element={<Shift />} />
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
      <img src="/logo-full.png" alt="G&R à votre service" className="login-logo" />
      <div className="card stack">
        <p>{lang === 'fr' ? "Ce courriel n'est pas dans l'équipe G&R. Parle à Ronnie." : "This email isn't on the G&R team. Talk to Ronnie."}</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>{lang === 'fr' ? 'Déconnexion' : 'Log out'}</button>
      </div>
    </main>
  );
}
