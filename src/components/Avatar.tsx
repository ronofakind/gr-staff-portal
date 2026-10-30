import { initials } from '../lib/format';

export function Avatar({ name, url, size = 44 }: { name: string; url?: string | null; size?: number }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.34) };
  return url
    ? <img src={url} alt={name} className="avatar" style={style} />
    : <div className="avatar" role="img" aria-label={name} style={style}>{initials(name)}</div>;
}

export function PhotoPicker({ name, url, onPick, size = 72 }: { name: string; url?: string | null; onPick: (f: File) => void; size?: number }) {
  return (
    <label className="photo-pick">
      <Avatar name={name} url={url} size={size} />
      <span className="sm">{url ? 'Change photo' : 'Add photo'}</span>
      <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
    </label>
  );
}

/** Full-size photo, tap anywhere or Close to dismiss. */
export function PhotoViewer({ name, url, sub, onClose }: { name: string; url?: string | null; sub?: string; onClose: () => void }) {
  return (
    <div className="photo-view" role="dialog" aria-label={`Photo of ${name}`} onClick={onClose}>
      {url ? <img src={url} alt={name} /> : <div className="photo-view-ini">{initials(name)}</div>}
      <div className="photo-view-n"><b className="serif">{name}</b>{sub && <small>{sub}</small>}</div>
      <button className="photo-view-x" onClick={onClose}>Close</button>
    </div>
  );
}
