import { useEffect, useState } from 'react';
import { supabase, type Staff } from '../lib/supabase';
import { uploadPhoto } from '../lib/photo';
import { PhotoPicker } from '../components/Avatar';
import { TabBar } from '../components/TabBar';

type Extra = { transport: string | null; positions: string[] | null; shirt_size: string | null; pants_size: string | null; dress_size: string | null };
const POSITIONS = ['Waiter', 'Bartender', 'Barback'];
const SHIRT = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const PANTS = ['28', '30', '32', '34', '36', '38', '40', '42'];
const DRESS = ['0', '2', '4', '6', '8', '10', '12', '14', '16'];

export function Profile({ me }: { me: Staff }) {
  const [url, setUrl] = useState(me.photo_url);
  const [x, setX] = useState<Extra | null>(null);
  const [msg, setMsg] = useState('');
  const [edit, setEdit] = useState<null | 'phone' | 'pin'>(null);
  const [phone, setPhone] = useState(me.phone ?? '');

  useEffect(() => {
    supabase.from('staff').select('transport,positions,shirt_size,pants_size,dress_size').eq('id', me.id).single()
      .then(({ data }) => setX((data as Extra) ?? { transport: null, positions: [], shirt_size: null, pants_size: null, dress_size: null }));
  }, [me.id]);

  const save = async (patch: Partial<Extra>) => {
    setX((p) => ({ ...(p as Extra), ...patch }));
    setMsg('Saving…');
    const { error } = await supabase.from('staff').update(patch).eq('id', me.id);
    setMsg(error ? error.message : '✓ Saved');
  };
  const pick = async (f: File) => {
    setMsg('Uploading…');
    try { setUrl(await uploadPhoto(me.id, f)); setMsg('✓ Saved'); } catch (e) { setMsg((e as Error).message); }
  };
  const pos = x?.positions ?? [];
  const has = (p: string) => pos.some((q) => q.toLowerCase() === p.toLowerCase());

  return (
    <main className="page v2">
      <div className="spread" style={{ alignItems: 'center', padding: '12px 4px 0' }}>
        <span className="serif" style={{ fontSize: 30 }}>My profile</span>
        <span className="sm strong" style={{ color: msg.startsWith('✓') ? 'var(--ok)' : 'var(--muted)' }}>{msg}</span>
      </div>

      <section className="card row" style={{ gap: 16 }}>
        <PhotoPicker name={me.full_name} url={url} onPick={pick} size={84} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{me.full_name}</div>
          <div className="muted sm">{me.role === 'manager' ? 'Manager' : me.role === 'admin' ? 'Admin' : 'Staff'}</div>
        </div>
      </section>

      <div className="sec-head"><span className="serif">Contact &amp; login</span></div>
      <section className="sizes">
        <div className="size-row"><span className="muted sm" style={{ width: 70 }}>Email</span><span className="grow strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.email}</span></div>
        <button className="size-row edit-row" onClick={() => setEdit('phone')}><span className="muted sm" style={{ width: 70 }}>Phone</span><span className="grow strong">{phone || '—'}</span><span className="strong sm">Edit ›</span></button>
        <button className="size-row edit-row" onClick={() => setEdit('pin')}><span className="muted sm" style={{ width: 70 }}>PIN</span><span className="grow strong">••••••</span><span className="strong sm">Change ›</span></button>
      </section>

      {x && <>
        <div className="sec-head"><span className="serif">How I get to events</span></div>
        <div className="row2" style={{ gap: 10 }}>
          {(['car', 'transit'] as const).map((t) => (
            <button key={t} className={'opt-big' + (x.transport === t ? ' on' : '')} onClick={() => save({ transport: t })}>
              {t === 'car'
                ? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 17h14v-5l-2-5H7l-2 5z" /><path d="M3 12h18" /><circle cx="7.5" cy="17" r="1.8" /><circle cx="16.5" cy="17" r="1.8" /></svg>
                : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="15" rx="3" /><path d="M5 11h14M9 21l1-3M15 21l-1-3" /><circle cx="8.5" cy="14.5" r="1" /><circle cx="15.5" cy="14.5" r="1" /></svg>}
              {t === 'car' ? 'Car' : 'Transit'}
            </button>
          ))}
        </div>

        <div className="sec-head"><span className="serif">Positions I can work</span><span className="muted sm">Pick all that apply</span></div>
        <div className="chips">
          {POSITIONS.map((p) => (
            <button key={p} className={'bubble' + (has(p) ? ' on' : '')}
              onClick={() => save({ positions: has(p) ? pos.filter((q) => q.toLowerCase() !== p.toLowerCase()) : [...pos, p] })}>
              {has(p) && '✓ '}{p}
            </button>
          ))}
        </div>

        <div className="sec-head"><span className="serif">Uniform sizes</span></div>
        <section className="sizes">
          <SizeRow label="Shirt" value={x.shirt_size} options={SHIRT} onChange={(v) => save({ shirt_size: v })} />
          <SizeRow label="Pants (waist)" value={x.pants_size} options={PANTS} onChange={(v) => save({ pants_size: v })} />
          <SizeRow label="Dress" value={x.dress_size} options={DRESS} none="Not needed" onChange={(v) => save({ dress_size: v })} />
        </section>
      </>}

      <button className="btn" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>Log out</button>
      <TabBar />
      {edit && <EditSheet kind={edit} me={me} phone={phone} onClose={() => setEdit(null)} onPhone={(v) => { setPhone(v); setMsg('✓ Saved'); }} />}
    </main>
  );
}

