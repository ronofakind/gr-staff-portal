import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useLang } from '../lib/i18n';
import { time } from '../lib/format';
import { Avatar } from '../components/Avatar';

type Row = {
  id: string; position_code: string | null; position_detail: string | null; planned_start: string; planned_end: string | null;
  attendance: 'no_show' | 'cancelled' | null; leave_by: string | null; manager_note: string | null;
  staff: { full_name: string; photo_url: string | null; phone: string | null } | null; punches: { punch_in: string | null; punch_out: string | null } | null;
};
type Ev = { id: string; title: string; event_date: string };
type EvFull = Ev & { address: string | null; start_time: string | null; end_time: string | null; description: string | null;
  dress_code: string | null; hours_submitted_at: string | null; venues: { address: string | null; staff_notes: string | null } | null };

const L = {
  fr: { team: 'Équipe', notIn: 'Pas commencé', start: 'Commencer', end: 'Terminer', startAll: 'Commencer tous', endAll: 'Terminer tous',
    edit: 'Modifier', save: 'Enregistrer', cancel: 'Annuler', in: 'Début', out: 'Fin', started: 'commencés', back: 'Retour', hours: 'h' },
  en: { team: 'Team', notIn: 'Not started', start: 'Start', end: 'End', startAll: 'Start all', endAll: 'End all',
    edit: 'Edit', save: 'Save', cancel: 'Cancel', in: 'Start', out: 'End', started: 'started', back: 'Back', hours: 'h' },
};

/** "HH:MM" on the event date (Montreal); times far before the planned start roll to the next day (after midnight). */
function toIso(date: string, hm: string, ref: string) {
  const guess = new Date(`${date}T${hm}:00Z`);
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName')!.value;
  let d = new Date(guess.getTime() - Number(tz.replace('GMT', '') || 0) * 3600e3);
  if (d.getTime() < new Date(ref).getTime() - 6 * 3600e3) d = new Date(d.getTime() + 24 * 3600e3);
  return d.toISOString();
}
const isBar = (code: string | null, detail: string | null) =>
  /^(BM|BT|BB)$/.test(code ?? '') || /^bar\b/i.test(detail ?? '');

/** What the person does tonight: the detail set on the shift, else a label from the position code. */
function roleLabel(code: string | null, detail: string | null) {
  if (detail) return detail.replace(/^bar\s*-\s*/i, ''); // the BAR / FLOOR tag already says the department
  const map: Record<string, string> = { MD: 'MD', BM: 'Bar manager', BT: 'Bartender', BB: 'Barback', BUS: 'Busboy' };
  return code ? (map[code] ?? (/^\d+$/.test(code) ? 'Waiter' : code)) : 'Waiter';
}
const fmt12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const hm = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto' }) : '';
const hours = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 900000) / 4;

type Ask = { row: Row; kind: 'no_show' | 'cancelled' } | null;

