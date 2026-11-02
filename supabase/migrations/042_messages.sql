-- Push 36 (Nov 2): Messages. Two-way conversation with Ronnie (one per staff, kept 1 year), replies to a manager's
-- announcement (only his event, closes 12 h after the event, read-only 7 more days), Seen for everything Ronnie / a manager
-- sends, "Got it" only when asked, Ronnie's inbox (Needs reply · All · Sent, Mark unread · Done), My hours questions
-- inside the Ronnie conversation (answer = same punch fix as admin Hours), photos in a private bucket.
-- File only: apply by hand in the SQL editor. Safe to run twice (if not exists / create or replace / drop … if exists).
-- Nothing existing is dropped except the 5-argument send_announcement, replaced by the same function with one more
-- optional argument (old app versions keep calling it the same way).
--
-- Reused: me() / is_admin() / manages() (001, 037) · announcements + announcement_reads + announcement_seen (029)
--   hours_questions + ask_hours (012) + answer_note (027) · manager_set_punch (011) · rounded_hours (038) · staff_alerts (018).
-- No cron: manager conversations close by comparing closes_at with now() in every query.

-- ───────── 36c · "Got it" only when Ronnie asks for it ─────────
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'announcements' and column_name = 'ask_got_it') then
    alter table public.announcements add column ask_got_it boolean not null default false;
    update public.announcements set ask_got_it = true; -- every announcement sent before push 36 had the Got it button
  end if;
end $$;
comment on column public.announcements.ask_got_it is 'push 36c · staff see a "Got it ✓" button only when true (composer switch "Ask for Got it", default off). Opening = Seen (announcement_reads.opened_at) either way.';

drop function if exists public.send_announcement(uuid, jsonb, text, jsonb, boolean);
create or replace function public.send_announcement(p_event uuid, p_audience jsonb, p_body text, p_media jsonb, p_pinned boolean, p_ask_got_it boolean default false)
returns uuid language plpgsql security definer set search_path = public as
$$ declare a uuid; d date; k text := coalesce(p_audience->>'kind', 'event'); begin
  if not is_admin() then
    if p_event is null or not manages(p_event) then raise exception 'You can only message your own team.'; end if;
    select event_date into d from events where id = p_event;
    if (now() at time zone 'America/Toronto')::date not between d - 1 and d then raise exception 'You can message your team from the day before until the event ends.'; end if;
    if k not in ('event', 'group') then raise exception 'not allowed'; end if;
  end if;
  insert into announcements(event_id, audience, body, media, pinned, ask_got_it)
  values (p_event, p_audience, coalesce(p_body, ''), coalesce(p_media, '[]'), coalesce(p_pinned, false), coalesce(p_ask_got_it, false)) returning id into a;
  insert into announcement_reads(announcement_id, staff_id)
  select distinct a, x.sid from (
    select s.staff_id sid from shifts s where k in ('event', 'group') and s.event_id = p_event and s.status <> 'declined' and s.attendance is null
      and (k = 'event' or s.planned_start = (p_audience->>'start')::timestamptz)
    union select (jsonb_array_elements_text(p_audience->'ids'))::uuid where k = 'people'
    union select st.id from staff st where k = 'all' and st.active
    union select s.staff_id from shifts s join events e on e.id = s.event_id where k = 'day' and e.event_date = (p_audience->>'date')::date and s.status <> 'declined'
  ) x where x.sid is not null and x.sid <> me();
  return a;
end $$;
grant execute on function public.send_announcement(uuid, jsonb, text, jsonb, boolean, boolean) to authenticated;

