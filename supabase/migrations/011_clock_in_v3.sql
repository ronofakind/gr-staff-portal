-- Clock-in v3: attendance time (arrived_at) separate from start time (punch_in).
--  * Start before call  → arrived_at = now, punch_in = call time (may be in the future)
--  * Early start        → punch_in = now / picked time (flagged: > 3 h... any time before call chosen on purpose)
--  * After call         → punch_in = arrival rounded up to the next 15 min (late)
--  * End all at a set time → punch_out up to 35 min in the future; cancel clears it
alter table public.punches add column if not exists arrived_at timestamptz;

drop function if exists public.manager_set_punch(uuid, timestamptz, timestamptz);
create or replace function public.manager_set_punch(p_shift uuid, p_in timestamptz, p_out timestamptz, p_arrived timestamptz default null)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; ev_date date; call_at timestamptz; begin
  select s.event_id, e.event_date, s.planned_start into ev, ev_date, call_at
    from shifts s join events e on e.id = s.event_id where s.id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  if not is_admin() then
    if period_closed(ev_date) then
      raise exception 'This pay period is closed. Ask Ronnie to change the time.';
    end if;
    if (now() at time zone 'America/Toronto')::date < ev_date then
      raise exception 'Times can only be entered on the day of the event.';
    end if;
    if p_in is not null and p_in < call_at - interval '6 hours' then
      raise exception 'Start time is more than 6 hours before the call time.';
    end if;
    if p_in is not null and p_in > greatest(call_at, now() + interval '15 minutes') then
      raise exception 'Start time can''t be later than the call time yet.';
    end if;
    if p_out is not null and p_out > now() + interval '35 minutes' then
      raise exception 'End time can be at most 30 minutes from now.';
    end if;
    if p_in is not null and p_out is not null and p_out <= p_in then
      raise exception 'End time must be after the start time.';
    end if;
  end if;
  insert into punches(shift_id, punch_in, punch_out, arrived_at, edited_by, updated_at)
  values (p_shift, p_in, p_out, p_arrived, me(), now())
  on conflict (shift_id) do update set punch_in = excluded.punch_in, punch_out = excluded.punch_out,
     arrived_at = coalesce(excluded.arrived_at, punches.arrived_at), edited_by = me(), updated_at = now();
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'punch', p_shift, jsonb_build_object('in', p_in, 'out', p_out, 'arrived', p_arrived));
end $$;
grant execute on function public.manager_set_punch(uuid, timestamptz, timestamptz, timestamptz) to authenticated;

-- Payroll copy: never count an end time that hasn't happened yet.
create or replace function public.payroll_export(p_token text, p_from date, p_to date)
returns table(event_date date, full_name text, hours numeric, event_title text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'payroll_token') then
    raise exception 'not allowed';
  end if;
  return query
    select e.event_date, st.full_name, sum(rounded_hours(p.punch_in, p.punch_out)), string_agg(distinct e.title, ', ')
      from punches p join shifts s on s.id = p.shift_id join events e on e.id = s.event_id join staff st on st.id = s.staff_id
     where e.event_date between p_from and p_to and s.attendance is null
       and p.punch_in is not null and p.punch_out is not null and p.punch_out <= now()
     group by e.event_date, st.full_name;
end $$;
