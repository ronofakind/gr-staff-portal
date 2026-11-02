-- Push 34 (Nov 1): invite staff by text (personal one-use link, 7 days) · "Ask Ronnie for a new link" · usual week can be skipped.
-- File only: apply by hand in the SQL editor. Safe to run twice (if not exists / create or replace / drop … if exists).
-- Nothing existing is dropped except admin_checkup_overview(), recreated right away with one extra column (re-granted below).
--
-- What already existed and is reused:
--   staff.email / staff.auth_user_id + link_staff_login() trigger (001) → a new auth user is linked to its staff row by email
--   auth.users.encrypted_password (Supabase) → "✓ SIGNED IN" = they have chosen a sign-in code (push 31 stores it as the password)
--   staff.last_seen_at (036) · admin_checkup_overview() (036) · my_checkup() (036) · is_admin() / me() (001)
--   reset_requests (036) is NOT reused for "Ask Ronnie for a new link": its one-open-request-per-person index and the
--   Today query would mix code resets with invite requests → small table invite_requests (same pattern).
--
-- The invite sign-in itself happens in api/go.js with the service role key (SUPABASE_SERVICE_ROLE_KEY in Vercel).
-- The go_* functions below are executable by service_role only (never by anon / authenticated).

-- ───────── 34a · personal invite links ─────────
create table if not exists public.invite_links (
  token       text primary key check (token ~ '^[A-Za-z0-9_-]{10,64}$'),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  sent_at     timestamptz,             -- "Copy text" pressed → Invited · <date>; expires_at restarts at +7 days
  used_at     timestamptz,             -- the link signed them in (works once)
  revoked_at  timestamptz              -- a newer link was sent (Resend) → this one dies
);
create index if not exists invite_links_staff on public.invite_links (staff_id, created_at desc);
comment on table public.invite_links is 'push 34 · /go/<token> personal sign-in link. Valid = used_at, revoked_at null and expires_at > now(). Admin only (RLS); api/go.js reads it through go_* functions with the service role.';
alter table public.invite_links enable row level security;
drop policy if exists admin_all on public.invite_links;
create policy admin_all on public.invite_links for all using (is_admin()) with check (is_admin());
revoke all on public.invite_links from anon;
grant select, insert, update, delete on public.invite_links to authenticated;   -- RLS: admin only

-- "Ask Ronnie for a new link" (expired / used link screen) → Needs you card "{name}'s invite link expired · Resend".
create table if not exists public.invite_requests (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  uuid references public.staff(id) on delete set null
);
create unique index if not exists invite_requests_one_open on public.invite_requests (staff_id) where handled_at is null;  -- one open request per person
alter table public.invite_requests enable row level security;
drop policy if exists admin_all on public.invite_requests;
create policy admin_all on public.invite_requests for all using (is_admin()) with check (is_admin());
revoke all on public.invite_requests from anon;
grant select, insert, update, delete on public.invite_requests to authenticated;  -- RLS: admin only; staff go through request_new_invite()

-- ───────── 34d · usual week skipped in the check-up ─────────
alter table public.staff_private add column if not exists usual_week_skipped_at timestamptz;
comment on column public.staff_private.usual_week_skipped_at is 'push 34 · "Skip for now" on check-up step 5. Cleared when a day is turned on (trigger on staff_weekly) or Next / Done with all days off.';

-- ───────── admin RPCs ─────────
-- The link for the Invite pop-up. Reuses this person's newest link that was never sent (pop-up opened and closed
-- without copying), else makes a new one. Opening the pop-up never kills a link already sent: the old one only dies
-- when the new text is copied (admin_mark_invited), so closing a "Resend" pop-up changes nothing.
create or replace function public.admin_invite_link(p_staff uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare st staff%rowtype; l invite_links%rowtype; tok text;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select * into st from staff where id = p_staff;
  if st.id is null or not st.active then raise exception 'not an active staff member'; end if;
  if nullif(trim(coalesce(st.email, '')), '') is null then raise exception 'no email'; end if;
  select * into l from invite_links
   where staff_id = p_staff and sent_at is null and used_at is null and revoked_at is null and expires_at > now() + interval '1 day'
   order by created_at desc limit 1;
  if l.token is null then
    -- 12 URL-safe characters from two random UUIDs (~70 random bits). One-use + 7 days.
    loop
      tok := left(translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), '+/=', '-_'), 12);
      exit when not exists (select 1 from invite_links where token = tok);
    end loop;
    insert into invite_links (token, staff_id, created_by) values (tok, p_staff, me()) returning * into l;
  end if;
  return jsonb_build_object('token', l.token, 'expires_at', l.expires_at);
end $$;

