-- Push 32 (Nov 1): Admin → More → Venues & clients (32a) + Settings (32b).
-- 32a: venue notes + venue photos (private Storage bucket "venue-photos"), client admin fee % and transport billing.
--      Edits apply to new events only: New event copies venue / client values when it is saved; existing events keep theirs.
-- 32b: app_settings (key → jsonb). The app falls back to today's values for any key that is missing.
--      RLS: admin writes; signed-in staff/managers read only the keys their screens need; signed-out only "signin.ask_reset".
--      Server-side rules that had a hard-coded number now read the setting (rounded_hours, set_my_pin_length,
--      request_pin_reset, staff_running_late). Same signatures, same grants.

-- ───────── 32a · venues ─────────
alter table public.venues add column if not exists venue_notes text;                 -- staff event page → Notes
alter table public.venues add column if not exists photos jsonb not null default '[]'; -- ["<venue id>/<file>.jpg", …] in bucket venue-photos

-- ───────── 32a · clients ─────────
alter table public.clients add column if not exists admin_fee_pct numeric not null default 10 check (admin_fee_pct >= 0 and admin_fee_pct <= 100);
alter table public.clients add column if not exists transport_billing text not null default 'client' check (transport_billing in ('client', 'gr'));
-- Invoice-builder rule: admin fee 10 % of the labour subtotal, Brera 8 %.
update public.clients set admin_fee_pct = 10 where name not ilike '%brera%';
update public.clients set admin_fee_pct = 8 where name ilike '%brera%';

-- ───────── 32a · venue photos (Storage) ─────────
insert into storage.buckets (id, name, public) values ('venue-photos', 'venue-photos', false) on conflict (id) do nothing;
drop policy if exists venue_photos_read on storage.objects;
drop policy if exists venue_photos_insert on storage.objects;
drop policy if exists venue_photos_update on storage.objects;
drop policy if exists venue_photos_delete on storage.objects;
create policy venue_photos_read on storage.objects for select to authenticated using (bucket_id = 'venue-photos');
create policy venue_photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'venue-photos' and public.is_admin());
create policy venue_photos_update on storage.objects for update to authenticated using (bucket_id = 'venue-photos' and public.is_admin());
create policy venue_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'venue-photos' and public.is_admin());

-- ───────── 32b · app_settings ─────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id) on delete set null
);
alter table public.app_settings enable row level security;
drop policy if exists admin_all on public.app_settings;
drop policy if exists staff_read on public.app_settings;
drop policy if exists anon_read on public.app_settings;
create policy admin_all on public.app_settings for all using (is_admin()) with check (is_admin());
-- Same list as STAFF_KEYS in src/lib/settings.ts.
create policy staff_read on public.app_settings for select to authenticated using (key in (
  'bookings.running_late', 'bookings.new_tag_shifts', 'hours.min', 'hours.rounding',
  'mgr.feedback', 'mgr.undo', 'mgr.start_from_h',
  'checkup.emergency', 'checkup.home_screen', 'signin.code', 'signin.ask_reset'));
-- The sign-in screen (not signed in yet) only needs to know whether to show "Ask Ronnie to reset".
create policy anon_read on public.app_settings for select to anon using (key = 'signin.ask_reset');
grant select on public.app_settings to anon, authenticated;
grant insert, update, delete on public.app_settings to authenticated;   -- RLS: admin only

create or replace function public.app_settings_stamp() returns trigger
language plpgsql security definer set search_path = public as
$$ begin new.updated_at := now(); new.updated_by := public.me(); return new; end $$;
drop trigger if exists app_settings_stamp on public.app_settings;
create trigger app_settings_stamp before insert or update on public.app_settings for each row execute function public.app_settings_stamp();

-- Today's values (the app uses the same defaults when a key is missing).
insert into public.app_settings (key, value) values
  ('ask.tiers',                '{"a": 8, "ab": 20}'),
  ('ask.how_many',             '"yes_rate"'),
  ('ask.big_date',             '25'),
  ('ask.hold_back',            '{"shifts": 7, "days": 30}'),
  ('ask.reply_by_days',        '2'),
  ('bookings.late_cancel',     '"after_confirmed"'),
  ('bookings.count_told_ahead','false'),
  ('bookings.running_late',    '"event_day"'),
  ('bookings.new_tag_shifts',  '3'),
  ('extras.rule',              '{"over": 7, "pct": 10}'),
  ('extras.default_billing',   '"gr"'),
  ('transport.office',         '"C-4865 rue Dagenais"'),
  ('transport.far_min',        '45'),
  ('transport.client_pays',    'true'),
  ('hours.min',                '4'),
  ('hours.rounding',           '15'),
  ('hours.show_money',         'false'),
  ('rank.tier',                '{"A": 100, "B": 60, "C": 30}'),
  ('rank.reliability',         '{"days": 90, "start": 6, "no_show": -3, "late_cancel": -2, "late": -1, "late_change": -1}'),
  ('rank.experience',          '{"SENIOR": 3, "MID": 2, "JUNIOR": 1}'),
  ('rank.feedback',            '{"s5": 1, "s4": 0.5, "s3": 0, "s2": -1, "s1": -2, "cap": 10}'),
  ('rank.extras',              '{"bmo": 2, "newStaff": -3, "priority": 20}'),
  ('mgr.feedback',             '"benjamin"'),
  ('mgr.announce_window',      '"day_before"'),
  ('mgr.undo',                 '"until_submitted"'),
  ('mgr.start_from_h',         '3'),
  ('checkup.emergency',        '"skip"'),
  ('checkup.home_screen',      '"skip"'),
  ('signin.code',              '"choose"'),
  ('signin.ask_reset',         'true')