export function Manage() {
  const { eventId } = useParams(); const lang = useLang(); const t = L[lang];
  const [ev, setEv] = useState<EvFull | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<Row | null>(null);
  const [draft, setDraft] = useState({ in: '', out: '' });
  const [ask, setAsk] = useState<Ask>(null);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [early, setEarly] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');

  const load = async () => {
    const [e, s] = await Promise.all([
      supabase.from('events').select('id,title,event_date,address,start_time,end_time,description,dress_code,hours_submitted_at,venues(address,staff_notes)').eq('id', eventId!).single(),
      supabase.from('shifts').select('id,position_code,position_detail,planned_start,planned_end,attendance,leave_by,manager_note,staff:staff!shifts_staff_id_fkey(full_name,photo_url,phone),punches(punch_in,punch_out)')
        .eq('event_id', eventId!).neq('status', 'declined').order('planned_start'),
    ]);
    setEv(e.data as unknown as EvFull);
    setRows(((s.data ?? []) as unknown as Row[]).sort((a, b) => a.planned_start.localeCompare(b.planned_start)
      || (a.position_code === 'MD' ? -1 : b.position_code === 'MD' ? 1 : Number(a.position_code) - Number(b.position_code))));
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [eventId]);

  const set = async (list: { id: string; in: string | null; out: string | null }[]) => {
    setErr('');
    for (const r of list) {
      const { error } = await supabase.rpc('manager_set_punch', { p_shift: r.id, p_in: r.in, p_out: r.out });
      if (error) { setErr(error.message); break; }
    }
    await load();
  };
  const mark = async (id: string, v: 'no_show' | 'cancelled' | null) => {
    setErr('');
    const { error } = await supabase.rpc('manager_set_attendance', { p_shift: id, p_attendance: v });
    if (error) setErr(error.message);
    setAsk(null); setOpen(null); await load();
  };
  const now = () => new Date().toISOString();
  const todayMtl = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
  /** ok: within 3 h of call · early: 3–6 h before (ask first, flagged) · locked: earlier, or not the event day */
  const gate = (r: Row): { kind: 'ok' | 'early' | 'locked'; label?: string } => {
    const call = new Date(r.planned_start).getTime(); const mins = (call - Date.now()) / 60000;
    const at = (ms: number) => new Date(ms).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
    if (ev && todayMtl < ev.event_date) {
      const d = new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short' });
      return { kind: 'locked', label: `Opens ${d} ${at(call - 3 * 3600e3)}` };
    }
    if (mins > 360) return { kind: 'locked', label: `Opens ${at(call - 3 * 3600e3)}` };
    if (mins > 180) return { kind: 'early' };
    return { kind: 'ok' };
  };
  const startRows = (list: Row[]) => {
    const go = list.filter((r) => gate(r).kind !== 'locked');
    if (!go.length) return;
    if (go.some((r) => gate(r).kind === 'early')) setEarly(go);
    else set(go.map((r) => ({ id: r.id, in: now(), out: null })));
  };

  if (!ev) return <div className="loading" />;
  const active = rows.filter((r) => !r.attendance);
  const groups = Array.from(new Set(rows.map((r) => r.planned_start)));
  const barN = active.filter((r) => isBar(r.position_code, r.position_detail)).length;
  const floorN = active.length - barN;
  const workingN = active.filter((r) => r.punches?.punch_in && !r.punches?.punch_out).length;
  const doneN = active.filter((r) => r.punches?.punch_out).length;
  const late = active.filter((r) => !r.punches?.punch_in && new Date(r.planned_start).getTime() < Date.now());
  const flaggedN = rows.length - active.length;
  const pct = (n: number) => `${rows.length ? (n / rows.length) * 100 : 0}%`;
  const lateMin = late.length ? Math.round((Date.now() - Math.min(...late.map((r) => new Date(r.planned_start).getTime()))) / 60000) : 0;
  const first = (n?: string) => (n ?? '').split(' ')[0];

  return (
    <main className="page v2">
      <header className="row" style={{ paddingTop: 12 }}>
        <Link to="/" className="back" aria-label={t.back}>‹</Link>
        <span className="kicker">{ev.event_date === new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }) ? 'Tonight' : new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long' })} · your team</span>
      </header>
      <div style={{ padding: '0 6px' }}>
        <div className="serif" style={{ fontSize: 34, lineHeight: 1 }}>{ev.title}</div>
        <div className="muted sm" style={{ marginTop: 4 }}>{new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}{ev.start_time ? ` · ${fmt12(ev.start_time)}${ev.end_time ? ` – ${fmt12(ev.end_time)}` : ''}` : ''}</div>
      </div>

      <section className="mt-sum">
        <div className="row-a">
          <div><small>Working now</small><span className="big">{workingN}<span> / {active.length}</span></span></div>
          <div className="counts">
            <span><b>{floorN}</b> floor</span><span><b>{barN}</b> bar</span><span><b>{doneN}</b> done</span>
            {flaggedN > 0 && <span className="ns"><b>{flaggedN}</b> out</span>}
          </div>
        </div>
        <div className="mt-bar">
          <i style={{ width: pct(workingN), background: '#5CC08E' }} />
          <i style={{ width: pct(doneN), background: '#F6F2EC' }} />
          <i style={{ width: pct(late.length), background: '#E0727A' }} />
          <i style={{ width: pct(flaggedN), background: '#6B625A' }} />
        </div>
        {late.length > 0 && <div className="mt-late">{late.length} late · not started {lateMin} min after their start</div>}
      </section>
      {err && <p className="error">{err}</p>}

      {groups.map((g) => {
        const grp = rows.filter((r) => r.planned_start === g);
        const notIn = grp.filter((r) => !r.attendance && !r.punches?.punch_in);
        const working = grp.filter((r) => !r.attendance && r.punches?.punch_in && !r.punches?.punch_out);
        return (
          <section key={g} className="stack" style={{ gap: 10 }}>
            <div className="grp-head">
              <span className="serif">{time(g, lang)} call</span>
              {notIn.length > 0 && (gate(notIn[0]).kind === 'locked'
                ? <span className="locked-pill">🔒 {gate(notIn[0]).label}</span>
                : <button className="btn-go" onClick={() => startRows(notIn)}>Start remaining ({notIn.length})</button>)}
              {notIn.length === 0 && working.length > 0 && <button className="pill-line" onClick={() => set(working.map((r) => ({ id: r.id, in: r.punches!.punch_in, out: now() })))}>End all ({working.length})</button>}
            </div>
            {grp.map((r) => {
              const pin = r.punches?.punch_in ?? null; const pout = r.punches?.punch_out ?? null;
              const isLate = !r.attendance && !pin && new Date(r.planned_start).getTime() < Date.now();
              const ring = r.attendance ? '' : pout ? 'done' : pin ? 'working' : isLate ? 'late' : '';
              const tel = r.staff?.phone?.replace(/[^\d+]/g, '');
              return (
                <div key={r.id} className={'crew' + (r.attendance ? ' flagged' : '')}>
                  <div className={'ring ' + ring}>
                    <Avatar name={r.staff?.full_name ?? '?'} url={r.staff?.photo_url} size={44} />
                    {isBar(r.position_code, r.position_detail) ? <span className="dept-tag is-bar">BAR</span> : <span className="dept-tag is-floor">FLOOR</span>}
                  </div>
                  <button className="who" aria-label={`Options for ${r.staff?.full_name}`} onClick={() => { setOpen(r); setDraft({ in: hm(pin) || hm(r.planned_start), out: hm(pout) }); }}>
                    <span className="nm">{r.staff?.full_name}</span>
                    <span className="rl">{roleLabel(r.position_code, r.position_detail)}{r.manager_note ? ' · 📝 note' : ''}</span>
                    {r.attendance ? <span className="st red">{r.attendance === 'no_show' ? 'No-show' : 'Cancelled'}</span>
                      : pout ? <span className="st">{time(pin!, lang)} → {time(pout, lang)} · {hours(pin!, pout)} {t.hours}</span>
                      : pin ? <span className="st ok">Working · since {time(pin, lang)}{new Date(pin).getTime() < new Date(r.planned_start).getTime() - 3 * 3600e3 && <b className="early-flag"> · early start</b>}</span>
                      : isLate ? <span className="st red">Late · {Math.round((Date.now() - new Date(r.planned_start).getTime()) / 60000)} min</span>
                      : <span className="st">{t.notIn}</span>}
                  </button>
                  {tel && !r.attendance ? <>
                    <a className="ic" href={`tel:${tel}`} aria-label={`Call ${r.staff!.full_name}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg></a>
                    <a className="ic" href={`sms:${tel}`} aria-label={`Text ${r.staff!.full_name}`}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg></a>
                  </> : <><span className="ic ghost" aria-hidden="true" /><span className="ic ghost" aria-hidden="true" /></>}
                  <div className="act-slot">
                    {r.attendance ? <button className="act undo" onClick={() => mark(r.id, null)}>Undo</button>
                      : !pin ? (gate(r).kind === 'locked' ? <button className="act locked" disabled title={gate(r).label}>{t.start}</button> : <button className="act start" onClick={() => startRows([r])}>{t.start}</button>)
                      : !pout ? <button className="act end" onClick={() => set([{ id: r.id, in: pin, out: now() }])}>{t.end}</button> : <span className="act done-mark">✓</span>}
                    {r.leave_by && !pout && !r.attendance && <span className="leave-tag">⏱ Leaves ~{time(r.leave_by, lang).replace(':00', '')}</span>}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      <p className="hint" style={{ textAlign: 'center' }}>Tap a name for times, no-show or cancelled</p>

      <div className="submit-bar">
        <div className="grow">
          <b>{ev.hours_submitted_at ? '✓ Hours submitted' : 'End of night'}</b>
          <span>{ev.hours_submitted_at ? `${new Date(ev.hours_submitted_at).toLocaleString('en-CA', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' })} · you can still edit` : "Check everyone's times, then send"}</span>
        </div>
        <button className="btn-ink" style={{ height: 46, padding: '0 18px', borderRadius: 23 }} onClick={() => setReview(true)}>{ev.hours_submitted_at ? 'Resubmit ›' : 'Submit hours ›'}</button>
      </div>

      {early && (
        <>
          <div className="scrim top" onClick={() => setEarly(null)} />
          <div className="dialog" role="alertdialog" aria-label="Early start">
            <div className="bang" style={{ background: '#FBF1D3', color: '#9A7413' }}>!</div>
            <div className="serif">Start {early.length === 1 ? early[0].staff?.full_name : `${early.length} people`} early?</div>
            <p>The call time is {time(early[0].planned_start, lang)} — that's more than 3 hours from now.<br />Only do this if they're really starting now. Ronnie will see it flagged.</p>
            <div className="btns">
              <button className="btn-red" style={{ background: '#9A7413' }} onClick={() => { const l = early; setEarly(null); set(l.map((r) => ({ id: r.id, in: now(), out: null }))); }}>Yes, start now</button>
              <button className="btn-ghost" onClick={() => setEarly(null)}>Go back</button>
            </div>
          </div>
        </>
      )}

      {review && (() => {
        const missing = active.filter((r) => !r.punches?.punch_in || !r.punches?.punch_out);
        const done = active.filter((r) => r.punches?.punch_in && r.punches?.punch_out);
        const total = done.reduce((n, r) => n + hours(r.punches!.punch_in!, r.punches!.punch_out!), 0);
        const submit = async () => {
          setBusy(true); setErr('');
          const { error } = await supabase.rpc('manager_submit_hours', { p_event: ev.id });
          setBusy(false);
          if (error) { setErr(error.message); return; }
          setReview(false); await load();
        };
        return (
          <div className="review">
            <div className="page v2" style={{ paddingBottom: 170 }}>
              <header className="row" style={{ paddingTop: 12 }}>
                <button className="back" style={{ border: 'none', cursor: 'pointer' }} aria-label="Back" onClick={() => setReview(false)}>‹</button>
                <span className="kicker">{ev.title} · {new Date(ev.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              </header>
              <div style={{ padding: '0 6px' }}>
                <div className="serif" style={{ fontSize: 32, lineHeight: 1 }}>Submit hours</div>
                <div className="muted sm" style={{ marginTop: 4 }}>Review everyone's times before you send.</div>
              </div>
              {missing.length > 0 && (
                <div className="todo" style={{ alignItems: 'flex-start' }}>
                  <span className="bang-sm">!</span>
                  <div className="grow"><b>{missing.length} {missing.length === 1 ? 'person is' : 'people are'} missing a time</b>
                    <span>{missing.map((r) => first(r.staff?.full_name)).join(', ')} · tap Fix to add it before you submit.</span></div>
                </div>
              )}
              {rows.map((r) => {
                const pin = r.punches?.punch_in ?? null; const pout = r.punches?.punch_out ?? null;
                const miss = !r.attendance && (!pin || !pout);
                return (
                  <div key={r.id} className={'rv' + (miss ? ' miss' : '') + (r.attendance ? ' out' : '')}>
                    <div className={'ring sm ' + (r.attendance ? '' : miss ? 'late' : 'working')}><Avatar name={r.staff?.full_name ?? '?'} url={r.staff?.photo_url} size={36} /></div>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="nm">{r.staff?.full_name}</div>
                      <div className="tm">{r.attendance ? (r.attendance === 'no_show' ? 'No-show' : 'Cancelled')
                        : `${pin ? time(pin, lang) : 'no start time'} → ${pout ? time(pout, lang) : 'no end time'}`}</div>
                      {r.manager_note ? <div className="rv-note">📝 {r.manager_note}</div>
                        : <button className="link-btn" onClick={() => { setReview(false); setOpen(r); setDraft({ in: hm(pin) || hm(r.planned_start), out: hm(pout) }); }}>+ Add note</button>}
                    </div>
                    {r.attendance ? <span className="muted sm strong">0 h</span>
                      : miss ? <button className="pill-red" style={{ height: 32 }} onClick={() => { setReview(false); setOpen(r); setDraft({ in: hm(pin) || hm(r.planned_start), out: hm(pout) }); }}>Fix ›</button>
                      : <span className="serif" style={{ fontSize: 20 }}>{hours(pin!, pout!)}<span className="muted" style={{ fontSize: 12, fontFamily: 'Inter' }}> h</span></span>}
                  </div>
                );
              })}
              <div className="spread muted sm" style={{ padding: '4px 6px' }}>
                <span>{done.length} complete{missing.length ? ` · ${missing.length} missing` : ''}{flaggedN ? ` · ${flaggedN} out` : ''}</span>
                <span>Total <b className="serif" style={{ fontSize: 22, color: 'var(--ink)' }}>{total}</b> h</span>
              </div>
              {err && <p className="error">{err}</p>}
            </div>
            <div className="review-foot">
              {missing.length > 0 ? <>
                <button className="btn-ink" onClick={() => { const r = missing[0]; setReview(false); setOpen(r); setDraft({ in: hm(r.punches?.punch_in ?? null) || hm(r.planned_start), out: hm(r.punches?.punch_out ?? null) }); }}>Fix {missing.length} missing time{missing.length > 1 ? 's' : ''}</button>
                <button className="btn-ghost" style={{ height: 44, color: 'var(--accent)', borderColor: 'var(--accent)' }} disabled={busy} onClick={submit}>Submit anyway</button>
              </> : <button className="btn-ink" style={{ background: 'var(--ok)' }} disabled={busy} onClick={submit}>{busy ? 'Sending…' : `Submit ${total} h`}</button>}
              <span className="muted" style={{ fontSize: 11, textAlign: 'center' }}>You can still edit after submitting, until the pay period is closed.</span>
            </div>
          </div>
        );
      })()}

      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(null)} />
          <div className="sheet" role="dialog" aria-label={`Options for ${open.staff?.full_name}`}>
            <div className="grab" />
            <div className="row" style={{ gap: 12 }}>
              <Avatar name={open.staff?.full_name ?? '?'} url={open.staff?.photo_url} size={48} />
              <div><div className="serif" style={{ fontSize: 22 }}>{open.staff?.full_name}</div>
                <div className="muted sm">{roleLabel(open.position_code, open.position_detail)} · {isBar(open.position_code, open.position_detail) ? 'BAR' : 'FLOOR'} · start {time(open.planned_start, lang)}</div></div>
            </div>
            {!open.attendance && (
              <div className="times-box">
                <label>Start time<input type="time" value={draft.in} onChange={(e) => setDraft({ ...draft, in: e.target.value })} /></label>
                <label>End time<input type="time" value={draft.out} onChange={(e) => setDraft({ ...draft, out: e.target.value })} /></label>
              </div>
            )}
            {!open.attendance && <button className="btn-ink" onClick={async () => {
              const i = draft.in ? toIso(ev.event_date, draft.in, open.planned_start) : null;
              const o = draft.out ? toIso(ev.event_date, draft.out, i ?? open.planned_start) : null;
              await set([{ id: open.id, in: i, out: o }]); setOpen(null);
            }}>Save times</button>}
            {open.attendance
              ? <button className="btn-ghost" onClick={() => mark(open.id, null)}>Undo {open.attendance === 'no_show' ? 'no-show' : 'cancelled'}</button>
              : <div className="two">
                  <button className="big-opt red" onClick={() => setAsk({ row: open, kind: 'no_show' })}>No-show<small>Didn't come, no notice</small></button>
                  <button className="big-opt ink" onClick={() => setAsk({ row: open, kind: 'cancelled' })}>Cancelled<small>Called in / sent home</small></button>
                </div>}
            {open.leave_by && <span className="leave-tag inline">⏱ Needs to leave ~{time(open.leave_by, lang)} · reminder only</span>}
            <NoteBox key={open.id} initial={open.manager_note ?? ''} onSave={async (v) => { setErr(''); const { error } = await supabase.rpc('manager_set_note', { p_shift: open.id, p_note: v }); if (error) setErr(error.message); await load(); }} />
            <button className="btn-ghost" style={{ height: 46 }} onClick={() => setOpen(null)}>Close</button>
          </div>
        </>
      )}

      {ask && (
        <>
          <div className="scrim top" onClick={() => setAsk(null)} />
          <div className="dialog" role="alertdialog" aria-label="Confirm">
            <div className="bang">!</div>
            <div className="serif">Mark {first(ask.row.staff?.full_name)} {ask.row.staff?.full_name.split(' ').slice(1).join(' ')}<br />as {ask.kind === 'no_show' ? 'a no-show' : 'cancelled'}?</div>
            <p>They won't get hours for {ev.title}.{ask.row.punches?.punch_in ? ' Their start time will be cleared.' : ''}<br />You can undo it from the team list.</p>
            <div className="btns">
              <button className="btn-red" onClick={() => mark(ask.row.id, ask.kind)}>Yes, mark {ask.kind === 'no_show' ? 'no-show' : 'cancelled'}</button>
              <button className="btn-ghost" onClick={() => setAsk(null)}>Go back</button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

/** Card on the Home screen for whoever manages an event today. */
export function ManagingToday({ meId, isAdmin }: { meId: string; isAdmin: boolean }) {
  const lang = useLang();
  const [evs, setEvs] = useState<Ev[]>([]);
  useEffect(() => {
    const yesterday = new Date(Date.now() - 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    const week = new Date(Date.now() + 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    let q = supabase.from('events').select('id,title,event_date').gte('event_date', yesterday).lte('event_date', week)
      .neq('department', 'bar').order('event_date');
    if (!isAdmin) q = q.eq('manager_id', meId);
    q.then(({ data }) => setEvs((data ?? []) as Ev[]));
  }, [meId]);
  if (!evs.length) return null;
  return (
    <>
      {evs.map((e) => (
        <Link key={e.id} to={`/manage/${e.id}`} className="card manage-card">
          <div className="grow">
            <div className="eyebrow accent">{lang === 'fr' ? 'Tu gères' : "You're managing"} · {e.event_date <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' }) ? 'today' : new Date(e.event_date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <div className="h2">{e.title}</div>
          </div>
          <span className="btn primary sm">{lang === 'fr' ? 'Équipe' : 'Team'} ›</span>
        </Link>
      ))}
    </>
  );
}

function NoteBox({ initial, onSave }: { initial: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(initial); const [saved, setSaved] = useState(false);
  return (
    <div className="note-box">
      <span>Note for Ronnie <em>(optional)</em></span>
      <textarea rows={2} value={v} placeholder="e.g. had an emergency" onChange={(e) => { setV(e.target.value); setSaved(false); }} />
      {v.trim() !== initial.trim() && <button className="btn-ink" style={{ height: 40 }} onClick={async () => { await onSave(v); setSaved(true); }}>Save note</button>}
      {saved && <small className="okc">✓ Note saved</small>}
    </div>
  );
}
