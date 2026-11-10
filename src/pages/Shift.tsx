import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase, SHIFT_SELECT, isSetup, type ShiftRow } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { minus, mapsUrl } from '../lib/format';
import { Avatar, PhotoViewer } from '../components/Avatar';
import { UniformIcon, uniformFor, uniformLabel, PantsIcon, ShoesIcon, ApronIcon, TieIcon, WineKeyIcon, isBarPos, lineKey, PIECE } from '../components/Uniform';
import { Status, isBar, StartPos, BigTime } from './Home';
import { GettingThere } from '../components/GettingThere';
import { PinnedAnnouncements } from '../components/Announce';
import { MessageRonnieLink } from '../components/MessageCard';
import { useMyCalendar, addCalendar, defaultCalOs } from '../lib/calendar';
import { NeedChange, CancelSheet, ChangeSheet, ChangeCard, CancelledCard, useShiftChanges } from '../components/ShiftChange';
import { FromTheMeeting } from '../components/Meeting';
import { useSettings } from '../lib/settings';
import { feedbackOn, Stars } from './Manage';
import { managesShift, loadTeamSums, type TeamSum } from '../lib/pastEvents';
import { mtlToday, addDays } from '../lib/myDates';
import { shiftNotes, noteSeen, type ShiftNote } from '../lib/staffNotes';
import { PinMap, pinDirections } from '../components/VenuePin';
import { StaffLinks, mergeLinks } from '../components/Links';
import { FirstCut } from '../components/FirstCut';

export function Shift({ backTo = '/' }: { backTo?: string }) {
  const { id } = useParams();
  const [s, setS] = useState<ShiftRow | null>(null);
  const [md, setMd] = useState<{ full_name: string; photo_url: string | null; phone: string | null } | null>(null);
  const [team, setTeam] = useState<TeamGroup[] | undefined>(undefined);
  const [who, setWho] = useState<{ id: string; full_name: string } | null>(null);
  const [q] = useSearchParams();

  useEffect(() => {
    supabase.from('shifts').select(SHIFT_SELECT + ',staff_id,who:staff!shifts_staff_id_fkey(full_name),punches(punch_in,punch_out)').eq('id', id!).single().then(({ data }) => {
      const row = data as unknown as ShiftRow & { staff_id?: string; who?: { full_name: string } | null }; setS(row);
      if (row?.staff_id) setWho({ id: row.staff_id, full_name: row.who?.full_name ?? '' });
      if (row && (row.position_code === 'MD' || row.position_code === 'BM'))
        supabase.from('shifts').select('planned_start,status,attendance,staff:staff!shifts_staff_id_fkey(full_name,photo_url)').eq('event_id', row.events.id).neq('status', 'declined').then(({ data: crew }) => {
          const m = new Map<string, Face[]>();
          for (const c of (crew ?? []) as unknown as { planned_start: string; attendance: string | null; staff: Face | null }[]) if (!c.attendance) { const l = m.get(c.planned_start) ?? []; l.push(c.staff ?? { full_name: '?', photo_url: null }); m.set(c.planned_start, l); }
          setTeam([...m.entries()].sort().map(([k, f]) => ({ start: k, label: new Date(k).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }), n: f.length, faces: f.slice(0, 3) })));
        });
      // "Look for" = the MD on site (falls back to the event manager).
      if (row) supabase.rpc('event_md', { p_event: row.events.id }).then(({ data: m }) => { const x = Array.isArray(m) ? (m as typeof md[])[0] : null; setMd(x?.full_name ? x : null); });
    });
  }, [id]);

  if (!s) return <div className="loading" />;
  // push 51 · past mode: opened from My dates → Past, or any shift on an earlier day
  const past = q.get('past') === '1' || s.events.event_date < mtlToday();
  return <ShiftView s={s} lead={md ?? s.events.manager} backTo={past && backTo === '/' ? '/my-dates?tab=past' : backTo} team={team} past={past ? who : undefined} />;
}

/**
 * push 51 · past event page, manager part: YOUR TEAM (ended · no-show · hours sent or not → the team screen, editable until
 * hours are submitted) + NEW STAFF · RATE WITHIN 7 DAYS (★ Rate opens the push 30 window on the team screen, or their stars).
 */
