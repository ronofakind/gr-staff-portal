import { createClient } from '@supabase/supabase-js';

// Arriving from an emailed sign-in link: ask the person to choose their PIN next.
if (/[?&#](code|access_token)=/.test(window.location.href)) localStorage.setItem('gr_needs_pin', '1');

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export type Staff = {
  id: string; full_name: string; nickname?: string | null; email: string | null; phone: string | null;
  language: 'fr' | 'en'; role: 'staff' | 'manager' | 'admin'; photo_url: string | null; sex?: 'm' | 'f' | null;
};

export type ShiftRow = {
  id: string; status: 'booked' | 'confirmed' | 'declined';
  position_code: string | null; position_detail: string | null;
  planned_start: string; planned_end: string | null; arrive_before_min: number; uniform: string | null; me?: { sex?: string | null } | null; time_tbc?: boolean; plan?: unknown; cal_token?: string; punches?: { punch_in: string | null; punch_out: string | null } | null;
  events: {
    id: string; event_date: string; title: string; address: string | null; department: string; manager_id: string | null;
    description: string | null; dress_code: string | null; bring: string | null; notes?: string | null;
    timeline: { time: string; label: string }[]; uniform_floor: string | null; uniform_bar: string | null; uniform_floor_w?: string | null; uniform_bar_w?: string | null; drive_folder_url?: string | null; plan?: unknown; hours_submitted_at?: string | null;
    venues: { name: string; address: string | null; staff_notes: string | null } | null;
    manager: { full_name: string; photo_url: string | null; phone: string | null } | null;
  };
};

export const SHIFT_SELECT = `id,status,me:staff!shifts_staff_id_fkey(sex),position_code,position_detail,planned_start,planned_end,arrive_before_min,uniform,time_tbc,plan,cal_token,
  events(id,event_date,title,address,department,description,dress_code,bring,notes,timeline,manager_id,uniform_floor,uniform_bar,uniform_floor_w,uniform_bar_w,drive_folder_url,plan,hours_submitted_at,
    venues(name,address,staff_notes),
    manager:staff!events_manager_id_fkey(full_name,photo_url,phone))`;
