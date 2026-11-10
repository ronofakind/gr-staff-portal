-- Fixes chat, Nov 3 (Ronnie): staff can close the Home "Add an emergency contact" card.
--   Remind me later → hidden for 14 days, then back once.  I'd rather not → hidden for good.
--   Adding a contact (Home card or Profile row) clears both.
alter table public.staff_private add column if not exists emergency_snooze_until timestamptz;
alter table public.staff_private add column if not exists emergency_declined_at timestamptz;

create or replace function public.set_emergency_reminder(p_choice text)
returns void language plpgsql security definer set search_path = public as
$$ declare sid uuid := me();
begin
  if sid is null then raise exception 'not signed in'; end if;
  if p_choice not in ('later', 'never', 'clear') then raise exception 'bad choice'; end if;
  insert into staff_private (staff_id) values (sid) on conflict (staff_id) do nothing;
  update staff_private set
    emergency_snooze_until = case p_choice when 'later' then now() + interval '14 days' else null end,
    emergency_declined_at  = case p_choice when 'never' then now() else null end
   where staff_id = sid;
end $$;
revoke all on function public.set_emergency_reminder(text) from public;
grant execute on function public.set_emergency_reminder(text) to authenticated;

-- my_checkup (040) + the two new fields (same signature → create or replace).
create or replace function public.my_checkup()
returns jsonb language sql stable security definer set search_path = public as
$$ select case when me() is null then null else jsonb_build_object(
     'step',                   coalesce(sp.checkup_step, 1),
     'done_at',                sp.checkup_done_at,
     'emergency_name',         sp.emergency_name,
     'emergency_relation',     sp.emergency_relation,
     'emergency_phone',        sp.emergency_phone,
     'neighbourhood',          sp.neighbourhood,
     'languages',              coalesce(sp.languages, '{}'::jsonb),
     'usual_week_skipped_at',  sp.usual_week_skipped_at,
     'emergency_snooze_until', sp.emergency_snooze_until,
     'emergency_declined_at',  sp.emergency_declined_at) end
   from (select 1) one left join staff_private sp on sp.staff_id = me() $$;
