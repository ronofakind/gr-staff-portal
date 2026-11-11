-- 113 · Bar count: the bar manager changes tonight's quantities (Nov 11, 2026 · push 92, mapping "bar venue lists" part 2). Safe to run twice.
-- The BEO fills the list once, 8 AM the morning of the event; after that the bar manager (or Ronnie) changes a quantity, adds or removes a bottle.
-- Every quantity change is logged; only admins see that history.
alter table public.bar_counts add column if not exists plan jsonb not null default '{}'; -- {item_id: qty} · wins over the BEO quantity

create table if not exists public.bar_plan_log (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  item_id uuid not null references public.bar_items(id) on delete cascade,
  was numeric, now numeric,
  by_staff uuid references public.staff(id) on delete set null default public.me(),
  at timestamptz not null default now()
);
create index if not exists bar_plan_log_event on public.bar_plan_log (event_id, at);
alter table public.bar_plan_log enable row level security;
drop policy if exists admin_all on public.bar_plan_log;
create policy admin_all on public.bar_plan_log for all using (is_admin()) with check (is_admin());

-- tonight's quantity for one bottle: the bar manager's number, else the BEO's
create or replace function public._bar_planned(p_event uuid, p_item uuid) returns numeric
language sql stable security definer set search_path = public as
$$ select coalesce((c.plan->>p_item::text)::numeric,
         (select (x->>'qty')::numeric from jsonb_array_elements(coalesce(c.beo, '[]')) x join bar_items i on i.id = p_item and i.catalog_id = (x->>'catalog_id')::uuid limit 1))
     from bar_counts c where c.event_id = p_event $$;

create or replace function public.bar_plan_set(p_event uuid, p_item uuid, p_qty numeric) returns numeric
language plpgsql security definer set search_path = public as
$$ declare was numeric; v numeric := case when p_qty is null or p_qty < 0 then null else round(p_qty * 4) / 4 end; begin
  if not _can_bar_count(p_event) then raise exception 'Only the bar manager or MD of this bar event can change it.'; end if;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  was := _bar_planned(p_event, p_item);
  if was is not distinct from v then return v; end if;
  update bar_counts set plan = case when v is null then plan - p_item::text else plan || jsonb_build_object(p_item::text, v) end,
         items = case when p_item = any(coalesce(items, '{}')) then items else coalesce(items, '{}') || p_item end, updated_at = now()
   where event_id = p_event;
  insert into bar_plan_log(event_id, item_id, was, now) values (p_event, p_item, was, v);
  return v;
end $$;
revoke all on function public.bar_plan_set(uuid, uuid, numeric) from public, anon;
grant execute on function public.bar_plan_set(uuid, uuid, numeric) to authenticated;

-- Count screen: BEO + the bar manager's quantities (qty = what to show per bottle, mine = changed in the app) + history for admins.
create or replace function public.bar_count_beo(p_event uuid) returns json
language sql stable security definer set search_path = public as
$$ select case when not _can_bar_count(p_event) then null else (
     select json_build_object('name', c.beo_name, 'read_at', c.beo_read_at, 'file', c.beo_file,
       'changes', (select coalesce(json_agg(json_build_object('name', k.name || coalesce(' · ' || k.size, ''), 'was', (p->>'qty')::numeric, 'now', (x->>'qty')::numeric)), '[]')
                     from jsonb_array_elements(coalesce(c.beo, '[]')) x join bar_catalog k on k.id = (x->>'catalog_id')::uuid
                     left join lateral (select y as p from jsonb_array_elements(coalesce(c.beo_prev, '[]')) y where y->>'catalog_id' = x->>'catalog_id' limit 1) pp on true
                    where c.beo_prev is not null and (p is null or (p->>'qty') is distinct from (x->>'qty'))),
       'qty', (select coalesce(json_object_agg(i.id, _bar_planned(p_event, i.id)), '{}') from bar_items i
                where i.id = any(coalesce(c.items, '{}')) and _bar_planned(p_event, i.id) is not null),
       'mine', (select coalesce(json_agg(k), '[]') from jsonb_object_keys(c.plan) k),
       'history', case when is_admin() then (select coalesce(json_agg(json_build_object('at', l.at, 'by', s.full_name, 'item', i.name || coalesce(' · ' || i.size, ''), 'was', l.was, 'now', l.now) order by l.at desc), '[]')
                    from bar_plan_log l join bar_items i on i.id = l.item_id left join staff s on s.id = l.by_staff where l.event_id = p_event) end)
       from bar_counts c where c.event_id = p_event and (c.beo is not null or c.plan <> '{}')) end $$;
revoke all on function public.bar_count_beo(uuid) from public, anon;
grant execute on function public.bar_count_beo(uuid) to authenticated;

select 'RESULT plan column ' || (select count(*) from information_schema.columns where table_name = 'bar_counts' and column_name = 'plan')
  || ' · log table ' || (select count(*) from information_schema.tables where table_name = 'bar_plan_log')
  || ' · fns ' || (select count(*) from pg_proc where proname in ('bar_plan_set', '_bar_planned', 'bar_count_beo')) || ' of 3';
