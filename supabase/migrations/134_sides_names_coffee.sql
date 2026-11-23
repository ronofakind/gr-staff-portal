-- 134 · Nov 23 2026 · Sections · Service: side names per event (Ronnie: "sometimes we have window and curtain side")
-- + Coffee as a default at the end, on top of any other role (Ronnie: "managers should be able to appoint anyone to coffee service").
-- Additive only. Nothing already set moves.
alter table public.events add column if not exists svc_side_names jsonb not null default '["Kitchen side","Cocktail side"]'::jsonb;
alter table public.shifts add column if not exists svc_coffee boolean not null default false;

create or replace function public.mgr_sections(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'stations', (select coalesce(stations, '[]'::jsonb) from events where id = p_event),
    'svc_roles', (select coalesce(svc_roles, '[]'::jsonb) from events where id = p_event),
    'svc_sides', (select svc_sides from events where id = p_event),
    'svc_side_names', (select svc_side_names from events where id = p_event),
    'team', coalesce((select jsonb_agg(jsonb_build_object('shift_id', s.id, 'staff_id', s.staff_id, 'full_name', st.full_name,
        'planned_start', s.planned_start, 'position', s.position_code, 'section', s.section, 'station', s.station,
        'runs', coalesce(to_jsonb(s.run_stations), '[]'::jsonb),
        'svc_role', s.svc_role, 'svc_side', s.svc_side, 'svc_lead', s.svc_lead, 'svc_coffee', s.svc_coffee)
        order by s.planned_start, st.full_name)
      from shifts s join staff st on st.id = s.staff_id
      where s.event_id = p_event and s.status <> 'declined' and coalesce(s.attendance, '') <> 'cancelled'), '[]'::jsonb));
end $$;

-- Sides must be one of the event's two side names.
create or replace function public.mgr_set_svc_side(p_event uuid, p_shifts uuid[], p_side text)
returns int language plpgsql volatile security definer set search_path = public as
$$ declare n int; sd text := nullif(trim(coalesce(p_side, '')), '');
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if sd is not null and not exists (select 1 from events e, jsonb_array_elements_text(e.svc_side_names) x where e.id = p_event and x = sd) then
    raise exception 'Unknown side'; end if;
  update shifts set svc_side = sd where event_id = p_event and id = any(coalesce(p_shifts, '{}'));
  get diagnostics n = row_count;
  update shifts m set svc_side = sd from shifts l
    where m.event_id = p_event and m.svc_lead = l.id and l.id = any(coalesce(p_shifts, '{}')) and l.svc_role = 'Wave lead';
  return n;
end $$;

-- Rename the two sides for this event; people already on a side move with the name.
create or replace function public.mgr_side_names_save(p_event uuid, p_a text, p_b text)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare a text := nullif(trim(coalesce(p_a, '')), ''); b text := nullif(trim(coalesce(p_b, '')), ''); cur jsonb;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if a is null or b is null or length(a) > 30 or length(b) > 30 then raise exception 'Give both sides a name (max 30)'; end if;
  if a = b then raise exception 'The two sides need different names'; end if;
  select svc_side_names into cur from events where id = p_event;
  update shifts set svc_side = case when svc_side = cur->>0 then a when svc_side = cur->>1 then b else svc_side end
    where event_id = p_event and svc_side in (cur->>0, cur->>1);
  update events set svc_side_names = jsonb_build_array(a, b) where id = p_event;
  return jsonb_build_array(a, b);
end $$;

-- Coffee: on top of any role / team.
create or replace function public.mgr_set_coffee(p_event uuid, p_shifts uuid[], p_on boolean)
returns int language plpgsql volatile security definer set search_path = public as
$$ declare n int;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  update shifts set svc_coffee = coalesce(p_on, false) where event_id = p_event and id = any(coalesce(p_shifts, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Coffee counts as a default role name (its note is kept like the others; can't be added twice or deleted).
create or replace function public.mgr_svc_role_save(p_event uuid, p_name text, p_note text default '', p_old text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare nm text := nullif(trim(coalesce(p_name, '')), ''); cur jsonb; defaults text[] := array['Wave lead','Allergies','Kitchen','Closer','Bread','Coffee'];
  is_custom boolean;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if nm is null or length(nm) > 40 then raise exception 'Give the role a name (max 40)'; end if;
  select coalesce(svc_roles, '[]'::jsonb) into cur from events where id = p_event;
  if p_old is not null and p_old = any(defaults) then nm := p_old; end if;
  is_custom := not (nm = any(defaults));
  if p_old is null and (nm = any(defaults) or exists (select 1 from jsonb_array_elements(cur) x where x->>'name' = nm)) then
    raise exception 'There is already a role called %', nm; end if;
  if p_old is not null and nm <> p_old and (nm = any(defaults) or exists (select 1 from jsonb_array_elements(cur) x where x->>'name' = nm)) then
    raise exception 'There is already a role called %', nm; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into cur from jsonb_array_elements(cur) x where x->>'name' is distinct from coalesce(p_old, nm);
  cur := cur || jsonb_build_array(jsonb_build_object('name', nm, 'note', left(coalesce(p_note, ''), 500), 'custom', is_custom));
  if p_old is not null and nm <> p_old then update shifts set svc_role = nm where event_id = p_event and svc_role = p_old; end if;
  update events set svc_roles = cur where id = p_event;
  return cur;
end $$;

create or replace function public.mgr_svc_role_delete(p_event uuid, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare cur jsonb;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if p_name = any(array['Wave lead','Allergies','Kitchen','Closer','Bread','Coffee']) then raise exception 'Default roles stay'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into cur from events e, jsonb_array_elements(e.svc_roles) x where e.id = p_event and x->>'name' <> p_name;
  update events set svc_roles = cur where id = p_event;
  update shifts set svc_role = null where event_id = p_event and svc_role = p_name;
  return cur;
end $$;

revoke all on function public.mgr_side_names_save(uuid, text, text) from public, anon;
grant execute on function public.mgr_side_names_save(uuid, text, text) to authenticated;
revoke all on function public.mgr_set_coffee(uuid, uuid[], boolean) from public, anon;
grant execute on function public.mgr_set_coffee(uuid, uuid[], boolean) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_schema = 'public'
    and ((table_name = 'events' and column_name = 'svc_side_names') or (table_name = 'shifts' and column_name = 'svc_coffee'))) || ' cols · '
  || (select count(*) from pg_proc where proname in ('mgr_side_names_save', 'mgr_set_coffee')) || ' new fns · '
  || (select count(*) from shifts where section is not null) || ' cocktail · '
  || (select count(*) from shifts where svc_role is not null or svc_lead is not null) || ' service kept';
