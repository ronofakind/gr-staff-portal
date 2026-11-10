import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, SHIFT_SELECT, type ShiftRow } from '../lib/supabase';
import { FixedSheet } from './SwipeSheet';
import { CancelSheet, ChangeSheet } from './ShiftChange';
import { KICKER, answerAsk, byText, dayShort, t12, uniformText, whatChanges, type Card, type MyAsk } from '../lib/shiftAsks';
import type { Msg, Side } from '../lib/messages';

/* Push 40 · shift notes in the Ronnie conversation (Your shift changed · New shift · Shift removed · answers) and the ask cards
   (Can you do a new time? · Can you work this event instead? · Can you do a new position? · Can you work this shift?).
   Same AskCard on Home, in Messages and in My dates. */

export type NoteMeta = {
  card?: 'shift_changed' | 'new_shift' | 'shift_removed' | 'ask' | 'ask_result';
  shift_id?: string; alert_id?: string; date?: string; venue?: string; position?: string; start?: string;
  lines?: { label: string; old: string | null; new: string | null }[]; got_it_at?: string;
  ask_id?: string; kind?: MyAsk['kind']; answer?: 'yes' | 'no' | 'keep'; state?: string; note?: string | null; due_at?: string;
  old?: Card; new?: Card;
  /** push 47 (054) · shift_removed with its own words: "Thanks for telling us, you're off …" / "You're no longer needed …" */
  line?: string;
};

/** Who sees what changed: "Start ~~5:45 PM~~ → 6:15 PM". */
function Line({ label, old, nw }: { label: string; old?: string | null; nw?: string | null }) {
  return <div className="sn-line"><span>{label}</span><span>{old && <s>{old}</s>}{old && ' → '}<b>{nw}</b></span></div>;
}

