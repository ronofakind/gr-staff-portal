import { useState } from 'react';
import { currentTheme, saveTheme, type Theme } from '../lib/theme';

/** push 78 · Profile / Settings → App colours. Saves when you tap. */
export function ThemePicker({ staffId, fr = false }: { staffId: string; fr?: boolean }) {
  const [t, setT] = useState<Theme>(currentTheme());
  const pick = (x: Theme) => { setT(x); saveTheme(staffId, x); };
  const opt = (x: Theme, name: string, bg: string, card: string, ink: string) => (
    <button type="button" className={'th-opt' + (t === x ? ' on' : '')} onClick={() => pick(x)} style={{ background: bg, color: ink }}>
      <i style={{ background: card }} /><b>{name}{t === x ? ' ✓' : ''}</b>
    </button>);
  return (
    <div className="th-pick">
      <div className="th-row">{opt('classic', fr ? 'Classique' : 'Classic', '#F6F2EC', '#FFFFFF', '#1A1714')}{opt('dark', fr ? 'Sombre' : 'Dark', '#121110', '#1E1C1A', '#F1ECE4')}</div>
      <small className="muted">{fr ? 'S’enregistre dès que vous touchez. Ne suit pas le mode sombre du téléphone.' : 'Saves when you tap. Doesn’t follow the phone’s own dark mode.'}</small>
    </div>);
}
