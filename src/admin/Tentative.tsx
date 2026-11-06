import { useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AEvent } from './api';

/** Nov 6 · ⏳ To be confirmed (072): book early; staff see it isn't confirmed. Then It's confirmed / Not happening (messages everyone booked). */
export function TentativeCard({ evs, onChange }: { evs: AEvent[]; onChange: () => void }) {
  const on = evs.some((e) => e.tentative); const [busy, setBusy] = useState(''); const e0 = evs[0];
  const people = evs.flatMap((e) => (e.shifts ?? []).filter((s) => s.status !== 'declined' && !s.attendance && !s.cancelled_at).map((s) => ({ ...s, ev: e })));
  const set = async (v: boolean) => { const { error } = await supabase.from('events').update({ tentative: v }).in('id', evs.map((e) => e.id)); if (error) alert(error.message); onChange(); };
  const tell = async (body: string, shiftOf: (s: (typeof people)[number]) => string | null) => {
    for (const s of people) {
      const { data: conv } = await supabase.rpc('start_conversation', { p_staff: s.staff_id });
      if (conv) await supabase.rpc('send_message', { p_conversation: conv as string, p_body: body, p_topic: 'shift', p_shift: shiftOf(s) });
    }
  };
  const when = new Date(e0.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const confirmIt = async () => {
    if (!confirm(`Tell ${people.length} people that ${e0.title} is confirmed?`)) return; setBusy('go');
    await set(false); await tell(`✓ ${e0.title} is confirmed · ${when}. See you there!`, (s) => s.id); setBusy(''); onChange();
  };
  const cancelIt = async () => {
    if (!confirm(`${e0.title} won't happen: remove ${people.length} people and tell them?`)) return; setBusy('no');
    await tell(`${e0.title} won’t happen. The client cancelled. Your ${when} is free again.`, () => null);
    const started = people.filter((s) => s.punches?.punch_in);
    const ids = people.filter((s) => !s.punches?.punch_in).map((s) => s.id);
    if (ids.length) { const { error } = await supabase.from('shifts').delete().in('id', ids); if (error) alert(error.message); }
    await supabase.from('events').update({ tentative: false }).in('id', evs.map((e) => e.id));
    if (started.length) alert(`${started.length} already started and were kept.`);
    setBusy(''); onChange();
  };
  return (
    <div className={'adm-card tbc-card' + (on ? ' on' : '')}>
      <div className="seg3 tbc-seg"><button className={!on ? 'on' : ''} onClick={() => on && set(false)}>✓ Confirmed</button><button className={on ? 'on tbc' : ''} onClick={() => !on && set(true)}>⏳ To be confirmed</button></div>
      {on ? <>
        <span className="sm">Book people as usual. They see <b>⏳ To be confirmed</b> and <b>Keep the date for G&amp;R</b> instead of Confirm my shift.</span>
        <div className="tbc-ans"><b className="sm">When the client answers</b>
          <div className="row" style={{ gap: 8 }}>
            <button className="abtn ok grow" disabled={!!busy} onClick={confirmIt}>{busy === 'go' ? 'Sending…' : '✓ It’s confirmed'}</button>
            <button className="abtn grow tbc-no" disabled={!!busy} onClick={cancelIt}>{busy === 'no' ? 'Removing…' : '✕ Not happening'}</button></div>
          <span className="muted sm">Confirmed → the {people.length} booked get “It’s confirmed”. Not happening → their shifts are removed and they’re told.</span></div>
      </> : <span className="muted sm">Client not sure yet? Switch to ⏳ To be confirmed and book early.</span>}
    </div>
  );
}
