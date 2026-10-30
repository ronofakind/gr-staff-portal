-- Push 19 (Oct 30): end time per line (in events.staffing, no schema change), MD list, Drive folder default per client,
-- preload additions, cash / QuickBooks link, guests + event type, Google Drive connection.

-- 19b · MD list: people booked as MD Aug–Oct 2026, most-booked first (Ronnie left off; Michael LeBlanc removed)
alter table public.staff add column if not exists md_rank integer;
update public.staff set md_rank = null;
update public.staff s set md_rank = v.r, positions = case when 'MD' = any(s.positions) then s.positions else array_append(s.positions, 'MD') end
from (values ('Georges Mourad', 1), ('Isaac Brouse-Lillini', 2), ('Benjamin Outre', 3), ('Marcel Mardini', 4), ('Nicholas Lamonica', 5),
             ('Maxence Mauplat', 6), ('Philipp Rodionov', 7), ('Maxime De Castelbajac', 8)) v(n, r)
where s.full_name = v.n;
update public.staff set positions = array_remove(positions, 'MD') where full_name ilike 'Michael Leblanc';

-- 19c · Drive folder default per client (new clients ON)
alter table public.clients add column if not exists drive_folder_default boolean not null default true;
update public.clients set drive_folder_default = false
 where name in ('Diane Piche', 'Christophe Bourrat', 'Debbie Cons', 'Mickey Cons', 'Helen Cons', 'Michelle Cola', 'Randi Cola', 'Negar', 'Chanel');

-- 19d · Preload additions
insert into public.clients (name, kind, address, drive_folder_default)
select v.name, 'private_home', v.address, false from (values
  ('Randi Cola', '46 Heath Rd, Hampstead, QC H3X 3L4'), ('Moshe', '92 Hampstead Rd, Hampstead, QC H3X 1K6')) v(name, address)
where not exists (select 1 from public.clients c where lower(c.name) = lower(v.name));
insert into public.clients (name) select 'Yossi' where not exists (select 1 from public.clients where name = 'Yossi');
update public.venues set usual_client_id = (select id from public.clients where name = 'Yossi') where name = 'Le Andover';
insert into public.clients (name, kind)
select v.name, 'roaming' from (values ('The Event Agency (T.E.A)'), ('Total Events')) v(name)
where not exists (select 1 from public.clients c where lower(c.name) = lower(v.name));

-- 19e · How the client pays + QuickBooks link
alter table public.event_private add column if not exists pay_method text not null default 'invoice' check (pay_method in ('invoice', 'cash'));
alter table public.event_private add column if not exists qb_doc_type text check (qb_doc_type in ('estimate', 'invoice'));
alter table public.event_private add column if not exists qb_doc_number text;
alter table public.event_private add column if not exists cash_received_at timestamptz;
alter table public.event_private add column if not exists qb_removed_at timestamptz;

-- 19f · Guests + event type
alter table public.events add column if not exists guests integer;
alter table public.events add column if not exists event_type text;
create table if not exists public.event_types (
  name text primary key,
  sort integer not null default 100,
  main boolean not null default false
);
alter table public.event_types enable row level security;
drop policy if exists admin_all on public.event_types;
create policy admin_all on public.event_types for all using (is_admin()) with check (is_admin());
insert into public.event_types (name, sort, main) values
  ('Wedding · cocktail dînatoire', 1, true), ('Wedding · sit-down', 2, true), ('Corporate · cocktail dînatoire', 3, true),
  ('Corporate · sit-down dinner', 4, true), ('Private house', 5, true), ('Bat mitzvah', 6, true), ('Bar mitzvah', 7, true),
  ('Fundraiser', 20, false), ('Corporate lunch', 21, false), ('Buffet', 22, false), ('Brunch / breakfast', 23, false),
  ('Holiday dinner (Rosh Hashanah, Passover, Sukkot…)', 24, false), ('Funeral / shiva', 25, false), ('Baptism', 26, false),
  ('Bris', 27, false), ('Birthday', 28, false), ('Engagement party', 29, false), ('BBQ', 30, false), ('Tasting', 31, false),
  ('Conference / registration', 32, false), ('Launch / awards', 33, false), ('Concert / festival', 34, false), ('Set-up', 40, false)
