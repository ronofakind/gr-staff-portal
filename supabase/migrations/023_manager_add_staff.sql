-- Manager adds staff on the night (Oct 30): search all active staff, add to the event, move from another event that day.
alter table public.shifts add column if not exists added_by uuid;
alter table public.shifts add column if not exists added_note text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'shifts_added_by_fkey') then
    alter table public.shifts add constraint shifts_added_by_fkey foreign key (added_by) references public.staff(id) on delete set null;
  end if;
end $$;

-- Notices shown on a manager's team list (e.g. "Anaïs moved to Maison Principale by Benjamin")
create table if not exists public.event_notices (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  body text not null,
  by_staff uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.event_notices enable row level security;
drop policy if exists read_mgr on public.event_notices;
create policy read_mgr on public.event_notices for select using (is_admin() or manages(event_id));

-- Everyone active, with where they are booked that day (other events only)
create or replace function public.manager_staff_search(p_event uuid)
returns table(id uuid, full_name text, nickname text, department text, positions text[], here boolean,
              elsewhere_title text, elsewhere_start timestamptz, elsewhere_manager text, elsewhere_shift uuid, elsewhere_started boolean)
language plpgsql stable security definer set search_path = public as
$$ declare d date; t text; begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select event_date, title into d, t from events where events.id = p_event;
  return query
    select st.id, st.full_name, st.nickname, st.department, st.positions,
           exists (select 1 from shifts s where s.event_id = p_event and s.staff_id = st.id and s.status <> 'declined'),
           o.title, o.planned_start, o.mgr, o.sid, o.started
      from staff st
      left join lateral (
        select e.title, s.planned_start, m.full_name as mgr, s.id as sid, (p.punch_in is not null) as started
          from shifts s join events e on e.id = s.event_id left join staff m on m.id = e.manager_id left join punches p on p.shift_id = s.id
         where s.staff_id = st.id and e.event_date = d and e.id <> p_event and e.title <> t
           and s.status <> 'declined' and s.attendance is null and (p.punch_out is null or p.punch_out > now())
         order by s.planned_start limit 1) o on true
     where st.active
     order by st.full_name;
end $$;
grant execute on function public.manager_staff_search(uuid) to authenticated;

-- Add someone to the event; optionally move them off another event that day
create or replace function public.manager_add_staff(p_event uuid, p_staff uuid, p_code text, p_detail text, p_start timestamptz,
                                                    p_started boolean, p_note text, p_move_shift uuid)
returns uuid language plpgsql security definer set search_path = public as
$$ declare new_id uuid; d date; t text; old_ev uuid; old_title text; pin timestamptz; pout timestamptz; who text; nm text; begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select event_date, title into d, t from events where id = p_event;
  if exists (select 1 from shifts where event_id = p_event and staff_id = p_staff and status <> 'declined') then
    raise exception 'Already on this event';
  end if;
  select full_name into nm from staff where id = p_staff;
  select split_part(full_name, ' ', 1) into who from staff where id = me();
  if p_move_shift is not null then
    select s.event_id, e.title, p.punch_in, p.punch_out into old_ev, old_title, pin, pout
      from shifts s join events e on e.id = s.event_id left join punches p on p.shift_id = s.id
     where s.id = p_move_shift and s.staff_id = p_staff and e.event_date = d;
    if old_ev is null then raise exception 'That booking was not found'; end if;
    if pin is not null and pin < p_start then
      -- already working there: their time there ends at the switch, both parts are paid
      update punches set punch_out = least(coalesce(punch_out, p_start), p_start), edited_by = me(), updated_at = now() where shift_id = p_move_shift;
      update shifts set manager_note = trim(both ' ' from coalesce(manager_note, '') || ' Moved to ' || t || ' at ' || to_char(p_start at time zone 'America/Toronto', 'HH12:MI AM') || '.') where id = p_move_shift;
    else
      delete from shifts where id = p_move_shift;
    end if;
    insert into event_notices(event_id, body, by_staff)
    values (old_ev, nm || ' moved to ' || t || ' by ' || coalesce(who, 'a manager') || ' · off your list', me());
    insert into change_log(by_staff, entity, entity_id, change)
    values (me(), 'shift', p_move_shift, jsonb_build_object('kind', 'moved', 'staff_id', p_staff, 'from', old_title, 'to', t));
  end if;
  insert into shifts(event_id, staff_id, position_code, position_detail, planned_start, status, added_by, added_note, arrive_before_min)
  values (p_event, p_staff, p_code, p_detail, p_start, 'confirmed', me(), nullif(trim(p_note), ''), 0)
  returning id into new_id;
  if p_started then perform manager_set_punch(new_id, p_start, null, now()); end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'shift', new_id, jsonb_build_object('kind', 'booked', 'staff_id', p_staff, 'added_on_the_night', true, 'note', p_note));
  return new_id;
end $$;
grant execute on function public.manager_add_staff(uuid, uuid, text, text, timestamptz, boolean, text, uuid) to authenticated;
