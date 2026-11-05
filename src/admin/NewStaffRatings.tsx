import { useEffect, useMemo, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { allStaff, addDays, isoDay, dLabel, type AStaff } from './api';
import { loadScoreData, weights, type ScoreData, type Feedback } from './score';
import { tabOf } from './Ranking';
import { StaffProfile } from './StaffProfile';

/** Nov 5 · every rating for new staff (good or bad): gold Needs-you card + fold-away panel on Today. */
export const TAG_LABEL: Record<string, string> = { guests: 'Great with guests', wine: 'Knows wine', bar: 'Knows the bar', fast: 'Fast', team: 'Team player', on_time: 'Ready on time', trays: 'Good on trays', late: 'Late', uniform: 'Uniform / dress off', phone: 'On phone', coaching: 'Needs coaching', slow: 'Slow' };
export const BAD_TAGS = ['late', 'uniform', 'phone', 'coaching', 'slow'];
const SEEN = 'gr_nsr_seen'; const OPEN = 'gr_nsr_open';
const rd = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const wr = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
export type NsrRow = { f: Feedback; s: AStaff; no: number; exp: string | null };

export function useNewStaffRatings(tick = 0) {
  const [d, setD] = useState<ScoreData | null>(null); const [staff, setStaff] = useState<AStaff[]>([]);
  const [seen, setSeen] = useState(() => rd(SEEN) ?? '');
  useEffect(() => { Promise.all([loadScoreData(), allStaff()]).then(([x, s]) => { setD(x); setStaff(s); }); }, [tick]);
  const rows = useMemo<NsrRow[]>(() => {
    if (!d) return [];
    const since = addDays(isoDay(new Date()), -30) + 'T00:00:00Z'; const by = Object.fromEntries(staff.map((s) => [s.id, s])); const W = weights();
    const out: NsrRow[] = [];
    for (const f of d.feedback) {
      if (f.archived_at || f.created_at < since || !f.overall_stars) continue;
      const s = by[f.staff_id]; if (!s || d.priv[s.id]?.veteran) continue;
      const evDate = f.events?.event_date ?? f.created_at.slice(0, 10);
      // shift number at that event = finished shifts before it + 1 (new = the first few)
      const no = d.shifts.filter((x) => x.staff_id === s.id && x.events && x.events.event_date < evDate && !x.attendance && x.punches?.punch_out).length + 1;
      if (no > W.newUnder) continue;
      out.push({ f, s, no, exp: d.priv[s.id]?.experience ?? null });
    }
    return out;
  }, [d, staff]);
  const unseen = rows.filter((r) => r.f.created_at > seen);
  const markSeen = () => { const top = rows[0]?.f.created_at ?? new Date().toISOString(); wr(SEEN, top); setSeen(top); };
  return { rows, unseen, markSeen, staff };
}

const Stars = ({ v }: { v: number }) => <span className="nsr-stars" aria-label={`${v} of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <i key={n} className={n <= v ? 'on' : ''}>★</i>)}</span>;
const AGAIN: Record<string, string> = { yes: 'Yes', maybe: 'Maybe', no: 'No' };
const EXP: Record<string, string> = { JUNIOR: 'Junior', MID: 'Mid', SENIOR: 'Senior' };

export function NewStaffGoldCard({ unseen, onOpen }: { unseen: NsrRow[]; onOpen: () => void }) {
  if (!unseen.length) return null;
  const list = unseen.slice(0, 4).map((r) => `${r.s.full_name.split(' ')[0]} ${r.f.overall_stars}★${r.f.again === 'no' ? ' (want again: No)' : ''}`).join(' · ') + (unseen.length > 4 ? ` · +${unseen.length - 4}` : '');
  return (
    <div className="nsr-gold"><div className="grow"><b>⭐ {unseen.length} new staff rating{unseen.length > 1 ? 's' : ''}</b><span>{list}</span></div>
      <button className="abtn sm dark" onClick={onOpen}>See ratings</button></div>
  );
}

export function NewStaffPanel({ rows, unseen, markSeen, staff, open, setOpen }: ReturnType<typeof useNewStaffRatings> & { open: boolean; setOpen: (v: boolean) => void }) {
  const [f, setF] = useState<'new' | 'all' | 'floor' | 'bar'>(unseen.length ? 'new' : 'all');
  const [prof, setProf] = useState<AStaff | null>(null);
  useEffect(() => { if (!unseen.length && f === 'new') setF('all'); }, [unseen.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const ids = new Set(unseen.map((r) => r.f.id));
  const list = rows.filter((r) => f === 'new' ? ids.has(r.f.id) : f === 'all' ? true : f === 'bar' ? tabOf(r.s) === 'bar' : tabOf(r.s) !== 'bar');
  const tog = () => { setOpen(!open); wr(OPEN, open ? '0' : '1'); };
  return (
    <div className="adm-card nsr" id="nsr">
      <button className="nsr-h" onClick={tog} aria-expanded={open}><span className="serif">New staff ratings</span>{unseen.length > 0 && <span className="nsr-n">{unseen.length} NEW</span>}<span className="grow" /><span className="muted">{open ? '▴' : '▾'}</span></button>
      {open && <>
        <div className="muted sm">Everyone in their first {weights().newUnder} shifts. Newest first · last 30 days.</div>
        <div className="row wrap" style={{ gap: 6 }}>{([['new', `New · ${unseen.length}`], ['all', `All 30 days · ${rows.length}`], ['floor', 'Floor'], ['bar', 'Bar']] as const).map(([k, l]) => <button key={k} className={'abtn sm' + (f === k ? ' dark' : '')} onClick={() => setF(k)}>{l}</button>)}</div>
        {!list.length && <div className="muted sm" style={{ padding: '8px 0' }}>{f === 'new' ? 'Nothing new.' : 'No ratings for new staff yet.'}</div>}
        {list.map(({ f: x, s, no, exp }) => (
          <button key={x.id} className="nsr-row" onClick={() => setProf(s)}>
            <Avatar name={s.full_name} url={s.photo_url} size={38} />
            <div className="grow"><div className="row" style={{ gap: 8 }}><b>{s.full_name}</b><span className="nsr-tag">NEW · shift {no}{exp ? ` · ${EXP[exp] ?? exp}` : ''}</span><span className="grow" /><Stars v={x.overall_stars ?? 0} /></div>
              <small className="muted">{x.by?.full_name?.split(' ')[0] ?? 'Manager'} · {x.events?.title ?? ''}{x.events?.event_date ? ` · ${dLabel(x.events.event_date)}` : ''}{tabOf(s) === 'bar' ? ' · bar' : ''}</small>
              {(x.again || (x.tags ?? []).length > 0) && <small>{x.again && <b className={x.again === 'yes' ? 'okc' : x.again === 'no' ? 'accent' : 'gold'}>Want again: {AGAIN[x.again]}</b>}{x.again && (x.tags ?? []).length ? ' · ' : ''}{(x.tags ?? []).map((t) => TAG_LABEL[t] ?? t).join(' · ')}</small>}
              {x.note && <small className="nsr-note">“{x.note}”</small>}</div>
            <span className="muted sm strong">Profile ›</span>
          </button>))}
        {unseen.length > 0 && <div className="row"><button className="abtn sm dark" onClick={markSeen}>✓ Seen all</button></div>}
      </>}
      {prof && <StaffProfile s={prof} all={staff} onClose={() => setProf(null)} onEdit={() => { window.location.href = `/admin/staff?open=${prof.id}`; }} />}
    </div>
  );
}
export const nsrOpenDefault = () => rd(OPEN) !== '0';
