import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { SwipeSheet } from './SwipeSheet';
import { answerAsk } from '../lib/shiftAsks';
import {
  useAlerts, nudgeDue, turnOnAlerts, turnOffAlerts, saveAlertPrefs, sendTestAlert, refreshBadge,
  type AlertPrefs, type DeviceState,
} from '../lib/alerts';
import { Brand } from './Brand';

/* Push 42 · phone alerts on the staff side: Home card, Profile → Notifications, in-app banner + Android alert buttons. */

/** Home · green card "Get a buzz when G&R needs you". Hidden while alerts aren't set up (no keys), once on, or after "Not now". */
export function AlertsCard({ me }: { me: Staff }) {
  const { state, setState, prefs, setPrefs } = useAlerts();
  const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [err, setErr] = useState('');
  if (me.role === 'admin' || !state || !prefs) return null;
  if (done) return <div className="al-card on" role="status"><span className="al-ic" aria-hidden="true">✓</span><span className="grow"><b>Alerts are on</b><span>We’ll buzz you when <Brand /> needs you.</span></span></div>;
  if ((state !== 'off' && state !== 'ios_browser') || !nudgeDue(prefs)) return null;
  const notNow = async () => { setPrefs({ ...prefs, nudge_skips: prefs.nudge_skips + 1, nudge_at: new Date().toISOString() }); try { await saveAlertPrefs({}, true); } catch { /* shows again next time */ } };
  const on = async () => {
    setBusy(true); setErr('');
    try {
      const s = await turnOnAlerts(); setState(s);
      if (s === 'on') setDone(true);
      else if (s === 'denied') setErr('Notifications are blocked for G&R. Turn them on in your phone’s Settings, then try again.');
    } catch { setErr('That didn’t work. Try again in a minute.'); }
    setBusy(false);
  };
  return (
    <section className="al-card">
      <div className="al-top">
        <span className="al-ic" aria-hidden="true">🔔</span>
        <span className="grow"><b>Get a buzz when <Brand /> needs you</b>
          <span>{state === 'ios_browser'
            ? 'On iPhone, alerts only work from the G&R app on your Home Screen. Tap Share, then Add to Home Screen, and open G&R from there.'
            : 'Shifts to confirm, changes and messages from Ronnie, right on your phone. Never more than one buzz at a time.'}</span>
        </span>
      </div>
      {err && <p className="al-err">{err}</p>}
      <div className="al-btns">
        {state === 'off' && <button className="btn-go" disabled={busy} onClick={on}>{busy ? 'One sec…' : 'Turn on notifications'}</button>}
        <button className="link-btn" onClick={notNow}>Not now</button>
      </div>
    </section>
  );
}

/** Profile row → opens the Notifications sheet. Hidden while alerts aren't set up. */
export function AlertsProfileRow({ me }: { me: Staff }) {
  const a = useAlerts(); const [open, setOpen] = useState(false);
  if (!a.state || a.state === 'dormant') return null;
  return <>
    <div className="sec-head"><span className="serif">Notifications</span></div>
    <section className="sizes">
      <button className="size-row edit-row" onClick={() => setOpen(true)}>
        <span className="row-l">Phone alerts</span>
        <span className={'row-v' + (a.state === 'on' ? ' ok' : ' empty')}>{a.state === 'on' ? '✓ On' : 'Off'}</span>
        <span className="row-a">Change ›</span>
      </button>
    </section>
    {open && <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <SwipeSheet onClose={() => setOpen(false)} label="Notifications">
        <AlertsSheetBody me={me} {...a} />
      </SwipeSheet>
    </>}
  </>;
}

