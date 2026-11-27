-- 146 · Floor staff with the bar (Nov 27).
-- Same venue + date, one floor event and one bar event. Floor staff booked on the bar list are a
-- count for scheduling; on site the floor manager or the bar manager switches who actually goes.
-- A switch swaps the two shifts between the events: times, clocks and hours move with them.
alter table public.shifts add column if not exists switched_at timestamptz, add column if not exists switched_by uuid;

create or replace function public._team_sister(p_event uuid) returns uuid language sql stable security definer set search_path = public as $$
  select s.id from events e join events s on s.event_date = e.event_date and s.id <> e.id
    and coalesce(s.department, '') <> coalesce(e.department, '') and 'bar' in (s.department, e.department)
    and ((e.venue_id is not null and s.venue_id = e.venue_id) or (e.venue_id is null and lower(trim(s.title)) = lower(trim(e.title))))
  where e.id = p_event order by s.start_time limit 1;
$$;

create or replace function public._is_floor_pos(p_code text, p_detail text) returns boolean language sql immutable as $$
  select coalesce(p_code, '') not in ('BM', 'BB', 'BT', 'MD') and coalesce(p_detail, '') !~* '^bar\y|bartend|barback|barmaid';
$$;

create or replace function public.team_link(p_event uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sis uuid; bar_ev uuid; floor_ev uuid; mgr text;
begin
  sis := _team_sister(p_event);
  if sis is null then return null; end if;
  if not (is_admin() or manages(p_event) or manages(sis)) then return null; end if;
  select case when department = 'bar' then id else sis end, case when department = 'bar' then sis else id end into bar_ev, floor_ev from events where id = p_event;
  select coalesce(st.nickname, split_part(st.full_name, ' ', 1)) into mgr from events e join staff st on st.id = e.manager_id where e.id = sis;
  return jsonb_build_object('sister', sis, 'bar_event', bar_ev, 'floor_event', floor_ev, 'sister_mgr', mgr,
    'loan', coalesce((select jsonb_agg(x order by x->>'planned_start', x->>'full_name') from (
      select jsonb_build_object('shift_id', s.id, 'staff_id', s.staff_id, 'full_name', st.full_name, 'nickname', st.nickname, 'photo_url', st.photo_url,
        'position_code', s.position_code, 'planned_start', s.planned_start, 'punch_in', p.punch_in, 'punch_out', p.punch_out, 'switched_at', s.switched_at) x
      from shifts s join staff st on st.id = s.staff_id left join punches p on p.shift_id = s.id
      where s.event_id = bar_ev and s.status <> 'declined' and s.attendance is null and s.cancelled_at is null and _is_floor_pos(s.position_code, s.position_detail)) q), '[]'::jsonb),
    'floor', coalesce((select jsonb_agg(x order by x->>'planned_start', x->>'full_name') from (
      select jsonb_build_object('shift_id', s.id, 'staff_id', s.staff_id, 'full_name', st.full_name, 'nickname', st.nickname, 'photo_url', st.photo_url,
        'position_code', s.position_code, 'planned_start', s.planned_start, 'punch_in', p.punch_in, 'punch_out', p.punch_out, 'switched_at', s.switched_at) x
      from shifts s join staff st on st.id = s.staff_id left join punches p on p.shift_id = s.id left join events fe on fe.id = s.event_id
      where s.event_id = floor_ev and s.status <> 'declined' and s.attendance is null and s.cancelled_at is null and _is_floor_pos(s.position_code, s.position_detail)
        and s.staff_id is distinct from fe.manager_id and not (s.staff_id = any(coalesce(fe.co_manager_ids, '{}')))) q), '[]'::jsonb));
end $$;

create or replace function public.switch_team(p_bar_shift uuid, p_floor_shift uuid) returns void language plpgsql security definer set search_path = public as $$
declare a shifts; b shifts; ea events; eb events;
begin
  select * into a from shifts where id = p_bar_shift; select * into b from shifts where id = p_floor_shift;
  if a.id is null or b.id is null then raise exception 'Shift not found'; end if;
  select * into ea from events where id = a.event_id; select * into eb from events where id = b.event_id;
  if ea.department <> 'bar' or _team_sister(ea.id) is distinct from eb.id then raise exception 'These two are not on the bar and floor of the same event'; end if;
  if not (is_admin() or manages(ea.id) or manages(eb.id)) then raise exception 'Not allowed'; end if;
  if not _is_floor_pos(a.position_code, a.position_detail) or not _is_floor_pos(b.position_code, b.position_detail) then raise exception 'Only floor staff can switch'; end if;
  if exists (select 1 from shifts where event_id = eb.id and staff_id = a.staff_id) or exists (select 1 from shifts where event_id = ea.id and staff_id = b.staff_id) then raise exception 'Already on both lists'; end if;
  perform set_config('gr.quiet', 'on', true); -- same venue, same night: no "your shift changed" box for staff
  update shifts set event_id = eb.id, switched_at = now(), switched_by = me() where id = a.id;
  update shifts set event_id = ea.id, switched_at = now(), switched_by = me() where id = b.id;
end $$;

grant execute on function public.team_link(uuid) to authenticated;
grant execute on function public.switch_team(uuid, uuid) to authenticated;
revoke execute on function public._team_sister(uuid) from anon;
select 'RESULT 146 ok' as result;
