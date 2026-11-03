import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { setting } from '../lib/settings';
import { uploadPhoto } from '../lib/photo';
import { PhotoPicker } from '../components/Avatar';
import { TabBar } from '../components/TabBar';
import { SwipeSheet } from '../components/SwipeSheet';
import { LenSeg } from '../components/PinPad';
import { pinPassword, resolvePinLen, saveMyPinLen, type PinLen } from '../lib/pin';
import { NICK_ERROR, cleanNick, nickState } from '../lib/nickname';
import { useMyCalendar } from '../lib/calendar';
import { CalendarBody, EmergencyForm } from './Checkup';
import { useCheckup, setEmergencyReminder } from '../lib/checkup';
import { AlertsProfileRow } from '../components/Alerts';

type Extra = { transport: string | null; positions: string[] | null; shirt_size: string | null; pants_size: string | null; dress_size: string | null };
const POSITIONS = ['Waiter', 'Bartender', 'Barback'];
const SHIRT = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const PANTS = ['28', '30', '32', '34', '36', '38', '40', '42'];
const DRESS = ['0', '2', '4', '6', '8', '10', '12', '14', '16'];

export function Profile({ me }: { me: Staff }) {
  const [url, setUrl] = useState(me.photo_url);
  const [x, setX] = useState<Extra | null>(null);
  const [msg, setMsg] = useState('');
  // push 35a · the photo menu opens these directly: /profile?open=pin · /profile?open=cal
  const [params, setParams] = useSearchParams(); const opening = params.get('open');
  const [edit, setEdit] = useState<null | 'phone' | 'pin'>(opening === 'pin' ? 'pin' : null);
  const [nick, setNick] = useState(me.nickname ?? null); const [nickOpen, setNickOpen] = useState(false); // push 33d
  const { cal, setCal } = useMyCalendar(); const [calOpen, setCalOpen] = useState(opening === 'cal'); // push 33b
  useEffect(() => { if (opening) setParams((p) => { p.delete('open'); return p; }, { replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [phone, setPhone] = useState(me.phone ?? '');
  const { info: cu, reload: reloadCu } = useCheckup(); const [emOpen, setEmOpen] = useState(false);
  const [pinLen, setPinLen] = useState<PinLen | null>(null);
  useEffect(() => { if (me.email) resolvePinLen(me.email).then((r) => setPinLen(r.known ? r.len : null)); }, [me.email]);

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

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ gap: 16 }}>
          <PhotoPicker name={me.full_name} url={url} onPick={pick} size={84} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{me.full_name}</div>
            <div className="muted sm">{me.role === 'manager' ? 'Manager' : me.role === 'admin' ? 'Admin' : 'Staff'}</div>
          </div>
        </div>
        <button className="nick-row" onClick={() => setNickOpen(true)}>
          <span className="grow"><small>Name we call you (optional)</small><b>{nick || me.full_name.split(' ')[0]}</b></span><span className="strong sm">Edit ›</span>
        </button>
      </section>

      <div className="sec-head"><span className="serif">Contact &amp; login</span></div>
      <section className="sizes">
        <div className="size-row"><span className="muted sm" style={{ width: 70 }}>Email</span><span className="grow strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.email}</span></div>
        <button className="size-row edit-row" onClick={() => setEdit('phone')}><span className="muted sm" style={{ width: 70 }}>Phone</span><span className="grow strong">{phone || '—'}</span><span className="strong sm">Edit ›</span></button>
        {me.role !== 'admin' && cu && <button className="size-row edit-row" onClick={() => setEmOpen(true)}><span className="muted sm" style={{ width: 70 }}>Emergency</span><span className="grow strong" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cu.emergency_phone ? `${cu.emergency_name ?? ''}${cu.emergency_relation ? ` · ${cu.emergency_relation}` : ''}` : <span className="muted">Not added</span>}</span><span className="strong sm">{cu.emergency_phone ? 'Edit ›' : 'Add ›'}</span></button>}
        <button className="size-row edit-row" onClick={() => setEdit('pin')}><span className="muted sm" style={{ width: 70 }}>Code</span><span className="grow strong">{pinLen === 4 ? '••••' : '••••••'}</span><span className="strong sm">Change your code ›</span></button>
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

      {cal && me.role !== 'admin' && <section className="sizes">
        <button className="size-row edit-row" onClick={() => setCalOpen(true)}><span className="grow">{cal.added_at ? 'My G&R calendar' : 'Add my G&R calendar'}</span><span className="muted sm">{cal.added_at ? 'Added · add again ›' : '›'}</span></button>
      </section>}

      {me.role !== 'admin' && <AlertsProfileRow me={me} />}

      <button className="btn" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>Log out</button>
      <TabBar />
      {nickOpen && <NickSheet me={me} nick={nick} onClose={() => setNickOpen(false)} onSaved={(v) => { setNick(v); me.nickname = v; setMsg('✓ Saved'); setNickOpen(false); }} />}
      {calOpen && cal && <>
        <div className="scrim" onClick={() => setCalOpen(false)} />
        {/* Ronnie, Nov 2: logo instead of "G&R" in the title, swipe down / scroll like the other sheets, ‹ and ✕ on top instead of Close */}
        <SwipeSheet onClose={() => setCalOpen(false)} label="Add my G&R calendar" back>
          <div className="cal-title serif">Your <img src="/logo-mark.png" alt="G&R" /> calendar</div>
          <div className="cu-body"><CalendarBody me={me} cal={cal} onCal={setCal} /></div>
        </SwipeSheet>
      </>}
      {emOpen && cu && <>
        <div className="scrim" onClick={() => setEmOpen(false)} />
        <SwipeSheet onClose={() => setEmOpen(false)} label="Emergency contact">
          <div><div className="kicker">ONLY RONNIE SEES THIS</div><div className="serif" style={{ fontSize: 26 }}>Emergency contact</div></div>
          <EmergencyForm info={{ ...cu }} saveLabel="Save" onSaved={() => { setEmOpen(false); setEmergencyReminder('clear'); reloadCu(); setMsg('✓ Saved'); }} />
        </SwipeSheet>
      </>}
      {edit && <EditSheet kind={edit} me={me} phone={phone} pinLen={pinLen} onPinLen={setPinLen} onClose={() => setEdit(null)} onPhone={(v) => { setPhone(v); setMsg('✓ Saved'); }} />}
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

function EditSheet({ kind, me, phone, pinLen, onPinLen, onClose, onPhone }: { kind: 'phone' | 'pin'; me: Staff; phone: string; pinLen: PinLen | null; onPinLen: (l: PinLen) => void; onClose: () => void; onPhone: (v: string) => void }) {
  const [v, setV] = useState(kind === 'phone' ? phone : '');
  const [cur, setCur] = useState(''); const [n1, setN1] = useState(''); const [n2, setN2] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const force6 = setting('signin.code') === 'force6'; // push 32: Settings → Sign-in code
  const [len, setLen] = useState<PinLen>(force6 ? 6 : pinLen ?? 6); // push 31d: new code can be 4 or 6 digits
  const digits = (t: string, max = 6) => t.replace(/\D/g, '').slice(0, max);
  const savePhone = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.from('staff').update({ phone: v.trim() || null }).eq('id', me.id);
    setBusy(false); if (error) return setErr(error.message);
    onPhone(v.trim()); onClose();
  };
  const savePin = async () => {
    setBusy(true); setErr('');
    const chk = await supabase.auth.signInWithPassword({ email: me.email!, password: pinPassword(cur) });
    if (chk.error) { setBusy(false); return setErr('Current code is wrong.'); }
    const { error } = await supabase.auth.updateUser({ password: pinPassword(n1) });
    if (error) { setBusy(false); return setErr(error.message); }
    await saveMyPinLen(me.email, len); onPinLen(len);
    setBusy(false); setDone(true);
  };
  const easy = /^(\d)\1+$/.test(n1) || '0123456789'.includes(n1) || '9876543210'.includes(n1);
  const pinOk = (cur.length === 4 || cur.length === 6) && n1.length === len && n1 === n2 && !easy;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={kind === 'phone' ? 'Edit phone' : 'Change your code'}>
        <div className="grab" />
        <div className="spread" style={{ alignItems: 'center' }}><span className="serif" style={{ fontSize: 24 }}>{kind === 'phone' ? 'Phone number' : 'Change your code'}</span><button className="btn link" onClick={onClose}>Cancel</button></div>
        {kind === 'phone' ? <>
          <input className="sheet-input" type="tel" inputMode="tel" autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="(514) 555-0000" />
          <button className="btn-ink" disabled={busy} onClick={savePhone}>{busy ? 'Saving…' : 'Save'}</button>
        </> : done ? <>
          <p className="body">✓ Your new {len}-digit code is saved. Use it next time you sign in.</p>
          <button className="btn-ink" onClick={onClose}>Done</button>
        </> : <>
          <label className="pin-field">Current code<input inputMode="numeric" type="password" autoComplete="current-password" maxLength={6} placeholder={pinLen === 4 ? '4 digits' : pinLen === 6 ? '6 digits' : '4 or 6 digits'} value={cur} onChange={(e) => setCur(digits(e.target.value))} /></label>
          {force6 ? <span className="pin-hint left">New codes are 6 digits.</span> : <div className="pin-field">LENGTH<LenSeg len={len} onLen={(l) => { setLen(l); setN1(''); setN2(''); }} /><span className="pin-hint left">Switch between 4 and 6 anytime. 6 digits is safer.</span></div>}
          <label className="pin-field">New code<input inputMode="numeric" type="password" autoComplete="new-password" maxLength={len} value={n1} onChange={(e) => setN1(digits(e.target.value, len))} /></label>
          <label className="pin-field">Confirm<input inputMode="numeric" type="password" autoComplete="new-password" maxLength={len} value={n2} onChange={(e) => setN2(digits(e.target.value, len))} /></label>
          {n1.length === len && easy && <p className="error">Too easy to guess. Avoid 1234, 0000 or your birthday.</p>}
          {n2.length === len && n1 !== n2 && <p className="error">The new codes don't match.</p>}
          <button className="btn-ink green" disabled={!pinOk || busy} style={{ opacity: pinOk ? 1 : 0.45 }} onClick={savePin}>{busy ? 'Saving…' : 'Save'}</button>
        </>}
        {err && <p className="error">{err}</p>}
      </div>
    </>
  );
}

/** push 33d · "What should we call you?" (validated here and again in set_my_nickname). */
function NickSheet({ me, nick, onClose, onSaved }: { me: Staff; nick: string | null; onClose: () => void; onSaved: (v: string | null) => void }) {
  const [v, setV] = useState(nick ?? ''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const st = nickState(v);
  const canSave = !busy && (st === 'ok' ? cleanNick(v) !== (nick ?? '') : st === 'empty' && !!nick);
  const save = async () => {
    setBusy(true); setErr('');
    const { data, error } = await supabase.rpc('set_my_nickname', { p_nickname: cleanNick(v) });
    setBusy(false);
    if (error) return setErr(/real name|letters/i.test(error.message) ? NICK_ERROR : error.message);
    onSaved(typeof data === 'string' && data ? data : null);
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet nick-sheet" role="dialog" aria-label="What should we call you?">
        <div className="grab" />
        <div className="spread" style={{ alignItems: 'center' }}><span className="kicker">PROFILE</span><button className="btn link" onClick={onClose}>Cancel</button></div>
        <div className="nick-full"><small>Full name (from G&amp;R)</small><b>{me.full_name}</b></div>
        <div className="serif" style={{ fontSize: 24 }}>What should we call you?</div>
        <p className="muted sm" style={{ margin: 0 }}>The name you go by at work. Your manager and team will see it on sections, teams and in the app.</p>
        <div className={'nick-input' + (st === 'bad' ? ' bad' : st === 'ok' ? ' ok' : '')}>
          <input className="sheet-input" autoFocus maxLength={15} autoComplete="nickname" placeholder="e.g. Mo" value={v} onChange={(e) => setV(e.target.value)} />
          {st === 'ok' && <span aria-hidden="true">✓</span>}
        </div>
        {st === 'bad' ? <p className="error sm">{NICK_ERROR}</p>
          : st === 'ok' ? <p className="sm strong" style={{ margin: 0, color: 'var(--ok)' }}>Looks good!</p>
          : st === 'empty' && nick ? <p className="muted sm" style={{ margin: 0 }}>Leave it empty to use your first name ({me.full_name.split(' ')[0]}).</p>
          : <p className="muted sm" style={{ margin: 0 }}>Letters only, 2 to 15 characters. Your first name or a short version of it is perfect.</p>}
        {err && <p className="error">{err}</p>}
        <button className="btn-ink" disabled={!canSave} style={{ opacity: canSave ? 1 : 0.45 }} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </>
  );
}