type SheetProps = { me: Staff; state: DeviceState | null; setState: (s: DeviceState) => void; prefs: AlertPrefs | null; setPrefs: (p: AlertPrefs) => void };
function AlertsSheetBody({ state, setState, prefs, setPrefs }: SheetProps) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const on = async () => { setBusy(true); setMsg(''); try { const s = await turnOnAlerts(); setState(s); if (s === 'denied') setMsg('Blocked on this phone. Turn notifications on for G&R in your phone’s Settings.'); } catch { setMsg('That didn’t work. Try again in a minute.'); } setBusy(false); };
  const off = async () => { setBusy(true); setState(await turnOffAlerts()); setBusy(false); };
  const test = async () => { setBusy(true); setMsg(''); const r = await sendTestAlert(); setMsg(r?.push ? '✓ Sent. Your phone should buzz in a few seconds.' : 'Couldn’t send a test right now.'); setBusy(false); };
  const flip = async (k: 'messages' | 'dates' | 'meetings' | 'team_chat') => {
    if (!prefs) return;
    const next = { ...prefs, [k]: !prefs[k] }; setPrefs(next);
    try { const p = await saveAlertPrefs({ [k]: next[k] }); if (p) setPrefs(p); } catch { setPrefs(prefs); setMsg('Couldn’t save. Try again.'); }
  };
  const Row = ({ label, sub, k }: { label: string; sub?: string; k?: 'messages' | 'dates' | 'meetings' | 'team_chat' }) => {
    const v = k ? !!prefs?.[k] : true;
    return (
      <div className="al-row">
        <span className="grow"><b>{label}</b>{sub && <small>{sub}</small>}</span>
        {k ? <button type="button" role="switch" aria-checked={v} aria-label={label} className={'sw' + (v ? ' on' : '')} onClick={() => flip(k)}><span className="sw-track"><span className="sw-knob" /></span></button>
          : <span className="al-always">Always on</span>}
      </div>
    );
  };
  return (
    <div className="al-sheet">
      <div className="serif al-h">Notifications</div>
      <div className={'al-state ' + (state === 'on' ? 'on' : '')}>
        {state === 'on' && <><b>✓ Alerts are on for this phone</b><div className="al-btns"><button className="btn-go" disabled={busy} onClick={test}>Send me a test</button><button className="link-btn" disabled={busy} onClick={off}>Turn off for this phone</button></div></>}
        {state === 'off' && <><b>Alerts are off on this phone</b><span>Get a buzz when <Brand /> needs you.</span><div className="al-btns"><button className="btn-go" disabled={busy} onClick={on}>{busy ? 'One sec…' : 'Turn on notifications'}</button></div></>}
        {state === 'ios_browser' && <><b>Open <Brand /> from your Home Screen</b><span>On iPhone, alerts only work from the Home Screen app. Tap Share, then Add to Home Screen, open <Brand /> from there and turn them on.</span></>}
        {state === 'denied' && <><b>Notifications are blocked for <Brand /></b><span>Turn them on in your phone’s Settings (Notifications → <Brand />), then come back here.</span></>}
        {state === 'unsupported' && <><b>This browser can’t show <Brand /> alerts</b><span>Open <Brand /> in Chrome on Android, or from your Home Screen on iPhone.</span></>}
        {msg && <span className="al-msg">{msg}</span>}
      </div>
      <div className="al-list">
        <Row label="Shifts" sub="Booked, changed, can you work this shift" />
        <Row label="Confirm reminders" sub="6 h and 2 h before your confirm-by" />
        <Row label="Messages from Ronnie or your manager" k="messages" />
        <Row label="Dates to answer" sub="+ a reminder 3 h before the answer-by" k="dates" />
        <Row label="Meetings" sub="+ 8 AM on the day" k="meetings" />
        <Row label="Team chat" sub="New messages when a team chat is open · pinned ones always buzz" k="team_chat" />
      </div>
      <p className="muted sm al-quiet">Quiet hours 11 PM – 7 AM. Anything about today or tomorrow still comes through. Never more than one buzz at a time.</p>
    </div>
  );
}

type Banner = { title: string; body: string; cta: string; url: string } | null;

/** In-app banner (alert arrives while the app is open, or the answer from an Android alert button) + taps on alerts. */
export function AlertLayer() {
  const nav = useNavigate(); const loc = useLocation();
  const [b, setB] = useState<Banner>(null); const t = useRef<number>();
  const show = (x: Banner, ms = 8000) => { setB(x); window.clearTimeout(t.current); if (x) t.current = window.setTimeout(() => setB(null), ms); };

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; title?: string; body?: string; cta?: string; url?: string } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'gr-open' && d.url) { setB(null); nav(d.url.replace(/^https?:\/\/[^/]+/, '')); }
      if (d.type === 'gr-alert') { show({ title: d.title || 'G&R', body: d.body || '', cta: d.cta || '', url: d.url || '/' }); refreshBadge(); }
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Android alert buttons: YES / NO on "Can you work…?", CONFIRM on "Confirm by…" (the app answers once it's open and signed in).
  useEffect(() => {
    const q = new URLSearchParams(loc.search); const what = q.get('alert_do');
    if (!what) return;
    const ask = q.get('ask'); const shift = q.get('shift');
    ['alert_do', 'ask', 'shift'].forEach((k) => q.delete(k));
    nav({ pathname: loc.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
    (async () => {
      try {
        if ((what === 'yes' || what === 'no') && ask) {
          const r = await answerAsk(ask, what === 'yes');
          const st = String(r?.status || '');
          const ok = what === 'yes' ? st === 'booked' || st === 'accepted' : st === 'no';
          show(ok ? { title: what === 'yes' ? '✓ You said Yes' : '✓ You said No', body: 'Ronnie has your answer.', cta: '', url: '/' }
            : { title: 'This shift is no longer available', body: '', cta: '', url: '/' });
        } else if (what === 'confirm' && shift) {
          const { error } = await supabase.rpc('respond_to_shift', { p_shift: shift, p_response: 'confirmed' });
          show(error ? { title: 'Couldn’t confirm', body: 'Open the shift and tap Confirm.', cta: '👉 Tap to open', url: '/' } : { title: '✓ Shift confirmed', body: 'Thanks! See you there.', cta: '', url: '/' });
        }
        refreshBadge();
      } catch (e) { show({ title: 'That didn’t go through', body: (e as Error).message, cta: '👉 Tap to answer in the app', url: '/' }); }
    })();
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!b) return null;
  return (
    <button className="al-banner" onClick={() => { const u = b.url; setB(null); if (b.cta) nav(u); }}>
      <img src="/logo-mark.png" alt="" />
      <span className="grow"><b>{b.title}</b>{b.body && <span>{b.body}</span>}{b.cta && <em>{b.cta}</em>}</span>
      <span className="al-x" aria-label="Close" onClick={(e) => { e.stopPropagation(); setB(null); }}>✕</span>
    </button>
  );
}
