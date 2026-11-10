-- Push 40 (Nov 2): shift changes in the Ronnie conversation · ask first (earlier start / move / position) · fill one spot by
-- asking several people (all at once or one by one).
-- File only: apply by hand in the SQL editor. Safe to run twice (if not exists / create or replace / drop … if exists).
-- Nothing existing is dropped. Three existing functions are replaced with the same signature and the same behaviour plus
-- one extra step each: alert_seen (018) and shift_change_seen (039) also tick "Got it" on the matching note in the
-- conversation, event_track_place (039) also posts a "Your shift changed" note for a new place.
--
-- Rules (Ronnie, Nov 2 7:37–7:59 PM):
--   · later start → no ask (the app changes it + "Your shift changed" note with Got it). Earlier start → ask first.
--   · move to another event / other position on the same event → ask first once the person has confirmed.
--     Before they confirm, the move just updates what they are asked to confirm (same as today, no ask row).
--   · fill a spot: staff are never told it's first come or one by one. When someone takes it, the ask silently
--     disappears for everyone else (their note is deleted, no message). A stale Yes → "This shift is no longer
--     available", nothing booked. First tap wins: every answer runs under one transaction-level advisory lock + a row lock.
--
-- Nothing changes on the shift (or the calendar feed, which reads shifts) until the person says yes.
--
-- No cron. Answer-by deadlines and the one-by-one chain are evaluated on read: _asks_tick() runs at the start of every
-- ask RPC (staff cards on Home / Messages / My dates, Ronnie's Day view + Needs you, every answer). It expires overdue
-- people and asks the next one. Limitation: if nobody opens the app, the next person is only asked when someone does
-- (any staff or admin load runs the tick for everyone). Nights (10 PM – 8 AM Montreal) don't count in the per-person wait.
--
-- Reused: me() / is_admin() / manages() · conversations + messages (042, notes are kind 'system' with meta.card) ·
--   staff_alerts (018) · shifts.change_prev / change_seen_at (039) · event_notices (023) · change_log (001).

-- ───────── tables ─────────
create table if not exists public.shift_asks (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('earlier_start', 'move', 'position', 'fill')),
  shift_id         uuid references public.shifts(id) on delete cascade,        -- the booked shift (not for fill)
  event_id         uuid not null references public.events(id) on delete cascade, -- the event asked about (move: the new one · fill: the spot's)
  from_event_id    uuid references public.events(id) on delete set null,      -- move: where they are now
  new_start        timestamptz,                                                -- earlier_start / move / fill
  position_code    text,                                                       -- position / move (when it changes) / fill
  position_detail  text,
  mode             text check (mode in ('all', 'chain')),                      -- fill only
  wait_min         int check (wait_min between 15 and 720),                    -- fill one by one: wait for each person
  answer_by        timestamptz,                                                -- deadline (change asks, fill all at once)
  group_key        uuid not null default gen_random_uuid(),                    -- one question to a whole start group / several moves
  replace_for      uuid references public.shifts(id) on delete set null,       -- fill: the booked person is saved as a replacement
  meta             jsonb not null default '{}',                                -- card snapshot {date, old:{…}, new:{…}}
  status           text not null default 'open' check (status in ('open', 'accepted', 'declined', 'expired', 'cancelled', 'filled', 'nobody')),
  resolution       text check (resolution in ('keep', 'change_anyway', 'replace', 'ask_else', 'dismiss')),
  resolved_at      timestamptz,
  resolved_by      uuid references public.staff(id) on delete set null,
  booked_shift_id  uuid references public.shifts(id) on delete set null,       -- fill: the shift the first yes created
  created_by       uuid references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  closed_at        timestamptz,
  check (kind = 'fill' or shift_id is not null),
  check (kind <> 'fill' or (mode is not null and new_start is not null))
);
create unique index if not exists shift_asks_one_open on public.shift_asks (shift_id) where status = 'open' and shift_id is not null;
create index if not exists shift_asks_event on public.shift_asks (event_id);
create index if not exists shift_asks_from_event on public.shift_asks (from_event_id) where from_event_id is not null;
create index if not exists shift_asks_open on public.shift_asks (status) where status = 'open';
create index if not exists shift_asks_group on public.shift_asks (group_key);
comment on table public.shift_asks is 'push 40 · ask before changing a shift (earlier_start / move / position, one row per person, group_key ties a whole start group or several moves) and fill one spot by asking several people (fill, mode all | chain). Nothing changes until yes.';

create table if not exists public.shift_ask_targets (
  ask_id       uuid not null references public.shift_asks(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  ord          int not null default 1,          -- one by one: order Ronnie set
  asked_at     timestamptz,                     -- null = not asked yet (one by one, waiting for their turn)
  due_at       timestamptz,                     -- their answer-by (deadline, or the per-person wait in one by one)
  answer       text check (answer in ('yes', 'no', 'expired')),
  answered_at  timestamptz,
  note         text,                            -- optional note with No (never asked why)
  removed_at   timestamptz,                     -- fill: the ask disappeared for them (taken by someone else / stopped / their turn passed)
  message_id   uuid references public.messages(id) on delete set null,  -- the ask note in their Ronnie conversation
  seen_at      timestamptz,                     -- first time the card was shown to them
  primary key (ask_id, staff_id)
);
create index if not exists shift_ask_targets_staff on public.shift_ask_targets (staff_id) where answer is null and removed_at is null;

-- RLS: admins everything. Staff read their own target rows only; they never read shift_asks directly (so mode / how many
-- people were asked stay hidden): their cards come from shift_ask_cards(), which returns only their own snapshot.
alter table public.shift_asks enable row level security;
alter table public.shift_ask_targets enable row level security;
drop policy if exists admin_all on public.shift_asks;
drop policy if exists admin_all on public.shift_ask_targets;
drop policy if exists own_read on public.shift_ask_targets;
create policy admin_all on public.shift_asks for all using (is_admin()) with check (is_admin());
create policy admin_all on public.shift_ask_targets for all using (is_admin()) with check (is_admin());
create policy own_read on public.shift_ask_targets for select using (staff_id = me());
-- Every write goes through the functions below. Staff column access excludes ord (it would hint at "one by one").
revoke all on public.shift_asks, public.shift_ask_targets from anon, authenticated;
grant select on public.shift_asks to authenticated;
grant select (ask_id, staff_id, asked_at, due_at, answer, answered_at, note, seen_at) on public.shift_ask_targets to authenticated;

-- ───────── helpers ─────────
create or replace function public._mtl_time(t timestamptz) returns text
language sql stable as $$ select to_char(t at time zone 'America/Toronto', 'FMHH12:MI AM') $$;
create or replace function public._mtl_day(d date) returns text
language sql immutable as $$ select to_char(d, 'Dy Mon FMDD') $$;

-- Position label the way the app shows it (MD · Waiter · Busboy · Bar manager · Bartender · Barback · detail).
create or replace function public._role_label(p_code text, p_detail text) returns text
language sql immutable as
$$ select coalesce(nullif(regexp_replace(coalesce(p_detail, ''), '^bar\s*-\s*', '', 'i'), ''),
     case p_code when 'MD' then 'MD' when 'W' then 'Waiter' when 'BUS' then 'Busboy' when 'BM' then 'Bar manager'
                 when 'BT' then 'Bartender' when 'BB' then 'Barback' else case when p_code ~ '^\d+$' or p_code is null then 'Waiter' else p_code end end) $$;

-- t + n minutes, not counting 10 PM – 8 AM (Montreal). Used for the one-by-one wait.
create or replace function public._awake_plus(t timestamptz, mins int) returns timestamptz
language plpgsql stable as
$$ declare tz text := 'America/Toronto'; loc timestamp := t at time zone tz; left_s numeric := greatest(0, mins) * 60; avail numeric; day_end timestamp;
begin
  loop
    if loc::time >= time '22:00' then loc := (loc::date + 1) + time '08:00';
    elsif loc::time < time '08:00' then loc := loc::date + time '08:00'; end if;
    day_end := loc::date + time '22:00';
    avail := extract(epoch from (day_end - loc));
    if left_s <= avail then return (loc + make_interval(secs => left_s)) at time zone tz; end if;
    left_s := left_s - avail; loc := day_end;
  end loop;
end $$;

-- planned_end for a start on an event (same rule as endIso() in the admin app).
create or replace function public._end_for(p_event uuid, p_start timestamptz) returns timestamptz
language sql stable security definer set search_path = public as
$$ select case when e.end_time is null then null else
          (((e.event_date + e.end_time) at time zone 'America/Toronto')
           + case when ((e.event_date + e.end_time) at time zone 'America/Toronto') <= p_start then interval '1 day' else interval '0' end) end
     from events e where e.id = p_event $$;

-- Card snapshot of one shift (what staff see): date, venue (never the client name as the title), address, start, position, uniform.
create or replace function public._shift_card(p_event uuid, p_start timestamptz, p_code text, p_detail text) returns jsonb
language sql stable security definer set search_path = public as
$$ select jsonb_build_object('event_id', e.id, 'date', e.event_date, 'venue', coalesce(v.name, e.title), 'address', coalesce(e.address, v.address),
          'start', p_start, 'code', p_code, 'position', _role_label(p_code, p_detail), 'dept', e.department,
          'uniform', case when e.department = 'bar' or p_code in ('BM', 'BT', 'BB') then e.uniform_bar else e.uniform_floor end,
          'client', ep.client)
     from events e left join venues v on v.id = e.venue_id left join event_private ep on ep.event_id = e.id where e.id = p_event $$;

-- The person's Ronnie conversation (created if needed).
create or replace function public._ronnie_conv(p_staff uuid) returns uuid
language plpgsql security definer set search_path = public as
$$ declare c uuid; begin
  insert into conversations(staff_id, kind) values (p_staff, 'ronnie') on conflict (staff_id) where kind = 'ronnie' do nothing;
  select id into c from conversations where staff_id = p_staff and kind = 'ronnie';
  return c;
end $$;

-- A system note in the person's Ronnie conversation (kind 'system', meta.card = what the app draws). In All, never Needs reply.
create or replace function public._post_note(p_staff uuid, p_body text, p_meta jsonb, p_shift uuid default null) returns uuid
language plpgsql security definer set search_path = public as
$$ declare c uuid := _ronnie_conv(p_staff); m uuid; begin
  insert into messages(conversation_id, sender_id, sender_role, kind, body, topic, shift_id, meta)
  values (c, null, 'system', 'system', p_body, 'shift', p_shift, coalesce(p_meta, '{}')) returning id into m;
  update conversations set last_message_at = now(), last_from = 'system', last_sender_id = null where id = c;
  return m;
end $$;

-- Delete a note without a trace (fill asks someone else took) and put the conversation's "last" back on what's left.
create or replace function public._drop_note(p_msg uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare c uuid; l messages%rowtype; begin
  if p_msg is null then return; end if;
  delete from messages where id = p_msg returning conversation_id into c;
  if c is null then return; end if;
  select * into l from messages where conversation_id = c order by created_at desc limit 1;
  update conversations set last_message_at = l.created_at, last_from = l.sender_role, last_sender_id = l.sender_id where id = c;
end $$;

create or replace function public._note_meta(p_msg uuid, p_patch jsonb) returns void
language sql security definer set search_path = public as
$$ update messages set meta = meta || p_patch where id = p_msg $$;

revoke execute on function public._shift_card(uuid, timestamptz, text, text) from public, anon, authenticated;  -- returns the client name
revoke execute on function public._end_for(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public._ronnie_conv(uuid) from public, anon, authenticated;
revoke execute on function public._post_note(uuid, text, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public._drop_note(uuid) from public, anon, authenticated;
revoke execute on function public._note_meta(uuid, jsonb) from public, anon, authenticated;

-- ───────── "Your shift changed" · "New shift" · "Shift removed" notes ─────────
-- The admin app calls this right after a booking change it already alerts on (bookingChange: confirmations were sent).
-- p_meta: {date, venue, lines:[{label, old, new}], position, start, alert_id}. Kind changed → Got it / Can't make it.
create or replace function public.admin_shift_note(p_staff uuid, p_kind text, p_shift uuid, p_alert uuid, p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public as
$$ declare card text; body text; m jsonb := coalesce(p_meta, '{}'); begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind not in ('changed', 'new', 'removed') then raise exception 'bad kind'; end if;
  card := case p_kind when 'changed' then 'shift_changed' when 'new' then 'new_shift' else 'shift_removed' end;
  body := case p_kind when 'changed' then '🗓 Your shift changed · ' when 'new' then '🗓 New shift · ' else '🗓 Shift removed · ' end
          || coalesce(_mtl_day((m->>'date')::date), '') || coalesce(' · ' || (m->>'venue'), '')
          || case p_kind when 'changed' then coalesce(' · ' || (select string_agg((l->>'label') || ' ' || coalesce(l->>'old', '') || ' → ' || coalesce(l->>'new', ''), ' · ')
                                                           from jsonb_array_elements(coalesce(m->'lines', '[]'::jsonb)) l), '')
                         when 'new' then '. Confirm in My dates.' else '. You''re no longer on this event. Questions? Reply here.' end;
  return _post_note(p_staff, body, m || jsonb_build_object('card', card, 'shift_id', p_shift, 'alert_id', p_alert), case when p_kind = 'removed' then null else p_shift end);
end $$;
grant execute on function public.admin_shift_note(uuid, text, uuid, uuid, jsonb) to authenticated;

-- Staff: ✓ Got it on the note = the same flag as the Home gold box (shifts.change_seen_at) + the matching Home alert.
create or replace function public.shift_note_got_it(p_message uuid)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare m messages%rowtype; t timestamptz := now(); begin
  select x.* into m from messages x join conversations c on c.id = x.conversation_id where x.id = p_message and c.staff_id = me();
  if not found then raise exception 'not your note'; end if;
  if m.meta ? 'got_it_at' then return (m.meta->>'got_it_at')::timestamptz; end if;
  update messages set meta = meta || jsonb_build_object('got_it_at', t) where id = m.id;
  if m.meta ? 'shift_id' then update shifts set change_seen_at = t where id = (m.meta->>'shift_id')::uuid and staff_id = me() and change_seen_at is null; end if;
  if m.meta ? 'alert_id' then update staff_alerts set seen_at = t where id = (m.meta->>'alert_id')::uuid and staff_id = me() and seen_at is null; end if;
  return t;
end $$;
grant execute on function public.shift_note_got_it(uuid) to authenticated;

-- Home "Got it" (gold box / alert card) ticks the note in the conversation too. Same signatures as 018 / 039.
create or replace function public.shift_change_seen(p_shift uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  update shifts set change_seen_at = now() where id = p_shift and staff_id = me() and change_seen_at is null;
  update messages x set meta = x.meta || jsonb_build_object('got_it_at', now())
    from conversations c where c.id = x.conversation_id and c.staff_id = me() and x.kind = 'system'
     and x.meta->>'card' = 'shift_changed' and x.meta->>'shift_id' = p_shift::text and not (x.meta ? 'got_it_at');
end $$;
create or replace function public.alert_seen(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  update staff_alerts set seen_at = now() where id = p_id and staff_id = me() and seen_at is null;
  update messages x set meta = x.meta || jsonb_build_object('got_it_at', now())
    from conversations c where c.id = x.conversation_id and c.staff_id = me() and x.kind = 'system'
     and x.meta->>'alert_id' = p_id::text and x.meta->>'card' = 'shift_changed' and not (x.meta ? 'got_it_at');
end $$;
grant execute on function public.shift_change_seen(uuid) to authenticated;
grant execute on function public.alert_seen(uuid) to authenticated;

-- Place changes live on the event (039): same as before + a "Your shift changed" note for each confirmed person.
create or replace function public.event_track_place() returns trigger
language plpgsql security definer set search_path = public as
$$ declare oplace text; oaddr text; nplace text; naddr text; r record;
begin
  if new.address is distinct from old.address or new.venue_id is distinct from old.venue_id or new.title is distinct from old.title then
    select coalesce(v.name, old.title), coalesce(old.address, v.address) into oplace, oaddr
      from (select 1) one left join venues v on v.id = old.venue_id;
    select coalesce(v.name, new.title), coalesce(new.address, v.address) into nplace, naddr
      from (select 1) one left join venues v on v.id = new.venue_id;
    update shifts s
       set change_prev = case when s.change_prev is null or s.change_seen_at is not null
                              then jsonb_build_object('start', s.planned_start, 'position', coalesce(nullif(s.position_detail, ''), s.position_code), 'place', oplace, 'address', oaddr)
                              else s.change_prev end,
           change_seen_at = null, changed_after_confirm_at = now()
     where s.event_id = new.id and s.status = 'confirmed' and s.attendance is null;
    if oplace is distinct from nplace or oaddr is distinct from naddr then
      for r in select s.id, s.staff_id from shifts s where s.event_id = new.id and s.status = 'confirmed' and s.attendance is null loop
        perform _post_note(r.staff_id,
          '🗓 Your shift changed · ' || _mtl_day(new.event_date) || ' · ' || nplace
            || case when oplace is distinct from nplace then ' · Place ' || coalesce(oplace, '') || ' → ' || nplace else ' · New address ' || coalesce(naddr, '') end,
          jsonb_build_object('card', 'shift_changed', 'shift_id', r.id, 'date', new.event_date, 'venue', nplace,
            'lines', jsonb_build_array(case when oplace is distinct from nplace then jsonb_build_object('label', 'Place', 'old', oplace, 'new', nplace)
                                            else jsonb_build_object('label', 'Address', 'old', oaddr, 'new', naddr) end)),
          r.id);
      end loop;
    end if;
  end if;
  return null;
end $$;

-- ───────── asks: internals ─────────
-- Post the ask note for one person and start their answer-by.
create or replace function public._ask_post(p_ask uuid, p_staff uuid, p_due timestamptz) returns void
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; m uuid; body text; n jsonb; begin
  select * into a from shift_asks where id = p_ask;
  n := a.meta->'new';
  body := case a.kind when 'fill' then '🙋 Can you work this shift? ' when 'move' then '🗓 Can you work this event instead? '
                      when 'position' then '🗓 Can you do a new position? ' else '🗓 Can you do a new time? ' end
          || _mtl_day((n->>'date')::date) || ' · ' || coalesce(n->>'venue', '') || ' · ' || coalesce(n->>'position', '') || ' · '
          || _mtl_time((n->>'start')::timestamptz) || '. Answer by ' || to_char(p_due at time zone 'America/Toronto', 'Dy FMHH12:MI AM') || ' in the app.';
  m := _post_note(p_staff, body, a.meta || jsonb_build_object('card', 'ask', 'ask_id', a.id, 'kind', a.kind, 'due_at', p_due), a.shift_id);
  update shift_ask_targets set asked_at = now(), due_at = p_due, message_id = m where ask_id = p_ask and staff_id = p_staff;
end $$;

-- Wait for one person in one by one (nights don't count), never past 30 min before the shift, at least 15 min.
create or replace function public._chain_due(a shift_asks) returns timestamptz
language sql stable as
$$ select greatest(now() + interval '15 minutes', least(_awake_plus(now(), coalesce(a.wait_min, 60)), a.new_start - interval '30 minutes')) $$;

-- One by one: ask the next person in order, or close as "No one took the spot".
create or replace function public._ask_next(p_ask uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; nxt uuid; begin
  select * into a from shift_asks where id = p_ask;
  if a.status <> 'open' or a.kind <> 'fill' then return; end if;
  if exists (select 1 from shift_ask_targets where ask_id = a.id and asked_at is not null and answer is null and removed_at is null) then return; end if;
  select staff_id into nxt from shift_ask_targets where ask_id = a.id and asked_at is null and removed_at is null order by ord limit 1;
  if nxt is null then
    update shift_asks set status = 'nobody', closed_at = now() where id = a.id;
  else
    perform _ask_post(a.id, nxt, _chain_due(a));
  end if;
end $$;

-- Silently take a fill ask away from everyone still waiting (taken / stopped / time passed).
create or replace function public._ask_remove_waiting(p_ask uuid, p_expire boolean default false) returns void
language plpgsql security definer set search_path = public as
$$ declare t record; begin
  for t in select staff_id, message_id, asked_at from shift_ask_targets where ask_id = p_ask and answer is null and removed_at is null loop
    update shift_ask_targets set removed_at = now(),
           answer = case when p_expire and t.asked_at is not null then 'expired' else answer end,
           answered_at = case when p_expire and t.asked_at is not null then now() else answered_at end
     where ask_id = p_ask and staff_id = t.staff_id;
    perform _drop_note(t.message_id);
  end loop;
end $$;

-- Evaluate deadlines (no cron): run at the start of every ask RPC. One advisory lock = one tick at a time, and every
-- answer waits for it, so "first tap wins" holds even with the tick and two answers at the same second.
create or replace function public._asks_tick() returns void
language plpgsql security definer set search_path = public as
$$ declare r record; begin
  perform pg_advisory_xact_lock(440044);
  -- change asks past their answer-by → expired (Ronnie's Needs you: keep / change anyway / replace)
  for r in select a.id from shift_asks a where a.status = 'open' and a.kind <> 'fill' and a.answer_by <= now() loop
    update shift_asks set status = 'expired', closed_at = now() where id = r.id;
    update shift_ask_targets set answer = 'expired', answered_at = now() where ask_id = r.id and answer is null;
    update messages set meta = meta || jsonb_build_object('state', 'expired')
     where id in (select message_id from shift_ask_targets where ask_id = r.id);
  end loop;
  -- fill: too late for the shift, or all at once past its answer-by → nobody (asks disappear for the people still waiting)
  for r in select a.id from shift_asks a where a.status = 'open' and a.kind = 'fill'
             and (a.new_start <= now() or (a.mode = 'all' and a.answer_by <= now())) loop
    perform _ask_remove_waiting(r.id, true);
    update shift_asks set status = 'nobody', closed_at = now() where id = r.id;
  end loop;
  -- one by one: the person's wait passed → counts as no, next person
  for r in select t.ask_id, t.staff_id, t.message_id from shift_ask_targets t join shift_asks a on a.id = t.ask_id
            where a.status = 'open' and a.kind = 'fill' and a.mode = 'chain' and t.asked_at is not null and t.answer is null
              and t.removed_at is null and t.due_at <= now() loop
    update shift_ask_targets set answer = 'expired', answered_at = now(), removed_at = now() where ask_id = r.ask_id and staff_id = r.staff_id;
    perform _drop_note(r.message_id);
  end loop;
  for r in select a.id from shift_asks a where a.status = 'open' and a.kind = 'fill' and a.mode = 'chain' loop
    perform _ask_next(r.id);
  end loop;
end $$;

-- Apply a change ask to the shift (same columns the admin Day view writes). p_seen: the person agreed → no gold box.
create or replace function public._ask_apply(p_ask uuid, p_seen boolean) returns void
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; s shifts%rowtype; begin
  select * into a from shift_asks where id = p_ask;
  select * into s from shifts where id = a.shift_id for update;
  if not found then raise exception 'This shift is gone.'; end if;
  if exists (select 1 from punches where shift_id = s.id and punch_in is not null) then raise exception 'This shift has started.'; end if;
  if a.kind = 'move' and exists (select 1 from shifts x where x.event_id = a.event_id and x.staff_id = s.staff_id and x.id <> s.id) then
    raise exception 'Already on that event.';
  end if;
  update shifts set
     event_id = case when a.kind = 'move' then a.event_id else event_id end,
     planned_start = coalesce(a.new_start, planned_start),
     planned_end = case when a.kind = 'move' then _end_for(a.event_id, coalesce(a.new_start, planned_start)) else planned_end end,
     position_code = coalesce(a.position_code, position_code),
     position_detail = case when a.position_code is not null then a.position_detail else position_detail end
   where id = s.id;
  if p_seen then update shifts set change_seen_at = now(), notified_at = case when notified_at is not null then now() end where id = s.id; end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'shift', s.id, jsonb_build_object('kind', 'ask_applied', 'ask', a.id, 'ask_kind', a.kind, 'agreed', p_seen,
          'from', jsonb_build_object('event', s.event_id, 'start', s.planned_start, 'code', s.position_code),
          'to', jsonb_build_object('event', a.event_id, 'start', coalesce(a.new_start, s.planned_start), 'code', coalesce(a.position_code, s.position_code))));
  if a.kind = 'move' and a.from_event_id is not null then
    insert into event_notices(event_id, body, by_staff)
    values (a.from_event_id, (select full_name from staff where id = s.staff_id) || ' moved to ' || coalesce(a.meta->'new'->>'venue', 'another event'), me());
  end if;
end $$;

-- "Old → new" lines of a change ask, for the notes.
create or replace function public._ask_lines(a shift_asks) returns jsonb
language sql stable as
$$ select coalesce(jsonb_agg(l order by o), '[]'::jsonb) from (values
     (1, case when a.kind = 'move' then jsonb_build_object('label', 'Place', 'old', a.meta->'old'->>'venue', 'new', a.meta->'new'->>'venue') end),
     (2, case when (a.meta->'old'->>'position') is distinct from (a.meta->'new'->>'position') then jsonb_build_object('label', 'Position', 'old', a.meta->'old'->>'position', 'new', a.meta->'new'->>'position') end),
     (3, case when (a.meta->'old'->>'start')::timestamptz is distinct from (a.meta->'new'->>'start')::timestamptz
          then jsonb_build_object('label', 'Start', 'old', _mtl_time((a.meta->'old'->>'start')::timestamptz), 'new', _mtl_time((a.meta->'new'->>'start')::timestamptz)) end)
   ) v(o, l) where l is not null $$;

revoke execute on function public._ask_post(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public._chain_due(public.shift_asks) from public, anon, authenticated;
revoke execute on function public._ask_lines(public.shift_asks) from public, anon, authenticated;
revoke execute on function public._ask_next(uuid) from public, anon, authenticated;
revoke execute on function public._ask_remove_waiting(uuid, boolean) from public, anon, authenticated;
revoke execute on function public._asks_tick() from public, anon, authenticated;
revoke execute on function public._ask_apply(uuid, boolean) from public, anon, authenticated;

-- ───────── admin: ask first (earlier start · move · position) ─────────
-- One ask per shift (p_shifts = this person, or the whole start group), sharing one group_key (the tracker).
-- move: p_event + p_start (+ p_code / p_detail when the position changes). earlier_start: p_start. position: p_code / p_detail.
-- An open ask on the same shift is replaced (its card shows "No longer needed").
create or replace function public.admin_ask_change(p_shifts uuid[], p_kind text, p_event uuid default null, p_start timestamptz default null,
                                                   p_code text default null, p_detail text default null, p_hours int default 12)
returns uuid language plpgsql security definer set search_path = public as
$$ declare g uuid := gen_random_uuid(); sid uuid; s shifts%rowtype; a uuid; ev uuid; st timestamptz; cd text; dt text; due timestamptz; old_a record;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind not in ('earlier_start', 'move', 'position') then raise exception 'bad kind'; end if;
  if coalesce(cardinality(p_shifts), 0) = 0 then raise exception 'Pick someone.'; end if;
  perform _asks_tick();
  foreach sid in array p_shifts loop
    select * into s from shifts where id = sid for update;
    if not found then raise exception 'Shift not found.'; end if;
    if s.status = 'declined' or s.attendance is not null then raise exception 'That shift is off the schedule.'; end if;
    if s.planned_start <= now() or exists (select 1 from punches where shift_id = s.id and punch_in is not null) then raise exception 'That shift has started.'; end if;
    ev := case when p_kind = 'move' then p_event else s.event_id end;
    st := case when p_kind = 'position' then s.planned_start else coalesce(p_start, s.planned_start) end;
    cd := case when p_kind = 'position' or (p_kind = 'move' and p_code is not null) then p_code end;
    dt := case when cd is not null then p_detail end;
    if p_kind = 'move' and (ev is null or ev = s.event_id) then raise exception 'Pick the other event.'; end if;
    if p_kind = 'move' and exists (select 1 from shifts x where x.event_id = ev and x.staff_id = s.staff_id) then raise exception 'Already on that event.'; end if;
    if p_kind = 'earlier_start' and (p_start is null or p_start >= s.planned_start) then raise exception 'Pick an earlier start. A later start needs no ask.'; end if;
    if p_kind = 'position' and (cd is null or (cd is not distinct from s.position_code and dt is not distinct from s.position_detail)) then raise exception 'Pick the new position.'; end if;
    for old_a in select x.id from shift_asks x where x.shift_id = s.id and x.status = 'open' loop
      update shift_asks set status = 'cancelled', closed_at = now(), resolved_at = now(), resolved_by = me() where id = old_a.id;
      update messages set meta = meta || jsonb_build_object('state', 'cancelled') where id in (select message_id from shift_ask_targets where ask_id = old_a.id);
    end loop;
    due := greatest(now() + interval '15 minutes', least(now() + make_interval(hours => greatest(1, coalesce(p_hours, 12))), least(s.planned_start, st) - interval '30 minutes'));
    insert into shift_asks(kind, shift_id, event_id, from_event_id, new_start, position_code, position_detail, answer_by, group_key, meta, created_by)
    values (p_kind, s.id, ev, case when p_kind = 'move' then s.event_id end, case when p_kind = 'position' then null else st end, cd, dt, due, g,
            jsonb_build_object('old', _shift_card(s.event_id, s.planned_start, s.position_code, s.position_detail),
                               'new', _shift_card(ev, st, coalesce(cd, s.position_code), case when cd is not null then dt else s.position_detail end)),
            me())
    returning id into a;
    insert into shift_ask_targets(ask_id, staff_id) values (a, s.staff_id);
    perform _ask_post(a, s.staff_id, due);
    insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', s.id, jsonb_build_object('kind', 'ask_change', 'ask', a, 'ask_kind', p_kind));
  end loop;
  return g;
end $$;
grant execute on function public.admin_ask_change(uuid[], text, uuid, timestamptz, text, text, int) to authenticated;

-- ───────── admin: fill one spot by asking several people ─────────
-- p_staff in order (one by one asks them in that order). p_mode 'all' (default, first yes gets it, p_hours = answer-by)
-- or 'chain' (p_wait_min for each person). p_replace_for: the booked person is saved as that shift's replacement.
create or replace function public.admin_fill_spot(p_event uuid, p_start timestamptz, p_code text, p_detail text, p_staff uuid[],
                                                  p_mode text default 'all', p_wait_min int default 60, p_hours int default 2, p_replace_for uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare a uuid; ids uuid[]; i int; due timestamptz; bad text;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_mode not in ('all', 'chain') then raise exception 'bad mode'; end if;
  if p_start is null or p_start <= now() then raise exception 'That shift has started.'; end if;
  perform _asks_tick();
  select array_agg(x order by o) into ids from (select x, min(o) o from unnest(coalesce(p_staff, '{}')) with ordinality u(x, o) where x is not null group by x) q;
  if coalesce(cardinality(ids), 0) = 0 then raise exception 'Tick at least one person.'; end if;
  select string_agg(st.full_name, ', ') into bad from staff st where st.id = any(ids) and exists (select 1 from shifts x where x.event_id = p_event and x.staff_id = st.id);
  if bad is not null then raise exception '% % already on this event.', bad, case when bad like '%,%' then 'are' else 'is' end; end if;
  insert into shift_asks(kind, event_id, new_start, position_code, position_detail, mode, wait_min, answer_by, replace_for, meta, created_by)
  values ('fill', p_event, p_start, coalesce(p_code, 'W'), p_detail, p_mode, case when p_mode = 'chain' then greatest(15, least(720, coalesce(p_wait_min, 60))) end,
          case when p_mode = 'all' then greatest(now() + interval '15 minutes', least(now() + make_interval(hours => greatest(1, coalesce(p_hours, 2))), p_start - interval '30 minutes')) end,
          p_replace_for, jsonb_build_object('new', _shift_card(p_event, p_start, coalesce(p_code, 'W'), p_detail)), me())
  returning id into a;
  for i in 1 .. cardinality(ids) loop insert into shift_ask_targets(ask_id, staff_id, ord) values (a, ids[i], i); end loop;
  if p_mode = 'all' then
    select answer_by into due from shift_asks where id = a;
    for i in 1 .. cardinality(ids) loop perform _ask_post(a, ids[i], due); end loop;
  else
    perform _ask_next(a);
  end if;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'event', p_event, jsonb_build_object('kind', 'fill_spot', 'ask', a, 'mode', p_mode, 'asked', cardinality(ids)));
  return a;
end $$;
grant execute on function public.admin_fill_spot(uuid, timestamptz, text, text, uuid[], text, int, int, uuid) to authenticated;

-- Tracker buttons: Ask everyone left now (one by one → everyone still waiting gets it now, first yes wins) · Stop asking.
create or replace function public.admin_ask_rest_now(p_ask uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; t record; due timestamptz; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  perform _asks_tick();
  select * into a from shift_asks where id = p_ask for update;
  if not found or a.status <> 'open' or a.kind <> 'fill' then raise exception 'This ask is closed.'; end if;
  due := coalesce((select max(due_at) from shift_ask_targets where ask_id = a.id and asked_at is not null and answer is null and removed_at is null), _chain_due(a));
  update shift_asks set mode = 'all', answer_by = due where id = a.id;
  for t in select staff_id from shift_ask_targets where ask_id = a.id and asked_at is null and removed_at is null order by ord loop
    perform _ask_post(a.id, t.staff_id, due);
  end loop;
  update shift_ask_targets set due_at = due where ask_id = a.id and asked_at is not null and answer is null and removed_at is null;
  update messages set meta = meta || jsonb_build_object('due_at', due) where id in (select message_id from shift_ask_targets where ask_id = a.id and answer is null and removed_at is null);
end $$;
grant execute on function public.admin_ask_rest_now(uuid) to authenticated;

-- Stop: fill → disappears silently for everyone waiting. Change ask → the card says "No longer needed", nothing changes.
create or replace function public.admin_stop_ask(p_ask uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  perform _asks_tick();
  select * into a from shift_asks where id = p_ask for update;
  if not found or a.status <> 'open' then raise exception 'This ask is already closed.'; end if;
  if a.kind = 'fill' then perform _ask_remove_waiting(a.id);
  else update messages set meta = meta || jsonb_build_object('state', 'cancelled') where id in (select message_id from shift_ask_targets where ask_id = a.id); end if;
  update shift_asks set status = 'cancelled', closed_at = now(), resolved_at = now(), resolved_by = me() where id = a.id;
end $$;
grant execute on function public.admin_stop_ask(uuid) to authenticated;

-- Needs you after a No / no answer:
--   keep           Keep at the old time / Keep her at <old>  (note "No change · you stay …")
--   change_anyway  Change anyway / Move anyway → applied + "Your shift changed" note with Got it / Can't make it
--   replace        Take off and replace (change asks) → shift removed (+ Shift removed note); returns the spot to fill
--   ask_else       Ask someone else for <new> (move) → returns the new event's spot to fill; she stays where she is
--   dismiss        fill "No one took the spot" card closed
create or replace function public.admin_resolve_ask(p_ask uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; s shifts%rowtype; who uuid; spot jsonb := null; al uuid; ln jsonb; nm text; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_action not in ('keep', 'change_anyway', 'replace', 'ask_else', 'dismiss') then raise exception 'bad action'; end if;
  perform _asks_tick();
  select * into a from shift_asks where id = p_ask for update;
  if not found then raise exception 'Not found.'; end if;
  if a.resolution is not null then raise exception 'Already handled.'; end if;
  if a.status not in ('declined', 'expired', 'nobody') then raise exception 'Still waiting for an answer.'; end if;
  if a.kind = 'fill' and p_action not in ('dismiss', 'ask_else') then raise exception 'bad action'; end if;
  if a.kind <> 'fill' then select * into s from shifts where id = a.shift_id for update; end if;
  who := s.staff_id;
  if p_action = 'keep' and s.id is not null then
    perform _post_note(who, 'No change · you stay at ' || coalesce(a.meta->'old'->>'venue', '') || ' · ' || _mtl_time(s.planned_start) || '.',
      jsonb_build_object('card', 'ask_result', 'ask_id', a.id, 'kind', a.kind, 'answer', 'keep', 'old', a.meta->'old', 'new', a.meta->'new'), s.id);
  elsif p_action = 'change_anyway' then
    if s.id is null then raise exception 'This shift is gone.'; end if;
    perform _ask_apply(a.id, false);
    ln := _ask_lines(a);
    if exists (select 1 from shifts where id = s.id and notified_at is not null) then
      insert into staff_alerts(staff_id, kind, title, body, event_id)
      values (who, 'moved', 'Your shift changed', 'Now ' || _mtl_day((a.meta->'new'->>'date')::date) || ' · ' || coalesce(a.meta->'new'->>'venue', '') || ' · starts '
              || _mtl_time((a.meta->'new'->>'start')::timestamptz) || ' (was ' || coalesce(a.meta->'old'->>'venue', '') || ' · ' || _mtl_time(s.planned_start) || ')', a.event_id)
      returning id into al;
    end if;
    perform _post_note(who, '🗓 Your shift changed · ' || _mtl_day((a.meta->'new'->>'date')::date) || ' · ' || coalesce(a.meta->'new'->>'venue', ''),
      jsonb_build_object('card', 'shift_changed', 'shift_id', s.id, 'alert_id', al, 'date', a.meta->'new'->>'date', 'venue', a.meta->'new'->>'venue', 'lines', ln), s.id);
  elsif p_action = 'replace' then
    if a.kind = 'move' then raise exception 'For a move, use Ask someone else or Move anyway.'; end if;
    if s.id is null then raise exception 'This shift is gone.'; end if;
    if exists (select 1 from punches where shift_id = s.id and punch_in is not null) then raise exception 'This shift has started.'; end if;
    spot := jsonb_build_object('event_id', s.event_id, 'start', s.planned_start, 'code', s.position_code, 'detail', s.position_detail, 'date', a.meta->'old'->>'date');
    select split_part(full_name, ' ', 1) into nm from staff where id = who;
    if exists (select 1 from shifts where id = s.id and notified_at is not null) then
      insert into staff_alerts(staff_id, kind, title, body, event_id)
      values (who, 'removed', 'You''re no longer on ' || _mtl_day((a.meta->'old'->>'date')::date), coalesce(a.meta->'old'->>'venue', '') || ' · that shift was removed. Questions? Text Ronnie.', null)
      returning id into al;
    end if;
    perform _post_note(who, '🗓 Shift removed · ' || _mtl_day((a.meta->'old'->>'date')::date) || ' · ' || coalesce(a.meta->'old'->>'venue', '') || '. You''re no longer on this event. Questions? Reply here.',
      jsonb_build_object('card', 'shift_removed', 'alert_id', al, 'date', a.meta->'old'->>'date', 'venue', a.meta->'old'->>'venue'), null);
    insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', s.id, jsonb_build_object('kind', 'removed', 'staff', who, 'from', s.event_id, 'ask', a.id));
    delete from shifts where id = s.id;
  elsif p_action = 'ask_else' then
    spot := jsonb_build_object('event_id', a.event_id, 'start', coalesce(a.new_start, (a.meta->'new'->>'start')::timestamptz),
                               'code', coalesce(a.position_code, a.meta->'new'->>'code'), 'detail', a.position_detail, 'date', a.meta->'new'->>'date');
  end if;
  update shift_asks set resolution = p_action, resolved_at = now(), resolved_by = me() where id = a.id;
  return jsonb_build_object('spot', spot);
end $$;
grant execute on function public.admin_resolve_ask(uuid, text) to authenticated;

-- ───────── staff: answer ─────────
-- Returns {status}: change asks 'accepted' | 'declined' | 'expired' | 'cancelled'; fill 'booked' | 'no' | 'gone'.
create or replace function public.answer_shift_ask(p_ask uuid, p_yes boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; t shift_ask_targets%rowtype; s shifts%rowtype; nid uuid; nm text; o jsonb; n jsonb; body text;
begin
  if me() is null then raise exception 'not signed in'; end if;
  perform _asks_tick();
  select * into a from shift_asks where id = p_ask for update;
  select * into t from shift_ask_targets where ask_id = p_ask and staff_id = me() for update;
  if a.id is null or t.ask_id is null then raise exception 'This question is not for you.'; end if;
  o := a.meta->'old'; n := a.meta->'new';

  if a.kind = 'fill' then
    -- stale card (someone else took it / stopped / their turn passed): nothing booked, the card goes away
    if a.status <> 'open' or t.removed_at is not null or t.answer is not null or t.asked_at is null then
      if t.removed_at is null and t.answer is null then update shift_ask_targets set removed_at = now() where ask_id = a.id and staff_id = me(); end if;
      perform _drop_note(t.message_id);
      return jsonb_build_object('status', 'gone');
    end if;
    if not p_yes then
      update shift_ask_targets set answer = 'no', answered_at = now(), note = nullif(trim(coalesce(p_note, '')), '') where ask_id = a.id and staff_id = me();
      perform _drop_note(t.message_id);
      if a.mode = 'chain' then perform _ask_next(a.id);
      elsif not exists (select 1 from shift_ask_targets where ask_id = a.id and answer is null and removed_at is null) then
        update shift_asks set status = 'nobody', closed_at = now() where id = a.id;
      end if;
      return jsonb_build_object('status', 'no');
    end if;
    if exists (select 1 from shifts x where x.event_id = a.event_id and x.staff_id = me()) then raise exception 'You''re already on this event. Message Ronnie.'; end if;
    insert into shifts(event_id, staff_id, position_code, position_detail, planned_start, planned_end, status, responded_at, notified_at, replacement_for)
    values (a.event_id, me(), a.position_code, a.position_detail, a.new_start, _end_for(a.event_id, a.new_start), 'confirmed', now(), now(), a.replace_for)
    returning id into nid;
    update shift_asks set status = 'filled', booked_shift_id = nid, closed_at = now() where id = a.id;
    update shift_ask_targets set answer = 'yes', answered_at = now() where ask_id = a.id and staff_id = me();
    perform _ask_remove_waiting(a.id);   -- everyone else: the ask just disappears, no message
    perform _note_meta(t.message_id, jsonb_build_object('state', 'yes'));
    perform _post_note(me(), '🙋 You''re booked · ' || _mtl_day((n->>'date')::date) || ' · ' || coalesce(n->>'venue', '') || ' · ' || coalesce(n->>'position', '') || ' · '
                              || _mtl_time(a.new_start) || '. It''s in your schedule.',
      jsonb_build_object('card', 'ask_result', 'ask_id', a.id, 'kind', 'fill', 'answer', 'yes', 'new', n), nid);
    select full_name into nm from staff where id = me();
    insert into event_notices(event_id, body, by_staff) values (a.event_id, nm || ' joins · ' || _role_label(a.position_code, a.position_detail) || ' · ' || _mtl_time(a.new_start), me());
    insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', nid, jsonb_build_object('kind', 'fill_yes', 'ask', a.id));
    return jsonb_build_object('status', 'booked', 'shift_id', nid);
  end if;

  -- change asks (one person each)
  if a.status <> 'open' or t.answer is not null then return jsonb_build_object('status', a.status); end if;
  if p_yes then
    perform _ask_apply(a.id, true);
    update shift_asks set status = 'accepted', closed_at = now() where id = a.id;
    update shift_ask_targets set answer = 'yes', answered_at = now() where ask_id = a.id and staff_id = me();
    perform _note_meta(t.message_id, jsonb_build_object('state', 'yes'));
    body := case a.kind when 'move' then '✓ You''re on ' || coalesce(n->>'venue', '') || ' · ' || coalesce(n->>'position', '') || ' · ' || _mtl_time((n->>'start')::timestamptz)
                        when 'position' then '✓ You''re now ' || coalesce(n->>'position', '')
                        else '✓ Your start is now ' || _mtl_time(a.new_start) end;
    perform _post_note(me(), body, jsonb_build_object('card', 'ask_result', 'ask_id', a.id, 'kind', a.kind, 'answer', 'yes', 'old', o, 'new', n), a.shift_id);
    return jsonb_build_object('status', 'accepted');
  end if;
  update shift_asks set status = 'declined', closed_at = now() where id = a.id;
  update shift_ask_targets set answer = 'no', answered_at = now(), note = nullif(trim(coalesce(p_note, '')), '') where ask_id = a.id and staff_id = me();
  perform _note_meta(t.message_id, jsonb_build_object('state', 'no'));
  body := case a.kind when 'move' then 'You stay at ' || coalesce(o->>'venue', '') || ' for now. Ronnie will get back to you.'
                      when 'position' then 'You stay ' || coalesce(o->>'position', '') || ' for now. Ronnie will get back to you.'
                      else 'You stay at ' || _mtl_time((o->>'start')::timestamptz) || ' for now. Ronnie will get back to you.' end;
  perform _post_note(me(), body, jsonb_build_object('card', 'ask_result', 'ask_id', a.id, 'kind', a.kind, 'answer', 'no', 'old', o, 'new', n,
                                                    'note', nullif(trim(coalesce(p_note, '')), '')), a.shift_id);
  return jsonb_build_object('status', 'declined');
end $$;
grant execute on function public.answer_shift_ask(uuid, boolean, text) to authenticated;

-- Staff "No" note added after answering (the optional box under "You stay at … for now").
create or replace function public.shift_ask_note(p_ask uuid, p_note text) returns void
language plpgsql security definer set search_path = public as
$$ begin
  update shift_ask_targets set note = nullif(trim(coalesce(p_note, '')), '') where ask_id = p_ask and staff_id = me() and answer = 'no';
  if not found then raise exception 'Nothing to add a note to.'; end if;
  update messages x set meta = x.meta || jsonb_build_object('note', nullif(trim(coalesce(p_note, '')), ''))
    from conversations c where c.id = x.conversation_id and c.staff_id = me() and x.meta->>'card' = 'ask_result' and x.meta->>'ask_id' = p_ask::text;
end $$;
grant execute on function public.shift_ask_note(uuid, text) to authenticated;

-- ───────── reads ─────────
-- Staff cards (Home · Messages · My dates). p_ids null = my open asks; else these asks (the notes in a conversation).
-- p_staff: admin only (his view of that person's conversation / "view as"). Never says how many were asked or the mode.
-- state: open · yes · no · expired · cancelled · booked · gone
create or replace function public.shift_ask_cards(p_ids uuid[] default null, p_staff uuid default null) returns json
language plpgsql security definer set search_path = public as
$$ declare sid uuid := case when p_staff is not null and is_admin() then p_staff else me() end; out json; begin
  if sid is null then return '[]'::json; end if;
  perform _asks_tick();
  select coalesce(json_agg(x order by x.asked_at), '[]'::json) into out from (
    select a.id as ask_id, a.kind, a.meta, t.asked_at, t.due_at, t.answer, t.answered_at, t.note, t.message_id,
           case when a.kind = 'fill' and a.status = 'filled' and t.answer = 'yes' then 'booked'
                when t.answer = 'yes' then 'yes'
                when t.answer = 'no' then 'no'
                when t.removed_at is not null or t.asked_at is null then 'gone'
                when t.answer = 'expired' or a.status = 'expired' then 'expired'
                when a.status = 'cancelled' then 'cancelled'
                when a.status <> 'open' then 'gone'
                else 'open' end as state,
           case when a.kind <> 'fill' then (select full_name from staff where id = sid) end as staff_name
      from shift_ask_targets t join shift_asks a on a.id = t.ask_id
     where t.staff_id = sid
       and (case when p_ids is null then t.asked_at is not null and t.answer is null and t.removed_at is null and a.status = 'open'
                 else a.id = any(p_ids) end)) x;
  if sid = me() then
    update shift_ask_targets t set seen_at = now()
     where t.staff_id = sid and t.seen_at is null and t.asked_at is not null and t.answer is null and t.removed_at is null
       and (p_ids is null or t.ask_id = any(p_ids));
  end if;
  return out;
end $$;
grant execute on function public.shift_ask_cards(uuid[], uuid) to authenticated;

-- Ronnie: every ask touching these dates (Day view trackers, Needs you, his conversation cards).
-- needs_you = No / no answer / nobody took it, not handled yet.
create or replace function public.admin_shift_asks(p_from date, p_to date) returns json
language plpgsql security definer set search_path = public as
$$ declare out json; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  perform _asks_tick();
  select coalesce(json_agg(x order by x.created_at), '[]'::json) into out from (
    select a.id, a.kind, a.shift_id, a.event_id, a.from_event_id, a.new_start, a.position_code, a.position_detail, a.mode, a.wait_min, a.answer_by,
           a.group_key, a.replace_for, a.meta, a.status, a.resolution, a.booked_shift_id, a.created_at, a.closed_at,
           (a.status in ('declined', 'expired', 'nobody') and a.resolution is null) as needs_you,
           e.event_date, e.title as event_title, e.department,
           (select s.staff_id from shifts s where s.id = a.shift_id) as shift_staff_id,
           (select coalesce(json_agg(json_build_object('staff_id', t.staff_id, 'full_name', st.full_name, 'phone', st.phone, 'photo_url', st.photo_url,
                     'ord', t.ord, 'asked_at', t.asked_at, 'due_at', t.due_at, 'answer', t.answer, 'answered_at', t.answered_at, 'note', t.note,
                     'removed_at', t.removed_at, 'seen_at', t.seen_at) order by t.ord), '[]'::json)
              from shift_ask_targets t join staff st on st.id = t.staff_id where t.ask_id = a.id) as targets
      from shift_asks a join events e on e.id = a.event_id
     where (e.event_date between p_from and p_to
            or exists (select 1 from events f where f.id = a.from_event_id and f.event_date between p_from and p_to))) x;
  return out;
end $$;
grant execute on function public.admin_shift_asks(date, date) to authenticated;

-- ───────── check ─────────
select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('shift_asks', 'shift_ask_targets')) tables_2,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_shift_note', 'shift_note_got_it', 'admin_ask_change',
          'admin_fill_spot', 'admin_ask_rest_now', 'admin_stop_ask', 'admin_resolve_ask', 'answer_shift_ask', 'shift_ask_note', 'shift_ask_cards',
          'admin_shift_asks', '_asks_tick', '_awake_plus')) rpcs_13,
       public._awake_plus(((current_date + time '21:30') at time zone 'America/Toronto'), 60) = ((current_date + 1 + time '08:30') at time zone 'America/Toronto') night_skip_ok;
