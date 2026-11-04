-- 058 · Push 52 · Sheet changes v2: "Approve quietly" (Ronnie, Nov 4 10:50 AM).
-- File only: apply by hand in the SQL editor. Safe to run twice (create or replace only). Nothing is dropped.
--
-- What sends something to staff when a Sheet change is approved:
--   · bookingChange() (src/admin/api.ts): staff_alerts row (→ Home card + alerts_on_staff_alert → alert_queue push / text_outbox)
--     and admin_shift_note (→ note in their conversation + alerts_on_message). Quiet = the app skips both (no SQL needed).
--   · shift_track_change (039): moving / re-timing a CONFIRMED shift fills change_prev → the gold "Your shift changed" box on
--     their Home. That one is a trigger, so the app can't skip it from the browser → this migration.
--   · Inserts / deletes from Sheet changes fire nothing for staff (alerts_on_confirm needs confirm_sent_at, which needs
--     notified_at; shifts_on_replaced needs replacement_for). Not touched.
--
-- Design: a transaction-local flag gr.quiet = 'on', set only inside admin_sheet_quiet_update() below, and checked by
-- shift_track_change. Every other write anywhere in the app behaves exactly as before.

-- Same function as 039, plus the quiet check at the top.
create or replace function public.shift_track_change() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if coalesce(current_setting('gr.quiet', true), '') = 'on' then return new; end if; -- 058 · approved quietly: no gold box
  if old.status = 'confirmed' and new.status = 'confirmed' and new.attendance is null
     and (new.planned_start is distinct from old.planned_start or new.event_id is distinct from old.event_id
          or coalesce(nullif(new.position_detail, ''), new.position_code) is distinct from coalesce(nullif(old.position_detail, ''), old.position_code)) then
    if new.change_prev is null or new.change_seen_at is not null then
      new.change_prev := (select jsonb_build_object('start', old.planned_start, 'position', coalesce(nullif(old.position_detail, ''), old.position_code),
                                 'place', coalesce(v.name, e.title), 'address', coalesce(e.address, v.address))
                            from events e left join venues v on v.id = e.venue_id where e.id = old.event_id);
    end if;
    new.change_seen_at := null;
    new.changed_after_confirm_at := now();
  end if;
  return new;
end $$;

-- Admin only: update one shift (move / new start / position) with the quiet flag on, in one transaction.
-- p_patch keys (all optional): event_id, position_code, position_detail, planned_start, planned_end (null clears it), status.
create or replace function public.admin_sheet_quiet_update(p_shift uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as
$$ declare p jsonb := coalesce(p_patch, '{}'); begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p ? 'status' and p->>'status' not in ('booked', 'confirmed') then raise exception 'bad status'; end if;
  perform set_config('gr.quiet', 'on', true);
  update shifts set
    event_id        = case when p ? 'event_id' then (p->>'event_id')::uuid else event_id end,
    position_code   = case when p ? 'position_code' then p->>'position_code' else position_code end,
    position_detail = case when p ? 'position_detail' then p->>'position_detail' else position_detail end,
    planned_start   = case when p ? 'planned_start' then (p->>'planned_start')::timestamptz else planned_start end,
    planned_end     = case when p ? 'planned_end' then (p->>'planned_end')::timestamptz else planned_end end,
    status          = case when p ? 'status' then p->>'status' else status end
   where id = p_shift;
  if not found then raise exception 'That booking no longer exists.'; end if;
  perform set_config('gr.quiet', 'off', true);
end $$;
revoke all on function public.admin_sheet_quiet_update(uuid, jsonb) from public;
grant execute on function public.admin_sheet_quiet_update(uuid, jsonb) to authenticated;

-- Check: both functions exist and the trigger function has the quiet check.
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'admin_sheet_quiet_update') as quiet_rpc,
       (select prosrc like '%gr.quiet%' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'shift_track_change') as track_change_quiet,
       (select count(*) from pg_trigger where tgname = 'shifts_track_change' and not tgisinternal) as track_change_trigger;
