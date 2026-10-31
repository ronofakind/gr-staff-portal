-- Push 23 (Oct 30): Bookings in practice mode. Extras, linked staff + conditions (from the Hub), practice drafts.
alter table public.events add column if not exists extras integer;              -- null = computed (10% of floor count when > 7)
alter table public.events add column if not exists extras_billing text check (extras_billing in ('gr', 'client'));
alter table public.clients add column if not exists extras_billing text not null default 'gr' check (extras_billing in ('gr', 'client'));

create table if not exists public.staff_links (
  staff_a uuid not null references public.staff(id) on delete cascade,
  staff_b uuid not null references public.staff(id) on delete cascade,
  kind text not null default 'together' check (kind in ('together')),
  primary key (staff_a, staff_b), check (staff_a < staff_b)
);
create table if not exists public.staff_conditions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  kind text not null check (kind in ('not_venue', 'min_guests', 'big_dates_only', 'only_if_needed', 'not_weekday')),
  value text, created_at timestamptz not null default now()
);
create table if not exists public.booking_drafts (
  admin_id uuid not null references public.staff(id) on delete cascade,
  for_date date not null, payload jsonb not null default '{}', updated_at timestamptz not null default now(),
  primary key (admin_id, for_date)
);
alter table public.staff_links enable row level security;
alter table public.staff_conditions enable row level security;
alter table public.booking_drafts enable row level security;
drop policy if exists admin_all on public.staff_links; create policy admin_all on public.staff_links for all using (is_admin()) with check (is_admin());
drop policy if exists admin_all on public.staff_conditions; create policy admin_all on public.staff_conditions for all using (is_admin()) with check (is_admin());
drop policy if exists own_admin on public.booking_drafts; create policy own_admin on public.booking_drafts for all using (is_admin() and admin_id = me()) with check (is_admin() and admin_id = me());

-- loose name match: first word + last word (Eva Schneiderlin = Eva-Michele-Marcy Schneiderlin)
create or replace function pg_temp.sid(n text) returns uuid language sql as $$
  select id from public.staff
   where active and (lower(full_name) = lower(n)
      or lower(full_name) like lower(split_part(split_part(n, ' ', 1), '-', 1)) || '%' || lower(regexp_replace(n, '^.* ', '')))
   order by (lower(full_name) = lower(n)) desc limit 1 $$;
insert into public.staff_links(staff_a, staff_b)
select least(a, b), greatest(a, b) from (select pg_temp.sid(x) a, pg_temp.sid(y) b from (values
('Adele Ledoux','Aurora Dyck'),
  ('Adele Ledoux','Grace Brigid Ohara'),
  ('Alicia Gonthier','David Berlinguet'),
  ('Amal Elghoul','Sophie Anna Maillard'),
  ('Ammar Al Zib','Chelsea Banago'),
  ('Ammar Al Zib','Trisha Banago'),
  ('Anais Turcotte','Yan Turcotte'),
  ('Anna Zatokova','Elika Khabibullina'),
  ('Anna Zatokova','Emiliya Khabibullina'),
  ('Arthur Brunel','Axel Matei Sigouin Melasco'),
  ('Arthur Brunel','Yan Turcotte'),
  ('Aurora Dyck','Grace Brigid Ohara'),
  ('Axel Matei Sigouin Melasco','Naima Vanina Sigouin-Melasco'),
  ('Baudouin Dragon','Loukhman Ali'),
  ('Brian Helou','Chelsea Banago'),
  ('Brian Helou','Meliha Molla'),
  ('Cameron Qayoom-Taylor','James Tilley'),
  ('Cassidy Debargis','Elliot Debargis'),
  ('Cassidy Debargis','Sophia Lianova'),
  ('Cassidy Debargis','Viktoriia Motlokhova'),
  ('Charlotte Ellis Olander','Claire Coates'),
  ('Chelsea Banago','Meliha Molla'),
  ('Chelsea Banago','Trisha Banago'),
  ('Clara Finnen','Isaac Brouse-Lillini'),
  ('Colombe Broudehoux','Jane Liagre'),
  ('Cynthia Mouvand','Louise Marie Annie Roze'),
  ('Daniel Tomov','Kamena Stoeva'),
  ('Elika Khabibullina','Emiliya Khabibullina'),
  ('Elodie Theriault','Emiliya Khabibullina'),
  ('Emiliya Khabibullina','Ryan Scully'),
  ('Eva Schneiderlin','Valentin Marsal'),
  ('Grace Brigid Ohara','Tess Isabel Crombeen'),
  ('Ilyes (Maxence)','Maxence Mauplat'),
  ('Ion Turcan','Traian Turcan'),
  ('Isaac Brouse-Lillini','Linnea Ernedal'),
  ('Isaac Brouse-Lillini','Samantha Van Wingen'),
  ('Isaac Brouse-Lillini','Zoe Brouse-Lillini'),
  ('Kamena Stoeva','Mila Georgieva'),
  ('Linnea Ernedal','Sydney Jane Ross'),
  ('Lucy Huart','Mahaut Nieuviarts'),
  ('Lyes Heulers','Yanis Heulers'),
  ('Marc Olivier Gelibet','Sara Gelibet'),
  ('Marcel Mardini','Paul-Mickael Mardini'),
  ('Maya Ashley Zucker','Megan Zucker'),
  ('Melanie Jobin','Virginie Jobin'),
  ('Naima Vanina Sigouin-Melasco','Raphael Bedart-Lamon')) v(x, y)) t where a is not null and b is not null and a <> b
on conflict do nothing;

delete from public.staff_conditions;
insert into public.staff_conditions(staff_id, kind, value)
select pg_temp.sid(n), k, v from (values
  ('Anais Turcotte', 'not_venue', 'Salon Richmond'), ('Louise Marie Annie Roze', 'min_guests', '150'),
  ('Bhreagh Macarthur', 'big_dates_only', null), ('Ilyes (Maxence)', 'big_dates_only', null), ('Jade Charest', 'big_dates_only', null),
  ('Maraya Rodriguez', 'big_dates_only', null), ('Matheo (Maxence)', 'big_dates_only', null), ('Maxence Mauplat', 'big_dates_only', null),
  ('Nina Berdzenishvili', 'big_dates_only', null), ('Pia-Marie Ladores', 'big_dates_only', null), ('Said Touahri', 'big_dates_only', null),
  ('Shamim Rahman', 'big_dates_only', null), ('Sophie Anna Maillard', 'big_dates_only', null), ('Jonathan De Sousa', 'only_if_needed', null),
  ('Robert-Jun Corpus', 'big_dates_only', null), ('Robert-Jun Corpus', 'not_weekday', 'Tue,Wed,Thu')
) v(n, k, v) where pg_temp.sid(n) is not null;

select (select count(*) from staff_links) links, (select count(*) from staff_conditions) conditions;
