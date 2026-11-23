-- 133 · Nov 23 2026 · Sections: a second tab "Service" (Ronnie: wave lead, allergies, kitchen, closer, bread + add more roles;
-- optional sides Kitchen side / Cocktail side; wave leads pick their team; a role person can also be on a wave lead's team).
-- Additive only: new columns. Cocktail sections (131/132) are not touched.
alter table public.shifts add column if not exists svc_role text;   -- Wave lead · Allergies · Kitchen · Closer · Bread · any added role
alter table public.shifts add column if not exists svc_side text;   -- 'Kitchen side' | 'Cocktail side' | null
alter table public.shifts add column if not exists svc_lead uuid;   -- shift id of the wave lead whose team they are on
alter table public.events add column if not exists svc_roles jsonb not null default '[]'::jsonb; -- [{name, note, custom}] added roles + notes
alter table public.events add column if not exists svc_sides boolean not null default false;

-- Read: 131/132 output + service fields.
create or replace function public.mgr_sections(p_event uuid)
returns jsonb language plpgsql stable security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'stations', (select coalesce(stations, '[]'::jsonb) from events where id = p_event),
    'svc_roles', (select coalesce(svc_roles, '[]'::jsonb) from events where id = p_event),
    'svc_sides', (select svc_sides from events where id = p_event),
    'team', coalesce((select jsonb_agg(jsonb_build_object('shift_id', s.id, 'staff_id', s.staff_id, 'full_name', st.full_name,
        'planned_start', s.planned_start, 'position', s.position_code, 'section', s.section, 'station', s.station,
        'runs', coalesce(to_jsonb(s.run_stations), '[]'::jsonb),
        'svc_role', s.svc_role, 'svc_side', s.svc_side, 'svc_lead', s.svc_lead)
        order by s.planned_start, st.full_name)
      from shifts s join staff st on st.id = s.staff_id
      where s.event_id = p_event and s.status <> 'declined' and coalesce(s.attendance, '') <> 'cancelled'), '[]'::jsonb));
end $$;

-- Role for one or more people (null = no role). Someone who stops being a wave lead: his team goes back to "not on a team".
create or replace function public.mgr_set_svc_role(p_event uuid, p_shifts uuid[], p_role text)
returns int language plpgsql volatile security definer set search_path = public as
$$ declare n int; r text := nullif(trim(coalesce(p_role, '')), '');
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if r is not null and length(r) > 40 then raise exception 'Role name too long'; end if;
  update shifts set svc_lead = null where event_id = p_event and svc_lead = any(coalesce(p_shifts, '{}'))
    and r is distinct from 'Wave lead';
  update shifts set svc_role = r, svc_lead = case when r = 'Wave lead' then null else svc_lead end
    where event_id = p_event and id = any(coalesce(p_shifts, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Side for one or more people. A wave lead's team follows him.
create or replace function public.mgr_set_svc_side(p_event uuid, p_shifts uuid[], p_side text)
returns int language plpgsql volatile security definer set search_path = public as
$$ declare n int; sd text := nullif(trim(coalesce(p_side, '')), '');
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if sd is not null and sd not in ('Kitchen side', 'Cocktail side') then raise exception 'Unknown side'; end if;
  update shifts set svc_side = sd where event_id = p_event and id = any(coalesce(p_shifts, '{}'));
  get diagnostics n = row_count;
  update shifts m set svc_side = sd from shifts l
    where m.event_id = p_event and m.svc_lead = l.id and l.id = any(coalesce(p_shifts, '{}')) and l.svc_role = 'Wave lead';
  return n;
end $$;

-- A wave lead's team = exactly p_members (others who were on it go back to "not on a team"). Ticking someone from another team moves him.
create or replace function public.mgr_set_team(p_event uuid, p_lead uuid, p_members uuid[])
returns int language plpgsql volatile security definer set search_path = public as
$$ declare n int; lside text;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select svc_side into lside from shifts where id = p_lead and event_id = p_event and svc_role = 'Wave lead';
  if not found then raise exception 'Pick a wave lead first'; end if;
  update shifts set svc_lead = null where event_id = p_event and svc_lead = p_lead and not (id = any(coalesce(p_members, '{}')));
  update shifts set svc_lead = p_lead, svc_side = coalesce(lside, svc_side)
    where event_id = p_event and id = any(coalesce(p_members, '{}')) and id <> p_lead and coalesce(svc_role, '') <> 'Wave lead';
  get diagnostics n = row_count;
  return n;
end $$;

-- One person on / off a team (from the name sheet). p_lead null = not on a team.
create or replace function public.mgr_set_lead(p_event uuid, p_shift uuid, p_lead uuid)
returns void language plpgsql volatile security definer set search_path = public as
$$ declare lside text;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if p_lead is not null then
    select svc_side into lside from shifts where id = p_lead and event_id = p_event and svc_role = 'Wave lead';
    if not found then raise exception 'Pick a wave lead first'; end if;
  end if;
  update shifts set svc_lead = p_lead, svc_side = coalesce(lside, svc_side)
    where id = p_shift and event_id = p_event and coalesce(svc_role, '') <> 'Wave lead';
end $$;

create or replace function public.mgr_set_sides(p_event uuid, p_on boolean)
returns void language plpgsql volatile security definer set search_path = public as
$$ begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  update events set svc_sides = coalesce(p_on, false) where id = p_event;
end $$;

-- Roles: add (p_old null) / rename + note (p_old = current name). Default roles keep their name; only the note changes.
create or replace function public.mgr_svc_role_save(p_event uuid, p_name text, p_note text default '', p_old text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare nm text := nullif(trim(coalesce(p_name, '')), ''); cur jsonb; defaults text[] := array['Wave lead','Allergies','Kitchen','Closer','Bread'];
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

-- Delete an added role (people on it keep their team, lose the role). Default roles can't be deleted.
create or replace function public.mgr_svc_role_delete(p_event uuid, p_name text)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare cur jsonb;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if p_name = any(array['Wave lead','Allergies','Kitchen','Closer','Bread']) then raise exception 'Default roles stay'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into cur from events e, jsonb_array_elements(e.svc_roles) x where e.id = p_event and x->>'name' <> p_name;
  update events set svc_roles = cur where id = p_event;
  update shifts set svc_role = null where event_id = p_event and svc_role = p_name;
  return cur;
end $$;

do $$ declare f text; begin
  foreach f in array array['mgr_set_svc_role(uuid, uuid[], text)', 'mgr_set_svc_side(uuid, uuid[], text)', 'mgr_set_team(uuid, uuid, uuid[])',
    'mgr_set_lead(uuid, uuid, uuid)', 'mgr_set_sides(uuid, boolean)', 'mgr_svc_role_save(uuid, text, text, text)', 'mgr_svc_role_delete(uuid, text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

select 'RESULT ' || (select count(*) from information_schema.columns where table_schema = 'public'
    and ((table_name = 'shifts' and column_name in ('svc_role', 'svc_side', 'svc_lead')) or (table_name = 'events' and column_name in ('svc_roles', 'svc_sides')))) || ' cols · '
  || (select count(*) from pg_proc where proname in ('mgr_set_svc_role', 'mgr_set_svc_side', 'mgr_set_team', 'mgr_set_lead', 'mgr_set_sides', 'mgr_svc_role_save', 'mgr_svc_role_delete')) || ' fns · '
  || (select count(*) from shifts where section is not null) || ' cocktail sections kept';