on conflict (key) do nothing;

-- One setting for SQL functions (security definer: reads any key, whatever the caller).
create or replace function public.app_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public as
$$ select value from app_settings where key = p_key $$;
grant execute on function public.app_setting(text) to authenticated;

-- ───────── 32b · server rules that read a setting ─────────
-- Hours & pay → Minimum paid (4 h) and Rounding (15 min). Was immutable with 4 / 900 s hard-coded (019).
-- Left-early rows keep their own inline 15-min rounding in the payroll / sheet functions (not changed here).
create or replace function public.rounded_hours(p_in timestamptz, p_out timestamptz)
returns numeric language sql stable security definer set search_path = public as
$$ select case when p_in is null or p_out is null then null
               else greatest(x.min_h, round(extract(epoch from (p_out - p_in)) / (60 * x.r)) * x.r / 60.0) end
     from (select coalesce((app_setting('hours.min') #>> '{}')::numeric, 4) as min_h,
                  greatest(1, coalesce((app_setting('hours.rounding') #>> '{}')::numeric, 15)) as r) x $$;

-- Sign-in code → "6 digits for everyone" refuses new 4-digit codes (people with a 4-digit code keep signing in with it).
create or replace function public.set_my_pin_length(p_len int)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_len not in (4, 6) then raise exception 'bad length'; end if;
  if p_len = 4 and coalesce(app_setting('signin.code') #>> '{}', 'choose') = 'force6' then raise exception 'Codes are 6 digits now.'; end if;
  update staff set pin_length = p_len where id = me();
end $$;

-- "Ask Ronnie to reset" off → nothing is recorded (still returns 'ok': no way to probe which emails exist).
create or replace function public.request_pin_reset(p_email text)
returns text language plpgsql volatile security definer set search_path = public as
$$ declare sid uuid;
begin
  if coalesce((app_setting('signin.ask_reset') #>> '{}')::boolean, true) is false then return 'ok'; end if;
  select id into sid from staff where lower(email) = lower(trim(coalesce(p_email, ''))) and active limit 1;
  if sid is not null then
    insert into reset_requests (staff_id) values (sid) on conflict (staff_id) where handled_at is null do nothing;
  end if;
  return 'ok';
end $$;

-- Bookings & changes → Running-late button "Off" refuses new notices (034 body otherwise unchanged).
create or replace function public.staff_running_late(p_shift uuid, p_minutes int, p_eta timestamptz, p_reason text default null, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; d date; pin timestamptz; rid uuid;
begin
  if coalesce(app_setting('bookings.running_late') #>> '{}', 'event_day') = 'off' then raise exception 'Text your manager instead.'; end if;
  select * into s from shifts where id = p_shift;
  if not found or s.staff_id is distinct from me() then raise exception 'not your shift'; end if;
  if s.status = 'declined' or s.attendance is not null then raise exception 'This shift is off your schedule.'; end if;
  select event_date into d from events where id = s.event_id;
  if d <> (now() at time zone 'America/Toronto')::date then raise exception 'Only on the day of the event.'; end if;
  select punch_in into pin from punches where shift_id = p_shift;
  if pin is not null then raise exception 'You have already started.'; end if;
  if p_reason is not null and p_reason not in ('Traffic', 'Metro / bus', 'Parking', 'Other') then raise exception 'bad reason'; end if;
  if p_eta is null or p_eta < now() - interval '5 minutes' or p_eta > s.planned_start + interval '6 hours' then raise exception 'Pick when you will get there.'; end if;
  insert into late_notices (shift_id, minutes, eta, reason, note)
  values (p_shift, greatest(1, coalesce(p_minutes, round(extract(epoch from (p_eta - s.planned_start)) / 60)::int)), p_eta, p_reason, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (shift_id) do update set minutes = excluded.minutes, eta = excluded.eta, reason = excluded.reason, note = excluded.note,
     sent_at = now(), seen_at = null, seen_by = null
  returning id into rid;
  return rid;
end $$;

-- ───────── grants (unchanged signatures; restated) ─────────
grant execute on function public.set_my_pin_length(int) to authenticated;
grant execute on function public.request_pin_reset(text) to anon, authenticated;
grant execute on function public.staff_running_late(uuid, int, timestamptz, text, text) to authenticated;

-- Check after applying
select (select count(*) from public.app_settings) as settings,
       (select count(*) from public.clients where admin_fee_pct = 8) as clients_at_8pct,
       (select count(*) from storage.buckets where id = 'venue-photos') as venue_bucket;
