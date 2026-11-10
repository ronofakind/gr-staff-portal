-- Push 38 (Nov 2): Meetings (Teams / Zoom / in-person meetings that aren't shifts) + meeting notes saved to the event.
-- File only: apply by hand in the SQL editor. Safe to run twice (if not exists / create or replace / drop … if exists).
--
-- Why separate tables (not an event of kind 'meeting'): every shift screen, count and feed reads events + shifts
-- (manager check-in, Bookings, Day, invoices / EXTRAS LOG, confirmations tracker, 24 h Confirm, Reliability, Who's free,
-- the calendar feed). A meeting kept in its own tables can never show up there by accident. Its paid time is added
-- to the hours paths on purpose instead:
--   · hours_sheet(…, p_meetings => true)  → the APP · <DATE> tab (block "MEETING · <title>", no 4 h minimum) → payroll
--   · meeting_hours()                      → staff Hours tab + admin Hours page (Ronnie edits them there)
-- Paid hours = the set length from the meeting start, for everyone who said Coming (no punch). Ronnie can change the
-- times or pay / not pay someone (meeting_invites.paid / paid_in / paid_out).
--
-- Nothing existing is dropped except hours_sheet(text, date), replaced by hours_sheet(text, date, boolean default false):
-- the deployed Events-sheet script keeps calling it with two arguments and gets exactly what it got before (+ kind = 'shift').
-- staff_alerts gets a meeting_id column and 4 more kinds (check constraint replaced, old kinds kept).
--
-- Reused: me() / is_admin() / manages() (001, 037) · staff_alerts + alert_seen (018) · messages_badge (042, counts
-- staff_alerts, unchanged) · staff_calendar tokens (039) · app_secrets sheet_token (015).
-- No cron: the morning reminder is written by meeting_morning_check() when the person opens the app that day.

-- ───────── tables ─────────
create table if not exists public.meetings (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  starts_at         timestamptz not null,
  duration_min      int not null default 60 check (duration_min between 15 and 480),
  place_kind        text not null default 'teams' check (place_kind in ('teams', 'zoom', 'in_person')),
  link              text,                       -- Teams / Zoom link
  address           text,                       -- in person
  about             text,                       -- "What it's about"
  notes_visibility  text not null default 'managers' check (notes_visibility in ('managers', 'team')),
  created_by        uuid references public.staff(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  cancelled_at      timestamptz,
  cancelled_by      uuid references public.staff(id) on delete set null
);
create index if not exists meetings_starts on public.meetings (starts_at);
comment on table public.meetings is 'push 38 · Teams / Zoom / in-person meetings (not shifts). Only managers are invited. Paid like a shift: the set length from the start, for invitees who said Coming (meeting_hours / hours_sheet).';
comment on column public.meetings.notes_visibility is 'push 38 · who sees the pinned notes on the linked event pages: managers (MD / BM / event manager) or the whole team.';

create table if not exists public.meeting_invites (
  meeting_id       uuid not null references public.meetings(id) on delete cascade,
  staff_id         uuid not null references public.staff(id) on delete cascade,
  answer           text check (answer in ('coming', 'cant')),   -- null = no answer
  answered_at      timestamptz,
  invited_at       timestamptz not null default now(),
  paid             boolean,       -- null = automatic (paid when Coming) · true / false = Ronnie decided
  paid_in          timestamptz,   -- null = meeting start
  paid_out         timestamptz,   -- null = meeting start + length
  hours_edited_by  uuid references public.staff(id) on delete set null,
  hours_edited_at  timestamptz,
  primary key (meeting_id, staff_id)
);
create index if not exists meeting_invites_staff on public.meeting_invites (staff_id);
comment on column public.meeting_invites.paid is 'push 38 · null = paid when answer = coming. Ronnie can force true / false on the admin meeting page or Hours.';

create table if not exists public.meeting_events (
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  event_id    uuid not null references public.events(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (meeting_id, event_id)
);
create index if not exists meeting_events_event on public.meeting_events (event_id);

create table if not exists public.meeting_notes (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings(id) on delete cascade,
  author_id   uuid references public.staff(id) on delete set null,
  body        text not null default '',
  pinned      boolean not null default false,  -- "Show on the event page" (admin only)
  pinned_at   timestamptz,
  pinned_by   uuid references public.staff(id) on delete set null,
  edited_at   timestamptz,
  deleted_at  timestamptz,                     -- "Note deleted" placeholder, like messages
  created_at  timestamptz not null default now()
);
create index if not exists meeting_notes_meeting on public.meeting_notes (meeting_id, created_at);

-- ───────── staff_alerts: meeting updates in Messages (Updates list) ─────────
alter table public.staff_alerts add column if not exists meeting_id uuid references public.meetings(id) on delete cascade;
alter table public.staff_alerts drop constraint if exists staff_alerts_kind_check;
alter table public.staff_alerts add constraint staff_alerts_kind_check
  check (kind in ('booked', 'moved', 'removed', 'changed', 'meeting_invite', 'meeting_changed', 'meeting_cancelled', 'meeting_today'));
create unique index if not exists staff_alerts_meeting_today on public.staff_alerts (staff_id, meeting_id) where kind = 'meeting_today';

-- ───────── helpers ─────────
-- Who can be invited: managers / MDs / bar managers / 2ICs (same signs the admin Staff page and the MD picker use).
create or replace function public.can_meet(p_staff uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from staff s where s.id = p_staff and s.active and s.role <> 'admin'
                   and (s.role = 'manager' or s.md_rank is not null or s.positions && array['MD', 'BM', '2IC'])) $$;

create or replace function public.invited_to_meeting(m uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from meeting_invites where meeting_id = m and staff_id = me()) $$;

-- "Thu Nov 12 · 11:00 AM"
create or replace function public.meeting_when(p_at timestamptz) returns text
language sql stable set search_path = public as
$$ select to_char(p_at at time zone 'America/Toronto', 'Dy Mon FMDD') || ' · ' || to_char(p_at at time zone 'America/Toronto', 'FMHH12:MI AM') $$;

create or replace function public.meeting_place(p_kind text, p_address text) returns text
language sql immutable as
$$ select case p_kind when 'teams' then 'Microsoft Teams' when 'zoom' then 'Zoom' else coalesce(nullif(trim(coalesce(p_address, '')), ''), 'In person') end $$;

-- internal: one update per person in Messages (and on Home for changes / cancels)
create or replace function public._meeting_alert(p_meeting uuid, p_kind text, p_staff uuid[], p_title text, p_body text)
returns void language sql security definer set search_path = public as
$$ insert into staff_alerts(staff_id, kind, title, body, meeting_id)
   select distinct x, p_kind, p_title, p_body, p_meeting from unnest(coalesce(p_staff, '{}')) x where x is not null $$;
revoke execute on function public._meeting_alert(uuid, text, uuid[], text, text) from public, anon, authenticated;

grant execute on function public.can_meet(uuid) to authenticated;
grant execute on function public.invited_to_meeting(uuid) to authenticated;
grant execute on function public.meeting_when(timestamptz) to authenticated;
grant execute on function public.meeting_place(text, text) to authenticated;

-- ───────── RLS: invitees see their meeting, admins all. Every other write goes through the functions below. ─────────
alter table public.meetings enable row level security;
alter table public.meeting_invites enable row level security;
alter table public.meeting_events enable row level security;
alter table public.meeting_notes enable row level security;
drop policy if exists admin_all on public.meetings;
drop policy if exists see on public.meetings;
drop policy if exists admin_all on public.meeting_invites;
drop policy if exists see on public.meeting_invites;
drop policy if exists admin_all on public.meeting_events;
drop policy if exists see on public.meeting_events;
drop policy if exists admin_all on public.meeting_notes;
drop policy if exists see on public.meeting_notes;
create policy admin_all on public.meetings        for all using (is_admin()) with check (is_admin());
create policy see       on public.meetings        for select using (invited_to_meeting(id));
create policy admin_all on public.meeting_invites for all using (is_admin()) with check (is_admin());
create policy see       on public.meeting_invites for select using (invited_to_meeting(meeting_id));
create policy admin_all on public.meeting_events  for all using (is_admin()) with check (is_admin());
create policy see       on public.meeting_events  for select using (invited_to_meeting(meeting_id));
create policy admin_all on public.meeting_notes   for all using (is_admin()) with check (is_admin());
create policy see       on public.meeting_notes   for select using (invited_to_meeting(meeting_id));

-- ───────── admin: new / edit / cancel ─────────
-- p_id null = new. p_invite = everyone invited (the list replaces the old one). p_events null = links unchanged.
-- New people get an invite update · removed people a "no longer on this meeting" update · time / length / place / link
-- changes an update to everyone still invited (except Can't make it). Answers stay.
create or replace function public.admin_save_meeting(p_id uuid, p_title text, p_starts_at timestamptz, p_duration_min int, p_place_kind text,
                                                     p_link text, p_address text, p_about text, p_invite uuid[], p_events uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare m meetings%rowtype; o meetings%rowtype; ids uuid[]; added uuid[]; removed uuid[]; told uuid[]; bad int; moved boolean := false; changed boolean := false;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_title), '') = '' then raise exception 'Add a title.'; end if;
  if p_starts_at is null then raise exception 'Pick a date and a start time.'; end if;
  if p_duration_min is null or p_duration_min < 15 or p_duration_min > 480 then raise exception 'Pick how long it lasts.'; end if;
  if p_place_kind not in ('teams', 'zoom', 'in_person') then raise exception 'bad place'; end if;
  if p_place_kind = 'in_person' and coalesce(trim(p_address), '') = '' then raise exception 'Add the address.'; end if;
  select coalesce(array_agg(distinct x), '{}') into ids from unnest(coalesce(p_invite, '{}')) x where x is not null;
  if cardinality(ids) = 0 then raise exception 'Invite at least one person.'; end if;
  select count(*) into bad from unnest(ids) x where not can_meet(x);
  if bad > 0 then raise exception 'Only managers can be invited to a meeting.'; end if;

  if p_id is null then
    insert into meetings(title, starts_at, duration_min, place_kind, link, address, about, created_by)
    values (trim(p_title), p_starts_at, p_duration_min, p_place_kind, nullif(trim(coalesce(p_link, '')), ''),
            nullif(trim(coalesce(p_address, '')), ''), nullif(trim(coalesce(p_about, '')), ''), me())
    returning * into m;
  else
    select * into o from meetings where id = p_id for update;
    if not found then raise exception 'Meeting not found.'; end if;
    if o.cancelled_at is not null then raise exception 'This meeting is cancelled.'; end if;
    update meetings set title = trim(p_title), starts_at = p_starts_at, duration_min = p_duration_min, place_kind = p_place_kind,
           link = nullif(trim(coalesce(p_link, '')), ''), address = nullif(trim(coalesce(p_address, '')), ''),
           about = nullif(trim(coalesce(p_about, '')), ''), updated_at = now()
     where id = p_id returning * into m;
    moved := o.starts_at is distinct from m.starts_at;
    changed := moved or o.duration_min is distinct from m.duration_min or o.place_kind is distinct from m.place_kind
               or o.link is distinct from m.link or o.address is distinct from m.address or o.title is distinct from m.title;
  end if;

  select coalesce(array_agg(i.staff_id), '{}') into removed from meeting_invites i where i.meeting_id = m.id and not (i.staff_id = any(ids));
  select coalesce(array_agg(x), '{}') into added from unnest(ids) x
   where not exists (select 1 from meeting_invites i where i.meeting_id = m.id and i.staff_id = x);
  delete from meeting_invites where meeting_id = m.id and staff_id = any(removed);
  insert into meeting_invites(meeting_id, staff_id) select m.id, x from unnest(added) x;

  if moved then delete from staff_alerts where meeting_id = m.id and kind = 'meeting_today'; end if;
  perform _meeting_alert(m.id, 'meeting_invite', added, 'Meeting · ' || m.title,
    meeting_when(m.starts_at) || ' · ' || meeting_place(m.place_kind, m.address) || '. Tap to answer.');
  perform _meeting_alert(m.id, 'meeting_cancelled', removed, 'Meeting · ' || m.title, 'You are no longer on this meeting.');
  if changed then
    select coalesce(array_agg(i.staff_id), '{}') into told from meeting_invites i
     where i.meeting_id = m.id and i.answer is distinct from 'cant' and not (i.staff_id = any(added));
    perform _meeting_alert(m.id, 'meeting_changed', told, 'Meeting changed · ' || m.title,
      'Now ' || meeting_when(m.starts_at) || ' · ' || meeting_place(m.place_kind, m.address) || '. Your G&R calendar updates by itself.');
  end if;

  if p_events is not null then
    delete from meeting_events where meeting_id = m.id and not (event_id = any(p_events));
    insert into meeting_events(meeting_id, event_id) select m.id, x from unnest(p_events) x where x is not null on conflict do nothing;
  end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'meeting', m.id, jsonb_build_object('saved', case when p_id is null then 'new' else 'edit' end, 'invited', cardinality(ids)));
  return m.id;
end $$;

-- Cancel: everyone invited gets an update, it leaves Home / My dates / the calendar feed, nobody is paid.
create or replace function public.admin_cancel_meeting(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare m meetings%rowtype; who uuid[]; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update meetings set cancelled_at = now(), cancelled_by = me(), updated_at = now() where id = p_id and cancelled_at is null returning * into m;
  if not found then raise exception 'This meeting is already cancelled.'; end if;
  update staff_alerts set seen_at = now() where meeting_id = m.id and seen_at is null and kind in ('meeting_invite', 'meeting_today', 'meeting_changed');
  select coalesce(array_agg(staff_id), '{}') into who from meeting_invites where meeting_id = m.id;
  perform _meeting_alert(m.id, 'meeting_cancelled', who, 'Meeting cancelled · ' || m.title,
    meeting_when(m.starts_at) || ' is cancelled. It is off your G&R calendar.');
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'meeting', m.id, jsonb_build_object('cancelled', true));
end $$;

create or replace function public.admin_meeting_visibility(p_meeting uuid, p_visibility text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_visibility not in ('managers', 'team') then raise exception 'bad value'; end if;
  update meetings set notes_visibility = p_visibility, updated_at = now() where id = p_meeting;
end $$;

create or replace function public.admin_link_meeting_event(p_meeting uuid, p_event uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_on then insert into meeting_events(meeting_id, event_id) values (p_meeting, p_event) on conflict do nothing;
  else delete from meeting_events where meeting_id = p_meeting and event_id = p_event; end if;
end $$;

-- Paid hours: p_paid null = automatic (paid when Coming); p_in / p_out null = meeting start / start + length.
create or replace function public.admin_set_meeting_hours(p_meeting uuid, p_staff uuid, p_paid boolean, p_in timestamptz default null, p_out timestamptz default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_in is not null and p_out is not null and p_out <= p_in then raise exception 'The end has to be after the start.'; end if;
  update meeting_invites set paid = p_paid, paid_in = p_in, paid_out = p_out, hours_edited_by = me(), hours_edited_at = now()
   where meeting_id = p_meeting and staff_id = p_staff;
  if not found then raise exception 'This person is not on the meeting.'; end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'meeting_hours', p_meeting, jsonb_build_object('staff', p_staff, 'paid', p_paid, 'in', p_in, 'out', p_out));
end $$;

-- ───────── invitees ─────────
create or replace function public.answer_meeting(p_meeting uuid, p_answer text)
returns void language plpgsql security definer set search_path = public as
$$ declare m meetings%rowtype; begin
  if p_answer not in ('coming', 'cant') then raise exception 'bad answer'; end if;
  select * into m from meetings where id = p_meeting;
  if not found or not invited_to_meeting(p_meeting) then raise exception 'not your meeting'; end if;
  if m.cancelled_at is not null then raise exception 'This meeting is cancelled.'; end if;
  if m.starts_at + make_interval(mins => m.duration_min) <= now() then raise exception 'This meeting is over.'; end if;
  update meeting_invites set answer = p_answer, answered_at = now() where meeting_id = p_meeting and staff_id = me();
  update staff_alerts set seen_at = now() where staff_id = me() and meeting_id = p_meeting and kind = 'meeting_invite' and seen_at is null;
  insert into change_log(by_staff, entity, entity_id, change) values (me(), 'meeting', p_meeting, jsonb_build_object('answer', p_answer));
end $$;

-- Opening the meeting page = its updates are seen.
create or replace function public.meeting_seen(p_meeting uuid)
returns void language sql security definer set search_path = public as
$$ update staff_alerts set seen_at = now() where staff_id = me() and meeting_id = p_meeting and seen_at is null $$;

-- Morning of: "Today · 11:00 AM · <title>" in Messages, once per person and meeting, from 6 AM (called when the app opens).
create or replace function public.meeting_morning_check()
returns int language plpgsql security definer set search_path = public as
$$ declare n int; loc timestamp := now() at time zone 'America/Toronto'; begin
  if me() is null or loc::time < time '06:00' then return 0; end if;
  insert into staff_alerts(staff_id, kind, title, body, meeting_id)
  select me(), 'meeting_today', 'Today · ' || to_char(m.starts_at at time zone 'America/Toronto', 'FMHH12:MI AM') || ' · ' || m.title,
         case m.place_kind when 'teams' then 'Join on Teams from the app, it opens 10 min before.'
                           when 'zoom' then 'Join on Zoom from the app, it opens 10 min before.'
                           else 'At ' || meeting_place(m.place_kind, m.address) || '.' end, m.id
    from meeting_invites i join meetings m on m.id = i.meeting_id
   where i.staff_id = me() and i.answer is distinct from 'cant' and m.cancelled_at is null
     and (m.starts_at at time zone 'America/Toronto')::date = loc::date
     and m.starts_at + make_interval(mins => m.duration_min) > now()
  on conflict (staff_id, meeting_id) where kind = 'meeting_today' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Home + My dates: my meetings not over yet (12 h grace). p_staff = admin "view as" preview only.
create or replace function public.my_meetings(p_staff uuid default null)
returns table(id uuid, title text, starts_at timestamptz, duration_min int, place_kind text, link text, address text, about text,
              answer text, cancelled_at timestamptz, n_invited int)
language sql stable security definer set search_path = public as
$$ select m.id, m.title, m.starts_at, m.duration_min, m.place_kind, m.link, m.address, m.about, i.answer, m.cancelled_at,
          (select count(*)::int from meeting_invites x where x.meeting_id = m.id)
     from meeting_invites i join meetings m on m.id = i.meeting_id
    where i.staff_id = case when p_staff is not null and is_admin() then p_staff else me() end
      and m.cancelled_at is null
      and m.starts_at + make_interval(mins => m.duration_min) > now() - interval '12 hours'
    order by m.starts_at $$;

-- ───────── notes (everyone invited + admins read and add; author edits / deletes; admins pin) ─────────
create or replace function public.add_meeting_note(p_meeting uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as
$$ declare n uuid; begin
  if not (is_admin() or invited_to_meeting(p_meeting)) then raise exception 'not allowed'; end if;
  if not exists (select 1 from meetings where id = p_meeting) then raise exception 'Meeting not found.'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write something.'; end if;
  if length(p_body) > 2000 then raise exception 'Keep a note under 2000 characters.'; end if;
  insert into meeting_notes(meeting_id, author_id, body) values (p_meeting, me(), trim(p_body)) returning id into n;
  return n;
end $$;

create or replace function public.edit_meeting_note(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if coalesce(trim(p_body), '') = '' then raise exception 'Write something.'; end if;
  if length(p_body) > 2000 then raise exception 'Keep a note under 2000 characters.'; end if;
  update meeting_notes set body = trim(p_body), edited_at = now() where id = p_id and author_id = me() and deleted_at is null;
  if not found then raise exception 'You can only edit your own notes.'; end if;
end $$;

create or replace function public.delete_meeting_note(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  update meeting_notes set deleted_at = now(), body = '', pinned = false where id = p_id and author_id = me() and deleted_at is null;
  if not found then raise exception 'You can only delete your own notes.'; end if;
end $$;

create or replace function public.pin_meeting_note(p_id uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update meeting_notes set pinned = p_on, pinned_at = case when p_on then now() end, pinned_by = case when p_on then me() end
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Note not found.'; end if;
end $$;

-- ───────── the meeting page (staff + admin): one call, names / photos of everyone invited, notes, linked events ─────────
create or replace function public.meeting_page(p_meeting uuid)
returns json language sql stable security definer set search_path = public as
$$ select case when m.id is null or not (is_admin() or invited_to_meeting(m.id)) then null else json_build_object(
     'meeting', json_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'duration_min', m.duration_min,
                                  'place_kind', m.place_kind, 'link', m.link, 'address', m.address, 'about', m.about,
                                  'notes_visibility', m.notes_visibility, 'created_at', m.created_at, 'updated_at', m.updated_at,
                                  'cancelled_at', m.cancelled_at),
     'me', me(), 'is_admin', is_admin(),
     'my_answer', (select answer from meeting_invites where meeting_id = m.id and staff_id = me()),
     'organizer', (select json_build_object('id', s.id, 'full_name', s.full_name, 'photo_url', s.photo_url) from staff s where s.id = m.created_by),
     'invites', coalesce((select json_agg(json_build_object(
                  'staff_id', s.id, 'full_name', s.full_name, 'nickname', s.nickname, 'photo_url', s.photo_url,
                  'phone', case when is_admin() then s.phone end, 'answer', i.answer, 'answered_at', i.answered_at,
                  'paid', case when is_admin() then i.paid end, 'paid_in', case when is_admin() then i.paid_in end,
                  'paid_out', case when is_admin() then i.paid_out end) order by s.full_name)
                from meeting_invites i join staff s on s.id = i.staff_id where i.meeting_id = m.id), '[]'::json),
     'events', coalesce((select json_agg(json_build_object('id', e.id, 'title', e.title, 'event_date', e.event_date,
                  'department', e.department, 'venue', coalesce(v.name, e.title)) order by e.event_date, e.department)
                from meeting_events me2 join events e on e.id = me2.event_id left join venues v on v.id = e.venue_id
               where me2.meeting_id = m.id), '[]'::json),
     'notes', coalesce((select json_agg(json_build_object('id', n.id, 'author_id', n.author_id, 'author', a.full_name, 'author_nickname', a.nickname,
                  'author_photo', a.photo_url, 'body', n.body, 'pinned', n.pinned, 'edited_at', n.edited_at, 'deleted_at', n.deleted_at,
                  'created_at', n.created_at) order by n.created_at)
                from meeting_notes n left join staff a on a.id = n.author_id where n.meeting_id = m.id), '[]'::json)
   ) end
   from (select 1) one left join meetings m on m.id = p_meeting $$;

-- ───────── event page: "From the meeting · <date>" (pinned notes of meetings linked to this event) ─────────
-- Visible to the event's managers (manager / co-manager / MD / BM on it), or the whole team when the meeting says 'team'.
-- Invitees and admins always. can_open = may open the whole meeting (invited or admin).
create or replace function public.event_meeting_notes(p_event uuid)
returns table(meeting_id uuid, meeting_title text, starts_at timestamptz, can_open boolean, note_id uuid, body text, author text, created_at timestamptz)
language sql stable security definer set search_path = public as
$$ with mine as (
     select bool_or(s.position_code in ('MD', 'BM')) as lead, count(*) > 0 as on_team
       from shifts s where s.event_id = p_event and s.staff_id = me() and s.status <> 'declined' and s.attendance is null)
   select m.id, m.title, m.starts_at, (is_admin() or invited_to_meeting(m.id)), n.id, n.body, a.full_name, n.created_at
     from meeting_events l
     join meetings m on m.id = l.meeting_id and m.cancelled_at is null
     join meeting_notes n on n.meeting_id = m.id and n.pinned and n.deleted_at is null
     left join staff a on a.id = n.author_id
     cross join mine
    where l.event_id = p_event
      and (is_admin() or invited_to_meeting(m.id) or manages(p_event) or coalesce(mine.lead, false)
           or (m.notes_visibility = 'team' and coalesce(mine.on_team, false)))
    order by m.starts_at, n.created_at $$;

-- ───────── paid hours ─────────
-- One rule for every hours path: not cancelled · paid = Ronnie's choice, else said Coming · paid start = meeting start
-- (or Ronnie's time) · paid end = start + length (or Ronnie's time) · rounded to 15 min, no 4-hour minimum.
-- Internal (no sign-in check): used by meeting_hours() below and by hours_sheet() (anon key + sheet_token).
create or replace function public._meeting_pay(p_from date, p_to date)
returns table(meeting_id uuid, staff_id uuid, full_name text, title text, meeting_date date, starts_at timestamptz, duration_min int,
              answer text, paid boolean, auto boolean, paid_in timestamptz, paid_out timestamptz, hours numeric, ended boolean, edited_at timestamptz)
language sql stable security definer set search_path = public as
$$ select x.mid, x.sid, x.nm, x.ttl, x.md, x.st, x.dur, x.ans, x.pd, x.au,
          x.pin, x.pout, case when x.pd then round(extract(epoch from (x.pout - x.pin)) / 900) * 0.25 else 0 end, x.pout <= now(), x.ed
     from (select m.id as mid, i.staff_id as sid, s.full_name as nm, m.title as ttl, (m.starts_at at time zone 'America/Toronto')::date as md,
                  m.starts_at as st, m.duration_min as dur, i.answer as ans, coalesce(i.paid, i.answer = 'coming') as pd, i.paid is null as au,
                  coalesce(i.paid_in, m.starts_at) as pin, coalesce(i.paid_out, m.starts_at + make_interval(mins => m.duration_min)) as pout,
                  i.hours_edited_at as ed
             from meeting_invites i join meetings m on m.id = i.meeting_id join staff s on s.id = i.staff_id
            where m.cancelled_at is null
              and (m.starts_at at time zone 'America/Toronto')::date between p_from and p_to) x
    order by x.st, x.nm $$;
revoke execute on function public._meeting_pay(date, date) from public, anon, authenticated;

-- Staff: own paid meetings. Admin: everyone invited (p_staff null = all), paid or not, so Ronnie can change it.
create or replace function public.meeting_hours(p_from date, p_to date, p_staff uuid default null)
returns table(meeting_id uuid, staff_id uuid, full_name text, title text, meeting_date date, starts_at timestamptz, duration_min int,
              answer text, paid boolean, auto boolean, paid_in timestamptz, paid_out timestamptz, hours numeric, ended boolean, edited_at timestamptz)
language sql stable security definer set search_path = public as
$$ select p.* from _meeting_pay(p_from, p_to) p
    where case when is_admin() then (p_staff is null or p.staff_id = p_staff) else p.staff_id = me() and p.paid end $$;

-- APP · <DATE> tab feed (Events-sheet script). Same as 031 + kind ('shift' | 'meeting'); meeting rows only when p_meetings.
-- Meeting rows: event_id = meeting id, title "MEETING · <title>", start = punch in = paid start, end once it has passed.
drop function if exists public.hours_sheet(text, date);
create or replace function public.hours_sheet(p_token text, p_date date, p_meetings boolean default false)
returns table(event_id uuid, title text, address text, department text, ev_start timestamptz, position_code text, full_name text,
              planned_start timestamptz, punch_in timestamptz, punch_out timestamptz, attendance text, travel_h numeric, gas numeric, kind text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'sheet_token') then raise exception 'not allowed'; end if;
  return query
    select x.eid, x.ttl, x.addr, x.dept, x.evs, x.code, x.nm, x.ps, x.pin, x.pout, x.att, x.trv, x.gs, x.knd
      from (
        select e.id as eid, e.title as ttl, coalesce(e.address, v.address) as addr, e.department as dept,
               min(s.planned_start) over (partition by e.id) as evs, s.position_code as code, st.full_name as nm, s.planned_start as ps,
               p.punch_in as pin, case when p.punch_out <= now() then p.punch_out end as pout,
               coalesce(s.attendance, case when s.left_early then 'left_early' end) as att,
               (case when e.transport and s.attendance is null then round(coalesce(e.paid_travel_min, 0) / 60.0, 2) else 0 end)::numeric as trv,
               (case when e.transport and s.attendance is null and exists (
                 select 1 from ride_offers ro where ro.event_id = e.id and ro.staff_id = s.staff_id and ro.kind = 'driver' and ro.sent_at is not null
                   and exists (select 1 from ride_offers rr where rr.event_id = e.id and rr.kind = 'rider' and rr.car_driver_id = s.staff_id))
                 then coalesce(e.gas_per_car, 20) end)::numeric as gs,
               'shift'::text as knd, (s.position_code in ('MD','BM')) as lead
          from shifts s join events e on e.id = s.event_id join staff st on st.id = s.staff_id
          left join venues v on v.id = e.venue_id left join punches p on p.shift_id = s.id
         where e.event_date = p_date and s.status <> 'declined'
        union all
        select h.meeting_id, 'MEETING · ' || m.title, meeting_place(m.place_kind, m.address), 'floor'::text,
               m.starts_at, null::text, h.full_name, h.paid_in, h.paid_in, case when h.ended then h.paid_out end,
               null::text, 0::numeric, null::numeric, 'meeting'::text, false
          from _meeting_pay(p_date, p_date) h join meetings m on m.id = h.meeting_id
         where p_meetings and h.paid
      ) x
     order by x.evs, x.eid, x.ps, x.lead desc, x.nm;
end $$;
revoke all on function public.hours_sheet(text, date, boolean) from public;
grant execute on function public.hours_sheet(text, date, boolean) to anon, authenticated, service_role;

-- ───────── calendar feed (api/feed.js): meetings the person said Coming to ─────────
create or replace function public.calendar_feed_meetings(p_token uuid) returns json
language sql stable security definer set search_path = public as
$$ select coalesce(json_agg(json_build_object(
          'uid', m.id, 'title', m.title, 'start', m.starts_at, 'end', m.starts_at + make_interval(mins => m.duration_min),
          'place_kind', m.place_kind, 'link', m.link, 'address', m.address, 'about', m.about,
          'updated', greatest(m.updated_at, coalesce(i.answered_at, m.updated_at))) order by m.starts_at), '[]'::json)
     from staff_calendar c
     join staff st on st.id = c.staff_id and st.active
     join meeting_invites i on i.staff_id = c.staff_id and i.answer = 'coming'
     join meetings m on m.id = i.meeting_id and m.cancelled_at is null and m.starts_at > now() - interval '60 days'
    where c.token = p_token $$;

-- ───────── grants ─────────
revoke all on function public.admin_save_meeting(uuid, text, timestamptz, int, text, text, text, text, uuid[], uuid[]) from public;
revoke all on function public.admin_cancel_meeting(uuid) from public;
revoke all on function public.admin_meeting_visibility(uuid, text) from public;
revoke all on function public.admin_link_meeting_event(uuid, uuid, boolean) from public;
revoke all on function public.admin_set_meeting_hours(uuid, uuid, boolean, timestamptz, timestamptz) from public;
revoke all on function public.answer_meeting(uuid, text) from public;
revoke all on function public.meeting_seen(uuid) from public;
revoke all on function public.meeting_morning_check() from public;
revoke all on function public.my_meetings(uuid) from public;
revoke all on function public.add_meeting_note(uuid, text) from public;
revoke all on function public.edit_meeting_note(uuid, text) from public;
revoke all on function public.delete_meeting_note(uuid) from public;
revoke all on function public.pin_meeting_note(uuid, boolean) from public;
revoke all on function public.meeting_page(uuid) from public;
revoke all on function public.event_meeting_notes(uuid) from public;
revoke all on function public.meeting_hours(date, date, uuid) from public;
revoke all on function public.calendar_feed_meetings(uuid) from public;
grant execute on function public.admin_save_meeting(uuid, text, timestamptz, int, text, text, text, text, uuid[], uuid[]) to authenticated;
grant execute on function public.admin_cancel_meeting(uuid) to authenticated;
grant execute on function public.admin_meeting_visibility(uuid, text) to authenticated;
grant execute on function public.admin_link_meeting_event(uuid, uuid, boolean) to authenticated;
grant execute on function public.admin_set_meeting_hours(uuid, uuid, boolean, timestamptz, timestamptz) to authenticated;
grant execute on function public.answer_meeting(uuid, text) to authenticated;
grant execute on function public.meeting_seen(uuid) to authenticated;
grant execute on function public.meeting_morning_check() to authenticated;
grant execute on function public.my_meetings(uuid) to authenticated;
grant execute on function public.add_meeting_note(uuid, text) to authenticated;
grant execute on function public.edit_meeting_note(uuid, text) to authenticated;
grant execute on function public.delete_meeting_note(uuid) to authenticated;
grant execute on function public.pin_meeting_note(uuid, boolean) to authenticated;
grant execute on function public.meeting_page(uuid) to authenticated;
grant execute on function public.event_meeting_notes(uuid) to authenticated;
grant execute on function public.meeting_hours(date, date, uuid) to authenticated;
grant execute on function public.calendar_feed_meetings(uuid) to anon, authenticated;

-- Check: 4 tables, 1 new staff_alerts column, functions, hours_sheet with 3 arguments.
select (select count(*) from information_schema.tables where table_schema = 'public'
          and table_name in ('meetings', 'meeting_invites', 'meeting_events', 'meeting_notes')) as tables,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'staff_alerts' and column_name = 'meeting_id') as alert_col,
       (select count(*) from pg_proc where proname in ('can_meet', 'invited_to_meeting', 'meeting_when', 'meeting_place', 'admin_save_meeting',
          'admin_cancel_meeting', 'admin_meeting_visibility', 'admin_link_meeting_event', 'admin_set_meeting_hours', 'answer_meeting',
          'meeting_seen', 'meeting_morning_check', 'my_meetings', 'add_meeting_note', 'edit_meeting_note', 'delete_meeting_note',
          'pin_meeting_note', 'meeting_page', 'event_meeting_notes', 'meeting_hours', 'calendar_feed_meetings')) as functions,
       (select pronargs from pg_proc where proname = 'hours_sheet') as hours_sheet_args,
       (select count(*) from public.staff s where public.can_meet(s.id)) as can_be_invited;
