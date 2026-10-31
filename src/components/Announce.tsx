import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

/* Push 25e · one-way announcements: composer (manager + Ronnie), read status, staff card + viewer. */
export type Media = { path: string; type: 'image' | 'video'; name?: string };
export type Ann = { id: string; event_id: string | null; body: string; media: Media[]; pinned: boolean; created_at: string; audience: { kind: string; start?: string; date?: string; ids?: string[] };
  sender: { full_name: string } | null; events: { title: string; event_date: string } | null };
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
export const ANN_SELECT = 'id,event_id,body,media,pinned,created_at,audience,sender:staff!announcements_sender_id_fkey(full_name),events(title,event_date)';

async function shrink(f: File): Promise<Blob> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif') return f;
  const img = await createImageBitmap(f).catch(() => null); if (!img) return f;
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), 'image/jpeg', 0.85));
}

export type Target = { key: string; label: string; n: number; audience: Ann['audience']; event_id: string | null };
/** Composer. `targets` = the TO options (manager: whole team + each start group; admin: everyone / day / event / group / person). */
export function AnnounceComposer({ targets, folder, onSent, onClose }: { targets: Target[]; folder: string; onSent: () => void; onClose: () => void }) {
  const [to, setTo] = useState(targets[0]?.key ?? ''); const [body, setBody] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [pin, setPin] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const t = targets.find((x) => x.key === to);
  const send = async () => {
    if (!t) return; setErr('');
    if (!body.trim() && !files.length) return setErr('Write something or add a photo.');
    for (const f of files) if (f.type.startsWith('video/') && f.size > 100 * 1024 * 1024) return setErr(`${f.name} is over 100 MB.`);
    setBusy(true);
    try {
      const media: Media[] = [];
      for (const f of files) {
        const blob = await shrink(f); const isV = f.type.startsWith('video/');
        const p = `${folder}/${crypto.randomUUID()}.${isV ? (f.name.split('.').pop() || 'mp4').toLowerCase() : 'jpg'}`;
        const up = await supabase.storage.from('announcements').upload(p, blob, { contentType: isV ? f.type : 'image/jpeg' });
        if (up.error) throw up.error; media.push({ path: p, type: isV ? 'video' : 'image', name: f.name });
      }
      const { error } = await supabase.rpc('send_announcement', { p_event: t.event_id, p_audience: t.audience, p_body: body.trim(), p_media: media, p_pinned: pin });
      if (error) throw error;
      setBusy(false); onSent();
    } catch (e) { setBusy(false); setErr((e as Error).message); }
  };
  return (
    <div className="ann-comp">
      <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>Message your team</div>
      <div className="ann-f"><span>TO</span><div className="row wrap" style={{ gap: 6 }}>{targets.map((x) => <button key={x.key} type="button" className={'rchip' + (to === x.key ? ' on' : '')} onClick={() => setTo(x.key)}>{x.label} · {x.n}</button>)}</div></div>
      <textarea className="ann-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Staff entrance is on the side tonight. Black aprons, not white." />
      <div className="ann-media">
        {files.map((f, i) => <span key={i} className="ann-thumb">{f.type.startsWith('video/') ? '🎬' : '🖼'} {f.name.slice(0, 14)}<button type="button" onClick={() => setFiles(files.filter((_, k) => k !== i))}>×</button></span>)}
        <label className="ann-add">+ Add photos / videos<input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 8)); e.target.value = ''; }} /></label>
      </div>
      <div className="sw-row"><button type="button" role="switch" aria-checked={pin} className={'sw' + (pin ? ' on' : '')} onClick={() => setPin(!pin)}><span className="sw-track"><span className="sw-knob" /></span><span className="sw-lbl">{pin ? 'ON' : 'OFF'}</span></button><b>Pin on the event page</b></div>
      {err && <p className="error">{err}</p>}
      <button className="btn-ink" disabled={busy || !t} onClick={send}>{busy ? 'Sending…' : `Send to ${t?.n ?? 0}`}</button>
      <div className="muted sm" style={{ textAlign: 'center' }}>One-way · they can’t reply. Videos up to 60 s / 100 MB.</div>
      <button className="btn-ghost" style={{ height: 44 }} onClick={onClose}>Close</button>
    </div>
  );
}

