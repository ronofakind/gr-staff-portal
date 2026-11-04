-- Push 51 (Nov 4): past events for managers (Home reminder · My dates → Past · past event page) + the "Teams I managed" fix.
-- Safe to run twice (create or replace only, no data changes).
--
-- Bug (Nov 3, Beth Chabad bar · Pepe = BM): manages() only knew events.manager_id + co_manager_ids. manager_id is set from the
-- BM / MD line when Ronnie saves the event form; someone placed on that line later (Bookings board, sheet sync, Free / Day)
-- never becomes manager_id. The app already treated the MD / BM shift as the manager (Home "My team", the shift page),
-- but RLS and the manager RPCs didn't, and Hours → Teams I managed only read manager_id.
-- One rule from now on, same as src/lib/pastEvents.ts: lead, co-manager, or a live MD / BM shift on that event
-- (not declined, not marked cancelled).

create or replace function public.manages(ev uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from events where id = ev and (manager_id = public.me() or public.me() = any(coalesce(co_manager_ids, '{}'))))
       or exists (select 1 from shifts s where s.event_id = ev and s.staff_id = public.me() and s.status <> 'declined'
                    and coalesce(s.attendance, '') <> 'cancelled' and s.position_code in ('MD', 'BM')) $$;

-- Rating window: the day before → 7 days after the event (was 2 days), Montreal date. Same checks otherwise as 033.
create or replace function public.manager_send_feedback(p_event uuid, p_staff uuid, p_stars smallint, p_tier text, p_ratings jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = public as
$$ declare d date; k text; v jsonb; rid uuid; today date := (now() at time zone 'America/Toronto')::date;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select event_date into d from events where id = p_event;
  if d is null or today < d - 1 or today > d + 7 then raise exception 'Rating is open from the day before to 7 days after the event.'; end if;
  if not exists (select 1 from shifts where event_id = p_event and staff_id = p_staff and status <> 'declined') then raise exception 'not on this event'; end if;
  if p_stars is null or p_stars not between 1 and 5 then raise exception 'Pick 1 to 5 stars for tonight.'; end if;
  if p_tier is not null and p_tier not in ('A', 'B', 'C') then raise exception 'bad tier'; end if;
  if p_ratings is not null and jsonb_typeof(p_ratings) <> 'object' then raise exception 'bad ratings'; end if;
  for k, v in select * from jsonb_each(coalesce(p_ratings, '{}')) loop
    if k not in ('punctuality', 'attitude', 'presentation', 'experience', 'teamwork', 'guest')
       or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (1, 2, 3, 4, 5) then raise exception 'bad rating %', k; end if;
  end loop;
  insert into staff_feedback (staff_id, event_id, by_staff_id, overall_stars, tier_vote, ratings, note)
  values (p_staff, p_event, me(), p_stars, p_tier, coalesce(p_ratings, '{}'), nullif(trim(p_note), ''))
  on conflict (event_id, staff_id, by_staff_id) do update
     set overall_stars = excluded.overall_stars, tier_vote = excluded.tier_vote, ratings = excluded.ratings, note = excluded.note,
         updated_at = now(), archived_at = null
  returning id into rid;
  return rid;
end $$;
revoke all on function public.manager_send_feedback(uuid, uuid, smallint, text, jsonb, text) from public;
grant execute on function public.manager_send_feedback(uuid, uuid, smallint, text, jsonb, text) to authenticated;

-- Check: last 30 days, events whose MD / BM shift is held by someone who is NOT manager_id / a co-manager
-- (these managers were locked out of their team before this migration). Beth Chabad · Nov 3 should be listed if that was the cause.
select e.event_date, e.title, e.department, st.full_name as lead_on_shift, s.position_code,
       (select full_name from staff where id = e.manager_id) as events_manager_id,
       e.hours_submitted_at is not null as hours_sent
  from public.shifts s join public.events e on e.id = s.event_id join public.staff st on st.id = s.staff_id
 where s.position_code in ('MD', 'BM') and s.status <> 'declined' and coalesce(s.attendance, '') <> 'cancelled'
   and e.event_date >= (now() at time zone 'America/Toronto')::date - 30
   and s.staff_id is distinct from e.manager_id and not (s.staff_id = any(coalesce(e.co_manager_ids, '{}')))
 order by e.event_date desc, e.title;
