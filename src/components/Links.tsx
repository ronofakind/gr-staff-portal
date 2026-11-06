import { useState } from 'react';

/** Nov 6 · 🔗 helpful links for staff (075): events.links + venues.links = [{ url, label }]. */
export type HLink = { url: string; label: string };
export const asLinks = (x: unknown): HLink[] => (Array.isArray(x) ? x : []).filter((l): l is HLink => !!l && typeof (l as HLink).url === 'string' && /^https?:\/\//i.test((l as HLink).url));

/** what kind of link it is → icon + source line */
export function linkKind(url: string): { icon: string; src: string; cls: string } {
  let h = ''; try { h = new URL(url).hostname.replace(/^www\./, ''); } catch { /* bad link */ }
  if (/instagram\.com$/.test(h)) return { icon: '', src: 'Instagram', cls: 'ig' };
  if (/facebook\.com$|fb\.(me|watch)$/.test(h)) return { icon: 'f', src: 'Facebook', cls: 'fb' };
  if (/tiktok\.com$/.test(h)) return { icon: '♪', src: 'TikTok', cls: 'tt' };
  if (/youtube\.com$|youtu\.be$/.test(h)) return { icon: '▶', src: 'YouTube', cls: 'yt' };
  if (/drive\.google\.com$|docs\.google\.com$/.test(h)) return { icon: '📁', src: 'Google Drive', cls: 'gd' };
  if (/google\.[a-z.]+$|goo\.gl$/.test(h) && /maps|goo\.gl/.test(url)) return { icon: '📍', src: 'Google Maps', cls: 'gm' };
  return { icon: '🌐', src: h || 'Website', cls: 'web' };
}
/** first link that's about getting there (shown on the Home card) */
export const gettingThere = (ls: HLink[]) => ls.find((l) => /get(ting)? (there|to)|how to (get|find)|directions?|entr(ance|ée)|parking|access|acc[eè]s|where/i.test(l.label));
/** venue links first, then the event's own; same link once */
export const mergeLinks = (venue: unknown, event: unknown): HLink[] => { const seen = new Set<string>(); return [...asLinks(venue), ...asLinks(event)].filter((l) => !seen.has(l.url) && !!seen.add(l.url)); };

export function LinkIcon({ url }: { url: string }) { const k = linkKind(url); return <span className={'hl-ic hl-' + k.cls}>{k.icon}</span>; }

/** staff: tap → opens Instagram / the browser */
export function StaffLinks({ links }: { links: HLink[] }) {
  if (!links.length) return null;
  return (
    <div className="hl-list"><span className="hl-h">🔗 HELPFUL LINKS</span>
      {links.map((l) => <a key={l.url} className="hl-row" href={l.url} target="_blank" rel="noreferrer"><LinkIcon url={l.url} /><span className="grow"><b>{l.label || linkKind(l.url).src}</b><small>Opens {linkKind(l.url).src}</small></span><b>›</b></a>)}
    </div>
  );
}

/** admin: list + paste a link + what it is */
export function LinksEditor({ links, set, venueName, alsoVenue, setAlsoVenue }: { links: HLink[]; set: (l: HLink[]) => void; venueName?: string | null; alsoVenue?: boolean; setAlsoVenue?: (v: boolean) => void }) {
  const [url, setUrl] = useState(''); const [label, setLabel] = useState(''); const [bad, setBad] = useState(false);
  const add = () => {
    const u = (url.trim().match(/https?:\/\/\S+/) ?? [''])[0];
    if (!u) return setBad(true);
    if (!links.some((l) => l.url === u)) set([...links, { url: u, label: label.trim() }]);
    setUrl(''); setLabel(''); setBad(false);
  };
  return (
    <div className="ef-f hl-edit"><span>🔗 HELPFUL LINKS FOR STAFF · Instagram post, website, Drive, YouTube…</span>
      {links.map((l, i) => (
        <div key={l.url} className="hl-row ed"><LinkIcon url={l.url} />
          <span className="grow"><input value={l.label} placeholder={linkKind(l.url).src + ' · what is it?'} onChange={(e) => set(links.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /><small><a href={l.url} target="_blank" rel="noreferrer">{linkKind(l.url).src} · {l.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}</a></small></span>
          <button type="button" className="sg-x" aria-label="Remove link" onClick={() => set(links.filter((_, k) => k !== i))}>×</button></div>
      ))}
      <div className="hl-add">
        <input value={url} onChange={(e) => { setUrl(e.target.value); setBad(false); }} placeholder="Paste a link…" />
        <input value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="What is it? · e.g. How to get there" />
        <button type="button" className="abtn sm dark" disabled={!url.trim()} onClick={add}>+ Add link</button>
      </div>
      {bad && <small className="accent">That doesn’t look like a link. Copy it from the app (Share → Copy link) and paste it here.</small>}
      {setAlsoVenue && venueName && <label className="hl-also"><input type="checkbox" checked={!!alsoVenue} onChange={(e) => setAlsoVenue(e.target.checked)} /> Also save these on the venue (every event at {venueName})</label>}
      <small className="muted">Staff see them on their event page; a “how to get there” link also shows on their Home card.</small>
    </div>
  );
}
