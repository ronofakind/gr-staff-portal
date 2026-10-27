import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true } }
);

export type Staff = {
  id: string; full_name: string; email: string | null; phone: string | null;
  language: 'fr' | 'en'; role: 'staff' | 'manager' | 'admin'; photo_url: string | null;
};

export type ShiftRow = {
  id: string; status: 'booked' | 'confirmed' | 'declined';
  position_code: string | null; position_detail: string | null;
  planned_start: string; planned_end: string | null; arrive_before_min: number;
  events: {
    id: string; event_date: string; title: string; address: string | null; department: string;
    description: string | null; dress_code: string | null; bring: string | null;
    timeline: { time: string; label: string }[];
    venues: { name: string; address: string | null; staff_notes: string | null } | null;
    manager: { full_name: string; photo_url: string | null; phone: string | null } | null;
  };
};

export const SHIFT_SELECT = `id,status,position_code,position_detail,planned_start,planned_end,arrive_before_min,
  events(id,event_date,title,address,department,description,dress_code,bring,timeline,
    venues(name,address,staff_notes),
    manager:staff!events_manager_id_fkey(full_name,photo_url,phone))`;
