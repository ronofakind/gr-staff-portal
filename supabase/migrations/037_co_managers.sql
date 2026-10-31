-- Oct 31: a second (closing) manager on an event. Benjamin leaves early tonight; Isaac closes.
-- Anyone in co_manager_ids gets the same manager tools as manager_id (manages() is used by every manager RLS rule / RPC).
alter table public.events add column if not exists co_manager_ids uuid[] not null default '{}';

create or replace function public.manages(ev uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from events where id = ev and (manager_id = public.me() or public.me() = any(co_manager_ids))) $$;

select count(*) filter (where cardinality(co_manager_ids) > 0) as events_with_co_managers from public.events;
