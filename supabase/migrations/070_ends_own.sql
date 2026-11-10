-- 070 · Staff end their own shift (Nov 6, 2026)
-- The manager marks someone "Ends own" (a closer who stays after the manager leaves).
-- They get "End my shift" on their phone: end = the time they tap, rounded up to the next 15 min.
-- Works after midnight (nothing here looks at today's date). Reminder 1 h after the planned end. Safe to run twice.

alter table public.shifts add column if not exists ends_own boolean not null default false;
alter table public.shifts add column if not exists ends_own_by uuid references public.staff(id);

create or replace function public.manager_set_ends_own(p_shift uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select event_id into ev from shifts where id = p_shift;
  if ev is null then raise exception 'Shift not found.'; end if;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  update shifts set ends_own = p_on, ends_own_by = case when p_on then me() else null end where id = p_shift;
end $$;
grant execute on function public.manager_set_ends_own(uuid, boolean) to authenticated;

create or replace function public.staff_end_own(p_shift uuid)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; p punches%rowtype; t timestamptz; begin
  select * into s from shifts where id = p_shift;
  if not found or s.staff_id <> me() then raise exception 'not allowed'; end if;
  if not s.ends_own then raise exception 'Your manager ends your shift tonight.'; end if;
  select * into p from punches where shift_id = p_shift;
  if p.punch_in is null then raise exception 'Your shift hasn''t started yet.'; end if;
  if p.punch_out is not null and p.punch_out <= now() then return p.punch_out; end if;
  t := to_timestamp(ceil(extract(epoch from now()) / 900) * 900);
  update punches set punch_out = t, edited_by = me(), updated_at = now() where shift_id = p_shift;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'punch', p_shift, jsonb_build_object('out', t, 'ends_own', true));
  return t;
end $$;
grant execute on function public.staff_end_own(uuid) to authenticated;

-- 1 h after the planned end (or the event end) and still no end time → buzz them; 2 h → buzz the managers
create or replace function public.ends_own_tick() returns int
language plpgsql security definer set search_path = public as
$$ declare r record; m uuid; n int := 0; fin timestamptz; begin
  for r in select s.id, s.staff_id, s.planned_end, e.id ev, e.event_date d, e.end_time, e.manager_id, e.co_manager_ids, e.title
             from shifts s join events e on e.id = s.event_id join punches p on p.shift_id = s.id
            where s.ends_own and p.punch_in is not null and p.punch_out is null and s.attendance is null
              and e.event_date >= (now() at time zone 'America/Toronto')::date - 2 loop
    fin := coalesce(r.planned_end, case when r.end_time is not null then
             ((r.d + r.end_time) + case when r.end_time < time '08:00' then interval '1 day' else interval '0' end) at time zone 'America/Toronto' end);
    continue when fin is null;
    if now() >= fin + interval '1 hour' then
      perform _alert_add(r.staff_id, 'shift', 'endsown:' || r.id, '🔑 Still working at ' || r.title || '?',
        'Tap End my shift when you’re done.', '👉 Open the app', '/', r.d, jsonb_build_object('shift_id', r.id), '[]', 'gr-endsown-' || r.id);
      n := n + 1;
    end if;
    if now() >= fin + interval '2 hours' then
      for m in select distinct y from unnest(array[r.manager_id] || coalesce(r.co_manager_ids, '{}')) y where y is not null and y <> r.staff_id loop
        perform _alert_add(m, 'mgr_hours', 'endsown-m:' || r.id, '🔑 ' || _first(r.staff_id) || ' hasn’t ended yet',
          r.title || ' · no end time', '👉 Tap to see your team', '/manage/' || r.ev, r.d, jsonb_build_object('event_id', r.ev, 'shift_id', r.id), '[]', 'gr-endsown-m-' || r.id);
      end loop;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ends_own_tick() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'gr-ends-own';
select cron.schedule('gr-ends-own', '*/10 * * * *', 'select public.ends_own_tick()');

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'shifts' and column_name in ('ends_own', 'ends_own_by')) || ' cols · '
    || (select count(*) from pg_proc where proname in ('manager_set_ends_own', 'staff_end_own', 'ends_own_tick')) || ' fns · '
    || (select count(*) from cron.job where jobname = 'gr-ends-own') || ' job' as result;
