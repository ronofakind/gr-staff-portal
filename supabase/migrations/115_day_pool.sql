-- 115 · Day pool (Nov 11, 2026 · push 97, boards DayPoolV1 + DayPoolNov27V1, mapping "event readiness" #4). Safe to run twice.
-- Multi-event days: people who said yes stay in the day's pool. Ronnie places them on an event (a "pool" shift: staff don't see it)
-- and locks the ones that are final (existing padlock, 055): a locked pool shift shows to staff as "You're on · time to come", no Confirm.
-- ~4 days out, one tap: the pool shifts become normal bookings and get their ONE confirmation; the people still in the pool are
-- released (gone from their app, no message) and stay on the admin side as backups.
alter table public.shifts       add column if not exists pool_hold   boolean not null default false;
alter table public.availability add column if not exists released_at timestamptz;
comment on column public.shifts.pool_hold is 'push 97 · day pool: placed by Ronnie, not confirmed yet. Staff see it only when locked (no Confirm, time to come).';
comment on column public.availability.released_at is 'push 97 · day pool: not placed, released ~4 days out. Hidden from the staff app; admin keeps them as backups.';

-- Staff (and MDs) don't see an unlocked pool shift.
drop policy if exists staff_shifts on public.shifts;
create policy staff_shifts on public.shifts for select using (
  (staff_id = me() or manages(event_id))
  and (not pool_hold or coalesce(locked, shift_lock_default(position_code, staff_id, event_id))));

-- My dates: released dates disappear; an unlocked pool shift doesn't count as booked.
create or replace function public.my_dates(p_staff uuid default null)
returns table(id uuid, for_date date, part text, status text, from_time time, answer_by timestamptz, knows_by date,
              knows_note text, label text, approx_start time, venue text, n_events int, booked boolean)
language sql stable security definer set search_path = public as
$$ select a.id, a.for_date, a.part, a.status, a.from_time, a.answer_by, a.knows_by, a.knows_note,
          k.label, k.approx_start, v.venue, coalesce(v.n, 0),
          exists (select 1 from shifts s join events e on e.id = s.event_id
                   where s.staff_id = a.staff_id and e.event_date = a.for_date
                     and s.status <> 'declined' and s.attendance is distinct from 'cancelled'
                     and (not s.pool_hold or coalesce(s.locked, shift_lock_default(s.position_code, s.staff_id, s.event_id))))
     from availability a
     left join avail_asks k on k.id = a.ask_id
     left join lateral (
       select case when count(*) = 1 and bool_and(not coalesce(e.details_pending, false)) then max(e.title) end as venue,
              count(*)::int as n
         from events e
        where e.event_date = a.for_date
          and case when k.department = 'bar' then e.department = 'bar' else e.department <> 'bar' end) v on true
    where a.staff_id = case when p_staff is not null and is_admin() then p_staff else me() end
      and a.ask_id is not null and a.released_at is null
      and a.for_date >= (now() at time zone 'America/Toronto')::date
    order by a.for_date $$;

-- ~4 days out, one tap: confirm the placed people (one confirmation each) and release the rest of the pool.
create or replace function public.admin_pool_confirm(p_date date) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare n_conf int; n_rel int; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update shifts s set pool_hold = false, notified_at = coalesce(s.notified_at, now())
    from events e where e.id = s.event_id and e.event_date = p_date and e.department <> 'bar' and s.pool_hold and s.status <> 'declined';
  get diagnostics n_conf = row_count;
  update availability a set released_at = now()
   where a.for_date = p_date and a.released_at is null and a.status in ('yes', 'maybe', 'asked')
     and not exists (select 1 from shifts s join events e on e.id = s.event_id
                      where s.staff_id = a.staff_id and e.event_date = p_date and s.status <> 'declined');
  get diagnostics n_rel = row_count;
  return jsonb_build_object('confirmed', n_conf, 'released', n_rel);
end $$;
revoke all on function public.admin_pool_confirm(date) from public, anon;
grant execute on function public.admin_pool_confirm(date) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where (table_name, column_name) in (('shifts', 'pool_hold'), ('availability', 'released_at'))) || ' of 2 columns · '
  || (select count(*) from pg_proc where proname = 'admin_pool_confirm') || ' confirm fn';
