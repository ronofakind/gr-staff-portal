-- Push 33 (Nov 1): Confirm my shift (24 h window) · G&R calendar (subscription feed) · nickname · shift changed after
-- confirming · admin confirmation tracker · check-up calendar step + "A note from Ronnie".
-- Safe to run twice (if not exists / create or replace / drop … if exists). Nothing existing is dropped except the two
-- small plan RPCs (plan_people, my_section_team) that are recreated right away with an extra nickname column.
--
-- What already existed and is reused:
--   shifts.status booked / confirmed / declined + respond_to_shift()  (001)  → Confirm
--   shifts.notified_at = "confirmations sent" from admin Day / Send confirmations (002) → starts the 24 h window
--   shifts.changed_at (002) only says *that* something changed, not what it was → 33f needs the old values (change_prev)
--   staff.nickname (013) → the nickname itself (no new column)
--   push 28 change records (shift_change_requests, 034) are the person's own requests, not admin changes → not reused

-- ───────── 33a · 24 h confirm window ─────────
alter table public.shifts add column if not exists confirm_sent_at timestamptz;  -- when the final confirm request went out
alter table public.shifts add column if not exists confirm_by timestamptz;       -- confirm_sent_at + 24 h (nothing is auto-cancelled)
comment on column public.shifts.confirm_sent_at is 'push 33 · set once, when confirmations were sent (notified_at) and the details are final (event not details_pending, shift not time_tbc).';

-- Starts the window: the first time confirmations go out with final details, or the moment the details become final
-- on a shift that was already sent. A re-send after a change keeps the first time.
create or replace function public.shift_confirm_window() returns trigger
language plpgsql security definer set search_path = public as
$$ declare pend boolean; became_final boolean; sent_now boolean;
begin
  if new.status = 'booked' and new.confirm_sent_at is null and new.notified_at is not null and not coalesce(new.time_tbc, false) then
    sent_now := tg_op = 'INSERT' or new.notified_at is distinct from old.notified_at;
    became_final := tg_op = 'UPDATE' and coalesce(old.time_tbc, false);
    if sent_now or became_final then
      select coalesce(e.details_pending, false) into pend from events e where e.id = new.event_id;
      if not coalesce(pend, false) then
        new.confirm_sent_at := case when sent_now then new.notified_at else now() end;
      end if;
    end if;
  end if;
  if new.confirm_sent_at is not null and (new.confirm_by is null or new.confirm_sent_at is distinct from old.confirm_sent_at) then
    new.confirm_by := new.confirm_sent_at + interval '24 hours';
  end if;
  return new;
end $$;
-- (tg_op = 'INSERT' → old is null; "is distinct from old.x" is then simply true)
drop trigger if exists shifts_confirm_window on public.shifts;
create trigger shifts_confirm_window before insert or update on public.shifts for each row execute function public.shift_confirm_window();

-- Event: "Place and time to come" unticked → every already-sent booked shift with a set time starts its 24 h now.
-- (EventForm then clears shifts.time_tbc, which the shift trigger above also catches.)
create or replace function public.event_details_final() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if coalesce(old.details_pending, false) and not coalesce(new.details_pending, false) then
    update shifts set confirm_sent_at = now()
     where event_id = new.id and status = 'booked' and confirm_sent_at is null and notified_at is not null and not coalesce(time_tbc, false);
  end if;
  return null;
end $$;
drop trigger if exists events_details_final on public.events;
create trigger events_details_final after update on public.events for each row execute function public.event_details_final();

-- Backfill: people who are booked today on a future shift whose confirmations were already sent (final details) get a
-- fresh 24 h from the moment this migration runs. Using notified_at would make most of them "Overdue · 50 h" the
-- minute the push goes live, for a countdown they have never seen. Past shifts and confirmed shifts are left null.
update public.shifts s set confirm_sent_at = now()
  from public.events e
 where e.id = s.event_id and s.status = 'booked' and s.attendance is null and s.notified_at is not null
   and s.confirm_sent_at is null and not coalesce(e.details_pending, false) and not coalesce(s.time_tbc, false)
   and s.planned_start > now();

