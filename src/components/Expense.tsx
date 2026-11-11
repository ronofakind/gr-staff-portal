// push 79 · Staff add their own expenses (migration 104). Only people Ronnie switches on:
// always on → floating + on Home and "+ Expense" on past shifts · one shift → quiet "shift is done" card for 2 days.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type Access = { always: boolean; shifts: { shift_id: string; until: string; title: string; date: string }[] };
export type MyExp = { id: string; kind: string; amount: number; exp_date: string; status: 'waiting' | 'approved' | 'declined'; reason: string | null; shift_id: string | null };
type Recent = { id: string; title: string; date: string };

const KINDS: [string, string, string][] = [['parking', 'Parking', 'Stationnement'], ['uber', 'Uber', 'Uber'], ['gas', 'Gas', 'Essence'], ['other', 'Other', 'Autre']];
const kindL = (k: string, fr = false) => { const x = KINDS.find((y) => y[0] === k); return x ? (fr ? x[2] : x[1]) : k; };
const dl = (d: string, fr = false) => new Date(d + 'T12:00:00').toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { weekday: 'short', month: 'short', day: 'numeric' }).replace(/\./g, '');

export function useExpenseAccess(tick = 0, off = false) {
  const [a, setA] = useState<Access>({ always: false, shifts: [] });
  useEffect(() => { if (off) return; supabase.rpc('my_expense_access').then(({ data, error }) => { if (!error && data) setA(data as Access); }); }, [tick, off]);
  return a;
}

/** Bottom sheet: kind → shift (or not for an event) → photo → amount. */
export function ExpenseSheet({ me, fixedShift, always, fr = false, onClose, onSent }: { me: string; fixedShift?: Recent | null; always: boolean; fr?: boolean; onClose: () => void; onSent: () => void }) {
  const [kind, setKind] = useState(''); const [amt, setAmt] = useState(''); const [file, setFile] = useState<File | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]); const [shift, setShift] = useState<string>(fixedShift?.id ?? '');
  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })); const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    if (fixedShift) return;
    const from = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10); const to = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
    supabase.from('shifts').select('id,status,events!inner(title,event_date)').eq('staff_id', me).neq('status', 'declined').gte('events.event_date', from).lte('events.event_date', to)
      .then(({ data }) => { const r = ((data ?? []) as unknown as { id: string; events: { title: string; event_date: string } }[]).map((s) => ({ id: s.id, title: s.events.title, date: s.events.event_date })).sort((a, b) => b.date.localeCompare(a.date));
        setRecent(r); if (r[0]) setShift(r[0].id); });
  }, [me, fixedShift]);
  const send = async () => {
    setErr('');
    const n = Number(amt.replace(',', '.'));
    if (!kind) return setErr(fr ? 'Choisissez le type.' : 'Pick what it was for.');
    if (!file) return setErr(fr ? 'Ajoutez une photo du reçu.' : 'Add a photo or screenshot of the receipt.');
    if (!(n > 0)) return setErr(fr ? 'Entrez le montant.' : 'Type the amount.');
    setBusy(true);
    try {
      const path = `${me}/${crypto.randomUUID()}.${(file.name.split('.').pop() || 'jpg').toLowerCase()}`;
      const up = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type || 'image/jpeg' });
      if (up.error) throw up.error;
      const { error } = await supabase.rpc('add_expense', { p_kind: kind, p_amount: n, p_shift: shift || null, p_date: shift ? null : date, p_receipt: path, p_note: note.trim() || null });
      if (error) throw error;
      onSent();
    } catch (e) { setErr((e as Error).message || (fr ? 'Erreur. Réessayez.' : 'Could not send. Try again.')); }
    setBusy(false);
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet exp-sheet" role="dialog" aria-label="Add an expense">
        <button className="sheet-x" aria-label="Close" onClick={onClose}>✕</button>
        <b className="h2">{fr ? 'Ajouter une dépense' : 'Add an expense'}</b>
        <div className="exp-kinds">{KINDS.map(([k, en, f]) => <button key={k} type="button" className={'exp-k' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{fr ? f : en}</button>)}</div>
        {fixedShift ? <div className="sm muted">{dl(fixedShift.date, fr)} · {fixedShift.title}</div> : (
          <label className="exp-f"><span className="sm muted">{fr ? 'Pour' : 'For'}</span>
            <select value={shift} onChange={(e) => setShift(e.target.value)}>
              {recent.map((r) => <option key={r.id} value={r.id}>{dl(r.date, fr)} · {r.title}</option>)}
              {always && <option value="">{fr ? 'Pas pour un événement' : 'Not for an event'}</option>}
            </select></label>)}
        {!shift && !fixedShift && <label className="exp-f"><span className="sm muted">Date</span><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
        <label className={'exp-photo' + (file ? ' on' : '')}>
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} hidden />
          {file ? `✓ ${file.name}` : (fr ? '📷 Photo ou capture d’écran du reçu' : '📷 Photo or screenshot of the receipt')}
        </label>
        {kind === 'uber' && !file && <small className="muted">{fr ? 'Uber : capture d’écran du reçu du trajet dans l’app Uber.' : 'Uber: screenshot of the trip receipt in the Uber app.'}</small>}
        <label className="exp-f"><span className="sm muted">{fr ? 'Montant' : 'Amount'}</span><input inputMode="decimal" placeholder="$0.00" value={amt} onChange={(e) => setAmt(e.target.value)} /></label>
        <input className="exp-note" placeholder={fr ? 'Note (optionnel)' : 'Note (optional)'} value={note} onChange={(e) => setNote(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={busy} onClick={send}>{busy ? '…' : fr ? 'Envoyer' : 'Send'}</button>
      </div>
    </>);
}

/** Home: floating + (always on) and the quiet "shift is done" cards (one shift, 2 days). */
export function ExpenseHome({ me, fr = false, preview = false }: { me: string; fr?: boolean; preview?: boolean }) {
  const [t, setT] = useState(0); const a = useExpenseAccess(t, preview);
  const [open, setOpen] = useState<{ fixed: Recent | null } | null>(null); const [sent, setSent] = useState(false);
  return <>
    {a.shifts.filter((s) => s.date <= new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })).map((s) => (
      <button key={s.shift_id} className="card exp-done" onClick={() => setOpen({ fixed: { id: s.shift_id, title: s.title, date: s.date } })}>
        <span className="grow"><b>{dl(s.date, fr)} · {s.title}</b><span className="sm muted">{fr ? 'est terminé' : 'is done'}</span></span><span className="exp-add">{fr ? '+ Ajouter une dépense' : '+ Add an expense'}</span>
      </button>))}
    {sent && <div className="card sm okc" onClick={() => setSent(false)}>✓ {fr ? 'Envoyé à Ronnie. Suivez-la dans Heures.' : 'Sent to Ronnie. See it in Hours → My expenses.'}</div>}
    {a.always && <button className="exp-fab" aria-label={fr ? 'Ajouter une dépense' : 'Add an expense'} onClick={() => setOpen({ fixed: null })}>+</button>}
    {open && <ExpenseSheet me={me} fixedShift={open.fixed} always={a.always} fr={fr} onClose={() => setOpen(null)} onSent={() => { setOpen(null); setSent(true); setT((x) => x + 1); }} />}
  </>;
}

