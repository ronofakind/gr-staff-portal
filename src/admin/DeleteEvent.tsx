import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/** Delete an event (floor + bar parts of the same date and title). Blocked once hours are recorded. Staff are not messaged. */
export function DeleteEvent({ id }: { id: string }) {
  const nav = useNavigate();
  const [step, setStep] = useState<null | { ids: string[]; title: string; date: string; people: number; hours: number }>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ask = async () => {
    setErr('');
    const { data: one } = await supabase.from('events').select('event_date,title').eq('id', id).single();
    if (!one) return;
    const { data: evs } = await supabase.from('events').select('id,shifts(id,status,punches(punch_in))').eq('event_date', one.event_date).eq('title', one.title);
    const list = (evs ?? []) as unknown as { id: string; shifts: { id: string; status: string; punches: { punch_in: string | null } | { punch_in: string | null }[] | null }[] }[];
    const shifts = list.flatMap((e) => e.shifts);
    const hours = shifts.filter((s) => [s.punches].flat().some((p) => p?.punch_in)).length;
    setStep({ ids: list.map((e) => e.id), title: one.title, date: one.event_date, people: shifts.filter((s) => s.status !== 'declined').length, hours });
  };
  const go = async () => {
    if (!step) return; setBusy(true);
    const { error } = await supabase.from('events').delete().in('id', step.ids);
    setBusy(false);
    if (error) return setErr(error.message);
    nav(`/admin/day?d=${step.date}`);
  };
  if (!step) return <button type="button" className="abtn danger" onClick={ask}>Delete event</button>;
  return (
    <div className="del-ev">
      {step.hours > 0
        ? <><b>Can’t delete · {step.hours} {step.hours === 1 ? 'person has' : 'people have'} hours recorded</b><span className="muted sm">Mark them cancelled first, or keep the event for payroll.</span>
            <button type="button" className="abtn" onClick={() => setStep(null)}>OK</button></>
        : <><b>Delete {step.title}?</b>
            <span className="muted sm">{step.people ? `${step.people} booked staff will be taken off (they are not messaged). ` : ''}The Drive folder stays. This can’t be undone.</span>
            {err && <span className="error sm">{err}</span>}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="abtn" onClick={() => setStep(null)}>Keep it</button>
              <button type="button" className="abtn danger-fill" disabled={busy} onClick={go}>{busy ? 'Deleting…' : 'Delete'}</button>
            </div></>}
    </div>
  );
}
