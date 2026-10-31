-- Push 25 (Oct 30): transport + rides, one-way announcements, payroll export adds paid travel.

-- 25c · Transport on events (money fields are admin-only through the UI; staff never see dollars)
alter table public.events add column if not exists transport boolean not null default false;
alter table public.events add column if not exists travel_min integer;
alter table public.events add column if not exists paid_travel_min integer;
alter table public.events add column if not exists gas_per_car numeric(8,2) default 20;
alter table public.events add column if not exists transport_billing text check (transport_billing in ('client', 'gr'));
alter table public.events add column if not exists rides boolean not null default false;
alter table public.venues add column if not exists always_offer_rides boolean not null default false;
update public.venues set always_offer_rides = true where name = 'Le Andover';

-- 25d · Rides
create table if not exists public.ride_offers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  kind text not null check (kind in ('driver', 'rider', 'own')),
  pickup_spot text, leave_at timestamptz, seats integer check (seats between 1 and 6), coming_from text,
  car_driver_id uuid references public.staff(id) on delete set null,
  placed_at timestamptz, sent_at timestamptz, created_at timestamptz not null default now(),
  unique (event_id, staff_id)
);
alter table public.ride_offers enable row level security;
drop policy if exists admin_all on public.ride_offers; create policy admin_all on public.ride_offers for all using (is_admin()) with check (is_admin());
drop policy if exists own on public.ride_offers;
create policy own on public.ride_offers for all using (staff_id = me())
  with check (staff_id = me() and exists (select 1 from shifts s where s.event_id = ride_offers.event_id and s.staff_id = me() and s.status <> 'declined'));
drop policy if exists mgr_read on public.ride_offers; create policy mgr_read on public.ride_offers for select using (manages(event_id));

-- What a person sees once Ronnie sent the ride plan: their car (driver, spot, time, people) — no other cars.
create or replace function public.my_ride(p_event uuid)
returns json language sql stable security definer set search_path = public as $$
  with mine as (select * from ride_offers where event_id = p_event and staff_id = me() and sent_at is not null),
  car as (select coalesce((select car_driver_id from mine where kind = 'rider'), (select staff_id from mine where kind = 'driver')) as driver)
  select case when (select driver from car) is null then null else json_build_object(
    'role', (select kind from mine),
    'driver', (select json_build_object('name', st.full_name, 'phone', st.phone, 'photo', st.photo_url) from staff st where st.id = (select driver from car)),
    'pickup_spot', (select pickup_spot from ride_offers where event_id = p_event and staff_id = (select driver from car)),
    'leave_at', (select leave_at from ride_offers where event_id = p_event and staff_id = (select driver from car)),
    'riders', (select coalesce(json_agg(json_build_object('name', st.full_name, 'phone', st.phone) order by st.full_name), '[]') from ride_offers r join staff st on st.id = r.staff_id
               where r.event_id = p_event and r.kind = 'rider' and r.car_driver_id = (select driver from car) and r.staff_id <> me())
  ) end $$;
grant execute on function public.my_ride(uuid) to authenticated;

-- 25e · Announcements (one-way)
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.staff(id) on delete set null default public.me(),
  event_id uuid references public.events(id) on delete cascade,
  audience jsonb not null default '{}', body text not null default '', media jsonb not null default '[]',
  pinned boolean not null default false, created_at timestamptz not null default now()
);
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  opened_at timestamptz, ack_at timestamptz, primary key (announcement_id, staff_id)
);
alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
drop policy if exists admin_all on public.announcements; create policy admin_all on public.announcements for all using (is_admin()) with check (is_admin());
drop policy if exists recipient_read on public.announcements; create policy recipient_read on public.announcements for select
  using (exists (select 1 from announcement_reads r where r.announcement_id = id and r.staff_id = me()) or sender_id = me() or (event_id is not null and manages(event_id)));
drop policy if exists admin_all on public.announcement_reads; create policy admin_all on public.announcement_reads for all using (is_admin()) with check (is_admin());
drop policy if exists own on public.announcement_reads; create policy own on public.announcement_reads for select using (staff_id = me());
drop policy if exists sender_read on public.announcement_reads; create policy sender_read on public.announcement_reads for select
  using (exists (select 1 from announcements a where a.id = announcement_id and (a.sender_id = me() or (a.event_id is not null and manages(a.event_id)))));

