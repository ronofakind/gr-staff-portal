-- 079 · AI on Today: "Waiting for your OK" / "Done today" (Nov 7, 2026 · AI plan step 1)
-- Two sources:
--   ✉ client emails  → written by the hourly Claude task through /api/ai (service key, checked against ai_settings.token)
--   ⚡ app changes    → written right away by a trigger when a booked person declines / cancels an upcoming shift
-- Nothing is applied by itself: Ronnie opens / approves each item. Admin only. Safe to run twice.
create table if not exists public.ai_items (
  id          uuid primary key default gen_random_uuid(),
  source      text not null check (source in ('email', 'app')),
  kind        text not null,               -- count_change · time_change · address · new_event · cancel · question · other · shift_cancelled
  dedupe_key  text unique,                 -- e.g. gmail message id + kind, or 'shift:<id>:cancelled'
  event_id    uuid references public.events(id) on delete set null,
  shift_id    uuid references public.shifts(id) on delete set null,
  staff_id    uuid references public.staff(id) on delete set null,
  who         text,                        -- "Dorothée · Cavarose"
  quote       text,                        -- one line from the email
  lines       jsonb not null default '[]', -- [{label, old?, new}]
  event_hint  text,                        -- "Thu Nov 19 · Théâtre Olympia" when no event matched / new event
  email_url   text,                        -- Gmail link to the thread
  sure        boolean not null default true,
  status      text not null default 'waiting' check (status in ('waiting', 'done', 'ignored')),
  done_note   text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists ai_items_status on public.ai_items (status, created_at desc);
alter table public.ai_items enable row level security;
drop policy if exists aii_admin on public.ai_items;
create policy aii_admin on public.ai_items for all to authenticated using (is_admin()) with check (is_admin());

-- live updates on Today
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'ai_items') then
    alter publication supabase_realtime add table public.ai_items;
  end if;
exception when others then null; end $$;

-- the hourly task's private key (checked by /api/ai) + when the inbox was last read
create table if not exists public.ai_settings (
  id          int primary key default 1 check (id = 1),
  token       text not null default md5(random()::text || clock_timestamp()::text) || md5(random()::text),
  inbox_checked_at timestamptz
);
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;
alter table public.ai_settings enable row level security;
drop policy if exists ais_admin_read on public.ai_settings;
create policy ais_admin_read on public.ai_settings for select to authenticated using (is_admin());

-- ⚡ a booked person declines or cancels an upcoming shift → item right away
create or replace function public.ai_track_shift_cancel() returns trigger
language plpgsql security definer set search_path = public as
$$ declare e events%rowtype; nm text; begin
  if not ((new.status = 'declined' and old.status = 'confirmed')
          or (new.cancelled_at is not null and old.cancelled_at is null)
          or (coalesce(new.attendance, '') = 'cancelled' and coalesce(old.attendance, '') <> 'cancelled')) then return null; end if;
  select * into e from events where id = new.event_id;
  if not found or e.event_date < (now() at time zone 'America/Toronto')::date then return null; end if;
  select coalesce(nullif(nickname, ''), full_name) into nm from staff where id = new.staff_id;
  insert into ai_items (source, kind, dedupe_key, event_id, shift_id, staff_id, who, lines)
  values ('app', 'shift_cancelled', 'shift:' || new.id || ':cancelled:' || to_char(now(), 'YYYYMMDDHH24MI'), e.id, new.id, new.staff_id, coalesce(nm, 'Someone'),
          jsonb_build_array(jsonb_build_object('label', 'Shift', 'new', to_char(e.event_date, 'Dy Mon FMDD') || ' · ' || coalesce(e.title, ''))))
  on conflict (dedupe_key) do nothing;
  return null;
end $$;
drop trigger if exists ai_shift_cancel on public.shifts;
create trigger ai_shift_cancel after update of status, cancelled_at, attendance on public.shifts
  for each row execute function public.ai_track_shift_cancel();

select 'RESULT ' || (select count(*) from pg_tables where tablename in ('ai_items', 'ai_settings')) || ' tables · '
    || (select count(*) from pg_trigger where tgname = 'ai_shift_cancel') || ' trigger' as result;
