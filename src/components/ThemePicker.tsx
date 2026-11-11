import { useState } from 'react';
import { currentTheme, saveTheme, type Theme } from '../lib/theme';

/** push 78 · Profile / Settings → App colours. Saves when you tap. */
export function ThemePicker({ staffId, fr = false, admin = false }: { staffId: string; fr?: boolean; admin?: boolean }) {
  const [t, setT] = useState<Theme>(currentTheme());
  const pick = (x: Theme) => { setT(x); saveTheme(staffId, x); };
  const opt = (x: Theme, name: string, bg: string, card: string, ink: string) => (
    <button type="button" className={'th-opt' + (t === x ? ' on' : '')} onClick={() => pick(x)} style={{ background: bg, color: ink }}>
      <i style={{ background: card }} /><b>{name}{t === x ? ' ✓' : ''}</b>
    </button>);
  return (
    <div className="th-pick">
      <div className="th-row">{admin && opt('terra', 'Terracotta & Sage', '#EEF0E8', '#3B4A3F', '#2A2A24')}{opt('classic', fr ? 'Classique' : 'Classic', '#F6F2EC', '#FFFFFF', '#1A1714')}{opt('dark', fr ? 'Sombre' : 'Dark', '#121110', '#1E1C1A', '#F1ECE4')}</div>
      <small className="muted">{fr ? 'S’enregistre dès que vous touchez. Ne suit pas le mode sombre du téléphone.' : 'Saves when you tap. Doesn’t follow the phone’s own dark mode.'}</small>
    </div>);
}
