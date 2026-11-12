-- 125 · Day sheet: choose how one person is told about a change (Nov 12, 2026 · push 115). Safe to run twice.
-- Ronnie: when I change someone who already confirmed / was sent → 1 send now with alert · 2 send now, no alert ·
-- 3 add to About to send (default, = before) · 4 don't tell them (I told them myself). 1 / 2 send ALL their waiting changes
-- for those events together. 4 = marked sent (silent) + seen, so it never shows as unseen on Today.
create or replace function public.admin_send_staff_changes(p_staff uuid, p_events uuid[], p_mode text)
returns jsonb language plpgsql security definer set search_path = public as
$$ declare r change_outbox%rowtype; lvl text; b uuid := gen_random_uuid(); mid uuid; card text; al uuid; n int := 0; buzzed boolean := false; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_mode not in ('buzz', 'soft', 'skip') then raise exception 'mode: buzz, soft or skip'; end if;
  if p_mode = 'skip' then
    update shifts s set change_seen_at = now() from change_outbox o
     where o.shift_id = s.id and o.staff_id = p_staff and o.sent_at is null and (p_events is null or o.event_id = any(p_events));
    update change_outbox o set sent_at = now(), level = 'silent', batch_id = b, sent_by = me(), seen_at = now()
     where o.staff_id = p_staff and o.sent_at is null and (p_events is null or o.event_id = any(p_events));
    get diagnostics n = row_count;
    return jsonb_build_object('skipped', n);
  end if;
  for r in select * from change_outbox o where o.sent_at is null and o.staff_id = p_staff and (p_events is null or o.event_id = any(p_events))
            order by (o.kind = 'changed'), coalesce((o.meta->>'date')::date, current_date), o.created_at loop
    lvl := case when p_mode = 'buzz' and not buzzed then 'buzz' else 'soft' end;  -- one buzz per person
    card := case r.kind when 'new' then 'new_shift' when 'removed' then 'shift_removed' else 'shift_changed' end; al := null;
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
    if lvl = 'buzz' then buzzed := true; end if;
    update change_outbox set sent_at = now(), level = lvl, batch_id = b, message_id = mid, sent_by = me() where id = r.id;
    if r.kind = 'changed' and r.shift_id is not null then update shifts set change_sent_at = now() where id = r.shift_id; end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('sent', n, 'buzz', buzzed);
end $$;
revoke all on function public.admin_send_staff_changes(uuid, uuid[], text) from public, anon;
grant execute on function public.admin_send_staff_changes(uuid, uuid[], text) to authenticated;

select 'RESULT ' || (select count(*) from pg_proc where proname = 'admin_send_staff_changes') || ' fn';
