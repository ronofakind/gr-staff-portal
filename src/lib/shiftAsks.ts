import { useEffect, useState } from 'react';
import { supabase } from './supabase';

/* Push 40 · ask first (earlier start / move / position) + fill one spot by asking several people. Migration 044.
   Staff only ever see their own card (shift_ask_cards): never how many people were asked, never first come / one by one. */

const TZ = 'America/Toronto';
export type AskKind = 'earlier_start' | 'move' | 'position' | 'fill';
/** One shift as the card shows it (snapshot taken when Ronnie asked). */
export type Card = { event_id: string; date: string; venue: string; address: string | null; start: string; code: string | null; position: string; dept: string; uniform: string | null; client?: string | null };
export type AskMeta = { old?: Card; new: Card };
/** state: open · yes · no · expired · cancelled · booked · gone */
export type AskState = 'open' | 'yes' | 'no' | 'expired' | 'cancelled' | 'booked' | 'gone';
export type MyAsk = { ask_id: string; kind: AskKind; meta: AskMeta; asked_at: string | null; due_at: string | null; answer: 'yes' | 'no' | 'expired' | null; answered_at: string | null; note: string | null; message_id: string | null; state: AskState; staff_name?: string | null };

export type AskTarget = { staff_id: string; full_name: string; phone: string | null; photo_url: string | null; ord: number; asked_at: string | null; due_at: string | null;
  answer: 'yes' | 'no' | 'expired' | null; answered_at: string | null; note: string | null; removed_at: string | null; seen_at: string | null };
export type AdminAsk = {
  id: string; kind: AskKind; shift_id: string | null; event_id: string; from_event_id: string | null; new_start: string | null; position_code: string | null; position_detail: string | null;
  mode: 'all' | 'chain' | null; wait_min: number | null; answer_by: string | null; group_key: string; replace_for: string | null; meta: AskMeta;
  status: 'open' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'filled' | 'nobody'; resolution: string | null; booked_shift_id: string | null;
  created_at: string; closed_at: string | null; needs_you: boolean; event_date: string; event_title: string; department: string; shift_staff_id: string | null; targets: AskTarget[];
};
/** The spot to fill after Take off and replace / Ask someone else. */
export type Spot = { event_id: string; start: string; code: string | null; detail: string | null; date: string };

/** "missing function / table" → migration 044 not applied yet: the app behaves as before. */
export const missing044 = (e: { message?: string } | null | undefined) => !!e?.message && /shift_ask|admin_ask|admin_fill|admin_shift|does not exist|schema cache|function/i.test(e.message);

export const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
/** "Answer by 10:20 AM" (today) · "Answer by tomorrow 9 AM" · "Answer by Sat 9:10 AM" */
export function byText(iso: string | null) {
  if (!iso) return '';
  const d = dayOf(iso); const t = dayOf(new Date().toISOString());
  const tm = new Date(new Date().getTime() + 864e5).toLocaleDateString('en-CA', { timeZone: TZ });
  if (d === t) return `Answer by ${t12(iso)}`;
  if (d === tm) return `Answer by tomorrow ${t12(iso)}`;
  return `Answer by ${new Date(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })} ${t12(iso)}`;
}
export const minsLeft = (iso: string | null) => (iso ? Math.round((new Date(iso).getTime() - Date.now()) / 60000) : null);
export const leftText = (iso: string | null) => { const m = minsLeft(iso); if (m == null) return ''; if (m <= 0) return 'TIME UP'; return m < 60 ? `${m} MIN LEFT` : `${Math.round(m / 60)} H LEFT`; };

export const UNIFORM_LABEL: Record<string, string> = { white_shirt: 'white dress shirt', black_shirt: 'black dress shirt', dress: 'black cocktail dress', black_tshirt: 'black T-shirt' };
export const uniformText = (u: string | null | undefined) => (!u ? '' : u.startsWith('custom:') ? u.slice(7) : UNIFORM_LABEL[u] ?? u);
/** Gold line on a move: "Same uniform · starts 45 min earlier". */
export function whatChanges(o?: Card, n?: Card) {
  if (!o || !n) return '';
  const bits: string[] = [];
  bits.push(!o.uniform || !n.uniform || o.uniform === n.uniform ? 'Same uniform' : `Uniform: ${uniformText(n.uniform)}`);
  const m = Math.round((new Date(n.start).getTime() - new Date(o.start).getTime()) / 60000);
  if (m) { const a = Math.abs(m); const h = Math.floor(a / 60), mm = a % 60; bits.push(`starts ${h ? `${h} h${mm ? ' ' + mm : ''}` : `${mm} min`} ${m < 0 ? 'earlier' : 'later'}`); }
  else bits.push('same start');
  if (o.position !== n.position) bits.push(`now ${n.position}`);
  return bits.join(' · ');
}
export const KICKER: Record<AskKind, string> = { earlier_start: '🗓 CAN YOU DO A NEW TIME?', move: '🗓 CAN YOU WORK THIS EVENT INSTEAD?', position: '🗓 CAN YOU DO A NEW POSITION?', fill: '🙋 CAN YOU WORK THIS SHIFT?' };

/** My open asks (Home, My dates). Empty until 044 is applied. */
export function useMyAsks(off = false) {
  const [asks, setAsks] = useState<MyAsk[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (off) return;
    let live = true;
    supabase.rpc('shift_ask_cards', { p_ids: null }).then(({ data, error }) => { if (live && !error && Array.isArray(data)) setAsks(data as MyAsk[]); });
    return () => { live = false; };
  }, [off, tick]);
  return { asks, setAsks, reload: () => setTick((t) => t + 1) };
}

export async function answerAsk(id: string, yes: boolean, note?: string | null): Promise<{ status: string; shift_id?: string }> {
  const { data, error } = await supabase.rpc('answer_shift_ask', { p_ask: id, p_yes: yes, p_note: note ?? null });
  if (error) throw new Error(error.message);
  return data as { status: string; shift_id?: string };
}

/** Admin: every ask on these dates (Day view trackers, Needs you). */
export async function adminAsks(from: string, to: string): Promise<AdminAsk[]> {
  const { data, error } = await supabase.rpc('admin_shift_asks', { p_from: from, p_to: to });
  if (error) { if (!missing044(error)) console.warn('[asks]', error.message); return []; }
  return (Array.isArray(data) ? data : []) as AdminAsk[];
}

/** Who still owes an answer (asked, no answer, not removed). */
export const waitingOf = (a: AdminAsk) => a.targets.filter((t) => t.asked_at && !t.answer && !t.removed_at);
export const shortName = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] || '?';
