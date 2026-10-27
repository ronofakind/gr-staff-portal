import { useEffect, useState } from 'react';
import { Link, Route, Routes, useParams } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { LangContext } from '../lib/i18n';
import { Home } from '../pages/Home';
import { Shift } from '../pages/Shift';

/** Admin preview: the staff app exactly as this person sees it. Read-only. */
export function ViewAs() {
  const { staffId } = useParams();
  const [who, setWho] = useState<Staff | null>(null);
  useEffect(() => {
    supabase.from('staff').select('id,full_name,email,phone,language,role,photo_url').eq('id', staffId!).single()
      .then(({ data }) => setWho(data as Staff));
  }, [staffId]);
  if (!who) return <div className="loading" />;
  const base = `/admin/view/${who.id}`;
  return (
    <LangContext.Provider value={who.language}>
      <div className="preview-bar">
        <span>Viewing as <b>{who.full_name}</b> · read-only</span>
        <Link to="/admin/staff" className="btn sm">Exit</Link>
      </div>
      <div className="preview-phone">
        <Routes>
          <Route index element={<Home me={who} base={base} preview />} />
          <Route path="shift/:id" element={<Shift backTo={base} />} />
        </Routes>
      </div>
    </LangContext.Provider>
  );
}