function PastManager({ eventId, eventDate, sentAt, me }: { eventId: string; eventDate: string; sentAt: string | null; me: { id: string; full_name: string } }) {
  useSettings(); const fbOn = feedbackOn(me);
  const [sum, setSum] = useState<TeamSum | null>(null);
  useEffect(() => { loadTeamSums([eventId], fbOn, me.id).then((m) => setSum(m[eventId] ?? null)); }, [eventId, fbOn, me.id]);
  if (!sum) return <section className="pe-card"><div className="loading" style={{ minHeight: 60 }} /></section>;
  const ord = ['1st', '2nd', '3rd'];
  const open = mtlToday() <= addDays(eventDate, 7);
  return <>
    <section className="pe-card">
      <span className="kicker">Your team · {sum.team}</span>
      <div className="pe-line">{sum.ended} ended{sum.noShow ? ` · ${sum.noShow} no-show` : ''} · {sentAt ? 'hours sent' : 'hours not sent'}</div>
      <Link className="pe-open" to={`/manage/${eventId}`}>{sentAt ? 'Open team ›' : 'Open team · Submit hours'}</Link>
    </section>
    {fbOn && sum.newStaff.length > 0 && (
      <section className="pe-card">
        <span className="kicker">New staff · {open ? 'rate within 7 days' : 'rating closed'}</span>
        {sum.newStaff.map((n) => (
          <div key={n.staff_id} className="pe-new">
            <Avatar name={n.name} url={n.photo_url} size={36} />
            <div className="grow"><b>{n.name}</b><small>{ord[n.done_before] ?? ''} shift · {n.role}</small></div>
            {n.stars ? <Stars value={n.stars} size="sm" label={`${n.name.split(' ')[0]}`} />
              : open ? <Link className="pe-rate" to={`/manage/${eventId}?rate=${n.staff_id}`}>★ Rate</Link> : <small className="muted">not rated</small>}
          </div>
        ))}
      </section>
    )}
  </>;
}

type Lead = { full_name: string; photo_url: string | null; phone: string | null } | null;
type Face = { full_name: string; photo_url: string | null };
/** The staff event page itself. Also rendered read-only in the admin "How it lands in the app" preview. */
type TeamGroup = { start: string; label: string; n: number; faces?: Face[] };
type Piece = { key: string; icon: (sz: number) => JSX.Element; name: string; no?: string; extra?: boolean };

