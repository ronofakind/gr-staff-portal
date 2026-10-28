export type UniformKind = 'white_shirt' | 'black_shirt' | 'dress';

export const UNIFORM_LABEL: Record<UniformKind, string> = {
  white_shirt: 'White dress shirt + tie',
  black_shirt: 'Black dress shirt + tie',
  dress: 'Black cocktail dress',
};
export const UNIFORM_SHORT: Record<UniformKind, string> = { white_shirt: 'White shirt', black_shirt: 'Black shirt', dress: 'Dress' };

/** Which uniform this person wears: shift override, else the event's floor/bar default. */
export function uniformFor(s: { uniform?: string | null; position_code: string | null; position_detail: string | null;
  events: { uniform_floor?: string | null; uniform_bar?: string | null } }): UniformKind {
  const bar = /^(BM|BT|BB)$/.test(s.position_code ?? '') || /^bar\b/i.test(s.position_detail ?? '');
  return (s.uniform || (bar ? s.events.uniform_bar : s.events.uniform_floor) || (bar ? 'black_shirt' : 'white_shirt')) as UniformKind;
}

export function UniformIcon({ kind, size = 32 }: { kind: UniformKind; size?: number }) {
  if (kind === 'dress') {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <path d="M27 5 Q32 9.5 37 5 L42.5 7.5 Q45.8 8.8 46.2 12.8 L49.4 46.5 L45.2 46.5 L42.6 20.5 Q41 28.5 41.3 33.5 L43.4 60.5 L20.6 60.5 L22.7 33.5 Q23 28.5 21.4 20.5 L18.8 46.5 L14.6 46.5 L17.8 12.8 Q18.2 8.8 21.5 7.5 Z" fill="#1A1714" />
        <path d="M21.9 9.5 Q22.6 15 21.6 20.5 M42.1 9.5 Q41.4 15 42.4 20.5" stroke="#F6F2EC" strokeWidth="0.6" fill="none" />
        <path d="M27 5.6 Q32 10.6 37 5.6" stroke="#FFFFFF" strokeWidth="2" fill="none" strokeLinecap="round" />
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
