-- 143 · Ask someone already sent to switch to another event (Bookings → Move → Ask first). They answer in the app.
create table if not exists public.switch_asks (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  to_event_id uuid not null references public.events(id) on delete cascade,
  to_code text not null, to_detail text, to_start timestamptz not null,
  from_label text, to_label text,
  status text not null default 'asked' check (status in ('asked', 'yes', 'no', 'cancelled')),
  created_at timestamptz not null default now(), answered_at timestamptz
);
create index if not exists switch_asks_shift on public.switch_asks (shift_id, status);
alter table public.switch_asks enable row level security;
drop policy if exists switch_asks_admin on public.switch_asks;
create policy switch_asks_admin on public.switch_asks for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists switch_asks_own on public.switch_asks;
create policy switch_asks_own on public.switch_asks for select using (staff_id = public.me());

create or replace function public.answer_switch_ask(p_id uuid, p_yes boolean) returns text
language plpgsql security definer set search_path = public as $$
declare a public.switch_asks;
begin
  select * into a from public.switch_asks where id = p_id and staff_id = public.me() and status = 'asked' for update;
  if not found then return 'gone'; end if;
  if p_yes then
    update public.shifts set event_id = a.to_event_id, position_code = a.to_code, position_detail = coalesce(a.to_detail, position_detail),
      planned_start = a.to_start, status = 'confirmed', responded_at = now()
    where id = a.shift_id and staff_id = a.staff_id;
  end if;
  update public.switch_asks set status = case when p_yes then 'yes' else 'no' end, answered_at = now() where id = p_id;
  return case when p_yes then 'moved' else 'kept' end;
end $$;
revoke all on function public.answer_switch_ask(uuid, boolean) from public;
grant execute on function public.answer_switch_ask(uuid, boolean) to authenticated;
select 'RESULT 143 · switch_asks ready · ' || (select count(*) from public.switch_asks) || ' rows' as result;
