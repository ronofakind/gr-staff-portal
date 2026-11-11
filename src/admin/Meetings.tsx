import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { QuarterTime } from '../components/QuarterTime';
import { AddressInput } from '../components/AddressInput';
import { MeetingNotes, PlaceBadge } from '../components/Meeting';
import { smsMany } from '../lib/messages';
import {
  LENGTHS, PLACES, canMeet, dayOfMtl, dayShort, hm24, isOver, lengthLabel, mtlIso, placeName, safeLink, t12, todayMtl,
  type MeetingPage, type MeetingRow, type MeetingHours, type PlaceKind,
} from '../lib/meetings';
import { allStaff, addDays, dLabel, type AStaff } from './api';

/* Push 38 · admin: Meetings list, New / Edit meeting, the meeting page (who's coming, notes to the event, paid hours). Migration 043. */

export type AMeeting = MeetingRow & { meeting_invites: { staff_id: string; answer: 'coming' | 'cant' | null }[] };
const M_SELECT = 'id,title,starts_at,duration_min,place_kind,link,address,about,notes_visibility,created_at,updated_at,cancelled_at,meeting_invites(staff_id,answer)';
type EvLite = { id: string; title: string; event_date: string; department: string };

/** Meetings starting between two Montreal dates (inclusive). [] when migration 043 isn't applied. */
export async function meetingsBetween(from: string, to: string, withCancelled = false) {
  let q = supabase.from('meetings').select(M_SELECT).gte('starts_at', mtlIso(from, '00:00')).lt('starts_at', mtlIso(addDays(to, 1), '00:00')).order('starts_at');
  if (!withCancelled) q = q.is('cancelled_at', null);
  const { data, error } = await q;
  return error ? [] : ((data ?? []) as unknown as AMeeting[]);
}
const counts = (m: { meeting_invites: { answer: string | null }[] }) => ({
  coming: m.meeting_invites.filter((i) => i.answer === 'coming').length,
  cant: m.meeting_invites.filter((i) => i.answer === 'cant').length,
  none: m.meeting_invites.filter((i) => !i.answer).length,
});

/** One line for Today / Week / the list. */
export function MeetingLine({ m, showDay = true }: { m: AMeeting; showDay?: boolean }) {
  const c = counts(m);
  return (
    <Link to={`/admin/meeting/${m.id}`} className={'mtg-line' + (m.cancelled_at ? ' gone' : '')}>
      <PlaceBadge kind={m.place_kind} size={30} />
      <span className="grow" style={{ minWidth: 0 }}>
        <b>{m.title}</b>
        <small>{showDay ? `${dayShort(m.starts_at)} · ` : ''}{t12(m.starts_at)} · {placeName(m)} · {lengthLabel(m.duration_min)}</small>
      </span>
      {m.cancelled_at ? <span className="mtg-tag no">CANCELLED</span>
        : <span className="mtg-counts"><span className="okc">Coming {c.coming}</span><span className="accent">Can’t {c.cant}</span><span className="muted">No answer {c.none}</span></span>}
      <span className="muted">›</span>
    </Link>
  );
}

/** Today + Week: meetings in a date range (nothing when there are none, unless `always`). */
export function MeetingsStrip({ from, to, title = 'Meetings', always = false }: { from: string; to: string; title?: string; always?: boolean }) {
  const [list, setList] = useState<AMeeting[] | null>(null);
  useEffect(() => { meetingsBetween(from, to).then(setList); }, [from, to]);
  if (!list || (!list.length && !always)) return null;
  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="sec"><span className="serif">{title}</span><span className="row" style={{ gap: 12 }}><Link to="/admin/meeting/new">+ New meeting</Link><Link to="/admin/meetings">All ›</Link></span></div>
      <div className="adm-card" style={{ padding: '4px 14px' }}>
        {!list.length && <div className="muted sm" style={{ padding: '12px 0' }}>No meetings.</div>}
        {list.map((m) => <MeetingLine key={m.id} m={m} showDay={from !== to} />)}
      </div>
    </section>
  );
}