/* ───────── ask card ───────── */
export function AskCard({ a, preview = false, onAnswered, home = false }: { a: MyAsk; preview?: boolean; onAnswered?: (status: string) => void; home?: boolean }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState<string | null>(null);
  const o = a.meta.old; const n = a.meta.new;
  const go = async (yes: boolean) => {
    if (preview) return;
    setBusy(true); setErr('');
    try { const r = await answerAsk(a.ask_id, yes); setDone(r.status); onAnswered?.(r.status); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  const state = done === 'gone' ? 'gone' : done === 'booked' ? 'booked' : done === 'accepted' ? 'yes' : done === 'declined' || done === 'no' ? 'no' : done ?? a.state;
  if (state === 'gone') return <div className="sn sn-muted"><b>This shift is no longer available.</b><span>Nothing was booked. Thanks for answering!</span></div>;
  const open = state === 'open';
  const yesLbl = a.kind === 'fill' ? '✓ Yes, I’ll take it' : a.kind === 'move' ? '✓ Yes, move me' : '✓ Yes, that works';
  const noLbl = a.kind === 'fill' ? 'No, thanks' : a.kind === 'move' ? `No, keep ${o?.venue ?? 'my shift'}` : 'No, I can’t';
  return (
    <div className={'sn sn-ask' + (home ? ' home' : '') + (open ? '' : ' closed')}>
      <small className="sn-k gold">{KICKER[a.kind]}</small>
      {a.kind === 'fill' ? <>
        <div className="serif sn-venue">{n.venue}</div>
        <span className="sn-sub">{dayShort(n.date)} · <b>{n.position} · {t12(n.start)}</b>{n.client ? ` · ${n.client}` : ''}</span>
        <span className="sn-dim">{[n.address, n.uniform ? `👔 ${uniformText(n.uniform)}` : ''].filter(Boolean).join(' · ')}</span>
      </> : a.kind === 'move' ? <>
        <b>{dayShort(n.date)}</b>
        {o && <div className="sn-box old"><small>INSTEAD OF</small><s className="serif">{o.venue}</s><span>{o.position} · {t12(o.start)}</span>{o.address && <span className="sn-dim">{o.address}</span>}</div>}
        <div className="sn-box new"><small>NEW</small><b className="serif">{n.venue}</b><span>{n.position} · <b>{t12(n.start)}</b></span><span className="sn-dim">{[n.address, n.client].filter(Boolean).join(' · ')}</span></div>
        <div className="sn-gold">{whatChanges(o, n)}</div>
      </> : <>
        <b>{dayShort(n.date)} · {n.venue}</b>
        {a.kind === 'earlier_start' ? <Line label="Start" old={o ? t12(o.start) : null} nw={t12(n.start)} /> : <Line label="Position" old={o?.position} nw={n.position} />}
      </>}
      {open && a.due_at && <span className="sn-by">{byText(a.due_at)}</span>}
      {open ? <div className="sn-btns">
        <button className="sn-yes" disabled={busy} onClick={() => go(true)}>{busy ? '…' : yesLbl}</button>
        <button className="sn-no" disabled={busy} onClick={() => go(false)}>{noLbl}</button>
      </div> : <span className={'sn-state ' + (state === 'yes' || state === 'booked' ? 'ok' : '')}>
        {state === 'yes' || state === 'booked' ? '✓ You said yes' : state === 'no' ? 'You said no' : state === 'expired' ? 'The answer time passed · Ronnie will get back to you' : state === 'cancelled' ? 'No longer needed · nothing changes' : ''}
      </span>}
      {err && <p className="error">{err}</p>}
      {open && a.kind !== 'fill' && <span className="sn-dim">Your shift stays as it is until you say yes.</span>}
    </div>
  );
}

/* ───────── notes in the conversation ───────── */
export function ShiftNote({ m, side, ask, staffSeenAt, onChanged }: { m: Msg; side: Side; ask?: MyAsk | null; staffSeenAt?: string | null; onChanged: () => void }) {
  const meta = m.meta as unknown as NoteMeta;
  const [busy, setBusy] = useState(false); const [cant, setCant] = useState(false);
  const staff = side === 'staff';
  const seenTag = staffSeenAt && staffSeenAt >= m.created_at;
  if (meta.card === 'ask') {
    if (staff && ask) return <div className="ch-row"><AskCard a={ask} onAnswered={onChanged} /><div className="ch-meta sn-time">{t12(m.created_at)}</div></div>;
    // Ronnie's view (or the card before it loads): what was asked + where it stands
    const st = ask?.state ?? meta.state ?? 'open';
    const tag = st === 'yes' || st === 'booked' ? <i className="ib-tag ok">✓ YES</i> : st === 'no' ? <i className="ib-tag red">NO</i> : st === 'expired' ? <i className="ib-tag gold">NO ANSWER</i>
      : st === 'cancelled' ? <i className="ib-tag">STOPPED</i> : st === 'gone' ? <i className="ib-tag">TAKEN / REMOVED</i> : <i className="ib-tag gold">WAITING</i>;
    const n = meta.new;
    return (
      <div className="ch-row"><div className="sn sn-ask closed">
        <small className="sn-k gold">{meta.kind ? KICKER[meta.kind] : '🗓 QUESTION'}</small>
        {n && <b>{dayShort(n.date)} · {n.venue} · {n.position} · {t12(n.start)}</b>}
        {meta.old && meta.kind === 'move' && <span className="sn-dim">instead of {meta.old.venue} · {t12(meta.old.start)}</span>}
        {meta.old && meta.kind === 'earlier_start' && <Line label="Start" old={t12(meta.old.start)} nw={n ? t12(n.start) : ''} />}
        {meta.due_at && <span className="sn-dim">{byText(meta.due_at)}</span>}
        <span>{tag}{!staff && st === 'open' && <i className={'ib-tag' + (seenTag ? '' : ' red')} style={{ marginLeft: 6 }}>{seenTag ? 'SEEN' : 'NOT OPENED'}</i>}</span>
        <div className="ch-meta">{t12(m.created_at)}</div>
      </div></div>
    );
  }
  if (meta.card === 'ask_result') {
    const yes = meta.answer === 'yes'; const fill = meta.kind === 'fill';
    const k = fill ? '🙋 YOU’RE BOOKED' : `🗓 ${meta.kind === 'move' ? 'MOVED' : meta.kind === 'position' ? 'NEW POSITION' : 'NEW TIME'} · ${meta.answer === 'keep' ? 'NO CHANGE' : yes ? 'YOU SAID YES' : 'YOU SAID NO'}`;
    const n = meta.new;
    return (
      <div className="ch-row"><div className={'sn ' + (yes ? 'sn-ok' : 'sn-plain')}>
        <small className={'sn-k ' + (yes ? 'ok' : 'muted')}>{k}</small>
        {n && <b>{dayShort(n.date)} · {meta.kind === 'move' && yes ? `now ${n.venue}` : (meta.old?.venue ?? n.venue)}</b>}
        {yes && n && meta.kind === 'move' && <span className="sn-dim">{n.position} · <b>{t12(n.start)}</b>{n.address ? ` · ${n.address}` : ''}</span>}
        {yes && n && fill && <span className="sn-dim">{n.position} · <b>{t12(n.start)}</b> · booked</span>}
        {yes ? <span className="sn-pill">{fill ? '✓ It’s in your schedule' : m.body.replace(/^✓\s*/, '✓ ')}</span> : <span>{m.body}</span>}
        {!yes && meta.answer === 'no' && <NoNote m={m} staff={staff} />}
        <div className="ch-meta">{t12(m.created_at)}</div>
      </div></div>
    );
  }
  const n = meta;
  if (meta.card === 'new_shift') return (
    <div className="ch-row"><div className="sn sn-new">
      <small className="sn-k ok">🗓 NEW SHIFT</small>
      <b>{n.date ? dayShort(n.date) : ''}{n.venue ? ` · ${n.venue}` : ''}</b>
      <span>{[n.position, n.start ? t12(n.start) : null].filter(Boolean).join(' · ')}{staff ? <> · <Link to="/my-dates?tab=booked" className="strong">Confirm in My dates ›</Link></> : ''}</span>
      {!staff && <span>{seenTag ? <i className="ib-tag">SEEN</i> : <i className="ib-tag red">NOT OPENED</i>}</span>}
      <div className="ch-meta">{t12(m.created_at)}</div>
    </div></div>
  );
  if (meta.card === 'shift_removed') return (
    <div className="ch-row"><div className="sn sn-red">
      <small className="sn-k red">🗓 SHIFT REMOVED</small>
      <b>{n.date ? dayShort(n.date) : ''}{n.venue ? ` · ${n.venue}` : ''}</b>
      <span>{meta.line || 'You’re no longer on this event. Questions? Reply here.'}</span>
      {!staff && <span>{seenTag ? <i className="ib-tag">SEEN</i> : <i className="ib-tag red">NOT OPENED</i>}</span>}
      <div className="ch-meta">{t12(m.created_at)}</div>
    </div></div>
  );
  // shift_changed
  const got = async () => {
    setBusy(true);
    await supabase.rpc('shift_note_got_it', { p_message: m.id });
    setBusy(false); onChanged();
  };
  return (
    <div className="ch-row"><div className="sn sn-chg">
      <small className="sn-k gold">🗓 YOUR SHIFT CHANGED</small>
      <b>{n.date ? dayShort(n.date) : ''}{n.venue ? ` · ${n.venue}` : ''}</b>
      {(n.lines ?? []).map((l, i) => <Line key={i} label={l.label} old={l.old} nw={l.new} />)}
      {meta.got_it_at ? <span className="sn-got">✓ Got it · {t12(meta.got_it_at)}</span>
        : staff ? <div className="sn-btns">
          <button className="sn-yes" disabled={busy} onClick={got}>✓ Got it</button>
          {meta.shift_id && <button className="sn-no" onClick={() => setCant(true)}>Can’t make it</button>}
        </div>
        : <span>{seenTag ? <i className="ib-tag">SEEN · NO ANSWER</i> : <i className="ib-tag red">NOT OPENED</i>}</span>}
      <div className="ch-meta">{t12(m.created_at)}</div>
      {cant && meta.shift_id && <CantMakeIt shiftId={meta.shift_id} onClose={() => { setCant(false); onChanged(); }} />}
    </div></div>
  );
}

/** After "No": optional note for Ronnie (never asked why). */
function NoNote({ m, staff }: { m: Msg; staff: boolean }) {
  const meta = m.meta as unknown as NoteMeta;
  const [v, setV] = useState(''); const [sent, setSent] = useState<string | null>(meta.note ?? null); const [busy, setBusy] = useState(false);
  if (sent) return <span className="sn-quote">“{sent}”</span>;
  if (!staff || !meta.ask_id) return null;
  const send = async () => { setBusy(true); const { error } = await supabase.rpc('shift_ask_note', { p_ask: meta.ask_id, p_note: v }); setBusy(false); if (!error) setSent(v.trim()); };
  return (
    <div className="sn-note">
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add a note for Ronnie (optional)" />
      {v.trim() && <button disabled={busy} onClick={send}>Send</button>}
    </div>
  );
}

/** "Can't make it" on a change note → the push 28 steps (Schedule changed / Can't make it). */
export function CantMakeIt({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const [s, setS] = useState<ShiftRow | null | undefined>(undefined);
  const [step, setStep] = useState<'pick' | 'change' | 'cancel'>('pick');
  useEffect(() => { supabase.from('shifts').select(SHIFT_SELECT).eq('id', shiftId).maybeSingle().then(({ data }) => setS((data as unknown as ShiftRow) ?? null)); }, [shiftId]);
  if (!s) return null;
  if (step === 'change') return <ChangeSheet s={s} onClose={onClose} onSent={onClose} />;
  if (step === 'cancel') return <CancelSheet s={s} onClose={onClose} onDone={onClose} />;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <FixedSheet onClose={onClose} label="Can't make it" closeLabel={null}>
        <div><div className="kicker">{dayShort(s.events.event_date)} · {s.events.title}</div><div className="serif p28-h">What’s the problem?</div></div>
        <button className="opt-big" onClick={() => setStep('change')}>My schedule changed · I can come later / leave early</button>
        <button className="opt-big" onClick={() => setStep('cancel')}>I can’t make it at all</button>
        <button type="button" className="fs-close" onClick={onClose}>Close</button>
      </FixedSheet>
    </>
  );
}
