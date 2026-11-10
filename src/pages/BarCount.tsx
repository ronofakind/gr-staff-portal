import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { KINDS, KIND_LABEL, LEVELS, q, stepOf, used, type BKind, type BLine, type BSupply } from '../lib/barCount';

/* Push 69 · Bar count (board BarCountV2). Start out → + More out → Brought back; used = out − back.
   Only the bar manager / MD of the event (or the person it was handed to) and Ronnie. Editable after submitting. */
type Data = { event: { id: string; title: string; date: string; supplies: boolean }; items: { id: string; kind: BKind | 'supply'; name: string; size: string | null }[];
  count: { lines: BLine[]; supplies: BSupply[]; handed_to: string | null; handed_to_name: string | null; handed_by_name: string | null; out_at: string | null; more_at: string | null; submitted_at: string | null; submitted_by_name: string | null; edited_at: string | null } | null;
  team: { id: string; name: string; role: string | null }[] };
type Step = 'out' | 'more' | 'back';
const uid = () => Math.random().toString(36).slice(2, 10);
const tm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' }) : '');

export function BarCount() {
  const { eventId } = useParams();
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [lines, setLines] = useState<BLine[]>([]); const [sup, setSup] = useState<BSupply[]>([]);
  const [step, setStep] = useState<Step>('out'); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [add, setAdd] = useState<{ name: string; size: string; kind: BKind } | null>(null); const [hand, setHand] = useState(false); const [dirty, setDirty] = useState(false);
  const load = async () => {
    const { data, error } = await supabase.rpc('bar_count_get', { p_event: eventId });
    if (error) { setErr(error.message); setD(null); return; }
    const x = data as Data | null; setD(x); if (!x) return;
    const saved = x.count?.lines ?? [];
    const fromItems: BLine[] = x.items.filter((i) => i.kind !== 'supply').map((i) => ({ key: i.id, item_id: i.id, kind: i.kind as BKind, name: i.name, size: i.size, out: 0, more: 0, back: 0 }));
    const merged = [...fromItems.map((l) => saved.find((s) => s.item_id === l.item_id) ?? l), ...saved.filter((s) => !s.item_id || !fromItems.some((l) => l.item_id === s.item_id))];
    setLines(merged);
    const savedS = x.count?.supplies ?? [];
    setSup(x.event.supplies ? x.items.filter((i) => i.kind === 'supply').map((i) => savedS.find((s) => s.item_id === i.id) ?? { key: i.id, item_id: i.id, name: i.name, level: null }) : []);
    setStep(x.count?.submitted_at ? 'back' : x.count?.out_at ? 'more' : 'out'); setDirty(false);
  };
  useEffect(() => { load(); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => KINDS.map((k) => ({ k, ls: lines.filter((l) => l.kind === k) })).filter((g) => g.ls.length), [lines]);
  if (d === undefined) return <div className="page"><p className="muted">Loading…</p></div>;
  if (!d) return <div className="page"><p className="muted">Only the bar manager or MD of this bar event can do the bar count.</p>{err && <p className="error">{err}</p>}<Link to="/">‹ Home</Link></div>;
  const field: keyof BLine = step === 'out' ? 'out' : step === 'more' ? 'more' : 'back';
  const bump = (key: string, dir: 1 | -1) => { setDirty(true); setLines((ls) => ls.map((l) => { if (l.key !== key) return l; const st = stepOf(l.kind); const cur = Number(l[field]) || 0; let v = Math.max(0, Math.round((cur + dir * st) / st) * st);
    if (field === 'back') v = Math.min(v, (l.out || 0) + (l.more || 0)); return { ...l, [field]: v }; })); };
  const save = async (submit = false) => {
    setBusy(true); setErr(''); setMsg('');
    const { error } = await supabase.rpc('bar_count_save', { p_event: eventId, p_lines: lines, p_supplies: sup, p_step: d.count?.submitted_at ? 'edit' : step, p_submit: submit });
    setBusy(false); if (error) { setErr(error.message); return; }
    setMsg(submit ? '✓ Count submitted. You can still edit it.' : '✓ Saved'); load();
  };
  const handTo = async (sid: string | null) => { setBusy(true); const { error } = await supabase.rpc('bar_count_hand', { p_event: eventId, p_staff: sid }); setBusy(false); setHand(false); if (error) setErr(error.message); else load(); };
  const c = d.count;
  return (
    <div className="page bc">
      <Link to="/" className="back-link">‹ Back</Link>
      <small className="gt-kick">{d.event.title.toUpperCase()} · BAR COUNT</small>
      <h1 className="serif" style={{ margin: '4px 0 8px' }}>Bar count</h1>
      {c?.handed_to_name && <div className="bc-note">🍸 Handed to <b>{c.handed_to_name}</b>{c.handed_by_name ? ` by ${c.handed_by_name.split(' ')[0]}` : ''} · <button className="lnk" onClick={() => handTo(null)}>take it back</button></div>}
      {c?.submitted_at && <div className="bc-note ok">✓ Submitted {tm(c.submitted_at)}{c.submitted_by_name ? ` by ${c.submitted_by_name.split(' ')[0]}` : ''}{c.edited_at ? ` · edited ${tm(c.edited_at)}` : ''}. You can still edit it.</div>}
      <div className="bc-tabs" role="tablist">
        {([['out', 'Start · out'], ['more', '+ More out'], ['back', 'Brought back']] as [Step, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={step === k} className={step === k ? 'on' : ''} onClick={() => setStep(k)}>{l}{k === 'out' && c?.out_at ? ' ✓' : ''}</button>)}
      </div>
      <p className="muted sm" style={{ margin: '6px 0' }}>{step === 'out' ? 'What goes out to the bar at the start.' : step === 'more' ? 'Anything you take out during the night (adds to what went out).' : 'What comes back at the end. Open wine can’t go back: only full bottles. Spirits back in quarters.'} Used = out − back.</p>
      {!lines.length && <p className="muted">No list for this venue yet. Add the bottles below (Ronnie can set the list once for next time).</p>}
      {groups.map((g) => (
        <section key={g.k} className="bc-group"><small className="gt-kick">{KIND_LABEL[g.k]?.toUpperCase()}</small>
          {g.ls.map((l) => (
            <div key={l.key} className="bc-row">
              <span className="grow"><b>{l.name}</b><small>{[l.size, `out ${q((l.out || 0) + (l.more || 0))}`, step === 'back' ? `used ${q(used(l))}` : null].filter(Boolean).join(' · ')}</small></span>
              <button className="bc-st" aria-label="less" onClick={() => bump(l.key, -1)}>−</button><b className="bc-v">{q(Number(l[field]) || 0)}</b><button className="bc-st dark" aria-label="more" onClick={() => bump(l.key, 1)}>+</button>
            </div>))}
        </section>))}
      {add ? <div className="bc-add">
        <input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="Bottle name" />
        <input value={add.size} onChange={(e) => setAdd({ ...add, size: e.target.value })} placeholder="750 ml / 1.14 L / magnum" />
        <select value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value as BKind })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select>
        <button className="abtn sm dark" disabled={!add.name.trim()} onClick={() => { setLines([...lines, { key: 'x-' + uid(), item_id: null, kind: add.kind, name: add.name.trim(), size: add.size.trim() || null, out: 0, more: 0, back: 0 }]); setAdd(null); setDirty(true); }}>Add</button>
        <button className="abtn sm" onClick={() => setAdd(null)}>Cancel</button></div>
        : <button className="lnk" onClick={() => setAdd({ name: '', size: '750 ml', kind: 'spirit' })}>+ Add a bottle not on the list</button>}
      {sup.length > 0 && step === 'back' && <section className="bc-group"><small className="gt-kick">SUPPLIES</small>
        {sup.map((s) => <div key={s.key} className="bc-row"><b className="grow">{s.name}</b><span className="bc-lv">{LEVELS.map((lv) => <button key={lv} className={(s.level === lv ? 'on' : '') + (lv === 'Out' ? ' out' : '')} onClick={() => { setSup(sup.map((x) => (x.key === s.key ? { ...x, level: lv } : x))); setDirty(true); }}>{lv}</button>)}</span></div>)}
      </section>}
      <div className="bc-foot">
        {hand ? <div className="bc-hand"><b>Hand the count to someone on tonight’s team</b>{d.team.map((t) => <button key={t.id} className="abtn sm" disabled={busy} onClick={() => handTo(t.id)}>{t.name}{t.role ? ` · ${t.role}` : ''}</button>)}<button className="lnk" onClick={() => setHand(false)}>Cancel</button></div>
          : <button className="big-btn" onClick={() => setHand(true)}>Hand the count to someone…</button>}
        <button className="big-btn" disabled={busy || !dirty} onClick={() => save(false)}>{busy ? '…' : 'Save'}</button>
        {step === 'back' && !c?.submitted_at && <button className="big-btn dark" disabled={busy} onClick={() => save(true)}>Submit the count</button>}
        {c?.submitted_at && <button className="big-btn dark" disabled={busy || !dirty} onClick={() => save(false)}>Save changes</button>}
      </div>
      {msg && <p className="okc sm">{msg}</p>}{err && <p className="error">{err}</p>}
      <p className="muted sm">Only you{c?.handed_to_name ? ', the person it was handed to' : ''} and Ronnie see this count.</p>
    </div>
  );
}
