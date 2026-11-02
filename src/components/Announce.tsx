import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { smsMany } from '../lib/messages';

/* Push 25e · announcements: composer (manager + Ronnie), read status, staff card + viewer.
   Push 36 · opening = Seen, "Got it ✓" only when the sender switched on Ask for Got it (ask_got_it), staff can reply. */
export type Media = { path: string; type: 'image' | 'video'; name?: string };
export type Ann = { id: string; event_id: string | null; body: string; media: Media[]; pinned: boolean; created_at: string; audience: { kind: string; start?: string; date?: string; ids?: string[] };
  sender: { full_name: string } | null; events: { title: string; event_date: string } | null;
  /** push 36 · undefined before migration 042 (= old behaviour: Got it on everything) */
  ask_got_it?: boolean; sender_id?: string | null };
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
export const ANN_SELECT = 'id,event_id,body,media,pinned,created_at,audience,sender:staff!announcements_sender_id_fkey(full_name),events(title,event_date)';
/** push 36 columns (migration 042) + who sent it; callers fall back to ANN_SELECT when it isn't applied yet. */
export const ANN_SELECT_36 = 'id,event_id,body,media,pinned,created_at,audience,ask_got_it,sender_id,sender:staff!announcements_sender_id_fkey(full_name,role),events(title,event_date)';
export const wantsGotIt = (a: Ann) => a.ask_got_it !== false;

export async function shrink(f: File): Promise<Blob> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif') return f;
  const img = await createImageBitmap(f).catch(() => null); if (!img) return f;
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), 'image/jpeg', 0.85));
}

export type Target = { key: string; label: string; n: number; audience: Ann['audience']; event_id: string | null };
/** Composer. `targets` = the TO options (manager: whole team + each start group; admin: everyone / day / event / group / person). */
export function AnnounceComposer({ targets, folder, onSent, onClose, gotItSwitch = false, title = 'Message your team' }: { targets: Target[]; folder: string; onSent: () => void; onClose: () => void; gotItSwitch?: boolean; title?: string }) {
  const [to, setTo] = useState(targets[0]?.key ?? ''); const [body, setBody] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [pin, setPin] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [askGot, setAskGot] = useState(false); // push 36c · default off: they still see who opened it
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
      const args = { p_event: t.event_id, p_audience: t.audience, p_body: body.trim(), p_media: media, p_pinned: pin };
      let { error } = await supabase.rpc('send_announcement', { ...args, p_ask_got_it: askGot });
      if (error && /p_ask_got_it|function .* does not exist|Could not find/i.test(error.message)) ({ error } = await supabase.rpc('send_announcement', args)); // before migration 042
      if (error) throw error;
      setBusy(false); onSent();
    } catch (e) { setBusy(false); setErr((e as Error).message); }
  };
  return (
    <div className="ann-comp">
      <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{title}</div>
      <div className="ann-f"><span>TO</span><div className="row wrap" style={{ gap: 6 }}>{targets.map((x) => <button key={x.key} type="button" className={'rchip' + (to === x.key ? ' on' : '')} onClick={() => setTo(x.key)}>{x.label} · {x.n}</button>)}</div></div>
      <textarea className="ann-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Staff entrance is on the side tonight. Black aprons, not white." />
      <div className="ann-media">
        {files.map((f, i) => <span key={i} className="ann-thumb">{f.type.startsWith('video/') ? '🎬' : '🖼'} {f.name.slice(0, 14)}<button type="button" onClick={() => setFiles(files.filter((_, k) => k !== i))}>×</button></span>)}
        <label className="ann-add">+ Add photos / videos<input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 8)); e.target.value = ''; }} /></label>
      </div>
      {t?.event_id && <div className="sw-row"><button type="button" role="switch" aria-checked={pin} className={'sw' + (pin ? ' on' : '')} onClick={() => setPin(!pin)}><span className="sw-track"><span className="sw-knob" /></span><span className="sw-lbl">{pin ? 'ON' : 'OFF'}</span></button><b>Pin on the event page</b></div>}
      {gotItSwitch && <div className="sw-row"><button type="button" role="switch" aria-checked={askGot} className={'sw' + (askGot ? ' on' : '')} onClick={() => setAskGot(!askGot)}><span className="sw-track"><span className="sw-knob" /></span><span className="sw-lbl">{askGot ? 'ON' : 'OFF'}</span></button>
        <span><b>Ask for “Got it”</b><br /><small className="muted">For important rules. Off = you still see who opened it.</small></span></div>}
      {err && <p className="error">{err}</p>}
      <button className="btn-ink" disabled={busy || !t} onClick={send}>{busy ? 'Sending…' : `Send to ${t?.n ?? 0}`}</button>
      <div className="muted sm" style={{ textAlign: 'center' }}>Opening it shows as Seen. They can reply{folder !== 'all' && !gotItSwitch ? ' (to you and Ronnie)' : ''}. Videos up to 60 s / 100 MB.</div>
      <button className="btn-ghost" style={{ height: 44 }} onClick={onClose}>Close</button>
    </div>
  );
}

