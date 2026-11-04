-- Push 50 · Padlock: lock people on an event (admin only).
-- File only: apply by hand in the SQL editor. Safe to run twice (add column if not exists / create or replace / drop trigger if exists).
-- Needs 001 (shifts, is_admin, me), 037 (events.co_manager_ids). Nothing is dropped; no existing function changes.
--
-- Rules (Ronnie, Nov 4, from the booking-flow mapping · AdminBookingsV2/V3 padlock):
--   · A lock is per shift (one person on one event). Locked people are never moved or removed by suggestions:
--     Bookings auto-fill, Client change "who comes off", Sheet changes "Approve all", Find replacement / Ask more.
--     Ronnie can still move or remove them by hand (the app asks first).
--   · MDs / managers start locked: position MD or BM, the event lead (events.manager_id) or a co-manager
--     (events.co_manager_ids). Ronnie can unlock them.
--   · Staff never see locks (no staff screen reads these columns; only admins can change them: shifts RLS is admin-only
--     for writes, and the guard below keeps them unchanged for anyone else).
--
-- Design: shifts.locked is a 3-way value.
--   null  = default → locked when MD / BM / lead / co-manager (computed, so it follows the lead if the lead changes)
--   true  = locked by Ronnie
--   false = unlocked by Ronnie (e.g. an MD he wants auto-fill / client change to be able to move)

alter table public.shifts add column if not exists locked boolean;
alter table public.shifts add column if not exists locked_by uuid;
alter table public.shifts add column if not exists locked_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shifts_locked_by_fkey') then
    alter table public.shifts add constraint shifts_locked_by_fkey foreign key (locked_by) references public.staff(id) on delete set null;
  end if;
end $$;
comment on column public.shifts.locked is 'push 50 · padlock. null = default (locked when MD / BM / event lead / co-manager), true = locked, false = unlocked by the admin. Admin only; staff never see it.';

-- The default: MD / BM position, the event lead or a co-manager.
create or replace function public.shift_lock_default(p_code text, p_staff uuid, p_event uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(p_code, '') in ('MD', 'BM')
       or exists (select 1 from events e where e.id = p_event and (e.manager_id = p_staff or p_staff = any(coalesce(e.co_manager_ids, '{}')))) $$;

-- Locked right now (explicit choice wins over the default).
create or replace function public.shift_is_locked(p_shift uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(s.locked, public.shift_lock_default(s.position_code, s.staff_id, s.event_id)) from shifts s where s.id = p_shift $$;

-- Guard + stamp: only an admin changes the lock. Anyone else (a staff / manager RPC) keeps the old value.
-- SQL editor / service role (no auth.uid()) is allowed. Every change stamps locked_by / locked_at.
create or replace function public.shifts_lock_guard() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'UPDATE' and new.locked is not distinct from old.locked then
    new.locked_by := old.locked_by; new.locked_at := old.locked_at; return new;
  end if;
  if tg_op = 'INSERT' and new.locked is null then
    new.locked_by := null; new.locked_at := null; return new;
  end if;
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'UPDATE' then new.locked := old.locked; new.locked_by := old.locked_by; new.locked_at := old.locked_at;
    else new.locked := null; new.locked_by := null; new.locked_at := null; end if;
    return new;
  end if;
  new.locked_by := public.me(); new.locked_at := now();
  return new;
end $$;
drop trigger if exists shifts_lock_guard on public.shifts;
create trigger shifts_lock_guard before insert or update on public.shifts for each row execute function public.shifts_lock_guard();

-- Tap the padlock. Returns the lock as it is now.
create or replace function public.admin_set_lock(p_shift uuid, p_locked boolean) returns boolean
language plpgsql security definer set search_path = public as
$$ begin
  if not public.is_admin() then raise exception 'Only an admin can lock people.'; end if;
  update shifts set locked = p_locked where id = p_shift;
  if not found then raise exception 'That booking no longer exists.'; end if;
  return public.shift_is_locked(p_shift);
end $$;

-- Everyone locked on events between two dates (one call per screen). by_default = locked only because MD / manager.
create or replace function public.admin_locked_shifts(p_from date, p_to date)
returns table (shift_id uuid, by_default boolean)
language sql stable security definer set search_path = public as
$$ select s.id, s.locked is null
     from shifts s join events e on e.id = s.event_id
    where public.is_admin() and e.event_date between p_from and p_to and s.status <> 'declined'
      and coalesce(s.locked, coalesce(s.position_code, '') in ('MD', 'BM') or s.staff_id = e.manager_id or s.staff_id = any(coalesce(e.co_manager_ids, '{}'))) $$;

revoke all on function public.admin_set_lock(uuid, boolean) from public;
revoke all on function public.admin_locked_shifts(date, date) from public;
revoke all on function public.shift_is_locked(uuid) from public;
revoke all on function public.shift_lock_default(text, uuid, uuid) from public;
grant execute on function public.admin_set_lock(uuid, boolean) to authenticated;
grant execute on function public.admin_locked_shifts(date, date) to authenticated;
grant execute on function public.shift_is_locked(uuid) to authenticated;
grant execute on function public.shift_lock_default(text, uuid, uuid) to authenticated;

-- Check: the columns, the functions, and how many upcoming bookings are locked (by default / by you / unlocked).
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shifts' and column_name in ('locked', 'locked_by', 'locked_at')) as lock_columns,
       (select count(*) from pg_proc where proname in ('admin_set_lock', 'admin_locked_shifts', 'shift_is_locked', 'shift_lock_default', 'shifts_lock_guard')) as lock_functions,
       count(*) filter (where s.locked is null and public.shift_lock_default(s.position_code, s.staff_id, s.event_id)) as locked_by_default,
       count(*) filter (where s.locked) as locked_by_you,
       count(*) filter (where s.locked = false) as unlocked_by_you
  from public.shifts s join public.events e on e.id = s.event_id
 where e.event_date >= (now() at time zone 'America/Toronto')::date and s.status <> 'declined';
