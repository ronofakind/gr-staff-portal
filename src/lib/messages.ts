import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from './supabase';
import { meetingMorningCheck } from './meetings';

/* Push 36 · Messages: shared types + helpers (staff tab, Ronnie's inbox, manager replies). Migration 042. */

export const RONNIE_ID = '13791946-d8df-4146-b51e-0963f0324499';
export const RONNIE_PHOTO = 'https://oigqdecyhmeuvrpoikdv.supabase.co/storage/v1/object/public/avatars/13791946-d8df-4146-b51e-0963f0324499.jpg';
export const BUCKET = 'message-photos';
const TZ = 'America/Toronto';

export type Side = 'staff' | 'admin' | 'manager';
export type Topic = 'hours' | 'shift' | 'uniform' | 'getting_there' | 'pay' | 'other';
export type ShiftMeta = { id: string; title: string; date: string; start: string; event_id?: string };
export type HoursMeta = { app_in: string | null; app_out: string | null; h: number | null; kind: 'start' | 'end' | 'other'; claimed_at: string | null };
export type Conv = {
  id: string; staff_id: string; kind: 'ronnie' | 'manager'; event_id: string | null; manager_id: string | null; announcement_id: string | null;
  status: 'open' | 'done'; admin_unread: boolean; staff_seen_at: string | null; admin_seen_at: string | null; manager_seen_at: string | null;
  closes_at: string | null; last_message_at: string | null; last_from: 'staff' | 'admin' | 'manager' | 'system' | null; created_at: string;
};
export type Msg = {
  id: string; conversation_id: string; sender_id: string | null; sender_role: 'staff' | 'admin' | 'manager' | 'system'; kind: 'text' | 'system' | 'hours';
  body: string; topic: Topic | null; shift_id: string | null; hours_question_id: string | null; announcement_id: string | null; photo_paths: string[];
  meta: { shift?: ShiftMeta; hours?: HoursMeta; re?: string }; edited_at: string | null; deleted_at: string | null; created_at: string;
};
export type InboxRow = {
  id: string; staff_id: string; staff_name: string; staff_photo: string | null; staff_phone: string | null; kind: 'ronnie' | 'manager';
  event_id: string | null; event_title: string | null; event_date: string | null; manager_id: string | null; manager_name: string | null;
  status: 'open' | 'done'; admin_unread: boolean; staff_seen_at: string | null; admin_seen_at: string | null; manager_seen_at: string | null;
  closes_at: string | null; last_message_at: string; last_from: Conv['last_from']; last_body: string | null; last_kind: Msg['kind'] | null;
  last_topic: Topic | null; last_meta: Msg['meta'] | null; last_photos: number; last_staff_at: string | null; re: string | null; needs_reply: boolean; closed: boolean;
};

export const CONV_COLS = 'id,staff_id,kind,event_id,manager_id,announcement_id,status,admin_unread,staff_seen_at,admin_seen_at,manager_seen_at,closes_at,last_message_at,last_from,created_at';
export const MSG_COLS = 'id,conversation_id,sender_id,sender_role,kind,body,topic,shift_id,hours_question_id,announcement_id,photo_paths,meta,edited_at,deleted_at,created_at';

export const TOPICS: { k: Topic; label: string; ic: string }[] = [
  { k: 'hours', label: 'My hours', ic: '🕒' }, { k: 'shift', label: 'A shift', ic: '🗓' }, { k: 'uniform', label: 'Uniform', ic: '👔' },
  { k: 'getting_there', label: 'Getting there', ic: '🚗' }, { k: 'other', label: 'Something else', ic: '💬' },
];
export const topicLabel = (t: Topic | null | undefined) => (t === 'pay' ? 'Pay' : TOPICS.find((x) => x.k === t)?.label ?? null);
export const QUICK = ['👍', 'Thank you!', 'On my way', 'See you there'];

