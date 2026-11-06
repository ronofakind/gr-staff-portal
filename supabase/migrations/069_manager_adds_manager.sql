-- 069 · A manager can add / remove another manager from My team (Nov 6, 2026)
-- Same as the admin "Also managing" (events.co_manager_ids, 037), but the lead or a co-manager can do it,
-- only for someone with a live shift on that event. Safe to run twice.

alter table public.events add column if not exists co_manager_by jsonb not null default '{}';

create or replace function public.manager_set_comanager(p_event uuid, p_staff uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as
$$ declare e events%rowtype; begin
  select * into e from events where id = p_event for update;
  if not found then raise exception 'Event not found.'; end if;
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if p_on then
    if p_staff = e.manager_id then return; end if;
    if not exists (select 1 from shifts s where s.event_id = p_event and s.staff_id = p_staff and s.status <> 'declined' and s.attendance is distinct from 'cancelled')
      then raise exception 'Only someone on this team can be a manager.'; end if;
    update events set co_manager_ids = (select array_agg(distinct x) from unnest(coalesce(co_manager_ids, '{}') || p_staff) x),
                      co_manager_by = coalesce(co_manager_by, '{}') || jsonb_build_object(p_staff::text, me())
     where id = p_event;
  else
    update events set co_manager_ids = array_remove(coalesce(co_manager_ids, '{}'), p_staff), co_manager_by = coalesce(co_manager_by, '{}') - p_staff::text
     where id = p_event;
  end if;
end $$;
grant execute on function public.manager_set_comanager(uuid, uuid, boolean) to authenticated;

select 'RESULT ' || (select count(*) from pg_proc where proname = 'manager_set_comanager') || ' fn · '
    || (select count(*) from information_schema.columns where table_name = 'events' and column_name = 'co_manager_by') || ' col' as result;
