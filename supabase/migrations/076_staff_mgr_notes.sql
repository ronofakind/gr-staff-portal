-- 076 · 📌 Note for the manager that follows the person (Nov 7, 2026)
-- Bookings → Note for the manager → "Show it for": this shift only (shift_mgr_notes, as before) · her first 3 shifts · every shift until removed.
-- staff_mgr_notes: one note per person. from_date = the date of the shift it was written on; shifts = 3 (or null = always).
-- Managers read it with mgr_staff_notes(event) → shown on that event when it is within the person's first N live shifts from from_date.
-- Safe to run twice.
create table if not exists public.staff_mgr_notes (
  staff_id   uuid primary key references public.staff(id) on delete cascade,
  note       text not null,
  from_date  date not null,
  shifts     int check (shifts is null or shifts between 1 and 20),
  by_staff   uuid references public.staff(id),
  updated_at timestamptz not null default now()
);
alter table public.staff_mgr_notes enable row level security;
drop policy if exists stmn_admin on public.staff_mgr_notes;
create policy stmn_admin on public.staff_mgr_notes for all to authenticated using (is_admin()) with check (is_admin());

-- which of a person's live shifts (from from_date on) is this one? 1 = first
create or replace function public._shift_rank_from(p_staff uuid, p_from date, p_upto date) returns int
language sql stable security definer set search_path = public as
$$ select count(*)::int from shifts s join events e on e.id = s.event_id
    where s.staff_id = p_staff and e.event_date between p_from and p_upto
      and s.status <> 'declined' and s.cancelled_at is null and coalesce(s.attendance, '') <> 'cancelled' $$;

-- managers / MDs / admin of an event: the person notes that apply to it, keyed by shift
create or replace function public.mgr_staff_notes(p_event uuid)
returns table(shift_id uuid, note text) language plpgsql stable security definer set search_path = public as
$$ declare d date; begin
  if not (is_admin() or manages(p_event)) then return; end if;
  select event_date into d from events where id = p_event;
  return query
    select s.id, n.note from shifts s join staff_mgr_notes n on n.staff_id = s.staff_id
     where s.event_id = p_event and d >= n.from_date
       and (n.shifts is null or _shift_rank_from(s.staff_id, n.from_date, d) <= n.shifts);
end $$;
grant execute on function public.mgr_staff_notes(uuid) to authenticated;

-- Bookings save: p_scope 'shift' (as before) · 'first3' · 'always'. Empty note clears both kinds for that person/shift.
create or replace function public.admin_set_mgr_note(p_shift uuid, p_leave_by timestamptz, p_note text, p_scope text default 'shift')
returns void language plpgsql security definer set search_path = public as
$$ declare st uuid; d date; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select s.staff_id, e.event_date into st, d from shifts s join events e on e.id = s.event_id where s.id = p_shift;
  if not found then raise exception 'Shift not found.'; end if;
  update shifts set leave_by = p_leave_by where id = p_shift and leave_by is distinct from p_leave_by;
  if nullif(trim(coalesce(p_note, '')), '') is null then
    delete from shift_mgr_notes where shift_id = p_shift;
    delete from staff_mgr_notes where staff_id = st;
  elsif coalesce(p_scope, 'shift') = 'shift' then
    insert into shift_mgr_notes(shift_id, note, by_staff) values (p_shift, trim(p_note), me())
      on conflict (shift_id) do update set note = excluded.note, by_staff = excluded.by_staff, updated_at = now();
  else
    delete from shift_mgr_notes where shift_id = p_shift;
    insert into staff_mgr_notes(staff_id, note, from_date, shifts, by_staff)
      values (st, trim(p_note), d, case when p_scope = 'first3' then 3 end, me())
      on conflict (staff_id) do update set note = excluded.note, from_date = excluded.from_date, shifts = excluded.shifts, by_staff = excluded.by_staff, updated_at = now();
  end if;
end $$;
grant execute on function public.admin_set_mgr_note(uuid, timestamptz, text, text) to authenticated;
drop function if exists public.admin_set_mgr_note(uuid, timestamptz, text);

select 'RESULT ' || (select count(*) from pg_tables where tablename = 'staff_mgr_notes') || ' table · '
    || (select count(*) from pg_proc where proname in ('mgr_staff_notes', '_shift_rank_from', 'admin_set_mgr_note')) || ' fns' as result;
