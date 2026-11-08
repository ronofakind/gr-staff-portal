import { supabase } from './supabase';

/** Nov 8 · push 56 (083) · the handbook (HandbookCardsV2, Ronnie's final texts). Each new hire gets the cards for their roles.
 *  role: all · floor · bar (bartenders / barmaids) · bus (busboy / barback) · pay (payroll only). */
export type HbRole = 'all' | 'floor' | 'bar' | 'bus' | 'pay';
export type HbCard = { id: string; icon: string; title: string; role: HbRole; lines: string[]; mandatory?: string; agree?: string };
export const ROLE_LABEL: Record<HbRole, string> = { all: 'ALL STAFF', floor: 'FLOOR', bar: 'BARTENDERS', bus: 'BUSBOY / BARBACK', pay: 'PAYROLL' };

export const CARDS: HbCard[] = [
  { id: 'welcome', icon: '👋', title: 'Welcome', role: 'all', lines: ['Event staffing for private, corporate and upscale events across Montreal.', 'Every team member represents G&R.', 'Our 4 values: **Professionalism · Presentation · Punctuality · Attitude**.'] },
  { id: 'work', icon: '📅', title: 'How the work works', role: 'all', lines: ['You work **event by event**.', 'You accept or decline each one based on your availability, in the app.', 'Once you accept, we count on you.'] },
  { id: 'requests', icon: '🙋', title: 'Answering requests', role: 'all', lines: ['New dates arrive in the app: **Yes · Maybe · No**.', "Yes → say from what time you're free.", 'Answer fast: the first yes often gets the spot.'] },
  { id: 'confirm', icon: '✅', title: 'Confirmations', role: 'all', lines: ['Sent 4 days before the event, in the app.', 'Read it all: uniform, address, start time, on-site contact, notes.', '**Confirm right away.** Re-read it before you leave home.'] },
  { id: 'arrive', icon: '⏰', title: 'Arriving', role: 'all', lines: ['Arrive **15 min early**, changed and ready at the start time.', "Running late? Tap **I'm running late** as early as possible."] },
  { id: 'checkin', icon: '📍', title: 'Checking in & out', role: 'all', lines: ['When you arrive, **check in with the manager** named in your confirmation — they punch you in.', 'At the end of the night, see your manager before you leave — they punch you out.', 'You see your hours in the app.'] },
  { id: 'cancel', icon: '🚫', title: 'Cancelling', role: 'all', lines: ["Tap **Can't make it** in the app as early as possible.", 'Late cancels, no-shows and repeated lateness mean fewer events.', 'Emergencies: call your manager.'] },
  { id: 'grooming', icon: '✨', title: 'Grooming', role: 'all', lines: ['Clean, event-ready, hair tied back.', 'Minimalist jewelry, no strong perfume or cologne.', 'You represent G&R from the moment you arrive.'] },
  { id: 'guests', icon: '🤝', title: 'With guests', role: 'all', lines: ['Every guest, client and vendor is a VIP.', 'Never argue with a guest or a client.', '“I don\'t know” becomes **“I will find out for you.”**'] },
  { id: 'phone', icon: '📵', title: 'Phone, smoking, alcohol', role: 'all', lines: ['Phone only in quiet moments, never in front of guests.', 'Smoking / vaping outside, with permission.', '**Zero tolerance** for alcohol or drugs during events.'] },
  { id: 'photos', icon: '📸', title: 'Photos & privacy', role: 'all', lines: ['Professional posts are welcome — tag @gravotreservice.', 'Some VIP events: no photos or video at all.', "Never share guests' names or anything from a private home."] },
  { id: 'meals', icon: '🥪', title: 'Meals', role: 'all', lines: ['Staff meals are not guaranteed.', 'Bring your own food for long days.'] },
  { id: 'respect', icon: '🛡️', title: 'Respect', role: 'all', lines: ['Zero tolerance for harassment, from anyone — guests included.', 'Tell your manager right away, then Ronnie.', "You'll never get in trouble for reporting."] },
  { id: 'rides', icon: '🚗', title: 'Rides & gas', role: 'all', lines: ['Far events: rides are organized in the app.', "Drivers get transport / gas when it's noted on the event."] },
  { id: 'contacts', icon: '📞', title: 'Contacts', role: 'all', lines: ['**Ronald Ladores (Ronnie)** · owner, payroll, floor scheduling, hiring · 514 918 1588', '**Georges Mourad** · owner, bar scheduling · 514 804 4446'] },
  { id: 'refer', icon: '💌', title: 'Refer a friend', role: 'all', lines: ['Know someone great? Profile → **Refer a friend**.', 'When they apply, we know you sent them.'] },
  { id: 'floor_uniform', icon: '👔', title: 'Floor uniform', role: 'floor', lines: ['Black pressed dress shirt, formal black pants, formal black shoes (no running shoes). Men: black tie.', "Some events: white shirt or black cocktail dress — it's in the confirmation."] },
  { id: 'must_know', icon: '🍽️', title: 'Must know before your first event', role: 'floor', lines: ['**Mandatory for every floor staff:**', '🍽️ Carry **3 plates** at once', '🍷 Open and **pour wine** properly', '🫗 Hold and carry a **tray** with control', "Don't know how yet? Look it up on YouTube when you have time and practice at home."], mandatory: 'I understand these are mandatory' },
  { id: 'clearing', icon: '🧹', title: 'Clearing', role: 'floor', lines: ['Clear quietly, when the whole table is done.', 'Keep your section tidy all night.'] },
  { id: 'allergies', icon: '⚠️', title: 'Allergies', role: 'floor', lines: ['A guest asks about an allergen: never guess.', 'Ask the kitchen or your manager.'] },
  { id: 'bar_uniform', icon: '👔', title: 'Bar uniform', role: 'bar', lines: ['Men: black pressed dress shirt, black tie, formal black pants and shoes.', 'Women: black pressed shirt or conservative black cocktail dress, black shoes, hair tied back.'] },
  { id: 'cocktails', icon: '🍸', title: 'Core cocktails', role: 'bar', lines: ['Margarita · Amaretto Sour · Cosmopolitan · Martini · Bloody Caesar · Aperol Spritz · Paloma · Gin & Tonic · Vodka Soda · Rum & Coke.'] },
  { id: 'alcohol', icon: '🪪', title: 'Serving alcohol', role: 'bar', lines: ['18+ only.', "Don't serve a guest who's clearly drunk — tell the bar manager."] },
  { id: 'bus_uniform', icon: '👕', title: 'Uniform', role: 'bus', lines: ['Black pressed dress shirt, formal black pants, formal black shoes.', 'Details in each confirmation.'] },
  { id: 'restock', icon: '🧊', title: 'Ice, restock & glassware', role: 'bus', lines: ['Keep the bar stocked: ice, glasses, garnish, cases.', 'Bring dirty glassware back fast and safely.'] },
  { id: 'bussing', icon: '🧹', title: 'Clearing & bussing', role: 'bus', lines: ['Clear tables quietly and often.', 'Keep stations clean all night.'] },
  { id: 'setup', icon: '📦', title: 'Setup & breakdown', role: 'bus', lines: ['Help set up before guests arrive and break down at the end.'] },
  { id: 'lifting', icon: '🏋️', title: 'Lifting safely', role: 'bus', lines: ['Bend your knees, ask for help with heavy loads.', 'Never run with glassware.'] },
  { id: 'pay', icon: '🗓️', title: 'Pay', role: 'pay', lines: ['Worked 1st–15th → paid the **16th**. Worked 16th–end → paid the **1st**.', 'Weekend / holiday → next business day.', 'Under 4 hours worked → paid 4 hours.', 'Questions about pay → Ronnie.'] },
  { id: 'paypal', icon: '⚡', title: 'PayPal early pay', role: 'pay', lines: ['Ask within 48 h of an event.', 'PayPal fees are paid by you (deducted).'] },
  { id: 'taxes', icon: '🧾', title: 'Taxes', role: 'pay', lines: ["You're a contractor (T4A at year end).", "You're responsible for your own taxes."] },
  { id: 'agree', icon: '☑️', title: 'Agreement', role: 'all', lines: ["That's everything. Welcome to the team!"], agree: "I've read and agree to the G&R standards" },
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
  const list = CARDS.filter((c) => want.has(c.role) && c.id !== 'agree');
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