/** "+ Expense" on a past shift (always-on people, or that shift's window). */
export function ExpenseShiftButton({ me, shift, fr = false }: { me: string; shift: Recent; fr?: boolean }) {
  const a = useExpenseAccess(); const [open, setOpen] = useState(false); const [sent, setSent] = useState(false);
  if (!a.always && !a.shifts.some((s) => s.shift_id === shift.id)) return null;
  return <>
    {sent ? <span className="sm okc">✓ {fr ? 'Envoyé' : 'Sent to Ronnie'}</span> : <button className="btn" onClick={() => setOpen(true)}>{fr ? '+ Dépense' : '+ Expense'}</button>}
    {open && <ExpenseSheet me={me} fixedShift={shift} always={a.always} fr={fr} onClose={() => setOpen(false)} onSent={() => { setOpen(false); setSent(true); }} />}
  </>;
}

/** Hours tab → My expenses (waiting / approved, added to your pay / declined + reason). */
export function MyExpenses({ me, fr = false }: { me: string; fr?: boolean }) {
  const [rows, setRows] = useState<MyExp[]>([]);
  useEffect(() => { supabase.from('expenses').select('id,kind,amount,exp_date,status,reason,shift_id').eq('staff_id', me).order('created_at', { ascending: false }).limit(20)
    .then(({ data, error }) => setRows(error ? [] : ((data ?? []) as MyExp[]))); }, [me]);
  if (!rows.length) return null;
  const st = (r: MyExp) => r.status === 'approved' ? <span className="okc">{fr ? 'approuvée, ajoutée à votre paie' : 'approved, added to your pay'}</span>
    : r.status === 'declined' ? <span className="accent">{fr ? 'refusée' : 'declined'}{r.reason ? ` · “${r.reason}”` : ''}</span> : <span className="muted">{fr ? 'en attente' : 'waiting for Ronnie'}</span>;
  return (
    <>
      <div className="sec-head"><span className="serif">{fr ? 'Mes dépenses' : 'My expenses'}</span><span className="muted sm">{rows.length}</span></div>
      <section className="card stack" style={{ gap: 8 }}>
        {rows.map((r) => <div key={r.id} className="sm"><b>{kindL(r.kind, fr)} ${Number(r.amount).toFixed(2)}</b>, {dl(r.exp_date, fr)} · {st(r)}</div>)}
      </section>
    </>);
}
