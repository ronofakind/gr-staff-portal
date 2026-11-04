import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, type Staff } from '../lib/supabase';
import { TabBar } from '../components/TabBar';
import { PageHead } from '../components/ProfileMenu';
import { SwipeSheet } from '../components/SwipeSheet';
import { FromPicker, ampm15 } from '../components/TimeWheel';
import { ConfirmThanks } from '../components/ConfirmThanks';
import { useMyCalendar } from '../lib/calendar';
import { callName } from '../lib/nickname';
import {
  useMyDates, toAnswer, isOpen, urgent, latestKnows, answerByText, whereText, dayLabel, monDay, mtlToday, addDays, D,
  type MyDate,
} from '../lib/myDates';
import { AskCard } from '../components/ShiftNotes';
import { useMyAsks } from '../lib/shiftAsks';
import { useMyMeetings, dayOfMtl, t12 as mt12, type MyMeeting } from '../lib/meetings';
import { useSettings } from '../lib/settings';
import { feedbackOn } from './Manage';
import { usePastEvents, managesShift, roleOf, type PastShift, type TeamSum } from '../lib/pastEvents';

/** Booked tab rows (shifts from today on). confirm_by is push 33 (039). */
type Shift = { id: string; status: 'booked' | 'confirmed' | 'declined'; attendance: string | null; planned_start: string; time_tbc: boolean;
  confirm_by: string | null; events: { id: string; event_date: string; title: string; details_pending?: boolean | null; venues: { name: string } | null } };
type Week = { dow: number; status: 'yes' | 'from' | 'no'; from_time: string | null };
type Tab = 'answer' | 'booked' | 'answered' | 'past';

const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const dow3 = (iso: string) => D(iso).toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
const monthName = (iso: string) => D(iso).toLocaleDateString('en-US', { month: 'long' });
const dowMon0 = (iso: string) => (D(iso).getDay() + 6) % 7; // 0 = Monday (staff_weekly)
const notFinal = (s: Shift) => !!s.events.details_pending || !!s.time_tbc;

