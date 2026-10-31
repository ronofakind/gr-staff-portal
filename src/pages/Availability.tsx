import { useEffect, useState } from 'react';
import { supabase, type Staff } from '../lib/supabase';
import { TabBar } from '../components/TabBar';
import { todayIso } from './Home';
import { SwipeSheet } from '../components/SwipeSheet';
import { useUsualWeek, UsualWeekList, DAYS } from '../components/UsualWeek';
import { AskCards, useAsks, ampm } from '../components/AskCards';
export { ampm };

type Off = { id: string; from_date: string; to_date: string; reason: string | null };

const D = (iso: string) => new Date(iso + 'T12:00:00');

/** Staff: answer availability asks, set the usual week, add days off. */
export function Availability({ me, preview = false }: { me: Staff; preview?: boolean }) {
  const { asks, reload: reloadAsks } = useAsks(me.id);
  const { week, setDay, err: wkErr } = useUsualWeek(me.id, preview); // push 31: shared with the profile check-up (step 5)
  const [off, setOff] = useState<Off[]>([]);
  const [adding, setAdding] = useState(false);
  const [nOff, setNOff] = useState({ from: '', to: '', reason: '' });
  const [err, setErr] = useState('');
  const today = todayIso();

  const load = () => supabase.from('days_off').select('id,from_date,to_date,reason').eq('staff_id', me.id).gte('to_date', today).order('from_date')
    .then((o) => setOff((o.data ?? []) as Off[]));
  useEffect(() => { load(); }, [me.id]);
  const addOff = async () => {
    if (preview || !nOff.from) return;
    setErr('');
    const { error } = await supabase.from('days_off').insert({ staff_id: me.id, from_date: nOff.from, to_date: nOff.to || nOff.from, reason: nOff.reason.trim() || null });
    if (error) { setErr(error.message.includes('booked') ? "You're booked on one of these days. Talk to Ronnie." : error.message); return; }
    setAdding(false); setNOff({ from: '', to: '', reason: '' }); load();
  };
  const delOff = async (id: string) => { if (preview) return; await supabase.from('days_off').delete().eq('id', id); load(); };

  const waiting = (asks ?? []).filter((a) => a.status === 'asked');
  const freeDays = DAYS.filter((_, d) => week[d] && week[d].status !== 'no').length;
  const comingOff = off.filter((o) => o.to_date >= today).length;
  const short = (iso: string) => D(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');

  return (
    <main className="page v2">
      <div style={{ padding: '18px 6px 0' }}>
        <div className="kicker">Availability</div>
        <div className="serif" style={{ fontSize: 30, lineHeight: 1.05 }}>Are you available?</div>
      </div>
      <div className="sumbar">
        <div className={waiting.length ? 'red' : ''}><b>{waiting.length}</b><span>date{waiting.length === 1 ? '' : 's'} waiting</span></div>
        <div><b>{freeDays}</b><span>usual days free</span></div>
        <div><b>{comingOff}</b><span>day{comingOff === 1 ? '' : 's'} off coming</span></div>
      </div>
      {(err || wkErr) && <p className="error">{err || wkErr}</p>}

      <AskCards asks={asks} week={week} preview={preview} onAnswered={reloadAsks} />

      <div className="sec-head"><span className="serif">My usual week</span></div>
      <UsualWeekList week={week} setDay={setDay} />
      <p className="muted sm" style={{ margin: '-6px 6px 0' }}>Green = you can usually work that day. Tap the time to change when you can start. Ronnie only asks you for days you’re usually free.</p>

      <div className="sec-head"><span className="serif">Days off</span><button className="days-off-btn" onClick={() => setAdding(true)}>+ Add dates</button></div>
      <section className="stack" style={{ gap: 8 }}>
        {off.map((o) => (
          <div key={o.id} className="dayoff-card">
            <div className="grow"><small>DAY OFF · {(o.from_date === o.to_date ? short(o.from_date) : `${short(o.from_date)} – ${short(o.to_date)}`).toUpperCase()}</small><div className="serif">{o.reason || 'Day off'}</div></div>
            <button className="link-btn" style={{ color: 'var(--accent)' }} onClick={() => delOff(o.id)}>Remove</button>
          </div>
        ))}
        {!off.length && <div className="card muted sm">No days off added.</div>}
        <p className="muted sm" style={{ margin: '2px 6px' }}>Days off win over your usual week. You can also add them from the Schedule calendar.</p>
      </section>
      <div style={{ height: 90 }} />

      {adding && (
        <>
          <div className="scrim" onClick={() => setAdding(false)} />
          <SwipeSheet onClose={() => setAdding(false)} label="Add days off">
            <div className="serif" style={{ fontSize: 24 }}>Add days off</div>
            <div className="times-box">
              <label>From<input type="date" min={today} value={nOff.from} onChange={(e) => setNOff({ ...nOff, from: e.target.value })} /></label>
              <label>Until<input type="date" min={nOff.from || today} value={nOff.to} onChange={(e) => setNOff({ ...nOff, to: e.target.value })} /></label>
              <label>Reason<input placeholder="Optional" value={nOff.reason} onChange={(e) => setNOff({ ...nOff, reason: e.target.value })} /></label>
            </div>
            {err && <p className="error">{err}</p>}
            <button className="big-btn dark" disabled={!nOff.from} onClick={addOff}>Save days off</button>
          </SwipeSheet>
        </>
      )}
      <TabBar badge={waiting.length} />
    </main>
  );
}
