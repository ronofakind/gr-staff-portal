-- 116 · Ask one person for one shift (Nov 11, 2026 · push 101). Safe to run twice.
-- Ronnie: in Ask more people (and on the Bookings board) search a name, pick the shift if he knows it.
--   Shift picked  → she sees the place + time; her yes puts her on that shift.
--   No shift      → an ask for the day, like before (she says yes and from when).
-- No phone alert: she sees it in the app.
alter table public.availability add column if not exists event_id    uuid references public.events(id) on delete set null;
alter table public.availability add column if not exists event_start time;
alter table public.availability add column if not exists event_role  text;
alter table public.availability add column if not exists direct      boolean not null default false; -- asked by name: no phone alert (Ronnie, Nov 11)
comment on column public.availability.event_id is 'push 101 · asked for this event (one shift). Yes = booked on it.';

-- What staff see on that date: the place + the start time of the shift they were asked for.
create or replace function public.my_ask_times()
returns table(avail_id uuid, venue text, starts text[])
language sql stable security definer set search_path = public as
$$ select a.id, e.title,
          coalesce(nullif(array(select distinct x from unnest(array(
            select left(l->>'start', 5) from jsonb_array_elements(coalesce(e.staffing, '[]'::jsonb)) l
             where coalesce(l->>'code', '') not in ('MD', 'BM') and coalesce((l->>'count')::int, 0) > 0 and l->>'start' is not null)) x order by x), '{}'),
                   array[left(e.start_time::text, 5)])
     from availability a
     join avail_asks k on k.id = a.ask_id and k.show_times
     join events e on e.event_date = a.for_date
                  and case when k.department = 'bar' then e.department = 'bar' else e.department <> 'bar' end
                  and not coalesce(e.details_pending, false)
    where a.staff_id = me() and a.event_id is null and a.for_date >= (now() at time zone 'America/Toronto')::date
   union all
   select a.id, case when coalesce(e.details_pending, false) then 'Venue TBC' else e.title end,
          case when a.event_start is null or coalesce(e.details_pending, false) then '{}'::text[] else array[left(a.event_start::text, 5)] end
     from availability a join events e on e.id = a.event_id
    where a.staff_id = me() and a.for_date >= (now() at time zone 'America/Toronto')::date $$;
grant execute on function public.my_ask_times() to authenticated;

-- Yes on a one-shift ask → she goes on that shift. Multi-event day: placed + locked in the day pool (she sees "You're on",
-- confirmed with the others ~4 days out). Single-event day: a normal booking.
create or replace function public._ask_yes_book() returns trigger language plpgsql security definer set search_path = public as
$$ declare e events%rowtype; n int; st time; begin
  if new.status <> 'yes' or new.event_id is null or old.status is not distinct from 'yes' then return new; end if;
  select * into e from events where id = new.event_id;
  if e.id is null then return new; end if;
  if exists (select 1 from shifts s join events x on x.id = s.event_id where s.staff_id = new.staff_id and x.event_date = new.for_date
              and s.status <> 'declined' and s.attendance is distinct from 'cancelled') then return new; end if;
  select count(*) into n from events x where x.event_date = e.event_date
     and case when e.department = 'bar' then x.department = 'bar' else x.department <> 'bar' end;
  st := greatest(coalesce(new.event_start, e.start_time, '17:00'), coalesce(new.from_time, '00:00'));
  insert into shifts(event_id, staff_id, position_code, position_detail, planned_start, status, pool_hold, locked, time_tbc)
  values (e.id, new.staff_id, coalesce(new.event_role, case when e.department = 'bar' then 'BT' else 'W' end),
          case coalesce(new.event_role, case when e.department = 'bar' then 'BT' else 'W' end) when 'W' then 'Waiter' when 'BT' then 'Bartender' when 'BB' then 'Barback' when 'BUS' then 'Busboy' when 'WW' then 'Wine waiter' else null end,
          ((e.event_date + st)::timestamp at time zone 'America/Toronto'), 'booked',
          n > 1, case when n > 1 then true else null end, coalesce(e.details_pending, false) or coalesce(e.start_tbc, false));
  return new;
end $$;
drop trigger if exists ask_yes_book on public.availability;
create trigger ask_yes_book after update of status on public.availability for each row execute function public._ask_yes_book();

-- Asked by name: no "Dates to answer" phone alert; she sees it in the app (My dates + Home). Ronnie alerts by hand if no answer.
create or replace function public.alerts_on_dates() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  begin
    if new.status = 'asked' and new.ask_id is not null and not coalesce(new.direct, false) and (new.answer_by is null or new.answer_by > now())
       and (tg_op = 'INSERT' or old.ask_id is distinct from new.ask_id or old.status <> 'asked') then
      perform _alert_add(new.staff_id, 'dates', 'dates:' || new.ask_id, '📅 Dates to answer', 'Answer by {by}',
        '👉 Tap to answer', '/my-dates', null, jsonb_build_object('by', new.answer_by), '[]', 'gr-dates');
    end if;
  exception when others then raise warning 'alerts_on_dates: %', sqlerrm;
  end;
  return null;
end $$;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'availability' and column_name in ('event_id', 'event_start', 'event_role', 'direct')) || ' of 4 columns · trigger '
  || (select count(*) from pg_trigger where tgname = 'ask_yes_book');
