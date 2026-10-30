import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { QuarterTime } from './QuarterTime';

export const INCIDENT_KINDS: [string, string][] = [['injury', 'Injury'], ['damage', 'Breakage / damage'], ['guest', 'Guest complaint'], ['staff', 'Staff conduct'], ['client', 'Client issue'], ['other', 'Other']];
export const kindLabel = (k: string) => INCIDENT_KINDS.find(([x]) => x === k)?.[1] ?? k;
export type Incident = { id: string; kind: string; involved_staff: string[]; involved_other: string[]; happened_at: string | null; body: string | null; audio_path: string | null; audio_sec: number | null; photos: string[]; created_at: string };
type Person = { id: string; name: string };

const hmNow = () => { const d = new Date(Math.round(Date.now() / 900000) * 900000); return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }); };

export function IncidentSheet({ eventId, eventDate, team, onClose, onSent }: { eventId: string; eventDate: string; team: Person[]; onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState(''); const [who, setWho] = useState<string[]>([]); const [other, setOther] = useState<string[]>([]);
  const [when, setWhen] = useState(hmNow()); const [body, setBody] = useState(''); const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [showTeam, setShowTeam] = useState(false);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const send = async () => {
    setErr('');
    if (!kind) return setErr('Pick what happened.');
    if (!body.trim()) return setErr('Write what happened.');
    setBusy(true);
    try {
      const id = crypto.randomUUID(); const dir = `${eventId}/${id}`;
      const audio_path: string | null = null;
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
        body: body.trim() || null, audio_path, audio_sec: null, photos: paths });
      if (ins.error) throw ins.error;
      setBusy(false); onSent();
    } catch (e) { setBusy(false); setErr((e as Error).message || 'Could not send. Check the signal and try again.'); }
  };

  return (
    <div className="inc">
      <div className="row" style={{ gap: 12 }}>
        <span className="inc-icon">!</span>
        <div><div className="serif" style={{ fontSize: 22 }}>Incident report</div>
          <div className="muted sm">Emergencies only · goes to Ronnie only</div></div>
      </div>
      <div className="inc-card">
        <span className="kicker">What happened</span>
        <div className="inc-grid2">{INCIDENT_KINDS.map(([k, l]) => <button key={k} type="button" className={'rchip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>)}</div>
      </div>
      <div className="inc-card">
        <span className="kicker">Who was involved</span>
        <div className="inc-chips">
          {who.map((id) => <button key={id} type="button" className="rchip on" onClick={() => toggle(who, setWho, id)}>{team.find((p) => p.id === id)?.name.split(' ').slice(0, 2).join(' ')} ×</button>)}
          <button type="button" className={'rchip' + (showTeam ? ' on' : '')} onClick={() => setShowTeam(!showTeam)}>+ Staff</button>
          {[['guest', 'Guest'], ['client', 'Client / venue']].map(([k, l]) => <button key={k} type="button" className={'rchip' + (other.includes(k) ? ' on' : '')} onClick={() => toggle(other, setOther, k)}>{l}</button>)}
        </div>
        {showTeam && <div className="inc-team">{team.filter((p) => !who.includes(p.id)).map((p) => <button key={p.id} type="button" onClick={() => { setWho([...who, p.id]); setShowTeam(false); }}>{p.name}</button>)}</div>}
      </div>
      <div className="times-box"><label>When<QuarterTime value={when} onChange={setWhen} label="When it happened" /></label></div>
      <div className="inc-card">
        <span className="kicker">Note</span>
        <textarea className="inc-note" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened, who was there, what you did…" />
      </div>
      <div className="inc-card inc-photos">
        {photos.map((f, i) => <span key={i} className="inc-ph">{f.name.slice(0, 10)}<button type="button" onClick={() => setPhotos(photos.filter((_, k) => k !== i))}>×</button></span>)}
        <label className="inc-add">+<input type="file" accept="image/*" multiple onChange={(e) => { setPhotos([...photos, ...Array.from(e.target.files ?? [])].slice(0, 6)); e.target.value = ''; }} /></label>
        <span className="muted sm">Photos (optional)</span>
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn-ink" disabled={busy} onClick={send}>{busy ? 'Sending…' : 'Send report'}</button>
      <button className="btn-ghost" style={{ height: 46 }} onClick={onClose}>Close</button>
    </div>
  );
}