/** Sent announcements with read status ("18 of 22 got it ✓"). */
export function AnnounceSent({ eventId, reload = 0 }: { eventId?: string | null; reload?: number }) {
  const [list, setList] = useState<(Ann & { reads: { staff_id: string; opened_at: string | null; ack_at: string | null; staff: { full_name: string; phone: string | null } | null }[] })[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let q = supabase.from('announcements').select(ANN_SELECT + ',reads:announcement_reads(staff_id,opened_at,ack_at,staff:staff!announcement_reads_staff_id_fkey(full_name,phone))').order('created_at', { ascending: false }).limit(30);
    if (eventId) q = q.eq('event_id', eventId);
    q.then(({ data }) => setList((data ?? []) as unknown as typeof list));
  }, [eventId, reload]);
  if (!list.length) return null;
  return (
    <div className="ann-sent">
      {list.map((a) => { const ok = a.reads.filter((r) => r.ack_at).length; return (
        <div key={a.id} className="ann-srow">
          <button className="ann-sh" onClick={() => setOpen(open === a.id ? null : a.id)}>
            <span className="grow" style={{ textAlign: 'left' }}><b>{a.body.slice(0, 60) || `${a.media.length} file${a.media.length === 1 ? '' : 's'}`}</b><small>{t12(a.created_at)}{a.events ? ` · ${a.events.title}` : ''}{a.pinned ? ' · pinned' : ''}</small></span>
            <span className={ok === a.reads.length ? 'okc sm strong' : 'gold sm strong'}>{ok} of {a.reads.length} got it ✓</span>
          </button>
          {open === a.id && <div className="ann-reads">{[...a.reads].sort((x, y) => Number(!!x.ack_at) - Number(!!y.ack_at)).map((r) => (
            <div key={r.staff_id}><span className="grow">{r.staff?.phone ? <a href={`tel:${r.staff.phone.replace(/[^\d+]/g, '')}`}>{r.staff?.full_name}</a> : r.staff?.full_name}</span>
              <span className={r.ack_at ? 'okc' : r.opened_at ? 'gold' : 'muted'}>{r.ack_at ? `got it ${t12(r.ack_at)}` : r.opened_at ? 'opened · no ✓' : 'not opened'}</span></div>))}</div>}
        </div>); })}
    </div>
  );
}

/** Staff: one announcement, full (photos 2-col, tap = full screen, video player, Got it ✓). */
export function AnnounceView({ a, onClose, onAck, acked }: { a: Ann; onClose: () => void; onAck: () => void; acked: boolean }) {
  const [urls, setUrls] = useState<Record<string, string>>({}); const [full, setFull] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc('announcement_seen', { p_id: a.id, p_ack: false });
    if (a.media.length) supabase.storage.from('announcements').createSignedUrls(a.media.map((m) => m.path), 3600).then(({ data }) => setUrls(Object.fromEntries((data ?? []).map((d, i) => [a.media[i].path, d.signedUrl]))));
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (<>
    <div className="scrim" onClick={onClose} />
    <div className="sheet swipe" role="dialog" aria-label="Message">
      <button className="sheet-x" aria-label="Close" onClick={onClose}>✕</button>
      <div><div className="kicker">📣 FROM {(a.sender?.full_name ?? 'G&R').split(' ')[0].toUpperCase()}{a.events ? ` · ${a.events.title.toUpperCase()}` : ''}</div><div className="muted sm">{t12(a.created_at)}</div></div>
      {a.body && <div className="ann-text">{a.body}</div>}
      {a.media.filter((m) => m.type === 'image').length > 0 && <div className="ann-grid">{a.media.filter((m) => m.type === 'image').map((m) => urls[m.path] ? <img key={m.path} src={urls[m.path]} alt="" onClick={() => setFull(urls[m.path])} /> : <span key={m.path} className="ann-ph" />)}</div>}
      {a.media.filter((m) => m.type === 'video').map((m) => urls[m.path] ? <video key={m.path} src={urls[m.path]} controls playsInline className="ann-video" /> : null)}
      {acked ? <div className="okc sm strong" style={{ textAlign: 'center' }}>✓ Got it</div> : <button className="btn-ink" onClick={async () => { await supabase.rpc('announcement_seen', { p_id: a.id, p_ack: true }); onAck(); }}>Got it ✓</button>}
    </div>
    {full && <div className="photo-view" onClick={() => setFull(null)}><img src={full} alt="" /><button className="photo-view-x">Close</button></div>}
  </>);
}