type Read = { staff_id: string; opened_at: string | null; ack_at: string | null; staff: { full_name: string; phone: string | null } | null };
const audienceLabel = (a: Ann, n: number) => {
  const k = a.audience?.kind;
  const who = k === 'all' ? 'To everyone' : k === 'day' && a.audience.date ? `Everyone booked · ${new Date(a.audience.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')}`
    : k === 'people' ? (n === 1 ? 'One person' : `${n} people`) : a.events ? `${a.events.title}${k === 'group' && a.audience.start ? ` · ${t12(a.audience.start)} start` : ''}` : 'Team';
  return k === 'people' && n === 1 ? who : `${who} · ${n} ${n === 1 ? 'person' : 'people'}`;
};

/** Sent announcements (push 36c): "Seen n of N" bar on each (+ Got it n/N when asked). Tap → who opened / NOT OPENED + text the ones who haven't. */
export function AnnounceSent({ eventId, reload = 0, mine = false }: { eventId?: string | null; reload?: number; mine?: boolean }) {
  const [list, setList] = useState<(Ann & { reads: Read[] })[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const run = async (cols: string) => {
      let q = supabase.from('announcements').select(cols + ',reads:announcement_reads(staff_id,opened_at,ack_at,staff:staff!announcement_reads_staff_id_fkey(full_name,phone))').order('created_at', { ascending: false }).limit(40);
      if (eventId) q = q.eq('event_id', eventId);
      if (mine) { const { data: me } = await supabase.rpc('me'); if (me) q = q.eq('sender_id', me as string); }
      return q;
    };
    (async () => { let r = await run(ANN_SELECT_36); if (r.error) r = await run(ANN_SELECT); setList(((r.data ?? []) as unknown as typeof list)); })();
  }, [eventId, reload, mine]);
  if (!list.length) return <div className="muted sm" style={{ padding: '12px 2px' }}>Nothing sent yet.</div>;
  return (
    <div className="ann-sent sent36">
      {list.map((a) => {
        const n = a.reads.length; const seen = a.reads.filter((r) => r.opened_at || r.ack_at).length; const ok = a.reads.filter((r) => r.ack_at).length;
        const got = wantsGotIt(a); const notOpened = a.reads.filter((r) => !r.opened_at && !r.ack_at);
        const sms = smsMany(notOpened.map((r) => r.staff?.phone));
        return (
          <div key={a.id} className="ann-srow">
            <button className="ann-sh s36" onClick={() => setOpen(open === a.id ? null : a.id)}>
              <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
                <span className="spread"><b>{(a.body.split('\n')[0] || `${a.media.length} file${a.media.length === 1 ? '' : 's'}`).slice(0, 70)}</b><small className="muted nowrap">{whenSent(a.created_at)}</small></span>
                <small className="muted">{audienceLabel(a, n)}{got ? ' · asked for Got it' : ''}{a.pinned ? ' · pinned' : ''}</small>
                <i className="seen-bar"><i style={{ width: `${n ? (seen / n) * 100 : 0}%` }} /></i>
                <small><b className="okc">Seen {seen} of {n}</b>{got && <b className="gold"> · Got it {ok}/{n}</b>}</small>
              </span>
            </button>
            {open === a.id && <div className="ann-reads r36">
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}><b className="okc sm">Seen {seen}</b>{notOpened.length > 0 && <b className="accent sm">Not opened {notOpened.length}</b>}</div>
              {notOpened.length > 0 && (sms ? <a className="btn-ink txt-them" href={sms}>Text the {notOpened.length === 1 ? 'one' : notOpened.length} who haven’t opened it</a>
                : <span className="muted sm">No phone numbers for the ones who haven’t opened it.</span>)}
              {[...a.reads].sort((x, y) => Number(!!(x.opened_at || x.ack_at)) - Number(!!(y.opened_at || y.ack_at)) || (x.staff?.full_name ?? '').localeCompare(y.staff?.full_name ?? '')).map((r) => {
                const at = r.opened_at ?? r.ack_at;
                return (
                  <div key={r.staff_id}><span className="grow">{r.staff?.phone ? <a href={`tel:${r.staff.phone.replace(/[^\d+]/g, '')}`}>{r.staff?.full_name}</a> : r.staff?.full_name}</span>
                    {at ? <span className="okc strong">✓ SEEN <span className="muted">{t12(at)}</span>{got && r.ack_at ? <span className="gold"> · got it</span> : ''}</span> : <span className="accent strong">NOT OPENED</span>}</div>);
              })}
              {sms && <small className="muted">Opens your Messages app with their numbers. The app never sends texts by itself.</small>}
            </div>}
          </div>);
      })}
    </div>
  );
}
const whenSent = (iso: string) => {
  const d = new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }); const t = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  return d === t ? `Today ${t12(iso)}` : new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Toronto' }).replace(',', '');
};

