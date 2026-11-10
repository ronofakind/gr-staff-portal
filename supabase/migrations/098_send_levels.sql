-- 098 · Send levels + "About to send" box (push 72, Nov 10, 2026). Safe to run twice.
-- Plain Save no longer tells anyone: shift changes (start, end, position, uniform, moves, new bookings and removals after
-- confirmations went out) wait in change_outbox until Ronnie presses a send button.
--   buzz   = message card + phone alert   (confirmed shift ≤ 4 days away · new bookings · removals)
--   soft   = message card, no phone alert (confirmed shift > 4 days away)
--   silent = nothing sent, the page just updates (shift not confirmed yet)
-- Seen = Got it on the card, or Confirm.

alter table public.shifts add column if not exists start_label text check (start_label in ('evening', 'afternoon', 'daytime'));
alter table public.shifts add column if not exists change_sent_at timestamptz; -- the staff "Your shift changed" box shows only once the change is sent

-- A new tracked change clears change_sent_at (the box waits for the next send).
do $$ declare src text; begin
  src := pg_get_functiondef('public.shift_track_change()'::regprocedure);
  if position('change_sent_at' in src) = 0 then
    src := replace(src, 'new.changed_after_confirm_at := now();', 'new.changed_after_confirm_at := now(); new.change_sent_at := null;');
    execute src;
  end if;
  src := pg_get_functiondef('public.event_track_uniform()'::regprocedure);
  if position('change_sent_at' in src) = 0 then
    src := replace(src, 'change_seen_at = null, changed_after_confirm_at = now()', 'change_seen_at = null, changed_after_confirm_at = now(), change_sent_at = null');
    execute src;
  end if;
end $$;

create table if not exists public.change_outbox (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  shift_id uuid references public.shifts(id) on delete set null,
  kind text not null check (kind in ('changed', 'new', 'removed')),
  lines jsonb not null default '[]',
  meta jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz, level text check (level in ('buzz', 'soft', 'silent')), batch_id uuid, message_id uuid, seen_at timestamptz,
  sent_by uuid
);
create index if not exists change_outbox_open on public.change_outbox (event_id) where sent_at is null;
create index if not exists change_outbox_batch on public.change_outbox (batch_id);
alter table public.change_outbox enable row level security;
drop policy if exists change_outbox_admin on public.change_outbox;
create policy change_outbox_admin on public.change_outbox for select using (is_admin());

