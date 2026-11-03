import { supabase } from './supabase';
import { MSG_COLS, first, shortDate, todayIso, type Msg } from './messages';

/* Push 41 · Team chat per event (migration 045). Off by default; Ronnie turns it on per event on the admin event page.
   Reuses the 042 conversations / messages tables (conversation kind 'team'), the message-photos bucket and edit / delete. */

const TZ = 'America/Toronto';
export type TeamWho = 'everyone' | 'managers' | 'pick';
export type TeamState = 'off' | 'before' | 'open' | 'readonly' | 'hidden';
export type TeamPerson = { name: string; photo: string | null; admin?: boolean };
export type TeamOnEvent = { id: string; name: string; photo: string | null; start: string; code: string | null; detail: string | null; dept: string; lead: boolean; co: boolean };
export type TeamInfo = {
  anchor: string; events: string[]; title: string; date: string; conversation_id: string | null;
  enabled: boolean; who: TeamWho; picked: string[] | null; photos: boolean; manager_can_remove: boolean;
  opens_at: string; closes_at: string; state: TeamState; managers: string[]; lead_ids: string[]; n_members: number;
  members: { id: string; name: string; photo: string | null; manager: boolean }[];
  people: Record<string, TeamPerson>;
  pinned: { id: string; body: string; photos: number; sender_id: string | null; created_at: string } | null;
  me: { admin: boolean; manager: boolean; member: boolean; can_write: boolean; can_pin: boolean; can_remove: boolean; photos: boolean };
  on_event: TeamOnEvent[] | null;
};
export type TeamMsg = Msg & { reply_to?: string | null; removed_role?: 'manager' | 'admin' | null };
export type MyTeamChat = {
  event_id: string; conversation_id: string; title: string; event_date: string; state: TeamState; opens_at: string; closes_at: string; n_members: number;
  last_at: string | null; last_body: string | null; last_photos: number; last_deleted: boolean; last_sender_id: string | null; last_sender_name: string | null; unread: number;
};

export const TEAM_MSG_COLS = MSG_COLS + ',reply_to,removed_role';
export const TEAM_QUICK = ['👍', 'On my way', 'Thanks!'];

export async function teamInfo(eventId: string) {
  const { data, error } = await supabase.rpc('team_chat_info', { p_event: eventId });
  if (error) throw error;
  return (data as TeamInfo | null) ?? null;
}
export async function saveTeamChat(eventId: string, v: { enabled: boolean; who: TeamWho; picked?: string[] | null; photos?: boolean | null; managerRemove?: boolean | null }) {
  const { data, error } = await supabase.rpc('admin_save_team_chat', {
    p_event: eventId, p_enabled: v.enabled, p_who: v.who, p_picked: v.picked ?? null, p_photos: v.photos ?? null, p_manager_remove: v.managerRemove ?? null,
  });
  if (error) throw error;
  return data as TeamInfo;
}
/** Staff Messages list. [] until migration 045 is applied. */
export async function myTeamChats(): Promise<MyTeamChat[]> {
  const { data, error } = await supabase.rpc('my_team_chats');
  return error ? [] : ((data ?? []) as MyTeamChat[]);
}

/** "Fri 5:00 PM" */
export const dayTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { weekday: 'short', timeZone: TZ })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })}`;
};
/** "Sun Nov 15" */
export const dayOnly = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ }).replace(',', '');
export const readOnlyUntil = (closes: string) => new Date(new Date(closes).getTime() + 7 * 864e5).toISOString();
/** "tonight" · "tomorrow" · "Sat Nov 7" */
export function teamWhen(date: string) {
  const t = todayIso(); const d = new Date(t + 'T12:00:00'); d.setDate(d.getDate() + 1);
  return date === t ? 'tonight' : date === d.toISOString().slice(0, 10) ? 'tomorrow' : shortDate(date);
}
export function teamPreview(c: MyTeamChat, meId: string) {
  if (!c.last_at) return '';
  const who = c.last_sender_id === meId ? 'You' : first(c.last_sender_name) || 'Ronnie';
  const txt = c.last_deleted ? 'Message deleted' : c.last_body || (c.last_photos ? '📷 Photo' : '');
  return `${who}: ${txt}`;
}
