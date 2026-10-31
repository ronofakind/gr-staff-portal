-- Push 31 (Oct 31): profile check-up for current staff · 4- or 6-digit code · Forgot your code / Ask Ronnie to reset.
-- File only: apply by hand in the SQL editor. Nothing is dropped; no existing RPC changes signature.
--
-- Where things live (checked before adding columns):
--   phone, email, photo_url        → public.staff (already; staff update phone/photo via the column grants in 001/006)
--   neighbourhood                  → NEW public.staff_private.neighbourhood (was nowhere; admin-only table, written by the staff via RPC)
--   emergency_name/relation/phone  → NEW public.staff_private (admin-only by RLS; staff write their own via RPC, never read others)
--   languages                      → public.staff_private.languages (032) · {fr:1..3, en:1..3}
--   checkup_done_at / checkup_step → NEW public.staff_private
--   pin_length                     → NEW public.staff.pin_length (4 | 6, default 6)
--   last_seen_at                   → NEW public.staff.last_seen_at (touched on app load; nothing like it existed)

-- ───────── 31a / 31b · check-up + profile fields (admin-only table) ─────────
alter table public.staff_private add column if not exists checkup_done_at timestamptz;
alter table public.staff_private add column if not exists checkup_step smallint not null default 1;   -- 1..6 = step they are on, 7 = Done screen
alter table public.staff_private add column if not exists emergency_name text;
alter table public.staff_private add column if not exists emergency_relation text;
alter table public.staff_private add column if not exists emergency_phone text;
alter table public.staff_private add column if not exists neighbourhood text;                           -- "Verdun" · no street address
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_private_emergency_relation_check') then
    alter table public.staff_private add constraint staff_private_emergency_relation_check
      check (emergency_relation is null or emergency_relation in ('Parent', 'Partner', 'Sibling', 'Friend', 'Other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'staff_private_checkup_step_check') then
    alter table public.staff_private add constraint staff_private_checkup_step_check check (checkup_step between 1 and 7);
  end if;
end $$;
comment on column public.staff_private.checkup_done_at is 'push 31 · profile check-up finished (Done screen reached). null = the full-screen check-up shows after sign-in.';
comment on column public.staff_private.emergency_phone is 'push 31 · admin only. Never returned to managers or other staff.';

-- ───────── 31d · code length + last seen ─────────
alter table public.staff add column if not exists pin_length smallint not null default 6;
alter table public.staff add column if not exists last_seen_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'staff_pin_length_check') then
    alter table public.staff add constraint staff_pin_length_check check (pin_length in (4, 6));
  end if;
end $$;

-- ───────── 31e · Ask Ronnie to reset ─────────
create table if not exists public.reset_requests (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references public.staff(id) on delete set null
);
create unique index if not exists reset_requests_one_open on public.reset_requests (staff_id) where handled_at is null;  -- rate limit: one open request per person
alter table public.reset_requests enable row level security;
drop policy if exists admin_all on public.reset_requests;
create policy admin_all on public.reset_requests for all using (is_admin()) with check (is_admin());
revoke all on public.reset_requests from anon;
grant select, insert, update, delete on public.reset_requests to authenticated;   -- RLS: admin only; staff go through request_pin_reset()

-- ───────── own-row RPCs (staff can't read staff_private under RLS) ─────────
-- What the check-up needs about me. Missing staff_private row → defaults (step 1, not done).
create or replace function public.my_checkup()
returns jsonb language sql stable security definer set search_path = public as
$$ select case when me() is null then null else jsonb_build_object(
     'step',               coalesce(sp.checkup_step, 1),
     'done_at',            sp.checkup_done_at,
     'emergency_name',     sp.emergency_name,
     'emergency_relation', sp.emergency_relation,
     'emergency_phone',    sp.emergency_phone,
     'neighbourhood',      sp.neighbourhood,
     'languages',          coalesce(sp.languages, '{}'::jsonb)) end
   from (select 1) one left join staff_private sp on sp.staff_id = me() $$;

-- Save my answers. Only the keys present in p_fields are written; '' clears a text field.
-- Keys: neighbourhood · emergency_name · emergency_relation · emergency_phone · languages ({fr,en} 1..3, nothing else)
create or replace function public.save_my_profile(p_fields jsonb)
returns void language plpgsql security definer set search_path = public as
$$ declare sid uuid := me(); l jsonb; k text;
begin
  if sid is null then raise exception 'not signed in'; end if;
  insert into staff_private (staff_id) values (sid) on conflict (staff_id) do nothing;
  if p_fields ? 'languages' then
    l := coalesce(p_fields->'languages', '{}'::jsonb);
    if jsonb_typeof(l) <> 'object' then raise exception 'bad languages'; end if;
    for k in select jsonb_object_keys(l) loop
      if k not in ('fr', 'en') or jsonb_typeof(l->k) <> 'number' or (l->>k)::numeric not in (1, 2, 3) then raise exception 'bad languages'; end if;
    end loop;
    update staff_private set languages = l where staff_id = sid;
  end if;
  if p_fields ? 'neighbourhood' then
    update staff_private set neighbourhood = left(nullif(trim(p_fields->>'neighbourhood'), ''), 60) where staff_id = sid;
  end if;
  if p_fields ? 'emergency_name' then
    update staff_private set emergency_name = left(nullif(trim(p_fields->>'emergency_name'), ''), 80) where staff_id = sid;
  end if;
  if p_fields ? 'emergency_relation' then
    update staff_private set emergency_relation = nullif(trim(p_fields->>'emergency_relation'), '') where staff_id = sid;  -- check constraint validates
  end if;
  if p_fields ? 'emergency_phone' then
    update staff_private set emergency_phone = left(nullif(trim(p_fields->>'emergency_phone'), ''), 30) where staff_id = sid;
  end if;
end $$;

-- Where I am in the check-up. p_done = true stamps checkup_done_at (once).
create or replace function public.set_checkup_step(p_step int, p_done boolean default false)
returns void language plpgsql security definer set search_path = public as
$$ declare sid uuid := me();
begin
  if sid is null then raise exception 'not signed in'; end if;
  if p_step < 1 or p_step > 7 then raise exception 'bad step'; end if;
  insert into staff_private (staff_id) values (sid) on conflict (staff_id) do nothing;
  update staff_private set checkup_step = p_step,
         checkup_done_at = case when p_done then coalesce(checkup_done_at, now()) else checkup_done_at end
   where staff_id = sid;
end $$;

-- My code length (after choosing / changing the code).
create or replace function public.set_my_pin_length(p_len int)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_len not in (4, 6) then raise exception 'bad length'; end if;
  update staff set pin_length = p_len where id = me();
end $$;

-- App opened (once per load) → "last opened" in the admin check-up tracker.
create or replace function public.touch_last_seen()
returns void language sql security definer set search_path = public as
$$ update staff set last_seen_at = now() where id = me() $$;

-- ───────── public RPCs (not signed in) ─────────
-- 4 or 6 dots on the sign-in screen. Unknown / inactive email → 6, so it reveals nothing beyond the dots.
create or replace function public.pin_length(p_email text)
returns int language sql stable security definer set search_path = public as
$$ select coalesce((select pin_length::int from staff where lower(email) = lower(trim(p_email)) and active limit 1), 6) $$;

-- "No access to that email? Ask Ronnie to reset". Inserts only when the email matches an active staff member
-- and they have no open request. Always returns 'ok' (no way to probe which emails exist). Nothing is emailed here.
create or replace function public.request_pin_reset(p_email text)
returns text language plpgsql volatile security definer set search_path = public as
$$ declare sid uuid;
begin
  select id into sid from staff where lower(email) = lower(trim(coalesce(p_email, ''))) and active limit 1;
  if sid is not null then
    insert into reset_requests (staff_id) values (sid) on conflict (staff_id) where handled_at is null do nothing;
  end if;
  return 'ok';
end $$;

-- ───────── admin · check-up tracker ─────────
-- last opened = the later of last_seen_at (this push on) and auth last_sign_in_at (needs security definer to read auth.users).
create or replace function public.admin_checkup_overview()
returns table (staff_id uuid, checkup_done_at timestamptz, checkup_step int, has_emergency boolean, last_seen_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query
  select s.id, sp.checkup_done_at, coalesce(sp.checkup_step, 1)::int, (sp.emergency_phone is not null), s.last_seen_at, u.last_sign_in_at
    from staff s
    left join staff_private sp on sp.staff_id = s.id
    left join auth.users u on u.id = s.auth_user_id
   where s.active;
end $$;

-- ───────── 31b step 2 · email change ─────────
-- The app calls supabase.auth.updateUser({ email }) (confirm link). auth.users.email only changes once the link is
-- confirmed, so the sign-in email (and staff.email) stay the old one until then. This keeps staff.email in step.
create or replace function public.sync_staff_email() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if new.email is distinct from old.email and new.email is not null then
    update staff set email = lower(new.email) where auth_user_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_staff_email();

-- ───────── grants ─────────
revoke all on function public.my_checkup() from public;
grant execute on function public.my_checkup() to authenticated;
revoke all on function public.save_my_profile(jsonb) from public;
grant execute on function public.save_my_profile(jsonb) to authenticated;
revoke all on function public.set_checkup_step(int, boolean) from public;
grant execute on function public.set_checkup_step(int, boolean) to authenticated;
revoke all on function public.set_my_pin_length(int) from public;
grant execute on function public.set_my_pin_length(int) to authenticated;
revoke all on function public.touch_last_seen() from public;
grant execute on function public.touch_last_seen() to authenticated;
revoke all on function public.admin_checkup_overview() from public;
grant execute on function public.admin_checkup_overview() to authenticated;
revoke all on function public.pin_length(text) from public;
grant execute on function public.pin_length(text) to anon, authenticated;
revoke all on function public.request_pin_reset(text) from public;
grant execute on function public.request_pin_reset(text) to anon, authenticated;
revoke all on function public.sync_staff_email() from public;

-- ───────── check ─────────
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'staff_private'
          and column_name in ('checkup_done_at', 'checkup_step', 'emergency_name', 'emergency_relation', 'emergency_phone', 'neighbourhood')) staff_private_cols_6,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'staff'
          and column_name in ('pin_length', 'last_seen_at')) staff_cols_2,
       (select count(*) from pg_tables where schemaname = 'public' and tablename = 'reset_requests') reset_table_1,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('my_checkup', 'save_my_profile', 'set_checkup_step',
          'set_my_pin_length', 'touch_last_seen', 'pin_length', 'request_pin_reset', 'admin_checkup_overview', 'sync_staff_email')) rpcs_9,
       public.pin_length('nobody@example.invalid') unknown_email_len_6,
       (select count(*) from public.staff where active) active_staff,
       (select count(*) from public.staff_private where checkup_done_at is not null) checkups_done_0;
