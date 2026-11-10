-- Push 65 · Date asks: toggle "Show the place and start times" (board LaterAskV1, Nov 10).
-- Off by default = same ask as before. On = staff see each event's venue + start times for that date.
alter table public.avail_asks add column if not exists show_times boolean not null default false;

-- One row per event on my asked dates whose ask has show_times on. Venue = event title (never the client).
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
    where a.staff_id = me() and a.for_date >= (now() at time zone 'America/Toronto')::date
    order by a.for_date, e.start_time $$;
grant execute on function public.my_ask_times() to authenticated;
