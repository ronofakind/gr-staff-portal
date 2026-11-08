import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { allStaff, type AStaff } from './api';
import { Link } from 'react-router-dom';
import { loadScoreData, scoreOf, signed, fbWhy, weights, type Score, type ScoreData } from './score';

type Tab = 'floor' | 'bar' | 'md';
const isMd = (s: AStaff) => s.positions.some((p) => p.toUpperCase() === 'MD');
export const tabOf = (s: AStaff): Tab => (s.department === 'bar' ? 'bar' : isMd(s) ? 'md' : 'floor');
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
  const W = weights();

  return (
    <div className="stack-lg">
      <div className="toolbar">
        <div><div className="kick">RANKING</div><h1 className="serif-h">Score · {tab === 'floor' ? 'Floor' : tab === 'bar' ? 'Bar' : 'MD'}</h1></div>
        <div className="seg3">{(['floor', 'bar', 'md'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'md' ? 'MD' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
      </div>
      <div className="rk-wrap">
        <div className="adm-card rk-card">
          <div className="rk-row rk-head"><span>#</span><span>NAME</span><span>TIER</span><span>EXP.</span><span>RELIAB.</span><span>MGR FB</span><span>YES · SAVES</span><span>TIME</span><span>FORM</span></div>
          {!staff && <div className="muted" style={{ padding: 14 }}>Loading…</div>}
          {staff && !rows.length && <div className="muted" style={{ padding: 14 }}>Nobody here.</div>}
          {rows.map(({ s, sc }, i) => (
            <button key={s.id} className={'rk-row' + (sel === s.id ? ' on' : '')} onClick={() => setSel(sel === s.id ? null : s.id)}>
              <span className="muted">{i + 1}</span>
              <span className="rk-name"><b>{s.full_name}</b>{sc.isNew && <i className="new-tag">NEW</i>}{sc.suggest && !readKeep(keepKey(s.id, sc)) && <i className="rk-sug" title={sc.suggest.why}>→ {sc.suggest.to}?</i>}</span>
              <span>{s.staff_private?.tier ? <><i className={'tier-dot ' + s.staff_private.tier}>{s.staff_private.tier}</i> <small className="muted">{sc.tier}</small></> : <i className="tier-q">?</i>}</span>
              {(() => { const P = (k: string) => sc.parts.find((x) => x.key === k)!; const v = (k: string) => { const x = P(k); return x.counted ? <b>{Math.round(x.pts)}</b> : <span className="muted">–</span>; };
                return <><span>{v('exp')}<small className="muted">/25</small></span><span>{v('rel')}<small className="muted">/25</small></span><span>{v('fb')}<small className="muted">/20</small></span><span>{v('yes')} · {v('save')}</span><span>{v('time')}<small className="muted">/5</small></span></>; })()}
              <span className="rk-total">{sc.form}</span>
            </button>
          ))}
          <div className="muted sm" style={{ padding: '10px 4px 2px' }}>Tier first (yours), then the form score out of 100 inside each tier. Parts with no data yet (–) are left out and the rest is scaled to 100. Bookings, Auto-fill and Ask more sort the same way.</div>
        </div>
        <div className="rk-side">
          {cur && data && <div className="adm-card"><ScoreWhy s={cur.s} sc={cur.sc} onClose={() => setSel(null)} onTier={load} /></div>}
          <div className="adm-card rk-how">
            <div className="kick">HOW THE FORM SCORE IS MADE · RANKING V3</div>
            <div className="spread"><span>Order</span><b>tier A → B → C (set by you), then form score</b></div>
            <div className="spread"><span>Experience level · 25</span><b>Senior 25 · Mid 15 · Junior 5 (set at hire)</b></div>
            <div className="spread"><span>Reliability · 25</span><b>starts from the Staff Hub (very 25 · usually 19 · needs confirmation 13 · risk 8) · cancel 7+ days free · 2–7 days −3 · under 48 h −6 · no-show −12 · late −2 · last 90 days</b></div>
            <div className="spread"><span>Manager feedback · 20</span><b>last 10 ratings, newer count more</b></div>
            <div className="spread"><span>Says yes · 15</span><b>yes ÷ answered date asks (counts from 3 answers)</b></div>
            <div className="spread"><span>Saves the day · 10</span><b>+5 per last-minute yes (under 48 h) they worked</b></div>
            <div className="spread"><span>Time with G&amp;R · 5</span><b>1 point per 10 shifts (payroll this year + the app)</b></div>
            <div className="spread"><span>Priority until a date</span><b>+10</b></div>
            <div className="muted sm">Tiers never change on their own; the app only suggests (form 85+ over 10 shifts → up, under 50 → down, plus managers’ tier votes).</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Why this score" breakdown + tier suggestion (Move = admin action with confirm). Used on Ranking and the staff profile. */
export function ScoreWhy({ s, sc, onClose, onTier, compact = false, bars = false }: { s: AStaff; sc: Score; onClose?: () => void; onTier?: () => void; compact?: boolean; bars?: boolean }) {
  const [kept, setKept] = useState(() => readKeep(keepKey(s.id, sc)));
  const kk = keepKey(s.id, sc);
  useEffect(() => setKept(readKeep(kk)), [kk]);
  const tier = s.staff_private?.tier ?? null; const W = weights();
  const move = async (to: 'A' | 'B' | 'C') => {
    if (!confirm(`Move ${s.full_name} from tier ${tier} to ${to}?`)) return;
    const { error } = await supabase.from('staff_private').update({ tier: to }).eq('staff_id', s.id);
    if (error) alert(error.message); else onTier?.();
  };
  const keep = () => { try { localStorage.setItem(keepKey(s.id, sc), '1'); } catch { /* private mode */ } setKept(true); };
  const relWhy = [sc.rel.no_show && `${sc.rel.no_show} no-show (${signed(W.reliability.no_show)})`, sc.rel.cancelled && `${sc.rel.cancelled} late cancel (${signed(W.reliability.late_cancel)})`, sc.rel.late && `${sc.rel.late} late (${signed(W.reliability.late)})`, sc.rel.late_change && `${sc.rel.late_change} late change (${signed(W.reliability.late_change)})`, sc.rel.free && `${sc.rel.free} not counted (cancel before confirming / told ahead / late while it's off in Settings)`].filter(Boolean).join(' · ') || 'nothing flagged';
  const Line = ({ t, sub, n, plain }: { t: string; sub: string; n: number; plain?: boolean }) => (
    <div className="rk-line"><div className="grow"><b>{t}</b><small>{sub}</small></div><b className={plain ? '' : n > 0 ? 'okc' : n < 0 ? 'accent' : 'muted'}>{plain ? n : signed(n)}</b></div>
  );
  return (
    <div className="stack" style={{ gap: 8 }}>
      {!compact && <div className="spread"><span className="kick">WHY THIS SCORE · {s.full_name.toUpperCase()}</span>{onClose && <button className="sq" aria-label="Close" onClick={onClose}>×</button>}</div>}
      {!bars && <div className="rk-big serif">{tier ? `${tier} · ` : ''}{sc.form}<small className="muted" style={{ fontSize: 14 }}> / 100</small></div>}
      {!bars && <Line t={tier ? `Tier ${tier}` : 'No tier'} sub="set by you · sorts first" n={0} plain />}
      {bars && sc.parts.map((x) => <div key={x.key} className="sp-bar"><div className="spread"><b>{x.label}</b><b className={x.counted ? '' : 'muted'}>{x.counted ? `${Math.round(x.pts * 10) / 10} / ${x.max}` : '–'}</b></div>
        <div className="sp-bar-t"><i style={{ width: `${x.counted && x.max ? Math.max(0, Math.min(100, (x.pts / x.max) * 100)) : 0}%` }} /></div><small className="muted">{x.sub}</small></div>)}
      {!bars && sc.parts.map((x) => <div key={x.key} className="rk-line"><div className="grow"><b>{x.label}</b><small>{x.sub}</small></div><b className={x.counted ? '' : 'muted'}>{x.counted ? `${Math.round(x.pts * 10) / 10} / ${x.max}` : '–'}</b></div>)}
      {sc.priority && <div className="rk-line"><div className="grow"><b>Priority</b><small>until {sc.priority}</small></div><b className="okc">+10</b></div>}
      {sc.suggest && tier && !kept && (
        <div className="rk-suggest"><b>Suggestion:</b> {sc.suggest.why}. Keep tier {tier}?{' '}
          <button className="lnk" onClick={() => move(sc.suggest!.to)}>Move to {sc.suggest.to}</button> · <button className="lnk" onClick={keep}>Keep {tier}</button></div>
      )}
    </div>
  );
}
