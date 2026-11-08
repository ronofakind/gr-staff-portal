-- 082 · Hiring: applications from the public apply page (Nov 8, 2026 · push 55). Safe to run twice.
-- Written only by /api/apply (service key). Read / decided by the admin. CVs in the private "applications" bucket.
create table if not exists public.applications (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  status        text not null default 'new' check (status in ('new', 'kept', 'accepted', 'rejected')),
  lang          text default 'en',
  first_name    text not null,
  last_name     text not null,
  email         text,
  phone         text,
  neighbourhood text,
  adult         boolean,
  roles         text[] not null default '{}',     -- waiter · bartender · barback · cook · manager
  worked_in     text[] not null default '{}',     -- fine_dining · banquets · catering · hotel · cocktail_bar · cafe · none
  years         text,                             -- none · lt1 · 1-2 · 3-5 · 5+
  lang_fr       int,                              -- 1 basic · 2 good · 3 fluent
  lang_en       int,
  days          text[] not null default '{}',     -- weekday_days · weekday_evenings · weekends · anytime
  transport     text,                             -- car · transit
  cv_path       text,
  cv_name       text,
  no_cv_note    text,
  referrer_id   uuid references public.staff(id) on delete set null,
  referrer_text text,
  note          text,
  consent_at    timestamptz,
  ai_summary    text,                             -- AI first read (hourly task)
  ai_level      text,                             -- JUNIOR · MID · SENIOR (suggested)
  ai_at         timestamptz,
  decided_at    timestamptz,
  level         text,
  start_rate    numeric(6,2),
  handbook_roles text[] not null default '{}',    -- floor · bar · busboy
  paid_by       text check (paid_by in ('payroll', 'cash')),
  admin_note    text,
  staff_id      uuid references public.staff(id) on delete set null
);
create index if not exists applications_status on public.applications (status, created_at desc);
create index if not exists applications_email on public.applications (lower(email));
alter table public.applications enable row level security;
drop policy if exists app_admin on public.applications;
create policy app_admin on public.applications for all to authenticated using (is_admin()) with check (is_admin());

-- live updates on Today
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'applications') then
    alter publication supabase_realtime add table public.applications;
  end if;
exception when others then null; end $$;

-- private CV bucket: only the admin can read; the API (service key) writes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('applications', 'applications', false, 12582912, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists applications_admin_read on storage.objects;
create policy applications_admin_read on storage.objects for select to authenticated using (bucket_id = 'applications' and public.is_admin());

select 'RESULT ' || (select count(*) from pg_tables where tablename = 'applications') || ' table · '
    || (select count(*) from storage.buckets where id = 'applications') || ' bucket' as result;
