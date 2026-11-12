-- 119 · Usual week: Ronnie can change a day, their own times stay visible (Nov 11, 2026 · push 105). Safe to run twice.
-- Ronnie (7:45 PM): "I should be able to change it, but I want to see the times they set as well."
alter table public.staff_weekly add column if not exists set_by_admin boolean not null default false;
alter table public.staff_weekly add column if not exists own_status text;   -- what they had set before Ronnie changed it
alter table public.staff_weekly add column if not exists own_from   time;
alter table public.staff_weekly add column if not exists own_until  time;
-- When they change the day themselves (check-up / profile), it's theirs again.
create or replace function public._weekly_own() returns trigger language plpgsql as
$$ begin
  if not is_admin() then new.set_by_admin := false; new.own_status := null; new.own_from := null; new.own_until := null; end if;
  return new;
end $$;
drop trigger if exists weekly_own on public.staff_weekly;
create trigger weekly_own before insert or update on public.staff_weekly for each row execute function public._weekly_own();
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'staff_weekly' and column_name in ('set_by_admin', 'own_status', 'own_from', 'own_until')) || ' of 4 columns';
