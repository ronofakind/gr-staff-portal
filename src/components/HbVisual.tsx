import { useState, type ReactNode } from 'react';
import { LineIcon } from './LineIcon';
import { UniformIcon, PantsIcon, ShoesIcon, TieIcon, WineKeyIcon } from './Uniform';

/** Nov 9 · push 59 · the G&R Standard, every page with its own picture (board HandbookAllV1). Returns null when a page has no special visual
 *  (the page then shows its lines). Pictures are built from the app's own pieces: request card, uniform icons, line icons. */
const G = '#B8892B';
const Step = ({ n, t, s, last }: { n: number; t: string; s?: string; last?: boolean }) => (
  <div className="hv-step"><div className="hv-step-l"><span>{n}</span>{!last && <i />}</div><div className={'hv-step-r' + (last ? ' last' : '')}><b>{t}</b>{s && <small>{s}</small>}</div></div>);
const YN = ({ ok, children }: { ok: boolean; children: ReactNode }) => <div className={'hv-yn ' + (ok ? 'ok' : 'no')}><span>{ok ? '✓' : '✕'}</span><div>{children}</div></div>;
const Row = ({ ic, t, s, tag, tone }: { ic: string; t: string; s?: string; tag?: string; tone?: 'amber' | 'red' }) => (
  <div className="hv-row"><span className="hv-ring"><LineIcon name={ic} size={19} /></span><span className="grow"><b>{t}</b>{s && <small>{s}</small>}</span>{tag && <i className={'hv-tag ' + (tone ?? '')}>{tag}</i>}</div>);
const Card = ({ children, dark }: { children: ReactNode; dark?: boolean }) => <div className={'hv-card' + (dark ? ' dark' : '')}>{children}</div>;
const UTile = ({ icon, t, no }: { icon: ReactNode; t: string; no?: string }) => <div className="hv-ut">{icon}<span>{t}</span>{no && <i>✕ {no}</i>}</div>;
const Grid4 = ({ items, on }: { items: [string, string][]; on: number[] }) => (
  <div className="hv-grid4">{items.map(([ic, t], i) => <div key={t} className={on.includes(i) ? 'dark' : ''}><LineIcon name={ic} size={22} color={on.includes(i) ? '#D9B76A' : G} /><b>{t}</b></div>)}</div>);
const BUS: [string, string][] = [['ice', 'Ice & restock'], ['glass', 'Glassware'], ['tray', 'Clearing'], ['box', 'Setup & breakdown']];
const COCKTAILS = ['Margarita', 'Amaretto Sour', 'Cosmopolitan', 'Martini', 'Bloody Caesar', 'Aperol Spritz', 'Paloma', 'Gin & Tonic', 'Vodka Soda', 'Rum & Coke'];

