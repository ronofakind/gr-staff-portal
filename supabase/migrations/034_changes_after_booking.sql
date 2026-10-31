-- Push 28 (Oct 31): changes after booking.
--   28b staff cancel their own shift · 28c last-minute cancel → manager list (no-show) + replacements
--   28d schedule-change requests · 28e running late · 28f extras & cancellations (+ EXTRAS LOG feed for the Events-sheet script)
-- Nothing is dropped. No existing RPC changes signature (manager_team_info / hours_sheet are untouched).
--
-- "Status cancelled" = the existing shifts.attendance = 'cancelled' (check from 004). shifts.status keeps
-- booked | confirmed | declined so "had confirmed" (status = 'confirmed', responded_at) survives the cancel and
-- every screen that already hides attendance <> null keeps working.

-- ───────── 28b / 28c · shift columns ─────────
alter table public.shifts add column if not exists cancelled_at timestamptz;
alter table public.shifts add column if not exists cancel_reason text;                 -- Sick · Emergency · Transport · Other · Time change
alter table public.shifts add column if not exists cancel_note text;                   -- optional note for Ronnie
alter table public.shifts add column if not exists cancel_self boolean not null default false;  -- the person cancelled (or asked for the change) themselves
alter table public.shifts add column if not exists cancel_late boolean not null default false;  -- counts in Reliability as a late cancel (= had confirmed)
alter table public.shifts add column if not exists cancel_sent_to_manager timestamptz; -- Ronnie sent it to the manager (null = manager does not see the person)
alter table public.shifts add column if not exists replacement_for uuid;               -- this shift replaces that (cancelled) shift
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shifts_replacement_for_fkey') then
    alter table public.shifts add constraint shifts_replacement_for_fkey foreign key (replacement_for) references public.shifts(id) on delete set null;
  end if;
end $$;
create index if not exists shifts_replacement_for_idx on public.shifts (replacement_for) where replacement_for is not null;
create index if not exists shifts_cancelled_at_idx on public.shifts (cancelled_at) where cancelled_at is not null;
comment on column public.shifts.cancel_self is 'push 28 · staff cancelled it themselves (Can''t make it / I can''t / time change taken off). Hidden from the manager list until cancel_sent_to_manager.';
comment on column public.shifts.cancel_late is 'push 28 · counts in Reliability as a late cancel. Self-cancel: true when the shift was confirmed. Take off and replace: the "Count in reliability" switch.';
comment on column public.shifts.cancel_sent_to_manager is 'push 28c · Ronnie tapped "Send to <manager>": the manager list shows the person crossed out (CANCELLED · NO-SHOW · FROM RONNIE).';

-- Staff: cancel my own shift (contractors, no approval). Before it starts only.
create or replace function public.staff_cancel_shift(p_shift uuid, p_reason text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; pin timestamptz; was_confirmed boolean;
begin
  select * into s from shifts where id = p_shift for update;
  if not found or s.staff_id is distinct from me() then raise exception 'not your shift'; end if;
  if s.status = 'declined' or s.attendance is not null then raise exception 'This shift is already off your schedule.'; end if;
  select punch_in into pin from punches where shift_id = p_shift;
  if pin is not null or s.planned_start <= now() then raise exception 'Your shift has started. Call your manager.'; end if;
  if p_reason is not null and p_reason not in ('Sick', 'Emergency', 'Transport', 'Other') then raise exception 'bad reason'; end if;
  was_confirmed := s.status = 'confirmed';
  update shifts set attendance = 'cancelled', attendance_at = now(), attendance_by = me(), attendance_reason = p_reason,
         cancelled_at = now(), cancel_reason = p_reason, cancel_note = nullif(trim(coalesce(p_note, '')), ''),
         cancel_self = true, cancel_late = was_confirmed, cancel_sent_to_manager = null
   where id = p_shift;
  update shift_change_requests set status = 'withdrawn', answered_at = now() where shift_id = p_shift and status = 'pending';
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'shift', p_shift, jsonb_build_object('kind', 'staff_cancel', 'reason', p_reason, 'late', was_confirmed));
  return jsonb_build_object('late', was_confirmed, 'cancelled_at', now());
end $$;