/** Push 35b · My dates: List (Answer · Booked · Answered) | Calendar. Replaces the Schedule tab. */
export function MyDates({ me, base = '', preview = false }: { me: Staff; base?: string; preview?: boolean }) {
  const nav = useNavigate(); const [params, setParams] = useSearchParams();
  const today = mtlToday();
  const { dates, setDates, reload } = useMyDates(me.id, preview);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [week, setWeek] = useState<Record<number, Week>>({});
  const [err, setErr] = useState('');
  const [justDone, setJustDone] = useState<Set<string>>(new Set()); // answered on this visit: stay in Answer, in their new colour
  const [sheet, setSheet] = useState<{ d: MyDate; mode: 'pick' | 'yes' | 'maybe' } | null>(null);
  const [dky, setDky] = useState<null | { by: string; ids: string[] }>(null); // "Don't know your schedule yet?"
  const [dkyOpen, setDkyOpen] = useState(false);
  const [thanks, setThanks] = useState<Shift | null>(null);
  const { cal, setCal } = useMyCalendar(preview);
  const { meetings } = useMyMeetings(me.id, preview); // push 38 · meetings in Booked (MEETING tag)
  // push 40 · "Can you work this shift?" asks sit on top of Answer (same card as Home and Messages)
  const { asks: allAsks, reload: reloadAsks } = useMyAsks(preview || me.role === 'admin');
  const fills = allAsks.filter((a) => a.kind === 'fill');
  // push 51 · Past tab: my own past shifts, last 30 days (+ team / hours / rating status for the ones I managed)
  useSettings(); const fbOn = feedbackOn(me) && !preview; // admin view-as: ratings are per manager, not shown
  const past = usePastEvents(me.id, 30, fbOn);

  const loadShifts = () => supabase.from('shifts')
    .select('id,status,attendance,planned_start,time_tbc,confirm_by,events!inner(id,event_date,title,details_pending,venues(name))')
    .eq('staff_id', me.id).neq('status', 'declined').gte('events.event_date', today)
    .then(({ data, error }) => {
      if (error) console.warn('[my dates · shifts]', error.message);
      setShifts(((data ?? []) as unknown as Shift[]).filter((s) => s.attendance !== 'cancelled').sort((a, b) => a.planned_start.localeCompare(b.planned_start)));
    });
  useEffect(() => {
    loadShifts();
    supabase.from('staff_weekly').select('dow,status,from_time').eq('staff_id', me.id)
      .then(({ data }) => setWeek(Object.fromEntries(((data ?? []) as Week[]).map((w) => [w.dow, w]))));
  }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = dates ?? [];
  const answerList = all.filter((d) => toAnswer(d, today) || justDone.has(d.id))
    .sort((a, b) => Number(urgent(b) && toAnswer(b, today)) - Number(urgent(a) && toAnswer(a, today))
      || (a.answer_by ?? '9').localeCompare(b.answer_by ?? '9') || a.for_date.localeCompare(b.for_date));
  const waiting = all.filter((d) => toAnswer(d, today));
  const answered = all.filter((d) => !d.booked && d.status !== 'asked' && !toAnswer(d, today));
  const booked = shifts ?? [];
  const mtgs = (meetings ?? []).filter((m) => dayOfMtl(m.starts_at) >= today);
  const bookedRows: ({ k: 's'; at: string; s: Shift } | { k: 'm'; at: string; m: MyMeeting })[] = [
    ...booked.map((s) => ({ k: 's' as const, at: s.planned_start, s })), ...mtgs.map((m) => ({ k: 'm' as const, at: m.starts_at, m })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const tabParam = params.get('tab') as Tab | null;
  const view = params.get('view') === 'cal' ? 'cal' : 'list';
  const [tab, setTabState] = useState<Tab | null>(tabParam);
  useEffect(() => { if (tabParam) setTabState(tabParam); }, [tabParam]);
  // Opens on Answer when something waits, otherwise on Booked (decided once, so answering the last date doesn't jump tabs).
  useEffect(() => { if (tab === null && dates !== null) setTabState(waiting.length || fills.length ? 'answer' : 'booked'); }, [dates === null]); // eslint-disable-line react-hooks/exhaustive-deps
  const curTab: Tab = tab ?? (dates === null || waiting.length ? 'answer' : 'booked');
  const setTab = (t: Tab) => { setTabState(t); setParams((p) => { p.set('tab', t); p.delete('view'); return p; }, { replace: true }); };
  const setView = (v: 'list' | 'cal') => setParams((p) => { if (v === 'cal') p.set('view', 'cal'); else p.delete('view'); return p; }, { replace: true });

  const usualFor = (iso: string): string | null | undefined => { const w = week[dowMon0(iso)]; return !w || w.status === 'no' ? undefined : w.from_time ? w.from_time.slice(0, 5) : null; };

  /** One answer: optimistic, then the RPC (answer_my_date, 041). */
  const save = async (d: MyDate, status: 'yes' | 'maybe' | 'no', extra: { from?: string | null; knows?: string } = {}) => {
    setSheet(null); setErr('');
    if (preview) return;
    setJustDone((s) => new Set(s).add(d.id));
    setDates((list) => (list ?? []).map((x) => x.id === d.id ? { ...x, status, from_time: status === 'yes' ? (extra.from ?? null) : null, knows_by: status === 'maybe' ? extra.knows ?? null : null } : x));
    const { error } = await supabase.rpc('answer_my_date', { p_id: d.id, p_status: status, p_from: status === 'yes' ? (extra.from ?? null) : null, p_knows_by: status === 'maybe' ? extra.knows : null, p_note: null });
    if (error) { setErr(error.message); reload(); }
  };
  const dontKnow = async (by: string, note: string, ids: string[]) => {
    setDkyOpen(false); setErr('');
    if (preview) return;
    const { error } = await supabase.rpc('dont_know_yet', { p_knows_by: by, p_note: note.trim() || null, p_ids: ids });
    if (error) { setErr(error.message); return; }
    setDky({ by, ids });
    setDates((list) => (list ?? []).map((x) => ids.includes(x.id) ? { ...x, status: 'maybe', knows_by: by, from_time: null } : x));
    reload();
  };
  const confirm = async (s: Shift) => {
    if (preview) return;
    const { error } = await supabase.rpc('respond_to_shift', { p_shift: s.id, p_response: 'confirmed' });
    if (error) { setErr(error.message); return; }
    setThanks(s); // push 33a · same thank-you pop-up as Home
    setShifts((l) => (l ?? []).map((x) => (x.id === s.id ? { ...x, status: 'confirmed' } : x)));
  };

  const firstOf = (list: { for_date?: string; events?: { event_date: string } }[]) => (list[0] ? (list[0].for_date ?? list[0].events!.event_date) : today);
  const title = curTab === 'past' ? 'My dates' : monthName(curTab === 'answer' ? firstOf(answerList) : curTab === 'booked' ? firstOf(booked) : firstOf(answered));
  const dkyList = dky ? all.filter((d) => dky.ids.includes(d.id)) : waiting;

  return (
    <main className="page v2 md">
      <PageHead me={me} preview={preview} kicker="My dates" title={view === 'cal' ? 'Calendar' : title} />
      <div className="seg" role="tablist">
        <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>☰ List</button>
        <button className={view === 'cal' ? 'on' : ''} onClick={() => setView('cal')}>▦ Calendar</button>
      </div>
      {err && <p className="error">{err}</p>}

      {view === 'list' ? <>
        <div className="md-tabs four" role="tablist">
          <button className={curTab === 'answer' ? 'on' : ''} onClick={() => setTab('answer')}>Answer <i className={'n' + (waiting.length + fills.length ? ' red' : '')}>{waiting.length + fills.length}</i></button>
          <button className={curTab === 'booked' ? 'on' : ''} onClick={() => setTab('booked')}>Booked <i className={'n' + (curTab === 'booked' && bookedRows.length ? ' green' : '')}>{bookedRows.length}</i></button>
          <button className={curTab === 'answered' ? 'on' : ''} onClick={() => setTab('answered')}>Answered <i className={'n' + (curTab === 'answered' && answered.length ? ' dark' : '')}>{answered.length}</i></button>
          <button className={curTab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>Past</button>
        </div>

        {curTab === 'past' ? (
          past.shifts === null ? <div className="loading" style={{ minHeight: 240 }} /> : (
            <section className="md-list">
              {past.shifts.map((s) => <PastRow key={s.id} s={s} base={base} mine={managesShift(s, me.id)} sum={past.sums[s.events.id]} fbOn={fbOn} />)}
              {!past.shifts.length && <div className="md-empty"><b className="serif">No past shifts yet</b><span>Shifts you worked in the last 30 days show up here.</span></div>}
              {past.shifts.length > 0 && <p className="md-foot">Last 30 days, newest first. Tap one for the details{past.shifts.some((s) => managesShift(s, me.id)) ? ', your team and hours' : ''}.</p>}
            </section>
          )
        ) : dates === null || shifts === null ? <div className="loading" style={{ minHeight: 240 }} /> : curTab === 'answer' ? (
          <section className="md-list">
            {fills.map((a) => <AskCard key={a.ask_id} a={a} preview={preview} onAnswered={(st) => { if (st === 'booked') loadShifts(); setTimeout(reloadAsks, st === 'gone' ? 4000 : 2500); }} />)}
            {dky && (
              <div className="md-dky done">
                <span className="md-dky-ic" aria-hidden="true">⏳</span>
                <div className="grow"><b>You’ll know by {dayLabel(dky.by)}</b><small>We’ll remind you that day.</small></div>
                <button className="link-btn" onClick={() => setDkyOpen(true)}>Change</button>
              </div>
            )}
            {waiting.length >= 2 && (
              <div className="md-dky">
                <span className="md-dky-ic" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg></span>
                <div className="grow"><b>Don’t know your schedule yet?</b><small>Tell Ronnie when you’ll know</small></div>
                <button className="md-dky-btn" onClick={() => { setDky(null); setDkyOpen(true); }}>Tell him</button>
              </div>
            )}
            {answerList.map((d) => justDone.has(d.id) && !toAnswer(d, today)
              ? <AnsweredRow key={d.id} d={d} onTap={() => setSheet({ d, mode: 'pick' })} />
              : <AnswerRow key={d.id} d={d} onYes={() => setSheet({ d, mode: 'yes' })} onMaybe={() => setSheet({ d, mode: 'maybe' })} onNo={() => save(d, 'no')} />)}
            {!answerList.length && !dky && !fills.length && <div className="md-empty"><b className="serif">All answered, thanks!</b><span>When G&amp;R sends you new dates, they show up here.</span></div>}
            {answerList.length > 0 && <p className="md-foot">Answer any date, in any order. Saying yes doesn’t book you yet.</p>}
          </section>
        ) : curTab === 'booked' ? (
          <section className="md-list">
            {bookedRows.map((r) => r.k === 's' ? <BookedRow key={r.s.id} s={r.s} base={base} onConfirm={() => confirm(r.s)} />
              : <MeetingRow key={r.m.id} m={r.m} to={preview ? `/admin/meeting/${r.m.id}` : `/meeting/${r.m.id}`} />)}
            {!bookedRows.length && <div className="md-empty"><b className="serif">No shifts booked yet</b><span>Shifts G&amp;R books you on show up here.</span></div>}
          </section>
        ) : (
          <section className="md-list">
            {answered.map((d) => <AnsweredRow key={d.id} d={d} onTap={() => setSheet({ d, mode: 'pick' })} />)}
            {!answered.length && <div className="md-empty"><b className="serif">Nothing answered yet</b><span>Dates you answer show up here. Tap one to change it.</span></div>}
            {answered.length > 0 && <p className="md-foot">In date order. Tap any one to change it.</p>}
          </section>
        )}
      </> : (
        <CalendarView me={me} today={today} dates={all} shifts={booked} preview={preview}
          onAnswer={(d) => setSheet({ d, mode: 'pick' })} onShift={(s) => nav(`${base}/shift/${s.id}`)} />
      )}

      {sheet?.mode === 'pick' && <PickSheet d={sheet.d} onClose={() => setSheet(null)} onYes={() => setSheet({ d: sheet.d, mode: 'yes' })} onMaybe={() => setSheet({ d: sheet.d, mode: 'maybe' })} onNo={() => save(sheet.d, 'no')} />}
      {sheet?.mode === 'yes' && <YesSheet d={sheet.d} usual={usualFor(sheet.d.for_date)} onClose={() => setSheet(null)} onPick={(from) => save(sheet.d, 'yes', { from })} />}
      {sheet?.mode === 'maybe' && <KnowsSheet title={`${dayLabel(sheet.d.for_date)} · when will you know?`} latest={latestKnows([sheet.d])} oneTap
        onClose={() => setSheet(null)} onPick={(by) => save(sheet.d, 'maybe', { knows: by })} />}
      {dkyOpen && <KnowsSheet title="When will you know?" latest={latestKnows(dkyList)} withNote
        sub={<>Your {[String(dkyList.length), monthsOf(dkyList), dkyList.length === 1 ? 'date' : 'dates'].filter(Boolean).join(' ')} become <b className="gold">Maybe</b> until then. We’ll remind you that day.</>}
        onClose={() => setDkyOpen(false)} onPick={(by, note) => dontKnow(by, note, dkyList.map((d) => d.id))} />}
      {thanks && <ConfirmThanks name={callName(me)} cal={preview ? null : cal} onCal={setCal} onClose={() => setThanks(null)}
        line={`${thanks.events.venues?.name ?? thanks.events.title} · ${dayLabel(thanks.events.event_date)} · ${t12(thanks.planned_start)}`} />}
      <div style={{ height: 90 }} />
      <TabBar base={base} badge={waiting.length + fills.length} />
    </main>
  );
}

const monthsOf = (list: MyDate[]) => { const m = [...new Set(list.map((d) => monthName(d.for_date)))]; return m.length === 1 ? m[0] : ''; };

function DateSq({ iso, kind }: { iso: string; kind: 'neutral' | 'booked' | 'yes' | 'maybe' | 'no' | 'answer' | 'meeting' }) {
  return <div className={'md-sq ' + kind}><small>{dow3(iso)}</small><b>{D(iso).getDate()}</b></div>;
}

/** Board D: plain white card, neutral date, venue · evening, red "Answer by …"; red outline only under 24 h. */
function AnswerRow({ d, onYes, onMaybe, onNo }: { d: MyDate; onYes: () => void; onMaybe: () => void; onNo: () => void }) {
  const hot = urgent(d);
  return (
    <div className={'md-card' + (hot ? ' hot' : '')}>
      <div className="md-top">
        <DateSq iso={d.for_date} kind="neutral" />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="md-where">{whereText(d)}</b>
          <span className="md-by">{hot ? '⏰ ' : ''}{answerByText(d)}</span>
          {d.status === 'maybe' && d.knows_by && <span className="md-tag maybe">MAYBE · KNOWS BY {monDay(d.knows_by).toUpperCase()}</span>}
        </div>
      </div>
      <div className="md-btns">
        <button className="y" onClick={onYes}>Yes</button>
        <button className="m" onClick={onMaybe}>Maybe</button>
        <button className="n" onClick={onNo}>No</button>
      </div>
    </div>
  );
}

function AnsweredRow({ d, onTap }: { d: MyDate; onTap: () => void }) {
  if (d.status === 'yes') return (
    <div className="md-card row">
      <DateSq iso={d.for_date} kind="yes" />
      <div className="grow" style={{ minWidth: 0 }}><b>Yes · {d.from_time ? ampm15(d.from_time.slice(0, 5)) : 'any time'}</b><span className="md-tag yes">NOT BOOKED YET</span><small className="md-sub">{whereText(d)}</small></div>
      <button className="md-chg" onClick={onTap}>Change</button>
    </div>
  );
  if (d.status === 'maybe') return (
    <div className="md-card row">
      <DateSq iso={d.for_date} kind="maybe" />
      <div className="grow" style={{ minWidth: 0 }}><b>Maybe</b>{d.knows_by && <span className="md-tag maybe">KNOWS BY {monDay(d.knows_by).toUpperCase()}</span>}<small className="md-sub">{whereText(d)}</small></div>
      <button className="md-chg gold" onClick={onTap}>Answer</button>
    </div>
  );
  return (
    <button className="md-card row no" onClick={onTap}>
      <DateSq iso={d.for_date} kind="no" />
      <div className="grow" style={{ minWidth: 0 }}><b>No</b><small className="md-sub">Plans changed? tap to change</small></div>
    </button>
  );
}

function BookedRow({ s, base, onConfirm }: { s: Shift; base: string; onConfirm: () => void }) {
  const place = s.events.venues?.name ?? s.events.title;
  const toConfirm = s.status === 'booked' && !notFinal(s);
  const left = s.confirm_by ? Math.floor((new Date(s.confirm_by).getTime() - Date.now()) / 3600e3) : null;
  return (
    <div className="md-card row booked">
      <DateSq iso={s.events.event_date} kind="booked" />
      <div className="grow" style={{ minWidth: 0 }}>
        <b>{s.events.details_pending ? 'You’re booked' : place} · {notFinal(s) ? 'time TBC' : t12(s.planned_start)}</b>
        {notFinal(s) ? <span className="md-tag soon">DETAILS COMING</span>
          : toConfirm ? <span className="md-tag red">{left == null ? 'TO CONFIRM' : left <= 0 ? 'CONFIRM NOW' : `${left} H TO CONFIRM`}</span>
          : <span className="md-tag ok">✓ BOOKED</span>}
      </div>
      {toConfirm ? <button className="md-confirm" onClick={onConfirm}>Confirm</button> : <Link className="md-chg" to={`${base}/shift/${s.id}`}>Details</Link>}
    </div>
  );
}

/** push 51 · a past shift: date, venue, position · start – end; managers: hours sent / to rate, staff: approved / waiting. */
function PastRow({ s, base, mine, sum, fbOn }: { s: PastShift; base: string; mine: boolean; sum?: TeamSum; fbOn: boolean }) {
  const p = s.punches; const a = p?.punch_in ?? s.planned_start; const b = p?.punch_out ?? s.planned_end;
  const sent = !!s.events.hours_submitted_at;
  return (
    <Link to={`${base}/shift/${s.id}?past=1`} className="md-card row past">
      <DateSq iso={s.events.event_date} kind="neutral" />
      <div className="grow" style={{ minWidth: 0 }}>
        <b>{s.events.venues?.name ?? s.events.title}</b>
        <span className="md-pos">{roleOf(s.position_code, s.position_detail)} · {t12(a)}{b ? ` – ${t12(b)}` : ''}{mine && sum ? ` · you managed ${sum.team}` : ''}</span>
        <span className="md-tags">
          {mine ? <>
            {sent ? <span className="md-tag okl">✓ HOURS SENT</span> : <span className="md-tag gold">HOURS NOT SENT</span>}
            {fbOn && sum && sum.newStaff.length > 0 && (sum.toRate ? <span className="md-tag ink">★ {sum.toRate} TO RATE</span> : <span className="md-tag okl">✓ RATED</span>)}
          </> : sent ? <span className="md-tag okl">✓ APPROVED</span> : <span className="md-tag wait">WAITING</span>}
        </span>
      </div>
      <span className="md-go" aria-hidden="true">›</span>
    </Link>
  );
}

/** push 38 · a meeting in Booked: Teams-purple date square + MEETING tag. */
function MeetingRow({ m, to }: { m: MyMeeting; to: string }) {
  return (
    <Link to={to} className="md-card row mtg-mdrow">
      <DateSq iso={dayOfMtl(m.starts_at)} kind="meeting" />
      <div className="grow" style={{ minWidth: 0 }}>
        <b>{m.title} · {mt12(m.starts_at)}</b>
        <span className="md-tag mtg">MEETING</span>{m.answer === 'coming' ? <span className="md-tag ok" style={{ marginLeft: 6 }}>✓ COMING</span> : m.answer === 'cant' ? <span className="md-tag soon" style={{ marginLeft: 6 }}>CAN’T MAKE IT</span> : <span className="md-tag red" style={{ marginLeft: 6 }}>ANSWER</span>}
      </div>
      <span className="md-chg">Details</span>
    </Link>
  );
}

/** Tap an answered date (or a date in the calendar): Yes / Maybe / No again. */
function PickSheet({ d, onClose, onYes, onMaybe, onNo }: { d: MyDate; onClose: () => void; onYes: () => void; onMaybe: () => void; onNo: () => void }) {
  const latest = latestKnows([d]); const canMaybe = !!latest && latest >= mtlToday();
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <SwipeSheet onClose={onClose} label="Change your answer">
        <div><div className="kicker">{whereText(d).toUpperCase()}</div><div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{dayLabel(d.for_date)} · are you free?</div></div>
        {d.status === 'asked' && d.answer_by && <span className="md-by">{answerByText(d)}</span>}
        <div className="md-btns big">
          <button className={'y' + (d.status === 'yes' ? ' cur' : '')} onClick={onYes}>Yes</button>
          <button className={'m' + (d.status === 'maybe' ? ' cur' : '')} disabled={!canMaybe} onClick={onMaybe}>Maybe</button>
          <button className={'n' + (d.status === 'no' ? ' cur' : '')} onClick={onNo}>No</button>
        </div>
        <p className="muted sm" style={{ margin: 0 }}>{canMaybe ? 'Saying yes doesn’t book you yet. G&R confirms the team closer to the date.' : 'The answer-by date has passed: Yes or No only.'}</p>
      </SwipeSheet>
    </>
  );
}

/** Yes → "from what time?" chips; their usual time for that weekday is pre-picked (green). One tap saves and closes. */
function YesSheet({ d, usual, onClose, onPick }: { d: MyDate; usual: string | null | undefined; onClose: () => void; onPick: (from: string | null) => void }) {
  const [other, setOther] = useState(false); const [t, setT] = useState<string | null>(null);
  const chips = useMemo(() => { const c = ['15:00', '16:00', '17:00', '18:00']; if (usual && !c.includes(usual)) c.push(usual); return c.sort(); }, [usual]);
  const cur = d.status === 'yes' ? (d.from_time ? d.from_time.slice(0, 5) : 'any') : usual === null ? 'any' : usual ?? null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <SwipeSheet onClose={onClose} label="From what time?">
        <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{dayLabel(d.for_date)} · from what time?</div>
        {!other ? <>
          <div className="md-chips">
            <button className={cur === 'any' ? 'on' : ''} onClick={() => onPick(null)}>Any time</button>
            {chips.map((c) => <button key={c} className={cur === c ? 'on' : ''} onClick={() => onPick(c)}>{ampm15(c)}</button>)}
            <button onClick={() => setOther(true)}>Other…</button>
          </div>
          <p className="muted sm" style={{ margin: 0 }}>{usual !== undefined ? `Your usual ${D(d.for_date).toLocaleDateString('en-US', { weekday: 'long' })} is in green. ` : ''}Tap a time: it saves and closes.</p>
        </> : <>
          <FromPicker choice={t} setChoice={setT} rest={usual ?? d.approx_start?.slice(0, 5) ?? '17:00'} />
          <button className="big-btn dark" disabled={!t} onClick={() => onPick(t === 'any' ? null : t)}>{!t ? 'Pick a time' : t === 'any' ? 'Save · any time' : `Save · from ${ampm15(t)}`}</button>
        </>}
      </SwipeSheet>
    </>
  );
}

/**
 * Maybe → "when will you know?" (also "Don't know your schedule yet?" and Home's "Still not sure").
 * Quick picks: In 3 days · In a week · the latest day (= answer-by) · Pick a date. Never after `latest`.
 * oneTap: a pick saves and closes. withNote: pick, optional note for Ronnie, then the dark button.
 */
export function KnowsSheet({ title, sub, latest, oneTap = false, withNote = false, onClose, onPick }:
  { title: string; sub?: React.ReactNode; latest: string | null; oneTap?: boolean; withNote?: boolean; onClose: () => void; onPick: (by: string, note: string) => void }) {
  const today = mtlToday();
  const [by, setBy] = useState<string | null>(null); const [note, setNote] = useState(''); const [picking, setPicking] = useState(false);
  if (!latest || latest < today) return (
    <>
      <div className="scrim" onClick={onClose} />
      <SwipeSheet onClose={onClose} label={title}><div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{title}</div>
        <p className="muted sm" style={{ margin: 0 }}>The answer-by date has passed. Answer Yes or No, or talk to Ronnie.</p></SwipeSheet>
    </>
  );
  const quick = [addDays(today, 3), addDays(today, 7)].filter((x) => x < latest);
  const tap = (x: string) => { if (oneTap) onPick(x, ''); else { setBy(x); setPicking(false); } };
  const custom = by && !quick.includes(by) && by !== latest;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <SwipeSheet onClose={onClose} label={title}>
        <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{title}</div>
        {sub && <p className="muted sm" style={{ margin: 0 }}>{sub}</p>}
        <div className="md-chips">
          {quick.map((x) => <button key={x} className={by === x ? 'on dark' : ''} onClick={() => tap(x)}>{x === addDays(today, 3) ? 'In 3 days' : 'In a week'}</button>)}
          <button className={by === latest ? 'on dark' : ''} onClick={() => tap(latest)}>{dayLabel(latest)} (latest)</button>
          <button className={custom ? 'on dark' : ''} onClick={() => setPicking(true)}>{custom ? dayLabel(by!) : 'Pick a date'}</button>
        </div>
        {picking && <input className="sheet-input" type="date" min={today} max={latest} value={by ?? ''} onChange={(e) => { const v = e.target.value; if (v && v >= today && v <= latest) tap(v); }} />}
        {withNote ? <>
          <p className="muted sm" style={{ margin: 0 }}>Latest is the answer-by date, {dayLabel(latest)}.</p>
          <div className="kicker">Note for Ronnie (optional)</div>
          <input className="sheet-input" value={note} maxLength={200} placeholder="e.g. Waiting for my school schedule" onChange={(e) => setNote(e.target.value)} />
          <button className="big-btn dark" disabled={!by} onClick={() => by && onPick(by, note)}>{by ? `I’ll know by ${dayLabel(by)}` : 'Pick a day'}</button>
        </> : <p className="muted sm" style={{ margin: 0 }}>Tap one: it saves and closes. We’ll remind you that day.</p>}
      </SwipeSheet>
    </>
  );
}

/** Board C: solid green = booked · red = to answer · green outline = yes · dashed gold = maybe · grey = no · TODAY outlined. */
function CalendarView({ me, today, dates, shifts, preview, onAnswer, onShift }:
  { me: Staff; today: string; dates: MyDate[]; shifts: Shift[]; preview: boolean; onAnswer: (d: MyDate) => void; onShift: (s: Shift) => void }) {
  const [month, setMonth] = useState(today.slice(0, 8) + '01');
  const [sel, setSel] = useState<string | null>(null);
  const [daysOff, setDaysOff] = useState<{ from_date: string; to_date: string; reason: string | null }[]>([]);
  const [usualNo, setUsualNo] = useState<Set<number>>(new Set());
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => {
    Promise.all([
      supabase.from('days_off').select('from_date,to_date,reason').eq('staff_id', me.id).gte('to_date', today),
      supabase.from('staff_weekly').select('dow,status').eq('staff_id', me.id),
      supabase.from('avail_exceptions').select('for_date').eq('staff_id', me.id).gte('for_date', today),
    ]).then(([o, w, x]) => {
      setDaysOff((o.data ?? []) as typeof daysOff);
      setUsualNo(new Set(((w.data ?? []) as { dow: number; status: string }[]).filter((r) => r.status === 'no').map((r) => r.dow)));
      setOpened(new Set(((x.data ?? []) as { for_date: string }[]).map((r) => r.for_date)));
    });
  }, [me.id, today]);
  const first = D(month); const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: last }, (_, i) => month.slice(0, 8) + String(i + 1).padStart(2, '0'))];
  const byDate = Object.fromEntries(dates.map((d) => [d.for_date, d]));
  const shiftOn = (iso: string) => shifts.find((s) => s.events.event_date === iso);
  const offOn = (iso: string) => daysOff.find((o) => o.from_date <= iso && o.to_date >= iso);
  const usuallyNo = (iso: string) => usualNo.has(dowMon0(iso)) && !opened.has(iso);
  const kindOf = (iso: string) => {
    if (shiftOn(iso)) return 'booked';
    const d = byDate[iso]; if (!d || d.booked) return '';
    if (toAnswer(d, today)) return 'answer';
    if (d.status === 'yes') return 'yes'; if (d.status === 'maybe') return 'maybe'; if (d.status === 'no') return 'no';
    return '';
  };
  const tap = (iso: string) => {
    if (iso < today) return;
    const s = shiftOn(iso); if (s) return onShift(s);
    const d = byDate[iso];
    if (d && !d.booked && (toAnswer(d, today) || d.status !== 'asked')) return onAnswer(d);
    setSel(iso === sel ? null : iso);
  };
  const openDay = async (iso: string, on: boolean) => {
    if (preview) return;
    const next = new Set(opened); if (on) next.add(iso); else next.delete(iso); setOpened(next);
    if (on) await supabase.from('avail_exceptions').upsert({ staff_id: me.id, for_date: iso });
    else await supabase.from('avail_exceptions').delete().eq('staff_id', me.id).eq('for_date', iso);
  };
  const step = (n: number) => { const x = D(month); x.setMonth(x.getMonth() + n); setMonth(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`); setSel(null); };
  const dowName = (iso: string) => D(iso).toLocaleDateString('en-US', { weekday: 'long' });
  const expired = (iso: string) => { const d = byDate[iso]; return !!d && d.status === 'asked' && !isOpen(d); };

  return (
    <>
      <div className="md-legend">
        <span><i className="booked" />Booked</span><span><i className="answer" />Answer</span><span><i className="yes" />Yes</span><span><i className="maybe" />Maybe</span><span><i className="no" />No</span>
      </div>
      <section className="md-cal">
        <div className="month-nav">
          <button className="round" aria-label="Previous month" onClick={() => step(-1)} disabled={month <= today.slice(0, 8) + '01'}>‹</button>
          <div><span className="serif">{first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span></div>
          <button className="round" aria-label="Next month" onClick={() => step(1)}>›</button>
        </div>
        <div className="md-heads">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((h, i) => <span key={i}>{h}</span>)}</div>
        <div className="md-grid">
          {cells.map((iso, i) => iso ? (
            <button key={iso} className={'md-day ' + (iso < today ? 'past' : kindOf(iso)) + (iso === today ? ' today' : '') + (iso === sel ? ' sel' : '')} onClick={() => tap(iso)} aria-label={iso}>{D(iso).getDate()}</button>
          ) : <span key={'p' + i} />)}
        </div>
      </section>
      <p className="md-foot">Tap a red date to answer it (same Yes · Maybe · No). Tap a green one for the shift details.</p>
      {sel && sel >= today && (
        offOn(sel) ? <div className="dayoff-card"><div className="grow"><small>DAY OFF · {dayLabel(sel).toUpperCase()}</small><div className="serif">{offOn(sel)!.reason || 'Day off'}</div></div><Link className="link-btn" to="/availability">Days off ›</Link></div>
        : expired(sel) ? <div className="card muted sm">{dayLabel(sel)} · the answer-by time passed. Talk to Ronnie if you can still work it.</div>
        : usuallyNo(sel) ? (
          <div className="usual-card">
            <small>{D(sel).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</small>
            <div className="serif">You’re usually not free on {dowName(sel)}s</div>
            <p>Open this day if you can work it. Ronnie will be able to ask you and book you. Your usual week stays the same.</p>
            <button className="big-btn" style={{ background: 'var(--ok)', color: '#fff', justifyContent: 'center' }} onClick={() => openDay(sel, true)}>I can work this day</button>
          </div>
        ) : opened.has(sel) && usualNo.has(dowMon0(sel)) ? (
          <div className="card row" style={{ gap: 10 }}><span className="opened-tag">✓ Opened up</span><span className="grow muted sm">You can be asked and booked this {dowName(sel)}.</span><button className="link-btn" onClick={() => openDay(sel, false)}>Undo</button></div>
        ) : <div className="card muted sm">{dayLabel(sel)} · nothing yet. G&amp;R’s dates show here when they’re sent.</div>
      )}
    </>
  );
}

