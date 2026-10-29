-- Admin push (Oct 29): venues + clients lists, staffing grid, Needs-you archive, note archive, admin time off.

-- ───────── Clients (admin only) ─────────
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  qb_customer text,
  rate_sets   jsonb not null default '[]',   -- [{key, label, rates:{BM,BT,BB}}]; 2+ sets → Billing card on the event form
  created_at  timestamptz not null default now()
);
alter table public.clients enable row level security;
drop policy if exists admin_all on public.clients;
create policy admin_all on public.clients for all using (is_admin()) with check (is_admin());

-- ───────── Venues: usual client + usual uniform ─────────
alter table public.venues add column if not exists usual_client_id uuid references public.clients(id) on delete set null;
alter table public.venues add column if not exists uniform_floor text;
alter table public.venues add column if not exists uniform_bar text;
alter table public.venues add column if not exists created_at timestamptz not null default now();

insert into public.clients(name, qb_customer, rate_sets) values
  ('Danielle Bitton', 'Danielle Bitton', '[]'),
  ('Traiteur Brera Inc.', 'Traiteur Brera Inc.', '[]'),
  ('La Nesra', 'La Nesra', '[{"key":"no_tips","label":"No tips (default)","rates":{"BM":42,"BT":37,"BB":35}},{"key":"tips","label":"Tips allowed","rates":{"BM":38,"BT":33.5,"BB":31.5}}]'),
  ('Christophe Bourrat', 'CHRISTOPHE BOURRAT', '[]'),
  ('Daniel Bilodeau', 'Daniel Bilodeau', '[]'),
  ('Diane Piche', 'Diane Piche', '[]')
on conflict (name) do nothing;

insert into public.venues(name, address) values
  ('Salon Richmond', '550 Avenue Richmond, Montréal, QC H3J 1V3'),
  ('Maison Principale', '870 Rue du Couvent, Montréal, QC H4C 2R6'),
  ('Entrepôt Dominion', '3968 Rue Saint-Ambroise, Montréal, QC H4C 2C7'),
  ('La Nesra', '2020 Rue William, Montréal, QC H3J 1R8'),
  ('Le Andover', '5870 Av. Andover, Mont-Royal, QC H4T 1H4'),
  ('Power Corp', '759 Square Victoria, Montréal (8th floor — ask security)'),
  ('Windsor Station', '1160 Av. des Canadiens-de-Montréal, Montréal, QC H3B 5E8'),
  ('Beatrice', null), ('BMO', null), ('Théâtre Olympia', null)
on conflict (name) do update set address = coalesce(public.venues.address, excluded.address);

update public.venues v set usual_client_id = c.id from public.clients c
 where v.usual_client_id is null and (v.name, c.name) in (
  ('Salon Richmond','Danielle Bitton'), ('Maison Principale','Traiteur Brera Inc.'), ('Entrepôt Dominion','Traiteur Brera Inc.'),
  ('La Nesra','La Nesra'), ('Power Corp','Christophe Bourrat'), ('Beatrice','Daniel Bilodeau'), ('BMO','Diane Piche'));
update public.venues set uniform_floor = 'black_tshirt' where name = 'Power Corp' and uniform_floor is null;

-- Link existing events to their venue by title.
update public.events e set venue_id = v.id from public.venues v where e.venue_id is null and lower(e.title) = lower(v.name);

-- ───────── Events: approximate end + staffing grid; billing choice (admin only) ─────────
alter table public.events add column if not exists ends_label text;              -- '~ midnight', 'late', '~ 11 PM'…
alter table public.events add column if not exists staffing jsonb not null default '[]'; -- [{role, code, start:'HH:MM', count}]
alter table public.event_private add column if not exists client_id uuid references public.clients(id) on delete set null;
alter table public.event_private add column if not exists rate_set text;

-- ───────── Today · Needs you archive (hide only; comes back when its signature changes) ─────────
create table if not exists public.admin_archive (
  key          text primary key,
  sig          text not null,
  label        text,
  archived_at  timestamptz not null default now(),
  archived_by  uuid
);
alter table public.admin_archive enable row level security;
drop policy if exists admin_all on public.admin_archive;
create policy admin_all on public.admin_archive for all using (is_admin()) with check (is_admin());

-- ───────── Hours · manager notes archive (never deleted) ─────────
alter table public.shifts add column if not exists note_archived_at timestamptz;
alter table public.shifts add column if not exists note_archived_by uuid;

-- ───────── Admin time off ─────────
alter table public.days_off add column if not exists added_by_admin boolean not null default false;
alter table public.days_off add column if not exists every_dow int check (every_dow between 0 and 6); -- weekly: 0 = Monday
create table if not exists public.days_off_private (
  day_off_id uuid primary key references public.days_off(id) on delete cascade,
  note       text
);
alter table public.days_off_private enable row level security;
drop policy if exists admin_all on public.days_off_private;
create policy admin_all on public.days_off_private for all using (is_admin()) with check (is_admin());

-- Admin can record booking changes (alerts go out later, item 9).
drop policy if exists admin_insert on public.change_log;
create policy admin_insert on public.change_log for insert with check (is_admin());
