-- 140 · Food by can be TBC (staff see "Food by TBC" until the caterer is picked)
alter table public.events add column if not exists caterer_tbc boolean not null default false;
create or replace function public._event_caterer_name() returns trigger language plpgsql security definer set search_path = public as
$$ begin
  if new.caterer_id is null then new.caterer_name := case when new.caterer_tbc then 'TBC' else null end;
  elsif tg_op = 'INSERT' or new.caterer_id is distinct from old.caterer_id or new.caterer_name is null or new.caterer_name = 'TBC' then
    select coalesce(nullif(trim(caterer_label), ''), name) into new.caterer_name from clients where id = new.caterer_id;
  end if;
  return new;
end $$;
drop trigger if exists event_caterer_name on public.events;
create trigger event_caterer_name before insert or update of caterer_id, caterer_tbc on public.events for each row execute function public._event_caterer_name();
select 'RESULT 140 · ' || (select count(*) from information_schema.columns where table_schema='public' and table_name='events' and column_name='caterer_tbc') || ' col · trigger ' || (select count(*) from pg_trigger where tgname='event_caterer_name') as result;
