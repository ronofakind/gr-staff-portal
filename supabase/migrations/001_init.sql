-- G&R Staff Portal — phase 1 schema
-- Paste into Supabase → SQL Editor → Run. Safe to run once on an empty project.

create extension if not exists pgcrypto;

-- ───────────── Staff ─────────────
create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  full_name     text not null,               -- spelled exactly as on the Events sheet
  email         text unique,
  phone         text,
  language      text not null default 'fr' check (language in ('fr','en')),
  department    text not null default 'floor' check (department in ('floor','bar','kitchen')),
  role          text not null default 'staff' check (role in ('staff','manager','admin')),
  positions     text[] not null default '{}',
  photo_url     text,
  shirt_size    text,
  pants_size    text,
  shoe_size     text,
  transport     text check (transport in ('car','transit','needs_ride')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- Admin-only fields live in their own table so staff/managers can never read them.
create table public.staff_private (
  staff_id  uuid primary key references public.staff(id) on delete cascade,
  ranking   int,
  notes     text
);

-- ───────────── Venues & events ─────────────
create table public.venues (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  address      text,
  staff_notes  text           -- staff entrance, parking, who to ask for
);

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  event_date    date not null,
  title         text not null,      -- what staff see: venue name, never the client
  venue_id      uuid references public.venues(id),
  address       text,               -- overrides venue address (private houses)
  department    text not null default 'floor' check (department in ('floor','bar','kitchen')),
  description   text,               -- "Seated dinner for 120…"
  timeline      jsonb not null default '[]',  -- [{"time":"18:30","label":"Guests arrive"}]
  dress_code    text,
  bring         text,
  manager_id    uuid references public.staff(id),
  sheet_ref     text,               -- link back to the Events 2026 row block
  created_at    timestamptz not null default now()
);
create index on public.events (event_date);

-- Admin-only event data (client name, punch code).
create table public.event_private (
  event_id    uuid primary key references public.events(id) on delete cascade,
  client      text,
  punch_code  text not null default lpad((floor(random()*10000))::int::text, 4, '0')
);

create table public.shifts (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  staff_id         uuid not null references public.staff(id),
  position_code    text,          -- MD, 1, 2, … / BM, BT, BB
  position_detail  text,          -- "Cocktail: side A · Dinner: tables 1, 2, 3"
  planned_start    timestamptz not null,
  planned_end      timestamptz,
  arrive_before_min int not null default 15,
  status           text not null default 'booked' check (status in ('booked','confirmed','declined')),
  responded_at     timestamptz,
  unique (event_id, staff_id)
);
create index on public.shifts (staff_id);

create table public.punches (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null unique references public.shifts(id) on delete cascade,
  punch_in      timestamptz,
  punch_out     timestamptz,
  in_recorded_offline  boolean not null default false,
  edited_by     uuid references public.staff(id),
  updated_at    timestamptz not null default now()
);

create table public.availability (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  for_date   date not null,
  part       text not null default 'evening' check (part in ('day','evening','all')),
  status     text not null default 'asked' check (status in ('asked','yes','no','maybe')),
  note       text,
  answered_at timestamptz,
  unique (staff_id, for_date, part)
);

create table public.change_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  by_staff   uuid references public.staff(id),
  entity     text not null,
  entity_id  uuid,
  change     jsonb not null
);

-- ───────────── Helpers ─────────────
create or replace function public.me() returns uuid
language sql stable security definer set search_path = public as
$$ select id from staff where auth_user_id = auth.uid() and active $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff where auth_user_id = auth.uid() and role = 'admin' and active) $$;

create or replace function public.manages(ev uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from events where id = ev and manager_id = public.me()) $$;

create or replace function public.works(ev uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from shifts where event_id = ev and staff_id = public.me()) $$;

-- Link a new login to the staff row with the same email.
create or replace function public.link_staff_login() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  update staff set auth_user_id = new.id
   where lower(email) = lower(new.email) and auth_user_id is null;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.link_staff_login();

-- ───────────── Row-level security ─────────────
alter table public.staff         enable row level security;
alter table public.staff_private enable row level security;
alter table public.venues        enable row level security;
alter table public.events        enable row level security;
alter table public.event_private enable row level security;
alter table public.shifts        enable row level security;
alter table public.punches       enable row level security;
alter table public.availability  enable row level security;
alter table public.change_log    enable row level security;

