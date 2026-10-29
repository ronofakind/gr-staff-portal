import { useEffect, useRef, useState } from 'react';

/** Address parts filled from a Google pick. */
export type AddressParts = { formatted: string; street: string; unit: string; city: string; province: string; postal_code: string };

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
type G = { maps: { importLibrary: (n: string) => Promise<Record<string, unknown>> } };
let loading: Promise<Record<string, unknown> | null> | null = null;

/** Load the Maps JS API once and return the Places library (or null if there's no key / it fails). */
function places() {
  if (!KEY) return Promise.resolve(null);
  loading ??= new Promise((resolve) => {
    const w = window as unknown as { google?: G; __grMapsReady?: () => void };
    const done = () => w.google!.maps.importLibrary('places').then(resolve, () => resolve(null));
    if (w.google?.maps?.importLibrary) { done(); return; }
    w.__grMapsReady = done;
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY)}&loading=async&libraries=places&callback=__grMapsReady`;
    s.async = true; s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return loading;
}

type Sugg = { text: string; sub: string; pred: { toPlace: () => { fetchFields: (o: { fields: string[] }) => Promise<unknown>; formattedAddress?: string; addressComponents?: { types: string[]; longText: string; shortText: string }[] } } };
const MTL = { center: { lat: 45.5019, lng: -73.5674 }, radius: 40000 };

/**
 * Address field with Google Places suggestions (Canada, biased to Montréal).
 * Works as a plain text field when there's no key or Google fails.
 */
export function AddressInput({ value, onChange, onPick, placeholder, className }: {
  value: string; onChange: (v: string) => void; onPick?: (p: AddressParts) => void; placeholder?: string; className?: string;
}) {
  const [list, setList] = useState<Sugg[]>([]); const [open, setOpen] = useState(false); const [hi, setHi] = useState(0);
  const lib = useRef<Record<string, unknown> | null>(null); const token = useRef<unknown>(null); const timer = useRef<number>();
  const typed = useRef(false);

  useEffect(() => { places().then((l) => { lib.current = l; }); }, []);

  useEffect(() => {
    if (!typed.current) return;
    window.clearTimeout(timer.current);
    if (value.trim().length < 3) { setList([]); return; }
    timer.current = window.setTimeout(async () => {
      const L = lib.current as { AutocompleteSuggestion?: { fetchAutocompleteSuggestions: (r: object) => Promise<{ suggestions: { placePrediction: { text: { text: string }; mainText?: { text: string }; secondaryText?: { text: string }; toPlace: Sugg['pred']['toPlace'] } }[] }> }; AutocompleteSessionToken?: new () => unknown } | null;
      if (!L?.AutocompleteSuggestion) return;
      try {
        token.current ??= L.AutocompleteSessionToken ? new L.AutocompleteSessionToken() : null;
        const { suggestions } = await L.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value, sessionToken: token.current, includedRegionCodes: ['ca'], locationBias: MTL, language: 'fr-CA',
        });
        setList(suggestions.filter((s) => s.placePrediction).slice(0, 5).map((s) => ({
          text: s.placePrediction.mainText?.text ?? s.placePrediction.text.text, sub: s.placePrediction.secondaryText?.text ?? '', pred: s.placePrediction,
        })));
        setOpen(true); setHi(0);
      } catch { setList([]); }
    }, 250);
    return () => window.clearTimeout(timer.current);
  }, [value]);

  const pick = async (s: Sugg) => {
    setOpen(false); setList([]); typed.current = false;
    try {
      const pl = s.pred.toPlace();
      await pl.fetchFields({ fields: ['formattedAddress', 'addressComponents'] });
      token.current = null; // one session per address entry
      const c = (t: string, short = false) => { const x = pl.addressComponents?.find((a) => a.types.includes(t)); return x ? (short ? x.shortText : x.longText) : ''; };
      const street = [c('street_number'), c('route')].filter(Boolean).join(' ');
      const parts: AddressParts = {
        formatted: (pl.formattedAddress ?? `${s.text}, ${s.sub}`).replace(/, Canada$/, ''),
        street: street || s.text, unit: c('subpremise'), city: c('locality') || c('sublocality') || c('administrative_area_level_3'),
        province: c('administrative_area_level_1', true), postal_code: c('postal_code'),
      };
      onChange(parts.formatted); onPick?.(parts);
    } catch { onChange(`${s.text}, ${s.sub}`); }
  };

  return (
    <div className="addr" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input className={className} value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onFocus={() => list.length && setOpen(true)}
        onKeyDown={(e) => {
          if (!open || !list.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(hi + 1, list.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hi - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); pick(list[hi]); }
          if (e.key === 'Escape') setOpen(false);
        }} />
      {open && list.length > 0 && (
        <div className="addr-list" role="listbox">
          {list.map((s, k) => (
            <button type="button" key={k} role="option" aria-selected={k === hi} className={'addr-opt' + (k === hi ? ' hi' : '')} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}>
              <b>{s.text}</b><small>{s.sub}</small>
            </button>
          ))}
          <div className="addr-google">powered by Google</div>
        </div>
      )}
    </div>
  );
}
