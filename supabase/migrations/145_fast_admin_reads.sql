-- 145 · Faster admin reads (Nov 27).
-- For admins, Postgres was still building the staff/manager subqueries on every read of
-- staff, shifts and punches (~0.5 s per staff read). Each non-admin policy now starts with
-- "not admin", so for admins it stops right away. Same rules for everyone else.
alter policy manager_team on public.staff using (
  not (select public.is_admin()) and exists (select 1 from public.shifts s where s.staff_id = staff.id and public.manages(s.event_id))
);
alter policy staff_teammates on public.staff using (
  not (select public.is_admin()) and (
    exists (select 1 from public.shifts s join public.shifts mine on mine.event_id = s.event_id
            where s.staff_id = staff.id and mine.staff_id = (select public.me()))
    or exists (select 1 from public.events e join public.shifts mine on mine.event_id = e.id
               where e.manager_id = staff.id and mine.staff_id = (select public.me()))
  )
);
alter policy staff_shifts on public.shifts using (
  not (select public.is_admin())
  and ((staff_id = (select public.me())) or public.manages(event_id))
  and ((not pool_hold) or coalesce(locked, public.shift_lock_default(position_code, staff_id, event_id)))
);
alter policy staff_punches on public.punches using (
  not (select public.is_admin()) and exists (
    select 1 from public.shifts s
    where s.id = punches.shift_id and ((s.staff_id = (select public.me())) or public.manages(s.event_id))
  )
);
select 'RESULT 145 ok' as result;
