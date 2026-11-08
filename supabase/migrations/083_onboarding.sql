-- 083 · New-hire onboarding: handbook by role + tax & pay (Nov 8, 2026 · push 56). Safe to run twice.
-- Only people accepted through Hiring get a row (current staff never see the handbook gate).

create table if not exists public.staff_onboarding (
  staff_id        uuid primary key references public.staff(id) on delete cascade,
  created_at      timestamptz not null default now(),
  level           text,                                  -- JUNIOR · MID · SENIOR
  handbook_roles  text[] not null default '{}',          -- floor · bar · busboy
  paid_by         text not null default 'payroll' check (paid_by in ('payroll', 'cash')),
  hb_seen         text[] not null default '{}',          -- handbook card ids read
  hb_total        int,                                   -- cards for their roles (the app writes it)
  hb_mandatory_at timestamptz,                           -- ☑ carry 3 plates · pour wine · hold a tray
  hb_done_at      timestamptz,                           -- ☑ I've read and agree → can get dates
  tax_done_at     timestamptz                            -- payroll only, before the first shift
);
alter table public.staff_onboarding enable row level security;
drop policy if exists ob_admin on public.staff_onboarding;
create policy ob_admin on public.staff_onboarding for all to authenticated using (is_admin()) with check (is_admin());
drop policy if exists ob_self_read on public.staff_onboarding;
create policy ob_self_read on public.staff_onboarding for select to authenticated using (staff_id = me());

-- Tax & pay. The staff writes it once (RPC); only the admin can read it back. The app never shows the SIN again.
create table if not exists public.staff_tax (
  staff_id      uuid primary key references public.staff(id) on delete cascade,
  legal_name    text not null,
  birthday      date,
  sin           text not null,
  address       text not null,
  pay_method    text not null check (pay_method in ('deposit', 'paypal')),
  paypal_email  text,
  cheque_path   text,
  updated_at    timestamptz not null default now()
);
alter table public.staff_tax enable row level security;
drop policy if exists tax_admin on public.staff_tax;
create policy tax_admin on public.staff_tax for all to authenticated using (is_admin()) with check (is_admin());

-- What the signed-in person sees about their own onboarding (null = not a new hire).
create or replace function public.my_onboarding()
returns jsonb language sql stable security definer set search_path = public as
$$ select case when o.staff_id is null then null else jsonb_build_object(
     'level', o.level, 'handbook_roles', to_jsonb(o.handbook_roles), 'paid_by', o.paid_by, 'hb_seen', to_jsonb(o.hb_seen),
     'hb_total', o.hb_total, 'hb_mandatory_at', o.hb_mandatory_at, 'hb_done_at', o.hb_done_at, 'tax_done_at', o.tax_done_at,
     'created_at', o.created_at,
     'tax_last4', (select right(regexp_replace(t.sin, '\D', '', 'g'), 3) from staff_tax t where t.staff_id = o.staff_id)) end
   from (select 1) one left join staff_onboarding o on o.staff_id = me() $$;
grant execute on function public.my_onboarding() to authenticated;

-- Handbook progress: cards read (added to the list), the mandatory tick, and the final agree.
create or replace function public.save_my_handbook(p_seen text[], p_total int, p_mandatory boolean, p_agree boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if me() is null then raise exception 'not staff'; end if;
  update staff_onboarding set
    hb_seen = (select array(select distinct x from unnest(hb_seen || coalesce(p_seen, '{}')) x where length(x) < 40)),
    hb_total = coalesce(p_total, hb_total),
    hb_mandatory_at = case when p_mandatory and hb_mandatory_at is null then now() else hb_mandatory_at end,
    hb_done_at = case when p_agree and hb_done_at is null then now() else hb_done_at end
  where staff_id = me();
end $$;
grant execute on function public.save_my_handbook(text[], int, boolean, boolean) to authenticated;

-- Tax & pay (payroll only).
create or replace function public.save_my_tax(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p->>'sin', ''), '\D', '', 'g');
begin
  if me() is null then raise exception 'not staff'; end if;
  if length(d) <> 9 then raise exception 'bad sin'; end if;
  if coalesce(trim(p->>'legal_name'), '') = '' or coalesce(trim(p->>'address'), '') = '' then raise exception 'missing'; end if;
  if (p->>'pay_method') not in ('deposit', 'paypal') then raise exception 'bad method'; end if;
  if coalesce(p->>'cheque_path', '') !~ ('^' || me()::text || '/') then raise exception 'cheque'; end if;
  insert into staff_tax (staff_id, legal_name, birthday, sin, address, pay_method, paypal_email, cheque_path, updated_at)
  values (me(), trim(p->>'legal_name'), nullif(p->>'birthday', '')::date, d, trim(p->>'address'), p->>'pay_method', nullif(trim(p->>'paypal_email'), ''), p->>'cheque_path', now())
  on conflict (staff_id) do update set legal_name = excluded.legal_name, birthday = excluded.birthday, sin = excluded.sin, address = excluded.address,
    pay_method = excluded.pay_method, paypal_email = excluded.paypal_email, cheque_path = excluded.cheque_path, updated_at = now();
  update staff_onboarding set tax_done_at = coalesce(tax_done_at, now()) where staff_id = me();
end $$;
grant execute on function public.save_my_tax(jsonb) to authenticated;

-- Void cheques: private bucket, each person uploads into their own folder; only the admin reads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tax-docs', 'tax-docs', false, 12582912, array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists taxdocs_own_insert on storage.objects;
create policy taxdocs_own_insert on storage.objects for insert to authenticated with check (bucket_id = 'tax-docs' and (storage.foldername(name))[1] = public.me()::text);
drop policy if exists taxdocs_admin_read on storage.objects;
create policy taxdocs_admin_read on storage.objects for select to authenticated using (bucket_id = 'tax-docs' and public.is_admin());

-- The test hire accepted before this existed (and anyone else accepted through Hiring) gets a row.
insert into public.staff_onboarding (staff_id, level, handbook_roles, paid_by, created_at)
select a.staff_id, a.level, a.handbook_roles, coalesce(a.paid_by, 'payroll'), coalesce(a.decided_at, now())
from public.applications a where a.status = 'accepted' and a.staff_id is not null
on conflict (staff_id) do nothing;
-- …and their neighbourhood + languages from the application (Accept did this only from the fix on).
insert into public.staff_private (staff_id, neighbourhood, languages)
select a.staff_id, nullif(trim(a.neighbourhood), ''), coalesce(case when a.lang_fr is not null and a.lang_en is not null then jsonb_build_object('fr', a.lang_fr, 'en', a.lang_en) end, '{}'::jsonb)
from public.applications a where a.status = 'accepted' and a.staff_id is not null
on conflict (staff_id) do update set neighbourhood = coalesce(staff_private.neighbourhood, excluded.neighbourhood),
  languages = case when coalesce(staff_private.languages, '{}'::jsonb) = '{}'::jsonb then excluded.languages else staff_private.languages end;

select 'RESULT ' || (select count(*) from pg_tables where tablename in ('staff_onboarding', 'staff_tax')) || ' tables · '
    || (select count(*) from public.staff_onboarding) || ' new hires' as result;
