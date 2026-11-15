-- 127 · Nov 15 2026 · one submission per team: once a manager submits a team's hours, the other managers of that team can't submit again.
-- Only the manager who submitted (to fix times) or an admin can resubmit. Atomic: two managers pressing at the same second → first wins.
create or replace function public.manager_submit_hours(p_event uuid)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare t timestamptz := now(); n int; who text; at timestamptz; begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  update events set hours_submitted_at = t, hours_submitted_by = me()
   where id = p_event and (is_admin() or hours_submitted_at is null or hours_submitted_by is not distinct from me());
  get diagnostics n = row_count;
  if n = 0 then
    select e.hours_submitted_at, s.full_name into at, who from events e left join staff s on s.id = e.hours_submitted_by where e.id = p_event;
    raise exception 'Already submitted by % at %', split_part(coalesce(who, 'another manager'), ' ', 1), to_char(at at time zone 'America/Toronto', 'FMHH12:MI AM');
  end if;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'hours_submitted', p_event, jsonb_build_object('at', t));
  return t;
end $$;
revoke all on function public.manager_submit_hours(uuid) from public, anon;
grant execute on function public.manager_submit_hours(uuid) to authenticated;
select 'RESULT ' || (select count(*) from pg_proc where proname = 'manager_submit_hours') || ' fn';