/** Staff Home: red cards for announcements not yet acknowledged. */
export function AnnounceCards({ meId }: { meId: string }) {
  const [rows, setRows] = useState<{ ann: Ann; ack: boolean }[]>([]); const [open, setOpen] = useState<Ann | null>(null);
  const load = () => supabase.from('announcement_reads').select('ack_at,announcements!inner(' + ANN_SELECT + ')').eq('staff_id', meId).is('ack_at', null)
    .then(({ data }) => setRows(((data ?? []) as unknown as { ack_at: string | null; announcements: Ann }[]).map((x) => ({ ann: x.announcements, ack: !!x.ack_at })).sort((a, b) => b.ann.created_at.localeCompare(a.ann.created_at))));
  useEffect(() => { load(); }, [meId]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = (a: Ann) => { if (!a.events) return ''; const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); return a.events.event_date === today ? ' · tonight' : ''; };
  return (<>
    {rows.map(({ ann }) => { const ph = ann.media.filter((m) => m.type === 'image').length; const vd = ann.media.filter((m) => m.type === 'video').length; return (
      <button key={ann.id} className="alert-card ann-card" onClick={() => setOpen(ann)}>
        <div className="grow" style={{ textAlign: 'left' }}><small>📣 FROM {(ann.sender?.full_name ?? 'G&R').split(' ')[0].toUpperCase()}{when(ann).toUpperCase()}{ph ? ` · ${ph} PHOTO${ph > 1 ? 'S' : ''}` : ''}{vd ? ` · ${vd} VIDEO${vd > 1 ? 'S' : ''}` : ''}</small>
          <b>{ann.body ? ann.body.slice(0, 80) : 'New message'}</b></div>
        <span className="pill-red">Open</span>
      </button>); })}
    {open && <AnnounceView a={open} acked={false} onClose={() => { setOpen(null); }} onAck={() => { setOpen(null); load(); }} />}
  </>);
}

/** Event page (staff): pinned messages from the manager. */
export function PinnedAnnouncements({ eventId }: { eventId: string }) {
  const [list, setList] = useState<Ann[]>([]); const [open, setOpen] = useState<Ann | null>(null);
  useEffect(() => { supabase.from('announcements').select(ANN_SELECT).eq('event_id', eventId).eq('pinned', true).order('created_at', { ascending: false }).then(({ data }) => setList((data ?? []) as unknown as Ann[])); }, [eventId]);
  if (!list.length) return null;
  return (<>
    <div className="d-sec">From your manager</div>
    {list.map((a) => <button key={a.id} className="ann-pin" onClick={() => setOpen(a)}><span>📣</span><span className="grow" style={{ textAlign: 'left' }}><b>{a.body.slice(0, 90) || 'Message'}</b><small>{(a.sender?.full_name ?? '').split(' ')[0]} · {t12(a.created_at)}{a.media.length ? ` · ${a.media.length} file${a.media.length > 1 ? 's' : ''}` : ''}</small></span><span>›</span></button>)}
    {open && <AnnounceView a={open} acked={false} onClose={() => setOpen(null)} onAck={() => setOpen(null)} />}
  </>);
}