-- Send: managers only to their own event's team, from the day before until the event day ends; admins anywhere.
-- p_audience: {"kind":"event"} | {"kind":"group","start":"<iso>"} | {"kind":"people","ids":[...]} | {"kind":"all"} | {"kind":"day","date":"YYYY-MM-DD"}
create or replace function public.send_announcement(p_event uuid, p_audience jsonb, p_body text, p_media jsonb, p_pinned boolean)
returns uuid language plpgsql security definer set search_path = public as
$$ declare a uuid; d date; k text := coalesce(p_audience->>'kind', 'event'); begin
  if not is_admin() then
    if p_event is null or not manages(p_event) then raise exception 'You can only message your own team.'; end if;
    select event_date into d from events where id = p_event;
    if (now() at time zone 'America/Toronto')::date not between d - 1 and d then raise exception 'You can message your team from the day before until the event ends.'; end if;
    if k not in ('event', 'group') then raise exception 'not allowed'; end if;
  end if;
  insert into announcements(event_id, audience, body, media, pinned) values (p_event, p_audience, coalesce(p_body, ''), coalesce(p_media, '[]'), coalesce(p_pinned, false)) returning id into a;
  insert into announcement_reads(announcement_id, staff_id)
  select distinct a, x.sid from (
    select s.staff_id sid from shifts s where k in ('event', 'group') and s.event_id = p_event and s.status <> 'declined' and s.attendance is null
      and (k = 'event' or s.planned_start = (p_audience->>'start')::timestamptz)
    union select (jsonb_array_elements_text(p_audience->'ids'))::uuid where k = 'people'
    union select st.id from staff st where k = 'all' and st.active
    union select s.staff_id from shifts s join events e on e.id = s.event_id where k = 'day' and e.event_date = (p_audience->>'date')::date and s.status <> 'declined'
  ) x where x.sid is not null and x.sid <> me();
  return a;
end $$;
grant execute on function public.send_announcement(uuid, jsonb, text, jsonb, boolean) to authenticated;

create or replace function public.announcement_seen(p_id uuid, p_ack boolean default false)
returns void language sql security definer set search_path = public as $$
  update announcement_reads set opened_at = coalesce(opened_at, now()), ack_at = case when p_ack then coalesce(ack_at, now()) else ack_at end
   where announcement_id = p_id and staff_id = me() $$;
grant execute on function public.announcement_seen(uuid, boolean) to authenticated;

insert into storage.buckets (id, name, public) values ('announcements', 'announcements', false) on conflict (id) do nothing;
drop policy if exists ann_insert on storage.objects;
drop policy if exists ann_read on storage.objects;
create policy ann_insert on storage.objects for insert to authenticated with check (bucket_id = 'announcements' and (
  public.is_admin() or ((storage.foldername(name))[1] <> 'all' and public.manages(((storage.foldername(name))[1])::uuid))));
create policy ann_read on storage.objects for select to authenticated using (bucket_id = 'announcements' and (
  public.is_admin() or (storage.foldername(name))[1] = 'all' or public.manages(((storage.foldername(name))[1])::uuid) or public.works(((storage.foldername(name))[1])::uuid)));

-- Payroll export: transport events add the paid travel time to each person's hours
create or replace function public.payroll_export(p_token text, p_from date, p_to date)
returns table(event_date date, full_name text, hours numeric, event_title text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'payroll_token') then
    raise exception 'not allowed';
  end if;
  return query
    select e.event_date, st.full_name,
           sum(case when s.left_early then round(extract(epoch from (p.punch_out - p.punch_in)) / 900) * 0.25 else rounded_hours(p.punch_in, p.punch_out) end
               + case when e.transport then coalesce(e.paid_travel_min, 0) / 60.0 else 0 end),
           string_agg(distinct e.title, ', ')
      from punches p join shifts s on s.id = p.shift_id join events e on e.id = s.event_id join staff st on st.id = s.staff_id
     where e.event_date between p_from and p_to and s.attendance is null
       and p.punch_in is not null and p.punch_out is not null and p.punch_out <= now()
     group by e.event_date, st.full_name;
end $$;

select (select count(*) from pg_proc where proname in ('my_ride', 'send_announcement', 'announcement_seen')) fns,
       (select count(*) from venues where always_offer_rides) ride_venues;
