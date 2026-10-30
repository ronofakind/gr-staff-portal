export type UniformKind = 'white_shirt' | 'black_shirt' | 'dress' | 'black_tshirt';

export const UNIFORM_LABEL: Record<UniformKind, string> = {
  white_shirt: 'White dress shirt + tie',
  black_shirt: 'Black dress shirt + tie',
  dress: 'Black cocktail dress',
  black_tshirt: 'Black T-shirt',
};
export const UNIFORM_SHORT: Record<UniformKind, string> = { white_shirt: 'White shirt', black_shirt: 'Black shirt', dress: 'Dress', black_tshirt: 'Black T-shirt' };

/** Which uniform this person wears: shift override, else the event's floor/bar default. */
export function uniformFor(s: { uniform?: string | null; position_code: string | null; position_detail: string | null; me?: { sex?: string | null } | null;
  events: { uniform_floor?: string | null; uniform_bar?: string | null; uniform_floor_w?: string | null; uniform_bar_w?: string | null } }): UniformKind {
  const bar = /^(BM|BT|BB)$/.test(s.position_code ?? '') || /^bar\b/i.test(s.position_detail ?? '');
  const w = s.me?.sex === 'f'; // women see the women's line; men and not-set see the men's line
  const ev = s.events;
  return (s.uniform || (bar ? (w && ev.uniform_bar_w) || ev.uniform_bar : (w && ev.uniform_floor_w) || ev.uniform_floor) || (bar ? 'black_shirt' : 'white_shirt')) as UniformKind;
}
/** Label for any uniform value, including "custom:<text>". */
export const uniformLabel = (k: string) => (k.startsWith('custom:') ? k.slice(7) || 'See notes' : UNIFORM_LABEL[k as UniformKind] ?? k);

const IMG: Partial<Record<UniformKind, string>> = { white_shirt: '/uniform/shirt_white.png', black_shirt: '/uniform/shirt_black.png', dress: '/uniform/dress.png', black_tshirt: '/uniform/tshirt.png' };
const pic = (src: string, size: number) => <img src={src} alt="" width={size} height={size} style={{ objectFit: 'contain', display: 'block' }} />;

export function UniformIcon({ kind, size = 32 }: { kind: UniformKind; size?: number }) {
  if (IMG[kind]) return pic(IMG[kind]!, size);
  if (String(kind).startsWith('custom:')) return pic('/uniform/shirt_black.png', size);
  if (kind === 'dress') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path d="M27 5 Q32 9.5 37 5 L42.5 7.5 Q45.8 8.8 46.2 12.8 L49.4 46.5 L45.2 46.5 L42.6 20.5 Q41 28.5 41.3 33.5 L43.4 60.5 L20.6 60.5 L22.7 33.5 Q23 28.5 21.4 20.5 L18.8 46.5 L14.6 46.5 L17.8 12.8 Q18.2 8.8 21.5 7.5 Z" fill="#1A1714" />
        <path d="M21.9 9.5 Q22.6 15 21.6 20.5 M42.1 9.5 Q41.4 15 42.4 20.5" stroke="#F6F2EC" strokeWidth="0.6" fill="none" />
        <path d="M27 5.6 Q32 10.6 37 5.6" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === 'black_tshirt') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path d="M23 9 Q32 15 41 9 L53 13.5 L61 26 L51.5 31.5 L47.5 25.5 L47.5 58 L16.5 58 L16.5 25.5 L12.5 31.5 L3 26 L11 13.5 Z" fill="#1A1714" stroke="#1A1714" strokeWidth="2" strokeLinejoin="round" />
        <path d="M24.5 9.6 Q32 15.6 39.5 9.6" stroke="#F6F2EC" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M16.5 25.5 L16.5 20 M47.5 25.5 L47.5 20" stroke="#6B625A" strokeWidth="1.2" />
      </svg>
    );
  }
  const black = kind === 'black_shirt';
  const f = black ? '#1A1714' : '#FFFFFF'; const ln = black ? '#FFFFFF' : '#1A1714'; const tie = '#1A1714';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="46" height="49" rx="5" fill={f} stroke="#1A1714" strokeWidth="2" />
      <path d="M21 19 Q20.5 8.5 32 8.5 Q43.5 8.5 43 19" fill={f} stroke={ln} strokeWidth="1.8" />
      <path d="M30.4 24.5 L33.6 24.5 L36.4 47 L32 51.5 L27.6 47 Z" fill={tie} stroke={ln} strokeWidth="1.8" />
      <path d="M29.2 19.5 L34.8 19.5 L33.6 24.5 L30.4 24.5 Z" fill={tie} stroke={ln} strokeWidth="1.8" />
      <path d="M23.5 10.5 L32 19.5 L27 26 L19.5 19 Z" fill={f} stroke={ln} strokeWidth="1.8" />
      <path d="M40.5 10.5 L32 19.5 L37 26 L44.5 19 Z" fill={f} stroke={ln} strokeWidth="1.8" />
    </svg>
  );
}

/** Everyone wears the black apron, except with the black cocktail dress. */
export const wearsApron = (kind: UniformKind) => kind !== 'dress' && kind !== 'black_tshirt';
/** Lines already shown as tiles (shirt, pants, shoes, apron, belt) — not repeated as chips. */
export const TILE_LINE = /shirt|tie\b|pants|pantalon|shoes|souliers|chaussures|apron|tablier|belt|ceinture|dress\b/i;

export function PantsIcon({ size = 44 }: { size?: number }) { return pic('/uniform/pants.png', size); }
export function ShoesIcon({ size = 44, who = 'both' }: { size?: number; who?: 'men' | 'women' | 'both' }) {
  if (who === 'both') return <span style={{ display: 'flex', gap: 2 }}>{pic('/uniform/shoe_men.png', size * 0.85)}{pic('/uniform/shoe_women.png', size * 0.85)}</span>;
  return pic(`/uniform/shoe_${who}.png`, size);
}
export function ApronIcon({ size = 44 }: { size?: number }) { return pic('/uniform/apron.png', size); }

export function TieIcon({ size = 44 }: { size?: number }) { return pic('/uniform/tie.png', size); }
export function WineKeyIcon({ size = 44 }: { size?: number }) { return pic('/uniform/winekey.png', size); }
/** Bar positions: bar manager, barback, bartender. */
export const isBarPos = (code: string | null, detail: string | null) => /^(BM|BB|BT)$/.test(code ?? '') || /^bar\b|bartend|barback|barmaid/i.test(detail ?? '');
