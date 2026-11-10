-- Push 68 · Carpool between staff (boards StaffRidesV1 / StaffRidesV2, Nov 10).
-- On events where rides are on (events.rides; Le Andover on by default through the venue). Staff offer seats or ask to
-- carpool with someone driving; the person driving says yes / no. Ronnie still plans everything on the event's Rides screen.
-- Phone numbers + the car chat: only for people in the same car (+ Ronnie), until everyone in the car has finished.
alter table public.ride_offers add column if not exists request_to uuid references public.staff(id) on delete set null;
alter table public.ride_offers add column if not exists request_at timestamptz;
alter table public.ride_offers add column if not exists late_eta timestamptz;
alter table public.ride_offers add column if not exists late_at timestamptz;
alter table public.ride_offers add column if not exists lost_at timestamptz;   -- the person driving cancelled / was taken off

create table if not exists public.ride_chat (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  driver_id uuid not null references public.staff(id) on delete cascade,
  sender_id uuid references public.staff(id) on delete set null default public.me(),
  body text not null check (length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists ride_chat_car on public.ride_chat (event_id, driver_id, created_at);
alter table public.ride_chat enable row level security;

-- Who is in a car (driver + riders placed in it).
create or replace function public._car_members(p_event uuid, p_driver uuid) returns setof uuid
language sql stable security definer set search_path = public as
$$ select staff_id from ride_offers where event_id = p_event and kind = 'driver' and staff_id = p_driver
   union select staff_id from ride_offers where event_id = p_event and kind = 'rider' and car_driver_id = p_driver $$;
-- The car is open (numbers, chat) until everyone in it has punched out (or the event is 1 day past).
create or replace function public._car_open(p_event uuid, p_driver uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from events e where e.id = p_event and e.event_date >= (now() at time zone 'America/Toronto')::date - 1)
      and exists (select 1 from _car_members(p_event, p_driver) m
                   where not exists (select 1 from shifts s join punches p on p.shift_id = s.id
                                      where s.event_id = p_event and s.staff_id = m and p.punch_out is not null)) $$;
create or replace function public._my_car(p_event uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select coalesce((select car_driver_id from ride_offers where event_id = p_event and staff_id = me() and kind = 'rider'),
                   (select staff_id from ride_offers where event_id = p_event and staff_id = me() and kind = 'driver')) $$;

drop policy if exists admin_all on public.ride_chat; create policy admin_all on public.ride_chat for all using (is_admin()) with check (is_admin());
drop policy if exists car_read on public.ride_chat;
create policy car_read on public.ride_chat for select using (driver_id = _my_car(event_id));
drop policy if exists car_post on public.ride_chat;
create policy car_post on public.ride_chat for insert with check (sender_id = me() and driver_id = _my_car(event_id) and _car_open(event_id, driver_id));

create or replace function public._ride_alert(p_staff uuid, p_key text, p_title text, p_body text, p_event uuid) returns void
language sql security definer set search_path = public as
$$ insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, data, for_date)
   select p_staff, 'changed', p_key, p_title, p_body, '👉 Tap to open', '/shift/' || s.id, jsonb_build_object('event_id', p_event), e.event_date
     from events e left join shifts s on s.event_id = e.id and s.staff_id = p_staff and s.status <> 'declined'
    where e.id = p_event limit 1
   on conflict do nothing $$;

-- Staff on the event: who is driving (first name + initial, pickup spot, time, seats left). No phone numbers.
create or replace function public.ride_drivers(p_event uuid)
returns table(staff_id uuid, name text, pickup_spot text, leave_at timestamptz, seats int, taken int, asked boolean)
language sql stable security definer set search_path = public as
$$ select d.staff_id, split_part(st.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(st.full_name, ' ', 2), ''), 1) || '.', ''),
          d.pickup_spot, d.leave_at, coalesce(d.seats, 3),
          (select count(*)::int from ride_offers r where r.event_id = p_event and r.kind = 'rider' and r.car_driver_id = d.staff_id),
          exists (select 1 from ride_offers r where r.event_id = p_event and r.staff_id = me() and r.request_to = d.staff_id)
     from ride_offers d join staff st on st.id = d.staff_id join events e on e.id = d.event_id
    where d.event_id = p_event and d.kind = 'driver' and e.rides and d.staff_id <> me()
      and exists (select 1 from shifts s where s.event_id = p_event and s.staff_id = me() and s.status <> 'declined')
    order by d.leave_at nulls last $$;