on conflict (name) do nothing;
-- Set-ups (stock moves, room set-up): staff see no uniform and no "be there" time
update public.events set event_type = 'Set-up' where title = 'Le Andover - stock move';

-- 19g · Google Drive connection. Tokens never reach a browser: tables have RLS with no policies, and the server
-- (Vercel /api) reads the refresh token only with a key derived from GOOGLE_CLIENT_SECRET, which clients never see.
create table if not exists public.google_connection (
  id boolean primary key default true check (id),
  email text, refresh_token text, server_key_hash text,
  connected_by uuid references public.staff(id) on delete set null, connected_at timestamptz
);
alter table public.google_connection enable row level security;
create table if not exists public.google_oauth_state (
  state text primary key, staff_id uuid, created_at timestamptz not null default now()
);
alter table public.google_oauth_state enable row level security;
create table if not exists public.event_files_hidden (
  event_id uuid not null references public.events(id) on delete cascade,
  file_id text not null, primary key (event_id, file_id)
);
alter table public.event_files_hidden enable row level security;
drop policy if exists admin_all on public.event_files_hidden;
drop policy if exists mgr_read on public.event_files_hidden;
create policy admin_all on public.event_files_hidden for all using (is_admin()) with check (is_admin());
create policy mgr_read on public.event_files_hidden for select using (manages(event_id));

-- Admin starts the Google consent: a one-time state
create or replace function public.google_begin() returns text language plpgsql security definer set search_path = public as
$$ declare s text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); begin
  if not is_admin() then raise exception 'not allowed'; end if;
  delete from google_oauth_state where created_at < now() - interval '1 hour';
  insert into google_oauth_state(state, staff_id) values (s, me());
  return s;
end $$;
grant execute on function public.google_begin() to authenticated;

-- Callback (server, anon key): store the refresh token for a valid state. First connection sets the server key.
create or replace function public.google_store(p_state text, p_email text, p_refresh text, p_key_hash text) returns boolean
language plpgsql security definer set search_path = public as
$$ declare who uuid; cur text; begin
  delete from google_oauth_state where state = p_state and created_at > now() - interval '1 hour' returning staff_id into who;
  if who is null then return false; end if;
  select server_key_hash into cur from google_connection where id;
  if cur is not null and cur <> p_key_hash then return false; end if;
  insert into google_connection(id, email, refresh_token, server_key_hash, connected_by, connected_at)
  values (true, p_email, p_refresh, p_key_hash, who, now())
  on conflict (id) do update set email = excluded.email, refresh_token = coalesce(excluded.refresh_token, google_connection.refresh_token),
    server_key_hash = excluded.server_key_hash, connected_by = excluded.connected_by, connected_at = now();
  return true;
end $$;
grant execute on function public.google_store(text, text, text, text) to anon, authenticated;

-- Server only (needs the key): refresh token for an admin, or for the MD/BM of an event (file list only)
create or replace function public.google_token(p_key_hash text, p_event uuid default null) returns text
language plpgsql stable security definer set search_path = public as
$$ declare g google_connection; begin
  select * into g from google_connection where id;
  if g.refresh_token is null or g.server_key_hash is distinct from p_key_hash then return null; end if;
  if is_admin() or (p_event is not null and manages(p_event)) then return g.refresh_token; end if;
  return null;
end $$;
grant execute on function public.google_token(text, uuid) to authenticated;

-- What the admin screen may know: connected as … (no token)
create or replace function public.google_status() returns json language sql stable security definer set search_path = public as
$$ select case when is_admin() then (select json_build_object('email', email, 'connected_at', connected_at) from google_connection where id and refresh_token is not null) end $$;
grant execute on function public.google_status() to authenticated;
create or replace function public.google_disconnect() returns void language plpgsql security definer set search_path = public as
$$ begin if not is_admin() then raise exception 'not allowed'; end if; update google_connection set refresh_token = null, email = null where id; end $$;
grant execute on function public.google_disconnect() to authenticated;

-- 19h · Women's bar uniform defaults to the black cocktail dress
update public.venues set uniform_bar_w = 'dress' where uniform_bar_w is null;
update public.clients set uniform_bar_w = 'dress' where uniform_bar_w is null;