-- Ronnie: "Send to <manager> · mark no-show" (event-day cancels). attendance → no_show, manager list shows it.
create or replace function public.admin_send_cancel_to_manager(p_shift uuid)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare t timestamptz := now(); begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update shifts set attendance = 'no_show', attendance_at = t, attendance_by = me(), cancel_sent_to_manager = t,
         attendance_reason = coalesce(attendance_reason, cancel_reason)
   where id = p_shift and attendance in ('cancelled', 'no_show') and cancel_self;
  if not found then raise exception 'not a staff cancel'; end if;
  delete from punches where shift_id = p_shift;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'attendance', p_shift, jsonb_build_object('kind', 'cancel_sent_to_manager', 'attendance', 'no_show'));
  return t;
end $$;

-- ───────── 28d · schedule-change requests ─────────
create table if not exists public.shift_change_requests (
  id                uuid primary key default gen_random_uuid(),
  shift_id          uuid not null references public.shifts(id) on delete cascade,
  staff_id          uuid not null references public.staff(id) on delete cascade,
  kind              text not null check (kind in ('later', 'leave_early')),
  new_time          timestamptz not null,               -- "I can start at" / "I need to leave at"
  old_time          timestamptz,                        -- booked start (later) or leave_by (leave early) when asked
  note              text,
  status            text not null default 'pending' check (status in ('pending', 'accepted', 'keep', 'replaced', 'withdrawn')),
  answer            text check (answer in ('accept', 'accept_fill', 'keep', 'replace')),
  answer_note       text,
  answered_at       timestamptz,
  answered_by       uuid references public.staff(id) on delete set null,
  tell_manager      boolean not null default false,     -- "Also tell the manager now" (off by default)
  count_reliability boolean not null default false,     -- "Count it in reliability (late change)" (off by default)
  keep_reply        text check (keep_reply in ('yes', 'no')),  -- answer to "Can you make it?" after Ask to keep
  keep_replied_at   timestamptz,
  staff_seen_at     timestamptz,                        -- staff tapped OK on the answer card
  created_at        timestamptz not null default now()
);
create unique index if not exists shift_change_requests_one_open on public.shift_change_requests (shift_id) where status = 'pending';
create index if not exists shift_change_requests_staff_idx on public.shift_change_requests (staff_id, created_at desc);
alter table public.shift_change_requests enable row level security;
drop policy if exists admin_all on public.shift_change_requests;
create policy admin_all on public.shift_change_requests for all using (is_admin()) with check (is_admin());
drop policy if exists own_read on public.shift_change_requests;
create policy own_read on public.shift_change_requests for select using (staff_id = me());
-- (staff write only through the RPCs below; managers never see requests, only the result once Ronnie accepts)

