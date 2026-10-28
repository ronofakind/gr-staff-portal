-- Time not set yet on the Events sheet
alter table public.shifts add column if not exists time_tbc boolean not null default false;
-- "Needs to leave around…" (reminder only, never ends the shift) and the manager's note
alter table public.shifts add column if not exists leave_by timestamptz;
alter table public.shifts add column if not exists manager_note text;

create or replace function public.manager_set_note(p_shift uuid, p_note text)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select event_id into ev from shifts where id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  update shifts set manager_note = nullif(trim(p_note), '') where id = p_shift;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'note', p_shift, jsonb_build_object('note', p_note));
end $$;
grant execute on function public.manager_set_note(uuid, text) to authenticated;
