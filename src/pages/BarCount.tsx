import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { TonightsBottles, BarSearchAdd, useCatalog, catMatch } from '../components/BarPick';
import { KINDS, KIND_LABEL, KIND_SHORT, KIND_HOW, sizesFor, LEVELS, q, stepOf, totals, usedOf, moveText, type BItem, type BKind, type BMove, type BSupply } from '../lib/barCount';

/* Push 69 · Bar count (boards BarCountV2 + V3). Nothing is saved by a tap: Start, More out and Bring back are each
   reviewed and confirmed, then logged (who, when). Undo needs a reason. The list (names, sizes) changes for next time too. */
type Data = { event: { id: string; title: string; date: string; supplies: boolean }; items: BItem[]; moves: BMove[]; picked?: boolean; sizes?: Record<string, string[]>;
  count: { supplies: BSupply[]; handed_to: string | null; handed_to_name: string | null; handed_by_name: string | null; submitted_at: string | null; submitted_by_name: string | null } | null;
  team: { id: string; name: string; role: string | null }[] };
type Mode = 'start' | 'more' | 'back' | 'log';
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : '');
const nmOf = (i: BItem) => `${i.name}${i.size ? ' · ' + i.size : ''}`;

export function BarCount() {
  const { eventId } = useParams();
  const [d, setD] = useState<Data | null | undefined>(undefined); const [mode, setMode] = useState<Mode>('start');
  const [draft, setDraft] = useState<Record<string, number>>({}); const [review, setReview] = useState(false);
  const [sup, setSup] = useState<BSupply[]>([]); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [itemEd, setItemEd] = useState<{ id: string | null; kind: BKind; name: string; size: string; other?: boolean } | null>(null);
  const [ct, setCt] = useState(0); const cat = useCatalog(eventId!, ct); const [picking, setPicking] = useState(false); // push 85
  const [hand, setHand] = useState(false); const [undo, setUndo] = useState<{ id: string; reason: string } | null>(null);
  const load = async (keepMode = false) => {
    const { data, error } = await supabase.rpc('bar_count_get', { p_event: eventId });
    if (error) { setErr(error.message); setD(null); return; }
    const x = data as Data | null; setD(x); if (!x) return;
    const saved = x.count?.supplies ?? [];
    setSup(x.event.supplies ? x.items.filter((i) => i.kind === 'supply').map((i) => saved.find((s) => s.item_id === i.id) ?? { item_id: i.id, name: i.name, level: null }) : []);
    if (!keepMode) setMode(x.moves.some((m) => m.step === 'start' && !m.undone_at) ? 'more' : 'start');
  };
  useEffect(() => { load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  const tot = useMemo(() => totals(d?.moves ?? []), [d]);
  const bottles = (d?.items ?? []).filter((i) => i.kind !== 'supply');
  const groups = KINDS.map((k) => ({ k, ls: bottles.filter((i) => i.kind === k) })).filter((g) => g.ls.length);
  if (d === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!d) return <div className="page"><p className="muted">Only the bar manager or MD of this bar event can do the bar count.</p>{err && <p className="error">{err}</p>}<Link to="/">‹ Home</Link></div>;
  const started = d.moves.find((m) => m.step === 'start' && !m.undone_at);
  const c = d.count;
  const pending = Object.entries(draft).filter(([, v]) => v > 0);
  const room = (id: string) => (tot[id]?.out ?? 0) - (tot[id]?.back ?? 0); // what can still come back
  const bump = (i: BItem, dir: 1 | -1) => setDraft((dr) => { const st = mode === 'back' ? stepOf(i.kind) : 1; let v = Math.max(0, Math.round(((dr[i.id] ?? 0) + dir * st) / st) * st);
    if (mode === 'back') v = Math.min(v, room(i.id)); return { ...dr, [i.id]: v }; });
  const switchMode = (m: Mode) => { setMode(m); setDraft({}); setReview(false); setMsg(''); };
  const confirm = async () => {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('bar_move', { p_event: eventId, p_step: mode, p_items: pending.map(([item_id, qty]) => ({ item_id, qty })) });
    setBusy(false); if (error) { setErr(error.message); return; }
    setMsg(mode === 'start' ? '✓ Start count saved' : mode === 'more' ? `✓ Saved · you took out ${pending.length} product${pending.length === 1 ? '' : 's'}` : '✓ Saved · brought back');
    setDraft({}); setReview(false); await load(true); if (mode === 'start') setMode('more');
  };
  const saveItem = async () => { if (!itemEd) return; setBusy(true); setErr('');
    const { error } = await supabase.rpc('bar_item_save', { p_event: eventId, p_item: itemEd.id, p_kind: itemEd.kind, p_name: itemEd.name, p_size: itemEd.size });
    setBusy(false); if (error) setErr(error.message); else { setItemEd(null); load(true); setCt((x) => x + 1); } };
  const doUndo = async () => { if (!undo) return; setBusy(true); const { error } = await supabase.rpc('bar_move_undo', { p_move: undo.id, p_reason: undo.reason }); setBusy(false); if (error) setErr(error.message); else { setUndo(null); load(true); } };
  const submit = async () => { setBusy(true); const { error } = await supabase.rpc('bar_count_submit', { p_event: eventId, p_supplies: sup }); setBusy(false); if (error) setErr(error.message); else { setMsg('✓ Count submitted. You can still add or fix moves; they’re logged.'); load(true); } };
  const handTo = async (sid: string | null) => { setBusy(true); const { error } = await supabase.rpc('bar_count_hand', { p_event: eventId, p_staff: sid }); setBusy(false); setHand(false); if (error) setErr(error.message); else load(true); };
  const hint = mode === 'start' ? 'Count everything going out to the bar, then review and confirm.' : mode === 'more' ? 'Tap + on what you’re taking out (full bottles). Nothing is saved until you confirm.' : mode === 'back' ? 'Tap + on everything coming back (open wine can’t come back; spirits in quarters), then review. Bottles can come back more than once.' : 'Every move, with who and when. Undo needs a reason.';
  return (
    <div className="page bc">
      <Link to="/" className="back-link">‹ Back</Link>
      <small className="gt-kick">{d.event.title.toUpperCase()} · BAR COUNT</small>
      <h1 className="serif" style={{ margin: '4px 0 8px' }}>Bar count</h1>
      {c?.handed_to_name && <div className="bc-note">🍸 Handed to <b>{c.handed_to_name}</b>{c.handed_by_name ? ` by ${c.handed_by_name.split(' ')[0]}` : ''} · <button className="lnk" onClick={() => handTo(null)}>take it back</button></div>}
      {c?.submitted_at && <div className="bc-note ok">✓ Submitted {tm(c.submitted_at)}{c.submitted_by_name ? ` by ${c.submitted_by_name.split(' ')[0]}` : ''}. Changes after this are logged.</div>}
      <div className="bc-tabs four" role="tablist">
        {([['start', started ? 'Start ✓' : 'Start'], ['more', '+ More out'], ['back', 'Bring back'], ['log', `Log · ${d.moves.length}`]] as [Mode, string][]).map(([k, l]) =>
          <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} disabled={(k === 'more' || k === 'back') && !started} onClick={() => switchMode(k)}>{l}</button>)}
      </div>
      <p className="muted sm" style={{ margin: '6px 0' }}>{hint}</p>
      {!started && mode !== 'log' && cat && cat.list.length > 0 && (!d.picked || picking) ? (
        <TonightsBottles eventId={eventId!} list={cat.list} onAddNew={() => setItemEd({ id: null, kind: 'spirit', name: '', size: '750 ml' })}
          onCancel={d.picked ? () => setPicking(false) : undefined} onDone={() => { setPicking(false); load(true); setCt((x) => x + 1); }} />
      ) : <>
      {mode !== 'log' && !(mode === 'start' && started) && cat && cat.list.length > 0 && <BarSearchAdd eventId={eventId!} list={cat.list} have={new Set(cat.list.filter((x) => x.on).map((x) => x.id))}
        onAdded={() => { load(true); setCt((x) => x + 1); }} onAddNew={(name) => setItemEd({ id: null, kind: 'spirit', name, size: '750 ml' })} />}
      {!started && d.picked && mode === 'start' && <button className="lnk" style={{ alignSelf: 'flex-start' }} onClick={() => setPicking(true)}>Change tonight’s bottles</button>}
      {mode === 'start' && started ? <div className="bc-note ok">✓ Start count confirmed {tm(started.at)} by {started.by?.split(' ')[0]}. Use + More out for anything else.</div> : mode !== 'log' && <>
        {!bottles.length && <p className="muted">No list for this venue yet. Add the bottles below: they stay on the list for next time.</p>}
        {groups.map((g) => (
          <section key={g.k} className="bc-group"><small className="gt-kick">{KIND_LABEL[g.k]?.toUpperCase()}</small>
            {g.ls.map((i) => { const t = tot[i.id]; const dv = draft[i.id] ?? 0; return (
              <div key={i.id} className="bc-row">
                <span className="grow"><b>{i.name}</b><small>{[i.size, t ? `out ${q(t.out)}` : null, t?.back ? `back ${q(t.back)}` : null, t ? `used ${q(usedOf(t))}` : null].filter(Boolean).join(' · ')} · <button className="lnk" onClick={() => setItemEd({ id: i.id, kind: i.kind, name: i.name, size: i.size ?? '' })}>✎</button></small></span>
                <button className="bc-st" aria-label="less" onClick={() => bump(i, -1)}>−</button><b className={'bc-v' + (dv ? ' hl' : '')}>{dv ? (mode === 'more' ? '+' : '') + q(dv) : '0'}</b><button className="bc-st dark" aria-label="more" disabled={mode === 'back' && room(i.id) <= dv} onClick={() => bump(i, 1)}>+</button>
              </div>); })}
          </section>))}
        <button className="lnk" onClick={() => setItemEd({ id: null, kind: 'spirit', name: '', size: '750 ml' })}>+ Add a bottle (or the same bottle in another size)</button>
        {mode === 'back' && sup.length > 0 && <section className="bc-group"><small className="gt-kick">SUPPLIES · LEVEL AT THE END</small>
          {sup.map((s) => <div key={s.item_id} className="bc-row"><b className="grow">{s.name}</b><span className="bc-lv">{LEVELS.map((lv) => <button key={lv} className={(s.level === lv ? 'on' : '') + (lv === 'Out' ? ' out' : '')} onClick={() => setSup(sup.map((x) => (x.item_id === s.item_id ? { ...x, level: lv } : x)))}>{lv}</button>)}</span></div>)}
        </section>}
        <button className="big-btn dark" disabled={!pending.length} onClick={() => setReview(true)}>{mode === 'start' ? 'Review the start count' : mode === 'more' ? `Review · taking out ${pending.length}` : `Review · coming back ${pending.length}`}</button>
        {mode === 'back' && <button className="big-btn" disabled={busy} onClick={submit}>{c?.submitted_at ? 'Save supplies' : 'Submit the count'}</button>}
      </>}
      </>}
      {mode === 'log' && <section className="bc-group">
        {!d.moves.length && <p className="muted sm">Nothing yet.</p>}
        {d.moves.map((m) => <div key={m.id} className={'bc-log' + (m.undone_at ? ' undone' : '')}><b>{tm(m.at)}</b><span className="grow"><b>{m.by?.split(' ')[0] ?? '—'}</b> {moveText(m, d.items)}{m.undone_at && <em> · undone by {m.undone_by?.split(' ')[0]} (“{m.undo_reason}”)</em>}</span>
          {!m.undone_at && m.step !== 'item' && <button className="lnk" onClick={() => setUndo({ id: m.id, reason: '' })}>Undo</button>}</div>)}
        {undo && <div className="bc-add"><input autoFocus value={undo.reason} onChange={(e) => setUndo({ ...undo, reason: e.target.value })} placeholder="Why? e.g. pressed twice" /><button className="abtn sm dark" disabled={busy || !undo.reason.trim()} onClick={doUndo}>Undo it</button><button className="abtn sm" onClick={() => setUndo(null)}>Cancel</button></div>}
      </section>}
      <div className="bc-foot">
        {hand ? <div className="bc-hand"><b>Hand the count to someone on tonight’s team</b>{d.team.map((t) => <button key={t.id} className="abtn sm" disabled={busy} onClick={() => handTo(t.id)}>{t.name}{t.role ? ` · ${t.role}` : ''}</button>)}<button className="lnk" onClick={() => setHand(false)}>Cancel</button></div>
          : <button className="big-btn" onClick={() => setHand(true)}>Hand the count to someone…</button>}
      </div>
      {msg && <p className="okc sm">{msg}</p>}{err && <p className="error">{err}</p>}
      <p className="muted sm">Only the people doing the count and Ronnie see it.</p>

      {review && <><div className="scrim" onClick={() => setReview(false)} />
        <div className="sheet swipe" role="dialog" aria-label="Review">
          <button className="sheet-x" aria-label="Close" onClick={() => setReview(false)}>✕</button>
          <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{mode === 'start' ? 'Check the start count' : mode === 'more' ? 'You’re taking out' : 'Coming back · check it'}</div>
          {pending.map(([id, v]) => { const i = d.items.find((x) => x.id === id)!; return <div key={id} className="bc-rev"><span>{nmOf(i)}</span><b>{mode === 'more' ? '+' : ''}{q(v)}</b></div>; })}
          {mode === 'back' && <p className="muted sm">Used so far after this: {pending.map(([id, v]) => { const i = d.items.find((x) => x.id === id)!; return `${i.name} ${q(Math.max(0, room(id) - v))}`; }).join(' · ')}</p>}
          {mode === 'more' && pending.some(([id, v]) => { const i = d.items.find((x) => x.id === id)!; return i.kind === 'spirit' ? v >= 4 : v >= 24; }) && <div className="br-flag amber">⚠ That’s a lot at once. Check it’s not a double tap.</div>}
          <p className="muted sm">Saved with your name and the time. It can be undone later (with a reason).</p>
          <div className="bc-2"><button className="big-btn" onClick={() => setReview(false)}>Fix it</button><button className="big-btn dark" disabled={busy} onClick={confirm}>{busy ? '…' : '✓ Confirm'}</button></div>
        </div></>}
      {itemEd && <><div className="scrim" onClick={() => setItemEd(null)} />
        <div className="sheet swipe" role="dialog" aria-label="Bottle">
          <button className="sheet-x" aria-label="Close" onClick={() => setItemEd(null)}>✕</button>
          <div className="serif" style={{ fontSize: 24, paddingRight: 44 }}>{itemEd.id ? `Edit · ${itemEd.name}` : 'Add a bottle'}</div>
          {/* push 84 (board BarCountAddV1) · type first as pills, sizes follow the type, Other… opens the size box */}
          <div className="gt-f"><span>WHAT IS IT</span><div className="bc-pills">{KINDS.map((k) => <button key={k} type="button" className={itemEd.kind === k ? 'on' : ''}
            onClick={() => { const ls = sizesFor(k, d.sizes); setItemEd({ ...itemEd, kind: k, size: ls.includes(itemEd.size) ? itemEd.size : ls[0] ?? '', other: !ls.length }); }}>{KIND_SHORT[k]}</button>)}</div>
            <small className="muted">{KIND_HOW[itemEd.kind]}</small></div>
          <label className="gt-f"><span>NAME</span><input value={itemEd.name} onChange={(e) => setItemEd({ ...itemEd, name: e.target.value })} placeholder="e.g. Grey Goose" /></label>
          {!itemEd.id && cat && itemEd.name.trim().length >= 2 && (() => { const hs = catMatch(cat.list, itemEd.name).filter((x) => x.name !== itemEd.name || x.size !== itemEd.size).slice(0, 4); return hs.length > 0 && (
            <div className="bp-names">{hs.map((x) => <div key={x.id} className="bp-s"><span className="grow"><b>{x.name}</b> <small>{x.size}</small></span>
              <button className="lnk" onClick={() => setItemEd({ ...itemEd, kind: x.kind as BKind, name: x.name, size: x.size ?? '', other: false })}>Use</button></div>)}</div>); })()}
          {(() => { const ls = sizesFor(itemEd.kind, d.sizes); const other = itemEd.other || (!!itemEd.size && !ls.includes(itemEd.size)); return (
            <div className="gt-f"><span>SIZE</span><div className="bc-pills">{ls.map((x) => <button key={x} type="button" className={!other && itemEd.size === x ? 'on' : ''} onClick={() => setItemEd({ ...itemEd, size: x, other: false })}>{x}</button>)}
              <button type="button" className={other ? 'on' : ''} onClick={() => setItemEd({ ...itemEd, other: true, size: ls.includes(itemEd.size) ? '' : itemEd.size })}>Other…</button></div>
              {other && <input autoFocus value={itemEd.size} onChange={(e) => setItemEd({ ...itemEd, size: e.target.value })} placeholder="e.g. 375 ml" />}</div>); })()}
          <p className="muted sm">Also on the list next time. Ronnie sees it in the log.</p>
          <button className="btn-ink" disabled={busy || !itemEd.name.trim()} onClick={saveItem}>{busy ? '…' : itemEd.id ? 'Save' : `Add ${itemEd.name.trim() || 'the bottle'}${itemEd.size.trim() ? ' · ' + itemEd.size.trim() : ''}`}</button>
          {itemEd.id && <button className="lnk" onClick={() => setItemEd({ ...itemEd, id: null, size: '' })}>+ Same bottle, another size</button>}
        </div></>}
    </div>
  );
}
