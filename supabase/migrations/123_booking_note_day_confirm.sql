-- 123 · Day sheet part 3b (Nov 12, 2026 · push 111). Safe to run twice.
-- 1) A note for one person on one shift (the Events sheet's column H: "Laura >4:00PM", "brings the truck"…).
--    Seen by Ronnie (Day sheet) and the MD (Manage, under the name). Not shown to the person.
alter table public.shifts add column if not exists booking_note text;
comment on column public.shifts.booking_note is 'push 111 · Ronnie''s note for this person on this shift (Day sheet). Shown to Ronnie + the MD, not to the person.';

-- 2) Confirm from the Day sheet: everyone placed (floor, bar or both) gets their confirmation; whoever said yes / maybe / was asked
--    and is not placed that day is released (sees nothing, stays as a backup). Same as admin_pool_confirm, with the department.
create or replace function public.admin_day_confirm(p_date date, p_dept text default 'both') returns jsonb
language plpgsql security definer set search_path = public as
$$ declare n_conf int; n_rel int; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_dept not in ('floor', 'bar', 'both') then raise exception 'department: floor, bar or both'; end if;
  update shifts s set pool_hold = false, notified_at = coalesce(s.notified_at, now())
    from events e where e.id = s.event_id and e.event_date = p_date and s.pool_hold and s.status <> 'declined'
     and (p_dept = 'both' or (p_dept = 'bar') = (e.department = 'bar'));
  get diagnostics n_conf = row_count;
  update availability a set released_at = now()
   where a.for_date = p_date and a.released_at is null and a.status in ('yes', 'maybe', 'asked')
     and (p_dept = 'both' or (p_dept = 'bar') = coalesce((select k.department = 'bar' from avail_asks k where k.id = a.ask_id), false))
     and not exists (select 1 from shifts s join events e on e.id = s.event_id
                      where s.staff_id = a.staff_id and e.event_date = p_date and s.status <> 'declined');
  get diagnostics n_rel = row_count;
  return jsonb_build_object('confirmed', n_conf, 'released', n_rel);
end $$;
revoke all on function public.admin_day_confirm(date, text) from public, anon;
grant execute on function public.admin_day_confirm(date, text) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'shifts' and column_name = 'booking_note') || ' of 1 column · '
  || (select count(*) from pg_proc where proname = 'admin_day_confirm') || ' confirm fn';
