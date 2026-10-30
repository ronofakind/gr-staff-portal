-- Admin push 9–14 (Oct 29 evening): alerts on moves, uniforms per department for men and women, event folder link.

-- Staff: men / women (sets which uniform line they see)
alter table public.staff add column if not exists sex text check (sex in ('m','f'));

-- Uniforms: the existing columns are the MEN line; *_w = WOMEN line. Values: white_shirt, black_shirt, dress, black_tshirt, or 'custom:<text>'.
alter table public.events drop constraint if exists events_uniform_floor_check;
alter table public.events drop constraint if exists events_uniform_bar_check;
alter table public.shifts drop constraint if exists shifts_uniform_check;
alter table public.events add column if not exists uniform_floor_w text;
alter table public.events add column if not exists uniform_bar_w text;
alter table public.venues add column if not exists uniform_floor_w text;
alter table public.venues add column if not exists uniform_bar_w text;

-- Event folder (Google Drive link for now; managers + admin see it)
alter table public.events add column if not exists drive_folder_url text;

-- Alerts to staff when they're added / moved / removed after confirmations went out
create table if not exists public.staff_alerts (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        text not null check (kind in ('booked','moved','removed','changed')),
  title       text not null,
  body        text,
  event_id    uuid references public.events(id) on delete set null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz
);
create index if not exists staff_alerts_staff on public.staff_alerts (staff_id, seen_at);
alter table public.staff_alerts enable row level security;
drop policy if exists admin_all on public.staff_alerts;
drop policy if exists own_read on public.staff_alerts;
create policy admin_all on public.staff_alerts for all using (is_admin()) with check (is_admin());
create policy own_read on public.staff_alerts for select using (staff_id = me());
create or replace function public.alert_seen(p_id uuid) returns void
language sql security definer set search_path = public as
$$ update staff_alerts set seen_at = now() where id = p_id and staff_id = me() and seen_at is null $$;
grant execute on function public.alert_seen(uuid) to authenticated;

-- Calendar link: women see the women's line
create or replace function public.cal_event(p_token uuid)
returns json language sql stable security definer set search_path = public as
$$ select json_build_object(
     'uid', s.id, 'title', e.title, 'event_date', e.event_date,
     'start', s.planned_start, 'end', s.planned_end, 'arrive_min', s.arrive_before_min, 'time_tbc', s.time_tbc,
     'address', coalesce(e.address, v.address, ''), 'venue', coalesce(v.name, e.title),
     'role', coalesce(nullif(s.position_detail, ''), s.position_code, ''),
     'uniform', coalesce(s.uniform, case when s.position_code in ('BM','BT','BB')
                  then (case when me.sex = 'f' then coalesce(e.uniform_bar_w, e.uniform_bar) else e.uniform_bar end)
                  else (case when me.sex = 'f' then coalesce(e.uniform_floor_w, e.uniform_floor) else e.uniform_floor end) end),
     'dress', coalesce(e.dress_code, ''), 'description', coalesce(e.description, ''),
     'md_name', md.full_name, 'md_phone', md.phone)
   from shifts s join events e on e.id = s.event_id join staff me on me.id = s.staff_id
   left join venues v on v.id = e.venue_id
   left join lateral (select st.full_name, st.phone from shifts m join staff st on st.id = m.staff_id
                       where m.event_id = e.id and m.position_code = 'MD' limit 1) md on true
  where s.cal_token = p_token and s.status <> 'declined' $$;
grant execute on function public.cal_event(uuid) to anon, authenticated;