-- ───────── tables ─────────
create table if not exists public.conversations (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references public.staff(id) on delete cascade,
  kind             text not null check (kind in ('ronnie', 'manager')),
  event_id         uuid references public.events(id) on delete cascade,         -- manager only
  manager_id       uuid references public.staff(id) on delete set null,         -- manager only: whose announcement they replied to
  announcement_id  uuid references public.announcements(id) on delete set null, -- latest announcement replied to ("Re: …")
  status           text not null default 'open' check (status in ('open', 'done')),
  admin_unread     boolean not null default false,  -- Ronnie's "Mark unread": back in Needs reply, staff see no change
  staff_seen_at    timestamptz,
  admin_seen_at    timestamptz,
  manager_seen_at  timestamptz,
  closes_at        timestamptz,                     -- manager only: event end + 12 h
  last_message_at  timestamptz,
  last_from        text check (last_from in ('staff', 'admin', 'manager', 'system')),
  last_sender_id   uuid references public.staff(id) on delete set null,
  created_at       timestamptz not null default now(),
  check (kind = 'ronnie' or event_id is not null)
);
create unique index if not exists conversations_one_ronnie on public.conversations (staff_id) where kind = 'ronnie';
create unique index if not exists conversations_one_manager on public.conversations (staff_id, event_id) where kind = 'manager';
create index if not exists conversations_event on public.conversations (event_id) where event_id is not null;
create index if not exists conversations_last on public.conversations (last_message_at desc);
comment on table public.conversations is 'push 36 · one ''ronnie'' conversation per staff (kept 1 year) + one ''manager'' conversation per staff and event (replies to a manager announcement). Needs reply (admin) = open and (admin_unread or last_from = staff and (ronnie or manager conversation already closed)).';

create table if not exists public.messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  sender_id         uuid references public.staff(id) on delete set null,
  sender_role       text not null default 'staff' check (sender_role in ('staff', 'admin', 'manager', 'system')),
  kind              text not null default 'text' check (kind in ('text', 'system', 'hours')),
  body              text not null default '',
  topic             text check (topic in ('hours', 'shift', 'uniform', 'getting_there', 'pay', 'other')),
  shift_id          uuid references public.shifts(id) on delete set null,
  hours_question_id uuid references public.hours_questions(id) on delete set null,
  announcement_id   uuid references public.announcements(id) on delete set null,
  photo_paths       text[] not null default '{}',
  meta              jsonb not null default '{}',     -- snapshot: {"shift":{title,date,start}, "hours":{app_in,app_out,h,kind,claimed_at}, "re":"…"}
  edited_at         timestamptz,
  deleted_at        timestamptz,                     -- always a "Message deleted" placeholder
  created_at        timestamptz not null default now()
);
create index if not exists messages_conv on public.messages (conversation_id, created_at);
create index if not exists messages_hq on public.messages (hours_question_id) where hours_question_id is not null;

-- ───────── helpers ─────────
create or replace function public.event_closes_at(ev uuid) returns timestamptz
language sql stable security definer set search_path = public as
$$ select ((e.event_date + coalesce(e.end_time, time '23:59')) at time zone 'America/Toronto')
          + case when e.end_time is not null and e.end_time < coalesce(e.start_time, time '12:00') then interval '1 day' else interval '0' end
          + interval '12 hours'
     from events e where e.id = ev $$;

create or replace function public.can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from conversations x where x.id = c and (is_admin() or x.staff_id = me()
     or (x.kind = 'manager' and manages(x.event_id) and coalesce(x.closes_at, now()) + interval '7 days' > now()))) $$;

create or replace function public.can_write_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from conversations x where x.id = c and (is_admin()
     or (x.staff_id = me() and (x.kind = 'ronnie' or x.closes_at > now()))
     or (x.kind = 'manager' and manages(x.event_id) and x.closes_at > now()))) $$;

