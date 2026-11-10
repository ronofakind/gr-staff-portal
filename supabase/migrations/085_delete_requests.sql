-- 085 · Delete my account (App Store + Google Play rule) · mapped with Ronnie Nov 8–9, 2026 (board DeleteAccountV1)
--
-- Staff ASK (in the app, or on the public page /delete-account); Ronnie CONFIRMS on Today → Needs you.
-- Nothing is ever deleted on its own.
--
-- Ronnie's "Delete account" (admin_delete_staff):
--   • deletes: sign-in link, photo, phone, email, nickname, sizes, emergency contact, neighbourhood, languages,
--     availability (dates, usual week, days off), calendar link, phone alerts, their own message threads with Ronnie,
--     messages they sent anywhere, unseen alerts
--   • keeps (tax law, 6 years): shifts, punches, hours, pay periods, invoices, staff_tax (legal name + SIN for the T4A)
--   • the staff row stays (past events / payroll need it), renamed "Former staff · M. C.", inactive, deleted_at set;
--     the real name is kept admin-only in staff_private.former_name for the pay records
--   • refused while they still have upcoming shifts (replace them first)
-- The auth user itself is removed by /api/go (removeLogin) (needs the service role key), right after.

alter table public.staff         add column if not exists deleted_at timestamptz;
alter table public.staff_private add column if not exists former_name text;

create table if not exists public.delete_requests (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid references public.staff(id) on delete set null,   -- null = web request that matched nobody
  source        text not null check (source in ('app', 'web')),
  email         text,          -- web only: what they typed
  phone         text,          -- web only
  matched       boolean not null default true,  -- web: email AND phone matched one active staff member
  reason        text,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,   -- they changed their mind (app)
  handled_at    timestamptz,
  handled_by    uuid references public.staff(id) on delete set null,
  outcome       text check (outcome in ('deleted', 'closed')),
  auth_user_id  uuid           -- set by admin_delete_staff so /api/go (removeLogin) knows which sign-in to remove
);
create unique index if not exists delete_requests_one_open_staff on public.delete_requests (staff_id)
  where handled_at is null and cancelled_at is null and staff_id is not null;
create unique index if not exists delete_requests_one_open_email on public.delete_requests (lower(email))
  where handled_at is null and cancelled_at is null and email is not null;
alter table public.delete_requests enable row level security;
drop policy if exists admin_all on public.delete_requests;
create policy admin_all on public.delete_requests for all using (is_admin()) with check (is_admin());
revoke all on public.delete_requests from anon;
grant select, insert, update, delete on public.delete_requests to authenticated;   -- RLS: admin only; staff use the RPCs

-- ───────── staff side (in the app) ─────────
create or replace function public.my_delete_request()
returns timestamptz language sql stable security definer set search_path = public as
$$ select created_at from delete_requests
   where staff_id = me() and handled_at is null and cancelled_at is null order by created_at desc limit 1 $$;

create or replace function public.request_my_deletion(p_reason text default null)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare sid uuid := me(); t timestamptz;
begin
  if sid is null then raise exception 'not signed in'; end if;
  select created_at into t from delete_requests where staff_id = sid and handled_at is null and cancelled_at is null;
  if t is not null then return t; end if;
  insert into delete_requests (staff_id, source, reason) values (sid, 'app', nullif(left(trim(coalesce(p_reason, '')), 500), ''))
  returning created_at into t;
  return t;
end $$;

create or replace function public.cancel_my_deletion()
returns void language sql security definer set search_path = public as
$$ update delete_requests set cancelled_at = now()
   where staff_id = me() and handled_at is null and cancelled_at is null $$;

grant execute on function public.my_delete_request() to authenticated;
grant execute on function public.request_my_deletion(text) to authenticated;
grant execute on function public.cancel_my_deletion() to authenticated;

-- ───────── public page /delete-account (no sign-in) ─────────
-- Always answers the same way (never says whether the email exists). One open request per email.
create or replace function public.public_delete_request(p_email text, p_phone text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as
$$ declare e text := lower(trim(coalesce(p_email, ''))); d text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10); sid uuid;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(d) < 10 then raise exception 'Check your email and phone number'; end if;
  select s.id into sid from staff s
   where s.active and s.deleted_at is null and lower(s.email) = e
     and right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 10) = d
   limit 1;
  if sid is not null and exists (select 1 from delete_requests where staff_id = sid and handled_at is null and cancelled_at is null) then return; end if;
  insert into delete_requests (staff_id, source, email, phone, matched, reason)
  values (sid, 'web', left(e, 200), left(trim(p_phone), 40), sid is not null, nullif(left(trim(coalesce(p_reason, '')), 500), ''))
  on conflict do nothing;
