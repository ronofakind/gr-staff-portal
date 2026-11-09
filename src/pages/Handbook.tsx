import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Staff } from '../lib/supabase';
import { CARDS, CHAPTERS, CONTACTS, cardsFor, chapterTitle, loadOnboarding, saveHandbook, md, type Onboarding, type HbCard } from '../lib/handbook';
import { LineIcon, CHAPTER_ICON } from '../components/LineIcon';
import { HbVisual } from '../components/HbVisual';
import { addToContacts } from '../lib/vcard';

/** Nov 9 · push 58 · the G&R Standard (OnbPremiumV1): ink cover with a thin gold frame → chapters, one idea per page → sign → welcome.
 *  New hires: needed before they get dates, saved per page, "Later" any time. Everyone else can read it from Profile (no saving). */
const Txt = ({ s }: { s: string }) => <>{md(s).map((p, j) => ('b' in p ? <b key={j}>{p.b}</b> : <span key={j}>{p.t}</span>))}</>;
let swipeX = 0; // swipe left = next, right = back
const today = () => new Date().toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' });

export function Handbook({ me }: { me: Staff }) {
  const nav = useNavigate();
  const [ob, setOb] = useState<Onboarding | null | undefined>(undefined);
  const [view, setView] = useState<'cover' | 'page' | 'chapter' | 'done'>('cover');
  const [i, setI] = useState(0); const [seen, setSeen] = useState<string[]>([]);
  const [tick, setTick] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [sheet, setSheet] = useState<(typeof CONTACTS)[number] | null>(null);
  useEffect(() => { loadOnboarding().then((o) => {
    setOb(o);
    if (o) { setSeen(o.hb_seen); const first = cardsFor(o).findIndex((c) => !o.hb_seen.includes(c.id)); setI(o.hb_done_at || first < 0 ? 0 : first); }
  }); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [view, i]);
  if (ob === undefined) return <div className="loading" />;

  const roles = ob?.handbook_roles ?? ['floor'];
  const list: HbCard[] = ob ? cardsFor(ob) : CARDS.filter((c) => c.role === 'all' || c.role === 'floor');
  const chapters = CHAPTERS.filter((ch) => list.some((c) => c.ch === ch.k));
  const c = list[i]; const last = i === list.length - 1;
  const ch = CHAPTERS.find((x) => x.k === c.ch) ?? CHAPTERS[0];
  const signed = !!ob?.hb_done_at;
  const mustDone = !!ob?.hb_mandatory_at;
  const needTick = !!ob && ((!!c.mandatory && !mustDone) || (!!c.agree && !signed));
  const left = Math.max(1, Math.round((list.length - seen.filter((x) => list.some((c2) => c2.id === x)).length) * 0.35));
  const later = () => nav('/');

  const next = async () => {
    if (needTick && !tick) return;
    setErr('');
    if (ob) {
      setBusy(true);
      const { error } = await saveHandbook([c.id], list.length, !!c.mandatory && tick, !!c.agree && tick);
      setBusy(false);
      if (error) { setErr('Couldn’t save. Check your connection and try again.'); return; }
      setSeen((s) => [...new Set([...s, c.id])]);
      if (c.mandatory && tick) setOb({ ...ob, hb_mandatory_at: new Date().toISOString() });
      if (c.agree && tick) { setOb({ ...ob, hb_done_at: new Date().toISOString() }); setView('done'); return; }
    }
    setTick(false);
    if (last) { if (!ob || signed) nav('/'); return; }
    setI(i + 1);
    if (list[i + 1]?.ch !== c.ch) setView('chapter'); // push 59 · a moment after each chapter
  };

  if (view === 'done') {
    const tax = ob?.paid_by === 'payroll' && !ob.tax_done_at;
    return (
      <main className="v2 hb2 dark">
        <div className="hb2-frame" aria-hidden="true" />
        <div className="hb2-center">
          <div className="hb2-seal"><img src="/logo-white.png" alt="G&R" /></div>
          <h1 className="hb2-h1">Welcome to<br />the team, {me.full_name.split(' ')[0]}.</h1>
          <p className="hb2-p">Event requests now arrive on your Home.<br />The first yes often gets the spot.</p>
          {tax && <div className="hb2-next"><LineIcon name="lock" size={20} color="#D9B76A" /><span><b>One more step</b><br /><small>Tax and pay, before your first shift</small></span></div>}
        </div>
        <div className="hb2-foot">
          {tax && <button className="hb2-btn cream" onClick={() => nav('/tax')}>Tax and pay · 4 min</button>}
          <button className={tax ? 'hb2-link' : 'hb2-btn cream'} onClick={() => nav('/')}>Go to Home</button>
        </div>
      </main>
    );
  }

  if (view === 'cover') {
    const firstOpen = chapters.find((x) => list.some((c2) => c2.ch === x.k && !seen.includes(c2.id)));
    const started = !!ob && seen.length > 0 && !signed;
    return (
      <main className="v2 hb2 dark">
        <div className="hb2-frame" aria-hidden="true" />
        <div className="hb2-top"><button onClick={later}>{ob && !signed ? 'Later' : 'Close'}</button>{ob && !signed && <span>{left} min left</span>}</div>
        <div className="hb2-center">
          <img src="/logo-white.png" alt="G&R" className="hb2-logo" />
          <span className="hb2-rule" />
          <h1 className="hb2-h1 big">The G&amp;R<br />Standard</h1>
          <span className="hb2-it">Welcome, {me.full_name.split(' ')[0]}.</span>
          <p className="hb2-p">How we work, what guests expect,<br />and what you can expect from us.</p>
        </div>
        <div className="hb2-foot">
          <div className="hb2-toc">{chapters.map((x) => {
            const cs = list.filter((c2) => c2.ch === x.k); const n = cs.filter((c2) => seen.includes(c2.id)).length;
            return <button key={x.k} className={n === cs.length || (firstOpen?.k === x.k) || !ob ? 'on' : ''} onClick={() => { setI(list.findIndex((c2) => c2.ch === x.k)); setView('page'); }}>
              <span>{chapterTitle(x.k, roles)}</span><small>{!ob ? '' : n === cs.length ? '✓' : n ? `${n} / ${cs.length}` : ''}</small></button>;
          })}</div>
          <button className="hb2-btn cream" onClick={() => setView('page')}>{signed || !ob ? 'Read' : started ? 'Continue reading' : 'Begin'}</button>
        </div>
      </main>
    );
  }

  if (view === 'chapter') {
    const prev = list[i - 1]; const pch = CHAPTERS.find((x) => x.k === prev?.ch) ?? CHAPTERS[0];
    const doneN = chapters.findIndex((x) => x.k === pch.k) + 1;
    return (
      <main className="v2 hb2 dark">
        <div className="hb2-frame" aria-hidden="true" />
        <div className="hb2-center">
          <span className="hb2-chip-ic"><LineIcon name={CHAPTER_ICON[pch.k]} size={28} color="#D9B76A" /></span>
          <h1 className="hb2-h1">{chapterTitle(pch.k, roles)},<br />done.</h1>
          <div className="hb2-dots">{chapters.map((x, k) => <i key={x.k} className={k < doneN ? 'on' : ''} />)}</div>
          <p className="hb2-p">{doneN} of {chapters.length} chapters done{ob ? ` · about ${left} min left` : ''}</p>
        </div>
        <div className="hb2-foot">
          <button className="hb2-btn cream" onClick={() => setView('page')}>Next chapter · {chapterTitle(ch.k, roles)}</button>
          <button className="hb2-link" onClick={later}>Take a break · it’s saved</button>
        </div>
      </main>
    );
  }

  // story bar = pages of this chapter
  const chList = list.filter((x) => x.ch === c.ch); const chIdx = chList.indexOf(c);
  const vis = c.kind ? null : HbVisual({ id: c.id, me });
  return (
    <main className="v2 hb2" onTouchStart={(e) => { swipeX = e.touches[0].clientX; }}
      onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - swipeX; if (dx < -60 && !(needTick && !tick) && !busy) next(); else if (dx > 60 && i > 0) { setI(i - 1); setTick(false); } }}>
      <div className="hb2-head">
        <div className="hb2-bar-row"><button onClick={() => setView('cover')}>✕ {ob && !signed ? 'Later' : 'Close'}</button><b>{chapterTitle(ch.k, roles).toUpperCase()}</b><span>{i + 1}/{list.length}</span></div>
        <div className="hb2-story">{chList.map((x, k) => <i key={x.id} className={k <= chIdx ? 'on' : ''} />)}</div>
      </div>
      <div className="hb2-body">
        {c.kind === 'must' ? <span className="hb2-req">Required before your first event</span>
          : vis ? null : <span className="hb2-ic"><LineIcon name={c.agree ? 'pen' : c.kind === 'contacts' ? 'phone' : CHAPTER_ICON[c.ch ?? 'house']} size={20} /></span>}
        <h1 className="hb2-t">{c.title}</h1>

        {c.kind === 'must' && <div className="hb2-tiles">{[['plates', 'Carry three plates'], ['wine', 'Open and pour wine'], ['tray', 'Hold a tray']].map(([k, t]) => <div key={k}><LineIcon name={k} size={28} color="#D9B76A" w={1.3} /><span>{t}</span></div>)}</div>}

        {c.kind === 'paydates' && <div className="hb2-dates">
          <div><b>16<sup>th</sup></b><span>for days worked<br />1st to 15th</span></div>
          <div><b>1<sup>st</sup></b><span>for days worked<br />16th to month end</span></div>
        </div>}

        {c.kind === 'contacts' ? <>
          <p className="hb2-line">{c.lines[0]}</p>
          {CONTACTS.map((p) => (
            <button key={p.id} className="hb2-person" onClick={() => setSheet(p)}>
              <img src={p.photo} alt="" />
              <span className="grow"><b>{p.first} {p.last}</b>{p.roles.map((r) => <small key={r}>• {r}</small>)}<em>{p.phone}</em></span>
              <span className="hb2-chev">›</span>
            </button>))}
          <button className="hb2-btn line" onClick={() => addToContacts('all')}>＋ Add both to my contacts</button>
          <p className="hb2-small">On event nights, call your manager first. Their number is on your event page.</p>
        </> : c.agree ? <>
          {c.lines.map((l, k) => <p key={k} className="hb2-line"><Txt s={l} /></p>)}
          {ob && <button className={'hb2-sign' + (tick || signed ? ' on' : '')} disabled={signed} onClick={() => setTick(!tick)}>
            <span className="hb2-sig">{tick || signed ? me.full_name : ''}</span>
            <span className="hb2-sigline" />
            <span className="hb2-sigmeta"><span>{signed ? 'Signed' : tick ? 'Tap again to undo' : 'Tap to sign'}</span><span>{today()}</span></span>
          </button>}
        </> : <>
          {vis ?? c.lines.map((l, k) => <p key={k} className={'hb2-line' + (c.kind ? ' sm' : '')}><Txt s={l} /></p>)}
          {c.quote && <div className="hb2-quote"><small>{c.quote.lead}</small><span>{c.quote.text}</span></div>}
          {c.kind === 'paydates' && <div className="hb2-payee"><small>ON YOUR BANK STATEMENT</small><b>9304-0160 Quebec Inc</b><span>That’s us: G&amp;R à votre service</span></div>}
        </>}

        {c.mandatory && ob && (mustDone
          ? <div className="hb2-tick on static"><span>✓</span>{c.mandatory}</div>
          : <button type="button" role="checkbox" aria-checked={tick} className={'hb2-tick' + (tick ? ' on' : '')} onClick={() => setTick(!tick)}><span>{tick ? '✓' : ''}</span>{c.mandatory}</button>)}
      </div>
      <div className="hb2-foot light">
        {err && <p className="error" style={{ textAlign: 'center' }}>{err}</p>}
        <div className="row" style={{ gap: 10 }}>
          {i > 0 && <button className="hb2-prev" aria-label="Previous page" onClick={() => { setI(i - 1); setTick(false); }}>‹</button>}
          <button className={'hb2-btn' + (c.agree && ob && !signed ? ' gold' : '')} disabled={busy || (!!needTick && !tick)} onClick={next}>
            {c.agree && ob && !signed ? (tick ? 'Sign and finish' : 'Tap the line to sign') : needTick && !tick ? 'Tick the box to continue' : last ? 'Done' : 'Next'}</button>
        </div>
      </div>
      {sheet && <div className="hb2-sheet-wrap" onClick={() => setSheet(null)}>
        <div className="hb2-sheet" onClick={(e) => e.stopPropagation()}>
          <span className="hb2-grab" />
          <img src={sheet.photo} alt="" className="hb2-bigphoto" />
          <h2 className="hb2-t sm">{sheet.first} {sheet.last}</h2>
          <div className="hb2-roles">{sheet.roles.map((r) => <span key={r}>• {r}</span>)}</div>
          <b className="hb2-num">{sheet.phone}</b>
          <button className="hb2-btn" onClick={() => addToContacts(sheet.id as 'ronnie' | 'georges')}>＋ Add to contacts</button>
          <p className="hb2-small" style={{ textAlign: 'center' }}>Saves {sheet.nick || sheet.first} in your phone with their photo, number and “G&amp;R à votre service”.</p>
          <button className="hb2-link dark" onClick={() => setSheet(null)}>Close</button>
        </div>
      </div>}
    </main>
  );
}
