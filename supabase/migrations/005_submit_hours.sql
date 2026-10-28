-- Manager submits the night's hours. Still editable until Ronnie closes the pay period.
alter table public.events add column if not exists hours_submitted_at timestamptz;
alter table public.events add column if not exists hours_submitted_by uuid; -- staff id (no FK on purpose: keeps events→staff joins unambiguous)

create or replace function public.manager_submit_hours(p_event uuid)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare t timestamptz := now(); begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  update events set hours_submitted_at = t, hours_submitted_by = me() where id = p_event;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'hours_submitted', p_event, jsonb_build_object('at', t));
  return t;
end $$;
grant execute on function public.manager_submit_hours(uuid) to authenticated;
