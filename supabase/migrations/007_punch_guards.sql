-- Safety rules for managers entering times (admins are exempt):
--  * never before the event day (Montreal time)
--  * start no earlier than 6 h before the call time
--  * no times in the future
create or replace function public.manager_set_punch(p_shift uuid, p_in timestamptz, p_out timestamptz)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; ev_date date; call_at timestamptz; begin
  select s.event_id, e.event_date, s.planned_start into ev, ev_date, call_at
    from shifts s join events e on e.id = s.event_id where s.id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  if not is_admin() then
    if (now() at time zone 'America/Toronto')::date < ev_date then
      raise exception 'Times can only be entered on the day of the event.';
    end if;
    if p_in is not null and p_in < call_at - interval '6 hours' then
      raise exception 'Start time is more than 6 hours before the call time.';
    end if;
    if (p_in is not null and p_in > now() + interval '10 minutes') or (p_out is not null and p_out > now() + interval '10 minutes') then
      raise exception 'Times in the future can''t be saved.';
    end if;
    if p_in is not null and p_out is not null and p_out <= p_in then
      raise exception 'End time must be after the start time.';
    end if;
  end if;
  insert into punches(shift_id, punch_in, punch_out, edited_by, updated_at)
  values (p_shift, p_in, p_out, me(), now())
  on conflict (shift_id) do update set punch_in = excluded.punch_in, punch_out = excluded.punch_out,
     edited_by = me(), updated_at = now();
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'punch', p_shift, jsonb_build_object('in', p_in, 'out', p_out));
end $$;
