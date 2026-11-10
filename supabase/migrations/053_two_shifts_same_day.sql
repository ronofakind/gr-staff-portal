-- Push 46 · Two shifts the same day.
-- Managers can't read other events' shifts under RLS. This returns, for people on an event the caller manages,
-- ONLY the venue + planned start/end of their other G&R shift(s) that same day (no names, notes, punches or pay).
-- Used on the manager's team list: "LEAVES 3:00 PM · Has another G&R shift at 6:00 PM" / "COMING FROM LE ANDOVER".
-- Nothing is dropped; no existing function changes.

create or replace function public.manager_other_shifts(p_event uuid)
returns table (staff_id uuid, venue text, start_at timestamptz, end_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ #variable_conflict use_column
declare d date;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select event_date into d from events where id = p_event;
  return query
    select distinct s2.staff_id, coalesce(e2.title, v.name)::text, s2.planned_start, s2.planned_end
      from shifts s
      join shifts s2 on s2.staff_id = s.staff_id and s2.event_id <> p_event
      join events e2 on e2.id = s2.event_id and e2.event_date = d
      left join venues v on v.id = e2.venue_id
     where s.event_id = p_event and s.status <> 'declined' and s.attendance is null
       and s2.status <> 'declined' and s2.attendance is null
     order by s2.planned_start;
end $$;
revoke all on function public.manager_other_shifts(uuid) from public;
grant execute on function public.manager_other_shifts(uuid) to authenticated;

select pg_get_function_identity_arguments('public.manager_other_shifts'::regproc) as manager_other_shifts_args;