function SizeRow({ label, value, options, onChange, none = 'Choose' }: { label: string; value: string | null; options: string[]; onChange: (v: string | null) => void; none?: string }) {
  return (
    <label className="size-row">
      <span>{label}</span>
      <span className={'size-val' + (value ? '' : ' empty')}>
        {value ?? none}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9A9187" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
        <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{none}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </span>
    </label>
  );
}

function EditSheet({ kind, me, phone, onClose, onPhone }: { kind: 'phone' | 'pin'; me: Staff; phone: string; onClose: () => void; onPhone: (v: string) => void }) {
  const [v, setV] = useState(kind === 'phone' ? phone : '');
  const [cur, setCur] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const digits = (t: string) => t.replace(/\D/g, '').slice(0, 6);
  const savePhone = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('staff').update({ phone: v.trim() || null }).eq('id', me.id);
    setBusy(false); if (error) return setErr(error.message);
    onPhone(v.trim()); onClose();
  };
  const savePin = async () => {
    setBusy(true); setErr('');
    const chk = await supabase.auth.signInWithPassword({ email: me.email!, password: cur });
    if (chk.error) { setBusy(false); return setErr('Current PIN is wrong.'); }
    const { error } = await supabase.auth.updateUser({ password: n1 });
    setBusy(false); if (error) return setErr(error.message);
    setDone(true);
  };
  const pinOk = cur.length === 6 && n1.length === 6 && n1 === n2;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={kind === 'phone' ? 'Edit phone' : 'Change PIN'}>
        <div className="grab" />
        <div className="spread" style={{ alignItems: 'center' }}><span className="serif" style={{ fontSize: 24 }}>{kind === 'phone' ? 'Phone number' : 'Change PIN'}</span><button className="btn link" onClick={onClose}>Cancel</button></div>
        {kind === 'phone' ? <>
          <input className="sheet-input" type="tel" inputMode="tel" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="(514) 555-0000" />
          <button className="btn-ink" disabled={busy} onClick={savePhone}>{busy ? 'Saving…' : 'Save'}</button>
        </> : done ? <>
          <p className="body">✓ Your new PIN is saved. Use it next time you log in.</p>
          <button className="btn-ink" onClick={onClose}>Done</button>
        </> : <>
          <label className="pin-field">Current PIN<input inputMode="numeric" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(digits(e.target.value))} /></label>
          <label className="pin-field">New PIN<input inputMode="numeric" type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(digits(e.target.value))} /></label>
          <label className="pin-field">Confirm new PIN<input inputMode="numeric" type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(digits(e.target.value))} /></label>
          {n2.length === 6 && n1 !== n2 && <p className="error">The new PINs don't match.</p>}
          <button className="btn-ink" disabled={!pinOk || busy} style={{ opacity: pinOk ? 1 : 0.45 }} onClick={savePin}>{busy ? 'Saving…' : 'Save new PIN'}</button>
        </>}
        {err && <p className="error">{err}</p>}
      </div>
    </>
  );
}
