-- Push 41 (Nov 2): Team chat per event, off by default. Ronnie switches it on per event on the admin event page and picks who's
-- in it (Everyone · Managers only · Pick). Opens the day before at 5 PM (Montreal), closes 12 h after the event (same close rule
-- as the 042 manager threads), read-only for 7 more days, then hidden from staff. Ronnie (admins) always in, sees everything.
-- File only: apply by hand in the SQL editor. Safe to run twice (if not exists / create or replace / drop … if exists).
--
-- Built on Messages (042): a conversation of kind 'team' (one per event, staff_id null, many members) + the same messages table,
-- photos bucket, edit_message / delete_message. Nothing existing is dropped. Replaced with the same signature and the same
-- behaviour plus one team branch each: can_see_conversation, can_write_conversation, the conversations "see" policy and
-- messages_badge (042). conversations.staff_id loses NOT NULL (now required by a check for every kind except 'team'), the kind
-- check gets 'team'. Every 042 / 044 path filters on staff_id = me() or joins staff on staff_id, so team conversations never
-- show up in the Ronnie inbox, Needs reply, manager replies or the Ronnie conversation.
--
-- "Message my team" (manager announcements, 029 / 042) is NOT touched: it stays a private announcement, replies private to the
-- manager + Ronnie, even when team chat is on. Rides and late notices stay where they are. Still no private staff-to-staff chat.
--
-- One event = every event row with the same date + title (floor and bar are separate rows). The settings live in team_chats on
-- one "anchor" row (the floor row when there is one); every RPC takes any row of the event and finds the anchor.
-- Members (live, evaluated on every read):
--   · managers: manager_id + co_manager_ids of every row of the event, always in
--   · everyone: + everyone with a non-declined, non-cancelled shift on the event (people added later are in)
--   · managers: managers only ("Managers only"; Ronnie's own word for it is never shown to staff)
--   · pick:     + the stored list, only while they still have a shift on the event (people added later are NOT added)
-- No cron: open / read-only / hidden is computed from now() in every query.
--
-- Reused: me() / is_admin() (001) · co_manager_ids (037) · conversations / messages / message-photos bucket / event_closes_at /
--   conv_of_path / edit_message / delete_message (042).

-- ───────── conversations: kind 'team' ─────────
alter table public.conversations alter column staff_id drop not null;
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check check (kind in ('ronnie', 'manager', 'team'));
alter table public.conversations drop constraint if exists conversations_staff_check;
alter table public.conversations add constraint conversations_staff_check check (kind = 'team' or staff_id is not null);
create unique index if not exists conversations_one_team on public.conversations (event_id) where kind = 'team';

-- ───────── messages: reply + removed by the manager / Ronnie ─────────
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists removed_role text check (removed_role in ('manager', 'admin'));
alter table public.messages add column if not exists removed_by uuid references public.staff(id) on delete set null;
comment on column public.messages.removed_role is 'push 41 · team chat: a manager (or Ronnie) removed someone else''s message → "Removed by the manager" (deleted_at set, body / photos cleared).';

-- ───────── settings + read state ─────────
create table if not exists public.team_chats (
  event_id            uuid primary key references public.events(id) on delete cascade,  -- anchor row of the event
  conversation_id     uuid references public.conversations(id) on delete set null,
  enabled             boolean not null default false,
  who                 text not null default 'everyone' check (who in ('everyone', 'managers', 'pick')),
  picked              uuid[] not null default '{}',     -- who = 'pick' (managers are always in on top)
  photos              boolean not null default true,
  manager_can_remove  boolean not null default true,
  pinned_message_id   uuid references public.messages(id) on delete set null,
  pinned_by           uuid references public.staff(id) on delete set null,
  pinned_at           timestamptz,
  updated_by          uuid references public.staff(id) on delete set null,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
comment on table public.team_chats is 'push 41 · team chat per event (off by default). One row on the anchor event row (floor first); covers every row with the same date + title. Members are computed live (team_members).';

create table if not exists public.team_chat_reads (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  staff_id         uuid not null references public.staff(id) on delete cascade,
  seen_at          timestamptz not null default now(),
  primary key (conversation_id, staff_id)
);

alter table public.team_chats enable row level security;
alter table public.team_chat_reads enable row level security;
drop policy if exists admin_all on public.team_chats;
create policy admin_all on public.team_chats for all using (is_admin()) with check (is_admin());
drop policy if exists see on public.team_chat_reads;
create policy see on public.team_chat_reads for select using (is_admin() or staff_id = me());
-- staff read the settings through team_chat_info() only; every write goes through the functions below.

-- ───────── helpers ─────────
-- every row of the same event (floor + bar rows share date + title)
create or replace function public.team_events(ev uuid) returns setof uuid
language sql stable security definer set search_path = public as
$$ select e2.id from events e join events e2 on e2.event_date = e.event_date and e2.title = e.title where e.id = ev $$;

-- the row that holds the settings: an existing team_chats row, else the floor row, else the first row
create or replace function public.team_anchor(ev uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select coalesce(
     (select t.event_id from team_chats t where t.event_id in (select team_events(ev)) order by t.created_at limit 1),
     (select e.id from events e where e.id in (select team_events(ev)) order by (e.department = 'floor') desc, e.created_at, e.id limit 1)) $$;

-- lead + co-managers of every row
create or replace function public.team_managers(anchor uuid) returns uuid[]
language sql stable security definer set search_path = public as
$$ select coalesce(array_agg(distinct y.x) filter (where y.x is not null), '{}') from (
     select e.manager_id x from events e where e.id in (select team_events(anchor))
     union all select unnest(e.co_manager_ids) from events e where e.id in (select team_events(anchor))) y $$;

-- everyone with a live shift (not declined, not cancelled)
create or replace function public.team_on_event(anchor uuid) returns setof uuid
language sql stable security definer set search_path = public as
$$ select distinct s.staff_id from shifts s
    where s.event_id in (select team_events(anchor)) and s.status <> 'declined'
      and s.attendance is distinct from 'cancelled' and s.cancelled_at is null $$;

-- who's in it right now (admins are always in on top and never listed)
create or replace function public.team_members(anchor uuid) returns setof uuid
language sql stable security definer set search_path = public as
$$ select y.m from (
     select unnest(team_managers(anchor)) m
     union select x from team_on_event(anchor) x where exists (select 1 from team_chats t where t.event_id = anchor and t.who = 'everyone')
     union select x from team_on_event(anchor) x where exists (select 1 from team_chats t where t.event_id = anchor and t.who = 'pick' and x = any(t.picked))
   ) y where y.m is not null and not exists (select 1 from staff s where s.id = y.m and s.role = 'admin') $$;

-- opens the day before at 5 PM Montreal · closes 12 h after the (last row of the) event
create or replace function public.team_window(anchor uuid, out opens_at timestamptz, out closes_at timestamptz)
language sql stable security definer set search_path = public as
$$ select ((min(e.event_date) - 1) + time '17:00') at time zone 'America/Toronto', max(event_closes_at(e.id))
     from events e where e.id in (select team_events(anchor)) $$;

-- off · before · open · readonly (7 days after closing) · hidden
create or replace function public.team_state(anchor uuid) returns text
language sql stable security definer set search_path = public as
$$ select case when not coalesce((select enabled from team_chats where event_id = anchor), false) then 'off'
               when now() < w.opens_at then 'before'
               when now() < w.closes_at then 'open'
               when now() < w.closes_at + interval '7 days' then 'readonly'
               else 'hidden' end
     from team_window(anchor) w $$;

create or replace function public.team_is_mgr(anchor uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select me() is not null and me() = any(team_managers(anchor)) $$;

create or replace function public.team_can_see(anchor uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select is_admin() or (team_state(anchor) in ('open', 'readonly') and me() in (select team_members(anchor))) $$;

create or replace function public.team_can_write(anchor uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select team_state(anchor) = 'open' and (is_admin() or me() in (select team_members(anchor))) $$;

grant execute on function public.team_events(uuid) to authenticated;
grant execute on function public.team_anchor(uuid) to authenticated;
grant execute on function public.team_state(uuid) to authenticated;
grant execute on function public.team_can_see(uuid) to authenticated;
grant execute on function public.team_can_write(uuid) to authenticated;
revoke execute on function public.team_managers(uuid) from public, anon;
revoke execute on function public.team_on_event(uuid) from public, anon;
revoke execute on function public.team_members(uuid) from public, anon;
grant execute on function public.team_managers(uuid) to authenticated;
grant execute on function public.team_on_event(uuid) to authenticated;
grant execute on function public.team_members(uuid) to authenticated;
grant execute on function public.team_window(uuid) to authenticated;
grant execute on function public.team_is_mgr(uuid) to authenticated;

-- ───────── 042 access rules + team branch (same signatures) ─────────
create or replace function public.can_see_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from conversations x where x.id = c and (is_admin() or x.staff_id = me()
     or (x.kind = 'manager' and manages(x.event_id) and coalesce(x.closes_at, now()) + interval '7 days' > now())
     or (x.kind = 'team' and team_can_see(x.event_id)))) $$;

create or replace function public.can_write_conversation(c uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from conversations x where x.id = c and (is_admin()
     or (x.staff_id = me() and (x.kind = 'ronnie' or x.closes_at > now()))
     or (x.kind = 'manager' and manages(x.event_id) and x.closes_at > now())
     or (x.kind = 'team' and team_can_write(x.event_id)))) $$;

drop policy if exists see on public.conversations;
create policy see on public.conversations for select using (
  is_admin() or staff_id = me() or (kind = 'manager' and manages(event_id) and coalesce(closes_at, now()) + interval '7 days' > now())
  or (kind = 'team' and team_can_see(event_id)));
-- messages "see" policy (042) already goes through can_see_conversation; photos (msgph_insert / msgph_read) too.

-- ───────── admin: settings ─────────
-- Everything about the event's team chat for the admin card, the staff thread and the chat screen. Null when you can't see it.
create or replace function public.team_chat_info(p_event uuid)
returns json language plpgsql stable security definer set search_path = public as
$$ declare a uuid := team_anchor(p_event); t team_chats%rowtype; w record; st text; mg uuid[]; adm boolean := is_admin(); out json; begin
  if a is null then return null; end if;
  if not adm and not team_can_see(a) then return null; end if;
  select * into t from team_chats where event_id = a;
  select * into w from team_window(a);
  st := team_state(a); mg := team_managers(a);
  select json_build_object(
    'anchor', a, 'events', (select json_agg(x) from team_events(a) x),
    'title', e.title, 'date', e.event_date,
    'conversation_id', t.conversation_id, 'enabled', coalesce(t.enabled, false), 'who', coalesce(t.who, 'everyone'),
    'picked', case when adm then to_json(coalesce(t.picked, '{}')) end,
    'photos', coalesce(t.photos, true), 'manager_can_remove', coalesce(t.manager_can_remove, true),
    'opens_at', w.opens_at, 'closes_at', w.closes_at, 'state', st,
    'managers', to_json(mg), 'lead_ids', (select to_json(coalesce(array_agg(manager_id) filter (where manager_id is not null), '{}')) from events where id in (select team_events(a))),
    'n_members', (select count(*) from team_members(a)),
    'members', (select coalesce(json_agg(json_build_object('id', s.id, 'name', s.full_name, 'photo', s.photo_url, 'manager', s.id = any(mg)) order by (s.id = any(mg)) desc, s.full_name), '[]')
                  from staff s where s.id in (select team_members(a))),
    -- names + photos of everyone who wrote (people who left the team keep their name on old messages)
    'people', (select coalesce(json_object_agg(s.id, json_build_object('name', s.full_name, 'photo', s.photo_url, 'admin', s.role = 'admin')), '{}')
                 from staff s where s.id in (select team_members(a)) or s.id in (select m.sender_id from messages m where m.conversation_id = t.conversation_id)),
    'pinned', (select json_build_object('id', m.id, 'body', m.body, 'photos', cardinality(m.photo_paths), 'sender_id', m.sender_id, 'created_at', m.created_at)
                 from messages m where m.id = t.pinned_message_id and m.deleted_at is null),
    'me', json_build_object('admin', adm, 'manager', team_is_mgr(a), 'member', adm or me() in (select team_members(a)), 'can_write', team_can_write(a),
                            'can_pin', adm or (team_is_mgr(a) and st = 'open'),
                            'can_remove', adm or (team_is_mgr(a) and coalesce(t.manager_can_remove, true) and st in ('open', 'readonly')),
                            'photos', adm or coalesce(t.photos, true)),
    -- admin picker: everyone on the event, grouped by start time on the screen
    'on_event', case when adm then (select coalesce(json_agg(json_build_object('id', s.staff_id, 'name', st2.full_name, 'photo', st2.photo_url, 'start', s.planned_start,
                                                     'code', s.position_code, 'detail', s.position_detail, 'dept', ev.department,
                                                     'lead', s.staff_id = ev.manager_id, 'co', s.staff_id = any(ev.co_manager_ids)) order by s.planned_start, st2.full_name), '[]')
                                    from shifts s join staff st2 on st2.id = s.staff_id join events ev on ev.id = s.event_id
                                   where s.event_id in (select team_events(a)) and s.status <> 'declined' and s.attendance is distinct from 'cancelled' and s.cancelled_at is null) end
  ) into out from events e where e.id = a;
  return out;
end $$;
grant execute on function public.team_chat_info(uuid) to authenticated;

-- Switch / who / photos / manager can remove. p_picked only matters for 'pick' (null = keep the stored list).
-- Creates the team conversation the first time it's switched on. Turning it off hides it from staff right away (messages are kept).
create or replace function public.admin_save_team_chat(p_event uuid, p_enabled boolean, p_who text, p_picked uuid[] default null,
                                                       p_photos boolean default null, p_manager_remove boolean default null)
returns json language plpgsql security definer set search_path = public as
$$ declare a uuid := team_anchor(p_event); c uuid; cl timestamptz; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if a is null then raise exception 'Event not found.'; end if;
  if p_who not in ('everyone', 'managers', 'pick') then raise exception 'bad who'; end if;
  select closes_at into cl from team_window(a);
  insert into team_chats(event_id, enabled, who, picked, photos, manager_can_remove, updated_by, updated_at)
  values (a, coalesce(p_enabled, false), p_who, coalesce(p_picked, '{}'), coalesce(p_photos, true), coalesce(p_manager_remove, true), me(), now())
  on conflict (event_id) do update set enabled = excluded.enabled, who = excluded.who,
         picked = coalesce(p_picked, team_chats.picked), photos = coalesce(p_photos, team_chats.photos),
         manager_can_remove = coalesce(p_manager_remove, team_chats.manager_can_remove), updated_by = me(), updated_at = now();
  if coalesce(p_enabled, false) then
    insert into conversations(kind, event_id, closes_at) values ('team', a, cl)
    on conflict (event_id) where kind = 'team' do update set closes_at = excluded.closes_at;
    select id into c from conversations where kind = 'team' and event_id = a;
    update team_chats set conversation_id = c where event_id = a;
  end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'team_chat', a, jsonb_build_object('enabled', p_enabled, 'who', p_who, 'picked', p_picked, 'photos', p_photos, 'manager_can_remove', p_manager_remove));
  return team_chat_info(a);
end $$;
grant execute on function public.admin_save_team_chat(uuid, boolean, text, uuid[], boolean, boolean) to authenticated;

-- ───────── chat ─────────
create or replace function public._team_conv(p_conversation uuid) returns uuid
language sql stable security definer set search_path = public as
$$ select event_id from conversations where id = p_conversation and kind = 'team' $$;
revoke execute on function public._team_conv(uuid) from public, anon, authenticated;

-- Send (members + Ronnie, only while open). Photos only when allowed (Ronnie always). Reply = a quote of the message.
create or replace function public.team_send(p_conversation uuid, p_body text, p_photos text[] default '{}', p_reply_to uuid default null)
returns uuid language plpgsql security definer set search_path = public as
$$ declare a uuid := _team_conv(p_conversation); t team_chats%rowtype; r text; m uuid; meta jsonb := '{}'; ph text[] := coalesce(p_photos, '{}'); q messages%rowtype; begin
  if a is null then raise exception 'Conversation not found.'; end if;
  select * into t from team_chats where event_id = a;
  if not team_can_write(a) then
    if team_state(a) = 'readonly' then raise exception 'The team chat is closed. Everyone can still read it.'; end if;
    raise exception 'not allowed';
  end if;
  if coalesce(trim(p_body), '') = '' and cardinality(ph) = 0 then raise exception 'Write something or add a photo.'; end if;
  if cardinality(ph) > 0 and not is_admin() and not coalesce(t.photos, true) then raise exception 'Photos are off in this team chat.'; end if;
  if cardinality(ph) > 6 then raise exception 'Up to 6 photos per message.'; end if;
  if exists (select 1 from unnest(ph) x where conv_of_path(x) is distinct from p_conversation) then raise exception 'bad photo'; end if;
  if p_reply_to is not null then
    select * into q from messages where id = p_reply_to and conversation_id = p_conversation and deleted_at is null;
    if not found then raise exception 'That message is gone.'; end if;
    meta := jsonb_build_object('reply', jsonb_build_object('id', q.id, 'sender_id', q.sender_id,
              'text', left(split_part(coalesce(nullif(q.body, ''), '📷 Photo'), E'\n', 1), 90)));
  end if;
  r := case when is_admin() then 'admin' when team_is_mgr(a) then 'manager' else 'staff' end;
  insert into messages(conversation_id, sender_id, sender_role, kind, body, photo_paths, reply_to, meta)
  values (p_conversation, me(), r, 'text', coalesce(trim(p_body), ''), ph, p_reply_to, meta) returning id into m;
  update conversations set last_message_at = now(), last_from = r, last_sender_id = me() where id = p_conversation;
  insert into team_chat_reads(conversation_id, staff_id, seen_at) values (p_conversation, me(), now())
  on conflict (conversation_id, staff_id) do update set seen_at = now();
  return m;
end $$;
grant execute on function public.team_send(uuid, text, text[], uuid) to authenticated;

-- Opening = read (clears the red count). Members and Ronnie.
create or replace function public.team_seen(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare a uuid := _team_conv(p_conversation); begin
  if a is null or me() is null or not team_can_see(a) then return; end if;
  insert into team_chat_reads(conversation_id, staff_id, seen_at) values (p_conversation, me(), now())
  on conflict (conversation_id, staff_id) do update set seen_at = now();
end $$;
grant execute on function public.team_seen(uuid) to authenticated;

-- 📌 Pin for everyone (one pin: the latest replaces it) · p_on false = unpin. Managers while open, Ronnie any time.
create or replace function public.team_pin(p_message uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as
$$ declare m messages%rowtype; a uuid; begin
  select * into m from messages where id = p_message;
  a := _team_conv(m.conversation_id);
  if a is null then raise exception 'not found'; end if;
  if not (is_admin() or (team_is_mgr(a) and team_state(a) = 'open')) then raise exception 'Only the manager can pin.'; end if;
  if p_on then
    if m.deleted_at is not null or m.kind <> 'text' then raise exception 'That message is gone.'; end if;
    update team_chats set pinned_message_id = m.id, pinned_by = me(), pinned_at = now() where event_id = a;
  else
    update team_chats set pinned_message_id = null, pinned_by = me(), pinned_at = now() where event_id = a and pinned_message_id = m.id;
  end if;
end $$;
grant execute on function public.team_pin(uuid, boolean) to authenticated;

-- 🗑 Remove message → "Removed by the manager". Ronnie any message any time; a manager only when "Manager can remove" is on,
-- while the chat is open or read-only, never Ronnie's messages. Your own: use delete_message (042) → "Message deleted".
create or replace function public.team_remove_message(p_message uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare m messages%rowtype; a uuid; t team_chats%rowtype; adm boolean := is_admin(); begin
  select * into m from messages where id = p_message;
  a := _team_conv(m.conversation_id);
  if a is null then raise exception 'not found'; end if;
  select * into t from team_chats where event_id = a;
  if not adm then
    if not team_is_mgr(a) or not coalesce(t.manager_can_remove, true) or team_state(a) not in ('open', 'readonly') then raise exception 'not allowed'; end if;
    if m.sender_role = 'admin' or exists (select 1 from staff where id = m.sender_id and role = 'admin') then raise exception 'You can’t remove Ronnie’s messages.'; end if;
  end if;
  if m.deleted_at is not null then return; end if;
  update messages set deleted_at = now(), body = '', photo_paths = '{}', removed_role = case when adm then 'admin' else 'manager' end, removed_by = me()
   where id = m.id;
  update team_chats set pinned_message_id = null where event_id = a and pinned_message_id = m.id;
end $$;
grant execute on function public.team_remove_message(uuid) to authenticated;

-- Staff Messages list: my team chats that are open or read-only, last message + unread count.
create or replace function public.my_team_chats()
returns table(event_id uuid, conversation_id uuid, title text, event_date date, state text, opens_at timestamptz, closes_at timestamptz,
              n_members int, last_at timestamptz, last_body text, last_photos int, last_deleted boolean, last_sender_id uuid, last_sender_name text, unread int)
language sql stable security definer set search_path = public as
$$ select t.event_id, t.conversation_id, e.title, e.event_date, team_state(t.event_id), w.opens_at, w.closes_at,
          (select count(*)::int from team_members(t.event_id)),
          lm.created_at, lm.body, cardinality(coalesce(lm.photo_paths, '{}')), lm.deleted_at is not null, lm.sender_id, ls.full_name,
          (select count(*)::int from messages m where m.conversation_id = t.conversation_id and m.kind = 'text' and m.deleted_at is null
              and m.sender_id is distinct from me() and m.created_at > coalesce(r.seen_at, '-infinity'::timestamptz))
     from team_chats t
     join events e on e.id = t.event_id
     cross join lateral team_window(t.event_id) w
     left join team_chat_reads r on r.conversation_id = t.conversation_id and r.staff_id = me()
     left join lateral (select m.created_at, m.body, m.photo_paths, m.deleted_at, m.sender_id from messages m
                         where m.conversation_id = t.conversation_id order by m.created_at desc limit 1) lm on true
     left join staff ls on ls.id = lm.sender_id
    where t.enabled and t.conversation_id is not null
      and e.event_date between (now() at time zone 'America/Toronto')::date - 9 and (now() at time zone 'America/Toronto')::date + 1
      and team_state(t.event_id) in ('open', 'readonly')
      and me() in (select team_members(t.event_id))
    order by e.event_date desc $$;
grant execute on function public.my_team_chats() to authenticated;

-- Staff tab badge (042) + one per team chat with unread messages.
create or replace function public.messages_badge()
returns int language sql stable security definer set search_path = public as
$$ select ((select count(*) from conversations c where c.staff_id = me() and c.last_from is not null and c.last_from <> 'staff'
              and (c.staff_seen_at is null or c.staff_seen_at < c.last_message_at) and c.last_message_at > now() - interval '1 year')
         + (select count(*) from announcement_reads r join announcements a on a.id = r.announcement_id
             where r.staff_id = me() and r.opened_at is null and a.created_at > now() - interval '90 days')
         + (select count(*) from staff_alerts s where s.staff_id = me() and s.seen_at is null and s.created_at > now() - interval '90 days')
         + (select count(*) from my_team_chats() x where x.unread > 0))::int $$;
grant execute on function public.messages_badge() to authenticated;

-- ───────── check ─────────
select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('team_chats', 'team_chat_reads')) tables_2,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('team_events', 'team_anchor', 'team_managers', 'team_on_event',
          'team_members', 'team_window', 'team_state', 'team_is_mgr', 'team_can_see', 'team_can_write', 'team_chat_info', 'admin_save_team_chat',
          'team_send', 'team_seen', 'team_pin', 'team_remove_message', 'my_team_chats', '_team_conv')) fns_18,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name in ('reply_to', 'removed_role', 'removed_by')) msg_cols_3;