/* ───────── list ───────── */
export function Meetings() {
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const [list, setList] = useState<AMeeting[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => {
    setList(null);
    const now = new Date().toISOString();
    const q = supabase.from('meetings').select(M_SELECT);
    (tab === 'up' ? q.gte('starts_at', new Date(Date.now() - 12 * 3600e3).toISOString()).order('starts_at') : q.lt('starts_at', now).order('starts_at', { ascending: false }).limit(60))
      .then(({ data, error }) => { if (error) setErr('Meetings need migration 043 (Supabase SQL editor).'); setList(((data ?? []) as unknown as AMeeting[]).filter((m) => tab === 'past' || !isOver(m) || dayOfMtl(m.starts_at) === todayMtl())); });
  }, [tab]);
  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="kick">YOUR ADMIN · MEETINGS</div><h1 className="serif-h">Meetings</h1><div className="muted sm">Teams, Zoom or office meetings with your managers. Paid like a shift.</div></div>
        <Link className="abtn dark" to="/admin/meeting/new">+ New meeting</Link>
      </div>
      <div className="seg"><button className={tab === 'up' ? 'on' : ''} onClick={() => setTab('up')}>Upcoming</button><button className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Past</button></div>
      {err && <p className="error">{err}</p>}
      <div className="adm-card" style={{ padding: '4px 14px' }}>
        {list === null ? <div className="muted sm" style={{ padding: 12 }}>Loading…</div>
          : !list.length ? <div className="muted sm" style={{ padding: '12px 0' }}>{tab === 'up' ? 'No meetings coming up.' : 'No past meetings.'}</div>
          : list.map((m) => <MeetingLine key={m.id} m={m} />)}
      </div>
    </div>
  );
}

