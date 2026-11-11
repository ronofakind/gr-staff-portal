import { ThemePicker } from '../components/ThemePicker';
import { currentTheme } from '../lib/theme';
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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
import { Brand } from '../components/Brand';
import { DeleteAccountLink } from './DeleteAccount';

type Extra = { transport: string | null; positions: string[] | null; shirt_size: string | null; pants_size: string | null; dress_size: string | null };
const POSITIONS = ['Waiter', 'Bartender', 'Barback', 'Cook']; // Ronnie Nov 10: Cook yes, MD never self-picked
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
  const [phone, setPhone] = useState(me.phone ?? ''); const nav = useNavigate();
  const { info: cu, reload: reloadCu } = useCheckup(); const [emOpen, setEmOpen] = useState(false); const [whyOpen, setWhyOpen] = useState(false);
  const [pinLen, setPinLen] = useState<PinLen | null>(null);
  const fr = me.language === 'fr'; const [sizesOpen, setSizesOpen] = useState(false); const [colOpen, setColOpen] = useState(false); // push 82
  const [since, setSince] = useState<string | null>(null);
  useEffect(() => { (async () => { // "with G&R since": first shift, else the date they joined the app
    const { data } = await supabase.from('shifts').select('events!inner(event_date)').eq('staff_id', me.id).order('event_date', { referencedTable: 'events', ascending: true }).limit(1);
    const d = (data?.[0] as unknown as { events?: { event_date: string } } | undefined)?.events?.event_date ?? (me as unknown as { created_at?: string }).created_at?.slice(0, 10);
    if (d) setSince(new Date(d + 'T12:00:00').toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { month: 'short', year: 'numeric' }).replace('.', ''));
  })(); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const themeName = (() => { const t = currentTheme(); return t === 'dark' ? (fr ? 'Sombre' : 'Dark') : t === 'terra' ? 'Terracotta & Sage' : (fr ? 'Classique' : 'Classic'); })();
  const setLang = async (l: 'en' | 'fr') => { if ((me.language ?? 'en') === l) return; me.language = l; setMsg('Saving…'); const { error } = await supabase.from('staff').update({ language: l }).eq('id', me.id); setMsg(error ? error.message : '✓ Saved'); };
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

      {/* push 82 · Profile regrouped (board ProfileV3, Ronnie Nov 10): identity · 3 tiles · About me · Work · App · G&R */}
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="row" style={{ gap: 16 }}>
          <PhotoPicker name={me.full_name} url={url} onPick={pick} size={84} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{me.full_name}</div>
            <div className="muted sm">{me.role === 'manager' ? 'Manager' : me.role === 'admin' ? 'Admin' : 'Staff'}{since ? ` · with G&R since ${since}` : ''}</div>
          </div>
        </div>
        <button className="nick-row" onClick={() => setNickOpen(true)}>
          <span className="grow"><small>Name we call you (optional)</small><b>{nick || me.full_name.split(' ')[0]}</b></span><span className="strong sm">Edit ›</span>
        </button>
      </section>

      <div className="pf-tiles">
        <button className="pf-tile" onClick={() => nav('/hours')}><span aria-hidden="true">⏱</span><b>{fr ? 'Mes heures' : 'My hours'}</b><small>{fr ? 'cette période' : 'this pay period'}</small></button>
        <button className="pf-tile" onClick={() => nav('/handbook')}><span aria-hidden="true">📘</span><b>{fr ? 'Guide' : 'Handbook'}</b><small>G&amp;R standards</small></button>
        {cal && me.role !== 'admin'
          ? <button className="pf-tile" onClick={() => setCalOpen(true)}><span aria-hidden="true">📅</span><b>{fr ? 'Calendrier' : 'Calendar'}</b><small className={cal.added_at ? 'okc' : ''}>{cal.added_at ? (fr ? '✓ ajouté' : '✓ added') : (fr ? 'à ajouter' : 'not added')}</small></button>
          : <span />}
      </div>

      <div className="sec-head"><span className="serif">{fr ? 'Moi' : 'About me'}</span></div>
      <section className="sizes">
        <div className="size-row"><span className="row-l">Email</span><span className="row-v">{me.email}</span></div>
        <button className="size-row edit-row" onClick={() => setEdit('phone')}><span className="row-l">{fr ? 'Téléphone' : 'Phone'}</span><span className="row-v">{phone || '—'}</span><span className="row-a">Edit ›</span></button>
        {me.role !== 'admin' && cu && <button className="size-row edit-row" onClick={() => setEmOpen(true)}><span className="row-l">{fr ? 'Urgence' : 'Emergency'}</span><span className={'row-v' + (cu.emergency_phone ? '' : ' empty')}>{cu.emergency_phone ? `${cu.emergency_name ?? ''} · ${cu.emergency_phone}` : (fr ? 'À ajouter' : 'Not added')}</span><span className="row-a">Edit ›</span></button>}
        <button className="size-row edit-row" onClick={() => setEdit('pin')}><span className="row-l">Code</span><span className="row-v">{pinLen === 4 ? '••••' : '••••••'}</span><span className="row-a">Change ›</span></button>
      </section>

      {x && <>
        <div className="sec-head"><span className="serif">{fr ? 'Travail' : 'Work'}</span><span className="muted sm">{fr ? 'pour les réservations' : 'used for bookings'}</span></div>
        <section className="sizes">
          <div className="size-row"><span className="row-l">{fr ? 'Transport' : 'Getting there'}</span>
            <span className="row-v"><span className="pf-seg">{(['car', 'transit'] as const).map((t) => <button key={t} className={x.transport === t ? 'on' : ''} onClick={() => save({ transport: t })}>{t === 'car' ? (fr ? '🚗 Auto' : '🚗 Car') : (fr ? '🚇 Transport' : '🚇 Transit')}</button>)}</span></span></div>
          <button className="size-row edit-row" onClick={() => setSizesOpen(!sizesOpen)}><span className="row-l">{fr ? 'Tailles' : 'Sizes'}</span>
            <span className={'row-v' + ([x.shirt_size, x.pants_size].some((v) => !v) ? ' empty' : '')}>{[x.shirt_size ?? '—', x.pants_size ?? '—', x.dress_size ?? '—'].join(' · ')}</span>
            <span className="row-a">{sizesOpen ? 'Done' : 'Edit ›'}</span></button>
          {sizesOpen && <>
            <SizeRow label="Shirt" hint="the letter on the tag" value={x.shirt_size} options={SHIRT} onChange={(v) => save({ shirt_size: v })} />
            <SizeRow label="Pants (waist)" hint="jeans tag W32 L30 → 32" value={x.pants_size} options={PANTS} onChange={(v) => save({ pants_size: v })} />
            <SizeRow label="Dress" hint="between sizes? pick the bigger" value={x.dress_size} options={DRESS} none="Not needed" onChange={(v) => save({ dress_size: v })} />
            <button type="button" className="size-row pf-why" onClick={() => setWhyOpen(true)}>Why we ask for your sizes ›</button>
          </>}
        </section>
        <section className="card pf-pos">
          <small className="muted">{fr ? 'Postes que je peux faire' : 'Positions I can work'}</small>
          <div className="chips">
            {POSITIONS.map((p) => (
              <button key={p} className={'bubble' + (has(p) ? ' on' : '')}
                onClick={() => save({ positions: has(p) ? pos.filter((q) => q.toLowerCase() !== p.toLowerCase()) : [...pos, p] })}>
                {has(p) && '✓ '}{p}
              </button>
            ))}
          </div>
        </section>
      </>}

      <div className="sec-head"><span className="serif">App</span></div>
      <section className="sizes">
        {me.role !== 'admin' && <AlertsProfileRow me={me} bare />}
        <div className="size-row"><span className="row-l">{fr ? 'Langue' : 'Language'}</span>
          <span className="row-v"><span className="pf-seg">{(['en', 'fr'] as const).map((l) => <button key={l} className={(me.language ?? 'en') === l ? 'on' : ''} onClick={() => setLang(l)}>{l === 'en' ? 'English' : 'Français'}</button>)}</span></span></div>
        <button className="size-row edit-row" onClick={() => setColOpen(!colOpen)}><span className="row-l">{fr ? 'Couleurs' : 'Colours'}</span><span className="row-v">{themeName}</span><span className="row-a">{colOpen ? 'Done' : 'Change ›'}</span></button>
        {colOpen && <div className="pf-inset"><ThemePicker staffId={me.id} fr={fr} /></div>}
      </section>

      <div className="sec-head"><span className="serif">G&amp;R</span></div>
      <ReferCard me={me} fr={fr} />

      <button className="btn" onClick={() => supabase.auth.signOut().then(() => window.location.replace('/'))}>Log out</button>
      {me.role !== 'admin' && <DeleteAccountLink />}
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
      {whyOpen && <>
        <div className="scrim" onClick={() => setWhyOpen(false)} />
        <SwipeSheet onClose={() => setWhyOpen(false)} label="Why we ask for your sizes">
          <div className="why-sheet">
            <span className="why-ic" aria-hidden="true">👕</span>
            <div className="serif" style={{ fontSize: 24 }}>Why we ask for your sizes</div>
            <p>Some clients dress our team for themed events, like custom t-shirts or costumes, and need everyone’s sizes ahead of time. Fill these once and you’re ready for those events.</p>
            <small>🔒 Only Ronnie sees them. Shared with a client only for a themed event you’re booked on.</small>
            <button type="button" className="cu-btn green" onClick={() => setWhyOpen(false)}>Got it</button>
          </div>
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

function SizeRow({ label, hint, value, options, onChange, none = 'Choose' }: { label: string; hint?: string; value: string | null; options: string[]; onChange: (v: string | null) => void; none?: string }) {
  // Same look as the Contact rows: grey label (hint under it) · bold value · Change ›. The phone's own list opens on tap.
  return (
    <label className="size-row edit-row pick-row">
      <span className="row-l">{label}</span>
      <span className="row-vh"><span className={'row-v' + (value ? '' : ' empty')}>{value ?? none}</span>{hint && <small>{hint}</small>}</span>
      <span className="row-a">{value ? 'Change ›' : 'Pick ›'}</span>
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{none}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
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
        <div className="nick-full"><small>Full name (from <Brand />)</small><b>{me.full_name}</b></div>
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

/** push 82 · Refer a friend: its own dark card, Share (phone share sheet) + Copy. */
function ReferCard({ me, fr }: { me: Staff; fr: boolean }) {
  const [ok, setOk] = useState(false);
  const link = `https://${window.location.host}/apply?r=${me.id}`;
  const text = fr ? `G&R engage pour des événements à Montréal. Postule ici (3 min) : ${link}` : `G&R is hiring for events in Montreal. Apply here (3 min): ${link}`;
  const copy = async () => { try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); } catch { /* */ } };
  const share = async () => { try { if (navigator.share) { await navigator.share({ text }); return; } } catch { return; } copy(); };
  return (
    <section className="pf-refer">
      <span className="pf-refer-k">{fr ? 'RÉFÈRE UN AMI' : 'REFER A FRIEND'}</span>
      <span className="pf-refer-t">{fr ? 'Tu connais quelqu’un de bien pour G&R?' : 'Know someone great for G&R?'}</span>
      <span className="pf-refer-s">{fr ? 'Envoie-lui ton lien. Sa candidature montre que tu l’as référé.' : 'Send them your link. Their application shows you referred them.'}</span>
      <div className="pf-refer-b"><button className="pf-share" onClick={share}>{fr ? 'Partager mon lien' : 'Share my link'}</button><button className="pf-copy" onClick={copy}>{ok ? '✓' : (fr ? 'Copier' : 'Copy')}</button></div>
    </section>);
}