-- ───────── 33f · shift changed after confirming ─────────
alter table public.shifts add column if not exists change_prev jsonb;                    -- {start, position, place, address} before the change
alter table public.shifts add column if not exists changed_after_confirm_at timestamptz;
alter table public.shifts add column if not exists change_seen_at timestamptz;           -- "Got it"
comment on column public.shifts.change_prev is 'push 33f · values before a change to a confirmed shift; the gold box shows while change_seen_at is null. Keeps the oldest unseen values (several changes before Got it → one box, from the original).';

create or replace function public.shift_track_change() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if old.status = 'confirmed' and new.status = 'confirmed' and new.attendance is null
     and (new.planned_start is distinct from old.planned_start or new.event_id is distinct from old.event_id
          or coalesce(nullif(new.position_detail, ''), new.position_code) is distinct from coalesce(nullif(old.position_detail, ''), old.position_code)) then
    if new.change_prev is null or new.change_seen_at is not null then
      new.change_prev := (select jsonb_build_object('start', old.planned_start, 'position', coalesce(nullif(old.position_detail, ''), old.position_code),
                                 'place', coalesce(v.name, e.title), 'address', coalesce(e.address, v.address))
                            from events e left join venues v on v.id = e.venue_id where e.id = old.event_id);
    end if;
    new.change_seen_at := null;
    new.changed_after_confirm_at := now();
  end if;
  return new;
end $$;
drop trigger if exists shifts_track_change on public.shifts;
create trigger shifts_track_change before update on public.shifts for each row execute function public.shift_track_change();

-- Place changes live on the event (address / venue / title).
create or replace function public.event_track_place() returns trigger
language plpgsql security definer set search_path = public as
$$ declare oplace text; oaddr text;
begin
  if new.address is distinct from old.address or new.venue_id is distinct from old.venue_id or new.title is distinct from old.title then
    select coalesce(v.name, old.title), coalesce(old.address, v.address) into oplace, oaddr
      from (select 1) one left join venues v on v.id = old.venue_id;
    update shifts s
       set change_prev = case when s.change_prev is null or s.change_seen_at is not null
                              then jsonb_build_object('start', s.planned_start, 'position', coalesce(nullif(s.position_detail, ''), s.position_code), 'place', oplace, 'address', oaddr)
                              else s.change_prev end,
           change_seen_at = null, changed_after_confirm_at = now()
     where s.event_id = new.id and s.status = 'confirmed' and s.attendance is null;
  end if;
  return null;
end $$;
drop trigger if exists events_track_place on public.events;
create trigger events_track_place after update on public.events for each row execute function public.event_track_place();

create or replace function public.shift_change_seen(p_shift uuid) returns void
language sql security definer set search_path = public as
$$ update shifts set change_seen_at = now() where id = p_shift and staff_id = me() and change_seen_at is null $$;