-- storage path "<conversation id>/<file>" → conversation id (null when the folder isn't a uuid)
create or replace function public.conv_of_path(p text) returns uuid
language plpgsql immutable as
$$ begin return split_part(p, '/', 1)::uuid; exception when others then return null; end $$;

grant execute on function public.event_closes_at(uuid) to authenticated;
grant execute on function public.can_see_conversation(uuid) to authenticated;
grant execute on function public.can_write_conversation(uuid) to authenticated;
grant execute on function public.conv_of_path(text) to authenticated;

-- ───────── RLS (reads only; every write goes through the functions below) ─────────
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
drop policy if exists see on public.conversations;
create policy see on public.conversations for select using (
  is_admin() or staff_id = me() or (kind = 'manager' and manages(event_id) and coalesce(closes_at, now()) + interval '7 days' > now()));
drop policy if exists see on public.messages;
create policy see on public.messages for select using (public.can_see_conversation(conversation_id));

-- ───────── photos (private, signed URLs) ─────────
insert into storage.buckets (id, name, public) values ('message-photos', 'message-photos', false) on conflict (id) do nothing;
drop policy if exists msgph_insert on storage.objects;
drop policy if exists msgph_read on storage.objects;
create policy msgph_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'message-photos' and public.can_write_conversation(public.conv_of_path(name))
  and lower(name) ~ '\.(jpe?g|png|webp|gif|heic)$');
create policy msgph_read on storage.objects for select to authenticated using (
  bucket_id = 'message-photos' and public.can_see_conversation(public.conv_of_path(name)));

