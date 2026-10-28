import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, SHIFT_SELECT, type ShiftRow } from '../lib/supabase';
import { useT, useLang } from '../lib/i18n';
import { time, longDate, minus, mapsUrl } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { UniformIcon, uniformFor, UNIFORM_LABEL } from '../components/Uniform';
import { Status, BigTime, isBar } from './Home';

export function Shift({ backTo = '/' }: { backTo?: string }) {
  const t = useT(); const lang = useLang();
  const { id } = useParams();
  const [s, setS] = useState<ShiftRow | null>(null);
  const [md, setMd] = useState<{ full_name: string; photo_url: string | null; phone: string | null } | null>(null);

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
  const steps = [
    { time: time(arrive, lang), label: lead ? `${lang === 'fr' ? 'Arrivée, présente-toi à' : 'Arrive, check in with'} ${lead.full_name.split(' ')[0]}` : (lang === 'fr' ? 'Arrivée' : 'Arrive'), strong: true },
    { time: time(s.planned_start, lang), label: lang === 'fr' ? 'Début du quart, punch in' : 'Shift starts', strong: true },
    ...(ev.timeline ?? []).map((x) => ({ time: x.time, label: x.label, strong: false })),
    ...(s.planned_end ? [{ time: '~' + time(s.planned_end, lang), label: lang === 'fr' ? 'Fin, punch out' : 'Ends', strong: false }] : []),
  ];
  const cal = calendarUrl(ev.title, arrive, s.planned_end, address);

  const kind = uniformFor(s);
  const extras = (ev.dress_code ? ev.dress_code.split(/[\n,]+/) : kind === 'dress' ? ['Black closed-toe shoes'] : ['Black dress pants', 'Black shoes', 'Black belt'])
    .map((x) => x.trim()).filter((x) => x && !/shirt|tie\b/i.test(x));
  const bring = (ev.bring ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
  const role = s.position_code === 'MD' ? 'MD' : s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : isBar(s.position_code, null) ? 'Bar' : 'Waiter';
  const venueName = ev.venues?.name ?? ev.title;
  const d = new Date(ev.event_date + 'T12:00:00');
  const tel = lead?.phone?.replace(/[^\d+]/g, '');

  return (
    <main className="page v2">
      <header className="row" style={{ paddingTop: 12 }}>
        <Link to={backTo} className="back" aria-label={t('back')}>‹</Link>
        <span className="kicker">{longDate(ev.event_date, lang)}</span>
      </header>
      <div className="spread" style={{ alignItems: 'flex-end', padding: '0 6px' }}>
        <div className="serif" style={{ fontSize: 36, lineHeight: 1 }}>{ev.title}</div>
        <Status s={s.status} />
      </div>

      <section className="next" style={{ gap: 16 }}>
        <div className="times" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div><small className="kicker" style={{ color: 'var(--dim)' }}>Be there</small>{s.time_tbc ? <span className="big serif">TBC</span> : <BigTime iso={arrive} />}</div>
          <div className="grow" />
          <div style={{ textAlign: 'right' }}><small className="kicker" style={{ color: 'var(--dim)' }}>Shift starts</small><b style={{ fontSize: 20 }}>{s.time_tbc ? 'TBC' : time(s.planned_start, lang)}</b></div>
        </div>
        <div className="pos-row">
          <span className="pos-badge serif">{s.position_code && s.position_code.length <= 3 ? s.position_code : role.slice(0, 2).toUpperCase()}</span>
          <div><small className="kicker" style={{ color: 'var(--dim)' }}>Your position</small><b>{s.position_detail ? s.position_detail.replace(/^bar\s*-\s*/i, '') : role}</b></div>
        </div>
      </section>

      <div className="sec-head"><span className="serif">Where</span></div>
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

      <div className="sec-head"><span className="serif">What to wear</span></div>
      <section className="card stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 16 }}>
          <span className="wear-big"><UniformIcon kind={kind} size={66} /></span>
          <div><div className="kicker">{kind === 'dress' ? 'Dress' : 'Shirt'}</div><div className="serif" style={{ fontSize: 24, lineHeight: 1.1 }}>{UNIFORM_LABEL[kind].replace(' + tie', '')}</div>
            {kind !== 'dress' && <div className="muted sm">With black tie</div>}</div>
        </div>
        {(extras.length > 0 || bring.length > 0) && <div className="chips">{[...extras, ...bring].map((x, i) => <span key={i} className="wear-chip">{x}</span>)}</div>}
      </section>

      <div className="sec-head"><span className="serif">The event</span></div>
      <section className="card stack" style={{ gap: 14 }}>
        {ev.description && <div className="row" style={{ gap: 12 }}>
          <span className="ev-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg></span>
          <b style={{ fontSize: 16 }}>{ev.description}</b></div>}
        {lead && (
          <div className="look">
            <Avatar name={lead.full_name} url={lead.photo_url} size={60} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="kicker red">Look for</div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{lead.full_name}</div>
              <div className="muted sm">MD on site</div>
            </div>
            {tel && <>
              <a className="circle ok" href={`tel:${tel}`} aria-label={`Call ${lead.full_name}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg></a>
              <a className="circle" href={`sms:${tel}`} aria-label={`Text ${lead.full_name}`}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></a>
            </>}
          </div>
        )}
      </section>
    </main>
  );
}

function calendarUrl(title: string, startIso: string, endIso: string | null, address: string) {
  const f = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = endIso ?? new Date(new Date(startIso).getTime() + 6 * 3600e3).toISOString();
  const p = new URLSearchParams({ action: 'TEMPLATE', text: `G&R · ${title}`, dates: `${f(startIso)}/${f(end)}`, location: address });
  return `https://calendar.google.com/calendar/render?${p}`;
}