-- Rider asks someone driving.
create or replace function public.ride_ask(p_event uuid, p_driver uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare me_id uuid := me(); nm text; begin
  if not exists (select 1 from ride_offers where event_id = p_event and staff_id = me_id and kind = 'rider') then raise exception 'Tap “I need a ride” first.'; end if;
  if not exists (select 1 from ride_offers where event_id = p_event and staff_id = p_driver and kind = 'driver') then raise exception 'They are not driving anymore.'; end if;
  update ride_offers set request_to = p_driver, request_at = now() where event_id = p_event and staff_id = me_id and kind = 'rider' and car_driver_id is null;
  select split_part(full_name, ' ', 1) into nm from staff where id = me_id;
  perform _ride_alert(p_driver, 'carask:' || p_event || ':' || me_id || ':' || extract(epoch from now())::bigint, '🚗 ' || nm || ' would like to carpool',
    (select title from events where id = p_event) || ' · open the app to say yes or no.', p_event);
end $$;
create or replace function public.ride_ask_cancel(p_event uuid) returns void
language sql security definer set search_path = public as
$$ update ride_offers set request_to = null, request_at = null where event_id = p_event and staff_id = me() and kind = 'rider' and car_driver_id is null $$;

-- The person driving: seat requests waiting for me.
create or replace function public.ride_requests(p_event uuid)
returns table(staff_id uuid, name text, coming_from text, request_at timestamptz)
language sql stable security definer set search_path = public as
$$ select r.staff_id, split_part(st.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(st.full_name, ' ', 2), ''), 1) || '.', ''), r.coming_from, r.request_at
     from ride_offers r join staff st on st.id = r.staff_id
    where r.event_id = p_event and r.kind = 'rider' and r.request_to = me() and r.car_driver_id is null order by r.request_at $$;

create or replace function public.ride_answer(p_event uuid, p_rider uuid, p_yes boolean) returns text
language plpgsql security definer set search_path = public as
$$ declare d ride_offers%rowtype; taken int; nm text; begin
  select * into d from ride_offers where event_id = p_event and staff_id = me() and kind = 'driver';
  if d.id is null then raise exception 'You are not driving.'; end if;
  select count(*) into taken from ride_offers where event_id = p_event and kind = 'rider' and car_driver_id = me();
  select split_part(full_name, ' ', 1) into nm from staff where id = me();
  if p_yes then
    if taken >= coalesce(d.seats, 3) then raise exception 'Your car is full.'; end if;
    update ride_offers set car_driver_id = me(), placed_at = now(), sent_at = now(), request_to = null, request_at = null, lost_at = null
     where event_id = p_event and staff_id = p_rider and kind = 'rider' and request_to = me() and car_driver_id is null;
    if not found then return 'gone'; end if;
    perform _ride_alert(p_rider, 'caryes:' || p_event || ':' || p_rider, '🚗 You’re carpooling with ' || nm,
      coalesce(d.pickup_spot, 'Pickup spot in the app') || coalesce(' · ' || to_char(d.leave_at at time zone 'America/Toronto', 'FMHH12:MI AM'), ''), p_event);
    return 'yes';
  end if;
  update ride_offers set request_to = null, request_at = null where event_id = p_event and staff_id = p_rider and kind = 'rider' and request_to = me();
  perform _ride_alert(p_rider, 'carno:' || p_event || ':' || p_rider || ':' || me(), nm || ' can’t take you this time', 'Ask someone else who’s driving, in the app.', p_event);
  return 'no';
end $$;

-- Running late (the person driving): riders + the MD get an alert; Ronnie sees it on Today.
create or replace function public.ride_late(p_event uuid, p_eta timestamptz) returns void
language plpgsql security definer set search_path = public as
$$ declare nm text; r record; mgr uuid; begin
  update ride_offers set late_eta = p_eta, late_at = now() where event_id = p_event and staff_id = me() and kind = 'driver';
  if not found then raise exception 'You are not driving.'; end if;
  select split_part(full_name, ' ', 1) into nm from staff where id = me();
  for r in select staff_id from ride_offers where event_id = p_event and kind = 'rider' and car_driver_id = me() loop
    perform _ride_alert(r.staff_id, 'carlate:' || p_event || ':' || r.staff_id || ':' || extract(epoch from now())::bigint, '⏱ ' || nm || '’s carpool is running late',
      'New time: ' || to_char(p_eta at time zone 'America/Toronto', 'FMHH12:MI AM') || '.', p_event);
  end loop;
  select manager_id into mgr from events where id = p_event;
  if mgr is not null and mgr <> me() then
    perform _ride_alert(mgr, 'carlate:' || p_event || ':mgr:' || me() || ':' || extract(epoch from now())::bigint, '⏱ Carpool late · ' || nm,
      (select count(*) from ride_offers where event_id = p_event and kind = 'rider' and car_driver_id = me()) + 1 || ' people · ETA ' || to_char(p_eta at time zone 'America/Toronto', 'FMHH12:MI AM'), p_event);
  end if;
end $$;

