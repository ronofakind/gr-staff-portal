import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SwipeSheet } from '../components/SwipeSheet';

/* Nov 21 2026 · Sections (migration 131). Managers of the event split the team into Passing · Runner · Station · Clean-up (+ other).
   Opened from My team, next to Messages. Staff don't see it yet. Nothing is sent. Saves on every tap. */

type Member = { shift_id: string; staff_id: string; full_name: string; planned_start: string; position: string; section: string | null; station: string | null; runs?: string[] | null;
  svc_role?: string | null; svc_side?: string | null; svc_lead?: string | null };
type SvcRole = { name: string; note: string; custom?: boolean };
/* Nov 23 · migration 133 · Service tab: roles (+ added roles), optional sides, wave lead teams. A role person can also be on a team. */
const DEF_ROLES = ['Wave lead', 'Allergies', 'Kitchen', 'Closer', 'Bread'];
const RCOL: Record<string, string> = { 'Wave lead': '#9B2226', Allergies: '#C26A00', Kitchen: '#2F6FDB', Closer: '#3F7D4E', Bread: '#8A5A2B' };
const rcol = (r: string) => RCOL[r] ?? '#5B544C';
const SIDES = ['Kitchen side', 'Cocktail side'];
const SIDE_ROLES = ['Wave lead', 'Allergies', 'Closer'];
type Station = { name: string; note: string };
const BASE = ['Passing', 'Runner', 'Station', 'Clean-up'];
const COLOR: Record<string, string> = { Passing: '#2F6FDB', Runner: '#7A4FD6', Station: '#B26A00', 'Clean-up': '#3F7D4E' };
const col = (s: string) => COLOR[s] ?? '#5B544C';
const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto' });
const short = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0]; };

