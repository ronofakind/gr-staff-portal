-- 122 · Day sheet part 2 (Nov 12, 2026 · push 109): far venues + who has a car. Safe to run twice.
-- Ronnie: far venues (Le Andover, Porsche Laval…) → ✦ Fill puts people with a car first, with the people they're linked to.
alter table public.venues add column if not exists far boolean not null default false;
comment on column public.venues.far is 'push 109 · far venue: ✦ Fill puts drivers (staff.transport = car) + their linked people first.';
update public.venues set far = true where not far and (area = 'Far' or name ilike '%andover%' or name ilike 'porsche%laval%');

-- Who has a car: Staff Hub Rankings column I (TRANSPORT). YES = car. NO = transit (only where the app has nothing yet).
create or replace function pg_temp.sid(n text) returns uuid language sql as $$
  select id from public.staff
   where active and (lower(full_name) = lower(n)
      or lower(full_name) like lower(split_part(split_part(n, ' ', 1), '-', 1)) || '%' || lower(regexp_replace(n, '^.* ', '')))
   order by (lower(full_name) = lower(n)) desc limit 1 $$;
update public.staff s set transport = 'car' from (values
  ('Aberkane Nordine'),
  ('Ammar Al Zib'),
  ('Anais Turcotte'),
  ('Angelica Bala'),
  ('Arthur Brunel'),
  ('Brian Helou'),
  ('Emiliya Khabibullina'),
  ('Gabrielle Dionne Legendre'),
  ('Jonathan De Sousa'),
  ('Lindsay Muir'),
  ('Marc Olivier Gelibet'),
  ('Marcel Mardini'),
  ('Melanie Jobin'),
  ('Meliha Molla'),
  ('Mouna Chabchoub'),
  ('Paul-Mickael Mardini'),
  ('Philipp Rodionov'),
  ('Ronald Ladores'),
  ('Trisha Banago'),
  ('Yan Turcotte')) v(n) where s.id = pg_temp.sid(v.n) and s.transport is distinct from 'car';
update public.staff s set transport = 'transit' from (values
  ('Andrew Omalley'),
  ('Anna Zatokova'),
  ('Aurora Dyck'),
  ('Baudouin Dragon'),
  ('Bhreagh Macarthur'),
  ('Cameron Qayoom-Taylor'),
  ('Camilo-Andres Mana-Silva'),
  ('Cassandra Timotheatos'),
  ('Cassidy Debargis'),
  ('Chelsea Banago'),
  ('Daniel Tomov'),
  ('Eliot Axel Thomas'),
  ('Emily Magee'),
  ('Erika Sara Fagnani'),
  ('Etienne Malecki'),
  ('Eva-Michele-Marcy Schneiderlin'),
  ('Fares Al Yazouri'),
  ('Gabriella Azoulay'),
  ('Gabrielle Kelly'),
  ('Haley Ross'),
  ('Ilyes (Maxence)'),
  ('Ilyes Ait Yahiatene'),
  ('Ion Turcan'),
  ('Isaac Brouse-Lillini'),
  ('Ivan Lister'),
  ('Jade Charest'),
  ('Jade Gagne Lavoie'),
  ('James Tilley'),
  ('Jasmine Zohra Rappelin'),
  ('Jasmyne Maritza Rodriguez'),
  ('Jose Alberto Gonzalez Frau'),
  ('Juliette Gillet'),
  ('Kamena Stoeva'),
  ('Karen Betancourt'),
  ('Kayden Mikkel Bermudez'),
  ('Khalid Shogar'),
  ('Laura Arcari Boudinet'),
  ('Lea Moreau'),
  ('Lena Yun'),
  ('Linnea Ernedal'),
  ('Liza Marie Heng'),
  ('Louise Marie Annie Roze'),
  ('Lucas Catchlove'),
  ('Lucie Marie Avarello'),
  ('Lucy Huart'),
  ('Lyes Heulers'),
  ('Mahaut Nieuviarts'),
  ('Maraya Rodriguez'),
  ('Margarita Encarnacion Figuereo'),
  ('Matheo (Maxence)'),
  ('Maxence Mauplat'),
  ('Maxime De Castelbajac'),
  ('Maya Ashley Zucker'),
  ('Megan Zucker'),
  ('Michael Brown'),
  ('Naima Vanina Sigouin-Melasco'),
  ('Nicholas Lamonica'),
  ('Nicolas Papillon'),
  ('Nina Berdzenishvili'),
  ('Nolam Chenevet'),
  ('Pia-Marie Ladores'),
  ('Rachel Bouhdana'),
  ('Rachel Hadef'),
  ('Rami Oueslati'),
  ('Raphael Bedart-Lamon'),
  ('Robert-Jun Corpus'),
  ('Roman Stikhin'),
  ('Ruth Payet'),
  ('Said Touahri'),
  ('Salim Ouachem'),
  ('Sara Gelibet'),
  ('Savanna Carpenter'),
  ('Shamim Rahman'),
  ('Sophia Lianova'),
  ('Sophie Anna Maillard'),
  ('Theodora Tanasiciuc'),
  ('Traian Turcan'),
  ('Virginie Jobin'),
  ('Yanis Heulers'),
  ('Zine Eddine Bouzebra'),
  ('Grace Brigid Ohara'),
  ('Valentin Marsal')) v(n) where s.id = pg_temp.sid(v.n) and s.transport is null;

-- Carpools Ronnie named (Nov 12): Brian Helou + Chelsea Banago + Meliha Molla; Emiliya Khabibullina + Anna Zatokova.
insert into public.staff_links(staff_a, staff_b, kind)
select least(a, b), greatest(a, b), 'together' from (select pg_temp.sid(x) a, pg_temp.sid(y) b from (values
  ('Brian Helou','Chelsea Banago'), ('Brian Helou','Meliha Molla'), ('Chelsea Banago','Meliha Molla'), ('Emiliya Khabibullina','Anna Zatokova')) p(x, y)) z
where a is not null and b is not null and a <> b
on conflict (staff_a, staff_b) do nothing;

select 'RESULT far venues ' || (select string_agg(name, ', ') from venues where far) || ' · cars ' || (select count(*) from staff where active and transport = 'car')
  || ' · transit ' || (select count(*) from staff where active and transport = 'transit') || ' · links ' || (select count(*) from staff_links);