-- Admin: everything.
create policy admin_all on public.staff         for all using (is_admin()) with check (is_admin());
create policy admin_all on public.staff_private for all using (is_admin()) with check (is_admin());
create policy admin_all on public.venues        for all using (is_admin()) with check (is_admin());
create policy admin_all on public.events        for all using (is_admin()) with check (is_admin());
create policy admin_all on public.event_private for all using (is_admin()) with check (is_admin());
create policy admin_all on public.shifts        for all using (is_admin()) with check (is_admin());
create policy admin_all on public.punches       for all using (is_admin()) with check (is_admin());
create policy admin_all on public.availability  for all using (is_admin()) with check (is_admin());
create policy admin_read on public.change_log   for select using (is_admin());

-- Staff: own profile, plus name/photo of people on the same events.
create policy staff_self on public.staff for select using (id = me());
create policy staff_self_update on public.staff for update using (id = me())
  with check (id = me());
create policy staff_teammates on public.staff for select using (
  exists (select 1 from shifts s join shifts mine on mine.event_id = s.event_id
          where s.staff_id = staff.id and mine.staff_id = me())
  or exists (select 1 from events e join shifts mine on mine.event_id = e.id
             where e.manager_id = staff.id and mine.staff_id = me())
);

-- Events/venues: only the ones you work or manage.
create policy staff_events on public.events for select using (works(id) or manages(id));
create policy staff_venues on public.venues for select using (
  exists (select 1 from events e where e.venue_id = venues.id and (works(e.id) or manages(e.id))));

-- Shifts: your own; managers see their event's team.
create policy staff_shifts on public.shifts for select using (staff_id = me() or manages(event_id));
create policy staff_punches on public.punches for select using (
  exists (select 1 from shifts s where s.id = shift_id and (s.staff_id = me() or manages(s.event_id))));

-- Availability: your own.
create policy staff_avail on public.availability for select using (staff_id = me());
create policy staff_avail_answer on public.availability for update using (staff_id = me())
  with check (staff_id = me());

-- ───────────── Actions (the only way staff/managers write) ─────────────
create or replace function public.respond_to_shift(p_shift uuid, p_response text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_response not in ('confirmed','declined') then raise exception 'bad response'; end if;
  update shifts set status = p_response, responded_at = now()
   where id = p_shift and staff_id = me();
  if not found then raise exception 'not your shift'; end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'shift', p_shift, jsonb_build_object('status', p_response));
end $$;

-- Punch in with the manager's 4-digit code. p_at = time on the phone (offline punches sync later).
create or replace function public.punch_in(p_shift uuid, p_code text, p_at timestamptz default now(), p_offline boolean default false)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare s shifts; code text; begin
  select * into s from shifts where id = p_shift and staff_id = me();
  if not found then raise exception 'not your shift'; end if;
  select punch_code into code from event_private where event_id = s.event_id;
  if code is distinct from p_code then raise exception 'wrong code'; end if;
  if p_at < s.planned_start - interval '60 minutes' then raise exception 'too early'; end if;
  if p_at > now() + interval '5 minutes' then p_at := now(); end if;
  insert into punches(shift_id, punch_in, in_recorded_offline) values (p_shift, p_at, p_offline)
  on conflict (shift_id) do nothing;
  return p_at;
end $$;

-- Managers (and admin) punch staff out, or fix times. No auto-close.
create or replace function public.manager_set_punch(p_shift uuid, p_in timestamptz, p_out timestamptz)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select event_id into ev from shifts where id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  insert into punches(shift_id, punch_in, punch_out, edited_by, updated_at)
  values (p_shift, p_in, p_out, me(), now())
  on conflict (shift_id) do update set punch_in = excluded.punch_in, punch_out = excluded.punch_out,
     edited_by = me(), updated_at = now();
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'punch', p_shift, jsonb_build_object('in', p_in, 'out', p_out));
end $$;

-- Managers read their event's punch code.
create or replace function public.event_punch_code(p_event uuid)
returns text language sql stable security definer set search_path = public as
$$ select punch_code from event_private where event_id = p_event and (is_admin() or manages(p_event)) $$;

-- Hours rounded to the nearest 15 min.
create or replace function public.rounded_hours(p_in timestamptz, p_out timestamptz)
returns numeric language sql immutable as
$$ select round(extract(epoch from (p_out - p_in)) / 900) * 0.25 $$;

-- Staff can only edit their own contact/profile fields, never role/department/active.
revoke update on public.staff from authenticated;
grant update (phone, language, photo_url, shirt_size, pants_size, shoe_size, transport) on public.staff to authenticated;
