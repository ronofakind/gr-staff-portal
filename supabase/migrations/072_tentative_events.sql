-- 072 · ⏳ To be confirmed events + Start time to come (Nov 6, 2026)
-- tentative: Ronnie books the team early for an event the client hasn't confirmed. Staff see "To be confirmed" and "Keep the date".
-- start_tbc: venue known, start time not yet → every shift on the event (also ones added later) shows "Time TBC".
-- Safe to run twice.
alter table public.events add column if not exists tentative boolean not null default false;
alter table public.events add column if not exists start_tbc boolean not null default false;

create or replace function public.shift_start_tbc() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if exists (select 1 from events e where e.id = new.event_id and e.start_tbc) then new.time_tbc := true; end if;
  return new;
end $$;
drop trigger if exists shift_start_tbc on public.shifts;
create trigger shift_start_tbc before insert on public.shifts for each row execute function public.shift_start_tbc();

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'events' and column_name in ('tentative', 'start_tbc')) || ' cols · '
    || (select count(*) from pg_trigger where tgname = 'shift_start_tbc') || ' trigger' as result;
