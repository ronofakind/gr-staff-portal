import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

/** Nov 26 · staff skill tags (staff_private.skill_tags, migration 078). Admin only: never shown on staff or MD screens. */
export const SKILL_GROUPS: [string, [string, string][]][] = [
  ['FLOOR', [['canapes', 'Canapés'], ['champagne', 'Champagne'], ['wine', 'Wine'], ['plated', 'Plated'], ['buffet', 'Buffet'], ['coffee', 'Coffee'], ['head_table', 'Head table'], ['fast', 'Fast'], ['guests', 'Great with guests'], ['setup', 'Set-up'], ['private_house', 'Private house'], ['2ic', '2IC']]],
  ['BAR', [['bar_bt', 'Bartender'], ['bar_bb', 'Barback'], ['cocktails', 'Cocktails'], ['volume', 'Volume'], ['restock', 'Restock'], ['step_up', 'Step up']]],
  ['OTHER', [['bilingual', 'Bilingual'], ['car', 'Car']]],
];
const LABEL: Record<string, string> = Object.fromEntries(SKILL_GROUPS.flatMap(([, l]) => l));
const ORDER = SKILL_GROUPS.flatMap(([, l]) => l.map(([k]) => k));
export const skillLabel = (k: string) => LABEL[k] ?? k.replace(/_/g, ' ');
export const sortSkills = (t: string[]) => [...t].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));

/** One short line for lists (Staff, Tiers & ranking). Full list on hover. */
export function SkillLine({ tags }: { tags?: string[] | null }) {
  if (!tags?.length) return null;
  const t = sortSkills(tags).map(skillLabel).join(' · ');
  return <small className="sk-line" title={t}>{t}</small>;
}

export function TagsCard({ staffId }: { staffId: string }) {
  const [tags, setTags] = useState<string[] | null>(null); const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { setTags(null); supabase.from('staff_private').select('skill_tags').eq('staff_id', staffId).maybeSingle().then(({ data }) => setTags(((data as { skill_tags?: string[] } | null)?.skill_tags) ?? [])); }, [staffId]);
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, [open]);
  const save = async (next: string[]) => {
    const prev = tags; setTags(next); setErr('');
    const { error } = await supabase.from('staff_private').upsert({ staff_id: staffId, skill_tags: next, tags_set_at: new Date().toISOString() });
    if (error) { setTags(prev); setErr(error.message); }
  };
  const toggle = (k: string) => { if (!tags) return; void save(tags.includes(k) ? tags.filter((x) => x !== k) : [...tags, k]); };
  const ql = q.trim().toLowerCase();
  return (
    <div className="pcard">
      <div className="sp2-ch"><b className="serif">Tags</b></div>
      {tags === null ? <span className="muted sm">Loading…</span> :
        <div className="sk-wrap" ref={box}>
          {sortSkills(tags).map((k) => <span key={k} className="sk-on">{skillLabel(k)}<button type="button" aria-label={`Remove ${skillLabel(k)}`} onClick={() => toggle(k)}>×</button></span>)}
          <button type="button" className="sk-add" onClick={() => { setOpen(!open); setQ(''); }}>+ Tag</button>
          {open && <div className="sk-pop">
            <input autoFocus value={q} placeholder="Find a tag" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
            {SKILL_GROUPS.map(([g, list]) => { const l = list.filter(([, n]) => !ql || n.toLowerCase().includes(ql)); return l.length ? <div key={g} className="sk-grp"><span>{g}</span><div>
              {l.map(([k, n]) => <button key={k} type="button" className={tags.includes(k) ? 'on' : ''} onClick={() => toggle(k)}>{n}</button>)}</div></div> : null; })}
          </div>}
        </div>}
      {err && <small className="error">{err}</small>}
    </div>
  );
}
