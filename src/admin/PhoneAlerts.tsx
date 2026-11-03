import { useEffect, useState } from 'react';
import { alertPeople, alertServerStatus, makeAlertKeys, type AlertPeople, type AlertServerStatus } from '../lib/alerts';

/*
 * Push 42 · Admin → More → Settings → Phone alerts: are the alert keys set up, who has alerts on, and "Make alert keys".
 * The keys are made here in the browser (WebCrypto) and only shown: the app never saves them. Ronnie pastes them in Vercel.
 */
export function PhoneAlertsCard() {
  const [st, setSt] = useState<AlertServerStatus | null | undefined>(undefined);
  const [pp, setPp] = useState<AlertPeople | null>(null);
  const [keys, setKeys] = useState<{ publicKey: string; privateKey: string } | null>(null);
  const [err, setErr] = useState(''); const [who, setWho] = useState(false); const [copied, setCopied] = useState('');
  useEffect(() => { alertServerStatus().then(setSt); alertPeople().then(setPp); }, []);

  const make = async () => { setErr(''); try { setKeys(await makeAlertKeys()); } catch (e) { setErr((e as Error).message || 'This browser can’t make keys. Try Chrome or Safari.'); } };
  const copy = async (label: string, v: string) => {
    try { await navigator.clipboard.writeText(v); } catch {
      const t = document.createElement('textarea'); t.value = v; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch { /* select by hand */ } t.remove();
    }
    setCopied(label); window.setTimeout(() => setCopied(''), 2000);
  };

  const ready = st?.keys === 'ready' && st.service;
  const keyLine = st === undefined ? 'checking…' : st === null ? 'can’t check (open the live app)' : st.keys === 'ready' ? 'ready' : st.keys === 'invalid' ? 'not valid · make new ones' : 'not set up';
  const texts = pp ? pp.off.filter((x) => x.phone).length : 0; const noPhone = pp ? pp.off.length - texts : 0;

  return (
    <section className="adm-card st-sec pa-card">
      <div className="st-sec-h"><span className="serif">Phone alerts</span><small className="muted">keys · who has them on</small>{!ready && <span className="tag st-off">not live yet</span>}</div>
      <div className="pa-status">
        <span>Alert keys: <b className={ready ? 'ok' : 'no'}>{keyLine}</b></span>
        {st && !st.service && <span>Server key (SUPABASE_SERVICE_ROLE_KEY): <b className="no">missing</b> · nothing can be sent without it</span>}
        {pp
          ? <span>Who has alerts on: <b>{pp.on} of {pp.total}</b>{pp.off.length > 0 && <> · {texts} get texts instead{noPhone > 0 && <> · {noPhone} with no phone number</>} · <button type="button" className="link-btn" onClick={() => setWho(!who)}>{who ? 'hide' : 'see who'}</button></>}</span>
          : <span className="muted">Who has alerts on: shows once migration 046 is applied.</span>}
        {pp && (pp.waiting > 0 || pp.texts_queued > 0) && <span className="muted">{pp.waiting} waiting to go out · {pp.texts_queued} texts for the Mac mini</span>}
      </div>
      {who && pp && <ul className="pa-who">{pp.off.map((x) => <li key={x.id}>{x.name}{!x.phone && ' · no phone'}</li>)}</ul>}

      {!keys && <div><button type="button" className="abtn sm dark" onClick={make}>{ready ? 'Make new alert keys' : 'Make alert keys'}</button></div>}
      {ready && !keys && <p className="muted sm" style={{ margin: 0 }}>New keys switch every phone over the next time people open the app.</p>}
      {err && <p className="error">{err}</p>}
      {keys && (
        <div className="pa-keys">
          <div className="pa-key">
            <div className="spread"><b>VAPID_PUBLIC_KEY</b><button type="button" className="abtn sm" onClick={() => copy('pub', keys.publicKey)}>{copied === 'pub' ? '✓ Copied' : 'Copy'}</button></div>
            <code>{keys.publicKey}</code>
          </div>
          <div className="pa-key">
            <div className="spread"><b>VAPID_PRIVATE_KEY</b><button type="button" className="abtn sm" onClick={() => copy('priv', keys.privateKey)}>{copied === 'priv' ? '✓ Copied' : 'Copy'}</button></div>
            <code>{keys.privateKey}</code>
          </div>
          <div className="pa-key">
            <div className="spread"><b>VAPID_SUBJECT</b><button type="button" className="abtn sm" onClick={() => copy('sub', 'mailto:gravotreservice@gmail.com')}>{copied === 'sub' ? '✓ Copied' : 'Copy'}</button></div>
            <code>mailto:gravotreservice@gmail.com</code>
          </div>
          <ol className="pa-steps">
            <li>Vercel → the G&amp;R staff app project → <b>Settings</b> → <b>Environment Variables</b>.</li>
            <li>Add <b>VAPID_PUBLIC_KEY</b>, <b>VAPID_PRIVATE_KEY</b> and <b>VAPID_SUBJECT</b> with the values above. For each one tick <b>Production</b> and <b>Preview</b>, then Save.</li>
            <li>Check <b>SUPABASE_SERVICE_ROLE_KEY</b> is there too (it already is if invite links work).</li>
            <li><b>Deployments</b> → the latest one → <b>⋯</b> → <b>Redeploy</b>.</li>
            <li>Come back here: “Alert keys” says <b>ready</b>, and staff see “Get a buzz when G&amp;R needs you” on Home.</li>
          </ol>
          <p className="pa-warn">Keep the private key secret. The app never saves these keys: copy both before you leave this page (or just make new ones).</p>
          <div><button type="button" className="link-btn" onClick={() => setKeys(null)}>Done · hide the keys</button></div>
        </div>
      )}
    </section>
  );
}
