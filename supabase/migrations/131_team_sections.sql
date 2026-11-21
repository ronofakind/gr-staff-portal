-- 131 · Nov 21 2026 · Sections for managers (Ronnie: "assign Canape, Clean or Station … a summary … a note for the station").
-- Managers of an event (manages(): MD / BM shift, manager, co-managers) split their team into sections:
-- Passing · Runner · Station · Clean-up (+ any "other" name). A Station also has a station name; each station can have a note.
-- Staff don't see any of this yet (Ronnie: later). Nothing is sent to anyone.
alter table public.shifts add column if not exists section text;
alter table public.shifts add column if not exists station text;
alter table public.events add column if not exists stations jsonb not null default '[]'::jsonb; -- [{name, note}] in the order added

-- Read: the team (not cancelled / declined) with section + station, and the event's stations.
create or replace function public.mgr_sections(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'stations', (select coalesce(stations, '[]'::jsonb) from events where id = p_event),
    'team', coalesce((select jsonb_agg(jsonb_build_object('shift_id', s.id, 'staff_id', s.staff_id, 'full_name', st.full_name,
        'planned_start', s.planned_start, 'position', s.position_code, 'section', s.section, 'station', s.station)
        order by s.planned_start, st.full_name)
      from shifts s join staff st on st.id = s.staff_id
      where s.event_id = p_event and s.status <> 'declined' and coalesce(s.attendance, '') <> 'cancelled'), '[]'::jsonb));
end $$;

-- Write: put one or more people in a section (null = no section). p_station only for 'Station'.
create or replace function public.mgr_set_section(p_event uuid, p_shifts uuid[], p_section text, p_station text default null)
returns int language plpgsql volatile security definer set search_path = public as
$$ declare n int; sec text := nullif(trim(coalesce(p_section, '')), ''); sta text := nullif(trim(coalesce(p_station, '')), '');
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if sec is not null and length(sec) > 40 then raise exception 'section name too long'; end if;
  if sec is distinct from 'Station' then sta := null; end if;
  update shifts set section = sec, station = sta where event_id = p_event and id = any(coalesce(p_shifts, '{}'));
  get diagnostics n = row_count;
  if sta is not null and not exists (select 1 from events e, jsonb_array_elements(e.stations) x where e.id = p_event and x->>'name' = sta) then
    update events set stations = coalesce(stations, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('name', sta, 'note', '')) where id = p_event;
  end if;
  return n;
end $$;

-- Stations: add / rename / note (p_old = current name, null to add) · delete (people on it go back to no section).
create or replace function public.mgr_station_save(p_event uuid, p_name text, p_note text default '', p_old text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare nm text := nullif(trim(coalesce(p_name, '')), ''); cur jsonb;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if nm is null or length(nm) > 40 then raise exception 'Give the station a name (max 40)'; end if;
  select coalesce(stations, '[]'::jsonb) into cur from events where id = p_event;
  if p_old is null then
    if exists (select 1 from jsonb_array_elements(cur) x where x->>'name' = nm) then raise exception 'There is already a station called %', nm; end if;
    cur := cur || jsonb_build_array(jsonb_build_object('name', nm, 'note', left(coalesce(p_note, ''), 500)));
  else
    if nm <> p_old and exists (select 1 from jsonb_array_elements(cur) x where x->>'name' = nm) then raise exception 'There is already a station called %', nm; end if;
    select coalesce(jsonb_agg(case when x->>'name' = p_old then jsonb_build_object('name', nm, 'note', left(coalesce(p_note, ''), 500)) else x end), '[]'::jsonb) into cur from jsonb_array_elements(cur) x;
    if nm <> p_old then update shifts set station = nm where event_id = p_event and station = p_old; end if;
  end if;
  update events set stations = cur where id = p_event;
  return cur;
end $$;

create or replace function public.mgr_station_delete(p_event uuid, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare cur jsonb;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into cur from events e, jsonb_array_elements(e.stations) x where e.id = p_event and x->>'name' <> p_name;
  update events set stations = cur where id = p_event;
  update shifts set section = null, station = null where event_id = p_event and section = 'Station' and station = p_name;
  return cur;
end $$;

revoke all on function public.mgr_sections(uuid) from public, anon;
revoke all on function public.mgr_set_section(uuid, uuid[], text, text) from public, anon;
revoke all on function public.mgr_station_save(uuid, text, text, text) from public, anon;
revoke all on function public.mgr_station_delete(uuid, text) from public, anon;
grant execute on function public.mgr_sections(uuid) to authenticated;
grant execute on function public.mgr_set_section(uuid, uuid[], text, text) to authenticated;
grant execute on function public.mgr_station_save(uuid, text, text, text) to authenticated;
grant execute on function public.mgr_station_delete(uuid, text) to authenticated;

select 'RESULT ' || (select count(*) from pg_proc where proname in ('mgr_sections', 'mgr_set_section', 'mgr_station_save', 'mgr_station_delete')) || ' fns · '
  || (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'shifts' and column_name in ('section', 'station')) or (table_name = 'events' and column_name = 'stations'))) || ' cols';
