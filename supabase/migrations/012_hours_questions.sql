-- "Something wrong?" — staff question about their own hours. Never changes hours by itself.
create table if not exists public.hours_questions (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  kind         text not null check (kind in ('start','end','other')),
  claimed_at   timestamptz,
  note         text,
  status       text not null default 'open' check (status in ('open','fixed','correct')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.staff(id)
);
alter table public.hours_questions enable row level security;
drop policy if exists admin_all on public.hours_questions;
drop policy if exists own_read on public.hours_questions;
drop policy if exists mgr_read on public.hours_questions;
create policy admin_all on public.hours_questions for all using (is_admin()) with check (is_admin());
create policy own_read on public.hours_questions for select using (staff_id = me());
create policy mgr_read on public.hours_questions for select using (
  exists (select 1 from shifts s where s.id = shift_id and manages(s.event_id)));

create or replace function public.ask_hours(p_shift uuid, p_kind text, p_at timestamptz, p_note text)
returns uuid language plpgsql security definer set search_path = public as
$$ declare q uuid; begin
  if not exists (select 1 from shifts where id = p_shift and staff_id = me()) then raise exception 'not your shift'; end if;
  if p_kind not in ('start','end','other') then raise exception 'bad kind'; end if;
  insert into hours_questions(shift_id, staff_id, kind, claimed_at, note)
  values (p_shift, me(), p_kind, p_at, nullif(trim(coalesce(p_note, '')), '')) returning id into q;
  return q;
end $$;
grant execute on function public.ask_hours(uuid, text, timestamptz, text) to authenticated;
