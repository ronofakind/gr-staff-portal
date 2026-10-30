-- Push 21 (Oct 30): availability answers = FROM time only (null = any time) + an optional note only admins read.
-- Usual week = Yes / No; a Yes day keeps its usual "from" in staff_weekly.from_time (null = any time).
alter table public.availability add column if not exists note text;
update public.staff_weekly set status = 'yes' where status = 'from';

drop function if exists public.answer_availability(uuid, text, time, time);
create or replace function public.answer_availability(p_id uuid, p_status text, p_from time default null, p_until time default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_status not in ('yes','no') then raise exception 'bad answer'; end if;
  update availability set status = p_status, answered_at = now(),
         from_time = case when p_status = 'yes' then p_from end,
         until_time = null,
         note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_id and staff_id = me();
  if not found then raise exception 'not yours'; end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'availability', p_id, jsonb_build_object('status', p_status, 'from', p_from, 'note', nullif(trim(coalesce(p_note, '')), '')));
end $$;
grant execute on function public.answer_availability(uuid, text, time, time, text) to authenticated;

select count(*) from pg_proc where proname = 'answer_availability';
