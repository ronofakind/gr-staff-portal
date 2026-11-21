-- 132 · Nov 21 2026 · Runners run for stations (Ronnie: "assign the station that runner is running" · more than one · only the event's stations).
-- Additive only: one new column. Existing sections / stations / notes are not touched (CDS Nov 21 already in use).
alter table public.shifts add column if not exists run_stations text[];

create or replace function public.mgr_sections(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'stations', (select coalesce(stations, '[]'::jsonb) from events where id = p_event),
    'team', coalesce((select jsonb_agg(jsonb_build_object('shift_id', s.id, 'staff_id', s.staff_id, 'full_name', st.full_name,
        'planned_start', s.planned_start, 'position', s.position_code, 'section', s.section, 'station', s.station,
        'runs', coalesce(to_jsonb(s.run_stations), '[]'::jsonb))
        order by s.planned_start, st.full_name)
      from shifts s join staff st on st.id = s.staff_id
      where s.event_id = p_event and s.status <> 'declined' and coalesce(s.attendance, '') <> 'cancelled'), '[]'::jsonb));
end $$;

-- Same call as 131 plus p_runs (Runner only): null = leave as is, [] = no station, [..] = only names that are stations of this event.
drop function if exists public.mgr_set_section(uuid, uuid[], text, text);
create or replace function public.mgr_set_section(p_event uuid, p_shifts uuid[], p_section text, p_station text default null, p_runs text[] default null)
returns int language plpgsql volatile security definer set search_path = public as
$$ declare n int; sec text := nullif(trim(coalesce(p_section, '')), ''); sta text := nullif(trim(coalesce(p_station, '')), ''); runs text[];
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if sec is not null and length(sec) > 40 then raise exception 'section name too long'; end if;
  if sec is distinct from 'Station' then sta := null; end if;
  if p_runs is not null then
    select coalesce(array_agg(r order by r), '{}') into runs from (select distinct r from unnest(p_runs) r
      where exists (select 1 from events e, jsonb_array_elements(e.stations) x where e.id = p_event and x->>'name' = r)) q;
  end if;
  update shifts set section = sec, station = sta,
    run_stations = case when sec is distinct from 'Runner' then null when p_runs is null then run_stations else nullif(runs, '{}') end
  where event_id = p_event and id = any(coalesce(p_shifts, '{}'));
  get diagnostics n = row_count;
  if sta is not null and not exists (select 1 from events e, jsonb_array_elements(e.stations) x where e.id = p_event and x->>'name' = sta) then
    update events set stations = coalesce(stations, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('name', sta, 'note', '')) where id = p_event;
  end if;
  return n;
end $$;

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
    if nm <> p_old then
      update shifts set station = nm where event_id = p_event and station = p_old;
      update shifts set run_stations = array_replace(run_stations, p_old, nm) where event_id = p_event and p_old = any(run_stations);
    end if;
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
  update shifts set run_stations = nullif(array_remove(run_stations, p_name), '{}') where event_id = p_event and p_name = any(run_stations);
  return cur;
end $$;

revoke all on function public.mgr_set_section(uuid, uuid[], text, text, text[]) from public, anon;
grant execute on function public.mgr_set_section(uuid, uuid[], text, text, text[]) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'shifts' and column_name = 'run_stations') || ' col · '
  || (select count(*) from pg_proc where proname = 'mgr_set_section') || ' set fn · '
  || (select count(*) from shifts where event_id = 'b7abc33f-2a07-4803-9c70-26c4e6326d32' and section is not null) || ' CDS in a section';
