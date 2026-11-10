-- Push 44 (Nov 3, 2026) · Go-live: Events sheet → app "Sheet changes".
-- The Events-sheet script posts what the EVENTS tab says (today → +60 days) every 10 minutes.
-- The app compares it with its own events and shows each difference on Today as a card (Approve / Ignore).
-- Nothing in the app changes from here on its own. Additive only: two new tables + one function.

-- What the sheet says, one row per event block per department (replaced on every post for the dates posted).
create table if not exists public.sheet_events (
  id          bigserial primary key,
  event_date  date not null,
  department  text not null check (department in ('floor','bar')),
  title       text not null,            -- the block's name row (often the client, e.g. BRERA)
  venue       text,                     -- "Venue: …" / "Location: …" detail, if any
  address     text,                     -- "Address: …" detail, if any
  details     text[] not null default '{}',
  lines       jsonb not null default '[]',  -- [{code, start "HH:MM", count}]
  staff       jsonb not null default '[]',  -- [{name, code, start "HH:MM", row}]
  sheet_row   int,                      -- row of the date line in EVENTS
  posted_at   timestamptz not null default now()
);
create index if not exists sheet_events_date on public.sheet_events(event_date);
alter table public.sheet_events enable row level security;
drop policy if exists admin_read on public.sheet_events;
create policy admin_read on public.sheet_events for select using (is_admin());

-- Last post (so Today can say "sheet checked 4 min ago").
create table if not exists public.sheet_sync_runs (
  id bigserial primary key, posted_at timestamptz not null default now(), date_from date, date_to date, blocks int
);
alter table public.sheet_sync_runs enable row level security;
drop policy if exists admin_read on public.sheet_sync_runs;
create policy admin_read on public.sheet_sync_runs for select using (is_admin());

-- Names in the sheet that Ronnie matched to a staff member once ("J-P" → Jean-Philippe Roy), used from then on.
create table if not exists public.sheet_name_alias (
  alias     text primary key,           -- normalised: upper case, no accents, single spaces
  staff_id  uuid not null references public.staff(id) on delete cascade,
  added_at  timestamptz not null default now()
);
alter table public.sheet_name_alias enable row level security;
drop policy if exists admin_all on public.sheet_name_alias;
create policy admin_all on public.sheet_name_alias for all using (is_admin()) with check (is_admin());

-- The script's post (same sheet_token check as hours_sheet). Replaces what we had for p_from..p_to.
create or replace function public.sheet_events_post(p_token text, p_from date, p_to date, p_events jsonb)
returns int language plpgsql security definer set search_path = public as
$$ declare n int; begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'sheet_token') then raise exception 'not allowed'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 120 then raise exception 'bad dates'; end if;
  delete from sheet_events where event_date between p_from and p_to;
  insert into sheet_events(event_date, department, title, venue, address, details, lines, staff, sheet_row)
  select (x->>'date')::date, x->>'dept', coalesce(nullif(x->>'title',''), '?'), nullif(x->>'venue',''), nullif(x->>'address',''),
         coalesce(array(select jsonb_array_elements_text(coalesce(x->'details','[]'::jsonb))), '{}'),
         coalesce(x->'lines','[]'::jsonb), coalesce(x->'staff','[]'::jsonb), nullif(x->>'row','')::int
    from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) x
   where (x->>'date')::date between p_from and p_to and x->>'dept' in ('floor','bar');
  get diagnostics n = row_count;
  insert into sheet_sync_runs(date_from, date_to, blocks) values (p_from, p_to, n);
  delete from sheet_sync_runs where posted_at < now() - interval '3 days';
  return n;
end $$;
revoke all on function public.sheet_events_post(text, date, date, jsonb) from public;
grant execute on function public.sheet_events_post(text, date, date, jsonb) to anon, authenticated;

-- Check row
select (select count(*) from information_schema.tables where table_name in ('sheet_events','sheet_sync_runs','sheet_name_alias')) as tables_ok,
       (select count(*) from pg_proc where proname = 'sheet_events_post') as function_ok;
