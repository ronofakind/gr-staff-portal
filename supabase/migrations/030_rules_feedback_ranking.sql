-- Push 27 (Oct 31): booking rules in the app, manager feedback, Ranking score.
-- The app now owns the rules (Hub Connections / Keep Apart are no longer the source; app edits are not written back).

-- ───────── 27a · Booking rules ─────────
-- staff_links: together (works well with) | apart (keep apart from). One row per pair (staff_a < staff_b) covers both profiles.
alter table public.staff_links drop constraint if exists staff_links_kind_check;
alter table public.staff_links add constraint staff_links_kind_check check (kind in ('together', 'apart'));
alter table public.staff_links add column if not exists reason text;
alter table public.staff_links add column if not exists created_at timestamptz not null default now();

-- staff_conditions: + private_only (private houses only). min_guests stays valid (old rows are shown read-only).
alter table public.staff_conditions drop constraint if exists staff_conditions_kind_check;
alter table public.staff_conditions add constraint staff_conditions_kind_check
  check (kind in ('not_venue', 'min_guests', 'big_dates_only', 'only_if_needed', 'not_weekday', 'private_only'));
alter table public.staff_conditions add column if not exists reason text;

-- ───────── 27c · Ranking inputs (admin-only table) ─────────
alter table public.staff_private add column if not exists experience text check (experience in ('SENIOR', 'MID', 'JUNIOR'));
alter table public.staff_private add column if not exists bmo_fit boolean not null default false;
alter table public.staff_private add column if not exists priority_until date;
-- veteran = known before the app (not "new" even with < 3 app shifts). New contractors default to false.
alter table public.staff_private add column if not exists veteran boolean not null default false;

-- Everyone in the app today is a veteran, except the people the Hub marks NEW (below).
insert into public.staff_private (staff_id, veteran)
select id, true from public.staff
on conflict (staff_id) do update set veteran = true;

-- Seed from the Staff Hub · Rankings tab (A NAMES, E EXPERIENCE LEVEL, F BMO FIT, J NEW), read Oct 31.
-- N PRIORITY UNTIL has no dates today (only notes like "Do not book for now"), so priority_until stays empty.
-- loose name match: first word + last word (same as migration 028)
create or replace function pg_temp.sid(n text) returns uuid language sql as $$
  select id from public.staff
   where active and (lower(full_name) = lower(n)
      or lower(full_name) like lower(split_part(split_part(n, ' ', 1), '-', 1)) || '%' || lower(regexp_replace(n, '^.* ', '')))
   order by (lower(full_name) = lower(n)) desc limit 1 $$;

