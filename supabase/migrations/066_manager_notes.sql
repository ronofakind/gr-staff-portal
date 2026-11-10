-- 066 · Note for the manager (Nov 5, 2026)
-- From Bookings Ronnie sets "has to leave by" (shifts.leave_by, already shown to managers) + a note only managers/MDs/admin see.
-- An approved "leave early" request from the staff app copies their reason into the note.
-- 30 min before leave_by, the managers on that event get a phone alert.
-- Safe to run twice.

create table if not exists public.shift_mgr_notes (
  shift_id   uuid primary key references public.shifts(id) on delete cascade,
  note       text not null,
  by_staff   uuid references public.staff(id),
  updated_at timestamptz not null default now()
);
alter table public.shift_mgr_notes enable row level security;
drop policy if exists smn_read on public.shift_mgr_notes;
create policy smn_read on public.shift_mgr_notes for select to authenticated
  using (is_admin() or exists (select 1 from shifts s where s.id = shift_id and manages(s.event_id)));
drop policy if exists smn_admin on public.shift_mgr_notes;
create policy smn_admin on public.shift_mgr_notes for all to authenticated using (is_admin()) with check (is_admin());

-- one call from Bookings: leave_by (null = clear) + note (empty = clear)
create or replace function public.admin_set_mgr_note(p_shift uuid, p_leave_by timestamptz, p_note text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update shifts set leave_by = p_leave_by where id = p_shift and leave_by is distinct from p_leave_by;
  if nullif(trim(coalesce(p_note, '')), '') is null then delete from shift_mgr_notes where shift_id = p_shift;
  else insert into shift_mgr_notes(shift_id, note, by_staff) values (p_shift, trim(p_note), me())
       on conflict (shift_id) do update set note = excluded.note, by_staff = excluded.by_staff, updated_at = now();
  end if;
end $$;
grant execute on function public.admin_set_mgr_note(uuid, timestamptz, text) to authenticated;

-- approved "leave early" from the staff app → their reason becomes the note (if Ronnie didn't write one)
create or replace function public.change_to_mgr_note() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if new.kind = 'leave_early' and new.status = 'accepted' and old.status is distinct from 'accepted' and nullif(trim(coalesce(new.note, '')), '') is not null then
    insert into shift_mgr_notes(shift_id, note, by_staff) values (new.shift_id, 'They asked: ' || trim(new.note), new.answered_by)
    on conflict (shift_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists change_to_mgr_note on public.shift_change_requests;
create trigger change_to_mgr_note after update on public.shift_change_requests for each row execute function public.change_to_mgr_note();

-- 30 min before leave_by → managers on that event (sent by the regular 5-min alerts run)
create or replace function public.leave_by_tick() returns int
language plpgsql security definer set search_path = public as
$$ declare r record; m uuid; n int := 0; begin
  for r in select s.id, s.staff_id, s.leave_by, e.id ev, e.event_date d, e.manager_id, e.co_manager_ids, x.note
             from shifts s join events e on e.id = s.event_id
             left join punches p on p.shift_id = s.id
             left join shift_mgr_notes x on x.shift_id = s.id
            where s.leave_by > now() and s.leave_by - now() <= interval '35 minutes'
              and s.status in ('booked', 'confirmed') and s.attendance is null and s.cancelled_at is null
              and (p.punch_out is null) and e.hours_submitted_at is null loop
    for m in select distinct y from unnest(array[r.manager_id] || coalesce(r.co_manager_ids, '{}')) y where y is not null and y <> r.staff_id loop
      perform _alert_add(m, 'mgr_late', 'leaveby:' || r.id || ':' || extract(epoch from r.leave_by)::bigint,
        '⏱ ' || _first(r.staff_id) || ' has to leave at ' || _mtl_time(r.leave_by),
        coalesce(_snip(r.note, 90), 'Reminder from Ronnie'), '👉 Tap to see your team', '/manage/' || r.ev, r.d,
        jsonb_build_object('event_id', r.ev, 'shift_id', r.id), '[]', 'gr-leave-' || r.id);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.leave_by_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'gr-leave-by';
select cron.schedule('gr-leave-by', '*/5 * * * *', 'select public.leave_by_tick()');

select 'RESULT ' || (select count(*) from pg_tables where tablename = 'shift_mgr_notes') || ' table · '
    || (select count(*) from pg_proc where proname in ('admin_set_mgr_note', 'change_to_mgr_note', 'leave_by_tick')) || ' fns · '
    || (select count(*) from cron.job where jobname = 'gr-leave-by') || ' job' as result;