/* ───────── new / edit ───────── */
export function MeetingForm() {
  const { id } = useParams(); const nav = useNavigate(); const [sp] = useSearchParams();
  const [staff, setStaff] = useState<AStaff[]>([]);
  const [events, setEvents] = useState<EvLite[]>([]);
  const [f, setF] = useState({ title: '', date: '', start: '11:00', dur: 60, place: 'teams' as PlaceKind, link: '', address: '', about: '' });
  const [md, setMd] = useState<string>(''); // push 80 · Ronnie picks the meeting MD
  const [inv, setInv] = useState<string[]>([]); const [evIds, setEvIds] = useState<string[]>(sp.get('event') ? [sp.get('event')!] : []);
  const [q, setQ] = useState(''); const [pick, setPick] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    allStaff().then(setStaff).catch(() => setStaff([]));
    const today = todayMtl();
    supabase.from('events').select('id,title,event_date,department').gte('event_date', addDays(today, -30)).lte('event_date', addDays(today, 240)).order('event_date')
      .then(({ data }) => setEvents((data ?? []) as EvLite[]));
    if (id) supabase.rpc('meeting_page', { p_meeting: id }).then(({ data }) => {
      const p = data as MeetingPage | null; if (!p) { setErr('Meeting not found.'); return; }
      const m = p.meeting;
      setF({ title: m.title, date: dayOfMtl(m.starts_at), start: hm24(m.starts_at), dur: m.duration_min, place: m.place_kind, link: m.link ?? '', address: m.address ?? '', about: m.about ?? '' });
      setInv(p.invites.map((i) => i.staff_id)); setEvIds(p.events.map((e) => e.id)); setMd(m.md_id ?? ''); setLoaded(true);
    });
  }, [id]);

  const eligible = useMemo(() => staff.filter((s) => canMeet(s) || inv.includes(s.id)).sort((a, b) => a.full_name.localeCompare(b.full_name)), [staff, inv]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = eligible.filter((s) => words.every((w) => (s.full_name + ' ' + (s.nickname ?? '')).toLowerCase().includes(w)));
  const nameOf = (sid: string) => { const s = staff.find((x) => x.id === sid); return s ? (s.nickname || s.full_name.split(' ')[0]) : '…'; };
  const toggle = (sid: string) => setInv((v) => (v.includes(sid) ? v.filter((x) => x !== sid) : [...v, sid]));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setErr('');
    if (!f.title.trim()) { setErr('Add a title.'); return; }
    if (!f.date || !f.start) { setErr('Pick a date and a start time.'); return; }
    if (f.place === 'in_person' && !f.address.trim()) { setErr('Add the address.'); return; }
    if (f.place !== 'in_person' && f.link.trim() && !safeLink(f.link)) { setErr('The link should start with https://'); return; }
    if (!inv.length) { setErr('Invite at least one person.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('admin_save_meeting', {
      p_id: id ?? null, p_title: f.title, p_starts_at: mtlIso(f.date, f.start), p_duration_min: f.dur, p_place_kind: f.place,
      p_link: f.place === 'in_person' ? null : f.link, p_address: f.place === 'in_person' ? f.address : null, p_about: f.about, p_invite: inv, p_events: evIds,
    });
    if (!error) { const e2 = await supabase.rpc('admin_set_meeting_md', { p_meeting: data as string, p_md: md && inv.includes(md) ? md : null }); if (e2.error) { setBusy(false); setErr(e2.error.message); return; } }
    setBusy(false);
    if (error) { setErr(error.message); return; }
    nav(`/admin/meeting/${data as string}`, { replace: true });
  };

  if (!loaded) return <div className="muted">{err || 'Loading…'}</div>;
  const evLabel = (e: EvLite) => `${dLabel(e.event_date)} · ${e.title}${e.department === 'bar' ? ' · BAR' : ''}`;
  return (
    <div className="stack-lg mtg-form">
      <div><div className="kick">YOUR ADMIN · {id ? 'EDIT' : 'NEW'}</div><h1 className="serif-h">{id ? 'Edit meeting' : 'New meeting'}</h1></div>
      <div className="adm-card stack" style={{ gap: 14, maxWidth: 560 }}>
        <label className="mtg-f"><small>TITLE</small><input className="mtg-in" value={f.title} placeholder="Cavarose · team meeting" onChange={(e) => set('title', e.target.value)} /></label>
        <div className="row2">
          <label className="mtg-f"><small>DATE</small><input className="mtg-in" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
          <div className="mtg-f"><small>START</small><QuarterTime className="mtg-in qt" value={f.start} onChange={(v) => set('start', v)} label="Start" /></div>
        </div>
        <div className="mtg-f"><small>HOW LONG</small><div className="seg">{LENGTHS.map((l) => <button key={l.min} className={f.dur === l.min ? 'on' : ''} onClick={() => set('dur', l.min)}>{l.label}</button>)}</div>
          <span className="muted sm">Paid hours = this length from the start, for everyone who says Coming (or In → Out when the MD clocks people).</span></div>
        <div className="mtg-f"><small>WHERE</small><div className="seg">{PLACES.map((p) => <button key={p.k} className={f.place === p.k ? 'on' : ''} onClick={() => set('place', p.k)}>{p.label}</button>)}</div></div>
        {f.place === 'in_person'
          ? <div className="mtg-f"><small>ADDRESS</small><AddressInput className="mtg-in" value={f.address} onChange={(v) => set('address', v)} onPick={(p) => set('address', p.formatted)} placeholder="Street, city" /></div>
          : <label className="mtg-f"><small>{f.place === 'zoom' ? 'ZOOM LINK' : 'TEAMS LINK'}</small><input className="mtg-in" value={f.link} inputMode="url" placeholder={f.place === 'zoom' ? 'https://zoom.us/j/…' : 'https://teams.microsoft.com/l/meetup-join/…'} onChange={(e) => set('link', e.target.value)} />
            <span className="muted sm">You can add it later. The Join button opens 10 min before.</span></label>}

        <div className="mtg-f"><small>INVITE · MANAGERS ONLY</small>
          <button className="mtg-in mtg-pickbtn" onClick={() => setPick(!pick)}>{inv.length ? inv.map(nameOf).join(' · ') : 'Pick managers'} <b>＋</b></button>
          {pick && <div className="mtg-picker">
            <input className="mtg-in" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mtg-plist">
              {shown.map((s) => (
                <button key={s.id} className={'mtg-prow' + (inv.includes(s.id) ? ' on' : '')} onClick={() => toggle(s.id)}>
                  <Avatar name={s.full_name} url={s.photo_url} size={28} /><span className="grow">{s.full_name}<small>{s.role === 'manager' ? 'Manager' : (s.positions ?? []).filter((p) => ['MD', 'BM', '2IC'].includes(p.toUpperCase())).join(' · ') || 'MD'}</small></span>
                  <span className="mtg-check">{inv.includes(s.id) ? '✓' : ''}</span>
                </button>))}
              {!shown.length && <div className="muted sm" style={{ padding: 8 }}>No managers match.</div>}
            </div>
            <span className="muted sm">Lists managers, MDs, bar managers and 2ICs (role or position on their profile).</span>
          </div>}
        </div>

        {inv.length > 0 && <div className="mtg-f"><small>MEETING MD · CLOCKS PEOPLE IN / OUT</small>
          <select className="mtg-in" value={inv.includes(md) ? md : ''} onChange={(e) => setMd(e.target.value)}>
            <option value="">No MD (everyone Coming is paid for the set length)</option>
            {inv.map((sid) => <option key={sid} value={sid}>{staff.find((x) => x.id === sid)?.full_name ?? nameOf(sid)}</option>)}
          </select>
          <span className="muted sm">The MD taps In / Out for each person on the call. Paid from In to Out, 15-min rounding, no 4-hour minimum.</span></div>}

        <div className="mtg-f"><small>FOR THIS EVENT (OPTIONAL)</small>
          {evIds.map((eid) => { const e = events.find((x) => x.id === eid); return (
            <div key={eid} className="mtg-ev"><span className="mtg-ev-ic" aria-hidden="true">🗓</span><span className="grow">{e ? evLabel(e) : 'Event'}</span><button className="lnk" aria-label="Unlink" onClick={() => setEvIds((v) => v.filter((x) => x !== eid))}>✕</button></div>); })}
          <select className="mtg-in" value="" onChange={(e) => { const v = e.target.value; if (v && !evIds.includes(v)) setEvIds([...evIds, v]); }}>
            <option value="">{evIds.length ? '+ Link another event' : '+ Link an event'}</option>
            {events.filter((e) => !evIds.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{evLabel(e)}</option>)}
          </select>
          <span className="muted sm">Notes you pin show on that event page as “From the meeting”.</span>
        </div>

        <label className="mtg-f"><small>NOTE (OPTIONAL)</small><textarea className="mtg-in" rows={3} value={f.about} placeholder="What it’s about" onChange={(e) => set('about', e.target.value)} /></label>
        {err && <p className="error">{err}</p>}
        <button className="mtg-submit" disabled={busy} onClick={save}>{busy ? 'Saving…' : id ? 'Save changes' : `Invite ${inv.length || ''} ${inv.length === 1 ? 'person' : 'people'}`.replace('  ', ' ')}</button>
        {id && <span className="muted sm">Changing the time, length or link updates everyone’s app and G&amp;R calendar.</span>}
      </div>
    </div>
  );
}

