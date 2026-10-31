-- Push 30 (Oct 31): manager feedback with stars (replaces the push-27 ▲●▼ ratings).
-- overall_stars 1–5 is required on every new feedback; detail ratings are now 1–5 stars each (optional).
-- Old rows keep overall_stars null and ratings "up"/"ok"/"down" → the app scores them the old way.

-- ───────── 30 · overall stars ─────────
alter table public.staff_feedback add column if not exists overall_stars smallint;
alter table public.staff_feedback drop constraint if exists staff_feedback_overall_stars_check;
alter table public.staff_feedback add constraint staff_feedback_overall_stars_check check (overall_stars between 1 and 5);
comment on column public.staff_feedback.overall_stars is 'push 30 · tonight overall 1–5 (null = push-27 row, ratings are up/ok/down)';
comment on column public.staff_feedback.ratings is 'push 30 · {"punctuality":1..5, attitude, presentation, experience, teamwork, guest} · push-27 rows: "up"|"ok"|"down"';

-- ───────── manager_send_feedback: + p_stars (required), ratings 1–5 ─────────
-- Signature changes → drop the 030 one and recreate. Same window (day before → 2 days after) and manages() check as 030.
drop function if exists public.manager_send_feedback(uuid, uuid, text, jsonb, text);
create function public.manager_send_feedback(p_event uuid, p_staff uuid, p_stars smallint, p_tier text, p_ratings jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = public as
$$ declare d date; k text; v jsonb; rid uuid;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select event_date into d from events where id = p_event;
  if d is null or current_date < d - 1 or current_date > d + 2 then raise exception 'Feedback is open from the day before to 2 days after the event.'; end if;
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

-- ───────── manager_team_info: + fb_stars (for the ★ Rate tile) ─────────
-- Return type changes → drop and recreate. Every column 032 returns is kept, fb_stars added at the end.
drop function if exists public.manager_team_info(uuid);
create function public.manager_team_info(p_event uuid)
returns table (staff_id uuid, tier text, done_before int, is_new boolean, fb_tier text, fb_ratings jsonb, fb_note text,
               experience text, experience_note text, knows_name text, knows_text text, knows_here boolean, knows_today boolean,
               languages jsonb, manager_note text, fb_stars smallint)
language plpgsql stable security definer set search_path = public as
$$ #variable_conflict use_column
declare d date;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select event_date into d from events where id = p_event;
  return query
  with team as (select distinct s.staff_id from shifts s where s.event_id = p_event and s.status <> 'declined'),
  done as (select t.staff_id, (select count(*)::int from shifts s2 join punches p2 on p2.shift_id = s2.id join events e2 on e2.id = s2.event_id
                                where s2.staff_id = t.staff_id and e2.event_date < d and s2.status <> 'declined' and s2.attendance is null
                                  and p2.punch_in is not null and p2.punch_out is not null) n from team t)
  select t.staff_id, sp.tier, dn.n, (not coalesce(sp.veteran, false) and dn.n < 3), f.tier_vote, f.ratings, f.note,
         sp.experience, sp.experience_note, k.full_name, sp.knows_text,
         -- HERE = the person they know is on this same event (not declined)
         (sp.knows_staff_id is not null and exists (select 1 from shifts s3 where s3.event_id = p_event and s3.staff_id = sp.knows_staff_id and s3.status <> 'declined')),
         -- working any event that day
         (sp.knows_staff_id is not null and exists (select 1 from shifts s4 join events e4 on e4.id = s4.event_id
                                                     where e4.event_date = d and s4.staff_id = sp.knows_staff_id and s4.status <> 'declined')),
         coalesce(sp.languages, '{}'::jsonb), sp.manager_note, f.overall_stars
    from team t join done dn on dn.staff_id = t.staff_id
    left join staff_private sp on sp.staff_id = t.staff_id
    left join staff k on k.id = sp.knows_staff_id
    left join staff_feedback f on f.event_id = p_event and f.staff_id = t.staff_id and f.by_staff_id = me();
end $$;
revoke all on function public.manager_team_info(uuid) from public;
grant execute on function public.manager_team_info(uuid) to authenticated;

select (select count(*) from staff_feedback) feedback,
       (select count(*) from staff_feedback where overall_stars is null) old_rows,
       (select count(*) from staff_feedback where overall_stars is not null) star_rows,
       (select pg_get_function_identity_arguments('public.manager_send_feedback'::regproc)) send_args,
       (select string_agg(a, ', ') from (select unnest(proargnames) a from pg_proc where proname = 'manager_team_info' and pronamespace = 'public'::regnamespace) x
         where a like 'fb_%') team_info_fb_cols;
