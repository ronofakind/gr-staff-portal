-- 097 · MDs never see rankings (launch audit, Nov 10, 2026). manager_team_info returned the staff tier to MDs; now only the admin gets it. Safe to run twice.
create or replace function public.manager_team_info(p_event uuid)
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
  select t.staff_id, case when is_admin() then sp.tier end, dn.n, (not coalesce(sp.veteran, false) and dn.n < 3), f.tier_vote, f.ratings, f.note,
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
select 'RESULT ' || (position('is_admin() then sp.tier' in prosrc) > 0)::text from pg_proc where proname = 'manager_team_info';
