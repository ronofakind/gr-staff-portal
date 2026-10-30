import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { QuarterTime } from './QuarterTime';

export const INCIDENT_KINDS: [string, string][] = [['injury', 'Injury'], ['damage', 'Breakage / damage'], ['guest', 'Guest complaint'], ['staff', 'Staff conduct'], ['client', 'Client issue'], ['other', 'Other']];
export const kindLabel = (k: string) => INCIDENT_KINDS.find(([x]) => x === k)?.[1] ?? k;
export type Incident = { id: string; kind: string; involved_staff: string[]; involved_other: string[]; happened_at: string | null; body: string | null; audio_path: string | null; audio_sec: number | null; photos: string[]; created_at: string };
type Person = { id: string; name: string };

const MAX_SEC = 180;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hmNow = () => { const d = new Date(Math.round(Date.now() / 900000) * 900000); return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }); };

/** Voice note: tap to record (stops on its own at 3 min), play back, redo or delete. */
function useRecorder() {
  const [state, setState] = useState<'idle' | 'rec' | 'done'>('idle');
  const [sec, setSec] = useState(0); const [blob, setBlob] = useState<Blob | null>(null); const [err, setErr] = useState('');
  const rec = useRef<MediaRecorder | null>(null); const timer = useRef<number | null>(null); const t0 = useRef(0);
  const stop = () => { if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); if (timer.current) window.clearInterval(timer.current); };
  const start = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => (window as unknown as { MediaRecorder: typeof MediaRecorder }).MediaRecorder?.isTypeSupported?.(t));
      const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined); const parts: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      r.onstop = () => { stream.getTracks().forEach((t) => t.stop()); setBlob(new Blob(parts, { type: r.mimeType || type || 'audio/webm' })); setSec(Math.round((Date.now() - t0.current) / 1000)); setState('done'); };
      rec.current = r; t0.current = Date.now(); setSec(0); setState('rec'); r.start();
      timer.current = window.setInterval(() => { const s = (Date.now() - t0.current) / 1000; setSec(s); if (s >= MAX_SEC) stop(); }, 250);
    } catch { setErr('The microphone is blocked. Allow it for this app in the phone settings, or type instead.'); setState('idle'); }
  };
  const clear = () => { setBlob(null); setSec(0); setState('idle'); };
  useEffect(() => () => stop(), []);
  return { state, sec, blob, err, start, stop, clear };
}

