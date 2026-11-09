/** push 58 · thin line icons for onboarding (same weight as the uniform icons). No emojis on these screens. */
const P: Record<string, string> = {
  house: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  guest: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
  tray: '<path d="M4 15h16"/><path d="M6 15a6 6 0 0 1 12 0"/><path d="M12 7V5.5"/><path d="M7 18h10"/>',
  pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 9.5v5M17.5 9.5v5"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l8-8M16 6l2 2M14 8l2 2"/>',
  plates: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="4.5"/>',
  wine: '<path d="M8 3h8c0 5-1.5 8-4 8S8 8 8 3z"/><path d="M12 11v8M8.5 21h7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  cheque: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M6 14h7M6 10.5h4M15 14l3-3"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16c.6-1.6 2-2.5 3.5-2.5s2.9.9 3.5 2.5M15 10h3M15 13.5h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
export type LineIconName = keyof typeof P | string;
export function LineIcon({ name, size = 22, color = 'currentColor', w = 1.4 }: { name: LineIconName; size?: number; color?: string; w?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[name] ?? P.house }} />;
}
export const CHAPTER_ICON: Record<string, string> = { house: 'house', events: 'cal', guests: 'guest', role: 'tray', paid: 'pay', start: 'key' };
