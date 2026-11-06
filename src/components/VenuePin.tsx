import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/** Nov 6 · 📍 exact spot on a venue (073). Admin: paste a Google Maps link (checked by /api/pin). Staff: small map + Directions to the pin. */
export type Pin = { lat: number; lng: number; label?: string | null };
export const pinDirections = (p: Pin) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
export const pinOpen = (p: Pin) => `https://maps.google.com/?q=${p.lat},${p.lng}`;

/** "@45.5,-73.5" · "q=45.5,-73.5" · "!3d45.5!4d-73.5" · "45.5, -73.5" */
export function parsePin(s: string): { lat: number; lng: number } | null {
  const t = s.trim(); let m = t.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || t.match(/\/(?:place|search)\/(-?\d+\.\d+)\s*,\s*\+?\s*(-?\d+\.\d+)/) || t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|ll|query|destination)=(-?\d+\.\d+)(?:,|%2C)\s*(-?\d+\.\d+)/) || t.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/);
  if (!m) return null; const lat = Number(m[1]); const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

const icon = L.divIcon({ className: 'vp-pin', html: '📍', iconSize: [30, 30], iconAnchor: [15, 28] });
const MTL: [number, number] = [45.5088, -73.554];

export function PinMap({ pin, onPick, height = 220 }: { pin: Pin | null; onPick?: (p: { lat: number; lng: number }) => void; height?: number }) {
  const el = useRef<HTMLDivElement>(null); const map = useRef<L.Map | null>(null); const mk = useRef<L.Marker | null>(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: !!onPick, attributionControl: true, dragging: true, scrollWheelZoom: !!onPick }).setView(pin ? [pin.lat, pin.lng] : MTL, pin ? 17 : 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    if (onPick) m.on('click', (e: L.LeafletMouseEvent) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m; setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; mk.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = map.current; if (!m) return;
    if (!pin) { mk.current?.remove(); mk.current = null; return; }
    if (!mk.current) { mk.current = L.marker([pin.lat, pin.lng], { icon, draggable: !!onPick }).addTo(m); if (onPick) mk.current.on('dragend', () => { const p = mk.current!.getLatLng(); onPick({ lat: p.lat, lng: p.lng }); }); }
    else mk.current.setLatLng([pin.lat, pin.lng]);
    if (!m.getBounds().contains([pin.lat, pin.lng])) m.setView([pin.lat, pin.lng], 17);
  }, [pin?.lat, pin?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="vp-map" style={{ height }} />;
}

/** admin editor block for the venue card · paste a Google Maps link (short share links too) → check it → Use this spot. No map here. */
export function PinEditor({ pin, set }: { pin: Pin | null; set: (p: Pin | null) => void }) {
  const [paste, setPaste] = useState(''); const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ lat: number; lng: number; name?: string | null } | null>(null); const [bad, setBad] = useState(false);
  const check = async (txt: string) => {
    const t = txt.trim(); setFound(null); setBad(false); if (!t) return;
    const local = parsePin(t); if (local && !/goo\.gl/i.test(t)) { setFound(local); return; }
    setBusy(true);
    try { const r = await fetch('/api/pin?u=' + encodeURIComponent(t)); const j = await r.json(); if (j && typeof j.lat === 'number') setFound(j); else setBad(true); }
    catch { setBad(true); } finally { setBusy(false); }
  };
  return (
    <div className="ef-f vp-edit"><span>📍 EXACT SPOT · where staff should go (optional)</span>
      {pin && !found && <div className="vp-saved"><b>✓ Spot saved</b> <a href={pinOpen(pin)} target="_blank" rel="noreferrer">Check in Google Maps ↗</a> <button type="button" className="lnk sm" onClick={() => set(null)}>remove</button></div>}
      <small className="muted">In Google Maps: drop the pin on the right door → Share → Copy link → paste it here.</small>
      <div className="row" style={{ gap: 8 }}>
        <input value={paste} onChange={(e) => { setPaste(e.target.value); setFound(null); setBad(false); }} onPaste={(e) => { const t = e.clipboardData.getData('text'); setTimeout(() => check(t), 0); }} placeholder={pin ? 'Paste a new Google Maps link to change it' : 'Paste the Google Maps link'} />
        <button type="button" className="abtn sm dark" disabled={busy || !paste.trim()} onClick={() => check(paste)}>{busy ? 'Reading…' : 'Check link'}</button></div>
      {bad && <small className="accent">Couldn’t find a spot in that link. In Google Maps, tap the spot so a red pin shows, then Share → Copy link.</small>}
      {found && <div className="vp-found"><b>Found{found.name ? `: ${found.name}` : ' the spot'}</b>
        <a href={pinOpen(found)} target="_blank" rel="noreferrer">Check it in Google Maps ↗</a>
        <div className="row" style={{ gap: 8 }}><button type="button" className="abtn sm dark" onClick={() => { set({ lat: found.lat, lng: found.lng, label: pin?.label ?? '' }); setFound(null); setPaste(''); }}>Use this spot</button>
          <button type="button" className="abtn sm" onClick={() => { setFound(null); setPaste(''); }}>Cancel</button></div></div>}
      {pin && <input value={pin.label ?? ''} onChange={(e) => set({ ...pin, label: e.target.value })} placeholder="What’s at the spot · e.g. Staff entrance, west side" />}
      {pin && <small className="muted">Staff get a small map + Directions to this spot. Remember to save the venue.</small>}
    </div>
  );
}
