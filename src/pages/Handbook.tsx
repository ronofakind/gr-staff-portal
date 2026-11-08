import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CARDS, ROLE_LABEL, cardsFor, loadOnboarding, saveHandbook, md, type Onboarding, type HbCard } from '../lib/handbook';

/** Nov 8 · push 56 · /handbook · one card at a time, saved as they go, "✕ Later" any time.
 *  New hires: needed before they get dates. Everyone else can read it from Profile (all cards, no ticks saved). */
export function Handbook() {
  const nav = useNavigate();
  const [ob, setOb] = useState<Onboarding | null | undefined>(undefined);
  const [i, setI] = useState(0); const [seen, setSeen] = useState<string[]>([]);
  const [tick, setTick] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [done, setDone] = useState(false);
  useEffect(() => { loadOnboarding().then((o) => {
    setOb(o);
    if (o) { setSeen(o.hb_seen); const list = cardsFor(o); const first = list.findIndex((c) => !o.hb_seen.includes(c.id)); setI(o.hb_done_at || first < 0 ? 0 : first); }
  }); }, []);
  if (ob === undefined) return <div className="loading" />;
  const list: HbCard[] = ob ? cardsFor(ob) : CARDS.filter((c) => c.role !== 'pay');
  const c = list[i]; const last = i === list.length - 1;
  const already = (c.mandatory && !!ob?.hb_mandatory_at) || (c.agree && !!ob?.hb_done_at);
  const needTick = !!(c.mandatory || c.agree) && !already && !!ob;

  const next = async () => {
    if (needTick && !tick) return;
    setErr('');
    if (ob) {
      const s = [...new Set([...seen, c.id])]; setSeen(s);
      setBusy(true);
      const { error } = await saveHandbook([c.id], list.length, !!c.mandatory && tick, !!c.agree && tick);
      setBusy(false);
      if (error) { setErr('Couldn’t save. Check your connection and try again.'); return; }
      if (c.mandatory && tick) setOb({ ...ob, hb_mandatory_at: new Date().toISOString() });
      if (c.agree && tick) { setOb({ ...ob, hb_done_at: new Date().toISOString() }); setDone(true); window.scrollTo(0, 0); return; }
    }
    setTick(false);
    if (last) { if (!ob || ob.hb_done_at) nav('/'); return; }
    setI(i + 1); window.scrollTo(0, 0);
  };

  if (done) return (
    <main className="v2 cu cu-done">
      <div className="cu-done-c">
        <img src="/logo-mark.png" alt="G&R" className="ap-mark big" />
        <span className="cu-check">✓</span>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.1 }}>You’re all set 🎉</div>
        <p className="cu-note" style={{ textAlign: 'center' }}>Event requests now show up on Home. Answer Yes · Maybe · No — the first yes often gets the spot.
          {ob?.paid_by === 'payroll' && !ob.tax_done_at ? <><br /><br /><b>One more thing:</b> Tax & pay, before your first shift.</> : null}</p>
      </div>
      <div className="cu-foot">{ob?.paid_by === 'payroll' && !ob.tax_done_at && <button className="cu-btn" onClick={() => nav('/tax')}>Tax & pay · 4 min</button>}
        <button className={'cu-btn' + (ob?.paid_by === 'payroll' && !ob.tax_done_at ? ' line' : ' green')} onClick={() => nav('/')}>Go to Home</button></div>
    </main>
  );

  return (
    <main className="v2 cu hb">
      <div className="cu-head">
        <div className="spread" style={{ alignItems: 'center' }}>
          <button type="button" className="cu-back" onClick={() => nav('/')}>✕ {ob && !ob.hb_done_at ? 'Later' : 'Close'}</button>
          <span className="cu-kick">HANDBOOK · {i + 1} OF {list.length}</span>
          <span className="cu-req">{ob && !ob.hb_done_at ? 'saved' : ''}</span>
        </div>
        <div className="hb-bar">{list.map((x, k) => <span key={x.id} className={k <= i || seen.includes(x.id) ? 'on' : ''} />)}</div>
      </div>
      <div className="cu-body">
        <div className={'hb-card' + (c.mandatory ? ' must' : '')}>
          <div className="spread" style={{ alignItems: 'center' }}>
            {c.mandatory ? <span className="hb-must">MANDATORY</span> : <span />}
            <span className="hb-role">{ROLE_LABEL[c.role]}</span>
          </div>
          <div className="hb-ic" aria-hidden="true">{c.icon}</div>
          <div className="serif hb-t">{c.title}</div>
          <div className="hb-lines">{c.lines.map((l, k) => <p key={k}>{md(l).map((p, j) => ('b' in p ? <b key={j}>{p.b}</b> : <span key={j}>{p.t}</span>))}</p>)}</div>
          {(c.mandatory || c.agree) && ob && (
            already ? <div className="hb-tick on static"><span>✓</span>{c.mandatory ?? c.agree}</div>
              : <button type="button" role="checkbox" aria-checked={tick} className={'hb-tick' + (tick ? ' on' : '') + (c.mandatory ? ' red' : '')} onClick={() => setTick(!tick)}><span>{tick ? '✓' : ''}</span>{c.mandatory ?? c.agree}</button>
          )}
        </div>
      </div>
      <div className="cu-foot">
        {err && <p className="error" style={{ textAlign: 'center' }}>{err}</p>}
        <button className={'cu-btn' + (last ? ' green' : '')} disabled={busy || (needTick && !tick)} onClick={next}>
          {needTick && !tick ? 'Next · tick the box first' : last ? (ob && !ob.hb_done_at ? 'I agree · finish' : 'Done') : 'Next card'}</button>
        {i > 0 && <button className="cu-skip" onClick={() => { setI(i - 1); setTick(false); window.scrollTo(0, 0); }}><span>Previous card</span></button>}
      </div>
    </main>
  );
}
