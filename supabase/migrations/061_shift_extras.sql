-- Nov 4 · extras seen by the manager only.
-- The Bookings board works out who the extras are (over the client count: early finishers first, then lowest ranking)
-- and saves that list here. The manager of the event reads it (EXTRA tag on their team). Staff can't read this table.
create table if not exists public.shift_extras (
  shift_id uuid primary key references public.shifts(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  set_at timestamptz not null default now()
);
create index if not exists shift_extras_event on public.shift_extras(event_id);
alter table public.shift_extras enable row level security;
drop policy if exists admin_all on public.shift_extras;
create policy admin_all on public.shift_extras for all using (is_admin()) with check (is_admin());
drop policy if exists mgr_read on public.shift_extras;
create policy mgr_read on public.shift_extras for select using (manages(event_id));
grant select on public.shift_extras to authenticated;
grant insert, update, delete on public.shift_extras to authenticated;

-- Replace one event's extras with this list of shift ids (admin only).
create or replace function public.admin_set_extras(p_event uuid, p_shifts uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  delete from shift_extras where event_id = p_event and not (shift_id = any(coalesce(p_shifts, '{}')));
  insert into shift_extras (shift_id, event_id)
    select s.id, p_event from shifts s where s.event_id = p_event and s.id = any(coalesce(p_shifts, '{}'))
  on conflict (shift_id) do update set event_id = excluded.event_id;
end $$;
revoke all on function public.admin_set_extras(uuid, uuid[]) from public;
grant execute on function public.admin_set_extras(uuid, uuid[]) to authenticated;