function Clock() {
  const tick = (a: number) => { const r = (a * Math.PI) / 180; return <line key={a} x1={70 + 56 * Math.sin(r)} y1={70 - 56 * Math.cos(r)} x2={70 + 62 * Math.sin(r)} y2={70 - 62 * Math.cos(r)} stroke="#1A1714" strokeWidth="1.2" />; };
  return <svg width="132" height="132" viewBox="0 0 140 140" aria-hidden="true"><circle cx="70" cy="70" r="62" fill="#fff" stroke="#1A1714" strokeWidth="1.2" />{[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(tick)}
    <path d="M18 70 A52 52 0 0 1 70 18" fill="none" stroke={G} strokeWidth="7" strokeLinecap="round" /><line x1="70" y1="70" x2="70" y2="26" stroke="#1A1714" strokeWidth="2.2" strokeLinecap="round" /><line x1="70" y1="70" x2="44" y2="70" stroke="#1A1714" strokeWidth="3" strokeLinecap="round" /><circle cx="70" cy="70" r="3" fill="#1A1714" /></svg>;
}
function TryRequest() {
  const [a, setA] = useState<'yes' | 'maybe' | 'no' | null>(null); const [t, setT] = useState<string | null>(null);
  return (
    <div className="hv-req">
      <small className="hv-kick">CAN YOU WORK?</small><b className="hv-serif">Sat · Le Andover</b><span className="hv-muted">Wedding · from 4:00 PM</span>
      <div className="hv-yesno">{(['yes', 'maybe', 'no'] as const).map((x) => <button key={x} className={a === x ? 'on ' + x : ''} onClick={() => { setA(x); setT(null); }}>{x === 'yes' ? 'Yes' : x === 'maybe' ? 'Maybe' : 'No'}</button>)}</div>
      {a === 'yes' && <div className="hv-times"><span className="hv-muted">Free from</span>{['3:00', '4:00', '5:00', '6:00'].map((x) => <button key={x} className={t === x ? 'on' : ''} onClick={() => setT(x)}>{x}</button>)}</div>}
      {a === 'yes' && t && <span className="hv-done">✓ That’s it. Requests work exactly like this.</span>}
      {a === 'maybe' && <span className="hv-muted">Maybe = you’ll know soon. Answer when you can.</span>}
      {a === 'no' && <span className="hv-muted">No problem. You only work the events you want.</span>}
    </div>
  );
}

export function HbVisual({ id, me }: { id: string; me?: { full_name?: string } }) {
  void me;
  switch (id) {
    case 'welcome': return <>
      <p className="hb2-line">Event staffing for private, corporate and upscale events across Montreal. Every team member represents G&amp;R.</p>
      <p className="hb2-line sm">We work by four words:</p>
      <Grid4 items={[['guest', 'Professionalism'], ['key', 'Presentation'], ['cal', 'Punctuality'], ['wine', 'Attitude']]} on={[0, 3]} />
    </>;
    case 'work': return <div className="hv-flow">
      <Card><small className="hv-kick">A NEW DATE</small><b className="hv-serif">Le Andover · Saturday</b><span className="hv-muted">Wedding · 180 guests</span></Card><i>↓</i>
      <Card><small className="hv-kick">YOU CHOOSE</small><b className="hv-serif">Yes · Maybe · No</b><span className="hv-muted">Only the events you want</span></Card><i>↓</i>
      <Card dark><small className="hv-kick gold">BOOKED</small><b className="hv-serif">You’re on the team</b><span className="hv-muted">We count on you</span></Card>
    </div>;
    case 'requests': return <>
      <p className="hb2-line sm">Try it. This is what a request looks like:</p>
      <TryRequest />
      <p className="hb2-line sm"><b>Answer fast:</b> the first yes often gets the spot.</p>
    </>;
    case 'confirm': return <>
      <Card><small className="hv-kick">CONFIRMATION · 4 DAYS BEFORE</small><b className="hv-serif">Sat · Le Andover</b>
        <div className="hv-chips">{['Uniform', 'Address', 'Start time', 'Manager', 'Notes'].map((x) => <span key={x}>{x}</span>)}</div>
        <span className="hv-confirm">✓ Confirm</span></Card>
      <Step n={1} t="Read it all" s="Uniform, address, start time, on-site contact, notes." /><Step n={2} t="Confirm right away" s="One tap." /><Step n={3} t="Re-read it before you leave home" s="Things can change." last />
    </>;
    case 'arrive': return <>
      <div className="hv-clock"><Clock /><div><b className="hv-big gold">4:45</b><small>you’re there, changed</small><b className="hv-big">5:00</b><small>your shift starts</small></div></div>
      <p className="hb2-line">Arrive <b>15 minutes early</b>, changed and ready.</p>
      <div className="hv-late"><span>I’m running late</span><small>Tap it as early as you can.</small></div>
    </>;
    case 'checkin': return <>
      <Card><div className="hv-mgr"><span className="hv-av">MD</span><span className="grow"><b>Your manager</b><small>Named on your confirmation</small></span><i className="hv-tag ok">IN · 4:45 PM</i></div></Card>
      <Step n={1} t="When you arrive" s="Check in with your manager. They punch you in." /><Step n={2} t="At the end of the night" s="See your manager before you leave. They punch you out." /><Step n={3} t="Your hours" s="They show up in the app." last />
    </>;
    case 'cancel': return <>
      <div className="hv-center"><span className="hv-cant">Can’t make it</span></div>
      <p className="hb2-line">Tap <b>Can’t make it</b> on the event as early as you can, so we can find someone.</p>
      <div className="hv-scale"><i /><div><span>Days ahead</span><span>Same day</span></div></div>
      <p className="hb2-line sm">Last-minute cancellations and no-shows mean we offer you fewer events.</p>
      <Card><div className="hv-inline"><LineIcon name="phone" size={20} /><span>Emergency on the day? <b>Call your manager.</b></span></div></Card>
    </>;
    case 'grooming': return <>
      <p className="hb2-line sm">You represent G&amp;R from the moment you arrive.</p>
      <div className="hv-yn2"><div><small className="ok">YES</small><YN ok>Hair tied back</YN><YN ok>Clean, pressed</YN><YN ok>Minimal jewelry</YN></div>
        <div><small className="no">NO</small><YN ok={false}>Strong perfume</YN><YN ok={false}>Big jewelry</YN><YN ok={false}>Wrinkles</YN></div></div>
    </>;
    case 'phone': return <div><Row ic="mobile" t="Your phone" s="Only in quiet moments, never in front of guests." tag="QUIET TIMES" tone="amber" /><Row ic="smoke" t="Smoking, vaping" s="Outside, with permission." tag="ASK FIRST" tone="amber" /><Row ic="wine" t="Alcohol, drugs" s="Never during an event." tag="ZERO TOLERANCE" tone="red" /></div>;
    case 'photos': return <div className="hv-col"><YN ok>Professional posts are welcome.<br />Tag <b>@gravotreservice</b></YN><YN ok={false}>Some VIP events: no photos or video at all</YN><YN ok={false}>Guests’ names, or anything from a private home</YN></div>;
    case 'respect': return <><p className="hb2-line">Zero tolerance for harassment, from anyone, guests included.</p><Card dark><b>Tell your manager right away, then Ronnie.</b><span className="hv-muted light">You’ll never get in trouble for reporting.</span></Card></>;
    case 'meals': return <div><Row ic="food" t="Staff meals" s="Not guaranteed." /><Row ic="box" t="Long days" s="Bring your own food." /></div>;
    case 'floor_uniform': return <>
      <Card dark><div className="hv-mgr"><span className="hv-shirt"><UniformIcon kind="black_shirt" size={40} /></span><span className="grow"><small className="hv-kick gold">USUALLY</small><b className="hv-serif">Black dress shirt</b></span></div></Card>
      <div className="hv-uts"><UTile icon={<PantsIcon size={44} />} t="Black dress pants" no="jeans" /><UTile icon={<ShoesIcon size={44} who="men" />} t="Black dress shoes" no="runners" /><UTile icon={<TieIcon size={44} />} t="Black tie · men" /></div>
      <p className="hb2-line sm">Some events: white shirt or black cocktail dress. <b>Your event page always shows the exact uniform</b>, with these icons.</p>
    </>;
    case 'clearing': return <><Step n={1} t="Wait for the whole table" s="Clear when everyone is done." /><Step n={2} t="Quietly" s="No stacking in front of guests." /><Step n={3} t="All night" s="Keep your section tidy." last /></>;
    case 'allergies': return <><div className="hv-quote"><small>A guest asks about an allergen:</small><span>Never guess.</span></div><Step n={1} t="Ask the kitchen or your manager" /><Step n={2} t="Come back with the answer" last /></>;
    case 'bar_uniform': return <>
      <div className="hv-uts three"><UTile icon={<UniformIcon kind="black_shirt" size={44} />} t="Black dress shirt" /><UTile icon={<TieIcon size={44} />} t="Black tie · men" /><UTile icon={<UniformIcon kind="dress" size={44} />} t="Or black dress · women" />
        <UTile icon={<PantsIcon size={44} />} t="Black dress pants" /><UTile icon={<ShoesIcon size={44} who="both" />} t="Black shoes" /><UTile icon={<WineKeyIcon size={44} />} t="Wine key" /></div>
      <p className="hb2-line sm">Hair tied back. Your event page always shows the exact uniform.</p>
    </>;
    case 'cocktails': return <><p className="hb2-line sm">Know these ten by heart.</p><div className="hv-menu">{COCKTAILS.map((c) => <div key={c}><LineIcon name="wine" size={16} color={G} /><span>{c}</span></div>)}</div></>;
    case 'alcohol': return <>
      <div className="hv-center"><div className="hv-id"><span><LineIcon name="guest" size={26} color="#D9B76A" /></span><div><b>18+</b><i /><i className="s" /></div></div></div>
      <p className="hb2-line"><b>18+ only.</b> Ask for ID when in doubt.</p><p className="hb2-line">A guest is clearly drunk? Don’t serve them. Tell the bar manager.</p>
    </>;
    case 'bus_uniform': return <><div className="hv-uts"><UTile icon={<UniformIcon kind="black_shirt" size={44} />} t="Black dress shirt" /><UTile icon={<PantsIcon size={44} />} t="Black dress pants" /><UTile icon={<ShoesIcon size={44} who="men" />} t="Black dress shoes" /></div><p className="hb2-line sm">Details are in each confirmation.</p></>;
    case 'restock': return <><Grid4 items={BUS} on={[0, 1]} /><p className="hb2-line sm">Keep the bar stocked: ice, glasses, garnish, cases. Bring dirty glassware back fast and safely.</p></>;
    case 'bussing': return <><Grid4 items={BUS} on={[2]} /><p className="hb2-line sm">Clear tables quietly and often. Keep stations clean all night.</p></>;
    case 'setup': return <><Grid4 items={BUS} on={[3]} /><p className="hb2-line sm">Help set up before guests arrive, and break down at the end.</p></>;
    case 'lifting': return <div><Row ic="lift" t="Bend your knees" s="Lift with your legs, not your back." /><Row ic="guest" t="Heavy load?" s="Ask for help." /><Row ic="glass" t="Never run with glassware" /></div>;
    case 'paypal': return <><Card><b className="hv-big">48 h</b><span className="hv-muted">to ask, after an event</span></Card><p className="hb2-line">Need your pay sooner? Ask Ronnie within 48 hours of the event and get it by PayPal.</p>
      <Card><div className="hv-inline"><LineIcon name="pay" size={20} /><span>PayPal fees are on you: they’re taken off the payment.</span></div></Card></>;
    case 'taxes': return <><div className="hv-center"><div className="hv-t4a"><div><b>T4A</b><small>{new Date().getFullYear()}</small></div>{['100%', '80%', '90%', '60%'].map((w) => <i key={w} style={{ width: w }} />)}</div></div>
      <p className="hb2-line">You’re a contractor: you get a T4A at the end of the year.</p><p className="hb2-line sm">You’re responsible for your own taxes.</p></>;
    case 'rides': return <><div className="hv-route"><span><LineIcon name="guest" size={18} /></span><i /><span className="dark"><LineIcon name="car" size={22} color="#D9B76A" /></span><i /><span><LineIcon name="pin" size={18} /></span></div>
      <p className="hb2-line sm">Far events: rides are organized in the app. You’ll see your car and pick-up on the event page.</p>
      <Card><div className="hv-inline"><LineIcon name="pay" size={20} /><span>Driving? Gas is paid when it’s noted on the event.</span></div></Card></>;
    case 'refer': return <><Card><small className="hv-kick">PROFILE</small><div className="hv-mgr"><span className="hv-av light"><LineIcon name="share" size={19} /></span><span className="grow"><b>Refer a friend</b><small>Your own link</small></span><b className="hv-share">Share ›</b></div></Card>
      <p className="hb2-line">Know someone great? Send them your link from Profile.</p><p className="hb2-line sm">When they apply, we know you sent them.</p></>;
    default: return null;
  }
}
