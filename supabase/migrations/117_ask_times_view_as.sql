-- 117 · Asked-for-a-shift shows right everywhere (Nov 11, 2026 · push 102). Safe to run twice.
-- Ronnie (7:36 PM, viewing as Heidi): "why does it say 2 events · evening?" → View as showed Ronnie's own ask times, not hers.
-- my_ask_times now takes the staff member (admins only, like my_dates) and says which asks are for one shift.
drop function if exists public.my_ask_times();
create or replace function public.my_ask_times(p_staff uuid default null)
returns table(avail_id uuid, venue text, starts text[], shift boolean)
language sql stable security definer set search_path = public as
$$ with who as (select case when p_staff is not null and is_admin() then p_staff else me() end as id)
   select a.id, e.title,
          coalesce(nullif(array(select distinct x from unnest(array(
            select left(l->>'start', 5) from jsonb_array_elements(coalesce(e.staffing, '[]'::jsonb)) l
             where coalesce(l->>'code', '') not in ('MD', 'BM') and coalesce((l->>'count')::int, 0) > 0 and l->>'start' is not null)) x order by x), '{}'),
                   array[left(e.start_time::text, 5)]), false
     from availability a
     join avail_asks k on k.id = a.ask_id and k.show_times
     join events e on e.event_date = a.for_date
                  and case when k.department = 'bar' then e.department = 'bar' else e.department <> 'bar' end
                  and not coalesce(e.details_pending, false)
    where a.staff_id = (select id from who) and a.event_id is null and a.for_date >= (now() at time zone 'America/Toronto')::date
   union all
   select a.id, case when coalesce(e.details_pending, false) then 'Venue TBC' else e.title end,
          case when a.event_start is null or coalesce(e.details_pending, false) then '{}'::text[] else array[left(a.event_start::text, 5)] end, true
     from availability a join events e on e.id = a.event_id
    where a.staff_id = (select id from who) and a.for_date >= (now() at time zone 'America/Toronto')::date $$;
revoke all on function public.my_ask_times(uuid) from public, anon;
grant execute on function public.my_ask_times(uuid) to authenticated;
select 'RESULT ' || (select count(*) from pg_proc where proname = 'my_ask_times') || ' fn';