create temp table hub_seed (n text, exp text, bmo boolean, is_new boolean);
insert into hub_seed values
('Aberkane Nordine','SENIOR',false,false), ('Albasel Ahmad Al Yazouri','SENIOR',false,false), ('Ammar Al Zib','SENIOR',false,false),
('Adele Ledoux','SENIOR',false,true), ('Anais Turcotte','SENIOR',true,false), ('Andrew Omalley','MID',false,false),
('Angelica Bala','MID',false,false), ('Anna Zatokova','SENIOR',false,false), ('Arthur Brunel','SENIOR',false,false),
('Aurora Dyck','SENIOR',true,false), ('Baudouin Dragon','MID',false,false), ('Bhreagh Macarthur','SENIOR',false,false),
('Brian Helou','SENIOR',true,false), ('Cameron Qayoom-Taylor','SENIOR',false,false), ('Camilo-Andres Mana-Silva','SENIOR',false,false),
('Cassandra Timotheatos','MID',false,false), ('Cassidy Debargis','MID',false,false), ('Chelsea Banago','SENIOR',true,false),
('Christian Buitrago Gutierrez','MID',false,false), ('Clara Finnen','MID',false,false), ('Kiara Petit-Erskine','MID',false,false),
('Daniel Tomov','MID',false,false), ('Diem My Dang','SENIOR',false,false), ('Eliot Axel Thomas','SENIOR',true,false),
('Emiliya Khabibullina','SENIOR',true,false), ('Emily Magee','SENIOR',true,false), ('Erika Sara Fagnani','SENIOR',true,false),
('Etienne Malecki','SENIOR',false,false), ('Eva-Michele-Marcy Schneiderlin','MID',false,false), ('Fares Al Yazouri','MID',false,false),
('Gabriella Azoulay','JUNIOR',false,false), ('Gabrielle Dionne Legendre','SENIOR',false,false), ('Gabrielle Kelly','MID',false,false),
('Haley Ross','SENIOR',false,false), ('Ilyes (Maxence)','MID',false,false), ('Ilyes Ait Yahiatene','MID',false,false),
('Ion Turcan','JUNIOR',false,false), ('Isaac Brouse-Lillini','SENIOR',true,false), ('Ivan Lister','SENIOR',false,false),
('Jade Charest','MID',false,false), ('Jade Gagne Lavoie','MID',false,false), ('James Tilley','SENIOR',false,false),
('Jasmine Zohra Rappelin','JUNIOR',false,false), ('Justus Hunicke','SENIOR',false,true), ('Jasmyne Maritza Rodriguez','SENIOR',false,false),
('Jonathan De Sousa','SENIOR',false,false), ('Jose Alberto Gonzalez Frau','SENIOR',true,false), ('Juliette Gillet','MID',false,false),
('Kamena Stoeva','MID',false,false), ('Karen Betancourt','SENIOR',false,false), ('Kayden Mikkel Bermudez','SENIOR',false,false),
('Khalid Shogar','MID',false,false), ('Laura Arcari Boudinet','MID',false,false), ('Lea Moreau','SENIOR',false,false),
('Lena Yun','SENIOR',true,false), ('Lindsay Muir','SENIOR',true,false), ('Linnea Ernedal','MID',false,false),
('Liza Marie Heng','JUNIOR',false,false), ('Louise Marie Annie Roze','SENIOR',false,false), ('Lucas Catchlove','MID',false,false),
('Lucie Marie Avarello','SENIOR',false,false), ('Lucy Huart','SENIOR',true,false), ('Lyes Heulers','SENIOR',true,false),
('Mahaut Nieuviarts','SENIOR',true,false), ('Maraya Rodriguez','SENIOR',true,false), ('Marc Olivier Gelibet','SENIOR',true,false),
('Marcel Mardini','SENIOR',false,false), ('Margarita Encarnacion Figuereo','MID',false,false), ('Matheo (Maxence)','MID',false,false),
('Maxence Mauplat','SENIOR',true,false), ('Maxime De Castelbajac','SENIOR',false,false), ('Maya Ashley Zucker','MID',false,false),
('Megan Zucker','MID',false,false), ('Melanie Jobin','SENIOR',true,false), ('Meliha Molla','SENIOR',true,false),
('Michael Brown','SENIOR',false,false), ('Mouna Chabchoub','MID',false,false), ('Naima Vanina Sigouin-Melasco','SENIOR',true,false),
('Nicholas Lamonica','SENIOR',false,false), ('Nicolas Papillon','SENIOR',false,false), ('Nina Berdzenishvili','SENIOR',false,false),
('Nolam Chenevet','MID',false,false), ('Paul-Mickael Mardini','SENIOR',false,false), ('Philipp Rodionov','SENIOR',false,false),
('Pia-Marie Ladores','MID',false,false), ('Rachel Bouhdana','SENIOR',true,false), ('Rachel Hadef','MID',false,false),
('Rami Oueslati','JUNIOR',false,false), ('Raphael Bedart-Lamon','MID',false,false), ('Robert-Jun Corpus','SENIOR',false,false),
('Roman Stikhin','MID',false,false), ('Ronald Ladores','SENIOR',true,false), ('Ruth Payet','MID',true,false),
('Said Touahri','MID',false,false), ('Salim Ouachem','MID',false,false), ('Sara Gelibet','SENIOR',true,false),
('Savanna Carpenter','SENIOR',true,false), ('Shamim Rahman','MID',false,false), ('Samantha Van Wingen','MID',false,true),
('Sophia Lianova','MID',false,false), ('Sophie Anna Maillard','SENIOR',false,false), ('Theodora Tanasiciuc','SENIOR',false,false),
('Traian Turcan','JUNIOR',false,false), ('Trisha Banago','SENIOR',true,false), ('Viktoriia Motlokhova','JUNIOR',false,false),
('Virginie Jobin','MID',false,false), ('Tess Isabel Crombeen','JUNIOR',false,true), ('Yan Turcotte','SENIOR',false,false),
('Yanis Heulers','MID',false,false), ('Zine Eddine Bouzebra','JUNIOR',false,false), ('Grace Brigid Ohara','MID',false,false),
('Charlotte Ellis Olander','SENIOR',false,false), ('Mila Georgieva','MID',false,false), ('Valentin Marsal','MID',false,false),
('Elodie Theriault','SENIOR',false,true), ('Ryan Scully','MID',false,false), ('Alicia Gonthier','MID',false,true),
('Liza Charbonnier','MID',false,true), ('Anton Michener','JUNIOR',false,true), ('Vileya Reynel Pillay',null,false,true),
('Amal Elghoul','JUNIOR',false,true), ('Axel Matei Sigouin Melasco','JUNIOR',false,true), ('Cynthia Mouvand','JUNIOR',false,true),
('Loukhman Ali','JUNIOR',false,true), ('Sydney Jane Ross','MID',false,true), ('Elliot Debargis','MID',false,true),
('Jane Liagre','SENIOR',false,true), ('Massil Nordine','MID',false,false), ('Mahaut Irion-Dewavrin','SENIOR',false,false),
('David Berlinguet','MID',false,false), ('Thibault De Castelbajac','SENIOR',false,true), ('Elika Khabibullina','JUNIOR',false,true),
('Juliette Brunel','JUNIOR',false,true), ('Colombe Broudehoux','SENIOR',true,false), ('Manuela Flores Denti','MID',false,false),
('Julian Tayarah','MID',false,false), ('Thibault Outre','SENIOR',false,false);