// Directions and the map tile always open Google Maps (app if installed, else the website), on iPhone too (Ronnie, Nov 2).
const dirUrl = (a: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`;
const placeUrl = (a: string) => mapsUrl(a);
const MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;

export function ShiftView({ s, lead, backTo = '/', preview = false, team, past }: { s: ShiftRow; lead: Lead; backTo?: string; preview?: boolean; team?: TeamGroup[]; past?: { id: string; full_name: string } | null }) {
  const t = useT();
  const [leadPhoto, setLeadPhoto] = useState(false);
  const vx = useVenueExtras(s.events.id); const [vPhoto, setVPhoto] = useState<number | null>(null); // push 32 · venue notes + photos
  const uniRef = useRef<HTMLDivElement>(null);
  // push 28 · Need a change? (inside the dark top card, V2)
  const [sheet, setSheet] = useState<'cancel' | 'change' | null>(null);
  const [gone, setGone] = useState<{ late: boolean } | null>(s.attendance === 'cancelled' ? { late: false } : null);
  const chg = useShiftChanges(preview ? [] : [s.id]);
  // Nov 6 · a note from G&R covers the page until they tap Got it (migration 068)
  const [gNote, setGNote] = useState<ShiftNote | null>(null);
  useEffect(() => { shiftNotes([s.id]).then((m) => setGNote(m[s.id] ?? null)); }, [s.id]);
  const { cal: myCal, setCal: setMyCal } = useMyCalendar(preview); // subscribed to the G&R calendar → no one-off Add to calendar
  const inFeed = s.status === 'confirmed' && !s.time_tbc && !(s.events as { details_pending?: boolean }).details_pending;
  const req = chg.reqs[s.id];
  const ev = s.events;
  const address = ev.address || ev.venues?.address || '';
  const arrive = minus(s.planned_start, s.arrive_before_min);
  const cal = s.cal_token && !/android/i.test(navigator.userAgent) ? `/api/cal?t=${s.cal_token}` : calendarUrl(ev.title, arrive, s.planned_end, address);

  const kind = uniformFor(s);
  const role = s.position_code === 'MD' ? 'MD' : s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : isBar(s.position_code, null) ? 'Bar' : 'Waiter';
  const venueName = ev.venues?.name ?? ev.title;
  const d = new Date(ev.event_date + 'T12:00:00');
  const tel = lead?.phone?.replace(/[^\d+]/g, '');

  const bar = isBarPos(s.position_code, s.position_detail);
  const dress = kind === 'dress';
  const who: 'men' | 'women' | 'both' = s.me?.sex === 'f' || dress ? 'women' : s.me?.sex === 'm' ? 'men' : 'both';
  const shoes = (sz: number) => <ShoesIcon size={dress ? Math.round(sz * 1.1) : sz} who={sz < 40 && who === 'both' ? 'men' : who} />;
  // Event form v3: the admin picked exactly which pieces this line wears (+ extras). Shift-level overrides keep the old rules.
  const picked = !s.uniform ? ev.uniform_items?.[lineKey(bar, s.me?.sex)] : undefined;
  const pieceTile: Record<string, Piece> = {
    [PIECE.tie]: { key: 'tie', icon: (z) => <TieIcon size={z} />, name: 'Black tie' },
    [PIECE.pants]: { key: 'pants', icon: (z) => <PantsIcon size={z} />, name: 'Black dress pants', no: 'No jeans' },
    [PIECE.shoes]: { key: 'shoes', icon: shoes, name: 'Black dress shoes', no: 'No running shoes' },
    [PIECE.apron]: { key: 'apron', icon: (z) => <ApronIcon size={z} />, name: 'Black apron' },
    [PIECE.key]: { key: 'key', icon: (z) => <WineKeyIcon size={z} />, name: 'Wine key' },
  };
  const plus = (name: string): Piece => ({ key: 'x:' + name, icon: () => <span className="uni-extra">+</span>, name, extra: true });
  const order = [PIECE.tie, PIECE.pants, PIECE.shoes, PIECE.apron, PIECE.key] as string[];
  const tiles0: Piece[] = picked ? [
    ...order.filter((p) => picked.on.includes(p)).map((p) => pieceTile[p]),
    ...picked.on.filter((p) => !order.includes(p)).map(plus),
    ...picked.extra.map(plus),
  ] : [
    ...(!bar && !dress && kind !== 'black_tshirt' ? [pieceTile[PIECE.tie]] : []),
    ...(!dress ? [pieceTile[PIECE.pants]] : []),
    pieceTile[PIECE.shoes],
    ...(!dress && kind !== 'black_tshirt' ? [pieceTile[PIECE.apron]] : []),
    ...(bar ? [pieceTile[PIECE.key]] : []),
  ];
  // Ronnie, Nov 4 · MDs and bar managers wear the same as their team, minus the apron and the wine key.
  const tiles = s.position_code === 'MD' || s.position_code === 'BM' ? tiles0.filter((x) => x.key !== 'apron' && x.key !== 'key') : tiles0;
  const shirtLabel = uniformLabel(kind).replace(' + tie', '');

  const lead_ = s.position_code === 'MD' || s.position_code === 'BM';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const tmr = (() => { const x = new Date(today + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.toLocaleDateString('en-CA'); })();
  const isToday = ev.event_date === today;
  const dayWord = isToday ? 'Today' : ev.event_date === tmr ? 'Tomorrow' : d.toLocaleDateString('en-CA', { weekday: 'long' });
  const mins = Math.round((new Date(s.planned_start).getTime() - Date.now()) / 60000);
  const cd = s.punches?.punch_in ? 'working now' : mins <= 0 ? 'started' : mins < 60 ? `in ${mins} min` : mins < 48 * 60 ? `in ${Math.round(mins / 60)} h` : '';
  const setup = isSetup(ev);
  const facts = [ev.event_type, ev.guests ? `${ev.guests} guests` : null].filter(Boolean).join(' · ');
  const [street, ...cityParts] = (address || venueName).split(',');
  const city = cityParts.join(',').trim();
  const area = cityParts[0]?.trim() ?? '';
  const shortDate = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
  const canChange = !gone && !s.punches?.punch_in && Date.now() < new Date(s.planned_start).getTime();
  const seeUniform = () => uniRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const staffNotes = ev.venues?.staff_notes?.trim();
  const pinV = ev.venues?.pin_lat != null && ev.venues?.pin_lng != null ? { lat: ev.venues.pin_lat, lng: ev.venues.pin_lng, label: ev.venues.pin_label } : null; // Nov 6 · 📍 exact spot (073)
  const isPastV = past !== undefined; // push 51
  return (
    <main className={'page v2 details d3 d37' + (preview ? ' preview' : '')}>
      {gNote && !gNote.seen_at && <div className="g-cover" role="dialog" aria-modal="true"><div className="g-cover-card">
        <span className="k">📌 BEFORE YOUR SHIFT · {ev.title.toUpperCase()}</span>
        <b className="serif">{gNote.body}</b><span className="muted sm">From G&amp;R</span>
        <button onClick={() => { setGNote({ ...gNote, seen_at: new Date().toISOString() }); if (!preview) noteSeen(s.id); }}>Got it · see my shift</button></div></div>}
      <header className="row d3-top">
        <Link to={backTo} className="back" aria-label={t('back')}>‹</Link>
        <span className="kicker grow d37-date">{isPastV ? `PAST · ${shortDate.replace(',', '')}` : shortDate}</span>
        {isPastV ? null : gone ? <span className="tag-done">Cancelled</span> : <Status s={s.status} />}
      </header>
      {ev.tentative && <div className="tbc-box"><span className="tbc-pill">⏳ TO BE CONFIRMED</span>
        <b>The client hasn’t confirmed this event yet.</b> We’re booking early so the team is ready if it goes ahead.
        <span>• Please keep the date free.<br />• We’ll let you know as soon as the client answers.<br />• If it doesn’t happen, it’s simply removed. Nothing to do.</span></div>}
      {gNote?.seen_at && <div className="g-line">📌 <b>From G&amp;R:</b> {gNote.body}</div>}

      {isPastV ? <>
        <section className="pe-hero">
          <div><div className="serif">{venueName}</div>{address && <div className="pe-addr">{address}</div>}</div>
          <div className="dbl-times">
            <div><small>Started</small>{s.punches?.punch_in ? <BigTime iso={s.punches.punch_in} small /> : <span className="big serif sm-big">–</span>}</div>
            <div><small>Ended</small>{s.punches?.punch_out ? <BigTime iso={s.punches.punch_out} small /> : <span className="big serif sm-big">–</span>}</div>
          </div>
        </section>
        {past && managesShift(s, past.id) && <PastManager eventId={ev.id} eventDate={ev.event_date} sentAt={ev.hours_submitted_at ?? null} me={past} />}
      </> : <section className="d3-hero">
        <div className="d3-kick">{dayWord.toUpperCase()}{cd ? ` · ${cd.toUpperCase()}` : ''}</div>
        <div><div className="serif d3-venue">{venueName}</div>{(facts || ev.description) && <div className="d3-sub">{facts || ev.description}</div>}</div>
        <StartPos start={s.time_tbc ? null : s.planned_start} role={role} />
        {!setup && (
          <div className="d37-uni" role="button" tabIndex={0} onClick={seeUniform} onKeyDown={(e) => { if (e.key === 'Enter') seeUniform(); }}>
            <div className="d37-uni-ics">
              <span title={shirtLabel}><UniformIcon kind={kind} size={22} /></span>
              {tiles.filter((x) => !x.extra).map((x) => <span key={x.key} title={x.name}>{x.icon(20)}</span>)}
            </div>
            <span className="d37-see">See ↓</span>
          </div>
        )}
        {address && (
          <a className="d37-where" href={dirUrl(address)} target="_blank" rel="noreferrer" aria-label="Open in Google Maps">
            <div className="grow" style={{ minWidth: 0 }}>
              <b>📍 {street.trim()}</b>
              {area && <span>{area}</span>}
            </div>
            <span className="d37-go" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8z" /></svg>
            </span>
          </a>
        )}
        {lead_ && !preview && <Link className="d3-team" to={`/manage/${ev.id}`}>My team{team ? ` · ${team.reduce((n, g) => n + g.n, 0)}` : ''} ›</Link>}
        {canChange && !lead_ && !ev.tentative && s.status !== 'declined' && <FirstCut shiftId={s.id} at={s.cut_first_at} start={s.planned_start} mgr={ev.manager?.full_name} preview={preview} />}{/* push 64 */}
        {canChange && <>
          <span className="d3-hl" />
          <NeedChange canSchedule={!(req?.status === 'pending' || (req?.status === 'keep' && !req.keep_reply))} onSchedule={() => setSheet('change')} onCancel={() => setSheet('cancel')} />
        </>}
      </section>}
      {!isPastV && <>
      {gone && <CancelledCard title={ev.title} date={ev.event_date} late={gone.late} onOk={() => window.history.length > 1 ? window.history.back() : window.location.assign(backTo)} />}
      {!gone && req && <ChangeCard r={req} s={s} preview={preview} onChanged={chg.reload} />}
      {sheet === 'cancel' && <CancelSheet s={s} preview={preview} onClose={() => setSheet(null)} onDone={(late) => { setGone({ late }); setSheet(null); }} />}
      {sheet === 'change' && <ChangeSheet s={s} preview={preview} onClose={() => setSheet(null)} onSent={() => { setSheet(null); chg.reload(); }} />}

      {!gone && <FromTheMeeting eventId={ev.id} meetingBase={preview ? '/admin' : ''} />}{/* push 38 · pinned meeting notes */}
      {ev.rides && <GettingThere eventId={ev.id} eventDate={ev.event_date} firstStart={s.planned_start} travelMin={ev.travel_min ?? 60} paidMin={ev.paid_travel_min ?? 0} transport={!!ev.transport} preview={preview} />}{/* push 68 · carpool on any event with rides on */}
      </>}
      <SecTitle icon="pin">Where</SecTitle>
      <section className="d3-card d3-where d37-wcard">
        {pinV ? <div className="vp-box"><PinMap pin={pinV} height={180} />{pinV.label && <b>📍 {pinV.label}</b>}</div> : address && <MapTile address={address} />}
        <a className="d37-addr" href={address ? placeUrl(address) : undefined} target="_blank" rel="noreferrer">
          <b>{street.trim()}</b>{city && <span>{city}</span>}
        </a>
        {staffNotes && <div className="d37-door">🚪 {staffNotes}</div>}
        {vx.photos.length > 0 && <div className="d3-vphotos">{vx.photos.map((u, i) => <button key={u} type="button" aria-label={`Venue photo ${i + 1} of ${vx.photos.length}`} onClick={() => setVPhoto(i)}><img src={u} alt="" loading="lazy" /></button>)}</div>}
        <StaffLinks links={mergeLinks(ev.venues?.links, ev.links)} />
        {!isPastV && <div className="row2" style={{ gap: 8 }}>
          {address || pinV ? <a className={'big-btn dark d37-dir' + (isToday ? ' ok' : '')} href={pinV ? pinDirections(pinV) : dirUrl(address!)} target="_blank" rel="noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8z" /></svg>Directions</a> : <span />}
          {myCal?.added_at
            ? <div className={'big-btn d37-cal d37-calon' + (inFeed ? '' : ' wait')}><span className="mini-cal"><i>{d.toLocaleDateString('en-CA', { month: 'short' }).toUpperCase().replace('.', '')}</i><b>{d.getDate()}</b></span>{inFeed ? '✓ In your calendar' : 'In calendar once confirmed'}</div>
            : myCal
              ? <button type="button" className="big-btn d37-cal" onClick={() => addCalendar(myCal, defaultCalOs()).then(setMyCal)}><span className="mini-cal"><i>{d.toLocaleDateString('en-CA', { month: 'short' }).toUpperCase().replace('.', '')}</i><b>{d.getDate()}</b></span>Add my G&R calendar</button>
              : <a className="big-btn d37-cal" href={cal} target="_blank" rel="noreferrer"><span className="mini-cal"><i>{d.toLocaleDateString('en-CA', { month: 'short' }).toUpperCase().replace('.', '')}</i><b>{d.getDate()}</b></span>Add to calendar</a>}
        </div>}
      </section>

      {!isPastV && (s.plan || ev.plan) ? (
        <Link to={`${backTo === '/' ? '' : backTo}/shift/${s.id}/plan`} className="plan-link">
          <span className="ic">📋</span>
          <div className="grow"><b>Your plan tonight</b><span>Your role, side, leads, wine + water, clearing</span></div>
          <span className="go">›</span>
        </Link>
      ) : null}

      {!setup && <>
        <div ref={uniRef} className="d37-anchor"><SecTitle icon="hanger">Uniform</SecTitle></div>
        <section className="d3-card d37-unicard">
          <div className="d37-shirt">
            <span className="d37-shirt-ic"><UniformIcon kind={kind} size={40} /></span>
            <div style={{ minWidth: 0 }}>
              <small>{dress ? 'Dress' : kind === 'black_tshirt' ? 'Top' : 'Shirt'} · {bar ? 'Bar' : 'Floor'} uniform</small>
              <div className="serif">{shirtLabel}</div>
            </div>
          </div>
          {tiles.length > 0 && <div className="d37-tiles">
            {tiles.map((x) => <div key={x.key} className="d37-tile"><div className="ic">{x.icon(52)}</div><b>{x.name}</b>{x.no && <span className="no">✕ {x.no}</span>}</div>)}
          </div>}
        </section>
      </>}

      {ev.venues?.no_outside_food && <>
        <SecTitle icon="pin">At this venue</SecTitle>
        <section className="d3-card venue-rule"><img src="/rules/no-outside-food.png" alt="" width={52} height={52} /><b>No outside food or drinks</b></section>
      </>}

      {!isPastV && lead_ && team && team.length > 0 && <>
        <SecTitle icon="people">Your team</SecTitle>
        <section className="d3-card d37-team">
          {team.map((g) => (
            <div key={g.start} className="d37-trow">
              <span className="d37-tpill">{g.label}</span>
              <span className="d37-faces">{(g.faces ?? []).map((f, i) => <Avatar key={i} name={f.full_name} url={f.photo_url} size={24} />)}</span>
              <b>{g.n} {g.n === 1 ? 'person' : 'people'}</b>
            </div>
          ))}
          {!preview && <Link className="d37-open" to={`/manage/${ev.id}`}>Open my team ›</Link>}
        </section>
      </>}

      {!preview && !isPastV && <PinnedAnnouncements eventId={ev.id} />}

      {(ev.notes || vx.notes) && <>
        <SecTitle>Notes</SecTitle>
        {ev.notes && <section className="d3-notes">{ev.notes}</section>}
        {vx.notes && <section className="d3-notes d3-vnotes"><small>AT {venueName.toUpperCase()}</small>{vx.notes}</section>}
      </>}
      {vPhoto !== null && vx.photos[vPhoto] && <PhotoViewer wide name={venueName} url={vx.photos[vPhoto]} sub={vx.photos.length > 1 ? `Photo ${vPhoto + 1} of ${vx.photos.length} · tap to close` : 'Tap to close'} onClose={() => setVPhoto(null)} />}

      {lead && !isPastV && <>
        <SecTitle icon="phone">Manager on-site</SecTitle>
        <section className="d3-card look">
          <button className="look-photo" aria-label={`See ${lead.full_name}'s photo`} onClick={() => setLeadPhoto(true)}><Avatar name={lead.full_name} url={lead.photo_url} size={56} /></button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{lead.full_name}</div>
            <div className="muted sm">MD · {isToday ? 'tonight' : dayWord.toLowerCase()}</div>
          </div>
          {tel && <a className="d-call ok" href={`tel:${tel}`} aria-label={`Call ${lead.full_name}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg></a>}
          <Link className="d-call" to="/messages" aria-label={`Message about ${ev.title}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></Link>
        </section>
        {leadPhoto && <PhotoViewer name={lead.full_name} url={lead.photo_url} sub="Manager On-Site · find them when you arrive" onClose={() => setLeadPhoto(false)} />}
      </>}
      {!preview && <div style={{ marginTop: 14 }}><MessageRonnieLink shiftId={s.id} label="✉ Question about this shift? Message Ronnie" /></div>}
      <div style={{ height: 24 }} />
    </main>
  );
}

