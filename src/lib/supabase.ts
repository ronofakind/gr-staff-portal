import { createClient } from '@supabase/supabase-js';

// Arriving from an emailed sign-in link: ask the person to choose their PIN next.
if (/[?&#](code|access_token)=/.test(window.location.href)) localStorage.setItem('gr_needs_pin', '1');

// push 42 · phone alerts: every successful write (insert / update / delete / RPC) lets lib/alerts.ts send what's waiting.
const writeHooks = new Set<(url: string) => void>();
export function onDbWrite(f: (url: string) => void) { writeHooks.add(f); return () => { writeHooks.delete(f); }; }
const watchedFetch: typeof fetch = async (input, init) => {
  const res = await fetch(input, init);
  try {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (res.ok && method !== 'GET' && method !== 'HEAD' && url.includes('/rest/v1/')) writeHooks.forEach((f) => f(url));
  } catch { /* never in the way */ }
  return res;
};

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true }, global: { fetch: watchedFetch } }
);

export type Staff = {
  id: string; full_name: string; nickname?: string | null; email: string | null; phone: string | null;
  language: 'fr' | 'en'; role: 'staff' | 'manager' | 'admin'; photo_url: string | null; sex?: 'm' | 'f' | null;
};

export type ShiftRow = {
  id: string; status: 'booked' | 'confirmed' | 'declined';
  position_code: string | null; position_detail: string | null;
  planned_start: string; planned_end: string | null; arrive_before_min: number; uniform: string | null; me?: { sex?: string | null } | null; time_tbc?: boolean; plan?: unknown; cal_token?: string; attendance?: 'no_show' | 'cancelled' | null; punches?: { punch_in: string | null; punch_out: string | null } | null; ends_own?: boolean;
  events: {
    id: string; event_date: string; title: string; address: string | null; department: string; manager_id: string | null; co_manager_ids?: string[] | null; tentative?: boolean;
    description: string | null; dress_code: string | null; bring: string | null; notes?: string | null;
    timeline: { time: string; label: string }[]; uniform_floor: string | null; uniform_bar: string | null; uniform_floor_w?: string | null; uniform_bar_w?: string | null; uniform_items?: import('../components/Uniform').UniItemsMap | null; event_type?: string | null; guests?: number | null; transport?: boolean; travel_min?: number | null; paid_travel_min?: number | null; rides?: boolean; drive_folder_url?: string | null; plan?: unknown; hours_submitted_at?: string | null; details_pending?: boolean; links?: unknown;
    venues: { name: string; address: string | null; staff_notes: string | null; no_outside_food?: boolean; pin_lat?: number | null; pin_lng?: number | null; pin_label?: string | null; links?: unknown } | null;
    manager: { full_name: string; photo_url: string | null; phone: string | null } | null;
  };
};

export const SHIFT_SELECT = `id,status,attendance,me:staff!shifts_staff_id_fkey(sex),position_code,position_detail,planned_start,planned_end,arrive_before_min,uniform,time_tbc,plan,cal_token,ends_own,
  events(id,event_date,title,address,department,description,dress_code,bring,notes,timeline,manager_id,co_manager_ids,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,uniform_items,event_type,guests,transport,travel_min,paid_travel_min,rides,drive_folder_url,plan,hours_submitted_at,details_pending,tentative,links,
    venues(name,address,staff_notes,no_outside_food,pin_lat,pin_lng,pin_label,links),
    manager:staff!events_manager_id_fkey(full_name,photo_url,phone))`;

/** Set-ups (stock moves, room set-up…): no uniform section and no "be there" time for staff. */
export const isSetup = (ev: { title: string; event_type?: string | null }) => /^set-?up$/i.test(ev.event_type ?? '') || /\bset[\s-]?up\b|stock|move g&r|inventory/i.test(ev.title);