export function IncidentSheet({ eventId, eventDate, team, onClose, onSent }: { eventId: string; eventDate: string; team: Person[]; onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState(''); const [who, setWho] = useState<string[]>([]); const [other, setOther] = useState<string[]>([]);
  const [when, setWhen] = useState(hmNow()); const [body, setBody] = useState(''); const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [showTeam, setShowTeam] = useState(false);
  const r = useRecorder(); const url = useRef<string | null>(null);
  if (r.blob && !url.current) url.current = URL.createObjectURL(r.blob);
  if (!r.blob && url.current) { URL.revokeObjectURL(url.current); url.current = null; }
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const send = async () => {
    setErr('');
    if (!kind) return setErr('Pick what happened.');
    if (!body.trim() && !r.blob) return setErr('Type what happened or record a voice note.');
    setBusy(true);
    try {
      const id = crypto.randomUUID(); const dir = `${eventId}/${id}`;
      let audio_path: string | null = null;
      if (r.blob) {
        const ext = r.blob.type.includes('mp4') ? 'm4a' : 'webm'; audio_path = `${dir}/voice.${ext}`;
        const up = await supabase.storage.from('incidents').upload(audio_path, r.blob, { contentType: r.blob.type || 'audio/webm' });
        if (up.error) throw up.error;
      }
      const paths: string[] = [];
      for (const [i, f] of photos.entries()) {
        const p = `${dir}/photo-${i + 1}.${(f.name.split('.').pop() || 'jpg').toLowerCase()}`;
        const up = await supabase.storage.from('incidents').upload(p, f, { contentType: f.type || 'image/jpeg' });
        if (up.error) throw up.error; paths.push(p);
      }
      const guess = new Date(`${eventDate}T${when}:00Z`);
      const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' }).formatToParts(guess).find((x) => x.type === 'timeZoneName')!.value;
      const base = guess.getTime() - Number(tz.replace('GMT', '') || 0) * 3600e3;
      const happened = new Date([base, base + 864e5].sort((x, y) => Math.abs(x - Date.now()) - Math.abs(y - Date.now()))[0]); // after midnight = next day
      const ins = await supabase.from('incidents').insert({ id, event_id: eventId, kind, involved_staff: who, involved_other: other, happened_at: happened.toISOString(),
        body: body.trim() || null, audio_path, audio_sec: r.blob ? Math.round(r.sec) : null, photos: paths });
      if (ins.error) throw ins.error;
      setBusy(false); onSent();
    } catch (e) { setBusy(false); setErr((e as Error).message || 'Could not send. Check the signal and try again.'); }
  };

  return (
    <div className="inc">
      <div><div className="serif" style={{ fontSize: 24 }}>Incident report</div>
        <div className="muted sm">For emergencies only: injury, damage, serious complaint · goes to Ronnie only</div></div>
      <div><span className="kicker">What happened</span>
        <div className="inc-chips">{INCIDENT_KINDS.map(([k, l]) => <button key={k} type="button" className={'rchip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>)}</div></div>
      <div><span className="kicker">Who was involved</span>
        <div className="inc-chips">
          {who.map((id) => <button key={id} type="button" className="rchip on" onClick={() => toggle(who, setWho, id)}>{team.find((p) => p.id === id)?.name.split(' ').slice(0, 2).join(' ')} ×</button>)}
          <button type="button" className="rchip" onClick={() => setShowTeam(!showTeam)}>+ Staff</button>
          {[['guest', 'Guest'], ['client', 'Client / venue']].map(([k, l]) => <button key={k} type="button" className={'rchip' + (other.includes(k) ? ' on' : '')} onClick={() => toggle(other, setOther, k)}>{l}</button>)}
        </div>
        {showTeam && <div className="inc-team">{team.filter((p) => !who.includes(p.id)).map((p) => <button key={p.id} type="button" onClick={() => { setWho([...who, p.id]); setShowTeam(false); }}>{p.name}</button>)}</div>}
      </div>
      <div className="ask-time"><b>When</b><QuarterTime value={when} onChange={setWhen} label="When it happened" /></div>
      <div><span className="kicker">Explain</span>
        {r.state === 'rec' ? (
          <div className="inc-rec">
            <span className="inc-dot">● RECORDING</span><b className="serif">{mmss(r.sec)}</b>
            <span className="inc-wave">{Array.from({ length: 24 }).map((_, i) => <i key={i} style={{ animationDelay: `${(i % 6) * 0.12}s` }} />)}</span>
            <small>Say what happened, who was there, what you did. Stops on its own at 3:00.</small>
            <button type="button" className="inc-stop" aria-label="Stop recording" onClick={r.stop}><i /></button>
          </div>
        ) : (
          <div className="inc-box">
            <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened, who was there, what you did…" />
            {r.state === 'idle' && <button type="button" className="inc-voice" onClick={r.start}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>Voice</button>}
          </div>
        )}
        {r.state === 'done' && url.current && (
          <div className="inc-play"><audio controls src={url.current} /><span className="muted sm">{mmss(r.sec)}</span><button type="button" onClick={r.clear} aria-label="Delete voice note">🗑</button></div>
        )}
        {r.err && <p className="error">{r.err}</p>}
        {r.state !== 'rec' && <div className="muted sm" style={{ textAlign: 'center', marginTop: 6 }}>Type it, or tap Voice to record (up to 3 min). You can do both.</div>}
      </div>
      <div className="inc-photos">
        {photos.map((f, i) => <span key={i} className="inc-ph">{f.name.slice(0, 10)}<button type="button" onClick={() => setPhotos(photos.filter((_, k) => k !== i))}>×</button></span>)}
        <label className="inc-add">+<input type="file" accept="image/*" multiple onChange={(e) => { setPhotos([...photos, ...Array.from(e.target.files ?? [])].slice(0, 6)); e.target.value = ''; }} /></label>
        <span className="muted sm">Add photos (broken item, injury, receipt)</span>
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn-ink" disabled={busy || r.state === 'rec'} onClick={send}>{busy ? 'Sending…' : 'Send report'}</button>
      <button className="btn-ghost" style={{ height: 44 }} onClick={onClose}>Cancel</button>
    </div>
  );
}