-- ───────── 33b · G&R calendar (one private subscription per person) ─────────
-- Own table, not staff.*: staff rows are readable by teammates and managers (staff_teammates / manager_team policies),
-- so a secret token on staff would leak to them.
create table if not exists public.staff_calendar (
  staff_id       uuid primary key references public.staff(id) on delete cascade,
  token          uuid not null default gen_random_uuid(),
  added_at       timestamptz,       -- tapped "Add to my calendar" (we can't see the phone; this is the best signal)
  prompt_seen_at timestamptz,       -- "ONE MORE THING" shown once to people who had already finished the check-up
  created_at     timestamptz not null default now()
);
create unique index if not exists staff_calendar_token on public.staff_calendar (token);
alter table public.staff_calendar enable row level security;
drop policy if exists admin_all on public.staff_calendar;
drop policy if exists own_read on public.staff_calendar;
create policy admin_all on public.staff_calendar for all using (is_admin()) with check (is_admin());
create policy own_read on public.staff_calendar for select using (staff_id = me());
grant select on public.staff_calendar to authenticated;
grant insert, update, delete on public.staff_calendar to authenticated;   -- RLS: admin only; staff go through the RPCs

create or replace function public.my_calendar() returns json
language plpgsql security definer set search_path = public as
$$ declare sid uuid := me(); r staff_calendar;
begin
  if sid is null then return null; end if;
  insert into staff_calendar (staff_id) values (sid) on conflict (staff_id) do nothing;
  select * into r from staff_calendar where staff_id = sid;
  return json_build_object('token', r.token, 'added_at', r.added_at, 'prompt_seen_at', r.prompt_seen_at);
end $$;

create or replace function public.calendar_added() returns void
language sql security definer set search_path = public as
$$ update staff_calendar set added_at = now(), prompt_seen_at = coalesce(prompt_seen_at, now()) where staff_id = me() $$;

create or replace function public.calendar_prompt_seen() returns void
language sql security definer set search_path = public as
$$ update staff_calendar set prompt_seen_at = coalesce(prompt_seen_at, now()) where staff_id = me() $$;

-- New secret link (the old subscription stops updating). Own, or anyone's for the admin.
create or replace function public.reset_calendar_token(p_staff uuid default null) returns uuid
language plpgsql security definer set search_path = public as
$$ declare sid uuid := coalesce(p_staff, me()); t uuid := gen_random_uuid();
begin
  if sid is null or (sid <> me() and not is_admin()) then raise exception 'not allowed'; end if;
  insert into staff_calendar (staff_id, token) values (sid, t)
    on conflict (staff_id) do update set token = excluded.token, added_at = null;
  return t;
end $$;

-- The feed (called by /api/feed with the anon key, like cal_event). Only confirmed shifts with final details.
create or replace function public.calendar_feed(p_token uuid) returns json
language sql stable security definer set search_path = public as
$$ select case when c.staff_id is null then null else json_build_object(
     'staff_id', c.staff_id,
     'shifts', coalesce((select json_agg(x order by x.start) from (
        select s.id as uid, s.planned_start as start, e.event_date,
               coalesce(v.name, e.title) as venue, coalesce(e.address, v.address, '') as address,
               coalesce(nullif(s.position_detail, ''), s.position_code, '') as role, s.position_code as code,
               coalesce(s.uniform, case when s.position_code in ('BM','BT','BB')
                  then (case when me.sex = 'f' then coalesce(e.uniform_bar_w, e.uniform_bar) else e.uniform_bar end)
                  else (case when me.sex = 'f' then coalesce(e.uniform_floor_w, e.uniform_floor) else e.uniform_floor end) end) as uniform,
               coalesce(e.dress_code, '') as dress,
               ct.full_name as md_name, ct.phone as md_phone,
               greatest(s.changed_at, coalesce(s.changed_after_confirm_at, s.changed_at), coalesce(s.responded_at, s.changed_at)) as updated
          from shifts s join events e on e.id = s.event_id
          left join venues v on v.id = e.venue_id
          left join lateral (
            select st.full_name, st.phone from (
              select m.staff_id, case m.position_code when 'MD' then 1 else 2 end as pr from shifts m
               where m.event_id = e.id and m.position_code in ('MD','BM') and m.status <> 'declined' and m.attendance is null
              union all select e.manager_id, 3 where e.manager_id is not null) k
            join staff st on st.id = k.staff_id order by k.pr limit 1) ct on true
         where s.staff_id = c.staff_id and s.status = 'confirmed' and s.attendance is null
           and not coalesce(e.details_pending, false) and not coalesce(s.time_tbc, false)
           and s.planned_start > now() - interval '60 days') x), '[]'::json)) end
   from (select 1) one
   left join staff_calendar c on c.token = p_token
   left join staff me on me.id = c.staff_id
  where me.id is null or me.active $$;

-- ───────── 33d · nickname ─────────
create table if not exists public.nickname_changes (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  old_nickname text,
  new_nickname text,                -- null = cleared (the app uses their first name)
  changed_at   timestamptz not null default now(),
  seen_at      timestamptz,         -- admin tapped OK
  by_admin     boolean not null default false
);
create index if not exists nickname_changes_open on public.nickname_changes (changed_at) where seen_at is null;
alter table public.nickname_changes enable row level security;
drop policy if exists admin_all on public.nickname_changes;
create policy admin_all on public.nickname_changes for all using (is_admin()) with check (is_admin());
grant select, update on public.nickname_changes to authenticated;   -- RLS: admin only

-- Letters only (Latin letters with accents), spaces, hyphens, apostrophes · 2 to 15 characters · starts with a letter.
-- Same rule as NICK_RE in src/lib/nickname.ts.
create or replace function public.nickname_ok(p text) returns boolean
language sql immutable as
$$ select p is not null and p ~ '^[A-Za-zÀ-ÖØ-öø-ÿĀ-ž][A-Za-zÀ-ÖØ-öø-ÿĀ-ž'' ’-]{1,14}$' $$;

-- staff.nickname is not in the staff column grants (001/006), so staff can only change it here.
create or replace function public.set_my_nickname(p_nickname text) returns text
language plpgsql security definer set search_path = public as
$$ declare sid uuid := me(); v text := nullif(regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g'), ''); old text;
begin
  if sid is null then raise exception 'not signed in'; end if;
  if v is not null and not nickname_ok(v) then
    raise exception 'Please use a real name you go by, letters only (no numbers, symbols or emojis).';
  end if;
  select nickname into old from staff where id = sid;
  if old is not distinct from v then return v; end if;
  update staff set nickname = v where id = sid;
  insert into nickname_changes (staff_id, old_nickname, new_nickname) values (sid, old, v);
  return v;
end $$;

-- Admin "Edit / reset" (empty = back to the first name). Logged as already seen.
create or replace function public.admin_set_nickname(p_staff uuid, p_nickname text) returns text
language plpgsql security definer set search_path = public as
$$ declare v text := nullif(regexp_replace(btrim(coalesce(p_nickname, '')), '\s+', ' ', 'g'), ''); old text;
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if v is not null and not nickname_ok(v) then raise exception 'Letters only, 2 to 15 characters.'; end if;
  select nickname into old from staff where id = p_staff;
  if not found then raise exception 'no such person'; end if;
  if old is not distinct from v then return v; end if;
  update staff set nickname = v where id = p_staff;
  update nickname_changes set seen_at = coalesce(seen_at, now()) where staff_id = p_staff and seen_at is null;
  insert into nickname_changes (staff_id, old_nickname, new_nickname, seen_at, by_admin) values (p_staff, old, v, now(), true);
  return v;
end $$;

create or replace function public.admin_nickname_changes() returns json
language sql stable security definer set search_path = public as
$$ select coalesce(json_agg(json_build_object('id', n.id, 'staff_id', n.staff_id, 'full_name', st.full_name, 'old_nickname', n.old_nickname,
          'new_nickname', n.new_nickname, 'changed_at', n.changed_at) order by n.changed_at desc), '[]'::json)
     from nickname_changes n join staff st on st.id = n.staff_id
    where n.seen_at is null and is_admin() $$;

create or replace function public.admin_nickname_seen(p_id uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'admin only'; end if;
  update nickname_changes set seen_at = now() where id = p_id and seen_at is null;
end $$;

-- Section / side lists on the staff plan page: nickname next to the name (return type changes → drop + create).
drop function if exists public.my_section_team(uuid);
create function public.my_section_team(p_shift uuid)
returns table(full_name text, nickname text, photo_url text) language sql stable security definer set search_path = public as
$$ select st.full_name, st.nickname, st.photo_url
     from shifts mine join shifts s on s.event_id = mine.event_id and s.id <> mine.id
     join staff st on st.id = s.staff_id
    where mine.id = p_shift and (mine.staff_id = me() or is_admin())
      and s.plan->>'section' is not null and s.plan->>'section' = mine.plan->>'section'
      and s.status <> 'declined' and s.attendance is null
    order by st.full_name $$;
drop function if exists public.plan_people(uuid, uuid[]);
create function public.plan_people(p_shift uuid, p_ids uuid[])
returns table(id uuid, full_name text, nickname text, photo_url text) language sql stable security definer set search_path = public as
$$ select st.id, st.full_name, st.nickname, st.photo_url from staff st
    where st.id = any(p_ids)
      and exists (select 1 from shifts mine where mine.id = p_shift and (mine.staff_id = me() or is_admin())) $$;

-- ───────── 33h · check-up: calendar step (8) + note from Ronnie (9); 7 stays "Done" ─────────
-- New screens get new ids so everyone already at checkup_step = 7 (done) stays done.
alter table public.staff_private drop constraint if exists staff_private_checkup_step_check;
alter table public.staff_private add constraint staff_private_checkup_step_check check (checkup_step between 1 and 9);
create or replace function public.set_checkup_step(p_step int, p_done boolean default false)
returns void language plpgsql security definer set search_path = public as
$$ declare sid uuid := me();
begin
  if sid is null then raise exception 'not signed in'; end if;
  if p_step < 1 or p_step > 9 then raise exception 'bad step'; end if;
  insert into staff_private (staff_id) values (sid) on conflict (staff_id) do nothing;
  update staff_private set checkup_step = p_step,
         checkup_done_at = case when p_done then coalesce(checkup_done_at, now()) else checkup_done_at end
   where staff_id = sid;
end $$;

-- Settings → Profile check-up: "G&R calendar step" (Can skip / Required). Staff read it, so it joins the whitelist.
drop policy if exists staff_read on public.app_settings;
create policy staff_read on public.app_settings for select to authenticated using (key in (
  'bookings.running_late', 'bookings.new_tag_shifts', 'hours.min', 'hours.rounding',
  'mgr.feedback', 'mgr.undo', 'mgr.start_from_h',
  'checkup.emergency', 'checkup.home_screen', 'checkup.calendar', 'signin.code', 'signin.ask_reset'));

-- ───────── grants ─────────
revoke all on function public.shift_change_seen(uuid) from public;
revoke all on function public.my_calendar() from public;
revoke all on function public.calendar_added() from public;
revoke all on function public.calendar_prompt_seen() from public;
revoke all on function public.reset_calendar_token(uuid) from public;
revoke all on function public.calendar_feed(uuid) from public;
revoke all on function public.set_my_nickname(text) from public;
revoke all on function public.admin_set_nickname(uuid, text) from public;
revoke all on function public.admin_nickname_changes() from public;
revoke all on function public.admin_nickname_seen(uuid) from public;
grant execute on function public.shift_change_seen(uuid) to authenticated;
grant execute on function public.my_calendar() to authenticated;
grant execute on function public.calendar_added() to authenticated;
grant execute on function public.calendar_prompt_seen() to authenticated;
grant execute on function public.reset_calendar_token(uuid) to authenticated;
grant execute on function public.calendar_feed(uuid) to anon, authenticated;
grant execute on function public.set_my_nickname(text) to authenticated;
grant execute on function public.admin_set_nickname(uuid, text) to authenticated;
grant execute on function public.admin_nickname_changes() to authenticated;
grant execute on function public.admin_nickname_seen(uuid) to authenticated;
grant execute on function public.my_section_team(uuid) to authenticated;
grant execute on function public.plan_people(uuid, uuid[]) to authenticated;
grant execute on function public.set_checkup_step(int, boolean) to authenticated;

-- Quick check after running:
select count(*) filter (where confirm_sent_at is not null and status = 'booked') as booked_with_24h_window,
       count(*) filter (where confirm_by < now() and status = 'booked') as overdue_now
  from public.shifts;
