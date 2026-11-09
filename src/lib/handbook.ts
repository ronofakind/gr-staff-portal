import { supabase } from './supabase';

/** Nov 8 · push 56 (083) · the handbook (HandbookCardsV2, Ronnie's final texts). Each new hire gets the cards for their roles.
 *  role: all · floor · bar (bartenders / barmaids) · bus (busboy / barback) · pay (payroll only). */
export type HbRole = 'all' | 'floor' | 'bar' | 'bus' | 'pay';
export type HbChapter = 'house' | 'events' | 'guests' | 'role' | 'paid' | 'start';
/** push 58 · premium: cards grouped in chapters (the cover lists them). kind = a special page layout. */
export type HbCard = { id: string; icon: string; title: string; role: HbRole; lines: string[]; mandatory?: string; agree?: string;
  ch?: HbChapter; quote?: { lead: string; text: string }; kind?: 'paydates' | 'contacts' | 'must' };
export const ROLE_LABEL: Record<HbRole, string> = { all: 'ALL STAFF', floor: 'FLOOR', bar: 'BARTENDERS', bus: 'BUSBOY / BARBACK', pay: 'PAYROLL' };

export const CARDS: HbCard[] = [
  { id: 'welcome', ch: 'house', icon: '👋', title: 'Welcome', role: 'all', lines: ['Event staffing for private, corporate and upscale events across Montreal.', 'Every team member represents G&R.', 'Our 4 values: **Professionalism · Presentation · Punctuality · Attitude**.'] },
  { id: 'work', ch: 'house', icon: '📅', title: 'How the work works', role: 'all', lines: ['You work **event by event**.', 'You accept or decline each one based on your availability, in the app.', 'Once you accept, we count on you.'] },
  { id: 'requests', ch: 'events', icon: '🙋', title: 'Answering requests', role: 'all', lines: ['New dates arrive in the app: **Yes · Maybe · No**.', "Yes → say from what time you're free.", 'Answer fast: the first yes often gets the spot.'] },
  { id: 'confirm', ch: 'events', icon: '✅', title: 'Confirmations', role: 'all', lines: ['Sent 4 days before the event, in the app.', 'Read it all: uniform, address, start time, on-site contact, notes.', '**Confirm right away.** Re-read it before you leave home.'] },
  { id: 'arrive', ch: 'events', icon: '⏰', title: 'Arriving', role: 'all', lines: ['Arrive **15 min early**, changed and ready at the start time.', "Running late? Tap **I'm running late** as early as possible."] },
  { id: 'checkin', ch: 'events', icon: '📍', title: 'Checking in & out', role: 'all', lines: ['When you arrive, **check in with the manager** named in your confirmation — they punch you in.', 'At the end of the night, see your manager before you leave — they punch you out.', 'You see your hours in the app.'] },
  { id: 'cancel', ch: 'events', icon: '🚫', title: 'Cancelling', role: 'all', lines: ["Tap **Can't make it** in the app as early as possible.", 'Late cancels, no-shows and repeated lateness mean fewer events.', 'Emergencies: call your manager.'] },
  { id: 'grooming', ch: 'guests', icon: '✨', title: 'Grooming', role: 'all', lines: ['Clean, event-ready, hair tied back.', 'Minimalist jewelry, no strong perfume or cologne.', 'You represent G&R from the moment you arrive.'] },
  { id: 'guests', ch: 'guests', icon: '🤝', title: 'With guests', role: 'all', lines: ['Every guest, client and vendor is a VIP.', 'Never argue with a guest or a client.'], quote: { lead: 'Never say “I don’t know.” Say:', text: '“I will find out for you.”' } },
  { id: 'phone', ch: 'guests', icon: '📵', title: 'Phone, smoking, alcohol', role: 'all', lines: ['Phone only in quiet moments, never in front of guests.', 'Smoking / vaping outside, with permission.', '**Zero tolerance** for alcohol or drugs during events.'] },
  { id: 'photos', ch: 'guests', icon: '📸', title: 'Photos & privacy', role: 'all', lines: ['Professional posts are welcome — tag @gravotreservice.', 'Some VIP events: no photos or video at all.', "Never share guests' names or anything from a private home."] },
  { id: 'meals', ch: 'guests', icon: '🥪', title: 'Meals', role: 'all', lines: ['Staff meals are not guaranteed.', 'Bring your own food for long days.'] },
  { id: 'respect', ch: 'guests', icon: '🛡️', title: 'Respect', role: 'all', lines: ['Zero tolerance for harassment, from anyone — guests included.', 'Tell your manager right away, then Ronnie.', "You'll never get in trouble for reporting."] },
  { id: 'rides', ch: 'start', icon: '🚗', title: 'Rides & gas', role: 'all', lines: ['Far events: rides are organized in the app.', "Drivers get transport / gas when it's noted on the event."] },
  { id: 'contacts', ch: 'start', icon: '📞', title: 'Your contacts', role: 'all', kind: 'contacts', lines: ['Save us in your phone so you know it’s us when we call.'] },
  { id: 'refer', ch: 'start', icon: '💌', title: 'Refer a friend', role: 'all', lines: ['Know someone great? Profile → **Refer a friend**.', 'When they apply, we know you sent them.'] },
  { id: 'floor_uniform', ch: 'role', icon: '👔', title: 'Floor uniform', role: 'floor', lines: ['Black pressed dress shirt, formal black pants, formal black shoes (no running shoes). Men: black tie.', "Some events: white shirt or black cocktail dress — it's in the confirmation."] },
  { id: 'must_know', ch: 'role', icon: '🍽️', title: 'Three things every floor server knows', role: 'floor', kind: 'must', lines: ['Not sure yet? Watch a few videos on YouTube and practise at home before your first event.'], mandatory: 'I understand these are required' },
  { id: 'clearing', ch: 'role', icon: '🧹', title: 'Clearing', role: 'floor', lines: ['Clear quietly, when the whole table is done.', 'Keep your section tidy all night.'] },
  { id: 'allergies', ch: 'role', icon: '⚠️', title: 'Allergies', role: 'floor', lines: ['A guest asks about an allergen: never guess.', 'Ask the kitchen or your manager.'] },
  { id: 'bar_uniform', ch: 'role', icon: '👔', title: 'Bar uniform', role: 'bar', lines: ['Men: black pressed dress shirt, black tie, formal black pants and shoes.', 'Women: black pressed shirt or conservative black cocktail dress, black shoes, hair tied back.'] },
  { id: 'cocktails', ch: 'role', icon: '🍸', title: 'Core cocktails', role: 'bar', lines: ['Margarita · Amaretto Sour · Cosmopolitan · Martini · Bloody Caesar · Aperol Spritz · Paloma · Gin & Tonic · Vodka Soda · Rum & Coke.'] },
  { id: 'alcohol', ch: 'role', icon: '🪪', title: 'Serving alcohol', role: 'bar', lines: ['18+ only.', "Don't serve a guest who's clearly drunk — tell the bar manager."] },
  { id: 'bus_uniform', ch: 'role', icon: '👕', title: 'Uniform', role: 'bus', lines: ['Black pressed dress shirt, formal black pants, formal black shoes.', 'Details in each confirmation.'] },
  { id: 'restock', ch: 'role', icon: '🧊', title: 'Ice, restock & glassware', role: 'bus', lines: ['Keep the bar stocked: ice, glasses, garnish, cases.', 'Bring dirty glassware back fast and safely.'] },
  { id: 'bussing', ch: 'role', icon: '🧹', title: 'Clearing & bussing', role: 'bus', lines: ['Clear tables quietly and often.', 'Keep stations clean all night.'] },
  { id: 'setup', ch: 'role', icon: '📦', title: 'Setup & breakdown', role: 'bus', lines: ['Help set up before guests arrive and break down at the end.'] },
  { id: 'lifting', ch: 'role', icon: '🏋️', title: 'Lifting safely', role: 'bus', lines: ['Bend your knees, ask for help with heavy loads.', 'Never run with glassware.'] },
  { id: 'pay', ch: 'paid', icon: '🗓️', title: 'Pay dates', role: 'pay', kind: 'paydates', lines: ['Falls on a weekend or a holiday? You’re paid the **next business day**.', 'Under 4 hours worked? You’re paid 4 hours.', 'Questions about pay → Ronnie.'] },
  { id: 'paypal', ch: 'paid', icon: '⚡', title: 'PayPal early pay', role: 'pay', lines: ['Ask within 48 h of an event.', 'PayPal fees are paid by you (deducted).'] },
  { id: 'taxes', ch: 'paid', icon: '🧾', title: 'Taxes', role: 'pay', lines: ["You're a contractor (T4A at year end).", "You're responsible for your own taxes."] },
  { id: 'agree', ch: 'start', icon: '☑️', title: 'Your agreement', role: 'all', lines: ['I’ve read the G&R Standard and I’ll bring it to every event: professionalism, presentation, punctuality and attitude.'], agree: 'Sign' },
];