/** push 37 · section title: thin line icon + serif title + thin rule (no emojis). */
export function SecTitle({ icon, children }: { icon?: 'pin' | 'hanger' | 'people' | 'phone'; children: string }) {
  const p = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  return (
    <div className="d37-sec">
      {icon === 'pin' && <svg {...p}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>}
      {icon === 'hanger' && <svg {...p}><path d="M12 7.5a2 2 0 1 1 2-2c0 1.2-2 1.6-2 3.2v.8L3.5 15.4a1 1 0 0 0 .6 1.8h15.8a1 1 0 0 0 .6-1.8L12 9.5" /></svg>}
      {icon === 'people' && <svg {...p}><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><circle cx="16.5" cy="9" r="2.5" /><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5" /></svg>}
      {icon === 'phone' && <svg {...p}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>}
      <span className="serif">{children}</span>
      <i />
    </div>
  );
}

/** push 37 · map tile: Google Static Map when the key works, otherwise a drawn placeholder (never a broken image). Tap = Maps. */
function MapTile({ address }: { address: string }) {
  const [ok, setOk] = useState(false); const [bad, setBad] = useState(false);
  const src = MAPS_KEY ? `https://maps.googleapis.com/maps/api/staticmap?${new URLSearchParams({ center: address, zoom: '15', size: '600x240', scale: '2', markers: `color:0x9B2226|${address}`, style: 'feature:poi|visibility:off', key: MAPS_KEY })}` : '';
  return (
    <a className="d37-map" href={placeUrl(address)} target="_blank" rel="noreferrer" aria-label="Open in Maps">
      <svg className="d37-map-ph" viewBox="0 0 300 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect width="300" height="120" fill="#ECE6DC" />
        <path d="M0 52h300M0 96h300M92 0v120M200 0l-24 120" stroke="#fff" strokeWidth="9" fill="none" />
        <rect x="104" y="62" width="64" height="24" rx="3" fill="#D9E8D4" />
        <path d="M150 50s-13-12.5-13-22a13 13 0 0 1 26 0c0 9.5-13 22-13 22z" fill="#9B2226" /><circle cx="150" cy="28" r="5" fill="#fff" />
      </svg>
      {src && !bad && <img src={src} alt="" style={{ opacity: ok ? 1 : 0 }} onLoad={() => setOk(true)} onError={() => setBad(true)} />}
      <span className="d37-map-tag">Tap to open in Maps</span>
    </a>
  );
}

/**
 * push 32 · venue notes + photos (Venues & clients). Read on their own so the page still loads while migration 038
 * (venues.venue_notes / venues.photos, Storage "venue-photos") isn't applied. Photos are private: 1-hour signed links.
 */
function useVenueExtras(eventId: string) {
  const [x, setX] = useState<{ notes: string | null; photos: string[] }>({ notes: null, photos: [] });
  useEffect(() => {
    let live = true;
    supabase.from('events').select('venues(venue_notes,photos)').eq('id', eventId).maybeSingle().then(async ({ data, error }) => {
      if (error || !data || !live) return;
      const v = (data as unknown as { venues: { venue_notes: string | null; photos: unknown } | null }).venues;
      const paths = Array.isArray(v?.photos) ? (v!.photos as unknown[]).filter((p): p is string => typeof p === 'string') : [];
      let urls: string[] = [];
      if (paths.length) { const r = await supabase.storage.from('venue-photos').createSignedUrls(paths, 3600); urls = (r.data ?? []).map((d) => d.signedUrl).filter(Boolean) as string[]; }
      if (live) setX({ notes: v?.venue_notes?.trim() || null, photos: urls });
    }, () => {});
    return () => { live = false; };
  }, [eventId]);
  return x;
}

function calendarUrl(title: string, startIso: string, endIso: string | null, address: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = endIso ?? new Date(new Date(startIso).getTime() + 6 * 3600e3).toISOString();
  const p = new URLSearchParams({ action: 'TEMPLATE', text: `G&R · ${title}`, dates: `${f(startIso)}/${f(end)}`, location: address });
  return `https://calendar.google.com/calendar/render?${p}`;
}