-- ───────── conversations ─────────
-- Staff: their own conversation with Ronnie. Admin: p_staff = the person (✉ Message on a profile / team list).
create or replace function public.start_conversation(p_staff uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare sid uuid; c uuid; begin
  if p_staff is not null and p_staff is distinct from me() and not is_admin() then raise exception 'not allowed'; end if;
  sid := coalesce(p_staff, me());
  if sid is null then raise exception 'not signed in'; end if;
  insert into conversations(staff_id, kind) values (sid, 'ronnie') on conflict (staff_id) where kind = 'ronnie' do nothing;
  select id into c from conversations where staff_id = sid and kind = 'ronnie';
  return c;
end $$;
grant execute on function public.start_conversation(uuid) to authenticated;

-- Staff replying to an announcement: Ronnie's (or no event) → the Ronnie conversation; a manager's → that event's manager conversation.
create or replace function public.open_reply_thread(p_announcement uuid)
returns uuid language plpgsql security definer set search_path = public as
$$ declare a announcements%rowtype; c uuid; cl timestamptz; begin
  select * into a from announcements where id = p_announcement;
  if not found or not exists (select 1 from announcement_reads where announcement_id = a.id and staff_id = me()) then raise exception 'not allowed'; end if;
  if a.event_id is null or a.sender_id is null or exists (select 1 from staff where id = a.sender_id and role = 'admin') then
    return start_conversation(null);
  end if;
  cl := event_closes_at(a.event_id);
  if cl <= now() then raise exception 'These messages are closed. Message Ronnie instead.'; end if;
  insert into conversations(staff_id, kind, event_id, manager_id, announcement_id, closes_at)
  values (me(), 'manager', a.event_id, a.sender_id, a.id, cl)
  on conflict (staff_id, event_id) where kind = 'manager' do update set closes_at = excluded.closes_at, announcement_id = excluded.announcement_id;
  select id into c from conversations where staff_id = me() and event_id = a.event_id and kind = 'manager';
  return c;
end $$;
grant execute on function public.open_reply_thread(uuid) to authenticated;

-- internal: after a new message
create or replace function public._touch_conversation(c uuid, p_role text, p_announcement uuid default null)
returns void language sql security definer set search_path = public as
$$ update conversations set last_message_at = now(), last_from = p_role, last_sender_id = me(),
          status = case when p_role = 'staff' then 'open' else status end,
          admin_unread = case when p_role = 'admin' then false else admin_unread end,
          staff_seen_at = case when p_role = 'staff' then now() else staff_seen_at end,
          admin_seen_at = case when p_role = 'admin' then now() else admin_seen_at end,
          manager_seen_at = case when p_role = 'manager' then now() else manager_seen_at end,
          announcement_id = coalesce(p_announcement, announcement_id)
    where id = c $$;
revoke execute on function public._touch_conversation(uuid, text, uuid) from public, anon, authenticated;

create or replace function public._role_in(c conversations) returns text
language sql stable security definer set search_path = public as
$$ select case when c.staff_id = me() then 'staff' when is_admin() then 'admin'
               when c.kind = 'manager' and manages(c.event_id) then 'manager' end $$;
revoke execute on function public._role_in(conversations) from public, anon, authenticated;

create or replace function public.send_message(p_conversation uuid, p_body text, p_topic text default null, p_shift uuid default null,
                                               p_photos text[] default '{}', p_announcement uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare c conversations%rowtype; r text; m uuid; meta jsonb := '{}'; ph text[] := coalesce(p_photos, '{}'); begin
  select * into c from conversations where id = p_conversation for update;
  if not found then raise exception 'Conversation not found.'; end if;
  r := _role_in(c);
  if r is null then raise exception 'not allowed'; end if;
  if c.kind = 'manager' and r <> 'admin' and c.closes_at <= now() then raise exception 'These messages are closed. Message Ronnie instead.'; end if;
  if r = 'staff' and c.kind = 'manager' and c.last_message_at is null and p_announcement is null then raise exception 'You can only reply to your manager.'; end if;
  if coalesce(trim(p_body), '') = '' and cardinality(ph) = 0 then raise exception 'Write something or add a photo.'; end if;
  if cardinality(ph) > 6 then raise exception 'Up to 6 photos per message.'; end if;
  if exists (select 1 from unnest(ph) x where conv_of_path(x) is distinct from c.id) then raise exception 'bad photo'; end if;
  if p_topic is not null and p_topic not in ('hours', 'shift', 'uniform', 'getting_there', 'pay', 'other') then raise exception 'bad topic'; end if;
  if p_shift is not null then
    select jsonb_build_object('shift', jsonb_build_object('id', s.id, 'title', e.title, 'date', e.event_date, 'start', s.planned_start, 'event_id', e.id))
      into meta from shifts s join events e on e.id = s.event_id where s.id = p_shift and s.staff_id = c.staff_id;
    if meta is null then raise exception 'not their shift'; end if;
  end if;
  if p_announcement is not null then
    meta := meta || jsonb_build_object('re', (select left(split_part(coalesce(nullif(a.body, ''), 'Photo'), E'\n', 1), 90) from announcements a where a.id = p_announcement));
  end if;
  insert into messages(conversation_id, sender_id, sender_role, kind, body, topic, shift_id, announcement_id, photo_paths, meta)
  values (c.id, me(), r, 'text', coalesce(trim(p_body), ''), p_topic, p_shift, p_announcement, ph, meta) returning id into m;
  perform _touch_conversation(c.id, r, p_announcement);
  return m;
end $$;
grant execute on function public.send_message(uuid, text, text, uuid, text[], uuid) to authenticated;

-- Edit any time (others see "edited"). Delete = always a "Message deleted" placeholder. Only your own; never system notes or hours cards.
create or replace function public.edit_message(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if coalesce(trim(p_body), '') = '' and not exists (select 1 from messages where id = p_id and cardinality(photo_paths) > 0) then raise exception 'Write something.'; end if;
  update messages set body = trim(p_body), edited_at = now()
   where id = p_id and sender_id = me() and kind = 'text' and deleted_at is null and can_write_conversation(conversation_id);
  if not found then raise exception 'You can only edit your own messages.'; end if;
end $$;
grant execute on function public.edit_message(uuid, text) to authenticated;

create or replace function public.delete_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  update messages set deleted_at = now(), body = '', photo_paths = '{}'
   where id = p_id and sender_id = me() and kind = 'text' and deleted_at is null and can_see_conversation(conversation_id);
  if not found then raise exception 'You can only delete your own messages.'; end if;
end $$;
grant execute on function public.delete_message(uuid) to authenticated;

-- Opening = Seen (no button). Staff's Seen only moves when Ronnie / the manager opens the conversation.
create or replace function public.mark_conversation_seen(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare c conversations%rowtype; r text; begin
  select * into c from conversations where id = p_conversation;
  if not found then return; end if;
  r := _role_in(c);
  if r = 'staff' then update conversations set staff_seen_at = now() where id = c.id;
  elsif r = 'admin' then update conversations set admin_seen_at = now() where id = c.id;
  elsif r = 'manager' then update conversations set manager_seen_at = now() where id = c.id; end if;
end $$;
grant execute on function public.mark_conversation_seen(uuid) to authenticated;

-- Admin only: back in Needs reply. Does NOT touch Seen; staff see no change.
create or replace function public.admin_mark_unread(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update conversations set admin_unread = true, status = 'open' where id = p_conversation;
end $$;
grant execute on function public.admin_mark_unread(uuid) to authenticated;

-- Done (admin any · manager his event). A new message from the person opens it again.
create or replace function public.mark_done(p_conversation uuid, p_done boolean default true)
returns void language plpgsql security definer set search_path = public as
$$ declare c conversations%rowtype; begin
  select * into c from conversations where id = p_conversation;
  if not found or not (is_admin() or (c.kind = 'manager' and manages(c.event_id))) then raise exception 'not allowed'; end if;
  update conversations set status = case when p_done then 'done' else 'open' end,
         admin_unread = case when p_done then false else admin_unread end
   where id = c.id;
end $$;
grant execute on function public.mark_done(uuid, boolean) to authenticated;

-- ───────── lists + counts ─────────
-- Admin: p_event null = the whole inbox (1 year). Manager (or admin): p_event = that event's replies (his team only, open + 7 days).
create or replace function public.inbox(p_event uuid default null)
returns table(id uuid, staff_id uuid, staff_name text, staff_photo text, staff_phone text, kind text, event_id uuid, event_title text, event_date date,
              manager_id uuid, manager_name text, status text, admin_unread boolean, staff_seen_at timestamptz, admin_seen_at timestamptz,
              manager_seen_at timestamptz, closes_at timestamptz, last_message_at timestamptz, last_from text,
              last_body text, last_kind text, last_topic text, last_meta jsonb, last_photos int, last_staff_at timestamptz,
              re text, needs_reply boolean, closed boolean)
language sql stable security definer set search_path = public as
$$ select c.id, c.staff_id, st.full_name, st.photo_url, case when is_admin() then st.phone end, c.kind, c.event_id, e.title, e.event_date,
          c.manager_id, mg.full_name, c.status, c.admin_unread, c.staff_seen_at, c.admin_seen_at, c.manager_seen_at, c.closes_at,
          c.last_message_at, c.last_from, lm.body, lm.kind, lm.topic, lm.meta, cardinality(coalesce(lm.photo_paths, '{}')), ls.created_at,
          (select left(split_part(coalesce(nullif(a.body, ''), 'Photo'), E'\n', 1), 90) from announcements a where a.id = c.announcement_id),
          case when p_event is null
               then c.status = 'open' and (c.admin_unread or (c.last_from = 'staff' and (c.kind = 'ronnie' or c.closes_at <= now())))
               else c.status = 'open' and c.last_from = 'staff' and c.closes_at > now() end,
          c.kind = 'manager' and c.closes_at <= now()
     from conversations c
     join staff st on st.id = c.staff_id
     left join events e on e.id = c.event_id
     left join staff mg on mg.id = c.manager_id
     left join lateral (select m.body, m.kind, m.topic, m.meta, m.photo_paths from messages m
                         where m.conversation_id = c.id and m.deleted_at is null order by m.created_at desc limit 1) lm on true
     left join lateral (select m.created_at from messages m where m.conversation_id = c.id and m.sender_role = 'staff'
                         order by m.created_at desc limit 1) ls on true
    where c.last_message_at is not null
      and c.last_message_at > now() - interval '1 year'
      and case when p_event is null then is_admin()
               else c.event_id = p_event and c.kind = 'manager' and (is_admin() or (manages(p_event) and c.closes_at + interval '7 days' > now())) end
    order by c.last_message_at desc $$;
grant execute on function public.inbox(uuid) to authenticated;

-- Admin (p_event null): Needs reply count for the nav + Home. Manager (p_event): "💬 n replies from your team".
create or replace function public.inbox_count(p_event uuid default null)
returns int language sql stable security definer set search_path = public as
$$ select count(*)::int from inbox(p_event) i where i.needs_reply $$;
grant execute on function public.inbox_count(uuid) to authenticated;

-- Staff tab badge: unread conversations + unopened announcements + unseen shift notices (90 days).
create or replace function public.messages_badge()
returns int language sql stable security definer set search_path = public as
$$ select ((select count(*) from conversations c where c.staff_id = me() and c.last_from is not null and c.last_from <> 'staff'
              and (c.staff_seen_at is null or c.staff_seen_at < c.last_message_at) and c.last_message_at > now() - interval '1 year')
         + (select count(*) from announcement_reads r join announcements a on a.id = r.announcement_id
             where r.staff_id = me() and r.opened_at is null and a.created_at > now() - interval '90 days')
         + (select count(*) from staff_alerts s where s.staff_id = me() and s.seen_at is null and s.created_at > now() - interval '90 days'))::int $$;
grant execute on function public.messages_badge() to authenticated;

-- ───────── 36g · My hours inside the Ronnie conversation ─────────
create or replace function public.ask_hours_in_messages(p_shift uuid, p_kind text, p_at timestamptz, p_note text)
returns json language plpgsql security definer set search_path = public as
$$ declare q uuid; c uuid; m uuid; meta jsonb; begin
  q := ask_hours(p_shift, p_kind, p_at, p_note); -- same checks + the same hours_questions row as the Hours tab
  c := start_conversation(null);
  select jsonb_build_object(
           'shift', jsonb_build_object('id', s.id, 'title', e.title, 'date', e.event_date, 'start', s.planned_start, 'event_id', e.id),
           'hours', jsonb_build_object('app_in', p.punch_in, 'app_out', p.punch_out, 'h', rounded_hours(p.punch_in, p.punch_out), 'kind', p_kind, 'claimed_at', p_at))
    into meta from shifts s join events e on e.id = s.event_id left join punches p on p.shift_id = s.id where s.id = p_shift;
  insert into messages(conversation_id, sender_id, sender_role, kind, body, topic, shift_id, hours_question_id, meta)
  values (c, me(), 'staff', 'hours', coalesce(nullif(trim(coalesce(p_note, '')), ''), ''), 'hours', p_shift, q, coalesce(meta, '{}')) returning id into m;
  perform _touch_conversation(c, 'staff');
  return json_build_object('question', q, 'conversation', c, 'message', m);
end $$;
grant execute on function public.ask_hours_in_messages(uuid, text, timestamptz, text) to authenticated;

-- Ronnie answers in the conversation: Fix = manager_set_punch (same as admin Hours), then the question is closed.
-- The trigger below posts the system note (and his note) into the conversation, for this path and the admin Hours page.
create or replace function public.answer_hours_question(p_question uuid, p_status text, p_in timestamptz default null, p_out timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as
$$ declare q hours_questions%rowtype; pi timestamptz; po timestamptz; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('fixed', 'correct') then raise exception 'bad status'; end if;
  select * into q from hours_questions where id = p_question for update;
  if not found then raise exception 'not found'; end if;
  if q.status <> 'open' then raise exception 'This question is already answered.'; end if;
  if p_status = 'fixed' then
    select punch_in, punch_out into pi, po from punches where shift_id = q.shift_id;
    perform manager_set_punch(q.shift_id, coalesce(p_in, pi), coalesce(p_out, po), null);
  end if;
  update hours_questions set status = p_status, resolved_at = now(), resolved_by = me(), answer_note = nullif(trim(coalesce(p_note, '')), '')
   where id = q.id;
end $$;
grant execute on function public.answer_hours_question(uuid, text, timestamptz, timestamptz, text) to authenticated;

-- What Ronnie sees on the hours card: app hours, who entered them, who else on the team ended / started near the claimed time.
create or replace function public.hours_question_context(p_question uuid)
returns json language sql stable security definer set search_path = public as
$$ select case when not is_admin() then null else (
     select json_build_object(
       'status', q.status, 'kind', q.kind, 'claimed_at', q.claimed_at, 'note', q.note, 'answer_note', q.answer_note,
       'app_in', p.punch_in, 'app_out', p.punch_out, 'h', rounded_hours(p.punch_in, p.punch_out),
       'entered_by', (select full_name from staff where id = p.edited_by),
       'title', e.title, 'date', e.event_date,
       'near', (select coalesce(json_agg(json_build_object('name', st.full_name, 'at', case when q.kind = 'start' then p2.punch_in else p2.punch_out end)
                                         order by st.full_name), '[]')
                  from shifts s2 join punches p2 on p2.shift_id = s2.id join staff st on st.id = s2.staff_id
                 where s2.event_id = s.event_id and s2.id <> s.id and s2.attendance is null and q.claimed_at is not null
                   and abs(extract(epoch from ((case when q.kind = 'start' then p2.punch_in else p2.punch_out end) - q.claimed_at))) <= 1800))
       from hours_questions q join shifts s on s.id = q.shift_id join events e on e.id = s.event_id left join punches p on p.shift_id = s.id
      where q.id = p_question) end $$;
grant execute on function public.hours_question_context(uuid) to authenticated;

create or replace function public.hours_question_answered() returns trigger
language plpgsql security definer set search_path = public as
$$ declare c uuid; d date; pi timestamptz; po timestamptz; line text; sid uuid; begin
  if old.status <> 'open' or new.status not in ('fixed', 'correct') then return new; end if;
  insert into conversations(staff_id, kind) values (new.staff_id, 'ronnie') on conflict (staff_id) where kind = 'ronnie' do nothing;
  select id into c from conversations where staff_id = new.staff_id and kind = 'ronnie';
  select e.event_date, p.punch_in, p.punch_out into d, pi, po
    from shifts s join events e on e.id = s.event_id left join punches p on p.shift_id = s.id where s.id = new.shift_id;
  line := case when new.status = 'fixed' then '✓ Hours fixed · ' else 'Hours stay · ' end || to_char(d, 'Dy Mon FMDD')
          || case when pi is not null and po is not null
                  then ' · ' || to_char(pi at time zone 'America/Toronto', 'FMHH12:MI AM') || ' – ' || to_char(po at time zone 'America/Toronto', 'FMHH12:MI AM')
                       || ' · ' || rtrim(rtrim(to_char(rounded_hours(pi, po), 'FM999990.00'), '0'), '.') || ' h'
                  else '' end;
  sid := coalesce(new.resolved_by, me());
  insert into messages(conversation_id, sender_id, sender_role, kind, body, topic, shift_id, hours_question_id)
  values (c, sid, 'system', 'system', line, 'hours', new.shift_id, new.id);
  if nullif(trim(coalesce(new.answer_note, '')), '') is not null then
    insert into messages(conversation_id, sender_id, sender_role, kind, body, topic, shift_id, hours_question_id, created_at)
    values (c, sid, 'admin', 'text', trim(new.answer_note), 'hours', new.shift_id, new.id, now() + interval '1 millisecond');
  end if;
  update conversations set last_message_at = now(), last_sender_id = sid,
         last_from = case when nullif(trim(coalesce(new.answer_note, '')), '') is not null then 'admin' else 'system' end,
         admin_seen_at = now(), admin_unread = false
   where id = c;
  return new;
end $$;
drop trigger if exists hours_question_answered on public.hours_questions;
create trigger hours_question_answered after update of status on public.hours_questions
  for each row execute function public.hours_question_answered();

select (select count(*) from pg_proc where proname in ('send_message', 'edit_message', 'delete_message', 'mark_conversation_seen', 'admin_mark_unread', 'mark_done',
          'start_conversation', 'open_reply_thread', 'ask_hours_in_messages', 'answer_hours_question', 'hours_question_context', 'inbox', 'inbox_count', 'messages_badge')) as fns,
       (select count(*) from storage.buckets where id = 'message-photos') as bucket,
       (select count(*) from public.announcements where ask_got_it) as got_it_announcements;
