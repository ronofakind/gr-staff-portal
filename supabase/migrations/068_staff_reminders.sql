-- 068 · "Remind me next time I book her" (Nov 6, 2026)
-- staff_reminders: Ronnie-only notes about a staff member that pop up when he books them.
-- shift_staff_notes: when he adds one to her confirmation, the staff member sees it on that shift (Home + event details, must tap Got it).
-- Safe to run twice.

create table if not exists public.staff_reminders (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references public.staff(id) on delete cascade,
  note            text not null,
  conversation_id uuid,
  created_by      uuid references public.staff(id),
  created_at      timestamptz not null default now(),
  status          text not null default 'open' check (status in ('open', 'told', 'sent')),
  shift_id        uuid references public.shifts(id) on delete set null,
  resolved_at     timestamptz
);
create index if not exists staff_reminders_open on public.staff_reminders(staff_id) where status = 'open';
alter table public.staff_reminders enable row level security;
drop policy if exists sr_admin on public.staff_reminders;
create policy sr_admin on public.staff_reminders for all to authenticated using (is_admin()) with check (is_admin());

create table if not exists public.shift_staff_notes (
  shift_id    uuid primary key references public.shifts(id) on delete cascade,
  body        text not null,
  reminder_id uuid references public.staff_reminders(id) on delete set null,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz
);
alter table public.shift_staff_notes enable row level security;
drop policy if exists ssn_read on public.shift_staff_notes;
create policy ssn_read on public.shift_staff_notes for select to authenticated
  using (is_admin() or exists (select 1 from shifts s where s.id = shift_id and s.staff_id = me()));
drop policy if exists ssn_admin on public.shift_staff_notes;
create policy ssn_admin on public.shift_staff_notes for all to authenticated using (is_admin()) with check (is_admin());

-- Ronnie adds the (edited) words to her shift → the reminder is done
create or replace function public.admin_note_to_shift(p_shift uuid, p_body text, p_reminder uuid default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'Write the note first.'; end if;
  insert into shift_staff_notes(shift_id, body, reminder_id) values (p_shift, trim(p_body), p_reminder)
  on conflict (shift_id) do update set body = excluded.body, reminder_id = coalesce(excluded.reminder_id, shift_staff_notes.reminder_id), created_at = now(), seen_at = null;
  if p_reminder is not null then
    update staff_reminders set status = 'sent', shift_id = p_shift, resolved_at = now() where id = p_reminder;
  end if;
end $$;
grant execute on function public.admin_note_to_shift(uuid, text, uuid) to authenticated;

-- the staff member taps Got it
create or replace function public.staff_note_seen(p_shift uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  update shift_staff_notes n set seen_at = now()
   where n.shift_id = p_shift and n.seen_at is null
     and exists (select 1 from shifts s where s.id = p_shift and s.staff_id = me());
end $$;
grant execute on function public.staff_note_seen(uuid) to authenticated;

select 'RESULT ' || (select count(*) from pg_tables where tablename in ('staff_reminders', 'shift_staff_notes')) || ' tables · '
    || (select count(*) from pg_proc where proname in ('admin_note_to_shift', 'staff_note_seen')) || ' fns' as result;
