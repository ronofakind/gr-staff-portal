-- ───────── Tiers (admin only, lives next to ranking) ─────────
alter table public.staff_private add column if not exists tier text check (tier in ('A','B','C'));

-- ───────── Availability asks: one per date + department ─────────
create table if not exists public.avail_asks (
  id            uuid primary key default gen_random_uuid(),
  for_date      date not null,
  department    text not null default 'floor' check (department in ('floor','bar','kitchen')),
  label         text not null default 'Evening event',
  approx_start  time,
  staff_needed  int not null default 0,
  tiers_sent    text[] not null default '{}',
  reply_by      date,
  created_at    timestamptz not null default now(),
  unique (for_date, department)
);
alter table public.avail_asks enable row level security;
drop policy if exists admin_all on public.avail_asks;
create policy admin_all on public.avail_asks for all using (is_admin()) with check (is_admin());

alter table public.availability add column if not exists ask_id uuid references public.avail_asks(id) on delete cascade;
alter table public.availability add column if not exists tier text;
alter table public.availability add column if not exists from_time time;   -- null = any time
alter table public.availability add column if not exists until_time time;  -- null = until the end
alter table public.availability add column if not exists asked_at timestamptz;

drop policy if exists staff_asks on public.avail_asks;
create policy staff_asks on public.avail_asks for select using (
  exists (select 1 from availability a where a.ask_id = avail_asks.id and a.staff_id = me()));

-- Staff answer only through this (no direct updates).
drop policy if exists staff_avail_answer on public.availability;
create or replace function public.answer_availability(p_id uuid, p_status text, p_from time default null, p_until time default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_status not in ('yes','no') then raise exception 'bad answer'; end if;
  update availability set status = p_status, answered_at = now(),
         from_time = case when p_status = 'yes' then p_from end,
         until_time = case when p_status = 'yes' then p_until end
   where id = p_id and staff_id = me();
  if not found then raise exception 'not yours'; end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'availability', p_id, jsonb_build_object('status', p_status, 'from', p_from, 'until', p_until));
end $$;
grant execute on function public.answer_availability(uuid, text, time, time) to authenticated;

-- ───────── Usual week + days off (staff edit their own) ─────────
create table if not exists public.staff_weekly (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  dow        int not null check (dow between 0 and 6),          -- 0 = Monday
  status     text not null check (status in ('yes','from','no')),
  from_time  time,
  primary key (staff_id, dow)
);
create table if not exists public.days_off (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  from_date  date not null,
  to_date    date not null,
  reason     text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
alter table public.staff_weekly enable row level security;
alter table public.days_off enable row level security;
drop policy if exists admin_all on public.staff_weekly;
drop policy if exists admin_all on public.days_off;
drop policy if exists own on public.staff_weekly;
drop policy if exists own on public.days_off;
create policy admin_all on public.staff_weekly for all using (is_admin()) with check (is_admin());
create policy admin_all on public.days_off for all using (is_admin()) with check (is_admin());
create policy own on public.staff_weekly for all using (staff_id = me()) with check (staff_id = me());
create policy own on public.days_off for all using (staff_id = me()) with check (staff_id = me());

-- Can't take a day off on a day you're already booked.
create or replace function public.days_off_guard() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if exists (select 1 from shifts s join events e on e.id = s.event_id
              where s.staff_id = new.staff_id and s.status <> 'declined'
                and e.event_date between new.from_date and new.to_date) and not is_admin() then
    raise exception 'You are booked on one of these days. Talk to Ronnie.';
  end if;
  return new;
end $$;
drop trigger if exists days_off_guard on public.days_off;
create trigger days_off_guard before insert or update on public.days_off
  for each row execute function public.days_off_guard();

-- ───────── Big event plan (written by Claude / admin) ─────────
-- events.plan: { sides:[{name, leads:[staff_id], allergy_leads:[staff_id]}],
--                sections:[{name, tables:[text]}], clearing:[{course, items:[text]}],
--                documents:[{name, url}] }
-- shifts.plan: { cocktail:{role, from}, side:"name", section:"name" }
alter table public.events add column if not exists plan jsonb;
alter table public.shifts add column if not exists plan jsonb;

-- Teammates in my wine + water section (names/photos only).
create or replace function public.my_section_team(p_shift uuid)
returns table(full_name text, photo_url text) language sql stable security definer set search_path = public as
$$ select st.full_name, st.photo_url
     from shifts mine join shifts s on s.event_id = mine.event_id and s.id <> mine.id
     join staff st on st.id = s.staff_id
    where mine.id = p_shift and (mine.staff_id = me() or is_admin())
      and s.plan->>'section' is not null and s.plan->>'section' = mine.plan->>'section'
      and s.status <> 'declined' and s.attendance is null
    order by st.full_name $$;
grant execute on function public.my_section_team(uuid) to authenticated;

-- Leads for my side (names/photos only).
create or replace function public.plan_people(p_shift uuid, p_ids uuid[])
returns table(id uuid, full_name text, photo_url text) language sql stable security definer set search_path = public as
$$ select st.id, st.full_name, st.photo_url from staff st
    where st.id = any(p_ids)
      and exists (select 1 from shifts mine where mine.id = p_shift and (mine.staff_id = me() or is_admin())) $$;
grant execute on function public.plan_people(uuid, uuid[]) to authenticated;
