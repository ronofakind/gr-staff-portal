-- Push 18 (Oct 30): New event form v3 — private-home clients (client = venue), roaming clients,
-- uniform pieces on/off + extras per line, seed data from Events 2026.

-- Clients: private home (has an address + usual uniforms) or roaming (venue changes each time)
alter table public.clients add column if not exists kind text check (kind in ('private_home', 'roaming'));
alter table public.clients add column if not exists address text;
alter table public.clients add column if not exists uniform_floor text;
alter table public.clients add column if not exists uniform_bar text;
alter table public.clients add column if not exists uniform_floor_w text;
alter table public.clients add column if not exists uniform_bar_w text;
alter table public.clients add column if not exists uniform_items jsonb;

-- Uniform pieces per line: {"floor_m": {"on": [...], "off": [...], "extra": [...]}, "floor_w": ..., "bar_m": ..., "bar_w": ...}
alter table public.venues add column if not exists uniform_items jsonb;
alter table public.events add column if not exists uniform_items jsonb;

-- Seed: private homes
insert into public.clients (name, kind, address)
select v.name, 'private_home', v.address from (values
  ('Debbie Cons', '23 Applewood Cres, Hampstead, QC H3X 3V8'),
  ('Mickey Cons', '71 Rue Merton, Hampstead, QC H3X 1M6'),
  ('Helen Cons', '179 Rue Harland, Hampstead, QC H3X 3E7'),
  ('Michelle Cola', '23 Colchester Road, Hampstead, QC H3X 3V9'),
  ('Negar', '18 Av. Severn, Westmount, QC H3Y 2C7')
) v(name, address)
where not exists (select 1 from public.clients c where lower(c.name) = lower(v.name));

-- Beatrice is a client, not a venue
update public.clients set name = 'Daniel Bilodeau (Beatrice)', kind = 'roaming' where name = 'Daniel Bilodeau';
update public.events set venue_id = null where venue_id in (select id from public.venues where name = 'Beatrice');
delete from public.venues where name = 'Beatrice';

-- Clients whose venue changes each time
insert into public.clients (name, kind)
select v.name, 'roaming' from (values ('Chris Ranco'), ('Cavarose'), ('Beso "C"'), ('Chanel'), ('Emilie Waxman'), ('Lisa Sew')) v(name)
where not exists (select 1 from public.clients c where lower(c.name) = lower(v.name));

-- Venues: BMO address, MYO Club (new client Samantha Dulgar)
update public.venues set address = '129 Rue Saint-Jacques, 14th floor, Montréal, QC H2Y 1L6' where name = 'BMO' and address is null;
insert into public.clients (name) select 'Samantha Dulgar' where not exists (select 1 from public.clients where name = 'Samantha Dulgar');
insert into public.venues (name, address, usual_client_id)
select 'MYO Club', '653 Boul. Curé-Labelle, Sainte-Rose, Laval, QC H7L 5R7', (select id from public.clients where name = 'Samantha Dulgar')
where not exists (select 1 from public.venues where name = 'MYO Club');
