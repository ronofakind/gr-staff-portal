import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { uploadPhoto } from '../lib/photo';
import { PhotoPicker } from '../components/Avatar';

export function Profile({ me }: { me: Staff }) {
  const [url, setUrl] = useState(me.photo_url);
  const [msg, setMsg] = useState('');
  const pick = async (f: File) => {
    setMsg('Uploading…');
    try { setUrl(await uploadPhoto(me.id, f)); setMsg('Saved. Your manager will see this photo.'); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <main className="page">
      <header className="top"><Link to="/" className="icon-btn" aria-label="Back">‹</Link><h1>My profile</h1></header>
      <section className="card stack center">
        <PhotoPicker name={me.full_name} url={url} onPick={pick} size={120} />
        <div className="h2">{me.full_name}</div>
        <p className="hint">Use a clear photo of your face so your manager can find you on site.</p>
        {msg && <p className="sm">{msg}</p>}
      </section>
      <button className="btn" onClick={() => supabase.auth.signOut()}>Log out</button>
    </main>
  );
}
