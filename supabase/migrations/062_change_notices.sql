-- 062 · Nov 5 · "When a shift changes" (mapping StaffChangesV1, Ronnie: push).
-- One notice per change, same old → new lines on Home (gold box), in Messages (card from Ronnie) and on the phone:
--   · start / end time / position changed on a confirmed shift (any screen, not only Bookings) → Messages card + phone alert
--   · uniform changed on the event (shirt or pieces) → gold box + Messages card + phone alert  (new: nothing before)
--   · several changes close together (2 min, not Got it yet) → one card, lines merged
--   · Sheet changes "Approve quietly" (gr.quiet) → nothing, as before
-- Reuses: shifts.change_prev / change_seen_at (039), _post_note + card 'shift_changed' (044), phone alert from the note (046/048).

-- ── labels ─────────────────────────────────────────────────────
create or replace function public._uni_label(k text) returns text language sql immutable as $$
  select case when k is null then null
              when k like 'custom:%' then coalesce(nullif(substr(k, 8), ''), 'See notes')
              when k = 'white_shirt' then 'White shirt + tie' when k = 'black_shirt' then 'Black shirt + tie'
              when k = 'dress' then 'Black cocktail dress' when k = 'black_tshirt' then 'Black T-shirt' else k end $$;

-- What this person wears on this event row (same rule as uniformFor() in the app).
create or replace function public._uni_kind(e events, p_code text, p_detail text, p_sex text, p_override text) returns text language sql stable as $$
  select coalesce(p_override,
    case when coalesce(p_code, '') in ('BM', 'BT', 'BB') or coalesce(p_detail, '') ~* '^bar\M'
         then coalesce(case when p_sex = 'f' then e.uniform_bar_w end, e.uniform_bar, 'black_shirt')
         else coalesce(case when p_sex = 'f' then e.uniform_floor_w end, e.uniform_floor, 'white_shirt') end) $$;

