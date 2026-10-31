import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, SHIFT_SELECT, isSetup, type ShiftRow } from '../lib/supabase';
import { useT, useLang } from '../lib/i18n';
import { time, longDate, minus, mapsUrl } from '../lib/format';
import { Avatar, PhotoViewer } from '../components/Avatar';
import { UniformIcon, uniformFor, uniformLabel, PantsIcon, ShoesIcon, ApronIcon, TieIcon, WineKeyIcon, isBarPos, lineKey, PIECE } from '../components/Uniform';
import { Status, isBar } from './Home';
import { GettingThere } from '../components/GettingThere';
import { PinnedAnnouncements } from '../components/Announce';

export function Shift({ backTo = '/' }: { backTo?: string }) {
  const { id } = useParams();
  const [s, setS] = useState<ShiftRow | null>(null);
  const [md, setMd] = useState<{ full_name: string; photo_url: string | null; phone: string | null } | null>(null);
  const [team, setTeam] = useState<TeamGroup[] | undefined>(undefined);

  useEffect(() => {
    supabase.from('shifts').select(SHIFT_SELECT + ',punches(punch_in,punch_out)').eq('id', id!).single().then(({ data }) => {
      const row = data as unknown as ShiftRow; setS(row);
      if (row && (row.position_code === 'MD' || row.position_code === 'BM'))
        supabase.from('shifts').select('planned_start,status,attendance').eq('event_id', row.events.id).neq('status', 'declined').then(({ data: crew }) => {
          const m = new Map<string, number>();
          for (const c of (crew ?? []) as { planned_start: string; attendance: string | null }[]) if (!c.attendance) m.set(c.planned_start, (m.get(c.planned_start) ?? 0) + 1);
          setTeam([...m.entries()].sort().map(([k, n]) => ({ start: k, label: new Date(k).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }), n })));
        });
      // "Look for" = the MD on site (falls back to the event manager).
      if (row) supabase.rpc('event_md', { p_event: row.events.id }).then(({ data: m }) => { const x = Array.isArray(m) ? (m as typeof md[])[0] : null; setMd(x?.full_name ? x : null); });
    });
  }, [id]);

  if (!s) return <div className="loading" />;
  return <ShiftView s={s} lead={md ?? s.events.manager} backTo={backTo} team={team} />;
}

