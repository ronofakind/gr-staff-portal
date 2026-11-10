-- Push 47 (Nov 3): Can't make it / Not confirmed → Find replacement · Client changes after booking.
-- File only: apply by hand in the SQL editor. Safe to run twice (create or replace / drop trigger if exists).
-- Needs 034 (cancel columns, replacement_for), 039 (confirm window), 042 (messages), 044 (asks), 046 (alert queue) applied first.
-- Nothing is dropped. No existing function changes; only new functions and two new AFTER triggers on shifts.
--
-- Rules (Ronnie, Nov 3, "AdminConfirmReplaceV1" / "AdminClientChangeV1"):
--   · Staff side stays as live (push 33 confirm window, push 28 Can't make it / self-cancel). Nothing is auto-cancelled.
--   · Find replacement = push 40 fill a spot (admin_fill_spot with p_replace_for). The person being replaced stays on the
--     event until someone says yes. When the replacement is booked (a shift inserted with replacement_for):
--       – they cancelled themselves  → a "Thanks for telling us, you're off <date>." note (+ phone alert).
--       – still booked / confirmed (Not confirmed → Replace, or Client change → Swap) → their shift goes to status
--         'declined' (hidden everywhere, not a reliability flag), Home alert + a note "Someone else is taking your spot …".
--       – every replacement is written to change_log (kind 'replaced').
--   · If the person confirms while Ronnie is still asking for a replacement (Not confirmed → Replace), the ask stops
--     silently for everyone still waiting (same as Stop asking).
--   · Nudge = one more phone alert (push 42 queue). People with no alert phone get it as a text (text_outbox) from the sender.
--   · Client change removals after confirmations went out: "You're no longer needed <date>. Sorry for the change."
--     (admin_off_note). No reliability hit (the shift is deleted by the app, logged as kind 'removed', reason 'client_change').
--   · English only, never "first come", never "2IC".

-- ───────── "you're off" note: shift_removed card with its own line (ShiftNotes shows meta.line when present) ─────────
-- Posts the note in the person's Ronnie conversation and puts the same words on the phone alert the note queues.
create or replace function public._off_note(p_staff uuid, p_date date, p_venue text, p_line text, p_title text default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare m uuid; begin
  if p_staff is null then return null; end if;
  m := _post_note(p_staff, coalesce(p_line, '🗓 Shift removed · ' || _mtl_day(p_date)),
         jsonb_build_object('card', 'shift_removed', 'date', p_date, 'venue', p_venue, 'line', p_line), null);
  -- alerts_on_message (046) queued "🗓 Shift removed · <date>" for this note (send_key note:<id>): same words as the note instead.
  perform _alert_add(p_staff, 'shift', 'note:' || m, coalesce(p_title, '🗓 ' || _mtl_day(p_date)), concat_ws(' · ', p_venue, p_line),
    '👉 Tap to open', '/messages?c=ronnie', p_date, '{}', '[]', null, true);
  return m;
end $$;
revoke execute on function public._off_note(uuid, date, text, text, text) from public, anon, authenticated;

-- Admin app (Client change → removed after confirmations went out).
create or replace function public.admin_off_note(p_staff uuid, p_date date, p_venue text, p_line text, p_title text default null)
returns uuid language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return _off_note(p_staff, p_date, p_venue, p_line, p_title);
end $$;
grant execute on function public.admin_off_note(uuid, date, text, text, text) to authenticated;

-- ───────── a replacement is booked → the person replaced comes off ─────────
create or replace function public.shifts_on_replaced() returns trigger
language plpgsql security definer set search_path = public as
$$ declare o shifts%rowtype; d date; v text; nm text; al uuid; begin
  begin
    select * into o from shifts where id = new.replacement_for;
    if not found or o.id = new.id then return null; end if;
    -- a second replacement for the same shift: nothing more to tell
    if exists (select 1 from shifts x where x.replacement_for = o.id and x.id <> new.id) then return null; end if;
    select e.event_date, _venue_of(e.id) into d, v from events e where e.id = o.event_id;
    select full_name into nm from staff where id = new.staff_id;
    if o.attendance in ('cancelled', 'no_show') then
      perform _off_note(o.staff_id, d, v, 'Thanks for telling us, you''re off ' || _mtl_day(d) || '.', '🗓 You''re off ' || _mtl_day(d));
    elsif o.attendance is null and o.status in ('booked', 'confirmed') then
      update shifts set status = 'declined' where id = o.id;
      if o.notified_at is not null then
        insert into staff_alerts(staff_id, kind, title, body, event_id)
        values (o.staff_id, 'removed', 'You''re no longer on ' || _mtl_day(d), coalesce(v, '') || ' · someone else is taking your spot. Questions? Text Ronnie.', null)
        returning id into al;
      end if;
      perform _off_note(o.staff_id, d, v, 'Someone else is taking your spot on ' || _mtl_day(d) || '. Sorry for the change. Questions? Reply here.',
                        '🗓 You''re no longer on ' || _mtl_day(d));
    end if;
    insert into change_log(by_staff, entity, entity_id, change)
    values (me(), 'shift', o.id, jsonb_build_object('kind', 'replaced', 'event', o.event_id, 'old_shift', o.id, 'old_staff', o.staff_id,
            'new_shift', new.id, 'new_staff', new.staff_id, 'new_name', nm, 'was', case when o.attendance is not null then 'cancelled' else o.status end));
  exception when others then raise warning 'shifts_on_replaced: %', sqlerrm; -- never blocks the booking
  end;
  return null;
end $$;
drop trigger if exists shifts_on_replaced on public.shifts;
create trigger shifts_on_replaced after insert on public.shifts
  for each row when (new.replacement_for is not null) execute function public.shifts_on_replaced();

-- ───────── they confirmed after all → stop asking for their replacement (silently, like Stop asking) ─────────
create or replace function public.shifts_on_confirm_stop_replace() returns trigger
language plpgsql security definer set search_path = public as
$$ declare a record; begin
  begin
    for a in select id from shift_asks where kind = 'fill' and status = 'open' and replace_for = new.id loop
      perform _ask_remove_waiting(a.id);
      update shift_asks set status = 'cancelled', closed_at = now(), resolved_at = now() where id = a.id;
      insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', new.id, jsonb_build_object('kind', 'replace_stopped', 'ask', a.id, 'why', 'confirmed'));
    end loop;
  exception when others then raise warning 'shifts_on_confirm_stop_replace: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists shifts_on_confirm_stop_replace on public.shifts;
create trigger shifts_on_confirm_stop_replace after update of status on public.shifts
  for each row when (new.status = 'confirmed' and old.status = 'booked' and new.attendance is null) execute function public.shifts_on_confirm_stop_replace();

-- ───────── Nudge: one more confirm alert (Not confirmed card) ─────────
-- Returns when it was queued. One nudge per shift per 30 min.
create or replace function public.admin_nudge_confirm(p_shift uuid) returns timestamptz
language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; d date; v text; t timestamptz := now(); begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select * into s from shifts where id = p_shift;
  if not found then raise exception 'This shift is gone.'; end if;
  if s.status <> 'booked' or s.attendance is not null then raise exception 'Already answered.'; end if;
  if s.confirm_sent_at is null then raise exception 'Confirmations were not sent for this shift yet.'; end if;
  if s.planned_start <= now() then raise exception 'This shift has started.'; end if;
  if exists (select 1 from alert_queue q where q.staff_id = s.staff_id and q.send_key like 'nudge:' || s.id || ':%' and q.created_at > now() - interval '30 minutes') then
    raise exception 'Nudged less than 30 min ago.';
  end if;
  select e.event_date, _venue_of(e.id) into d, v from events e where e.id = s.event_id;
  perform _alert_add(s.staff_id, 'confirm_remind', 'nudge:' || s.id || ':' || extract(epoch from t)::bigint,
    '✅ Please confirm your shift', concat_ws(' · ', _mtl_day(d), v, _mtl_time(s.planned_start)),
    '👉 Tap to confirm · 1 tap', '/', d, jsonb_build_object('shift_id', s.id, 'by', s.confirm_by, 'nudge', true),
    '[{"action":"confirm","title":"CONFIRM"},{"action":"open","title":"OPEN"}]', 'gr-confirm-' || s.id);
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'shift', s.id, jsonb_build_object('kind', 'confirm_nudge'));
  return t;
end $$;
grant execute on function public.admin_nudge_confirm(uuid) to authenticated;

-- ───────── check ─────────
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
          ('_off_note', 'admin_off_note', 'shifts_on_replaced', 'shifts_on_confirm_stop_replace', 'admin_nudge_confirm')) rpcs_5,
       (select count(*) from pg_trigger where tgrelid = 'public.shifts'::regclass and tgname in ('shifts_on_replaced', 'shifts_on_confirm_stop_replace')) triggers_2;