export function MgrSections() {
  const { eventId } = useParams();
  const [title, setTitle] = useState(''); const [team, setTeam] = useState<Member[] | null>(null); const [stations, setStations] = useState<Station[]>([]);
  const [extra, setExtra] = useState<string[]>([]); const [err, setErr] = useState('');
  const [one, setOne] = useState<Member | null>(null);            // tap a name
  const [pick, setPick] = useState<string | null>(null);         // + add on a section (tick list)
  const [ticked, setTicked] = useState<Set<string>>(new Set()); const [pickStation, setPickStation] = useState<string | null>(null);
  const [pickRuns, setPickRuns] = useState<string[]>([]);
  const [stEdit, setStEdit] = useState<{ old: string | null; name: string; note: string } | null>(null);
  const [other, setOther] = useState<string | null>(null);
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') === 'service' ? 'service' : 'cocktail';
  const [svcRoles, setSvcRoles] = useState<SvcRole[]>([]); const [sides, setSides] = useState(false);
  const [teamEdit, setTeamEdit] = useState<Member | null>(null); const [teamTicks, setTeamTicks] = useState<Set<string>>(new Set());
  const [rolePick, setRolePick] = useState<string | null>(null);
  const [roleEdit, setRoleEdit] = useState<{ old: string | null; name: string; note: string; def: boolean } | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc('mgr_sections', { p_event: eventId });
    if (error) { setErr(error.message); setTeam([]); return; }
    const d = data as { team: Member[]; stations: Station[]; svc_roles?: SvcRole[]; svc_sides?: boolean };
    setTeam(d.team ?? []); setStations(d.stations ?? []); setSvcRoles(d.svc_roles ?? []); setSides(!!d.svc_sides);
  };
  useEffect(() => {
    supabase.from('events').select('title').eq('id', eventId!).maybeSingle().then(({ data }) => setTitle((data as { title: string } | null)?.title ?? ''));
    load();
  }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sections = useMemo(() => {
    const used = (team ?? []).map((m) => m.section).filter((s): s is string => !!s && !BASE.includes(s));
    return [...BASE, ...Array.from(new Set([...used, ...extra]))];
  }, [team, extra]);

  // runs (migration 132): only for Runner · null = keep, [] = no station, [..] = the stations he runs for
  const set = async (ids: string[], section: string | null, station: string | null = null, runs: string[] | null = null) => {
    setErr('');
    setTeam((t) => (t ?? []).map((m) => (ids.includes(m.shift_id) ? { ...m, section, station: section === 'Station' ? station : null,
      runs: section !== 'Runner' ? [] : runs ?? m.runs ?? [] } : m))); // instant
    const { error } = await supabase.rpc('mgr_set_section', { p_event: eventId, p_shifts: ids, p_section: section, p_station: station, p_runs: section === 'Runner' ? runs : null });
    if (error) setErr(error.message);
    load();
  };
  const saveStation = async () => {
    if (!stEdit) return; setErr('');
    const { data, error } = await supabase.rpc('mgr_station_save', { p_event: eventId, p_name: stEdit.name, p_note: stEdit.note, p_old: stEdit.old });
    if (error) { setErr(error.message); return; }
    setStations((data ?? []) as Station[]); setStEdit(null); load();
  };
  const delStation = async (name: string) => {
    const { data, error } = await supabase.rpc('mgr_station_delete', { p_event: eventId, p_name: name });
    if (error) { setErr(error.message); return; }
    setStations((data ?? []) as Station[]); setStEdit(null); load();
  };

  // Service (migration 133)
  const rpc = async (fn: string, args: Record<string, unknown>) => { setErr(''); const { error } = await supabase.rpc(fn, { p_event: eventId, ...args }); if (error) setErr(error.message); await load(); };
  const setRole = (ids: string[], role: string | null) => {
    setTeam((t) => (t ?? []).map((m) => (ids.includes(m.shift_id) ? { ...m, svc_role: role, svc_lead: role === 'Wave lead' ? null : m.svc_lead } : m)));
    return rpc('mgr_set_svc_role', { p_shifts: ids, p_role: role });
  };
  const setSide = (ids: string[], side: string | null) => { setTeam((t) => (t ?? []).map((m) => (ids.includes(m.shift_id) ? { ...m, svc_side: side } : m))); return rpc('mgr_set_svc_side', { p_shifts: ids, p_side: side }); };
  const setLead = (id: string, lead: string | null) => { setTeam((t) => (t ?? []).map((m) => (m.shift_id === id ? { ...m, svc_lead: lead } : m))); return rpc('mgr_set_lead', { p_shift: id, p_lead: lead }); };
  const saveTeam = (lead: string, members: string[]) => rpc('mgr_set_team', { p_lead: lead, p_members: members });
  const saveRole = async () => {
    if (!roleEdit) return; setErr('');
    const { error } = await supabase.rpc('mgr_svc_role_save', { p_event: eventId, p_name: roleEdit.name, p_note: roleEdit.note, p_old: roleEdit.old });
    if (error) { setErr(error.message); return; }
    setRoleEdit(null); load();
  };
  const delRole = async (name: string) => { const { error } = await supabase.rpc('mgr_svc_role_delete', { p_event: eventId, p_name: name }); if (error) { setErr(error.message); return; } setRoleEdit(null); load(); };

  if (!team) return <div className="loading" />;
  const roles = [...DEF_ROLES, ...svcRoles.filter((r) => r.custom && !DEF_ROLES.includes(r.name)).map((r) => r.name)];
  for (const m of team) if (m.svc_role && !roles.includes(m.svc_role)) roles.push(m.svc_role);
  const noteOf = (r: string) => svcRoles.find((x) => x.name === r)?.note ?? '';
  const leads = team.filter((m) => m.svc_role === 'Wave lead');
  const teamOf = (l: Member) => team.filter((m) => m.svc_lead === l.shift_id);
  const leadOf = (m: Member) => (m.svc_lead ? team.find((x) => x.shift_id === m.svc_lead) ?? null : null);
  const noTeam = team.filter((m) => m.svc_role !== 'Wave lead' && !leadOf(m));
  const openTeam = (l: Member) => { setTeamEdit(l); setTeamTicks(new Set(teamOf(l).map((m) => m.shift_id))); };
  const openRolePick = (r: string) => { setRolePick(r); setTicked(new Set()); };
  const nm = (m: Member, sub?: string | null) => <button key={m.shift_id} className="sec-name" onClick={() => setOne(m)}>{short(m.full_name)}{sub ? <span className="sec-sub"> · {sub}</span> : null}</button>;
  const leadBlock = (l: Member) => (
    <div key={l.shift_id} className="sec-st">
      <div className="sec-h"><button className="sec-lead" onClick={() => setOne(l)}>{l.full_name}</button><span className="muted">team of {teamOf(l).length}</span><span className="grow" />
        <button className="sec-add" onClick={() => openTeam(l)}>Edit team</button></div>
      {teamOf(l).length ? <div className="sec-names">{teamOf(l).map((m) => nm(m, m.svc_role))}</div> : <div className="muted sm">Nobody on the team yet</div>}
    </div>
  );
  const roleCard = (r: string, ppl: Member[], key?: string) => (
    <section key={key ?? r} className="sec-card" style={{ borderLeftColor: rcol(r) }}>
      <div className="sec-h"><b style={{ color: rcol(r) }}>{r}</b><span className="muted">{ppl.length}</span><span className="grow" />
        <button className="sec-add" onClick={() => openRolePick(r)}>+ add</button>
        <button className="sec-edit" onClick={() => setRoleEdit({ old: r, name: r, note: noteOf(r), def: DEF_ROLES.includes(r) })}>Edit</button></div>
      {r === 'Wave lead' ? (ppl.length ? ppl.map(leadBlock) : <div className="muted sm">Nobody yet · add a wave lead, then Edit team</div>)
        : ppl.length ? <div className="sec-names">{ppl.map((m) => nm(m, leadOf(m) ? `${short(leadOf(m)!.full_name)}'s team` : null))}</div> : <div className="muted sm">Nobody yet</div>}
      {noteOf(r) ? <div className="sec-note" onClick={() => setRoleEdit({ old: r, name: r, note: noteOf(r), def: DEF_ROLES.includes(r) })}>{noteOf(r)}</div>
        : <button className="sec-note add" onClick={() => setRoleEdit({ old: r, name: r, note: '', def: DEF_ROLES.includes(r) })}>+ note</button>}
    </section>
  );
  const inRole = (r: string, side?: string | null) => team.filter((m) => m.svc_role === r && (side === undefined || (side === null ? !m.svc_side || !SIDES.includes(m.svc_side) : m.svc_side === side)));
  const serviceView = (
    <>
      <div className="sec-sw"><b>Sides</b><span className="muted sm">Kitchen side / Cocktail side</span><span className="grow" />
        <button className={'sec-toggle' + (sides ? ' on' : '')} aria-label="Sides" onClick={() => { setSides(!sides); rpc('mgr_set_sides', { p_on: !sides }); }}><i /></button></div>
      {!sides ? roles.map((r) => roleCard(r, inRole(r))) : (<>
        {SIDES.map((sd) => (
          <div key={sd} className="sec-side">
            <div className="sec-side-h">{sd.toUpperCase()}</div>
            {SIDE_ROLES.map((r) => roleCard(r, inRole(r, sd), sd + r))}
          </div>
        ))}
        <div className="sec-side">
          <div className="sec-side-h">WHOLE ROOM</div>
          {SIDE_ROLES.filter((r) => inRole(r, null).length).map((r) => roleCard(r, inRole(r, null), 'none' + r))}
          {roles.filter((r) => !SIDE_ROLES.includes(r)).map((r) => roleCard(r, inRole(r)))}
        </div>
      </>)}
      <button className="sec-add" style={{ alignSelf: 'flex-start', marginLeft: 6 }} onClick={() => setRoleEdit({ old: null, name: '', note: '', def: false })}>+ New role</button>
      <section className="sec-card none">
        <div className="sec-h"><b style={{ color: '#B26A00' }}>Not on a team yet</b><span className="muted">{noTeam.length}</span></div>
        {noTeam.length ? <div className="sec-names">{noTeam.map((m) => nm(m, m.svc_role))}</div> : <div className="muted sm">Everyone is on a wave lead's team.</div>}
        <div className="muted sm">Tap a name to give a role or a team.</div>
      </section>
    </>
  );
  const none = team.filter((m) => !m.section);
  const inSec = (s: string) => team.filter((m) => m.section === s);
  const runsOf = (m: Member) => (m.runs ?? []).filter((r) => stations.some((x) => x.name === r));
  const runnersOf = (st: string) => team.filter((m) => m.section === 'Runner' && runsOf(m).includes(st));
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const openPick = (s: string, station: string | null = null) => { setPick(s); setPickStation(station); setPickRuns([]); setTicked(new Set()); };
  const pickList = pick ? [...none, ...team.filter((m) => m.section && !(m.section === pick && (pick !== 'Station' || m.station === pickStation)))] : [];

  return (
    <main className="page v2 sec-page">
      <header className="row" style={{ paddingTop: 12 }}>
        <Link to={`/manage/${eventId}`} className="back" aria-label="Back">‹</Link>
        <span className="kicker">SECTIONS</span><span className="grow" />
        <Link to={`/manage/${eventId}`} className="sec-link">My team ›</Link>
      </header>
      <div className="serif sec-title">{title}</div>
      {err && <p className="error">{err}</p>}
      <div className="sec-tabs">{(['cocktail', 'service'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setSp(t === 'service' ? { tab: 'service' } : {}, { replace: true })}>{t === 'cocktail' ? 'Cocktail' : 'Service'}</button>)}</div>

      {tab === 'service' ? serviceView : (<>
      {sections.map((s) => {
        const ppl = inSec(s);
        return (
          <section key={s} className="sec-card" style={{ borderLeftColor: col(s) }}>
            <div className="sec-h"><b style={{ color: col(s) }}>{s}</b><span className="muted">{ppl.length}</span><span className="grow" />
              {s !== 'Station' && <button className="sec-add" onClick={() => openPick(s)}>+ add</button>}</div>
            {s !== 'Station' ? (
              ppl.length ? <div className="sec-names">{(s === 'Runner' ? [...ppl.filter((m) => !runsOf(m).length), ...ppl.filter((m) => runsOf(m).length)] : ppl).map((m) =>
                <button key={m.shift_id} className="sec-name" onClick={() => setOne(m)}>{short(m.full_name)}{s === 'Runner' && runsOf(m).length ? <span className="sec-runs"> · {runsOf(m).join(', ')}</span> : null}</button>)}</div>
                : <div className="muted sm">Nobody yet</div>
            ) : (
              <>
                {stations.map((st) => {
                  const on = ppl.filter((m) => m.station === st.name);
                  return (
                    <div key={st.name} className="sec-st">
                      <div className="sec-h"><b>{st.name}</b><span className="muted">{on.length}</span><span className="grow" />
                        <button className="sec-add" onClick={() => openPick('Station', st.name)}>+ add</button>
                        <button className="sec-edit" onClick={() => setStEdit({ old: st.name, name: st.name, note: st.note ?? '' })}>Edit</button></div>
                      {on.length ? <div className="sec-names">{on.map((m) => <button key={m.shift_id} className="sec-name" onClick={() => setOne(m)}>{short(m.full_name)}</button>)}</div> : <div className="muted sm">Nobody yet</div>}
                      {runnersOf(st.name).length > 0 && <div className="sec-runline"><b>Runners:</b> {runnersOf(st.name).map((m) => short(m.full_name)).join(', ')}</div>}
                      {st.note ? <div className="sec-note" onClick={() => setStEdit({ old: st.name, name: st.name, note: st.note })}>{st.note}</div>
                        : <button className="sec-note add" onClick={() => setStEdit({ old: st.name, name: st.name, note: '' })}>+ note</button>}
                    </div>
                  );
                })}
                {ppl.filter((m) => !m.station || !stations.some((x) => x.name === m.station)).length > 0 &&
                  <div className="sec-names">{ppl.filter((m) => !m.station || !stations.some((x) => x.name === m.station)).map((m) => <button key={m.shift_id} className="sec-name" onClick={() => setOne(m)}>{short(m.full_name)}</button>)}</div>}
                <button className="sec-add" style={{ alignSelf: 'flex-start' }} onClick={() => setStEdit({ old: null, name: '', note: '' })}>+ New station</button>
              </>
            )}
          </section>
        );
      })}
      <button className="sec-add" style={{ alignSelf: 'flex-start', marginLeft: 6 }} onClick={() => setOther('')}>+ Other section</button>

      <section className="sec-card none">
        <div className="sec-h"><b style={{ color: '#B26A00' }}>No section yet</b><span className="muted">{none.length}</span></div>
        {none.length ? <div className="sec-names">{none.map((m) => <button key={m.shift_id} className="sec-name" onClick={() => setOne(m)}>{short(m.full_name)} <small>{t12(m.planned_start)}</small></button>)}</div>
          : <div className="muted sm">Everyone has a section.</div>}
        <div className="muted sm">Tap a name to give a section.</div>
      </section>
      </>)}

      {one && (<>
        <div className="scrim" onClick={() => setOne(null)} />
        <SwipeSheet onClose={() => setOne(null)} label="Section" x={false}>
          <div className="sec-sheet">
            <b style={{ fontSize: 17 }}>{one.full_name}</b>
            <div className="muted sm">{t12(one.planned_start)} · {one.position}</div>
            <div className="sec-lbl">COCKTAIL</div>
            <div className="sec-grid">
              {sections.map((s) => (
                <button key={s} className={'sec-opt' + (one.section === s ? ' on' : '')} style={{ color: col(s), borderColor: one.section === s ? col(s) : undefined }}
                  onClick={() => {
                    if (s === 'Station') setOne({ ...one, section: 'Station' });
                    else if (s === 'Runner') { if (one.section !== 'Runner') set([one.shift_id], 'Runner', null, []); setOne({ ...one, section: 'Runner', station: null, runs: one.section === 'Runner' ? one.runs : [] }); }
                    else { const v = one.section === s ? null : s; set([one.shift_id], v); setOne({ ...one, section: v, station: null, runs: [] }); }
                  }}>{s}</button>
              ))}
            </div>
            {one.section === 'Station' && (<>
              <div className="sec-lbl">WHICH STATION</div>
              <div className="sec-chips">
                {stations.map((st) => <button key={st.name} className={'sec-chip' + (one.station === st.name ? ' on' : '')} onClick={() => { set([one.shift_id], 'Station', st.name); setOne({ ...one, section: 'Station', station: st.name }); }}>{st.name}</button>)}
                <button className="sec-chip" onClick={() => { setOne(null); setStEdit({ old: null, name: '', note: '' }); }}>+ New station</button>
              </div>
            </>)}
            {one.section === 'Runner' && (<>
              <div className="sec-lbl">RUNS FOR <span className="sec-lbl-sub">optional · one or more</span></div>
              <div className="sec-chips">
                {stations.map((st) => { const on = runsOf(one).includes(st.name); return (
                  <button key={st.name} className={'sec-chip run' + (on ? ' on' : '')} onClick={() => { const r = toggle(runsOf(one), st.name); setOne({ ...one, runs: r }); set([one.shift_id], 'Runner', null, r); }}>{st.name}</button>); })}
                <button className="sec-chip" onClick={() => { setOne(null); setStEdit({ old: null, name: '', note: '' }); }}>+ New station</button>
              </div>
              {!stations.length && <div className="muted sm">No stations yet tonight. Add one first.</div>}
            </>)}
            <div className="sec-lbl">SERVICE</div>
            <div className="sec-chips">
              {roles.map((r) => <button key={r} className={'sec-chip' + (one.svc_role === r ? ' on' : '')} style={one.svc_role === r ? { borderColor: rcol(r), color: rcol(r), background: rcol(r) + '14' } : undefined}
                onClick={() => { const v = one.svc_role === r ? null : r; setRole([one.shift_id], v); setOne({ ...one, svc_role: v, svc_lead: v === 'Wave lead' ? null : one.svc_lead }); }}>{r}</button>)}
              <button className="sec-chip" onClick={() => { setOne(null); setRoleEdit({ old: null, name: '', note: '', def: false }); }}>+ New role</button>
            </div>
            {sides && (<>
              <div className="sec-lbl">SIDE</div>
              <div className="sec-chips">{SIDES.map((sd) => <button key={sd} className={'sec-chip' + (one.svc_side === sd ? ' on' : '')} onClick={() => { const v = one.svc_side === sd ? null : sd; setSide([one.shift_id], v); setOne({ ...one, svc_side: v }); }}>{sd}</button>)}</div>
            </>)}
            {one.svc_role === 'Wave lead'
              ? <button className="sec-chip" style={{ alignSelf: 'flex-start' }} onClick={() => { const l = one; setOne(null); openTeam(l); }}>Edit team · {teamOf(one).length}</button>
              : leads.length > 0 && (<>
                <div className="sec-lbl">TEAM <span className="sec-lbl-sub">which wave lead</span></div>
                <div className="sec-chips">{leads.map((l) => <button key={l.shift_id} className={'sec-chip' + (one.svc_lead === l.shift_id ? ' on' : '')} onClick={() => { const v = one.svc_lead === l.shift_id ? null : l.shift_id; setLead(one.shift_id, v); setOne({ ...one, svc_lead: v, svc_side: v ? l.svc_side ?? one.svc_side : one.svc_side }); }}>{short(l.full_name)}</button>)}</div>
              </>)}
            <div className="sec-acts">
              {tab === 'cocktail' && one.section && <button className="sec-clear" onClick={() => { set([one.shift_id], null); setOne(null); }}>No section</button>}
              <button className="sec-done" onClick={() => setOne(null)}>Done</button>
            </div>
          </div>
        </SwipeSheet>
      </>)}

      {pick && (<>
        <div className="scrim" onClick={() => setPick(null)} />
        <SwipeSheet onClose={() => setPick(null)} label="Add people" x={false}>
          <div className="sec-sheet">
            <b style={{ fontSize: 17, color: col(pick) }}>{pick === 'Station' ? `Station · ${pickStation}` : pick}</b>
            <div className="muted sm">Tick the people to add · no section yet first</div>
            <div className="sec-ticks">
              {pickList.map((m) => (
                <label key={m.shift_id} className="sec-tick">
                  <input type="checkbox" checked={ticked.has(m.shift_id)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(m.shift_id); else n.delete(m.shift_id); setTicked(n); }} />
                  <span className="grow">{m.full_name}</span>
                  <small className="muted">{m.section ? (m.section === 'Station' && m.station ? m.station : m.section === 'Runner' && runsOf(m).length ? `Runner · ${runsOf(m).join(', ')}` : m.section) : t12(m.planned_start)}</small>
                </label>
              ))}
            </div>
            {pick === 'Runner' && stations.length > 0 && (<>
              <div className="sec-lbl">RUN FOR <span className="sec-lbl-sub">optional · one or more · for everyone ticked</span></div>
              <div className="sec-chips">{stations.map((st) => <button key={st.name} className={'sec-chip run' + (pickRuns.includes(st.name) ? ' on' : '')} onClick={() => setPickRuns(toggle(pickRuns, st.name))}>{st.name}</button>)}</div>
            </>)}
            <button className="btn-ink" disabled={!ticked.size} onClick={() => { set([...ticked], pick, pickStation, pick === 'Runner' ? pickRuns : null); setPick(null); }}>
              Add {ticked.size || ''}{pick === 'Runner' && pickRuns.length ? ` to Runner · ${pickRuns.join(', ')}` : ''}</button>
          </div>
        </SwipeSheet>
      </>)}

      {stEdit && (<>
        <div className="scrim" onClick={() => setStEdit(null)} />
        <SwipeSheet onClose={() => setStEdit(null)} label="Station" x={false}>
          <div className="sec-sheet">
            <b style={{ fontSize: 17 }}>{stEdit.old ? 'Station' : 'New station'}</b>
            <div className="sec-lbl">NAME</div>
            <input className="sec-in" value={stEdit.name} maxLength={40} placeholder="e.g. Raw bar" onChange={(e) => setStEdit({ ...stEdit, name: e.target.value })} />
            {!stEdit.old && <div className="sec-chips">{['Raw bar', 'Pasta', 'Carving', 'Dessert', 'Cheese'].filter((x) => !stations.some((s) => s.name === x)).map((x) => <button key={x} className="sec-chip" onClick={() => setStEdit({ ...stEdit, name: x })}>{x}</button>)}</div>}
            <div className="sec-lbl">NOTE (optional)</div>
            <textarea className="sec-in" rows={3} maxLength={500} value={stEdit.note} placeholder="e.g. what goes where, timing, what to bring" onChange={(e) => setStEdit({ ...stEdit, note: e.target.value })} />
            <div className="row" style={{ gap: 8 }}>
              {stEdit.old && <button className="light-btn" style={{ flex: 1, color: '#9B2226' }} onClick={() => delStation(stEdit.old!)}>Delete</button>}
              <button className="btn-ink" style={{ flex: 2 }} disabled={!stEdit.name.trim()} onClick={saveStation}>{stEdit.old ? 'Save' : 'Add station'}</button>
            </div>
          </div>
        </SwipeSheet>
      </>)}

      {other !== null && (<>
        <div className="scrim" onClick={() => setOther(null)} />
        <SwipeSheet onClose={() => setOther(null)} label="Other section" x={false}>
          <div className="sec-sheet">
            <b style={{ fontSize: 17 }}>Other section</b>
            <input className="sec-in" value={other} maxLength={40} placeholder="e.g. Set-up, Coat check" onChange={(e) => setOther(e.target.value)} />
            <button className="btn-ink" disabled={!other.trim() || sections.includes(other.trim())} onClick={() => { setExtra((x) => [...x, other.trim()]); setOther(null); }}>Add section</button>
          </div>
        </SwipeSheet>
      </>)}
      {teamEdit && (<>
        <div className="scrim" onClick={() => setTeamEdit(null)} />
        <SwipeSheet onClose={() => setTeamEdit(null)} label="Team" x={false}>
          <div className="sec-sheet">
            <b style={{ fontSize: 17 }}>{short(teamEdit.full_name)} · team</b>
            <div className="muted sm">Wave lead · tick who follows {teamEdit.full_name.split(' ')[0]}. Ticking someone from another team moves them.</div>
            <div className="sec-ticks">
              {[...team.filter((m) => m.svc_lead === teamEdit.shift_id), ...team.filter((m) => m.svc_role !== 'Wave lead' && !leadOf(m)), ...team.filter((m) => m.svc_role !== 'Wave lead' && leadOf(m) && m.svc_lead !== teamEdit.shift_id)].map((m) => (
                <label key={m.shift_id} className="sec-tick">
                  <input type="checkbox" checked={teamTicks.has(m.shift_id)} onChange={(e) => { const n = new Set(teamTicks); if (e.target.checked) n.add(m.shift_id); else n.delete(m.shift_id); setTeamTicks(n); }} />
                  <span className="grow">{m.full_name}</span>
                  <small className="muted">{[m.svc_role, m.svc_lead === teamEdit.shift_id ? null : leadOf(m) ? `with ${short(leadOf(m)!.full_name)}` : 'free'].filter(Boolean).join(' · ')}</small>
                </label>
              ))}
            </div>
            <button className="btn-ink" onClick={() => { saveTeam(teamEdit.shift_id, [...teamTicks]); setTeamEdit(null); }}>Save team · {teamTicks.size}</button>
          </div>
        </SwipeSheet>
      </>)}

      {rolePick && (<>
        <div className="scrim" onClick={() => setRolePick(null)} />
        <SwipeSheet onClose={() => setRolePick(null)} label="Add people" x={false}>
          <div className="sec-sheet">
            <b style={{ fontSize: 17, color: rcol(rolePick) }}>{rolePick}</b>
            <div className="muted sm">Tick the people to add · no role yet first</div>
            <div className="sec-ticks">
              {[...team.filter((m) => !m.svc_role), ...team.filter((m) => m.svc_role && m.svc_role !== rolePick)].map((m) => (
                <label key={m.shift_id} className="sec-tick">
                  <input type="checkbox" checked={ticked.has(m.shift_id)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(m.shift_id); else n.delete(m.shift_id); setTicked(n); }} />
                  <span className="grow">{m.full_name}</span>
                  <small className="muted">{m.svc_role ?? t12(m.planned_start)}</small>
                </label>
              ))}
            </div>
            <button className="btn-ink" disabled={!ticked.size} onClick={() => { setRole([...ticked], rolePick); setRolePick(null); }}>Add {ticked.size || ''}</button>
          </div>
        </SwipeSheet>
      </>)}

      {roleEdit && (<>
        <div className="scrim" onClick={() => setRoleEdit(null)} />
        <SwipeSheet onClose={() => setRoleEdit(null)} label="Role" x={false}>
          <div className="sec-sheet">
            <b style={{ fontSize: 17 }}>{roleEdit.old ? roleEdit.old : 'New role'}</b>
            {!roleEdit.def && (<>
              <div className="sec-lbl">NAME</div>
              <input className="sec-in" value={roleEdit.name} maxLength={40} placeholder="e.g. Wine, Water" onChange={(e) => setRoleEdit({ ...roleEdit, name: e.target.value })} />
              {!roleEdit.old && <div className="sec-chips">{['Wine', 'Water', 'Runner', 'Coffee'].filter((x) => !roles.includes(x)).map((x) => <button key={x} className="sec-chip" onClick={() => setRoleEdit({ ...roleEdit, name: x })}>{x}</button>)}</div>}
            </>)}
            <div className="sec-lbl">NOTE (optional)</div>
            <textarea className="sec-in" rows={3} maxLength={500} value={roleEdit.note} placeholder="e.g. allergy tables, timing, what to bring" onChange={(e) => setRoleEdit({ ...roleEdit, note: e.target.value })} />
            <div className="row" style={{ gap: 8 }}>
              {roleEdit.old && !roleEdit.def && <button className="light-btn" style={{ flex: 1, color: '#9B2226' }} onClick={() => delRole(roleEdit.old!)}>Delete</button>}
              <button className="btn-ink" style={{ flex: 2 }} disabled={!roleEdit.name.trim()} onClick={saveRole}>{roleEdit.old ? 'Save' : 'Add role'}</button>
            </div>
          </div>
        </SwipeSheet>
      </>)}
    </main>
  );
}
