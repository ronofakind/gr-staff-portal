-- Name sheet v4 (Oct 30): "Left early" (emergency) + optional reasons for no-show / cancelled / left early.
-- Left early keeps the person on the team (attendance stays null); it only drops the 4-hour minimum.
alter table public.shifts add column if not exists left_early boolean not null default false;
alter table public.shifts add column if not exists attendance_reason text;

-- No-show / cancelled with an optional reason
create or replace function public.manager_set_attendance(p_shift uuid, p_attendance text, p_reason text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  perform manager_set_attendance(p_shift, p_attendance);
  update shifts set attendance_reason = case when p_attendance is null then null else nullif(trim(p_reason), '') end where id = p_shift;
end $$;
grant execute on function public.manager_set_attendance(uuid, text, text) to authenticated;

-- Left early: end time = when they left, paid and billed real hours (no 4-hour minimum)
create or replace function public.manager_set_left_early(p_shift uuid, p_out timestamptz, p_reason text)
returns void language plpgsql security definer set search_path = public as
$$ declare pin timestamptz; begin
  select punch_in into pin from punches where shift_id = p_shift;
  if pin is null then raise exception 'Start them first'; end if;
  if p_out is null or p_out <= pin then raise exception 'The time they left must be after their start'; end if;
  perform manager_set_punch(p_shift, pin, p_out, null);
  update shifts set left_early = true, attendance_reason = nullif(trim(p_reason), '') where id = p_shift;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'attendance', p_shift, jsonb_build_object('left_early', true, 'out', p_out, 'reason', p_reason));
end $$;
grant execute on function public.manager_set_left_early(uuid, timestamptz, text) to authenticated;

create or replace function public.manager_undo_left_early(p_shift uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select event_id into ev from shifts where id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  update shifts set left_early = false, attendance_reason = null where id = p_shift;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'attendance', p_shift, jsonb_build_object('left_early', false));
end $$;
grant execute on function public.manager_undo_left_early(uuid) to authenticated;

-- Payroll copy: left early = real hours
create or replace function public.payroll_export(p_token text, p_from date, p_to date)
returns table(event_date date, full_name text, hours numeric, event_title text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'payroll_token') then
    raise exception 'not allowed';
  end if;
  return query
    select e.event_date, st.full_name,
           sum(case when s.left_early then round(extract(epoch from (p.punch_out - p.punch_in)) / 900) * 0.25 else rounded_hours(p.punch_in, p.punch_out) end),
           string_agg(distinct e.title, ', ')
      from punches p join shifts s on s.id = p.shift_id join events e on e.id = s.event_id join staff st on st.id = s.staff_id
     where e.event_date between p_from and p_to and s.attendance is null
       and p.punch_in is not null and p.punch_out is not null and p.punch_out <= now()
     group by e.event_date, st.full_name;
end $$;

-- Events-sheet feed: left early shows as attendance 'left_early' (the script writes LEFT EARLY in the Note column)
create or replace function public.hours_sheet(p_token text, p_date date)
returns table(event_id uuid, title text, address text, department text, ev_start timestamptz,
              position_code text, full_name text, planned_start timestamptz,
              punch_in timestamptz, punch_out timestamptz, attendance text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'sheet_token') then
    raise exception 'not allowed';
  end if;
  return query
    select e.id, e.title, coalesce(e.address, v.address), e.department,
           min(s.planned_start) over (partition by e.id),
           s.position_code, st.full_name, s.planned_start,
           p.punch_in, case when p.punch_out <= now() then p.punch_out end,
           coalesce(s.attendance, case when s.left_early then 'left_early' end)
      from shifts s join events e on e.id = s.event_id join staff st on st.id = s.staff_id
      left join venues v on v.id = e.venue_id left join punches p on p.shift_id = s.id
     where e.event_date = p_date and s.status <> 'declined'
     order by 5, e.id, s.planned_start, (s.position_code in ('MD','BM')) desc, st.full_name;
end $$;