-- ── one card per change, merged ────────────────────────────────
create or replace function public._change_note(p_shift uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; ev events%rowtype; vname text; m messages%rowtype; merged jsonb; l jsonb; b text; nid uuid; begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then return null; end if;
  select * into s from shifts where id = p_shift; if not found or s.staff_id is null then return null; end if;
  select * into ev from events where id = s.event_id;
  select name into vname from venues where id = ev.venue_id;
  select x.* into m from messages x join conversations c on c.id = x.conversation_id
   where c.staff_id = s.staff_id and c.kind = 'ronnie' and x.kind = 'system' and x.meta->>'card' = 'shift_changed'
     and x.meta->>'shift_id' = p_shift::text and not (x.meta ? 'got_it_at') and x.created_at > now() - interval '2 minutes'
   order by x.created_at desc limit 1;
  merged := coalesce(m.meta->'lines', '[]'::jsonb);
  for l in select * from jsonb_array_elements(p_lines) loop
    merged := coalesce((select jsonb_agg(x) from jsonb_array_elements(merged) x where x->>'label' <> l->>'label'), '[]'::jsonb) || jsonb_build_array(l);
  end loop;
  b := '🗓 Your shift changed · ' || _mtl_day(ev.event_date) || ' · ' || coalesce(vname, ev.title) || ' · '
          || (select string_agg((x->>'label') || ' ' || coalesce(x->>'old', '') || ' → ' || coalesce(x->>'new', ''), ' · ') from jsonb_array_elements(merged) x);
  if m.id is not null then
    update messages set body = b, meta = meta || jsonb_build_object('lines', merged) where messages.id = m.id;
    return m.id;
  end if;
  nid := _post_note(s.staff_id, b, jsonb_build_object('card', 'shift_changed', 'shift_id', s.id, 'date', ev.event_date, 'venue', coalesce(vname, ev.title), 'lines', merged), s.id);
  return nid;
end $$;
revoke execute on function public._change_note(uuid, jsonb) from public, anon, authenticated;

-- ── shifts: also track the end time (039/058 + planned_end) ────
create or replace function public.shift_track_change() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if coalesce(current_setting('gr.quiet', true), '') = 'on' then return new; end if; -- 058 · approved quietly: no gold box
  if old.status = 'confirmed' and new.status = 'confirmed' and new.attendance is null
     and (new.planned_start is distinct from old.planned_start or new.event_id is distinct from old.event_id
          or new.planned_end is distinct from old.planned_end
          or coalesce(nullif(new.position_detail, ''), new.position_code) is distinct from coalesce(nullif(old.position_detail, ''), old.position_code)) then
    if new.change_prev is null or new.change_seen_at is not null then
      new.change_prev := (select jsonb_build_object('start', old.planned_start, 'end', old.planned_end, 'position', coalesce(nullif(old.position_detail, ''), old.position_code),
                                 'place', coalesce(v.name, e.title), 'address', coalesce(e.address, v.address))
                            from events e left join venues v on v.id = e.venue_id where e.id = old.event_id);
    elsif not (new.change_prev ? 'end') then
      new.change_prev := new.change_prev || jsonb_build_object('end', old.planned_end);
    end if;
    new.change_seen_at := null;
    new.changed_after_confirm_at := now();
  end if;
  return new;
end $$;

-- After a tracked change on the shift itself: the Messages card (+ phone alert from the card).
create or replace function public.shift_change_note() returns trigger
language plpgsql security definer set search_path = public as
$$ declare ln jsonb := '[]'; op text; np text; begin
  if coalesce(current_setting('gr.quiet', true), '') = 'on' then return null; end if;
  if new.changed_after_confirm_at is not distinct from old.changed_after_confirm_at then return null; end if;
  if new.event_id is distinct from old.event_id then return null; end if; -- a move: Bookings posts its own card (merged below)
  if new.planned_start is distinct from old.planned_start and not coalesce(new.time_tbc, false) then
    ln := ln || jsonb_build_array(jsonb_build_object('label', 'Start', 'old', _mtl_time(old.planned_start), 'new', _mtl_time(new.planned_start))); end if;
  if new.planned_end is distinct from old.planned_end and new.planned_end is not null then
    ln := ln || jsonb_build_array(jsonb_build_object('label', 'End', 'old', coalesce(_mtl_time(old.planned_end), '—'), 'new', _mtl_time(new.planned_end))); end if;
  op := coalesce(nullif(old.position_detail, ''), old.position_code); np := coalesce(nullif(new.position_detail, ''), new.position_code);
  if op is distinct from np then ln := ln || jsonb_build_array(jsonb_build_object('label', 'Position', 'old', op, 'new', np)); end if;
  perform _change_note(new.id, ln);
  return null;
end $$;
drop trigger if exists shifts_change_note on public.shifts;
create trigger shifts_change_note after update on public.shifts for each row execute function public.shift_change_note();

-- ── events: uniform changes (new) ──────────────────────────────
create or replace function public.event_track_uniform() returns trigger
language plpgsql security definer set search_path = public as
$$ declare r record; ok text; nk text; okey text; ol text; nl text; begin
  if coalesce(current_setting('gr.quiet', true), '') = 'on' then return null; end if;
  if (old.uniform_floor, old.uniform_floor_w, old.uniform_bar, old.uniform_bar_w, old.uniform_items)
     is not distinct from (new.uniform_floor, new.uniform_floor_w, new.uniform_bar, new.uniform_bar_w, new.uniform_items) then return null; end if;
  for r in select s.id, s.position_code, s.position_detail, s.uniform, st.sex, s.change_prev, s.change_seen_at
             from shifts s left join staff st on st.id = s.staff_id
            where s.event_id = new.id and s.status = 'confirmed' and s.attendance is null and s.uniform is null loop
    ok := _uni_kind(old, r.position_code, r.position_detail, r.sex, null);
    nk := _uni_kind(new, r.position_code, r.position_detail, r.sex, null);
    okey := (case when coalesce(r.position_code, '') in ('BM', 'BT', 'BB') or coalesce(r.position_detail, '') ~* '^bar\M' then 'bar' else 'floor' end)
            || '_' || case when r.sex = 'f' then 'w' else 'm' end;
    if ok is distinct from nk then ol := _uni_label(ok); nl := _uni_label(nk);
    elsif (old.uniform_items->okey) is distinct from (new.uniform_items->okey) then ol := _uni_label(ok); nl := _uni_label(nk) || ' · pieces changed';
    else continue; end if;
    update shifts set
      change_prev = case when r.change_prev is null or r.change_seen_at is not null
                         then jsonb_build_object('start', planned_start, 'end', planned_end, 'position', coalesce(nullif(position_detail, ''), position_code), 'uniform', ol, 'uniform_new', nl)
                         else r.change_prev || jsonb_build_object('uniform', coalesce(r.change_prev->>'uniform', ol), 'uniform_new', nl) end,
      change_seen_at = null, changed_after_confirm_at = now()
     where id = r.id;
    perform _change_note(r.id, jsonb_build_array(jsonb_build_object('label', 'Uniform', 'old', ol, 'new', nl)));
  end loop;
  return null;
end $$;
drop trigger if exists events_track_uniform on public.events;
create trigger events_track_uniform after update on public.events for each row execute function public.event_track_uniform();

-- ── Bookings / asks card: merge into a card the trigger just posted (no double card, no double alert) ──
create or replace function public.admin_shift_note(p_staff uuid, p_kind text, p_shift uuid, p_alert uuid, p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public as
$$ declare card text; body text; m jsonb := coalesce(p_meta, '{}'); prior uuid; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_kind not in ('changed', 'new', 'removed') then raise exception 'bad kind'; end if;
  if p_kind = 'changed' and p_shift is not null then
    select x.id into prior from messages x join conversations c on c.id = x.conversation_id
     where c.staff_id = p_staff and x.kind = 'system' and x.meta->>'card' = 'shift_changed' and x.meta->>'shift_id' = p_shift::text
       and not (x.meta ? 'got_it_at') and x.created_at > now() - interval '2 minutes' order by x.created_at desc limit 1;
    if prior is not null then
      perform _change_note(p_shift, coalesce(m->'lines', '[]'::jsonb));
      update messages set meta = meta || jsonb_strip_nulls(jsonb_build_object('alert_id', p_alert, 'venue', m->>'venue', 'date', m->>'date')) where id = prior;
      return prior;
    end if;
  end if;
  card := case p_kind when 'changed' then 'shift_changed' when 'new' then 'new_shift' else 'shift_removed' end;
  body := case p_kind when 'changed' then '🗓 Your shift changed · ' when 'new' then '🗓 New shift · ' else '🗓 Shift removed · ' end
          || coalesce(_mtl_day((m->>'date')::date), '') || coalesce(' · ' || (m->>'venue'), '')
          || case p_kind when 'changed' then coalesce(' · ' || (select string_agg((l->>'label') || ' ' || coalesce(l->>'old', '') || ' → ' || coalesce(l->>'new', ''), ' · ')
                                                           from jsonb_array_elements(coalesce(m->'lines', '[]'::jsonb)) l), '')
                         when 'new' then '. Confirm in My dates.' else '. You''re no longer on this event. Questions? Reply here.' end;
  return _post_note(p_staff, body, m || jsonb_build_object('card', card, 'shift_id', p_shift, 'alert_id', p_alert), case when p_kind = 'removed' then null else p_shift end);
end $$;
grant execute on function public.admin_shift_note(uuid, text, uuid, uuid, jsonb) to authenticated;

-- ── phone alert title: say what changed (start / uniform) ──────
do $$ declare src text; begin
  src := pg_get_functiondef('public.alerts_on_message()'::regprocedure);
  if position('👔 Uniform changed' in src) = 0 then
    src := replace(src, $q$else case when st is not null then '⏰ Your start changed → ' || st else '⏰ Your shift changed' end end;$q$,
      $q$else case when st is not null then '⏰ Your start changed → ' || st
                    when exists (select 1 from jsonb_array_elements(lines) l where l->>'label' = 'Uniform') and jsonb_array_length(lines) = 1 then '👔 Uniform changed · ' || coalesce(_mtl_day(d), '')
                    else '⏰ Your shift changed · ' || coalesce(_mtl_day(d), '') end end;$q$);
    execute src;
  end if;
end $$;

-- Check
select (select count(*) from pg_trigger where tgname in ('shifts_change_note', 'events_track_uniform')) as triggers,
       (select prosrc like '%Uniform changed%' from pg_proc where proname = 'alerts_on_message') as alert_title;
