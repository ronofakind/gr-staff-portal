-- No-show / cancelled, set by the event manager (or admin). Hours are cleared.
alter table public.shifts add column if not exists attendance text check (attendance in ('no_show','cancelled'));
alter table public.shifts add column if not exists attendance_at timestamptz;
alter table public.shifts add column if not exists attendance_by uuid references public.staff(id);

create or replace function public.manager_set_attendance(p_shift uuid, p_attendance text)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select event_id into ev from shifts where id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  if p_attendance is not null and p_attendance not in ('no_show','cancelled') then raise exception 'bad value'; end if;
  update shifts set attendance = p_attendance,
    attendance_at = case when p_attendance is null then null else now() end,
    attendance_by = case when p_attendance is null then null else me() end
   where id = p_shift;
  if p_attendance is not null then delete from punches where shift_id = p_shift; end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'attendance', p_shift, jsonb_build_object('attendance', p_attendance));
end $$;
grant execute on function public.manager_set_attendance(uuid, text) to authenticated;
