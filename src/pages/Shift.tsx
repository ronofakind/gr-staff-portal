import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, SHIFT_SELECT, type ShiftRow } from '../lib/supabase';
import { useT, useLang } from '../lib/i18n';
import { time, longDate, minus, initials, mapsUrl } from '../lib/format';

export function Shift() {
  const t = useT(); const lang = useLang();
  const { id } = useParams();
  const [s, setS] = useState<ShiftRow | null>(null);

  useEffect(() => {
    supabase.from('shifts').select(SHIFT_SELECT).eq('id', id!).single()
      .then(({ data }) => setS(data as unknown as ShiftRow));
  }, [id]);

  if (!s) return <div className="loading" />;
  const ev = s.events;
  const address = ev.address || ev.venues?.address || '';
  const arrive = minus(s.planned_start, s.arrive_before_min);
  const steps = [
    { time: time(arrive, lang), label: ev.manager ? `${lang === 'fr' ? 'Arrivée, présente-toi à' : 'Arrive, check in with'} ${ev.manager.full_name.split(' ')[0]}` : (lang === 'fr' ? 'Arrivée' : 'Arrive'), strong: true },
    { time: time(s.planned_start, lang), label: lang === 'fr' ? 'Début du quart, punch in' : 'Shift starts, punch in', strong: true },
    ...(ev.timeline ?? []).map((x) => ({ time: x.time, label: x.label, strong: false })),
    ...(s.planned_end ? [{ time: '~' + time(s.planned_end, lang), label: lang === 'fr' ? 'Fin, punch out' : 'Ends, punch out', strong: false }] : []),
  ];
  const cal = calendarUrl(ev.title, arrive, s.planned_end, address);

  return (
    <main className="page">
      <header className="top bar">
        <Link to="/" className="icon-btn" aria-label={t('back')}>‹</Link>
        <div>
          <h1>{ev.title}</h1>
          <div className="muted sm">{longDate(ev.event_date, lang)}{s.position_code ? ` · ${t('youAre')} ${s.position_code}` : ''}</div>
        </div>
      </header>

      <section className="card dark stack">
        <div className="spread"><span className="eyebrow light">{t('beThereAt')}</span><span className="sm light">{s.arrive_before_min} {t('minBefore')}</span></div>
        <div className="huge">{time(arrive, lang)}</div>
        <ol className="timeline">
          {steps.map((x, i) => <li key={i} className={x.strong ? 'strong' : ''}><span>{x.time}</span>{x.label}</li>)}
        </ol>
      </section>

      {s.position_detail && (
        <section className="card stack">
          <div className="eyebrow">{t('yourPosition')}</div>
          <div className="h2">{s.position_detail}</div>
        </section>
      )}

      <section className="card stack">
        <div className="eyebrow">{t('where')}</div>
        <div><div className="strong">{ev.venues?.name ?? ev.title}</div><div className="muted">{address}</div></div>
        {ev.venues?.staff_notes && <div className="note">{ev.venues.staff_notes}</div>}
        <div className="row2">
          {address && <a className="btn" href={mapsUrl(address)} target="_blank" rel="noreferrer">{t('directions')}</a>}
          <a className="btn" href={cal} target="_blank" rel="noreferrer">{t('addCal')}</a>
        </div>
      </section>

      {(ev.dress_code || ev.bring) && (
        <section className="card stack">
          <div className="eyebrow">{t('wear')}</div>
          {[ev.dress_code, ev.bring].filter(Boolean).flatMap((x) => x!.split('\n')).map((line, i) => (
            <div key={i} className="check">✓ <span>{line}</span></div>
          ))}
        </section>
      )}

      <section className="card stack">
        <div className="eyebrow">{t('theEvent')}</div>
        {ev.description && <p className="body">{ev.description}</p>}
        {ev.manager && (
          <div className="lookfor">
            {ev.manager.photo_url
              ? <img src={ev.manager.photo_url} alt={ev.manager.full_name} className="avatar xl" />
              : <div className="avatar xl" role="img" aria-label={ev.manager.full_name}>{initials(ev.manager.full_name)}</div>}
            <div className="grow">
              <div className="eyebrow accent">{t('lookFor')}</div>
              <div className="h2">{ev.manager.full_name}</div>
            </div>
            {ev.manager.phone && <a className="icon-btn ok" href={`https://wa.me/${ev.manager.phone.replace(/\D/g, '')}`} aria-label="WhatsApp"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1b7f5c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></a>}
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
