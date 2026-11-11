-- 108 · "Time TBC" follows the event (Nov 10, 2026). Safe to run twice.
-- A shift added while its event's start was TBC kept time_tbc = true after the event got its time (Benjamin, Sat Nov 14:
-- booked 4:00 PM, app said TBC). Now: when an event stops being TBC / details-to-come, all its shifts drop the flag.
create or replace function public.events_tbc_follow() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if (coalesce(old.start_tbc, false) or coalesce(old.details_pending, false))
     and not coalesce(new.start_tbc, false) and not coalesce(new.details_pending, false)
     and not (coalesce(new.staffing, '[]'::jsonb)::text like '%"tbc": true%') then
    update shifts set time_tbc = false where event_id = new.id and time_tbc;
  end if;
  return new;
end $$;
drop trigger if exists events_tbc_follow on public.events;
create trigger events_tbc_follow after update of start_tbc, details_pending on public.events for each row execute function public.events_tbc_follow();

-- One-time cleanup: shifts still TBC on events that have their times (6 on Nov 10: Benjamin Nov 14 / 27 / 28, Pepe Nov 22 / 27, Nicholas Nov 28).
select set_config('gr.quiet', '1', true);
update shifts s set time_tbc = false
  from events e
 where e.id = s.event_id and s.time_tbc and e.event_date >= current_date
   and not coalesce(e.start_tbc, false) and not coalesce(e.details_pending, false)
   and not (coalesce(e.staffing, '[]'::jsonb)::text like '%"tbc": true%');

select 'RESULT ' || (select count(*) from pg_trigger where tgname = 'events_tbc_follow') || ' trigger · '
  || (select count(*) from shifts s join events e on e.id = s.event_id where s.time_tbc and e.event_date >= current_date and not coalesce(e.start_tbc, false) and not coalesce(e.details_pending, false)) || ' stale TBC left';
