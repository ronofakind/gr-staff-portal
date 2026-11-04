import { useState } from 'react';
import { addCalendar, defaultCalOs, type MyCal } from '../lib/calendar';
import { Brand } from './Brand';

/**
 * Push 33a/b · centred thank-you pop-up after "Confirm my shift".
 * Not subscribed yet → Add to my calendar (one time) / Skip. Subscribed → "✓ Added to your G&R calendar" / OK.
 * cal === null (calendar not available) → just OK.
 */
export function ConfirmThanks({ name, line, cal, onCal, onClose }: { name: string; line: string; cal: MyCal | null | undefined; onCal: (c: MyCal) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const add = async () => { if (!cal) return; setBusy(true); onCal(await addCalendar(cal, defaultCalOs())); setBusy(false); onClose(); };
  const offer = !!cal && !cal.added_at;
  return (
    <>
      <div className="scrim top" onClick={onClose} />
      <div className="dialog thanks" role="dialog" aria-label="Thanks for confirming">
        <span className="cu-check">✓</span>
        <div className="serif">Thanks for confirming, {name}!</div>
        <p>{line}</p>
        {cal?.added_at && <b className="thanks-added">✓ Added to your <Brand /> calendar</b>}
        <div className="btns">
          {offer ? <>
            <button className="cu-btn" disabled={busy} onClick={add}><CalIcon /> Add to my calendar</button>
            <p>One time only. Every shift you confirm then shows up by itself, and changes update too.</p>
            <button className="cu-skip" onClick={onClose}><span>Skip</span></button>
          </> : <button className="cu-skip ok" onClick={onClose}><span>OK</span></button>}
        </div>
      </div>
    </>
  );
}

export const CalIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
);