type Lead = { full_name: string; photo_url: string | null; phone: string | null } | null;
/** The staff event page itself. Also rendered read-only in the admin "How it lands in the app" preview. */
type TeamGroup = { start: string; label: string; n: number };
export function ShiftView({ s, lead, backTo = '/', preview = false, team }: { s: ShiftRow; lead: Lead; backTo?: string; preview?: boolean; team?: TeamGroup[] }) {
  const t = useT(); const lang = useLang();
  const [leadPhoto, setLeadPhoto] = useState(false);
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
  const shoes = <ShoesIcon size={dress ? 76 : 64} who={s.me?.sex === 'f' || dress ? 'women' : s.me?.sex === 'm' ? 'men' : 'both'} />;
  // Event form v3: the admin picked exactly which pieces this line wears (+ extras). Shift-level overrides keep the old rules.
  const picked = !s.uniform ? ev.uniform_items?.[lineKey(bar, s.me?.sex)] : undefined;
  const pieceTile: Record<string, { icon: JSX.Element; name: string; no?: string }> = {
    [PIECE.tie]: { icon: <TieIcon size={68} />, name: 'Black tie' },
    [PIECE.pants]: { icon: <PantsIcon size={68} />, name: 'Black dress pants', no: 'No jeans' },
    [PIECE.shoes]: { icon: shoes, name: 'Black dress shoes', no: 'No running shoes' },
    [PIECE.apron]: { icon: <ApronIcon size={68} />, name: 'Black apron' },
    [PIECE.key]: { icon: <WineKeyIcon size={68} />, name: 'Wine key' },
  };
  const order = [PIECE.tie, PIECE.pants, PIECE.shoes, PIECE.apron, PIECE.key] as string[];
  const tiles: { icon: JSX.Element; name: string; no?: string }[] = picked ? [
    ...order.filter((p) => picked.on.includes(p)).map((p) => pieceTile[p]),
    ...picked.on.filter((p) => !order.includes(p)).map((p) => ({ icon: <span className="uni-extra">+</span>, name: p })),
    ...picked.extra.map((p) => ({ icon: <span className="uni-extra">+</span>, name: p })),
  ] : [
    ...(!bar && !dress && kind !== 'black_tshirt' ? [{ icon: <TieIcon size={68} />, name: 'Black tie' }] : []),
    ...(!dress ? [{ icon: <PantsIcon size={68} />, name: 'Black dress pants', no: 'No jeans' }] : []),
    { icon: shoes, name: 'Black dress shoes', no: 'No running shoes' },
    ...(!dress && kind !== 'black_tshirt' ? [{ icon: <ApronIcon size={68} />, name: 'Black apron' }] : []),
    ...(bar ? [{ icon: <WineKeyIcon size={68} />, name: 'Wine key' }] : []),
  ];
  const shirtLabel = uniformLabel(kind).replace(' + tie', '');

  const lead_ = s.position_code === 'MD' || s.position_code === 'BM';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  const tmr = (() => { const x = new Date(today + 'T12:00:00'); x.setDate(x.getDate() + 1); return x.toLocaleDateString('en-CA'); })();
  const dayWord = ev.event_date === today ? 'Today' : ev.event_date === tmr ? 'Tomorrow' : d.toLocaleDateString('en-CA', { weekday: 'long' });
  const mins = Math.round((new Date(s.planned_start).getTime() - Date.now()) / 60000);
  const cd = s.punches?.punch_in ? 'working now' : mins <= 0 ? 'started' : mins < 60 ? `in ${mins} min` : mins < 48 * 60 ? `in ${Math.round(mins / 60)} h` : '';
  const st = s.time_tbc ? null : time(s.planned_start, lang);
  const tNum = st ? st.replace(/\s?[ap]\.?\s?m\.?/i, '') : 'TBC'; const tAp = st ? (/p\.?\s?m/i.test(st) ? 'PM' : 'AM') : '';
  const setup = isSetup(ev);
  const facts = [ev.event_type, ev.guests ? `${ev.guests} guests` : null].filter(Boolean).join(' · ');
  const [street, ...cityParts] = (address || venueName).split(',');
  return (
    <main className={'page v2 details d3' + (preview ? ' preview' : '')}>
      <header className="row d3-top">
        <Link to={backTo} className="back" aria-label={t('back')}>‹</Link>
        <span className="kicker grow">{longDate(ev.event_date, lang)}</span>
        <Status s={s.status} />
      </header>

      <section className="d3-hero">
        <div className="d3-kick">{dayWord.toUpperCase()}{cd ? ` · ${cd.toUpperCase()}` : ''}</div>
        <div><div className="serif d3-venue">{venueName}</div>{(facts || ev.description) && <div className="d3-sub">{facts || ev.description}</div>}</div>
        <div className="d3-row">
          <div className="d3-cell"><small>Starts</small><div className="d3-val"><span className="serif">{tNum}</span>{tAp && <i>{tAp}</i>}</div></div>
          <span className="d3-vl" />
          <div className="d3-cell"><small>Position</small><div className="d3-val"><span className="serif">{role}</span></div></div>
          {!setup && <><span className="d3-vl" /><div className="d3-cell wear"><small>Wear</small><div className="d3-val"><span className="d3-uni" title={shirtLabel}><UniformIcon kind={kind} size={24} /></span></div></div></>}
        </div>
        {lead_ && !preview && <Link className="d3-team" to={`/manage/${ev.id}`}>My team{team ? ` · ${team.reduce((n, g) => n + g.n, 0)}` : ''} ›</Link>}
      </section>

      {ev.transport && ev.rides && <GettingThere eventId={ev.id} eventDate={ev.event_date} firstStart={s.planned_start} travelMin={ev.travel_min ?? 60} paidMin={ev.paid_travel_min ?? 0} preview={preview} />}
      <div className="d-sec">Where</div>
      <section className="d3-card d3-where">
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <span className="d3-pin"><svg width="16" height="20" viewBox="0 0 26 34" aria-hidden="true"><path d="M13 33 C13 33 25 19 25 12 A12 12 0 0 0 1 12 C1 19 13 33 13 33Z" fill="#9B2226" /><circle cx="13" cy="12" r="4.5" fill="#fff" /></svg></span>
          <div className="grow" style={{ minWidth: 0 }}><b>{street}</b>{cityParts.length > 0 && <span>{cityParts.join(',').trim()}</span>}{ev.venues?.staff_notes && <p>{ev.venues.staff_notes}</p>}</div>
        </div>
        <div className="row2" style={{ gap: 8 }}>
          {address ? <a className="big-btn dark" href={mapsUrl(address)} target="_blank" rel="noreferrer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8z" /></svg>Directions</a> : <span />}
          <a className="big-btn" href={cal} target="_blank" rel="noreferrer">
            <span className="mini-cal"><i>{d.toLocaleDateString('en-CA', { month: 'short' }).toUpperCase().replace('.', '')}</i><b>{d.getDate()}</b></span>Add to calendar</a>
        </div>
      </section>

      {(s.plan || ev.plan) ? (
        <Link to={`${backTo === '/' ? '' : backTo}/shift/${s.id}/plan`} className="plan-link">
          <span className="ic">📋</span>
          <div className="grow"><b>Your plan tonight</b><span>Your role, side, leads, wine + water, clearing</span></div>
          <span className="go">›</span>
        </Link>
      ) : null}

      {!setup && <>
        <div className="d-sec">What to wear</div>
        <section className="d3-card d3-shirt"><UniformIcon kind={kind} size={60} /><div><small>{dress ? 'Dress' : kind === 'black_tshirt' ? 'Top' : 'Shirt'}</small><div className="serif">{shirtLabel}</div></div></section>
        <section className="d3-tiles">
          {tiles.map((x) => <div key={x.name} className="d3-tile"><div className="ic">{x.icon}</div><b>{x.name}</b>{x.no && <span className="no">✕ {x.no}</span>}</div>)}
        </section>
      </>}

      {lead_ && team && team.length > 0 && <>
        <div className="d-sec">Your team</div>
        <section className="d3-card d3-teamlist">
          {team.map((g) => <div key={g.start}><span>{g.label}</span><b>{g.n} {g.n === 1 ? 'person' : 'people'}</b></div>)}
          <small>Open the team to start people and see who’s late.</small>
        </section>
      </>}

      {!preview && <PinnedAnnouncements eventId={ev.id} />}

      {ev.notes && <>
        <div className="d-sec">Notes</div>
        <section className="d3-notes">{ev.notes}</section>
      </>}

      {lead && <>
        <div className="d-sec">Manager On-Site</div>
        <section className="d3-card look">
          <button className="look-photo" aria-label={`See ${lead.full_name}'s photo`} onClick={() => setLeadPhoto(true)}><Avatar name={lead.full_name} url={lead.photo_url} size={56} /></button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{lead.full_name}</div>
            <div className="muted sm">MD{lead.photo_url ? ' · tap the photo' : ''}</div>
          </div>
          {tel && <>
            <a className="d-call ok" href={`tel:${tel}`} aria-label={`Call ${lead.full_name}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg></a>
            <a className="d-call" href={`sms:${tel}`} aria-label={`Text ${lead.full_name}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></a>
          </>}
        </section>
        {leadPhoto && <PhotoViewer name={lead.full_name} url={lead.photo_url} sub="Manager On-Site · find them when you arrive" onClose={() => setLeadPhoto(false)} />}
      </>}
      <div style={{ height: 24 }} />
    </main>
  );
}

function calendarUrl(title: string, startIso: string, endIso: string | null, address: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = endIso ?? new Date(new Date(startIso).getTime() + 6 * 3600e3).toISOString();
  const p = new URLSearchParams({ action: 'TEMPLATE', text: `G&R · ${title}`, dates: `${f(startIso)}/${f(end)}`, location: address });
  return `https://calendar.google.com/calendar/render?${p}`;
}