-- "Copy text" → Invited · <date>. Starts the 7 days, kills every other link of this person (Resend),
-- and closes their open "Ask Ronnie for a new link" request.
create or replace function public.admin_mark_invited(p_token text)
returns timestamptz language plpgsql volatile security definer set search_path = public as
$$ declare sid uuid; t timestamptz := now();
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update invite_links set sent_at = t, expires_at = t + interval '7 days'
   where token = p_token and used_at is null and revoked_at is null
   returning staff_id into sid;
  if sid is null then raise exception 'link not found or already used'; end if;
  update invite_links set revoked_at = t where staff_id = sid and token <> p_token and used_at is null and revoked_at is null;
  update invite_requests set handled_at = t, handled_by = me() where staff_id = sid and handled_at is null;
  return t;
end $$;

-- App status per person for Admin → Staff (chips, counts, Invite / Resend).
--   code_set  = they have chosen a sign-in code (an auth password exists) → ✓ SIGNED IN
--   invite_*  = their newest SENT link (never-copied drafts don't count as invited)
create or replace function public.admin_invite_overview()
returns table (staff_id uuid, has_login boolean, code_set boolean, last_sign_in_at timestamptz, last_seen_at timestamptz,
               invite_sent_at timestamptz, invite_expires_at timestamptz, invite_used_at timestamptz, invite_revoked_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query
  select s.id, (u.id is not null), coalesce(u.encrypted_password, '') <> '', u.last_sign_in_at, s.last_seen_at,
         il.sent_at, il.expires_at, il.used_at, il.revoked_at
    from staff s
    left join auth.users u on u.id = s.auth_user_id
    left join lateral (select x.sent_at, x.expires_at, x.used_at, x.revoked_at from invite_links x
                        where x.staff_id = s.id and x.sent_at is not null order by x.sent_at desc limit 1) il on true;
end $$;

-- ───────── public RPC (expired / used link screen, not signed in) ─────────
-- "Ask Ronnie for a new link". The token proves who is asking; any token that ever existed works (expired, used,
-- replaced). Always returns 'ok' (no way to probe tokens). One open request per person.
create or replace function public.request_new_invite(p_token text)
returns text language plpgsql volatile security definer set search_path = public as
$$ declare sid uuid;
begin
  select l.staff_id into sid from invite_links l join staff s on s.id = l.staff_id
   where l.token = coalesce(p_token, '') and s.active;
  if sid is not null then
    insert into invite_requests (staff_id) values (sid) on conflict (staff_id) where handled_at is null do nothing;
  end if;
  return 'ok';
end $$;

-- ───────── service-role RPCs (api/go.js only) ─────────
-- Peek: who the link is for and whether it still works. Never consumes it (link previews / crawlers are harmless).
create or replace function public.go_invite_peek(p_token text)
returns jsonb language sql stable security definer set search_path = public as
$$ select coalesce((
    select jsonb_build_object(
      'state', case when not s.active then 'unknown' when l.used_at is not null then 'used'
                    when l.revoked_at is not null or l.expires_at <= now() then 'expired' else 'ok' end,
      'name', coalesce(nullif(s.nickname, ''), split_part(s.full_name, ' ', 1)),
      'email', lower(s.email))
      from invite_links l join staff s on s.id = l.staff_id where l.token = p_token),
    jsonb_build_object('state', 'unknown')) $$;

-- Claim: marks used_at atomically (works once). Returns what the server needs to sign them in, or null.
create or replace function public.go_invite_claim(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as
$$ declare sid uuid; r jsonb;
begin
  update invite_links set used_at = now()
   where token = p_token and used_at is null and revoked_at is null and expires_at > now()
   returning staff_id into sid;
  if sid is null then return null; end if;
  select jsonb_build_object('staff_id', s.id, 'email', lower(s.email), 'auth_user_id', s.auth_user_id) into r
    from staff s where s.id = sid and s.active and nullif(trim(coalesce(s.email, '')), '') is not null;
  if r is null then update invite_links set used_at = null where token = p_token; end if;
  return r;
end $$;

-- Undo a claim when the server could not finish (the person can tap the same link again).
create or replace function public.go_invite_unclaim(p_token text)
returns void language sql volatile security definer set search_path = public as
$$ update invite_links set used_at = null where token = p_token and used_at > now() - interval '5 minutes' $$;

-- Same linking as link_staff_login() (001), for an auth user that already existed under that email but was never linked.
create or replace function public.go_link_login(p_staff uuid, p_uid uuid)
returns void language sql volatile security definer set search_path = public as
$$ update staff set auth_user_id = p_uid
    where id = p_staff and auth_user_id is null
      and not exists (select 1 from staff o where o.auth_user_id = p_uid) $$;

-- ───────── 34d · usual week: skipped flag ─────────
-- "Skip for now" (true) · Next / Done with all days off (false).
create or replace function public.set_usual_week_skipped(p_skipped boolean)
returns void language plpgsql security definer set search_path = public as
$$ declare sid uuid := me();
begin
  if sid is null then raise exception 'not signed in'; end if;
  insert into staff_private (staff_id) values (sid) on conflict (staff_id) do nothing;
  update staff_private set usual_week_skipped_at = case when p_skipped then coalesce(usual_week_skipped_at, now()) else null end
   where staff_id = sid;
end $$;

-- Turning on any day (check-up, Availability, Home card) clears it.
create or replace function public.usual_week_set() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if new.status <> 'no' then
    update staff_private set usual_week_skipped_at = null where staff_id = new.staff_id and usual_week_skipped_at is not null;
  end if;
  return new;
end $$;
drop trigger if exists staff_weekly_clears_skip on public.staff_weekly;
create trigger staff_weekly_clears_skip after insert or update on public.staff_weekly
  for each row execute function public.usual_week_set();

-- my_checkup (036) + usual_week_skipped_at (same signature → create or replace).
create or replace function public.my_checkup()
returns jsonb language sql stable security definer set search_path = public as
$$ select case when me() is null then null else jsonb_build_object(
     'step',                  coalesce(sp.checkup_step, 1),
     'done_at',               sp.checkup_done_at,
     'emergency_name',        sp.emergency_name,
     'emergency_relation',    sp.emergency_relation,
     'emergency_phone',       sp.emergency_phone,
     'neighbourhood',         sp.neighbourhood,
     'languages',             coalesce(sp.languages, '{}'::jsonb),
     'usual_week_skipped_at', sp.usual_week_skipped_at) end
   from (select 1) one left join staff_private sp on sp.staff_id = me() $$;

-- Tracker: + usual_week_skipped ("Skipped usual week n"). Return type changes → drop + create.
drop function if exists public.admin_checkup_overview();
create function public.admin_checkup_overview()
returns table (staff_id uuid, checkup_done_at timestamptz, checkup_step int, has_emergency boolean, last_seen_at timestamptz, last_sign_in_at timestamptz, usual_week_skipped boolean)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query
  select s.id, sp.checkup_done_at, coalesce(sp.checkup_step, 1)::int, (sp.emergency_phone is not null), s.last_seen_at, u.last_sign_in_at,
         (sp.usual_week_skipped_at is not null)
    from staff s
    left join staff_private sp on sp.staff_id = s.id
    left join auth.users u on u.id = s.auth_user_id
   where s.active;
end $$;

-- ───────── grants ─────────
revoke all on function public.admin_invite_link(uuid) from public;
revoke all on function public.admin_mark_invited(text) from public;
revoke all on function public.admin_invite_overview() from public;
revoke all on function public.request_new_invite(text) from public;
revoke all on function public.go_invite_peek(text) from public, anon, authenticated;
revoke all on function public.go_invite_claim(text) from public, anon, authenticated;
revoke all on function public.go_invite_unclaim(text) from public, anon, authenticated;
revoke all on function public.go_link_login(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_usual_week_skipped(boolean) from public;
revoke all on function public.usual_week_set() from public;
revoke all on function public.my_checkup() from public;
revoke all on function public.admin_checkup_overview() from public;
grant execute on function public.admin_invite_link(uuid) to authenticated;
grant execute on function public.admin_mark_invited(text) to authenticated;
grant execute on function public.admin_invite_overview() to authenticated;
grant execute on function public.request_new_invite(text) to anon, authenticated;
grant execute on function public.go_invite_peek(text) to service_role;
grant execute on function public.go_invite_claim(text) to service_role;
grant execute on function public.go_invite_unclaim(text) to service_role;
grant execute on function public.go_link_login(uuid, uuid) to service_role;
grant execute on function public.set_usual_week_skipped(boolean) to authenticated;
grant execute on function public.my_checkup() to authenticated;
grant execute on function public.admin_checkup_overview() to authenticated;

-- ───────── check ─────────
select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('invite_links', 'invite_requests')) tables_2,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'staff_private' and column_name = 'usual_week_skipped_at') skip_col_1,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('admin_invite_link', 'admin_mark_invited', 'admin_invite_overview',
          'request_new_invite', 'go_invite_peek', 'go_invite_claim', 'go_invite_unclaim', 'go_link_login', 'set_usual_week_skipped', 'usual_week_set')) rpcs_10,
       (public.go_invite_peek('nope-nope-nope'))->>'state' unknown_token,
       (select count(*) from public.staff where active and auth_user_id is null) active_without_login;
