import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { allStaff, type AStaff } from './api';
import { loadScoreData, scoreOf, signed, WEIGHTS, type Score, type ScoreData } from './score';

type Tab = 'floor' | 'bar' | 'md';
const isMd = (s: AStaff) => s.positions.some((p) => p.toUpperCase() === 'MD');
const tabOf = (s: AStaff): Tab => (s.department === 'bar' ? 'bar' : isMd(s) ? 'md' : 'floor');
const keepKey = (sid: string, sc: Score) => `gr-keep-${sid}-${sc.suggest?.to}-${sc.fb.n}-${sc.fb.votes.A}${sc.fb.votes.B}${sc.fb.votes.C}`;
const readKeep = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };

/** Admin → Ranking. One score per person, computed on load. Tap a row for the breakdown. */
export function Ranking() {
  const [staff, setStaff] = useState<AStaff[] | null>(null);
  const [data, setData] = useState<ScoreData | null>(null);
  const [tab, setTab] = useState<Tab>('floor');
  const [sel, setSel] = useState<string | null>(null);
  const load = () => Promise.all([allStaff(), loadScoreData()]).then(([s, d]) => { setStaff(s); setData(d); });
  useEffect(() => { load(); }, []);
  const rows = useMemo(() => !staff || !data ? [] : staff.filter((s) => s.active && tabOf(s) === tab).map((s) => ({ s, sc: scoreOf(s, data) }))
    .sort((a, b) => b.sc.total - a.sc.total || (a.s.staff_private?.ranking ?? 9999) - (b.s.staff_private?.ranking ?? 9999)), [staff, data, tab]);
  const cur = rows.find((r) => r.s.id === sel);
  const cls = (n: number) => (n > 0 ? 'okc' : n < 0 ? 'accent' : 'muted');

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="kick">RANKING</div><h1 className="serif-h">Score · {tab === 'floor' ? 'Floor' : tab === 'bar' ? 'Bar' : 'MD'}</h1></div>
        <div className="seg3">{(['floor', 'bar', 'md'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'md' ? 'MD' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      </div>
      <div className="rk-wrap">
        <div className="adm-card rk-card">
          <div className="rk-row rk-head"><span>#</span><span>NAME</span><span>TIER</span><span>RELIAB.</span><span>EXP.</span><span>MGR FB</span><span>EXTRAS</span><span>SCORE</span></div>
          {!staff && <div className="muted" style={{ padding: 14 }}>Loading…</div>}
          {staff && !rows.length && <div className="muted" style={{ padding: 14 }}>Nobody here.</div>}
          {rows.map(({ s, sc }, i) => (
            <button key={s.id} className={'rk-row' + (sel === s.id ? ' on' : '')} onClick={() => setSel(sel === s.id ? null : s.id)}>
              <span className="muted">{i + 1}</span>
              <span className="rk-name"><b>{s.full_name}</b>{sc.isNew && <i className="new-tag">NEW</i>}{sc.suggest && !readKeep(keepKey(s.id, sc)) && <i className="rk-sug" title={sc.suggest.why}>→ {sc.suggest.to}?</i>}</span>
              <span>{s.staff_private?.tier ? <><i className={'tier-dot ' + s.staff_private.tier}>{s.staff_private.tier}</i> <small className="muted">{sc.tier}</small></> : <i className="tier-q">?</i>}</span>
              <span className={cls(sc.reliability)}>{signed(sc.reliability)}</span>
              <span className={cls(sc.experience)}>{signed(sc.experience)}</span>
              <span className={cls(sc.feedback)}>{signed(sc.feedback)}</span>
              <span className={cls(sc.extras)}>{signed(sc.extras)}</span>
              <span className="rk-total">{sc.total}</span>
            </button>
          ))}
          <div className="muted sm" style={{ padding: '10px 4px 2px' }}>Computed from the app each time you open it. Bookings and Auto-fill sort by this score (rank breaks ties).</div>
        </div>
        <div className="rk-side">
          {cur && data && <div className="adm-card"><ScoreWhy s={cur.s} sc={cur.sc} onClose={() => setSel(null)} onTier={load} /></div>}
          <div className="adm-card rk-how">
            <div className="kick">HOW THE SCORE IS MADE</div>
            <div className="spread"><span>Tier</span><b>A {WEIGHTS.tier.A} · B {WEIGHTS.tier.B} · C {WEIGHTS.tier.C}</b></div>
            <div className="spread"><span>Reliability (app, {WEIGHTS.reliability.days} days)</span><b>starts {WEIGHTS.reliability.start} · no-show −3 · late cancel −2 · late −1 · min 0</b></div>
            <div className="spread"><span>Experience</span><b>Senior 3 · Mid 2 · Junior 1</b></div>
            <div className="spread"><span>Manager feedback (last {WEIGHTS.feedback.last})</span><b>vote A +1 · B 0 · C −2 · each ▲ +0.5 · ▼ −0.5 · −10 to +10</b></div>
            <div className="spread"><span>BMO fit</span><b>+{WEIGHTS.extras.bmo}</b></div>
            <div className="spread"><span>New (first {WEIGHTS.newUnder} shifts)</span><b>{signed(WEIGHTS.extras.newStaff)}</b></div>
            <div className="spread"><span>Priority until a date</span><b>+{WEIGHTS.extras.priority}</b></div>
            <div className="muted sm">Weights are fixed for now (ask Claude to change them). Tiers never change on their own; the app only suggests.</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Why this score" breakdown + tier suggestion (Move = admin action with confirm). Used on Ranking and the staff profile. */
export function ScoreWhy({ s, sc, onClose, onTier, compact = false }: { s: AStaff; sc: Score; onClose?: () => void; onTier?: () => void; compact?: boolean }) {
  const [kept, setKept] = useState(() => readKeep(keepKey(s.id, sc)));
  const kk = keepKey(s.id, sc);
  useEffect(() => setKept(readKeep(kk)), [kk]);
  const tier = s.staff_private?.tier ?? null;
  const move = async (to: 'A' | 'B' | 'C') => {
    if (!confirm(`Move ${s.full_name} from tier ${tier} to ${to}?`)) return;
    const { error } = await supabase.from('staff_private').update({ tier: to }).eq('staff_id', s.id);
    if (error) alert(error.message); else onTier?.();
  };
  const keep = () => { try { localStorage.setItem(keepKey(s.id, sc), '1'); } catch { /* private mode */ } setKept(true); };
  const relWhy = [sc.rel.no_show && `${sc.rel.no_show} no-show (−3)`, sc.rel.cancelled && `${sc.rel.cancelled} late cancel (−2)`, sc.rel.late && `${sc.rel.late} late (−1)`].filter(Boolean).join(' · ') || 'nothing flagged';
  const Line = ({ t, sub, n, plain }: { t: string; sub: string; n: number; plain?: boolean }) => (
    <div className="rk-line"><div className="grow"><b>{t}</b><small>{sub}</small></div><b className={plain ? '' : n > 0 ? 'okc' : n < 0 ? 'accent' : 'muted'}>{plain ? n : signed(n)}</b></div>
  );
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!compact && <div className="spread"><span className="kick">WHY THIS SCORE · {s.full_name.toUpperCase()}</span>{onClose && <button className="sq" aria-label="Close" onClick={onClose}>×</button>}</div>}
      <div className="rk-big serif">{sc.total}</div>
      <Line t={tier ? `Tier ${tier}` : 'No tier'} sub="set by you" n={sc.tier} plain />
      <Line t="Reliability" sub={`app · last ${WEIGHTS.reliability.days} days: ${relWhy}. Starts at ${WEIGHTS.reliability.start}.`} n={sc.reliability} />
      <Line t="Experience" sub={sc.exp ? sc.exp[0] + sc.exp.slice(1).toLowerCase() : 'not set'} n={sc.experience} />
      <Line t="Manager feedback" sub={sc.fb.n ? `last ${sc.fb.n}: votes A ${sc.fb.votes.A} · B ${sc.fb.votes.B} · C ${sc.fb.votes.C} · ▲${sc.fb.up} ●${sc.fb.ok} ▼${sc.fb.down}` : 'no feedback yet'} n={sc.feedback} />
      <Line t="Extras" sub={[sc.bmo && 'BMO fit +2', sc.isNew && `new · ${sc.done} finished shift${sc.done === 1 ? '' : 's'} −3`, sc.priority && `priority until ${sc.priority} +20`].filter(Boolean).join(' · ') || 'priority until / BMO / new staff'} n={sc.extras} />
      {sc.suggest && tier && !kept && (
        <div className="rk-suggest"><b>Suggestion:</b> {sc.suggest.why}. Keep tier {tier}?{' '}
          <button className="lnk" onClick={() => move(sc.suggest!.to)}>Move to {sc.suggest.to}</button> · <button className="lnk" onClick={keep}>Keep {tier}</button></div>
      )}
    </div>
  );
}