/* ───────── the meeting (admin) ───────── */
export function MeetingAdmin() {
  const { id } = useParams(); const nav = useNavigate();
  const [p, setP] = useState<MeetingPage | null | undefined>(undefined);
  const [hours, setHours] = useState<MeetingHours[]>([]);
  const [events, setEvents] = useState<EvLite[]>([]);
  const [err, setErr] = useState('');
  const load = async () => {
    const { data, error } = await supabase.rpc('meeting_page', { p_meeting: id });
    const page = error ? null : ((data as MeetingPage | null) ?? null); setP(page);
    if (page) { const d = dayOfMtl(page.meeting.starts_at); const { data: h } = await supabase.rpc('meeting_hours', { p_from: d, p_to: d }); setHours(((h ?? []) as MeetingHours[]).filter((x) => x.meeting_id === id)); }
  };
  useEffect(() => {
    load();
    const today = todayMtl();
    supabase.from('events').select('id,title,event_date,department').gte('event_date', addDays(today, -30)).lte('event_date', addDays(today, 240)).order('event_date')
      .then(({ data }) => setEvents((data ?? []) as EvLite[]));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (p === undefined) return <div className="muted">Loading…</div>;
  if (p === null) return <div className="stack"><p className="error">Meeting not found (or migration 043 isn’t applied yet).</p><Link to="/admin/meetings">‹ Meetings</Link></div>;
  const m = p.meeting; const gone = !!m.cancelled_at;
  const c = { coming: p.invites.filter((i) => i.answer === 'coming'), cant: p.invites.filter((i) => i.answer === 'cant'), none: p.invites.filter((i) => !i.answer) };
  const sms = smsMany(c.none.map((i) => i.phone));
  const live = p.notes.filter((n) => !n.deleted_at);
  const pinned = live.filter((n) => n.pinned).length;
  const run = async (fn: () => PromiseLike<{ error: { message: string } | null }>) => { setErr(''); const { error } = await fn(); if (error) setErr(error.message); else load(); };
  const cancel = () => { if (window.confirm(`Cancel “${m.title}”? Everyone invited gets an update and it leaves their calendar.`)) run(() => supabase.rpc('admin_cancel_meeting', { p_id: m.id })); };
  const evLabel = (e: { title: string; event_date: string; department: string }) => `${dLabel(e.event_date)} · ${e.title}${e.department === 'bar' ? ' · BAR' : ''}`;
  const url = safeLink(m.link);

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><Link to="/admin/meetings" className="kick">‹ YOUR ADMIN · MEETINGS</Link><h1 className="serif-h">{m.title}</h1>
          <div className="muted sm">{dayShort(m.starts_at)} · {t12(m.starts_at)} · {m.place_kind === 'in_person' ? m.address : placeName(m)} · {lengthLabel(m.duration_min)}</div></div>
      </div>
      {gone && <div className="adm-card"><b className="accent">Cancelled {dLabel(dayOfMtl(m.cancelled_at!))}.</b> <span className="muted sm">Everyone invited got an update; it’s off their calendars and nobody is paid for it.</span></div>}
      {err && <p className="error">{err}</p>}

      <div className="two-col">
        <section className="stack">
          <div className="sec"><span className="serif">Who’s coming</span></div>
          <div className="adm-card stack" style={{ gap: 10 }}>
            <div className="mtg-sum"><span className="okc">Coming {c.coming.length}</span><span className="accent">Can’t {c.cant.length}</span><span className="muted">No answer {c.none.length}</span></div>
            <div>{p.invites.map((i) => (
              <div key={i.staff_id} className="mtg-who-row">
                <Avatar name={i.full_name} url={i.photo_url} size={36} /><b className="grow">{i.full_name}</b>
                {i.answer === 'coming' ? <span className="mtg-tag ok">✓ COMING</span> : i.answer === 'cant' ? <span className="mtg-tag no">CAN’T MAKE IT</span> : <span className="mtg-tag grey">NO ANSWER</span>}
              </div>))}</div>
            {!gone && c.none.length > 0 && (sms
              ? <a className="mtg-submit" href={sms}>Text the {c.none.length} who {c.none.length === 1 ? 'hasn’t' : 'haven’t'} answered</a>
              : <span className="muted sm">No phone numbers for the {c.none.length} who haven’t answered.</span>)}
            {!gone && <div className="row2"><Link className="abtn" to={`/admin/meeting/${m.id}/edit`}>Edit</Link><button className="abtn danger" onClick={cancel}>Cancel meeting</button></div>}
            {m.place_kind !== 'in_person' && <div className="muted sm">{url ? <>Link: <a href={url} target="_blank" rel="noreferrer" className="lnk">{url.length > 48 ? url.slice(0, 48) + '…' : url}</a></> : 'No link yet. Add it with Edit.'}</div>}
            {m.about && <div className="note">{m.about}</div>}
          </div>

          {!gone && <PaidHours m={m} hours={hours} onSaved={load} />}
        </section>

        <section className="stack">
          <div className="sec"><span className="serif">Save notes to the event</span></div>
          <div className="adm-card stack" style={{ gap: 10 }}>
            {p.events.map((e) => (
              <div key={e.id} className="mtg-ev"><span className="mtg-ev-ic" aria-hidden="true">🗓</span>
                <span className="grow" style={{ minWidth: 0 }}><b>{e.title}</b><small>{dLabel(e.event_date)} · {e.venue}</small></span>
                <span className="mtg-linked">LINKED</span><button className="lnk" aria-label="Unlink" onClick={() => run(() => supabase.rpc('admin_link_meeting_event', { p_meeting: m.id, p_event: e.id, p_on: false }))}>✕</button></div>))}
            <select className="mtg-in" value="" onChange={(e) => { const v = e.target.value; if (v) run(() => supabase.rpc('admin_link_meeting_event', { p_meeting: m.id, p_event: v, p_on: true })); }}>
              <option value="">{p.events.length ? '＋ Link another event' : '＋ Link the event it’s for'}</option>
              {events.filter((e) => !p.events.some((x) => x.id === e.id)).map((e) => <option key={e.id} value={e.id}>{evLabel(e)}</option>)}
            </select>

            <div className="mtg-pinhead"><b>Show on the event page</b><span className="muted sm">{pinned} of {live.length}</span></div>
            {!live.length && <div className="muted sm">No notes yet. Notes added below (by you or anyone invited) show up here.</div>}
            {live.map((n) => (
              <div key={n.id} className="mtg-pinrow">
                <span className="grow">{n.body}<small className="muted"> · {(n.author_nickname || n.author || '').split(' ')[0]}</small></span>
                <button role="switch" aria-checked={n.pinned} aria-label="Show on the event page" className={'mtg-switch' + (n.pinned ? ' on' : '')}
                  onClick={() => run(() => supabase.rpc('pin_meeting_note', { p_id: n.id, p_on: !n.pinned }))}><i /></button>
              </div>))}
            <div className="mtg-f"><small>WHO SEES THEM ON THE EVENT</small>
              <div className="seg"><button className={m.notes_visibility === 'managers' ? 'on' : ''} onClick={() => run(() => supabase.rpc('admin_meeting_visibility', { p_meeting: m.id, p_visibility: 'managers' }))}>Managers</button>
                <button className={m.notes_visibility === 'team' ? 'on' : ''} onClick={() => run(() => supabase.rpc('admin_meeting_visibility', { p_meeting: m.id, p_visibility: 'team' }))}>Whole team</button></div></div>
            <span className="muted sm">Pinned notes show near the top of the event page as “From the meeting”{p.events.length ? '' : ', once the meeting is linked to an event'}. Everyone invited always sees all the notes here.</span>
          </div>

          <div className="sec"><span className="serif">Notes · {live.length}</span></div>
          <div className="adm-card"><MeetingNotes meetingId={m.id} meetingStart={m.starts_at} notes={p.notes} meId={p.me} onChanged={load} /></div>
        </section>
      </div>
      <div><button className="lnk" onClick={() => nav('/admin/meetings')}>‹ All meetings</button></div>
    </div>
  );
}

/** Paid hours per person (like any hours): automatic = Coming → the set length from the start. */
function PaidHours({ m, hours, onSaved }: { m: MeetingRow; hours: MeetingHours[]; onSaved: () => void }) {
  const [edit, setEdit] = useState<{ sid: string; paid: boolean | null; in: string; out: string } | null>(null);
  const [err, setErr] = useState('');
  const d = dayOfMtl(m.starts_at);
  const save = async () => {
    if (!edit) return; setErr('');
    const pin = edit.in ? mtlIso(d, edit.in) : null; let pout = edit.out ? mtlIso(d, edit.out) : null;
    if (pin && pout && pout <= pin) pout = new Date(new Date(pout).getTime() + 864e5).toISOString();
    const st = new Date(m.starts_at).getTime();
    const auto = !!pin && !!pout && new Date(pin).getTime() === st && new Date(pout).getTime() === st + m.duration_min * 60000; // default times → keep them automatic
    const { error } = await supabase.rpc('admin_set_meeting_hours', { p_meeting: m.id, p_staff: edit.sid, p_paid: edit.paid, p_in: auto ? null : pin, p_out: auto ? null : pout });
    if (error) setErr(error.message); else { setEdit(null); onSaved(); }
  };
  const total = hours.reduce((n, h) => n + Number(h.hours), 0);
  return (<>
    <div className="sec"><span className="serif">Paid hours</span><span className="muted sm">{total} h · {isOver(m) ? 'in Hours + the APP tab' : 'counted once it ends'}</span></div>
    <div className="adm-card" style={{ padding: '4px 16px' }}>
      {hours.map((h) => edit?.sid === h.staff_id ? (
        <div key={h.staff_id} className="mtg-hrow edit">
          <b>{h.full_name}</b>
          <div className="seg"><button className={edit.paid === null ? 'on' : ''} onClick={() => setEdit({ ...edit, paid: null })}>Auto</button><button className={edit.paid === true ? 'on' : ''} onClick={() => setEdit({ ...edit, paid: true })}>Paid</button><button className={edit.paid === false ? 'on' : ''} onClick={() => setEdit({ ...edit, paid: false })}>Not paid</button></div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><QuarterTime className="tin" label="Start" value={edit.in} onChange={(v) => setEdit({ ...edit, in: v })} /><QuarterTime className="tin" label="End" value={edit.out} onChange={(v) => setEdit({ ...edit, out: v })} />
            <button className="abtn sm dark" onClick={save}>Save</button><button className="abtn sm" onClick={() => setEdit(null)}>Cancel</button></div>
          <span className="muted sm">Auto = paid when they said Coming.</span>
        </div>
      ) : (
        <button key={h.staff_id} className="mtg-hrow" onClick={() => setEdit({ sid: h.staff_id, paid: h.auto ? null : h.paid, in: hm24(h.paid_in), out: hm24(h.paid_out) })}>
          <span className="grow" style={{ textAlign: 'left' }}><b>{h.full_name}</b><small>{h.paid ? `${t12(h.paid_in)} – ${t12(h.paid_out)}` : h.answer === 'cant' ? 'Can’t make it' : h.answer ? '' : 'No answer'}{h.auto ? '' : ' · set by you'}</small></span>
          <b className={h.paid ? 'okc' : 'muted'}>{h.paid ? `${Number(h.hours)} h` : 'not paid'}</b><span className="muted sm">Edit</span>
        </button>))}
      {!hours.length && <div className="muted sm" style={{ padding: '12px 0' }}>Nobody invited.</div>}
      {err && <p className="error">{err}</p>}
    </div>
  </>);
}

/** push 80 · Bookings: the day's meetings (Teams colour) with the MD and who's coming. "+ Add" = edit the invite list. */
export function BookingsMeetings({ date }: { date: string }) {
  const [list, setList] = useState<MeetingPage[]>([]);
  useEffect(() => { (async () => {
    const ms = await meetingsBetween(date, date);
    const pages = await Promise.all(ms.map((m) => supabase.rpc('meeting_page', { p_meeting: m.id }).then(({ data }) => data as MeetingPage | null)));
    setList(pages.filter(Boolean) as MeetingPage[]);
  })(); }, [date]);
  if (!list.length) return null;
  return <>{list.map((p) => {
    const m = p.meeting; const md = p.invites.find((i) => i.staff_id === m.md_id);
    return (
      <div key={m.id} className="bk-mtg">
        <div className="bk-mtg-top"><Link to={`/admin/meeting/${m.id}`}><b>📹 Meeting · {m.title}</b></Link><span className="bk-mtg-when">{placeName(m).toUpperCase()} · {t12(m.starts_at)} · {lengthLabel(m.duration_min)}</span></div>
        {p.events.length > 0 && <small className="muted">About: {p.events.map((e) => `${e.title} · ${dayShort(e.event_date + 'T12:00:00')}`).join(' · ')}</small>}
        <div className="bk-mtg-ppl">
          {md && <span className="bk-mtg-p"><b>MD</b> {md.full_name}</span>}
          {p.invites.filter((i) => i.staff_id !== m.md_id).map((i) => <span key={i.staff_id} className={'bk-mtg-p' + (i.answer === 'cant' ? ' no' : '')}>{i.full_name}{i.answer === 'coming' ? ' ✓' : i.answer === 'cant' ? ' · can’t' : ''}</span>)}
          {!md && <Link className="bk-mtg-p add" to={`/admin/meeting/${m.id}/edit`}>Pick the MD</Link>}
          <Link className="bk-mtg-p add" to={`/admin/meeting/${m.id}/edit`}>+ Add</Link>
        </div>
      </div>);
  })}</>;
}
