import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SwipeSheet } from '../components/SwipeSheet';
import { Avatar } from '../components/Avatar';
import { TeamChat } from '../components/TeamChat';
import { dayTime, saveTeamChat, teamInfo, type TeamInfo, type TeamOnEvent, type TeamWho } from '../lib/teamChat';
import { ap12, roleName } from './api';

/* Push 41 · admin event page "👥 Team chat" card: switch (off by default), who's in it (Everyone · Managers only · Pick),
   opens / closes, Photos, Manager can remove messages. Covers floor + bar rows of the event. Migration 045. */

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Toronto' });
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function TeamChatCard({ eventId }: { eventId: string }) {
  const [info, setInfo] = useState<TeamInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [pick, setPick] = useState(false);
  useEffect(() => { teamInfo(eventId).then(setInfo).catch((e) => { setErr(/team_chat_info/.test(e.message) ? 'Team chat needs migration 045 (apply it in the Supabase SQL editor).' : e.message); setInfo(null); }); }, [eventId]);

  if (info === undefined) return <div className="muted sm">Loading…</div>;
  if (!info) return <p className="error">{err || 'Event not found.'}</p>;
  const save = async (v: Partial<{ enabled: boolean; who: TeamWho; picked: string[]; photos: boolean; managerRemove: boolean }>) => {
    setBusy(true); setErr('');
    try { setInfo(await saveTeamChat(eventId, { enabled: v.enabled ?? info.enabled, who: v.who ?? info.who, picked: v.picked ?? null, photos: v.photos ?? null, managerRemove: v.managerRemove ?? null })); return true; }
    catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  };
  const on = info.enabled;
  const state = !on ? 'Off unless you turn it on' : info.state === 'open' ? `Open now · ${info.n_members} people + you` : info.state === 'before' ? `On · opens ${dayTime(info.opens_at)}` : info.state === 'readonly' ? 'Closed · read only for 7 days' : 'Closed · hidden from staff';
  const Sw = ({ v, onTap, label }: { v: boolean; onTap: () => void; label: string }) => <button className={'switch' + (v ? ' on' : '')} role="switch" aria-checked={v} aria-label={label} disabled={busy} onClick={onTap}><span /></button>;

  return (
    <div className="tc-card">
      <div className="tc-line">
        <span className="grow"><b>👥 Team chat</b><small>{state}</small></span>
        <Sw v={on} label="Team chat" onTap={() => save({ enabled: !on })} />
      </div>
      {on && <>
        <div className="tc-kick">Who’s in it</div>
        <div className="seg">
          {([['everyone', 'Everyone'], ['managers', 'Managers only'], ['pick', 'Pick']] as const).map(([k, l]) => (
            <button key={k} className={info.who === k ? 'on' : ''} disabled={busy} onClick={() => (k === 'pick' ? setPick(true) : save({ who: k }))}>{l}</button>))}
        </div>
        {info.who === 'pick' && <button className="tc-change" onClick={() => setPick(true)}>{info.n_members} {info.n_members === 1 ? 'person' : 'people'} + you · Change ›</button>}
        {info.who === 'managers' && <small className="muted">The lead and anyone also managing, plus you.</small>}
        <div className="tc-kick">Open</div>
        <div className="tc-when">
          <div><small>Opens</small><b>{dayTime(info.opens_at)}</b><span>(day before)</span></div>
          <div><small>Closes</small><b>{dayTime(info.closes_at)}</b><span>(12 h after)</span></div>
        </div>
        <div className="tc-kick">Allowed</div>
        <div className="tc-line"><span className="grow">Photos</span><Sw v={info.photos} label="Photos" onTap={() => save({ photos: !info.photos })} /></div>
        <div className="tc-line"><span className="grow">Manager can remove messages</span><Sw v={info.manager_can_remove} label="Manager can remove messages" onTap={() => save({ managerRemove: !info.manager_can_remove })} /></div>
        <small className="muted">You see everything and can post or remove any message. After closing, everyone can read it for 7 days; nobody can write.</small>
        {info.conversation_id && <Link className="abtn" style={{ alignSelf: 'flex-start' }} to={`/admin/team-chat/${info.anchor}`}>Open the team chat ›</Link>}
      </>}
      {err && <p className="error">{err}</p>}
      <small className="muted">Rides and late notices stay where they are (Getting there, ⏱ Running late). “Message my team” stays a private announcement. The chat is for this event’s team only.</small>
      {pick && info.on_event && <PickSheet info={info} busy={busy} onClose={() => setPick(false)} onSave={async (ids) => { if (await save({ who: 'pick', picked: ids })) setPick(false); }} />}
    </div>
  );
}