-- My car (rider or driver): people with phone numbers while the car is open.
create or replace function public.my_car(p_event uuid) returns json
language sql stable security definer set search_path = public as
$$ with c as (select _my_car(p_event) as drv)
   select case when (select drv from c) is null then null else json_build_object(
     'driver_id', (select drv from c),
     'open', _car_open(p_event, (select drv from c)),
     'pickup_spot', d.pickup_spot, 'leave_at', d.leave_at, 'seats', d.seats, 'late_eta', d.late_eta,
     'people', (select coalesce(json_agg(json_build_object('id', st.id, 'name', st.full_name, 'driving', st.id = (select drv from c),
                  'phone', case when _car_open(p_event, (select drv from c)) then st.phone end) order by st.id <> (select drv from c), st.full_name), '[]')
                from staff st where st.id in (select _car_members(p_event, (select drv from c))))
   ) end
   from ride_offers d where d.event_id = p_event and d.kind = 'driver' and d.staff_id = (select drv from c) $$;

-- Managers: cars on their event (who rides with whom, late tag). Ronnie uses the Rides screen.
create or replace function public.event_cars(p_event uuid)
returns table(driver_id uuid, driver text, phone text, pickup_spot text, leave_at timestamptz, late_eta timestamptz, riders text[])
language sql stable security definer set search_path = public as
$$ select d.staff_id, st.full_name, st.phone, d.pickup_spot, d.leave_at, d.late_eta,
          array(select s2.full_name from ride_offers r join staff s2 on s2.id = r.staff_id where r.event_id = p_event and r.kind = 'rider' and r.car_driver_id = d.staff_id order by s2.full_name)
     from ride_offers d join staff st on st.id = d.staff_id
    where d.event_id = p_event and d.kind = 'driver' and (is_admin() or manages(p_event))
    order by d.leave_at nulls last $$;

-- New person driving → alert the people still looking. Driver row removed / shift cancelled → riders lose the car.
create or replace function public.ride_offers_after() returns trigger
language plpgsql security definer set search_path = public as
$$ declare r record; nm text; begin
  if tg_op = 'INSERT' and new.kind = 'driver' or (tg_op = 'UPDATE' and new.kind = 'driver' and old.kind is distinct from 'driver') then
    select split_part(full_name, ' ', 1) into nm from staff where id = new.staff_id;
    for r in select staff_id from ride_offers where event_id = new.event_id and kind = 'rider' and car_driver_id is null and staff_id <> new.staff_id loop
      perform _ride_alert(r.staff_id, 'cardrv:' || new.event_id || ':' || new.staff_id || ':' || r.staff_id, '🚗 ' || nm || ' is driving to ' || (select title from events where id = new.event_id),
        'Ask to carpool in the app.', new.event_id);
    end loop;
  end if;
  if tg_op = 'DELETE' and old.kind = 'driver' or (tg_op = 'UPDATE' and old.kind = 'driver' and new.kind <> 'driver') then
    select split_part(full_name, ' ', 1) into nm from staff where id = old.staff_id;
    for r in select staff_id from ride_offers where event_id = old.event_id and kind = 'rider' and car_driver_id = old.staff_id loop
      update ride_offers set car_driver_id = null, sent_at = null, lost_at = now() where event_id = old.event_id and staff_id = r.staff_id;
      perform _ride_alert(r.staff_id, 'carlost:' || old.event_id || ':' || r.staff_id || ':' || extract(epoch from now())::bigint, '🚗 Your carpool with ' || nm || ' is off',
        'We’re working on a solution.', old.event_id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists ride_offers_after on public.ride_offers;
create trigger ride_offers_after after insert or update of kind or delete on public.ride_offers for each row execute function public.ride_offers_after();

-- Shift cancelled / removed → their ride offer goes (and riders are told by the trigger above).
create or replace function public.shifts_drop_ride() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'DELETE' then delete from ride_offers where event_id = old.event_id and staff_id = old.staff_id; return old; end if;
  if (new.status = 'declined' or new.attendance = 'cancelled' or new.cancelled_at is not null) and not (old.status = 'declined' or old.attendance = 'cancelled' or old.cancelled_at is not null) then
    delete from ride_offers where event_id = new.event_id and staff_id = new.staff_id;
  end if;
  return new;
end $$;
drop trigger if exists shifts_drop_ride on public.shifts;
create trigger shifts_drop_ride after update of status, attendance, cancelled_at or delete on public.shifts for each row execute function public.shifts_drop_ride();

grant execute on function public.ride_drivers(uuid), public.ride_ask(uuid, uuid), public.ride_ask_cancel(uuid), public.ride_requests(uuid),
  public.ride_answer(uuid, uuid, boolean), public.ride_late(uuid, timestamptz), public.my_car(uuid), public.event_cars(uuid) to authenticated;