-- Stage a change (replaces the immediate Messages card). Same person + same shift, not sent yet → merged into one row.
create or replace function public._stage_change(p_staff uuid, p_event uuid, p_shift uuid, p_kind text, p_lines jsonb, p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public as
$$ declare r change_outbox%rowtype; merged jsonb; l jsonb; begin
  if p_staff is null then return null; end if;
  if p_kind = 'changed' and p_shift is not null then
    select * into r from change_outbox where shift_id = p_shift and staff_id = p_staff and sent_at is null and kind = 'changed' order by created_at desc limit 1;
    if r.id is not null then
      merged := r.lines;
      for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
        -- keep the first "old" value, take the newest "new" value
        merged := coalesce((select jsonb_agg(x) from jsonb_array_elements(merged) x where x->>'label' <> l->>'label'), '[]'::jsonb)
                  || jsonb_build_array(l || jsonb_strip_nulls(jsonb_build_object('old', (select x->>'old' from jsonb_array_elements(r.lines) x where x->>'label' = l->>'label' limit 1))));
      end loop;
      update change_outbox set lines = merged, meta = meta || coalesce(p_meta, '{}'), event_id = coalesce(p_event, event_id), updated_at = now() where id = r.id;
      return r.id;
    end if;
  end if;
  -- a removal cancels a not-yet-sent "new" for the same shift (booked then removed before sending = nothing to say)
  if p_kind = 'removed' and coalesce(p_shift::text, p_meta->>'shift_ref') is not null
     and exists (select 1 from change_outbox where coalesce(shift_id::text, meta->>'shift_ref') = coalesce(p_shift::text, p_meta->>'shift_ref') and kind = 'new' and sent_at is null) then
    delete from change_outbox where coalesce(shift_id::text, meta->>'shift_ref') = coalesce(p_shift::text, p_meta->>'shift_ref') and sent_at is null;
    return null;
  end if;
  insert into change_outbox(staff_id, event_id, shift_id, kind, lines, meta) values (p_staff, p_event, case when p_kind = 'removed' then null else p_shift end, p_kind, coalesce(p_lines, '[]'), coalesce(p_meta, '{}'))
  returning id into r.id;
  return r.id;
end $$;
revoke all on function public._stage_change(uuid, uuid, uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- Triggers (shift start / end / position, event uniform) now stage instead of posting.
create or replace function public._change_note(p_shift uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; ev events%rowtype; vname text; begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then return null; end if;
  select * into s from shifts where id = p_shift; if not found or s.staff_id is null then return null; end if;
  select * into ev from events where id = s.event_id;
  select name into vname from venues where id = ev.venue_id;
  return _stage_change(s.staff_id, s.event_id, s.id, 'changed', p_lines, jsonb_build_object('date', ev.event_date, 'venue', coalesce(vname, ev.title)));
end $$;
revoke execute on function public._change_note(uuid, jsonb) from public, anon, authenticated;

-- Bookings / Day view / asks (client bookingChange) → staged too. Same signature as before (062).
create or replace function public.admin_shift_note(p_staff uuid, p_kind text, p_shift uuid, p_alert uuid, p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public as
$$ declare m jsonb := coalesce(p_meta, '{}'); ev uuid; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind not in ('changed', 'new', 'removed') then raise exception 'bad kind'; end if;
  ev := coalesce(nullif(m->>'event_id', '')::uuid, (select event_id from shifts where id = p_shift));
  return _stage_change(p_staff, ev, p_shift, p_kind, coalesce(m->'lines', '[]'::jsonb), m - 'lines');
end $$;
grant execute on function public.admin_shift_note(uuid, text, uuid, uuid, jsonb) to authenticated;

-- Level for one staged row (auto mode).
create or replace function public._send_level(r change_outbox) returns text language sql stable security definer set search_path = public as
$$ select case
    when r.kind in ('new', 'removed') then 'buzz'
    when coalesce((select status from shifts where id = r.shift_id), 'confirmed') <> 'confirmed' then 'silent'
    when coalesce((select event_date from events where id = r.event_id), (r.meta->>'date')::date)
         <= (now() at time zone 'America/Toronto')::date + 4 then 'buzz'
    else 'soft' end $$;

create or replace function public._send_text(r change_outbox) returns text language sql stable security definer set search_path = public as
$$ select case r.kind
    when 'new' then '🗓 New shift · ' || coalesce(_mtl_day((r.meta->>'date')::date), '') || coalesce(' · ' || (r.meta->>'venue'), '') || '. Confirm in My dates.'
    when 'removed' then '🗓 Shift removed · ' || coalesce(_mtl_day((r.meta->>'date')::date), '') || coalesce(' · ' || (r.meta->>'venue'), '') || '. You''re no longer on this event. Questions? Reply here.'
    else '🗓 Your shift changed · ' || coalesce(_mtl_day((r.meta->>'date')::date), '') || coalesce(' · ' || (r.meta->>'venue'), '') || ' · '
         || coalesce((select string_agg((x->>'label') || ' ' || coalesce(x->>'old', '') || ' → ' || coalesce(x->>'new', ''), ' · ') from jsonb_array_elements(r.lines) x), '') end $$;

-- "About to send" preview: one row per staged change in these events (null = every event).
create or replace function public.admin_pending_changes(p_events uuid[] default null)
returns table (id uuid, staff_id uuid, full_name text, phone text, event_id uuid, event_title text, event_date date, kind text, level text, message text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query select o.id, o.staff_id, st.full_name, st.phone, o.event_id, coalesce(o.meta->>'venue', e.title), coalesce((o.meta->>'date')::date, e.event_date),
                      o.kind, _send_level(o), _send_text(o)
    from change_outbox o join staff st on st.id = o.staff_id left join events e on e.id = o.event_id
   where o.sent_at is null and (p_events is null or o.event_id = any(p_events))
   order by 7, 6, 3;
end $$;
grant execute on function public.admin_pending_changes(uuid[]) to authenticated;

-- Send: p_mode 'auto' (rules) · 'soft' · 'buzz' (force for everyone in this send). One buzz per person per send.
create or replace function public.admin_send_changes(p_events uuid[] default null, p_mode text default 'auto')
returns jsonb language plpgsql security definer set search_path = public as
$$ declare r change_outbox%rowtype; lvl text; b uuid := gen_random_uuid(); mid uuid; buzzed uuid[] := '{}'; card text; nb int := 0; ns int := 0; nq int := 0; al uuid; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_mode not in ('auto', 'soft', 'buzz') then raise exception 'bad mode'; end if;
  for r in select * from change_outbox o where o.sent_at is null and (p_events is null or o.event_id = any(p_events))
            order by (o.kind = 'changed'), coalesce((o.meta->>'date')::date, current_date), o.created_at loop
    lvl := _send_level(r);
    if p_mode <> 'auto' and lvl <> 'silent' then lvl := p_mode; end if;
    if p_mode = 'buzz' and lvl = 'silent' and r.kind = 'changed' then lvl := 'buzz'; end if;
    if lvl = 'buzz' and r.staff_id = any(buzzed) then lvl := 'soft'; end if; -- one combined buzz per person
    mid := null; al := null;
    if lvl <> 'silent' then
      card := case r.kind when 'new' then 'new_shift' when 'removed' then 'shift_removed' else 'shift_changed' end;
      if r.kind <> 'changed' then
        insert into staff_alerts(staff_id, kind, title, body, event_id)
        values (r.staff_id, case r.kind when 'new' then 'booked' else 'removed' end,
                case r.kind when 'new' then 'You''re booked' else 'You''re no longer on ' || coalesce(_mtl_day((r.meta->>'date')::date), 'this date') end,
                concat_ws(' · ', _mtl_day((r.meta->>'date')::date), r.meta->>'venue'), case when r.kind = 'new' then r.event_id end)
        returning id into al;
      end if;
      mid := _post_note(r.staff_id, _send_text(r),
               r.meta || jsonb_build_object('card', card, 'shift_id', r.shift_id, 'lines', r.lines, 'level', lvl, 'alert_id', al, 'outbox', r.id),
               case when r.kind = 'removed' then null else r.shift_id end);
      if lvl = 'buzz' then buzzed := buzzed || r.staff_id; nb := nb + 1; else ns := ns + 1; end if;
    else nq := nq + 1; end if;
    update change_outbox set sent_at = now(), level = lvl, batch_id = b, message_id = mid, sent_by = me() where id = r.id;
    if lvl <> 'silent' and r.kind = 'changed' and r.shift_id is not null then
      update shifts set change_sent_at = now() where id = r.shift_id;
    end if;
  end loop;
  return jsonb_build_object('batch', b, 'buzz', nb, 'soft', ns, 'silent', nq);
end $$;
grant execute on function public.admin_send_changes(uuid[], text) to authenticated;

-- Phone alert only for buzz (soft = card in Messages, no alert).
do $$ declare src text; begin
  src := pg_get_functiondef('public.alerts_on_message()'::regprocedure);
  if position('meta->>''level''' in src) = 0 then
    src := replace(src, $q$card in ('shift_changed', 'new_shift', 'shift_removed') then$q$,
                        $q$card in ('shift_changed', 'new_shift', 'shift_removed') and coalesce(new.meta->>'level', 'buzz') = 'buzz' then$q$);
    execute src;
  end if;
end $$;

-- Seen: Got it on the card, or Confirm on the shift.
create or replace function public.change_seen_from_message() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if (new.meta ? 'got_it_at') and not (old.meta ? 'got_it_at') then
    update change_outbox set seen_at = coalesce(seen_at, now()) where message_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists messages_change_seen on public.messages;
create trigger messages_change_seen after update of meta on public.messages for each row execute function public.change_seen_from_message();

create or replace function public.change_seen_from_shift() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if (new.status = 'confirmed' and old.status is distinct from 'confirmed') or (new.change_seen_at is not null and old.change_seen_at is null) then
    update change_outbox set seen_at = coalesce(seen_at, now()) where shift_id = new.id and sent_at is not null and seen_at is null;
  end if;
  return null;
end $$;
drop trigger if exists shifts_change_seen on public.shifts;
create trigger shifts_change_seen after update of status, change_seen_at on public.shifts for each row execute function public.change_seen_from_shift();

-- "Last change seen: 5 of 8" (event page) and unseen tonight / tomorrow (Today). Admin only.
create or replace function public.admin_change_seen(p_event uuid)
returns table (staff_id uuid, full_name text, phone text, sent_at timestamptz, level text, seen_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ declare b uuid; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select o.batch_id into b from change_outbox o where o.event_id = p_event and o.sent_at is not null and o.level <> 'silent' order by o.sent_at desc limit 1;
  return query select distinct on (o.staff_id) o.staff_id, st.full_name, st.phone, o.sent_at, o.level, o.seen_at
    from change_outbox o join staff st on st.id = o.staff_id
   where o.batch_id = b and o.event_id = p_event and o.level <> 'silent' order by o.staff_id, o.seen_at nulls first;
end $$;
grant execute on function public.admin_change_seen(uuid) to authenticated;

create or replace function public.admin_unseen_changes()
returns table (staff_id uuid, full_name text, phone text, event_id uuid, event_title text, event_date date, sent_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query select o.staff_id, st.full_name, st.phone, o.event_id, coalesce(o.meta->>'venue', e.title), e.event_date, max(o.sent_at)
    from change_outbox o join staff st on st.id = o.staff_id join events e on e.id = o.event_id
   where o.sent_at is not null and o.level in ('buzz', 'soft') and o.seen_at is null
     and e.event_date between (now() at time zone 'America/Toronto')::date and (now() at time zone 'America/Toronto')::date + 1
     and exists (select 1 from shifts s where s.id = o.shift_id and s.attendance is null and s.status <> 'declined')
   group by 1, 2, 3, 4, 5, 6 order by 6, 2;
end $$;
grant execute on function public.admin_unseen_changes() to authenticated;

select 'RESULT ' || (select count(*) from pg_proc where proname in ('shift_track_change', 'event_track_uniform') and prosrc like '%change_sent_at%') || ' of 2 trackers · ' || (select count(*) from information_schema.tables where table_name = 'change_outbox') || ' table · '
  || (select count(*) from pg_proc where proname in ('_stage_change', 'admin_pending_changes', 'admin_send_changes', 'admin_change_seen', 'admin_unseen_changes')) || ' of 5 functions · alerts '
  || (select (position('meta->>''level'', ''buzz'') = ''buzz''' in prosrc) > 0)::text from pg_proc where proname = 'alerts_on_message');