create or replace function public.staff_request_change(p_shift uuid, p_kind text, p_time timestamptz, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; pin timestamptz; rid uuid;
begin
  select * into s from shifts where id = p_shift;
  if not found or s.staff_id is distinct from me() then raise exception 'not your shift'; end if;
  if s.status = 'declined' or s.attendance is not null then raise exception 'This shift is off your schedule.'; end if;
  select punch_in into pin from punches where shift_id = p_shift;
  if pin is not null then raise exception 'Your shift has started. Talk to your manager.'; end if;
  if p_kind not in ('later', 'leave_early') then raise exception 'bad kind'; end if;
  if p_time is null or p_time <= s.planned_start or p_time > s.planned_start + interval '16 hours' then raise exception 'Pick a time after your booked start.'; end if;
  if exists (select 1 from shift_change_requests where shift_id = p_shift and status = 'pending') then raise exception 'You already asked. Cancel that request first.'; end if;
  insert into shift_change_requests (shift_id, staff_id, kind, new_time, old_time, note)
  values (p_shift, s.staff_id, p_kind, p_time, case when p_kind = 'later' then s.planned_start else s.leave_by end, nullif(trim(coalesce(p_note, '')), ''))
  returning id into rid;
  return rid;
end $$;

create or replace function public.staff_withdraw_change(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  update shift_change_requests set status = 'withdrawn', answered_at = now() where id = p_id and staff_id = me() and status = 'pending';
  if not found then raise exception 'Ronnie already answered.'; end if;
end $$;

create or replace function public.staff_change_seen(p_id uuid)
returns void language sql security definer set search_path = public as
$$ update shift_change_requests set staff_seen_at = now() where id = p_id and staff_id = me() and staff_seen_at is null $$;

-- "We really need you at 5:45. Can you make it?"  Yes → nothing changes · I can't → late cancel (28b).
create or replace function public.staff_answer_keep(p_id uuid, p_yes boolean)
returns void language plpgsql security definer set search_path = public as
$$ declare r shift_change_requests%rowtype; pin timestamptz;
begin
  select * into r from shift_change_requests where id = p_id and staff_id = me() for update;
  if not found or r.status <> 'keep' or r.keep_reply is not null then raise exception 'nothing to answer'; end if;
  update shift_change_requests set keep_reply = case when p_yes then 'yes' else 'no' end, keep_replied_at = now() where id = p_id;
  if not p_yes then
    select punch_in into pin from punches where shift_id = r.shift_id;
    if pin is not null then raise exception 'Your shift has started. Talk to your manager.'; end if;
    update shifts set attendance = 'cancelled', attendance_at = now(), attendance_by = me(), attendance_reason = 'Time change',
           cancelled_at = now(), cancel_reason = 'Time change', cancel_note = r.note, cancel_self = true, cancel_late = true
     where id = r.shift_id and attendance is null;
  end if;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', r.shift_id, jsonb_build_object('kind', 'keep_reply', 'yes', p_yes));
end $$;

-- Ronnie's answer. accept / accept_fill: move planned_start (later) or set leave_by (leave early), paid from the new time.
-- keep: ask them to keep the booked time. replace: take them off (logged as a late change; counts only with p_count).
create or replace function public.admin_answer_change(p_id uuid, p_answer text, p_tell_manager boolean default false, p_count boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as
$$ declare r shift_change_requests%rowtype; s shifts%rowtype; nm text; tm text; old_tm text;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_answer not in ('accept', 'accept_fill', 'keep', 'replace') then raise exception 'bad answer'; end if;
  select * into r from shift_change_requests where id = p_id for update;
  if not found or r.status <> 'pending' then raise exception 'Already answered or withdrawn.'; end if;
  select * into s from shifts where id = r.shift_id for update;
  select split_part(full_name, ' ', 1) into nm from staff where id = s.staff_id;
  tm := to_char(r.new_time at time zone 'America/Toronto', 'FMHH12:MI AM');
  old_tm := to_char(s.planned_start at time zone 'America/Toronto', 'FMHH12:MI AM');
  if p_answer in ('accept', 'accept_fill') then
    if r.kind = 'later' then update shifts set planned_start = r.new_time, notified_at = now() where id = s.id;
    else update shifts set leave_by = r.new_time where id = s.id; end if;
    update shift_change_requests set status = 'accepted' where id = p_id;
    if p_tell_manager then insert into event_notices(event_id, body, by_staff) values (s.event_id,
      case when r.kind = 'later' then nm || ' now starts ' || tm || ' (was ' || old_tm || ')' else nm || ' leaves ~' || tm || ' tonight' end, me()); end if;
  elsif p_answer = 'keep' then
    update shift_change_requests set status = 'keep' where id = p_id;
    if p_tell_manager then insert into event_notices(event_id, body, by_staff) values (s.event_id,
      nm || ' asked to ' || case when r.kind = 'later' then 'start ' else 'leave at ' end || tm || ' · Ronnie asked to keep ' || old_tm, me()); end if;
  else
    update shifts set attendance = 'cancelled', attendance_at = now(), attendance_by = me(), attendance_reason = 'Time change',
           cancelled_at = now(), cancel_reason = 'Time change', cancel_note = r.note, cancel_self = true, cancel_late = coalesce(p_count, false),
           cancel_sent_to_manager = case when p_tell_manager then now() end
     where id = s.id;
    delete from punches where shift_id = s.id and punch_in is null;
    update shift_change_requests set status = 'replaced' where id = p_id;
    if p_tell_manager then insert into event_notices(event_id, body, by_staff) values (s.event_id, nm || ' is off tonight (time change) · Ronnie is finding a replacement', me()); end if;
  end if;
  update shift_change_requests set answer = p_answer, answer_note = nullif(trim(coalesce(p_note, '')), ''), answered_at = now(), answered_by = me(),
         tell_manager = coalesce(p_tell_manager, false), count_reliability = coalesce(p_count, false)
   where id = p_id;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', s.id, jsonb_build_object('kind', 'change_answer', 'answer', p_answer, 'request', p_id));
  return jsonb_build_object('shift_id', s.id, 'event_id', s.event_id, 'old_start', s.planned_start);
end $$;

-- ───────── 28e · running late ─────────
create table if not exists public.late_notices (
  id        uuid primary key default gen_random_uuid(),
  shift_id  uuid not null unique references public.shifts(id) on delete cascade,  -- one per shift; "Update" replaces it
  minutes   int not null check (minutes between 1 and 720),
  eta       timestamptz not null,
  reason    text check (reason in ('Traffic', 'Metro / bus', 'Parking', 'Other')),
  note      text,
  sent_at   timestamptz not null default now(),
  seen_at   timestamptz,
  seen_by   uuid references public.staff(id) on delete set null
);
alter table public.late_notices enable row level security;
drop policy if exists admin_all on public.late_notices;
create policy admin_all on public.late_notices for all using (is_admin()) with check (is_admin());
drop policy if exists own_read on public.late_notices;
create policy own_read on public.late_notices for select using (exists (select 1 from shifts s where s.id = shift_id and s.staff_id = me()));
drop policy if exists mgr_read on public.late_notices;
create policy mgr_read on public.late_notices for select using (exists (select 1 from shifts s where s.id = shift_id and manages(s.event_id)));
drop policy if exists mgr_seen on public.late_notices;
create policy mgr_seen on public.late_notices for update using (exists (select 1 from shifts s where s.id = shift_id and manages(s.event_id)))
  with check (exists (select 1 from shifts s where s.id = shift_id and manages(s.event_id)));
-- managers may only touch the "seen" columns
revoke update on public.late_notices from anon, authenticated;
grant update (seen_at, seen_by) on public.late_notices to authenticated;
grant select on public.late_notices to authenticated;

create or replace function public.staff_running_late(p_shift uuid, p_minutes int, p_eta timestamptz, p_reason text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; d date; pin timestamptz; rid uuid;
begin
  select * into s from shifts where id = p_shift;
  if not found or s.staff_id is distinct from me() then raise exception 'not your shift'; end if;
  if s.status = 'declined' or s.attendance is not null then raise exception 'This shift is off your schedule.'; end if;
  select event_date into d from events where id = s.event_id;
  if d <> (now() at time zone 'America/Toronto')::date then raise exception 'Only on the day of the event.'; end if;
  select punch_in into pin from punches where shift_id = p_shift;
  if pin is not null then raise exception 'You have already started.'; end if;
  if p_reason is not null and p_reason not in ('Traffic', 'Metro / bus', 'Parking', 'Other') then raise exception 'bad reason'; end if;
  if p_eta is null or p_eta < now() - interval '5 minutes' or p_eta > s.planned_start + interval '6 hours' then raise exception 'Pick when you will get there.'; end if;
  insert into late_notices (shift_id, minutes, eta, reason, note)
  values (p_shift, greatest(1, coalesce(p_minutes, round(extract(epoch from (p_eta - s.planned_start)) / 60)::int)), p_eta, p_reason, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (shift_id) do update set minutes = excluded.minutes, eta = excluded.eta, reason = excluded.reason, note = excluded.note,
     sent_at = now(), seen_at = null, seen_by = null
  returning id into rid;
  return rid;
end $$;

-- Manager "Got it" (Home card or team-screen banner; either clears both).
create or replace function public.late_notice_seen(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  select s.event_id into ev from late_notices n join shifts s on s.id = n.shift_id where n.id = p_id;
  if ev is null or not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  update late_notices set seen_at = now(), seen_by = me() where id = p_id and seen_at is null;
end $$;

-- ───────── 28f · extras & cancellations per event row ─────────
create table if not exists public.event_adjustments (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null unique references public.events(id) on delete cascade,
  extras_removed  uuid[] not null default '{}',    -- shift ids taken off the invoice (still paid)
  client_cuts     jsonb not null default '[]',     -- [{"count":2,"names":"Laura, Theodora","note":"same day"}] · logged only, billed by hand
  cancellations   jsonb not null default '[]',     -- "+ Add" rows typed by Ronnie: [{"name","kind":"late|no_show|early|client_cut","note"}]
  no_changes      boolean not null default false,  -- "No extras · no changes" → EXTRAS LOG "None"
  note            text,
  confirmed_at    timestamptz,
  confirmed_by    uuid references public.staff(id) on delete set null,
  logged_at       timestamptz,                     -- appended to the EXTRAS LOG tab by the Events-sheet script
  logged_row      int,
  logged_text     text,
  auto            boolean not null default false,  -- logged from the app's proposal (no answer by 5 AM)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.event_adjustments enable row level security;
drop policy if exists admin_all on public.event_adjustments;
create policy admin_all on public.event_adjustments for all using (is_admin()) with check (is_admin());

-- Events before today were handled the old way (6 PM Slack question): mark them done so the first script run
-- doesn't append a week of 5 AM proposals to EXTRAS LOG. Nothing is written to the sheet for these.
insert into public.event_adjustments (event_id, auto, logged_at, logged_text)
select id, true, now(), 'before push 28 · not logged by the app' from public.events
 where event_date < (now() at time zone 'America/Toronto')::date
on conflict (event_id) do nothing;

-- The app's proposal: the n non-lead people with the fewest paid hours come off the invoice
-- (n = worked − ordered). MD / BM never. Client pays extras (event, else client setting) → nobody.
create or replace function public.extras_proposal(p_event uuid)
returns uuid[] language sql stable security definer set search_path = public as
$$ with e as (
     select ev.id, ev.staff_needed, ev.staffing, coalesce(ev.extras_billing, c.extras_billing, 'gr') bill
       from events ev left join event_private ep on ep.event_id = ev.id left join clients c on c.id = ep.client_id where ev.id = p_event),
   w as (
     select s.id, st.full_name,
            case when s.left_early then round(extract(epoch from (p.punch_out - p.punch_in)) / 900) * 0.25 else rounded_hours(p.punch_in, p.punch_out) end h
       from shifts s join punches p on p.shift_id = s.id join staff st on st.id = s.staff_id
      where s.event_id = p_event and s.status <> 'declined' and s.attendance is null and p.punch_in is not null and p.punch_out is not null
        and coalesce(s.position_code, '') not in ('MD', 'BM')),
   o as (
     select coalesce((select nullif(sum((l->>'count')::int), 0) from jsonb_array_elements(coalesce(e.staffing, '[]'::jsonb)) l where coalesce(l->>'code', '') not in ('MD', 'BM')),
                     e.staff_needed - case when exists (select 1 from shifts s where s.event_id = p_event and s.position_code in ('MD', 'BM') and s.status <> 'declined') then 1 else 0 end) n,
            e.bill from e)
   select case when (select bill from o) = 'client' then '{}'::uuid[]
               else coalesce(array(select id from w order by h, full_name limit greatest(0, (select count(*) from w) - (select n from o))), '{}') end $$;
revoke all on function public.extras_proposal(uuid) from public;
grant execute on function public.extras_proposal(uuid) to authenticated;

-- EXTRAS LOG "DETAILS" text: "3 extras on G&R (Lucie Avarello, …) · 2 cut by client · bill by hand" / "None".
create or replace function public.extras_log_text(p_event uuid, p_removed uuid[], p_cuts jsonb, p_no_changes boolean)
returns text language sql stable security definer set search_path = public as
$$ with x as (
     select (select string_agg(st.full_name, ', ' order by st.full_name) from shifts s join staff st on st.id = s.staff_id where s.id = any(coalesce(p_removed, '{}'))) names,
            coalesce(array_length(p_removed, 1), 0) n,
            (select coalesce(sum(coalesce((c->>'count')::int, 1)), 0) from jsonb_array_elements(coalesce(p_cuts, '[]'::jsonb)) c) cuts)
   select case when p_no_changes then 'None'
               else nullif(concat_ws(' · ',
                      case when n > 0 then n || ' extra' || case when n > 1 then 's' else '' end || ' on G&R (' || names || ')' end,
                      case when cuts > 0 then cuts || ' cut by client · bill by hand' end), '') end
     from x $$;
revoke all on function public.extras_log_text(uuid, uuid[], jsonb, boolean) from public;

-- Feed for the Events-sheet script (same sheet_token check as hours_sheet, 031). Returns confirmed adjustments not logged yet,
-- plus events with hours but no answer once it is past 5 AM the next day (Montreal) → the app's proposal is used.
create or replace function public.extras_log_feed(p_token text, p_since timestamptz default now() - interval '7 days')
returns table(event_id uuid, event_date date, venue text, department text, invoice_no text, details text, source text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'sheet_token') then raise exception 'not allowed'; end if;
  return query
    select e.id, e.event_date, e.title, e.department, ep.qb_doc_number,
           coalesce(extras_log_text(e.id, a.extras_removed, a.client_cuts, a.no_changes), 'None'), 'confirmed'::text
      from event_adjustments a join events e on e.id = a.event_id left join event_private ep on ep.event_id = e.id
     where a.confirmed_at is not null and a.logged_at is null and e.event_date >= (p_since at time zone 'America/Toronto')::date
    union all
    select e.id, e.event_date, e.title, e.department, ep.qb_doc_number,
           coalesce(extras_log_text(e.id, extras_proposal(e.id), '[]'::jsonb, false), 'None'), 'proposal'::text
      from events e left join event_private ep on ep.event_id = e.id left join event_adjustments a on a.event_id = e.id
     where (a.id is null or (a.confirmed_at is null and a.logged_at is null))
       and e.event_date >= (p_since at time zone 'America/Toronto')::date
       and now() >= ((e.event_date + 1)::timestamp + interval '5 hours') at time zone 'America/Toronto'
       and exists (select 1 from shifts s join punches p on p.shift_id = s.id where s.event_id = e.id and p.punch_in is not null and p.punch_out is not null)
     order by 2, 3, 4;
end $$;
revoke all on function public.extras_log_feed(text, timestamptz) from public;
grant execute on function public.extras_log_feed(text, timestamptz) to anon, authenticated, service_role;

-- The script calls this after appending a row. A proposal that gets logged is saved as the answer (auto = true).
create or replace function public.extras_log_mark(p_token text, p_event uuid, p_row int default null, p_text text default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'sheet_token') then raise exception 'not allowed'; end if;
  insert into event_adjustments (event_id, extras_removed, auto, logged_at, logged_row, logged_text)
  values (p_event, extras_proposal(p_event), true, now(), p_row, p_text)
  on conflict (event_id) do update set logged_at = now(), logged_row = excluded.logged_row, logged_text = excluded.logged_text, updated_at = now(),
     auto = event_adjustments.confirmed_at is null,
     extras_removed = case when event_adjustments.confirmed_at is null then excluded.extras_removed else event_adjustments.extras_removed end;
end $$;
revoke all on function public.extras_log_mark(text, uuid, int, text) from public;
grant execute on function public.extras_log_mark(text, uuid, int, text) to anon, authenticated, service_role;

-- ───────── grants (staff / manager / admin RPCs) ─────────
revoke all on function public.staff_cancel_shift(uuid, text, text) from public;
grant execute on function public.staff_cancel_shift(uuid, text, text) to authenticated;
revoke all on function public.admin_send_cancel_to_manager(uuid) from public;
grant execute on function public.admin_send_cancel_to_manager(uuid) to authenticated;
revoke all on function public.staff_request_change(uuid, text, timestamptz, text) from public;
grant execute on function public.staff_request_change(uuid, text, timestamptz, text) to authenticated;
revoke all on function public.staff_withdraw_change(uuid) from public;
grant execute on function public.staff_withdraw_change(uuid) to authenticated;
revoke all on function public.staff_change_seen(uuid) from public;
grant execute on function public.staff_change_seen(uuid) to authenticated;
revoke all on function public.staff_answer_keep(uuid, boolean) from public;
grant execute on function public.staff_answer_keep(uuid, boolean) to authenticated;
revoke all on function public.admin_answer_change(uuid, text, boolean, boolean, text) from public;
grant execute on function public.admin_answer_change(uuid, text, boolean, boolean, text) to authenticated;
revoke all on function public.staff_running_late(uuid, int, timestamptz, text, text) from public;
grant execute on function public.staff_running_late(uuid, int, timestamptz, text, text) to authenticated;
revoke all on function public.late_notice_seen(uuid) from public;
grant execute on function public.late_notice_seen(uuid) to authenticated;
grant select, insert, update, delete on public.shift_change_requests, public.event_adjustments to authenticated;

-- ───────── check ─────────
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shifts'
          and column_name in ('cancelled_at', 'cancel_reason', 'cancel_note', 'cancel_self', 'cancel_late', 'cancel_sent_to_manager', 'replacement_for')) shift_cols_7,
       (select count(*) from pg_tables where schemaname = 'public' and tablename in ('shift_change_requests', 'late_notices', 'event_adjustments')) tables_3,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('staff_cancel_shift', 'admin_send_cancel_to_manager', 'staff_request_change',
          'staff_withdraw_change', 'staff_change_seen', 'staff_answer_keep', 'admin_answer_change', 'staff_running_late', 'late_notice_seen',
          'extras_proposal', 'extras_log_text', 'extras_log_feed', 'extras_log_mark')) rpcs_13,
       (select count(*) from public.extras_log_feed((select value from app_secrets where name = 'sheet_token'), now() - interval '3 days')) extras_feed_rows;
