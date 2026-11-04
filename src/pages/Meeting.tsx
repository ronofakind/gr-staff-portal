import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { JoinButton, MeetingNotes, PlaceBadge } from '../components/Meeting';
import { SecTitle } from './Shift';
import { useMyCalendar, addCalendar, defaultCalOs } from '../lib/calendar';
import { answerMeeting, dayCaps, isOver, lengthLabel, placeName, t12, whenWord, dayShort, type MeetingPage } from '../lib/meetings';
import { Brand } from '../components/Brand';

/** Push 38 · staff meeting page: top card (Teams colour), Join, linked event, what it's about, who's invited, answer, notes. */
export function Meeting({ backTo = '/' }: { backTo?: string }) {
  const { id } = useParams();
  const [p, setP] = useState<MeetingPage | null | undefined>(undefined);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const { cal, setCal } = useMyCalendar();
  const load = () => supabase.rpc('meeting_page', { p_meeting: id }).then(({ data, error }) => setP(error ? null : ((data as MeetingPage | null) ?? null)));
  useEffect(() => { load(); supabase.rpc('meeting_seen', { p_meeting: id }).then(() => {}, () => {}); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (p === undefined) return <div className="loading" />;
  if (p === null) return (
    <main className="page v2"><header className="row d3-top"><Link to={backTo} className="back" aria-label="Back">‹</Link><span className="kicker grow">MEETING</span></header>
      <div className="card"><b>This meeting isn’t on your list.</b><p className="muted sm" style={{ margin: '6px 0 0' }}>Ask Ronnie if you think you should be on it.</p></div></main>
  );
  const m = p.meeting; const over = isOver(m); const gone = !!m.cancelled_at;
  const answer = async (a: 'coming' | 'cant') => {
    setBusy(true); setErr('');
    const e = await answerMeeting(m.id, a);
    setBusy(false); if (e) setErr(e); else load();
  };
  const people = [...(p.organizer ? [{ id: p.organizer.id, full_name: p.organizer.full_name, photo_url: p.organizer.photo_url }] : []),
    ...p.invites.filter((i) => i.staff_id !== p.organizer?.id).map((i) => ({ id: i.staff_id, full_name: i.full_name, photo_url: i.photo_url, nickname: i.nickname }))];
  const nameOf = (x: { id: string; full_name: string; nickname?: string | null }) => (x.id === p.me ? 'you' : x.nickname || x.full_name.split(' ')[0]);
  const word = whenWord(m);

  return (
    <main className="page v2 mtg-page">
      <header className="row d3-top">
        <Link to={backTo} className="back" aria-label="Back">‹</Link>
        <span className="kicker grow">{dayCaps(m.starts_at)}</span>
        {gone ? <span className="mtg-tag no">CANCELLED</span> : p.my_answer === 'coming' ? <span className="mtg-tag ok">✓ YOU’RE COMING</span> : p.my_answer === 'cant' ? <span className="mtg-tag no">CAN’T MAKE IT</span> : null}
      </header>

      <section className={'mtg-hero' + (gone ? ' gone' : '')}>
        <div className="mtg-hero-kick"><PlaceBadge kind={m.place_kind} size={22} /><span>MEETING{word && !gone ? ` · ${word}` : ''}</span></div>
        <div className="serif mtg-hero-title">{m.title}</div>
        <div className="mtg-hero-box">
          <div><small>STARTS</small><span className="serif">{t12(m.starts_at)}</span></div>
          <div><small>ABOUT</small><b>{lengthLabel(m.duration_min)}</b></div>
        </div>
        {m.place_kind === 'in_person' && m.address && <div className="mtg-hero-addr">📍 {m.address}</div>}
        {!gone && p.my_answer !== 'cant' && <JoinButton m={m} light />}
        {m.place_kind !== 'in_person' && <div className="mtg-hero-sub">{placeName(m)}</div>}
      </section>
      {gone && <div className="card"><b>This meeting is cancelled.</b><p className="muted sm" style={{ margin: '4px 0 0' }}>It’s off your <Brand /> calendar. Nothing to do.</p></div>}

      {p.events.length > 0 && <>
        <div className="mtg-for">FOR THIS EVENT</div>
        {p.events.map((e) => (
          <div key={e.id} className="mtg-ev">
            <span className="mtg-ev-ic" aria-hidden="true">🗓</span>
            <div className="grow" style={{ minWidth: 0 }}><b>{e.title}</b><small>{dayShort(e.event_date + 'T12:00:00')} · {e.venue}</small></div>
            <span className="mtg-linked">LINKED</span>
          </div>
        ))}
      </>}

      {m.about && <><SecTitle>What it’s about</SecTitle><section className="d3-card mtg-about">{m.about}</section></>}

      <SecTitle>Who’s invited</SecTitle>
      <section className="d3-card mtg-who">
        <span className="mtg-faces">{people.slice(0, 6).map((x) => <Avatar key={x.id} name={x.full_name} url={x.photo_url} size={32} />)}</span>
        <span className="grow">{people.map(nameOf).join(', ')}</span>
      </section>

      {!gone && !over && <>
        <div className="mtg-ans big">
          <button className={'mtg-yes' + (p.my_answer === 'coming' ? ' on' : '')} disabled={busy} onClick={() => answer('coming')}>✓ Coming</button>
          <button className={'mtg-no' + (p.my_answer === 'cant' ? ' on' : '')} disabled={busy} onClick={() => answer('cant')}>Can’t make it</button>
        </div>
        {err && <p className="error">{err}</p>}
        {p.my_answer === 'coming' && (cal?.added_at
          ? <p className="muted sm mtg-center">In your <Brand /> calendar{m.place_kind === 'in_person' ? ' with the address' : ` with the ${m.place_kind === 'zoom' ? 'Zoom' : 'Teams'} link`}.</p>
          : cal ? <button className="btn-ghost" style={{ height: 46 }} onClick={() => addCalendar(cal, defaultCalOs()).then(setCal)}>Add my <Brand /> calendar</button> : null)}
        {p.my_answer !== 'coming' && <p className="muted sm mtg-center">Say Coming and it goes in your <Brand /> calendar with the link. Meetings are paid like a shift.</p>}
      </>}

      <SecTitle>{`Notes${p.notes.filter((n) => !n.deleted_at).length ? ` · ${p.notes.filter((n) => !n.deleted_at).length}` : ''}`}</SecTitle>
      <MeetingNotes meetingId={m.id} meetingStart={m.starts_at} notes={p.notes} meId={p.me} onChanged={load} />
      <p className="muted sm mtg-center">Everyone invited can add notes during or after the meeting. Ronnie picks the ones that go on the event page.</p>
      <div style={{ height: 24 }} />
    </main>
  );
}
