import { useEffect, useRef, useState } from 'react';
import type { PinLen } from '../lib/pin';
import { setting } from '../lib/settings';

/** 4 or 6 dots. `shake` wobbles them after a wrong code. */
export function PinDots({ len, filled, shake = false }: { len: number; filled: number; shake?: boolean }) {
  return (
    <div className={'pin-dots' + (shake ? ' shake' : '')} role="img" aria-label={`${filled} of ${len} digits`}>
      {Array.from({ length: len }, (_, i) => <span key={i} className={i < filled ? 'on' : ''} />)}
    </div>
  );
}

/** On-screen number pad (also listens to the keyboard on a computer). */
export function NumPad({ onDigit, onBack, disabled = false }: { onDigit: (d: string) => void; onBack: () => void; disabled?: boolean }) {
  const cb = useRef({ onDigit, onBack, disabled }); cb.current = { onDigit, onBack, disabled };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (cb.current.disabled || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); cb.current.onDigit(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); cb.current.onBack(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="numpad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => d === ''
        ? <span key={i} />
        : <button key={i} type="button" disabled={disabled} aria-label={d === '⌫' ? 'Delete' : d} onClick={() => (d === '⌫' ? onBack() : onDigit(d))}>{d}</button>)}
    </div>
  );
}

/** 4 digits | 6 digits segment. */
export function LenSeg({ len, onLen }: { len: PinLen; onLen: (l: PinLen) => void }) {
  return (
    <div className="seg pin-seg" role="radiogroup" aria-label="Code length">
      {([4, 6] as const).map((l) => <button key={l} type="button" role="radio" aria-checked={len === l} className={len === l ? 'on' : ''} onClick={() => onLen(l)}>{l} digits</button>)}
    </div>
  );
}

/**
 * Choose your code (first sign-in after the email code, after a reset): 4 | 6 segment, dots, pad, then type it again.
 * onSave gets the code; throw from it to show an error and start over.
 */
export function ChooseCode({ initialLen = 6, onSave, title = 'CHOOSE YOUR CODE', sub = 'You’ll use it to sign in.' }: { initialLen?: PinLen; onSave: (code: string, len: PinLen) => Promise<void>; title?: string; sub?: string }) {
  const force6 = setting('signin.code') === 'force6'; // push 32: Settings → Sign-in code (force 6 digits for everyone)
  const [len, setLen] = useState<PinLen>(force6 ? 6 : initialLen);
  const [first, setFirst] = useState<string | null>(null);
  const [v, setV] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [shake, setShake] = useState(false);
  const bad = (msg: string) => { setErr(msg); setShake(true); window.setTimeout(() => setShake(false), 450); };
  const digit = async (d: string) => {
    if (busy || v.length >= len) return;
    const nv = v + d; setV(nv); setErr('');
    if (nv.length < len) return;
    if (first === null) {
      if (/^(\d)\1+$/.test(nv) || '0123456789'.includes(nv) || '9876543210'.includes(nv)) { window.setTimeout(() => { setV(''); bad('Too easy to guess. Try another code.'); }, 150); return; }
      window.setTimeout(() => { setFirst(nv); setV(''); }, 150); return;
    }
    if (nv !== first) { window.setTimeout(() => { setFirst(null); setV(''); bad('The two codes don’t match. Start again.'); }, 150); return; }
    setBusy(true);
    try { await onSave(nv, len); } catch (e) { setFirst(null); setV(''); bad((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="pin-screen">
      <div className="pin-head">
        <span className="pin-kick">{first === null ? title : 'TYPE IT AGAIN'}</span>
        <span className="pin-sub">{first === null ? sub : 'Same code once more, to be sure.'}</span>
      </div>
      {first === null && !force6 && <LenSeg len={len} onLen={(l) => { setLen(l); setV(''); setErr(''); }} />}
      <PinDots len={len} filled={v.length} shake={shake} />
      {err ? <p className="error center-t">{err}</p> : <span className="pin-hint">{first === null ? '6 digits is safer. Avoid 1234 or your birthday.' : busy ? 'Saving…' : ' '}</span>}
      {first !== null && <button type="button" className="pin-link" onClick={() => { setFirst(null); setV(''); }}>Start over</button>}
      <NumPad disabled={busy} onDigit={digit} onBack={() => setV((x) => x.slice(0, -1))} />
    </div>
  );
}
