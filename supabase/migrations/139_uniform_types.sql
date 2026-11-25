-- 139 · Uniforms you add on the New event page are saved for next time (men + women lists) · Set-up event type
create table if not exists public.uniform_types (
  name text primary key,
  created_at timestamptz not null default now()
);
alter table public.uniform_types enable row level security;
drop policy if exists admin_all on public.uniform_types;
create policy admin_all on public.uniform_types for all using (is_admin()) with check (is_admin());
insert into public.uniform_types (name)
  select distinct substr(u, 8) from (
    select unnest(array[uniform_floor, uniform_bar, uniform_floor_w, uniform_bar_w]) u from public.events
  ) x where u like 'custom:_%' on conflict do nothing;
insert into public.event_types (name, sort, main) values ('Set-up', 8, true) on conflict (name) do nothing;
select 'RESULT 139 · ' || (select count(*) from public.uniform_types) || ' uniforms · set-up ' || (select count(*) from public.event_types where name = 'Set-up') as result;