export type Onboarding = {
  level: string | null; handbook_roles: string[]; paid_by: 'payroll' | 'cash'; hb_seen: string[]; hb_total: number | null;
  hb_mandatory_at: string | null; hb_done_at: string | null; tax_done_at: string | null; created_at: string; tax_last4: string | null;
};
/** handbook_roles floor · bar · busboy → card roles. */
export function cardsFor(o: Pick<Onboarding, 'handbook_roles' | 'paid_by'>): HbCard[] {
  const want = new Set<HbRole>(['all']);
  if (o.handbook_roles.includes('floor')) want.add('floor');
  if (o.handbook_roles.includes('bar')) want.add('bar');
  if (o.handbook_roles.includes('busboy')) want.add('bus');
  if (o.paid_by !== 'cash') want.add('pay');
  const order = (c: HbCard) => CHAPTERS.findIndex((x) => x.k === c.ch);
  const list = CARDS.filter((c) => want.has(c.role) && c.id !== 'agree').map((c, i) => ({ c, i })).sort((a, b) => order(a.c) - order(b.c) || a.i - b.i).map((x) => x.c);
  return [...list, CARDS.find((c) => c.id === 'agree')!]; // agreement always last
}
/** null = not a new hire (current staff) or before 083. */
export async function loadOnboarding(): Promise<Onboarding | null> {
  const { data, error } = await supabase.rpc('my_onboarding');
  if (error || !data) return null;
  return data as Onboarding;
}
export const saveHandbook = (seen: string[], total: number, mandatory = false, agree = false) =>
  supabase.rpc('save_my_handbook', { p_seen: seen, p_total: total, p_mandatory: mandatory, p_agree: agree });