/** "Who's in the team chat?" · search, chips All n · <start> group · None, grouped by start time, managers locked in. */
function PickSheet({ info, busy, onClose, onSave }: { info: TeamInfo; busy: boolean; onClose: () => void; onSave: (ids: string[]) => void }) {
  const seen = new Set<string>();
  const people = (info.on_event ?? []).filter((p) => !seen.has(p.id) && seen.add(p.id));
  const locked = (p: TeamOnEvent) => info.managers.includes(p.id);
  const free = people.filter((p) => !locked(p));
  const [sel, setSel] = useState<string[]>(() => (info.who === 'pick' ? (info.picked ?? []).filter((id) => free.some((p) => p.id === id)) : []));
  const [q, setQ] = useState('');
  const starts = [...new Set(free.map((p) => p.start))].sort();
  const mgrs = people.filter(locked);
  const shown = (l: TeamOnEvent[]) => l.filter((p) => !q.trim() || norm(p.name).includes(norm(q.trim())));
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const groupIds = (st: string) => free.filter((p) => p.start === st).map((p) => p.id);
  const groupOn = (st: string) => groupIds(st).every((id) => sel.includes(id));
  const posOf = (p: TeamOnEvent) => { const l = p.detail?.replace(/^bar\s*-\s*/i, '') || roleName(p.code ?? 'W'); return p.dept === 'bar' && !/bar/i.test(l) ? `${l} · bar` : l; };
  const n = mgrs.length + sel.length;
  return (<>
    <div className="scrim" onClick={onClose} />
    <SwipeSheet onClose={onClose} label="Who's in the team chat?" back onBack={onClose}>
      <div className="serif am-title">Who’s in the team chat?</div>
      <input className="as-search" type="search" autoComplete="off" autoCorrect="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name" />
      <div className="tc-chips">
        <button className={sel.length === free.length && free.length ? 'on' : ''} onClick={() => setSel(free.map((p) => p.id))}>All {people.length}</button>
        {starts.map((st) => <button key={st} className={groupOn(st) ? 'on' : ''} onClick={() => setSel((s) => (groupOn(st) ? s.filter((x) => !groupIds(st).includes(x)) : [...new Set([...s, ...groupIds(st)])]))}>{ap12(hm(st))} group</button>)}
        <button className={!sel.length ? 'on' : ''} onClick={() => setSel([])}>None</button>
      </div>
      <div className="as-list">
        {shown(mgrs).map((p) => (
          <div key={p.id} className="as-opt tc-opt">
            <Avatar name={p.name} url={p.photo} size={36} />
            <span className="grow"><b>{p.name}</b><small>{info.lead_ids.includes(p.id) ? 'Manager' : 'Also managing'} · always in</small></span>
            <span className="tc-lock" aria-label="always in">🔒</span>
          </div>))}
        {starts.map((st) => {
          const l = shown(free.filter((p) => p.start === st)); if (!l.length) return null;
          return [<div key={'h' + st} className="tc-grp">{ap12(hm(st))}</div>, ...l.map((p) => {
            const on = sel.includes(p.id);
            return (
              <button key={p.id} className={'as-opt tc-opt' + (on ? ' on' : '')} onClick={() => toggle(p.id)} aria-pressed={on}>
                <Avatar name={p.name} url={p.photo} size={36} />
                <span className="grow"><b>{p.name}</b><small>{posOf(p)}</small></span>
                <span className={'am-ck' + (on ? ' on' : '')} aria-hidden="true">{on ? '✓' : ''}</span>
              </button>);
          })];
        })}
        {!people.length && <div className="muted sm" style={{ padding: 12 }}>No one is booked on this event yet.</div>}
      </div>
      <button className="btn-ink" style={{ height: 52 }} disabled={busy} onClick={() => onSave(sel)}>{busy ? 'Saving…' : `Save · ${n} ${n === 1 ? 'person' : 'people'} + you`}</button>
      <small className="muted" style={{ textAlign: 'center' }}>You’re always in. Managers are always in. People added to the event later are not added by themselves.</small>
    </SwipeSheet>
  </>);
}

/** /admin/team-chat/:id · Ronnie reads, posts, pins and removes any message. */
export function AdminTeamChat() {
  const { id } = useParams(); const [meId, setMeId] = useState<string | null>(null);
  useEffect(() => { supabase.rpc('me').then(({ data }) => setMeId((data as string) ?? null)); }, []);
  return (
    <div className="stack ib-conv">
      <div className="adm-card ib-chat tc-admin">
        {meId && id ? <TeamChat eventId={id} meId={meId} back={`/admin/event/${id}`} /> : <div className="loading" style={{ minHeight: 200 }} />}
      </div>
      <small className="muted">Everyone in the team chat sees what you post here as “Ronnie”. Settings are on the event page.</small>
    </div>
  );
}
