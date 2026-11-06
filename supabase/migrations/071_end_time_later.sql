-- 071 · Phone died? Enter the end time later (Nov 6, 2026)
-- Someone who ends their own shift (070) can send their end time afterwards (up to 3 days), flagged for the manager + Ronnie.
-- Safe to run twice.

alter table public.punches add column if not exists late_entry_at timestamptz;
alter table public.punches add column if not exists late_reason text;
alter table public.punches add column if not exists late_ok_by uuid references public.staff(id);
alter table public.punches add column if not exists late_ok_at timestamptz;
alter table public.punches add column if not exists late_admin_seen_at timestamptz;

create or replace function public.staff_end_later(p_shift uuid, p_out timestamptz, p_reason text default null)
returns void language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; p punches%rowtype; begin
  select * into s from shifts where id = p_shift;
  if not found or s.staff_id <> me() then raise exception 'not allowed'; end if;
  if not s.ends_own then raise exception 'Your manager ends your shift. Ask them to fix the time.'; end if;
  select * into p from punches where shift_id = p_shift;
  if p.punch_in is null then raise exception 'Your shift hasn''t started.'; end if;
  if p.punch_out is not null and p.punch_out <= now() then raise exception 'Your end time is already in.'; end if;
  if p.punch_in < now() - interval '4 days' then raise exception 'Too long ago. Message Ronnie with your time.'; end if;
  if p_out <= p.punch_in then raise exception 'The end has to be after your start.'; end if;
  if p_out > now() + interval '1 minute' then raise exception 'The end can''t be in the future.'; end if;
  update punches set punch_out = p_out, late_entry_at = now(), late_reason = nullif(trim(coalesce(p_reason, '')), ''),
         late_ok_by = null, late_ok_at = null, late_admin_seen_at = null, edited_by = me(), updated_at = now()
   where shift_id = p_shift;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'punch', p_shift, jsonb_build_object('out', p_out, 'entered_later', true, 'reason', p_reason));
end $$;
grant execute on function public.staff_end_later(uuid, timestamptz, text) to authenticated;

create or replace function public.manager_ok_late(p_shift uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select event_id into ev from shifts where id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  update punches set late_ok_by = me(), late_ok_at = now(), late_admin_seen_at = case when is_admin() then now() else late_admin_seen_at end where shift_id = p_shift;
end $$;
grant execute on function public.manager_ok_late(uuid) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'punches' and column_name like 'late_%') || ' cols · '
    || (select count(*) from pg_proc where proname in ('staff_end_later', 'manager_ok_late')) || ' fns' as result;
