-- Push 29 (Oct 31): ABOUT block on the manager profile sheet + admin ABOUT card.
-- staff_private stays admin-only by RLS; managers only get these fields through manager_team_info (security definer).

-- ───────── 29 · About fields (admin-only table) ─────────
alter table public.staff_private add column if not exists experience_note text;       -- "2 yrs restaurant"
alter table public.staff_private add column if not exists knows_staff_id uuid references public.staff(id) on delete set null;
alter table public.staff_private add column if not exists knows_text text;            -- relation ("cousin", "referred them") or a raw name when not in the app
alter table public.staff_private add column if not exists languages jsonb not null default '{}';  -- {"fr":1..3,"en":1..3} · 1 Basic · 2 Good · 3 Fluent
alter table public.staff_private add column if not exists manager_note text;          -- one line managers see

-- ───────── manager_team_info: + about fields ─────────
-- Return type changes → drop and recreate. Still returns tier (feedback pre-set, as in 030); never ranking / notes / bmo / priority.
drop function if exists public.manager_team_info(uuid);
create function public.manager_team_info(p_event uuid)
returns table (staff_id uuid, tier text, done_before int, is_new boolean, fb_tier text, fb_ratings jsonb, fb_note text,
               experience text, experience_note text, knows_name text, knows_text text, knows_here boolean, knows_today boolean,
               languages jsonb, manager_note text)
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
         coalesce(sp.languages, '{}'::jsonb), sp.manager_note
    from team t join done dn on dn.staff_id = t.staff_id
    left join staff_private sp on sp.staff_id = t.staff_id
    left join staff k on k.id = sp.knows_staff_id
    left join staff_feedback f on f.event_id = p_event and f.staff_id = t.staff_id and f.by_staff_id = me();
end $$;
revoke all on function public.manager_team_info(uuid) from public;
grant execute on function public.manager_team_info(uuid) to authenticated;

-- ───────── Seed KNOWS from the Staff Hub · Rankings tab (A NAMES, R REFERRED BY), read Oct 31 ─────────
-- ref1 = the referrer name cleaned up by hand (spelling fixed to the app name), ref2 = a second referrer when the cell names two.
-- loose name match: first word + last word (same as migrations 028 / 030)
create or replace function pg_temp.sid(n text) returns uuid language sql as $$
  select id from public.staff
   where active and (lower(full_name) = lower(n)
      or lower(full_name) like lower(split_part(split_part(n, ' ', 1), '-', 1)) || '%' || lower(regexp_replace(n, '^.* ', '')))
   order by (lower(full_name) = lower(n)) desc limit 1 $$;

create temp table ref_seed (n text, ref_raw text, ref1 text, ref2 text);
insert into ref_seed values
('Adele Ledoux',               'Aurora Dyck et Grace O''Hara',              'Aurora Dyck',                  'Grace'),
('Clara Finnen',               'Isaac Brouse-Lillini',                      'Isaac Brouse-Lillini',         null),
('Kiara Petit-Erskine',        'Olympia Dairaine Grimaux',                  'Olympia Dairaine Grimaux',     null),
('Justus Hunicke',             'Zachary Lecker',                            'Zachary Lecker',               null),
('Raphael Bedart-Lamon',       'Naima Vanina Sigouin-Melasco',              'Naima Vanina Sigouin-Melasco', null),
('Samantha Van Wingen',        'Isaac Brouse-Lillini',                      'Isaac Brouse-Lillini',         null),
('Tess Isabel Crombeen',       'Grace Brigid Ohara',                        'Grace Brigid Ohara',           null),
('Elodie Theriault',           'Emiliya Khabibullina',                      'Emiliya Khabibullina',         null),
('Ryan Scully',                'Emiliya Khabibullina',                      'Emiliya Khabibullina',         null),
('Alicia Gonthier',            'David Berlinguet',                          'David Berlinguet',             null),
('Amal Elghoul',               'Sophie Maillard',                           'Sophie Anna Maillard',         null),
('Axel Matei Sigouin Melasco', 'Naima Sigouin-Melasco et Arthur brunelle',  'Naima Vanina Sigouin-Melasco', 'Arthur'),
('Cynthia Mouvand',            'Louise Roze',                               'Louise Marie Annie Roze',      null),
('Loukhman Ali',               'Baudoin Dragon',                            'Baudouin Dragon',              null),
('Sydney Jane Ross',           'Linnea Ernedal',                            'Linnea Ernedal',               null),
('Elliot Debargis',            'Cassidy Debargis',                          'Cassidy Debargis',             null),
('Jane Liagre',                'Colombe Broudehoux',                        'Colombe Broudehoux',           null);

-- make sure each referred person has a staff_private row (030 created one for everyone then; newer staff may not have one)
insert into public.staff_private (staff_id)
select pg_temp.sid(n) from ref_seed where pg_temp.sid(n) is not null
on conflict (staff_id) do nothing;

-- matched referrer → link + "referred them" (+ the second referrer's first name)
update public.staff_private p
   set knows_staff_id = r.ref_id,
       knows_text = coalesce(p.knows_text, 'referred them' || coalesce(' · with ' || r.ref2, ''))
  from (select pg_temp.sid(n) sid, pg_temp.sid(ref1) ref_id, ref2 from ref_seed) r
 where r.sid = p.staff_id and r.ref_id is not null and r.ref_id <> p.staff_id and p.knows_staff_id is null;

-- referrer not in the app → keep the raw name as text, no link
update public.staff_private p
   set knows_text = 'referred by ' || r.ref_raw
  from (select pg_temp.sid(n) sid, pg_temp.sid(ref1) ref_id, ref_raw from ref_seed) r
 where r.sid = p.staff_id and r.ref_id is null and p.knows_staff_id is null and p.knows_text is null;

select (select count(*) from ref_seed) hub_referrals,
       (select count(*) from ref_seed where pg_temp.sid(n) is null) referred_not_matched,
       (select count(*) from ref_seed where pg_temp.sid(n) is not null and pg_temp.sid(ref1) is null) referrer_not_in_app,
       (select count(*) from staff_private where knows_staff_id is not null) knows_linked,
       (select count(*) from staff_private where knows_staff_id is null and knows_text is not null) knows_text_only;
