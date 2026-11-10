-- 057 · Managers can't rate themselves (Ronnie, Nov 4 10:29 AM). Same function as 056 + one check. Safe to run twice.

create or replace function public.manager_send_feedback(p_event uuid, p_staff uuid, p_stars smallint, p_tier text, p_ratings jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = public as
$$ declare d date; k text; v jsonb; rid uuid; today date := (now() at time zone 'America/Toronto')::date;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  if p_staff = me() then raise exception 'You can''t rate yourself.'; end if;
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

select position('rate yourself' in pg_get_functiondef('public.manager_send_feedback(uuid, uuid, smallint, text, jsonb, text)'::regprocedure)) > 0 as self_check_on;
