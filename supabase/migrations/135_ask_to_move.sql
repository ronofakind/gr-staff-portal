-- 135 · Nov 23 2026 · Ask people on other events to move (Ronnie: "someone cancels and I need to move them to another event …
-- I want to be able to ask a few people if they can move" · "not just an addition to their shift but a complete change, either
-- the same venue but an earlier time, or a different venue different time" · first yes gets it · app only · the old spot stays open).
-- Built on the push 40 fill asks (044): same All at once / One by one, same staff card, same "first yes wins".
-- Additive: two columns on shift_ask_targets; existing asks behave exactly as before (their new columns are empty).
alter table public.shift_ask_targets add column if not exists move_from uuid references public.shifts(id) on delete set null; -- their shift that ends if they say yes
alter table public.shift_ask_targets add column if not exists meta jsonb not null default '{}'::jsonb;  -- {ask:'move'|'earlier'|'also', old:{card}}

-- The note in their Ronnie conversation: their own wording + their own "old" shift.
create or replace function public._ask_post(p_ask uuid, p_staff uuid, p_due timestamptz) returns void
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; tm jsonb; m uuid; body text; n jsonb; begin
  select * into a from shift_asks where id = p_ask;
  select coalesce(meta, '{}'::jsonb) into tm from shift_ask_targets where ask_id = p_ask and staff_id = p_staff;
  n := a.meta->'new';
  body := case when tm->>'ask' = 'move' then '🗓 Can you work this instead? '
               when tm->>'ask' = 'earlier' then '🗓 Can you change your start? '
               when tm->>'ask' = 'also' then '🙋 Can you also work this shift? '
               when a.kind = 'fill' then '🙋 Can you work this shift? ' when a.kind = 'move' then '🗓 Can you work this event instead? '
               when a.kind = 'position' then '🗓 Can you do a new position? ' else '🗓 Can you do a new time? ' end
          || _mtl_day((n->>'date')::date) || ' · ' || coalesce(n->>'venue', '') || ' · ' || coalesce(n->>'position', '') || ' · '
          || _mtl_time((n->>'start')::timestamptz) || '. Answer by ' || to_char(p_due at time zone 'America/Toronto', 'Dy FMHH12:MI AM') || ' in the app.';
  m := _post_note(p_staff, body, a.meta || coalesce(tm, '{}'::jsonb) || jsonb_build_object('card', 'ask', 'ask_id', a.id, 'kind', a.kind, 'due_at', p_due), a.shift_id);
  update shift_ask_targets set asked_at = now(), due_at = p_due, message_id = m where ask_id = p_ask and staff_id = p_staff;
end $$;

-- Ask people already working that day. p_move = true: "Move them here" (a complete change, their shift ends if they say yes);
-- false: "Add this shift" (they keep theirs). Same event at another time is allowed for a move (e.g. 5:30 → 4:30).
create or replace function public.admin_fill_spot_moves(p_event uuid, p_start timestamptz, p_code text, p_detail text, p_staff uuid[], p_move boolean,
                                                        p_mode text default 'all', p_wait_min int default 60, p_hours int default 2, p_replace_for uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare a uuid; ids uuid[]; i int; due timestamptz; bad text; d date; cur shifts%rowtype; kindw text;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_mode not in ('all', 'chain') then raise exception 'bad mode'; end if;
  if p_start is null or p_start <= now() then raise exception 'That shift has started.'; end if;
  perform _asks_tick();
  select event_date into d from events where id = p_event;
  select array_agg(x order by o) into ids from (select x, min(o) o from unnest(coalesce(p_staff, '{}')) with ordinality u(x, o) where x is not null group by x) q;
  if coalesce(cardinality(ids), 0) = 0 then raise exception 'Tick at least one person.'; end if;
  if not p_move then
    select string_agg(st.full_name, ', ') into bad from staff st where st.id = any(ids) and exists (select 1 from shifts x where x.event_id = p_event and x.staff_id = st.id and coalesce(x.attendance, '') <> 'cancelled' and x.status <> 'declined');
    if bad is not null then raise exception '% % already on this event. Use “Move them here” to change their time.', bad, case when bad like '%,%' then 'are' else 'is' end; end if;
  end if;
  insert into shift_asks(kind, event_id, new_start, position_code, position_detail, mode, wait_min, answer_by, replace_for, meta, created_by)
  values ('fill', p_event, p_start, coalesce(p_code, 'W'), p_detail, p_mode, case when p_mode = 'chain' then greatest(15, least(720, coalesce(p_wait_min, 60))) end,
          case when p_mode = 'all' then greatest(now() + interval '15 minutes', least(now() + make_interval(hours => greatest(1, coalesce(p_hours, 2))), p_start - interval '30 minutes')) end,
          p_replace_for, jsonb_build_object('new', _shift_card(p_event, p_start, coalesce(p_code, 'W'), p_detail)), me())
  returning id into a;
  for i in 1 .. cardinality(ids) loop
    -- their shift that day (the one on this event first, else the closest to the new start)
    select x.* into cur from shifts x join events e on e.id = x.event_id
     where x.staff_id = ids[i] and e.event_date = d and x.id is distinct from p_replace_for
       and coalesce(x.attendance, '') <> 'cancelled' and x.status <> 'declined'
     order by (x.event_id = p_event) desc, abs(extract(epoch from (x.planned_start - p_start))) limit 1;
    if cur.id is null and p_move then raise exception 'One of them has no shift that day. Use the Free list instead.'; end if;
    kindw := case when not p_move then 'also' when cur.event_id = p_event then 'earlier' else 'move' end;
    insert into shift_ask_targets(ask_id, staff_id, ord, move_from, meta)
    values (a, ids[i], i, case when p_move then cur.id end,
            jsonb_build_object('ask', kindw, 'old', case when cur.id is not null then _shift_card(cur.event_id, cur.planned_start, cur.position_code, cur.position_detail) end));
    cur := null;
  end loop;
  if p_mode = 'all' then
    select answer_by into due from shift_asks where id = a;
    for i in 1 .. cardinality(ids) loop perform _ask_post(a, ids[i], due); end loop;
  else
    perform _ask_next(a);
  end if;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'event', p_event, jsonb_build_object('kind', case when p_move then 'ask_move' else 'ask_also' end, 'ask', a, 'mode', p_mode, 'asked', cardinality(ids)));
  return a;
end $$;
revoke all on function public.admin_fill_spot_moves(uuid, timestamptz, text, text, uuid[], boolean, text, int, int, uuid) from public, anon;
grant execute on function public.admin_fill_spot_moves(uuid, timestamptz, text, text, uuid[], boolean, text, int, int, uuid) to authenticated;

-- Staff cards: their own wording + their own old shift merged into the card.
create or replace function public.shift_ask_cards(p_ids uuid[] default null, p_staff uuid default null) returns json
language plpgsql security definer set search_path = public as
$$ declare sid uuid := case when p_staff is not null and is_admin() then p_staff else me() end; out json; begin
  if sid is null then return '[]'::json; end if;
  perform _asks_tick();
  select coalesce(json_agg(x order by x.asked_at), '[]'::json) into out from (
    select a.id as ask_id, a.kind, a.meta || coalesce(t.meta, '{}'::jsonb) as meta, t.asked_at, t.due_at, t.answer, t.answered_at, t.note, t.message_id,
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

-- Answer: same as 044, plus a "move" yes ends their old shift first (that spot is left open for Ronnie).
create or replace function public.answer_shift_ask(p_ask uuid, p_yes boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare a shift_asks%rowtype; t shift_ask_targets%rowtype; s shifts%rowtype; nid uuid; nm text; o jsonb; n jsonb; body text; old shifts%rowtype; ov text;
begin
  if me() is null then raise exception 'not signed in'; end if;
  perform _asks_tick();
  select * into a from shift_asks where id = p_ask for update;
  select * into t from shift_ask_targets where ask_id = p_ask and staff_id = me() for update;
  if a.id is null or t.ask_id is null then raise exception 'This question is not for you.'; end if;
  o := a.meta->'old'; n := a.meta->'new';

  if a.kind = 'fill' then
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
    select full_name into nm from staff where id = me();
    -- 135 · a move: their old shift ends now (removed, the spot stays open); the old event's team sees it
    if t.move_from is not null then
      select * into old from shifts where id = t.move_from and staff_id = me();
      if old.id is not null then
        select coalesce(v.name, e.title) into ov from events e left join venues v on v.id = e.venue_id where e.id = old.event_id;
        begin
          delete from shifts where id = old.id;
        exception when foreign_key_violation then
          update shifts set status = 'declined', changed_at = now() where id = old.id;
        end;
        if old.event_id <> a.event_id then
          insert into event_notices(event_id, body, by_staff) values (old.event_id, nm || ' moved to ' || coalesce(n->>'venue', 'another event') || ' · their spot is open', me());
        end if;
        insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', old.id, jsonb_build_object('kind', 'moved_out', 'ask', a.id, 'from_event', old.event_id, 'to_event', a.event_id));
      end if;
    end if;
    if exists (select 1 from shifts x where x.event_id = a.event_id and x.staff_id = me() and x.status <> 'declined') then raise exception 'You''re already on this event. Message Ronnie.'; end if;
    insert into shifts(event_id, staff_id, position_code, position_detail, planned_start, planned_end, status, responded_at, notified_at, replacement_for)
    values (a.event_id, me(), a.position_code, a.position_detail, a.new_start, _end_for(a.event_id, a.new_start), 'confirmed', now(), now(), a.replace_for)
    returning id into nid;
    update shift_asks set status = 'filled', booked_shift_id = nid, closed_at = now() where id = a.id;
    update shift_ask_targets set answer = 'yes', answered_at = now() where ask_id = a.id and staff_id = me();
    perform _ask_remove_waiting(a.id);
    perform _note_meta(t.message_id, jsonb_build_object('state', 'yes'));
    perform _post_note(me(), case when t.move_from is not null then '✓ You''re moved · ' else '🙋 You''re booked · ' end
                              || _mtl_day((n->>'date')::date) || ' · ' || coalesce(n->>'venue', '') || ' · ' || coalesce(n->>'position', '') || ' · '
                              || _mtl_time(a.new_start) || '. It''s in your schedule.',
      jsonb_build_object('card', 'ask_result', 'ask_id', a.id, 'kind', 'fill', 'answer', 'yes', 'new', n) || coalesce(t.meta, '{}'::jsonb), nid);
    insert into event_notices(event_id, body, by_staff) values (a.event_id, nm || ' joins · ' || _role_label(a.position_code, a.position_detail) || ' · ' || _mtl_time(a.new_start), me());
    insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', nid, jsonb_build_object('kind', case when t.move_from is not null then 'move_yes' else 'fill_yes' end, 'ask', a.id));
    return jsonb_build_object('status', 'booked', 'shift_id', nid);
  end if;

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

select 'RESULT ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shift_ask_targets' and column_name in ('move_from', 'meta')) || ' cols · '
  || (select count(*) from pg_proc where proname = 'admin_fill_spot_moves') || ' new fn · '
  || (select count(*) from shift_asks where status = 'open') || ' open asks untouched';