/** Staff: one announcement, full (photos 2-col, tap = full screen, video player). Opening = Seen. Got it ✓ only when asked. Reply box (push 36). */
export function AnnounceView({ a, onClose, onAck, acked, canReply = true }: { a: Ann; onClose: () => void; onAck: () => void; acked: boolean; canReply?: boolean }) {
  const [urls, setUrls] = useState<Record<string, string>>({}); const [full, setFull] = useState<string | null>(null);
  const [reply, setReply] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const nav = useNavigate();
  useEffect(() => {
    supabase.rpc('announcement_seen', { p_id: a.id, p_ack: false });
    if (a.media.length) supabase.storage.from('announcements').createSignedUrls(a.media.map((m) => m.path), 3600).then(({ data }) => setUrls(Object.fromEntries((data ?? []).map((d, i) => [a.media[i].path, d.signedUrl]))));
  }, [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = (a.sender?.full_name ?? 'G&R').split(' ')[0];
  const send = async () => {
    if (!reply.trim()) return; setBusy(true); setErr('');
    const { data: c, error } = await supabase.rpc('open_reply_thread', { p_announcement: a.id });
    if (error || !c) { setBusy(false); setErr(error?.message ?? 'Could not reply.'); return; }
    const r = await supabase.rpc('send_message', { p_conversation: c as string, p_body: reply.trim(), p_topic: null, p_shift: null, p_photos: [], p_announcement: a.id });
    setBusy(false); if (r.error) { setErr(r.error.message); return; }
    const { data: conv } = await supabase.from('conversations').select('kind,event_id').eq('id', c as string).maybeSingle();
    onClose(); nav(conv?.kind === 'manager' && conv.event_id ? `/messages?c=mgr:${conv.event_id}` : '/messages?c=ronnie');
  };
  return (<>
    <div className="scrim" onClick={onClose} />
    <div className="sheet swipe" role="dialog" aria-label="Message">
      <button className="sheet-x" aria-label="Close" onClick={onClose}>✕</button>
      <div><div className="kicker">📣 FROM {from.toUpperCase()}{a.events ? ` · ${a.events.title.toUpperCase()}` : ''}</div><div className="muted sm">{t12(a.created_at)}</div></div>
      {a.body && <div className="ann-text">{a.body}</div>}
      {a.media.filter((m) => m.type === 'image').length > 0 && <div className="ann-grid">{a.media.filter((m) => m.type === 'image').map((m) => urls[m.path] ? <img key={m.path} src={urls[m.path]} alt="" onClick={() => setFull(urls[m.path])} /> : <span key={m.path} className="ann-ph" />)}</div>}
      {a.media.filter((m) => m.type === 'video').map((m) => urls[m.path] ? <video key={m.path} src={urls[m.path]} controls playsInline className="ann-video" /> : null)}
      {wantsGotIt(a) && (acked ? <div className="okc sm strong" style={{ textAlign: 'center' }}>✓ Got it</div> : <button className="btn-ink" onClick={async () => { await supabase.rpc('announcement_seen', { p_id: a.id, p_ack: true }); onAck(); }}>Got it ✓</button>)}
      {!wantsGotIt(a) && <div className="muted sm" style={{ textAlign: 'center' }}>{from} sees that you opened it.</div>}
      {canReply && a.ask_got_it !== undefined && <div className="ann-reply">
        <input value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Reply to ${from}…`} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} />
        <button aria-label="Send" disabled={busy || !reply.trim()} onClick={send}>↑</button>
      </div>}
      {err && <p className="error">{err}</p>}
    </div>
    {full && <div className="photo-view" onClick={() => setFull(null)}><img src={full} alt="" /><button className="photo-view-x">Close</button></div>}
  </>);
}

/** Staff Home (before push 36): red cards for announcements not yet acknowledged. Push 36 Home uses MessageCard instead. */
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
  useEffect(() => {
    const q = (cols: string) => supabase.from('announcements').select(cols).eq('event_id', eventId).eq('pinned', true).order('created_at', { ascending: false });
    (async () => { let r = await q(ANN_SELECT_36); if (r.error) r = await q(ANN_SELECT); setList((r.data ?? []) as unknown as Ann[]); })();
  }, [eventId]);
  if (!list.length) return null;
  return (<>
    <div className="d-sec">From your manager</div>
    {list.map((a) => <button key={a.id} className="ann-pin" onClick={() => setOpen(a)}><span>📣</span><span className="grow" style={{ textAlign: 'left' }}><b>{a.body.slice(0, 90) || 'Message'}</b><small>{(a.sender?.full_name ?? '').split(' ')[0]} · {t12(a.created_at)}{a.media.length ? ` · ${a.media.length} file${a.media.length > 1 ? 's' : ''}` : ''}</small></span><span>›</span></button>)}
    {open && <AnnounceView a={open} acked={false} onClose={() => setOpen(null)} onAck={() => setOpen(null)} />}
  </>);
}
