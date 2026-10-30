import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, SHIFT_SELECT, isSetup, type ShiftRow } from '../lib/supabase';
import { useT, useLang } from '../lib/i18n';
import { time, longDate, minus, mapsUrl } from '../lib/format';
import { Avatar, PhotoViewer } from '../components/Avatar';
import { UniformIcon, uniformFor, uniformLabel, PantsIcon, ShoesIcon, ApronIcon, TieIcon, WineKeyIcon, isBarPos, lineKey, PIECE } from '../components/Uniform';
import { Status, isBar } from './Home';

export function Shift({ backTo = '/' }: { backTo?: string }) {
  const t = useT(); const lang = useLang();
  const { id } = useParams();
  const [s, setS] = useState<ShiftRow | null>(null);
  const [md, setMd] = useState<{ full_name: string; photo_url: string | null; phone: string | null } | null>(null);
  const [leadPhoto, setLeadPhoto] = useState(false);

  useEffect(() => {
    supabase.from('shifts').select(SHIFT_SELECT).eq('id', id!).single().then(({ data }) => {
      const row = data as unknown as ShiftRow; setS(row);
      // "Look for" = the MD on site (falls back to the event manager).
      if (row) supabase.rpc('event_md', { p_event: row.events.id }).then(({ data: m }) => setMd((m as typeof md[]) ?.[0] ?? null));
    });
  }, [id]);

  if (!s) return <div className="loading" />;
  const ev = s.events;
  const lead = md ?? ev.manager;
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

  return (
    <main className="page v2 details">
      <header className="row" style={{ paddingTop: 12 }}>
        <Link to={backTo} className="back" aria-label={t('back')}>‹</Link>
        <span className="kicker grow">{longDate(ev.event_date, lang)}</span>
        <Status s={s.status} />
      </header>
      <div className="serif" style={{ fontSize: 36, lineHeight: 1, padding: '0 6px' }}>{ev.title}</div>

      <section className="d-start">
        <div className="grow"><small>Shift starts</small>
          {s.time_tbc ? <b className="serif">TBC</b> : <b className="serif">{time(s.planned_start, lang).replace(/\s?[ap]\.?\s?m\.?/i, '')}<i>{/p\.?\s?m/i.test(time(s.planned_start, lang)) ? ' PM' : ' AM'}</i></b>}</div>
        <div className="d-pos"><small>Your position</small><span className="pos-pill-lg">{role}</span></div>
      </section>

      {ev.description && <>
        <div className="d-sec">The event</div>
        <section className="card d-event"><b>{ev.description}</b></section>
      </>}

      <section className="where">
        <div className="map">
          <svg viewBox="0 0 358 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="358" height="150" fill="#ECE6DC" />
            <path d="M-10 40 L370 18" stroke="#fff" strokeWidth="12" /><path d="M-10 108 L370 86" stroke="#fff" strokeWidth="16" />
            <path d="M70 -10 L95 160" stroke="#fff" strokeWidth="10" /><path d="M230 -10 L250 160" stroke="#fff" strokeWidth="12" />
            <path d="M300 -10 L330 160" stroke="#fff" strokeWidth="6" />
            <rect x="110" y="44" width="105" height="36" rx="6" fill="#DFD7CA" /><rect x="10" y="118" width="70" height="40" rx="6" fill="#DFD7CA" />
            <rect x="262" y="34" width="34" height="46" rx="6" fill="#D6E3D3" /><rect x="110" y="118" width="110" height="40" rx="6" fill="#D6E3D3" />
          </svg>
          <div className="pin">
            <span>{venueName}</span>
            <svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true"><path d="M13 33 C13 33 25 19 25 12 A12 12 0 0 0 1 12 C1 19 13 33 13 33Z" fill="#9B2226" stroke="#fff" strokeWidth="2" /><circle cx="13" cy="12" r="4.5" fill="#fff" /></svg>
          </div>
        </div>
        <div className="where-body">
          <div><b>{address || venueName}</b>{ev.venues?.staff_notes && <span>{ev.venues.staff_notes}</span>}</div>
          <div className="row2" style={{ gap: 10 }}>
            {address ? <a className="big-btn dark" href={mapsUrl(address)} target="_blank" rel="noreferrer">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11 21 3l-8 18-2-8z" /></svg>Directions</a> : <span />}
            <a className="big-btn" href={cal} target="_blank" rel="noreferrer">
              <span className="mini-cal"><i>{d.toLocaleDateString('en-CA', { month: 'short' }).toUpperCase().replace('.', '')}</i><b>{d.getDate()}</b></span>Add to calendar</a>
          </div>
        </div>
      </section>

      {(s.plan || ev.plan) ? (
        <Link to={`${backTo === '/' ? '' : backTo}/shift/${s.id}/plan`} className="plan-link">
          <span className="ic">📋</span>
          <div className="grow"><b>Your plan tonight</b><span>Your role, side, leads, wine + water, clearing</span></div>
          <span className="go">›</span>
        </Link>
      ) : null}

      {!isSetup(ev) && <>
      <div className="d-sec">Uniform</div>
      <section className="uni-hero"><UniformIcon kind={kind} size={92} /><div><small>{dress ? 'Dress' : kind === 'black_tshirt' ? 'Top' : 'Shirt'}</small><div className="serif">{shirtLabel}</div></div></section>
      <section className="uni-grid">
        {tiles.map((x) => <div key={x.name} className="uni-tile"><div className="ic">{x.icon}</div><b>{x.name}</b>{x.no && <span className="no">✕ {x.no}</span>}</div>)}
      </section>
      </>}

      <div className="d-sec">Notes</div>
      <section className="d-notes">{ev.notes ? ev.notes : <span className="empty">&nbsp;</span>}</section>

      {lead && <>
        <div className="d-sec">Manager On-Site</div>
        <section className="look card">
          <button className="look-photo" aria-label={`See ${lead.full_name}'s photo`} onClick={() => setLeadPhoto(true)}><Avatar name={lead.full_name} url={lead.photo_url} size={56} /></button>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{lead.full_name}</div>
            <div className="muted sm">MD on site{lead.photo_url ? ' · tap the photo' : ''}</div>
          </div>
          {tel && <>
            <a className="d-call ok" href={`tel:${tel}`} aria-label={`Call ${lead.full_name}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg></a>
            <a className="d-call" href={`sms:${tel}`} aria-label={`Text ${lead.full_name}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></a>
          </>}
        </section>
        {leadPhoto && <PhotoViewer name={lead.full_name} url={lead.photo_url} sub="Manager On-Site · find them when you arrive" onClose={() => setLeadPhoto(false)} />}
      </>}
    </main>
  );
}

function calendarUrl(title: string, startIso: string, endIso: string | null, address: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = endIso ?? new Date(new Date(startIso).getTime() + 6 * 3600e3).toISOString();
  const p = new URLSearchParams({ action: 'TEMPLATE', text: `G&R · ${title}`, dates: `${f(startIso)}/${f(end)}`, location: address });
  return `https://calendar.google.com/calendar/render?${p}`;
}
