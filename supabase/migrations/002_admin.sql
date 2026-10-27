-- Admin dashboard: event times/headcount, pending-change tracking on shifts.
alter table public.events
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists staff_needed int not null default 0;

alter table public.shifts
  add column if not exists changed_at timestamptz not null default now(),
  add column if not exists notified_at timestamptz;

create or replace function public.touch_shift() returns trigger language plpgsql as
$$ begin
  if new.event_id is distinct from old.event_id or new.planned_start is distinct from old.planned_start
     or new.position_code is distinct from old.position_code or new.position_detail is distinct from old.position_detail then
    new.changed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists shifts_touch on public.shifts;
create trigger shifts_touch before update on public.shifts for each row execute function public.touch_shift();
