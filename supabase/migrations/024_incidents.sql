-- Incident reports (Oct 30): managers report from the event page (typed and/or voice note + photos); Ronnie reviews in Admin → Incidents.
-- Staff never see incidents. Files live in a private bucket "incidents" under <event_id>/<incident_id>/...
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  reported_by uuid default public.me() references public.staff(id) on delete set null,
  kind text not null check (kind in ('injury', 'damage', 'guest', 'staff', 'client', 'other')),
  involved_staff uuid[] not null default '{}',
  involved_other text[] not null default '{}',   -- 'guest' | 'client'
  happened_at timestamptz,
  body text,
  audio_path text,
  audio_sec integer,
  photos text[] not null default '{}',
  status text not null default 'new' check (status in ('new', 'follow_up', 'reviewed')),
  admin_note text,
  in_reliability boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create index if not exists incidents_event on public.incidents (event_id);
create index if not exists incidents_status on public.incidents (status, created_at desc);
alter table public.incidents enable row level security;
drop policy if exists admin_all on public.incidents;
drop policy if exists mgr_read on public.incidents;
drop policy if exists mgr_insert on public.incidents;
create policy admin_all on public.incidents for all using (is_admin()) with check (is_admin());
create policy mgr_read on public.incidents for select using (manages(event_id));
create policy mgr_insert on public.incidents for insert with check (manages(event_id) and reported_by = me() and status = 'new' and admin_note is null);

-- Private bucket for voice notes + photos
insert into storage.buckets (id, name, public) values ('incidents', 'incidents', false) on conflict (id) do nothing;
drop policy if exists incidents_read on storage.objects;
drop policy if exists incidents_insert on storage.objects;
create policy incidents_read on storage.objects for select to authenticated
  using (bucket_id = 'incidents' and (public.is_admin() or public.manages(((storage.foldername(name))[1])::uuid)));
create policy incidents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'incidents' and (public.is_admin() or public.manages(((storage.foldername(name))[1])::uuid)));