export const t12 = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
export const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const D = (ymd: string) => new Date(ymd + 'T12:00:00');
/** "Sat Nov 7" */
export const shortDate = (ymd: string) => D(ymd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '');
/** List time: 9:52 AM today · Yesterday · Sat (this week) · Oct 31 */
export function whenShort(iso: string) {
  const d = dayOf(iso); const t = todayIso();
  if (d === t) return t12(iso);
  const days = Math.round((D(t).getTime() - D(d).getTime()) / 864e5);
  if (days === 1) return 'Yesterday';
  if (days < 7) return D(d).toLocaleDateString('en-US', { weekday: 'short' });
  return D(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
/** Day separator in a conversation */
export function dayHead(iso: string) {
  const d = dayOf(iso); const t = todayIso();
  if (d === t) return 'Today';
  const days = Math.round((D(t).getTime() - D(d).getTime()) / 864e5);
  return days === 1 ? 'Yesterday' : shortDate(d);
}
export const shiftLine = (s: ShiftMeta) => `${shortDate(s.date)} · ${s.title} · ${t12(s.start)}`;
export const fmtH = (h: number | null | undefined) => (h == null ? '' : String(Math.round(Number(h) * 100) / 100));
export const first = (n?: string | null) => (n ?? '').trim().split(' ')[0];

/** 10 PM – 7 AM in Montreal: "Ronnie will reply in the morning". */
export function quietNow() { const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TZ })) % 24; return h >= 22 || h < 7; }
export const ronnieSub = () => (quietNow() ? 'Ronnie will reply in the morning' : 'usually replies within a few hours');

/** Phone photo → JPEG, longest side ~1600 px. */
export async function shrinkPhoto(f: File): Promise<Blob> {
  const img = await createImageBitmap(f).catch(() => null); if (!img) return f;
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b ?? f), 'image/jpeg', 0.85));
}
export async function uploadPhotos(convId: string, files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) throw new Error('Photos only.');
    const p = `${convId}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from(BUCKET).upload(p, await shrinkPhoto(f), { contentType: 'image/jpeg' });
    if (up.error) throw up.error; out.push(p);
  }
  return out;
}
/** Signed URLs (1 h) for a set of paths in a private bucket. */
export function useSigned(paths: string[], bucket = BUCKET) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.filter((p) => !urls[p]).join('|');
  useEffect(() => {
    const need = key ? key.split('|') : [];
    if (!need.length) return;
    supabase.storage.from(bucket).createSignedUrls(need, 3600).then(({ data }) => {
      if (data) setUrls((u) => ({ ...u, ...Object.fromEntries(data.filter((d) => d.signedUrl).map((d, i) => [d.path ?? need[i], d.signedUrl])) }));
    });
  }, [key, bucket]);
  return urls;
}

/** Staff tab badge (unread conversations + unopened announcements + unseen shift notices). 0 until migration 042 is applied. */
export function useMessagesBadge(off = false) {
  const [n, setN] = useState(0); const { pathname, search } = useLocation();
  useEffect(() => {
    if (off) return;
    let live = true;
    meetingMorningCheck().then(() => supabase.rpc('messages_badge').then(({ data, error }) => { if (live && !error && typeof data === 'number') setN(data); }));
    return () => { live = false; };
  }, [off, pathname, search]);
  return n;
}
/** Admin: Needs reply count. Manager: replies waiting on his event (p_event). */
export function useInboxCount(eventId?: string | null, off = false) {
  const [n, setN] = useState(0); const { pathname, search } = useLocation();
  useEffect(() => {
    if (off) return;
    let live = true;
    supabase.rpc('inbox_count', { p_event: eventId ?? null }).then(({ data, error }) => { if (live && !error && typeof data === 'number') setN(data); });
    return () => { live = false; };
  }, [eventId, off, pathname, search]);
  return n;
}

/** sms: link to several people (the app never sends texts itself). */
export function smsMany(phones: (string | null | undefined)[]) {
  const nums = phones.map((p) => (p ?? '').replace(/[^\d+]/g, '')).filter(Boolean);
  if (!nums.length) return null;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? `sms://open?addresses=${nums.join(',')}` : `sms:${nums.join(',')}`;
}

/** Local "seen" for ride plans (no read column on ride_offers): per device, convenience only. */
const RIDE_KEY = 'gr-ride-seen';
export const ridesSeen = (): string[] => { try { return JSON.parse(localStorage.getItem(RIDE_KEY) || '[]'); } catch { return []; } };
export const markRideSeen = (id: string) => { try { const v = [...new Set([...ridesSeen(), id])].slice(-80); localStorage.setItem(RIDE_KEY, JSON.stringify(v)); } catch { /* private mode */ } };

/** Turn "HH:MM" picked for a shift into an ISO time near `ref` (handles after-midnight ends). */
export function hmNear(ref: string, hm: string) {
  const d = new Date(ref); const [h, m] = hm.split(':').map(Number);
  const local = new Date(d.toLocaleString('en-US', { timeZone: TZ })); const diff = d.getTime() - local.getTime();
  local.setHours(h, m, 0, 0); let x = local.getTime() + diff;
  if (x - d.getTime() > 12 * 3600e3) x -= 24 * 3600e3; if (d.getTime() - x > 12 * 3600e3) x += 24 * 3600e3;
  return new Date(x).toISOString();
}
export const hm24 = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
