-- 074 · Archive / delete a venue · move its events to the right one (Nov 6, 2026)
-- For duplicates (same place, two names). Archive = hidden from the list and the venue picker, events keep it.
-- admin_venue_remove(venue, move_to): moves every event to move_to (title too when it was the old name), copies the
-- pin / photos / notes the right venue is missing, then deletes the old one. Staff only get "Your shift changed"
-- when the address really changes (same address = quiet). Without move_to it only deletes a venue no event uses.
-- Safe to run twice.
alter table public.venues add column if not exists archived_at timestamptz;

-- same as 044 + the quiet flag
create or replace function public.event_track_place() returns trigger
language plpgsql security definer set search_path = public as
$$ declare oplace text; oaddr text; nplace text; naddr text; r record;
begin
  if coalesce(current_setting('gr.quiet', true), '') = 'on' then return null; end if; -- 074 · venue merge with the same address
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

create or replace function public.admin_venue_remove(p_venue uuid, p_move_to uuid default null)
returns int language plpgsql security definer set search_path = public as
$$ declare o venues%rowtype; t venues%rowtype; n int := 0; m int := 0; norm text; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select * into o from venues where id = p_venue; if not found then raise exception 'Venue not found.'; end if;
  if p_move_to is not null then
    if p_move_to = p_venue then raise exception 'Pick a different venue.'; end if;
    select * into t from venues where id = p_move_to; if not found then raise exception 'Venue to move to not found.'; end if;
    norm := lower(regexp_replace(coalesce(t.address, ''), '[^a-z0-9]', '', 'gi'));
    -- quiet: past events, and events whose address stays the same
    perform set_config('gr.quiet', 'on', true);
    update events e set venue_id = t.id, title = case when lower(trim(e.title)) = lower(trim(o.name)) then t.name else e.title end
     where e.venue_id = o.id and (e.event_date < (now() at time zone 'America/Toronto')::date or e.address is not null
            or lower(regexp_replace(coalesce(o.address, ''), '[^a-z0-9]', '', 'gi')) = norm);
    get diagnostics n = row_count;
    perform set_config('gr.quiet', 'off', true);
    update events e set venue_id = t.id, title = case when lower(trim(e.title)) = lower(trim(o.name)) then t.name else e.title end
     where e.venue_id = o.id;
    get diagnostics m = row_count;
    update venues set pin_lat = coalesce(pin_lat, o.pin_lat), pin_lng = case when pin_lat is null then o.pin_lng else pin_lng end,
           pin_label = coalesce(nullif(pin_label, ''), o.pin_label), address = coalesce(address, o.address),
           staff_notes = coalesce(nullif(staff_notes, ''), o.staff_notes), venue_notes = coalesce(nullif(venue_notes, ''), o.venue_notes),
           photos = case when jsonb_array_length(coalesce(photos, '[]')) = 0 then coalesce(o.photos, '[]') else photos end,
           usual_client_id = coalesce(usual_client_id, o.usual_client_id)
     where id = t.id;
  end if;
  if exists (select 1 from events where venue_id = o.id) then raise exception 'This venue still has events. Move them first or archive it.'; end if;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'venue', o.id, jsonb_build_object('deleted', o.name, 'moved_to', t.name, 'events', n + m));
  delete from venues where id = o.id;
  return n + m;
end $$;
grant execute on function public.admin_venue_remove(uuid, uuid) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'venues' and column_name = 'archived_at') || ' col · '
    || (select count(*) from pg_proc where proname = 'admin_venue_remove') || ' fn' as result;
