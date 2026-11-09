import { useState } from 'react';
import { supabase } from '../lib/supabase';

/** Push 62 · "Allow Claude to use G&R?" — the sign-in step of the Claude connector (OAuth). Admin only (route guarded in App). */
export function ConnectClaude() {
  const q = new URLSearchParams(window.location.search);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const fromClaude = /^https:\/\/([a-z0-9-]+\.)*claude\.(ai|com)\//.test(q.get('redirect_uri') ?? '');
  const allow = async () => {
    setBusy(true); setErr('');
    const { data } = await supabase.auth.getSession();
    const r = await fetch('/oauth/code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      access_token: data.session?.access_token, client_id: q.get('client_id'), redirect_uri: q.get('redirect_uri'), code_challenge: q.get('code_challenge'), state: q.get('state') }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.redirect) { setErr(j.error || 'Could not connect. Try again from Claude.'); setBusy(false); return; }
    window.location.href = j.redirect;
  };
  const deny = () => { const ru = q.get('redirect_uri'); if (ru && fromClaude) { const u = new URL(ru); u.searchParams.set('error', 'access_denied'); if (q.get('state')) u.searchParams.set('state', q.get('state')!); window.location.href = u.toString(); } else window.location.href = '/admin'; };
  return (
    <div className="cc-wrap">
      <div className="cc-card">
        <img src="/logo-mark.png" alt="G&R" className="cc-logo" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <span className="cc-k">CLAUDE CONNECTOR</span>
        <h1 className="serif">Let Claude use G&amp;R?</h1>
        {!fromClaude ? <p className="muted">This link didn't come from Claude. Add the connector from Claude → Settings → Connectors.</p> : <>
          <p>From any Claude chat (phone too) Claude will be able to:</p>
          <ul className="cc-list">
            <li>see events, who's free and what needs you today</li>
            <li>add events, update guests / times, add staff and book people <b>after you say yes</b></li>
          </ul>
          <p className="muted sm">It never texts or emails staff, never deletes, and doesn't touch pay or QuickBooks. Every change shows in the app as “via Claude”. Only you can connect.</p>
          {err && <p className="error">{err}</p>}
          <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" className="abtn" onClick={deny} disabled={busy}>Cancel</button>
            <button type="button" className="abtn dark" onClick={allow} disabled={busy}>{busy ? 'Connecting…' : 'Allow'}</button>
          </div></>}
      </div>
    </div>
  );
}