/** **bold** → <b>. Text only, no HTML from anywhere else. */
export function md(s: string) { return s.split(/\*\*(.+?)\*\*/g).map((x, i) => (i % 2 ? { b: x } : { t: x })); }

export const CHAPTERS: { k: HbChapter; n: string; t: string }[] = [
  { k: 'house', n: 'I', t: 'The house' }, { k: 'events', n: 'II', t: 'Your events' }, { k: 'guests', n: 'III', t: 'With guests' },
  { k: 'role', n: 'IV', t: 'On the floor' }, { k: 'paid', n: 'V', t: 'Getting paid' }, { k: 'start', n: 'VI', t: 'Before you start' },
];
/** IV is named after their role(s). */
export function chapterTitle(k: HbChapter, roles: string[]) {
  if (k !== 'role') return CHAPTERS.find((c) => c.k === k)!.t;
  const r = roles.filter((x) => ['floor', 'bar', 'busboy'].includes(x));
  if (r.length !== 1) return 'Your roles';
  return r[0] === 'floor' ? 'On the floor' : r[0] === 'bar' ? 'Behind the bar' : 'Bussing';
}
export const CONTACTS = [
  { id: 'ronnie', first: 'Ronald', last: 'Ladores', nick: 'Ronnie', phone: '514 918 1588', tel: '+15149181588', roles: ['Admin', 'Payroll', 'Floor scheduling', 'Hiring'],
    photo: 'https://oigqdecyhmeuvrpoikdv.supabase.co/storage/v1/object/public/avatars/13791946-d8df-4146-b51e-0963f0324499.jpg' },
  { id: 'georges', first: 'Georges', last: 'Mourad', nick: '', phone: '514 804 4446', tel: '+15148044446', roles: ['Bar scheduling', 'Client relations'],
    photo: 'https://oigqdecyhmeuvrpoikdv.supabase.co/storage/v1/object/public/avatars/c4d963bc-9959-4541-a8dc-766da053b697.jpg' },
];