update public.staff_private p
   set experience = coalesce(h.exp, p.experience), bmo_fit = h.bmo, veteran = not h.is_new
  from (select pg_temp.sid(n) sid, exp, bmo, is_new from hub_seed) h
 where h.sid = p.staff_id;

-- ───────── 27b · Manager feedback ─────────
create table if not exists public.staff_feedback (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  by_staff_id uuid not null default public.me() references public.staff(id) on delete cascade,
  tier_vote   text check (tier_vote in ('A', 'B', 'C')),
  ratings     jsonb not null default '{}',   -- {"punctuality":"up"|"ok"|"down", attitude, presentation, experience, teamwork, guest}
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz,
  unique (event_id, staff_id, by_staff_id)
);
create index if not exists staff_feedback_staff_idx on public.staff_feedback (staff_id, created_at desc);
alter table public.staff_feedback enable row level security;
drop policy if exists admin_all on public.staff_feedback;
create policy admin_all on public.staff_feedback for all using (is_admin()) with check (is_admin());
drop policy if exists manager_insert on public.staff_feedback;
create policy manager_insert on public.staff_feedback for insert with check (manages(event_id) and by_staff_id = me());
-- (no select policy for managers: only Ronnie reads feedback; managers get their own via manager_team_info)

-- Finished shifts = not declined, no no-show / cancel, has a start and an end.
create or replace function public.staff_shift_counts()
returns table (staff_id uuid, done int) language sql stable security definer set search_path = public as
$$ select s.staff_id, count(*)::int from shifts s join punches p on p.shift_id = s.id
    where is_admin() and s.status <> 'declined' and s.attendance is null and p.punch_in is not null and p.punch_out is not null
    group by s.staff_id $$;

-- Manager team list extras: their tier (feedback pre-set), finished shifts before this event, NEW flag
-- (< 3 finished shifts and not a veteran), and the feedback this manager already sent for this event
-- (managers can't read staff_feedback or staff_private directly).
create or replace function public.manager_team_info(p_event uuid)
returns table (staff_id uuid, tier text, done_before int, is_new boolean, fb_tier text, fb_ratings jsonb, fb_note text)
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
  select t.staff_id, sp.tier, dn.n, (not coalesce(sp.veteran, false) and dn.n < 3), f.tier_vote, f.ratings, f.note
    from team t join done dn on dn.staff_id = t.staff_id
    left join staff_private sp on sp.staff_id = t.staff_id
    left join staff_feedback f on f.event_id = p_event and f.staff_id = t.staff_id and f.by_staff_id = me();
end $$;
grant execute on function public.manager_team_info(uuid) to authenticated;

-- Send (or update) feedback for one person on this event. Managers only for their own event, from the day before to 2 days after.
create or replace function public.manager_send_feedback(p_event uuid, p_staff uuid, p_tier text, p_ratings jsonb, p_note text)
returns uuid language plpgsql security definer set search_path = public as
$$ declare d date; k text; v text; rid uuid;
begin
  if not (is_admin() or manages(p_event)) then raise exception 'not allowed'; end if;
  select event_date into d from events where id = p_event;
  if d is null or current_date < d - 1 or current_date > d + 2 then raise exception 'Feedback is open from the day before to 2 days after the event.'; end if;
  if not exists (select 1 from shifts where event_id = p_event and staff_id = p_staff and status <> 'declined') then raise exception 'not on this event'; end if;
  if p_tier is not null and p_tier not in ('A', 'B', 'C') then raise exception 'bad tier'; end if;
  for k, v in select * from jsonb_each_text(coalesce(p_ratings, '{}')) loop
    if k not in ('punctuality', 'attitude', 'presentation', 'experience', 'teamwork', 'guest') or v not in ('up', 'ok', 'down') then raise exception 'bad rating %', k; end if;
  end loop;
  insert into staff_feedback (staff_id, event_id, by_staff_id, tier_vote, ratings, note)
  values (p_staff, p_event, me(), p_tier, coalesce(p_ratings, '{}'), nullif(trim(p_note), ''))
  on conflict (event_id, staff_id, by_staff_id) do update
     set tier_vote = excluded.tier_vote, ratings = excluded.ratings, note = excluded.note, updated_at = now(), archived_at = null
  returning id into rid;
  return rid;
end $$;
grant execute on function public.manager_send_feedback(uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.staff_shift_counts() to authenticated;

select (select count(*) from staff_links) links,
       (select count(*) from staff_conditions) conditions,
       (select count(*) from staff_private where experience is not null) with_experience,
       (select count(*) from staff_private where bmo_fit) bmo_fit,
       (select count(*) from staff_private where not veteran) not_veteran,
       (select count(*) from hub_seed where pg_temp.sid(n) is null) hub_names_not_matched,
       (select count(*) from staff_feedback) feedback;