end $$;
grant execute on function public.public_delete_request(text, text, text) to anon, authenticated;

-- ───────── Ronnie ─────────
-- Close a request without deleting (web request that matched nobody, or sorted out by phone).
create or replace function public.admin_close_delete_request(p_request uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'admins only'; end if;
  update delete_requests set handled_at = now(), handled_by = me(), outcome = 'closed' where id = p_request and handled_at is null;
end $$;
grant execute on function public.admin_close_delete_request(uuid) to authenticated;

create or replace function public.admin_delete_staff(p_staff uuid, p_request uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare s staff%rowtype; au uuid; initials text; nxt text;
begin
  if not is_admin() then raise exception 'admins only'; end if;
  select * into s from staff where id = p_staff for update;
  if not found then raise exception 'staff not found'; end if;
  if s.role = 'admin' then raise exception 'An admin account can''t be deleted here'; end if;
  if s.deleted_at is not null then return null; end if;
  select string_agg(distinct to_char(e.event_date, 'Mon DD') || ' · ' || e.title, ', ') into nxt
    from shifts sh join events e on e.id = sh.event_id
   where sh.staff_id = p_staff and sh.status <> 'declined' and e.event_date >= (now() at time zone 'America/Toronto')::date;
  if nxt is not null then raise exception 'Still booked: %. Replace them first.', nxt; end if;

  au := s.auth_user_id;
  initials := coalesce((select string_agg(left(w, 1) || '.', ' ') from unnest(regexp_split_to_array(trim(s.full_name), '\s+')) w where w <> ''), '');

  insert into staff_private (staff_id) values (p_staff) on conflict (staff_id) do nothing;
  update staff_private set former_name = coalesce(former_name, s.full_name),
         emergency_name = null, emergency_relation = null, emergency_phone = null,
         neighbourhood = null, languages = '{}'::jsonb
   where staff_id = p_staff;

  update staff set full_name = 'Former staff · ' || initials, nickname = null, email = null, phone = null, photo_url = null,
         shirt_size = null, pants_size = null, shoe_size = null, dress_size = null, transport = null,
         auth_user_id = null, active = false, deleted_at = now()
   where id = p_staff;

  delete from availability      where staff_id = p_staff;
  delete from avail_exceptions  where staff_id = p_staff;
  delete from days_off          where staff_id = p_staff;
  delete from staff_weekly      where staff_id = p_staff;
  delete from staff_calendar    where staff_id = p_staff;
  delete from push_subscriptions where staff_id = p_staff;
  delete from alert_prefs       where staff_id = p_staff;
  delete from staff_alerts      where staff_id = p_staff;
  delete from team_chat_reads   where staff_id = p_staff;
  delete from messages          where sender_id = p_staff;
  delete from conversations     where staff_id = p_staff and kind = 'ronnie';
  delete from invite_links      where staff_id = p_staff;

  update delete_requests set handled_at = now(), handled_by = me(), outcome = 'deleted', auth_user_id = au
   where (id = p_request or (staff_id = p_staff and handled_at is null and cancelled_at is null)) and handled_at is null;
  if p_request is null and au is not null then
    insert into delete_requests (staff_id, source, handled_at, handled_by, outcome, auth_user_id) values (p_staff, 'app', now(), me(), 'deleted', au);
  end if;
  insert into change_log (by_staff, entity, entity_id, change) values (me(), 'staff', p_staff, jsonb_build_object('account_deleted', true));
  return au;   -- the sign-in /api/go (removeLogin) removes next
end $$;
grant execute on function public.admin_delete_staff(uuid, uuid) to authenticated;

-- /api/go (removeLogin) checks this with the caller's own token before removing a sign-in.
create or replace function public.admin_can_remove_login(p_auth uuid)
returns boolean language sql stable security definer set search_path = public as
$$ select is_admin()
     and exists (select 1 from delete_requests where auth_user_id = p_auth and outcome = 'deleted')
     and not exists (select 1 from staff where auth_user_id = p_auth) $$;
grant execute on function public.admin_can_remove_login(uuid) to authenticated;

select 'RESULT ' ||
  (select count(*) from pg_tables where tablename = 'delete_requests') || ' table · ' ||
  (select count(*) from pg_proc where proname in ('my_delete_request','request_my_deletion','cancel_my_deletion','public_delete_request','admin_close_delete_request','admin_delete_staff','admin_can_remove_login')) || ' functions' as result;
