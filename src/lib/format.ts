import type { Lang } from './i18n';

const TZ = 'America/Toronto';
const loc = (l: Lang) => (l === 'fr' ? 'fr-CA' : 'en-CA');

export const time = (iso: string, l: Lang) =>
  new Date(iso).toLocaleTimeString(loc(l), { hour: 'numeric', minute: '2-digit', timeZone: TZ });

export const longDate = (isoDate: string, l: Lang) =>
  new Date(isoDate + 'T12:00:00').toLocaleDateString(loc(l), { weekday: 'long', month: 'long', day: 'numeric' });

export const dayBadge = (isoDate: string, l: Lang) => {
  const d = new Date(isoDate + 'T12:00:00');
  return {
    dow: d.toLocaleDateString(loc(l), { weekday: 'short' }).replace('.', '').toUpperCase(),
    day: d.getDate(),
  };
};

export const minus = (iso: string, min: number) => new Date(new Date(iso).getTime() - min * 60000).toISOString();

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export const mapsUrl = (address: string) => `https://maps.google.com/?q=${encodeURIComponent(address)}`;
