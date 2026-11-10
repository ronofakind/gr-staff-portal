-- Push 42 (Nov 2): Phone alerts (web push) + text outbox for staff without alerts.
-- File only: apply by hand in the SQL editor. Safe to run twice (if not exists / create or replace / drop … if exists).
-- Needs 039 (confirm window), 041 (answer_by), 042 (messages), 043 (meetings), 044 (asks), 045 (team chat) applied first.
-- Nothing existing is dropped or replaced: only new tables, new functions and new AFTER triggers.
--
-- Rules (Ronnie, Nov 2 8:16–8:34 PM, "StaffPhoneAlertsV1 / V2"):
--   · Nothing buzzes until Ronnie presses Send / Ask: the triggers below fire on the rows his Send / Ask writes
--     (confirm window starts, ask note posted, message sent, dates sent, meeting invite …), never on a draft.
--   · One buzz per person per send: the sender (/api/alerts) merges everything waiting for a person into ONE notification.
--   · Quiet hours 11 PM – 7 AM (Montreal): held until 7 AM, except things about today / tomorrow.
--   · Reminders: confirm 6 h and 2 h before the confirm-by, dates 3 h before the answer-by, meetings 8 AM that day.
--     Manager on the night: running late, replies to Message my team, people not started 15 min after call time,
--     submit tonight's hours.
--   · Staff settings: Shifts + Confirm reminders always on · Messages, Dates to answer, Meetings = switches (on) ·
--     Team chat = switch (off).
--   · No app alerts on any phone → a text from the Mac mini (iMessage): text_outbox rows (the Mac script reads them).
--   · Never says "first come" or who else was asked; English only; never "2IC".
--
-- How sending works (no cron in the database):
--   1. AFTER triggers write alert_queue rows (one per person + thing, unique send_key, so a re-send of the same thing
--      never buzzes twice). Admins never get alerts.
--   2. /api/alerts (Vercel, service role key) calls alerts_tick() (adds due reminders, moves 044 one-by-one asks on)
--      then alerts_take() (drops what's no longer relevant, switches off, holds quiet hours, claims the rest) and sends
--      one push per person, or one text_outbox row when they have no alert-enabled phone.
--   3. The app calls /api/alerts right after any write (debounced) and on every open; Vercel cron calls it each morning.
--   Until the Vercel env keys exist, /api/alerts does nothing and rows simply wait here (dropped after 36 h).

-- ───────── tables ─────────
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  platform    text check (platform in ('ios', 'android', 'desktop')),
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  last_error  text
);
create index if not exists push_subscriptions_staff on public.push_subscriptions (staff_id);
comment on table public.push_subscriptions is 'push 42 · one row per phone / browser that turned on G&R alerts (Web Push). Removed when the push service says the subscription is gone (404 / 410).';

create table if not exists public.alert_prefs (
  staff_id     uuid primary key references public.staff(id) on delete cascade,
  messages     boolean not null default true,   -- messages from Ronnie / a manager (and "Message my team")
  dates        boolean not null default true,   -- dates to answer (+ 3 h reminder)
  meetings     boolean not null default true,   -- meeting invites / changes + 8 AM reminder
  team_chat    boolean not null default false,  -- team chat messages
  nudge_skips  int not null default 0,          -- "Not now" on the Home card (comes back once a week, 3 times max)
  nudge_at     timestamptz,
  updated_at   timestamptz not null default now()
);
comment on table public.alert_prefs is 'push 42 · Profile → Notifications. No row = defaults. Shifts (booked / changed / can you work) and Confirm reminders are always on.';

create table if not exists public.alert_queue (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff(id) on delete cascade,
  kind        text not null check (kind in ('ask', 'confirm', 'confirm_remind', 'changed', 'shift', 'message', 'dates', 'dates_remind',
                                            'meeting', 'meeting_today', 'team_chat', 'mgr_late', 'mgr_reply', 'mgr_not_started', 'mgr_hours', 'test')),
  send_key    text not null,                     -- one buzz per person per thing (re-sends of the same thing are ignored)
  title       text not null,                     -- may hold {by} = data.by as "7:30 PM tonight" (filled when sent)
  body        text,
  cta         text,                              -- "👉 Tap to …"
  url         text not null default '/',
  tag         text,
  actions     jsonb not null default '[]',       -- Android buttons [{action, title}]
  data        jsonb not null default '{}',       -- {ask_id, shift_id, by, …}
  for_date    date,                              -- what day it's about: today / tomorrow go out during quiet hours
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  via         text check (via in ('sending', 'push', 'text', 'off', 'gone', 'none', 'failed')),
  note        text,
  unique (staff_id, send_key)
);
create index if not exists alert_queue_waiting on public.alert_queue (created_at) where sent_at is null;
comment on table public.alert_queue is 'push 42 · alerts waiting / sent. via: push (phone buzzed) · text (text_outbox row) · off (switched off) · gone (no longer relevant) · none (no alert phone, no text for this kind or no phone number) · failed.';

-- Mac mini iMessage outbox (push 24c): the Mac script reads status = 'queued' and expires_at > now(), sends, sets status.
create table if not exists public.text_outbox (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid references public.staff(id) on delete cascade,
  phone       text not null,
  lang        text not null default 'en',
  body        text not null,
  kind        text,
  alert_ids   uuid[] not null default '{}',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '12 hours',
  status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  sent_at     timestamptz,
  attempts    int not null default 0,
  error       text
);
create index if not exists text_outbox_queued on public.text_outbox (created_at) where status = 'queued';
comment on table public.text_outbox is 'push 42 · texts for staff with no alert-enabled phone, sent by the Mac mini (iMessage). Skip rows past expires_at.';

-- RLS: staff see / change only their own phones and switches (through the functions below). Admins read everything.
-- alert_queue and text_outbox are written only by the triggers / service role.
alter table public.push_subscriptions enable row level security;
alter table public.alert_prefs enable row level security;
alter table public.alert_queue enable row level security;
alter table public.text_outbox enable row level security;
drop policy if exists see on public.push_subscriptions;
drop policy if exists see on public.alert_prefs;
drop policy if exists admin_read on public.alert_queue;
drop policy if exists admin_read on public.text_outbox;
create policy see on public.push_subscriptions for select using (is_admin() or staff_id = me());
create policy see on public.alert_prefs for select using (is_admin() or staff_id = me());
create policy admin_read on public.alert_queue for select using (is_admin());
create policy admin_read on public.text_outbox for select using (is_admin());
revoke all on public.push_subscriptions, public.alert_prefs, public.alert_queue, public.text_outbox from anon, authenticated;
grant select on public.push_subscriptions, public.alert_prefs, public.alert_queue, public.text_outbox to authenticated;
grant all on public.push_subscriptions, public.alert_prefs, public.alert_queue, public.text_outbox to service_role;

-- ───────── staff: my phones + switches ─────────
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_platform text default null, p_ua text default null)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if me() is null then raise exception 'not signed in'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'bad subscription'; end if;
  -- same phone signed in as someone else before → it now belongs to whoever turned it on last
  insert into push_subscriptions(staff_id, endpoint, p256dh, auth, platform, user_agent)
  values (me(), p_endpoint, p_p256dh, p_auth, case when p_platform in ('ios', 'android', 'desktop') then p_platform end, left(p_ua, 300))
  on conflict (endpoint) do update set staff_id = me(), p256dh = excluded.p256dh, auth = excluded.auth,
     platform = excluded.platform, user_agent = excluded.user_agent, last_error = null;
end $$;

create or replace function public.push_unsubscribe(p_endpoint text) returns void
language sql security definer set search_path = public as
$$ delete from push_subscriptions where endpoint = p_endpoint and (staff_id = me() or is_admin()) $$;

-- {messages, dates, meetings, team_chat, nudge_skips, nudge_at, phones}
create or replace function public.my_alert_prefs() returns jsonb
language sql stable security definer set search_path = public as
$$ select jsonb_build_object('messages', coalesce(p.messages, true), 'dates', coalesce(p.dates, true), 'meetings', coalesce(p.meetings, true),
          'team_chat', coalesce(p.team_chat, false), 'nudge_skips', coalesce(p.nudge_skips, 0), 'nudge_at', p.nudge_at,
          'phones', (select count(*) from push_subscriptions s where s.staff_id = me()))
     from (select 1) one left join alert_prefs p on p.staff_id = me()
    where me() is not null $$;

-- p: any of {messages, dates, meetings, team_chat} · p_nudge: true = "Not now" on the Home card
create or replace function public.save_alert_prefs(p jsonb default '{}', p_nudge boolean default false) returns jsonb
language plpgsql security definer set search_path = public as
$$ begin
  if me() is null then raise exception 'not signed in'; end if;
  insert into alert_prefs(staff_id) values (me()) on conflict (staff_id) do nothing;
  update alert_prefs set
    messages  = case when p ? 'messages'  then (p->>'messages')::boolean  else messages end,
    dates     = case when p ? 'dates'     then (p->>'dates')::boolean     else dates end,
    meetings  = case when p ? 'meetings'  then (p->>'meetings')::boolean  else meetings end,
    team_chat = case when p ? 'team_chat' then (p->>'team_chat')::boolean else team_chat end,
    nudge_skips = nudge_skips + case when p_nudge then 1 else 0 end,
    nudge_at  = case when p_nudge then now() else nudge_at end,
    updated_at = now()
   where staff_id = me();
  return my_alert_prefs();
end $$;

grant execute on function public.push_subscribe(text, text, text, text, text) to authenticated;
grant execute on function public.push_unsubscribe(text) to authenticated;
grant execute on function public.my_alert_prefs() to authenticated;
grant execute on function public.save_alert_prefs(jsonb, boolean) to authenticated;

-- Red number on the app icon: asks to answer + shifts to confirm + unread messages (Ronnie / manager) + unopened team messages.
create or replace function public._alert_badge(p_staff uuid) returns int
language sql stable security definer set search_path = public as
$$ select ((select count(*) from shift_ask_targets t join shift_asks a on a.id = t.ask_id
             where t.staff_id = p_staff and a.status = 'open' and t.asked_at is not null and t.answer is null and t.removed_at is null)
         + (select count(*) from shifts s where s.staff_id = p_staff and s.status = 'booked' and s.attendance is null
             and s.confirm_sent_at is not null and s.planned_start > now())
         + (select count(*) from conversations c where c.staff_id = p_staff and c.kind in ('ronnie', 'manager') and c.last_from is not null
             and c.last_from <> 'staff' and (c.staff_seen_at is null or c.staff_seen_at < c.last_message_at) and c.last_message_at > now() - interval '30 days')
         + (select count(*) from announcement_reads r join announcements a on a.id = r.announcement_id
             where r.staff_id = p_staff and r.opened_at is null and a.created_at > now() - interval '7 days'))::int $$;
create or replace function public.my_alert_badge() returns int
language sql stable security definer set search_path = public as
$$ select case when me() is null then 0 else _alert_badge(me()) end $$;
revoke execute on function public._alert_badge(uuid) from public, anon, authenticated;
grant execute on function public.my_alert_badge() to authenticated;

-- ───────── helpers ─────────
create or replace function public._alert_pref(p_kind text) returns text
language sql immutable as
$$ select case when p_kind = 'message' then 'messages' when p_kind in ('dates', 'dates_remind') then 'dates'
               when p_kind in ('meeting', 'meeting_today') then 'meetings' when p_kind = 'team_chat' then 'team_chat' else 'always' end $$;

-- Queue one alert. Admins and inactive people never get one. Same person + send_key twice = ignored, unless p_replace
-- (a richer version of the same thing, e.g. the "Your shift changed" note right after its Home alert) and not sent yet.
create or replace function public._alert_add(p_staff uuid, p_kind text, p_key text, p_title text, p_body text, p_cta text, p_url text,
                                            p_for date default null, p_data jsonb default '{}', p_actions jsonb default '[]',
                                            p_tag text default null, p_replace boolean default false)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_staff is null or p_key is null or p_title is null then return; end if;
  if not exists (select 1 from staff where id = p_staff and active and role <> 'admin') then return; end if;
  if p_replace then
    insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, tag, actions, data, for_date)
    values (p_staff, p_kind, p_key, p_title, p_body, p_cta, coalesce(p_url, '/'), p_tag, coalesce(p_actions, '[]'), coalesce(p_data, '{}'), p_for)
    on conflict (staff_id, send_key) do update set kind = excluded.kind, title = excluded.title, body = excluded.body, cta = excluded.cta,
       url = excluded.url, tag = excluded.tag, actions = excluded.actions, data = excluded.data, for_date = excluded.for_date
     where alert_queue.sent_at is null;
  else
    insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, tag, actions, data, for_date)
    values (p_staff, p_kind, p_key, p_title, p_body, p_cta, coalesce(p_url, '/'), p_tag, coalesce(p_actions, '[]'), coalesce(p_data, '{}'), p_for)
    on conflict (staff_id, send_key) do nothing;
  end if;
end $$;
revoke execute on function public._alert_add(uuid, text, text, text, text, text, text, date, jsonb, jsonb, text, boolean) from public, anon, authenticated;

create or replace function public._first(p_staff uuid) returns text
language sql stable security definer set search_path = public as
$$ select coalesce(nullif(trim(nickname), ''), split_part(full_name, ' ', 1)) from staff where id = p_staff $$;
create or replace function public._snip(t text, n int default 90) returns text
language sql immutable as
$$ select case when length(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g')) > n
               then left(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'), n - 1) || '…' else regexp_replace(coalesce(t, ''), '\s+', ' ', 'g') end $$;
create or replace function public._venue_of(p_event uuid) returns text
language sql stable security definer set search_path = public as
$$ select coalesce(v.name, e.title) from events e left join venues v on v.id = e.venue_id where e.id = p_event $$;
revoke execute on function public._first(uuid) from public, anon, authenticated;
revoke execute on function public._venue_of(uuid) from public, anon, authenticated;

-- ───────── triggers: what Ronnie's Send / Ask writes ─────────

-- Messages: Ronnie / a manager writes to someone · ask notes · shift notes · a staff reply to a manager · team chat.
create or replace function public.alerts_on_message() returns trigger
language plpgsql security definer set search_path = public as
$$ declare c conversations%rowtype; card text; n jsonb; d date; who uuid; ttl text; lines jsonb; st text; begin
  begin
    select * into c from conversations where id = new.conversation_id;
    if not found or new.deleted_at is not null then return null; end if;
    card := new.meta->>'card';

    if c.kind = 'ronnie' and new.sender_role = 'admin' then
      perform _alert_add(c.staff_id, 'message', 'msg:' || new.id, '💬 Ronnie',
        coalesce(nullif(_snip(new.body), ''), case when cardinality(new.photo_paths) > 0 then '📷 Photo' else 'New message' end),
        '👉 Tap to reply', '/messages?c=ronnie', null, jsonb_build_object('conv', c.id), '[{"action":"reply","title":"REPLY"}]', 'gr-msg-ronnie');

    elsif c.kind = 'ronnie' and new.sender_role = 'system' and card = 'ask' then
      n := new.meta->'new'; d := (n->>'date')::date;
      perform _alert_add(c.staff_id, 'ask', 'ask:' || (new.meta->>'ask_id'),
        case new.meta->>'kind' when 'fill' then '🙋 Can you work ' when 'move' then '🙋 Can you work another event ' when 'position' then '🙋 New position ' else '🙋 New start time ' end
          || _mtl_day(d) || '?',
        concat_ws(' · ', n->>'venue', n->>'position', _mtl_time((n->>'start')::timestamptz)),
        '👉 Tap to say Yes or No', '/', d,
        jsonb_build_object('ask_id', new.meta->>'ask_id', 'by', new.meta->>'due_at'),
        '[{"action":"yes","title":"YES"},{"action":"no","title":"NO"},{"action":"open","title":"OPEN"}]', 'gr-ask-' || (new.meta->>'ask_id'));

    elsif c.kind = 'ronnie' and new.sender_role = 'system' and card in ('shift_changed', 'new_shift', 'shift_removed') then
      d := nullif(new.meta->>'date', '')::date; lines := coalesce(new.meta->'lines', '[]');
      select l->>'new' into st from jsonb_array_elements(lines) l where l->>'label' = 'Start' limit 1;
      ttl := case card when 'new_shift' then '🗓 New shift · ' || coalesce(_mtl_day(d), '')
                       when 'shift_removed' then '🗓 Shift removed · ' || coalesce(_mtl_day(d), '')
                       else case when st is not null then '⏰ Your start changed → ' || st else '⏰ Your shift changed' end end;
      perform _alert_add(c.staff_id, case when card = 'shift_changed' then 'changed' else 'shift' end,
        coalesce('alert:' || (new.meta->>'alert_id'), 'note:' || new.id), ttl,
        case card when 'shift_changed' then concat_ws(' · ', _mtl_day(d), new.meta->>'venue',
                                                     (select string_agg((l->>'label') || ' ' || coalesce(l->>'new', ''), ' · ') from jsonb_array_elements(lines) l where l->>'label' <> 'Start'))
                  when 'new_shift' then concat_ws(' · ', new.meta->>'venue', new.meta->>'position', _mtl_time(nullif(new.meta->>'start', '')::timestamptz))
                  else concat_ws(' · ', new.meta->>'venue', 'You''re no longer on this event') end,
        case card when 'shift_changed' then '👉 Tap Got it so Ronnie knows' when 'new_shift' then '👉 Tap to see it' else '👉 Tap to open' end,
        case card when 'new_shift' then '/my-dates' else '/messages?c=ronnie' end, d,
        jsonb_build_object('shift_id', new.meta->>'shift_id'), '[]', null, true);

    elsif c.kind = 'manager' and new.sender_role in ('manager', 'admin') and new.kind <> 'system' then
      perform _alert_add(c.staff_id, 'message', 'msg:' || new.id,
        '💬 ' || case when new.sender_role = 'admin' then 'Ronnie' else coalesce(_first(new.sender_id), 'Your manager') end,
        coalesce(nullif(_snip(new.body), ''), '📷 Photo'), '👉 Tap to reply', '/messages?c=mgr:' || c.event_id,
        null, jsonb_build_object('conv', c.id), '[{"action":"reply","title":"REPLY"}]', 'gr-msg-' || c.id);

    elsif c.kind = 'manager' and new.sender_role = 'staff' then
      -- manager on the night: a reply to Message my team (the manager whose message they answered)
      select event_date into d from events where id = c.event_id;
      perform _alert_add(coalesce(c.manager_id, (select manager_id from events where id = c.event_id)), 'mgr_reply', 'reply:' || new.id,
        '💬 ' || coalesce(_first(new.sender_id), 'Someone') || ' replied',
        concat_ws(' · ', _venue_of(c.event_id), coalesce(nullif(_snip(new.body, 70), ''), '📷 Photo')),
        '👉 Tap to reply', '/manage/' || c.event_id || '/messages', d, jsonb_build_object('event_id', c.event_id), '[]', 'gr-reply-' || c.event_id);

    elsif c.kind = 'team' and new.kind <> 'system' then
      select event_date into d from events where id = c.event_id;
      for who in select x from team_members(c.event_id) x where x is distinct from new.sender_id loop
        perform _alert_add(who, 'team_chat', 'team:' || new.id, '💬 Team chat · ' || coalesce(_venue_of(c.event_id), ''),
          coalesce(_first(new.sender_id), case when new.sender_role = 'admin' then 'Ronnie' else 'Someone' end) || ': ' || coalesce(nullif(_snip(new.body, 80), ''), '📷 Photo'),
          '👉 Tap to reply', '/messages?c=team:' || c.event_id, d, '{}', '[]', 'gr-team-' || c.event_id);
      end loop;
    end if;
  exception when others then raise warning 'alerts_on_message: %', sqlerrm; -- an alert problem never blocks the message
  end;
  return null;
end $$;
drop trigger if exists alerts_on_message on public.messages;
create trigger alerts_on_message after insert on public.messages for each row execute function public.alerts_on_message();

-- Message my team / Ronnie's announcements (029 / 042): one per person (announcement_reads rows).
create or replace function public.alerts_on_announcement() returns trigger
language plpgsql security definer set search_path = public as
$$ declare a announcements%rowtype; d date; frm text; begin
  begin
    select * into a from announcements where id = new.announcement_id;
    if not found then return null; end if;
    select event_date into d from events where id = a.event_id;
    frm := case when a.sender_id is null or exists (select 1 from staff where id = a.sender_id and role = 'admin') then 'Ronnie' else coalesce(_first(a.sender_id), 'Your manager') end;
    perform _alert_add(new.staff_id, 'message', 'ann:' || a.id,
      '💬 ' || frm || coalesce(' · ' || _venue_of(a.event_id), ''),
      coalesce(nullif(_snip(a.body), ''), '📷 Photo'),
      case when coalesce(a.ask_got_it, false) then '👉 Tap Got it so ' || frm || ' knows' else '👉 Tap to read' end,
      '/messages', d, jsonb_build_object('announcement_id', a.id), '[]', 'gr-ann-' || a.id);
  exception when others then raise warning 'alerts_on_announcement: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists alerts_on_announcement on public.announcement_reads;
create trigger alerts_on_announcement after insert on public.announcement_reads for each row execute function public.alerts_on_announcement();

-- Confirm your shift: the 24 h window starts (039: confirmations sent with final details).
create or replace function public.alerts_on_confirm() returns trigger
language plpgsql security definer set search_path = public as
$$ declare d date; v text; begin
  begin
    if new.status = 'booked' and new.attendance is null and new.confirm_sent_at is not null and new.confirm_by is not null
       and (tg_op = 'INSERT' or old.confirm_sent_at is distinct from new.confirm_sent_at) and new.planned_start > now() then
      select e.event_date, _venue_of(e.id) into d, v from events e where e.id = new.event_id;
      perform _alert_add(new.staff_id, 'confirm', 'confirm:' || new.id || ':' || extract(epoch from new.confirm_sent_at)::bigint,
        '✅ Confirm by {by}', concat_ws(' · ', _mtl_day(d), v, _mtl_time(new.planned_start)),
        '👉 Tap to confirm · 1 tap', '/', d, jsonb_build_object('shift_id', new.id, 'by', new.confirm_by),
        '[{"action":"confirm","title":"CONFIRM"},{"action":"open","title":"OPEN"}]', 'gr-confirm-' || new.id);
    end if;
  exception when others then raise warning 'alerts_on_confirm: %', sqlerrm;
  end;
  return null;
end $$;
-- (WHEN, not a column list: confirm_sent_at is set by the 039 BEFORE trigger, which a column-list trigger would not see)
drop trigger if exists alerts_on_confirm on public.shifts;
drop trigger if exists alerts_on_confirm_ins on public.shifts;
create trigger alerts_on_confirm after update on public.shifts for each row
  when (new.confirm_sent_at is not null and new.confirm_sent_at is distinct from old.confirm_sent_at) execute function public.alerts_on_confirm();
create trigger alerts_on_confirm_ins after insert on public.shifts for each row
  when (new.confirm_sent_at is not null) execute function public.alerts_on_confirm();

-- Dates to answer: dates sent (041: 'asked' rows of an ask). One per person per ask; the sender counts what's open.
create or replace function public.alerts_on_dates() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  begin
    if new.status = 'asked' and new.ask_id is not null and (new.answer_by is null or new.answer_by > now())
       and (tg_op = 'INSERT' or old.ask_id is distinct from new.ask_id or old.status <> 'asked') then
      perform _alert_add(new.staff_id, 'dates', 'dates:' || new.ask_id, '📅 Dates to answer', 'Answer by {by}',
        '👉 Tap to answer', '/my-dates', null, jsonb_build_object('by', new.answer_by), '[]', 'gr-dates');
    end if;
  exception when others then raise warning 'alerts_on_dates: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists alerts_on_dates on public.availability;
drop trigger if exists alerts_on_dates_ins on public.availability;
create trigger alerts_on_dates after update on public.availability for each row
  when (new.status = 'asked' and new.ask_id is not null and (old.status is distinct from 'asked' or old.ask_id is distinct from new.ask_id)) execute function public.alerts_on_dates();
create trigger alerts_on_dates_ins after insert on public.availability for each row
  when (new.status = 'asked' and new.ask_id is not null) execute function public.alerts_on_dates();

-- Home alerts (018 / 043): booked · moved · removed · changed (rides) · meeting invite / changed / cancelled.
-- (meeting_today is written when they open the app: the 8 AM reminder comes from alerts_tick instead.)
create or replace function public.alerts_on_staff_alert() returns trigger
language plpgsql security definer set search_path = public as
$$ declare d date; begin
  begin
    if new.kind = 'meeting_today' then return null; end if;
    if new.kind like 'meeting%' then
      perform _alert_add(new.staff_id, 'meeting', 'alert:' || new.id,
        case new.kind when 'meeting_invite' then '📅 Meeting · ' when 'meeting_changed' then '📅 Meeting changed · ' else '📅 Meeting cancelled · ' end || new.title,
        new.body, case when new.kind = 'meeting_invite' then '👉 Tap to say Coming or Can''t' else '👉 Tap to see it' end,
        case when new.kind = 'meeting_cancelled' or new.meeting_id is null then '/messages' else '/meeting/' || new.meeting_id end,
        null, jsonb_build_object('meeting_id', new.meeting_id), '[]', 'gr-mtg-' || coalesce(new.meeting_id::text, new.id::text));
    else
      select event_date into d from events where id = new.event_id;
      perform _alert_add(new.staff_id, case when new.kind = 'booked' then 'shift' else 'changed' end, 'alert:' || new.id,
        case new.kind when 'booked' then '🗓 ' when 'removed' then '🗓 ' else '⏰ ' end || new.title, new.body,
        case when new.kind = 'booked' then '👉 Tap to see it' else '👉 Tap Got it so Ronnie knows' end, '/', d, '{}', '[]', null);
    end if;
  exception when others then raise warning 'alerts_on_staff_alert: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists alerts_on_staff_alert on public.staff_alerts;
create trigger alerts_on_staff_alert after insert on public.staff_alerts for each row execute function public.alerts_on_staff_alert();

-- Manager on the night: "I'm running late" (034) → the event's manager + co-managers.
create or replace function public.alerts_on_late() returns trigger
language plpgsql security definer set search_path = public as
$$ declare s shifts%rowtype; e events%rowtype; m uuid; begin
  begin
    select * into s from shifts where id = new.shift_id;
    select * into e from events where id = s.event_id;
    for m in select distinct x from unnest(array[e.manager_id] || coalesce(e.co_manager_ids, '{}')) x where x is not null and x <> s.staff_id loop
      perform _alert_add(m, 'mgr_late', 'late:' || new.id || ':' || extract(epoch from new.sent_at)::bigint,
        '⏱ ' || coalesce(_first(s.staff_id), 'Someone') || ' is running late · ' || new.minutes || ' min',
        concat_ws(' · ', _venue_of(e.id), 'there at ' || _mtl_time(new.eta), new.reason),
        '👉 Tap to see your team', '/manage/' || e.id, e.event_date, jsonb_build_object('event_id', e.id), '[]', 'gr-late-' || new.shift_id);
    end loop;
  exception when others then raise warning 'alerts_on_late: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists alerts_on_late on public.late_notices;
drop trigger if exists alerts_on_late_ins on public.late_notices;
create trigger alerts_on_late after update on public.late_notices for each row
  when (new.sent_at is distinct from old.sent_at) execute function public.alerts_on_late();
create trigger alerts_on_late_ins after insert on public.late_notices for each row execute function public.alerts_on_late();

-- ───────── reminders (no cron here: /api/alerts runs this on every app open, after every write and each morning) ─────────
create or replace function public.alerts_tick() returns int
language plpgsql security definer set search_path = public as
$$ declare tz text := 'America/Toronto'; loc timestamp := now() at time zone 'America/Toronto'; today date := (now() at time zone 'America/Toronto')::date;
           r record; n int := 0; m uuid; begin
  perform pg_advisory_xact_lock(460046);
  -- 044: expire overdue asks and ask the next person in one by one (their ask note → an ask alert through the trigger)
  begin perform _asks_tick(); exception when others then raise warning 'alerts_tick asks: %', sqlerrm; end;

  -- Confirm reminders: 6 h and 2 h before the confirm-by (only the latest one that's due; nothing once it passed)
  for r in select s.id, s.staff_id, s.planned_start, s.confirm_by, e.event_date d, _venue_of(e.id) v,
                  case when s.confirm_by - now() <= interval '2 hours' then 2 else 6 end h
             from shifts s join events e on e.id = s.event_id
            where s.status = 'booked' and s.attendance is null and s.confirm_by > now() and s.confirm_by - now() <= interval '6 hours'
              and s.confirm_sent_at < now() - interval '30 minutes' and s.planned_start > now() loop
    perform _alert_add(r.staff_id, 'confirm_remind', 'confirm' || r.h || ':' || r.id || ':' || extract(epoch from r.confirm_by)::bigint,
      '✅ Confirm by {by}', concat_ws(' · ', case when r.confirm_by - now() < interval '1 hour' then round(extract(epoch from r.confirm_by - now()) / 60) || ' min left'
                                                    else round(extract(epoch from r.confirm_by - now()) / 3600) || ' h left' end, _mtl_day(r.d), r.v, _mtl_time(r.planned_start)),
      '👉 Tap to confirm · 1 tap', '/', r.d, jsonb_build_object('shift_id', r.id, 'by', r.confirm_by),
      '[{"action":"confirm","title":"CONFIRM"},{"action":"open","title":"OPEN"}]', 'gr-confirm-' || r.id);
    n := n + 1;
  end loop;

  -- Dates to answer: 3 h before the (earliest) answer-by, once per person and answer-by
  for r in select a.staff_id, min(a.answer_by) by_at, count(*) k from availability a
            where a.status = 'asked' and a.answer_by > now() and a.answer_by - now() <= interval '3 hours'
              and a.asked_at < now() - interval '30 minutes'
            group by a.staff_id loop
    perform _alert_add(r.staff_id, 'dates_remind', 'dates3:' || extract(epoch from r.by_at)::bigint,
      '📅 ' || r.k || case when r.k = 1 then ' date' else ' dates' end || ' to answer', 'Answer by {by}', '👉 Tap to answer', '/my-dates',
      (r.by_at at time zone tz)::date, jsonb_build_object('by', r.by_at), '[]', 'gr-dates');
    n := n + 1;
  end loop;

  -- Meetings: 8 AM that day (Montreal), everyone invited who didn't say Can't
  if loc::time >= time '08:00' then
    for r in select mt.id, mt.title, mt.starts_at, mt.place_kind, mt.address, mt.link, i.staff_id
               from meetings mt join meeting_invites i on i.meeting_id = mt.id
              where mt.cancelled_at is null and mt.starts_at > now() and (mt.starts_at at time zone tz)::date = today
                and i.answer is distinct from 'cant' loop
      perform _alert_add(r.staff_id, 'meeting_today', 'mtg8:' || r.id,
        '📅 Meeting today · ' || _mtl_time(r.starts_at), concat_ws(' · ', r.title, meeting_place(r.place_kind, r.address)),
        case when r.place_kind = 'teams' and coalesce(r.link, '') <> '' then '👉 Tap to join on Teams'
             when r.place_kind = 'zoom' and coalesce(r.link, '') <> '' then '👉 Tap to join on Zoom' else '👉 Tap to see it' end,
        '/meeting/' || r.id, today, jsonb_build_object('meeting_id', r.id), '[]', 'gr-mtg-' || r.id);
      n := n + 1;
    end loop;
  end if;

  -- Manager on the night: people not started 15 min after their call time (one per event + call time)
  for r in select e.id ev, e.event_date d, e.manager_id, e.co_manager_ids, s.planned_start st, count(*) k
             from shifts s join events e on e.id = s.event_id
             left join punches p on p.shift_id = s.id
            where e.event_date between today - 1 and today and s.status in ('booked', 'confirmed') and s.attendance is null
              and s.cancelled_at is null and p.punch_in is null
              and not (s.staff_id = any(array_remove(array[e.manager_id] || coalesce(e.co_manager_ids, '{}'), null)))  -- not the managers themselves
              and s.planned_start <= now() - interval '15 minutes' and s.planned_start > now() - interval '3 hours'
              and e.hours_submitted_at is null
            group by e.id, e.event_date, e.manager_id, e.co_manager_ids, s.planned_start loop
    for m in select distinct x from unnest(array[r.manager_id] || coalesce(r.co_manager_ids, '{}')) x where x is not null loop
      perform _alert_add(m, 'mgr_not_started', 'nostart:' || r.ev || ':' || extract(epoch from r.st)::bigint,
        '⏱ ' || r.k || case when r.k = 1 then ' person' else ' people' end || ' not started yet',
        concat_ws(' · ', _venue_of(r.ev), 'call time ' || _mtl_time(r.st)), '👉 Tap to see who', '/manage/' || r.ev, r.d,
        jsonb_build_object('event_id', r.ev), '[]', 'gr-nostart-' || r.ev);
      n := n + 1;
    end loop;
  end loop;

  -- Manager on the night: submit tonight's hours (everyone who started has ended, or 30 min after the end time)
  for r in select e.id ev, e.event_date d, e.manager_id, e.co_manager_ids from events e
            where e.event_date between today - 1 and today and e.hours_submitted_at is null and e.manager_id is not null
              and exists (select 1 from shifts s join punches p on p.shift_id = s.id where s.event_id = e.id and p.punch_in is not null)
              and (not exists (select 1 from shifts s join punches p on p.shift_id = s.id where s.event_id = e.id and p.punch_in is not null and p.punch_out is null)
                   or (e.end_time is not null and now() >= event_closes_at(e.id) - interval '12 hours' + interval '30 minutes'))
              and now() < event_closes_at(e.id) loop
    for m in select distinct x from unnest(array[r.manager_id] || coalesce(r.co_manager_ids, '{}')) x where x is not null loop
      perform _alert_add(m, 'mgr_hours', 'hours:' || r.ev, '🕘 Submit tonight''s hours', _venue_of(r.ev), '👉 Tap to submit',
        '/manage/' || r.ev, r.d, jsonb_build_object('event_id', r.ev), '[]', 'gr-hours-' || r.ev);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;

-- ───────── sender side (service role only) ─────────
-- Claim what can go out now. Returns one entry per person: {staff_id, name, phone, lang, badge, subs:[…], alerts:[…]}.
create or replace function public.alerts_take(p_only uuid default null) returns jsonb
language plpgsql security definer set search_path = public as
$$ declare tz text := 'America/Toronto'; loc timestamp := now() at time zone 'America/Toronto'; today date := (now() at time zone 'America/Toronto')::date;
           quiet boolean; out jsonb; begin
  perform pg_advisory_xact_lock(460047);
  quiet := loc::time >= time '23:00' or loc::time < time '07:00';

  -- no longer relevant → never sent
  update alert_queue q set sent_at = now(), via = 'gone', note = 'no longer relevant'
   where q.sent_at is null and (
         q.created_at < now() - interval '36 hours'
      or (q.kind = 'ask' and not exists (select 1 from shift_ask_targets t join shift_asks a on a.id = t.ask_id
                                          where t.ask_id = (q.data->>'ask_id')::uuid and t.staff_id = q.staff_id and a.status = 'open'
                                            and t.answer is null and t.removed_at is null))
      or (q.kind in ('confirm', 'confirm_remind') and not exists (select 1 from shifts s where s.id = (q.data->>'shift_id')::uuid
                                                                   and s.status = 'booked' and s.attendance is null and s.planned_start > now()))
      or (q.kind in ('dates', 'dates_remind') and not exists (select 1 from availability a where a.staff_id = q.staff_id and a.status = 'asked'
                                                               and (a.answer_by is null or a.answer_by > now())))
      or (q.kind = 'meeting_today' and not exists (select 1 from meetings m where m.id = (q.data->>'meeting_id')::uuid and m.cancelled_at is null and m.starts_at > now()))
      or (q.kind = 'mgr_hours' and exists (select 1 from events e where e.id = (q.data->>'event_id')::uuid and e.hours_submitted_at is not null)));

  -- switched off in Profile → Notifications
  update alert_queue q set sent_at = now(), via = 'off'
    from alert_prefs p
   where q.sent_at is null and p.staff_id = q.staff_id
     and ((_alert_pref(q.kind) = 'messages' and not p.messages) or (_alert_pref(q.kind) = 'dates' and not p.dates)
       or (_alert_pref(q.kind) = 'meetings' and not p.meetings) or (_alert_pref(q.kind) = 'team_chat' and not p.team_chat));
  update alert_queue q set sent_at = now(), via = 'off'
   where q.sent_at is null and q.kind = 'team_chat' and not exists (select 1 from alert_prefs p where p.staff_id = q.staff_id);

  with claimed as (
    update alert_queue q set sent_at = now(), via = 'sending'
     where q.sent_at is null and (p_only is null or q.staff_id = p_only)
       and (not quiet or q.kind = 'test' or (q.for_date is not null and q.for_date <= today + 1))
    returning q.*
  )
  select coalesce(jsonb_agg(x), '[]') into out from (
    select c.staff_id, _first(c.staff_id) as name, st.phone, coalesce(st.language, 'en') as lang, _alert_badge(c.staff_id) as badge,
           (select coalesce(jsonb_agg(jsonb_build_object('endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth)), '[]')
              from push_subscriptions ps where ps.staff_id = c.staff_id) as subs,
           (select count(*) from availability a where a.staff_id = c.staff_id and a.status = 'asked' and (a.answer_by is null or a.answer_by > now())) as open_dates,
           jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'title', c.title, 'body', c.body, 'cta', c.cta, 'url', c.url, 'tag', c.tag,
                                        'actions', c.actions, 'data', c.data, 'for_date', c.for_date, 'created_at', c.created_at) order by c.created_at) as alerts
      from claimed c join staff st on st.id = c.staff_id
     group by c.staff_id, st.phone, st.language
  ) x;
  return out;
end $$;

-- Result of one person's send. p_text: the text for the Mac mini (null = no text). p_gone: endpoints the push service dropped.
create or replace function public.alerts_done(p_ids uuid[], p_via text, p_note text default null, p_staff uuid default null,
                                              p_phone text default null, p_text text default null, p_lang text default 'en',
                                              p_kind text default null, p_expires timestamptz default null,
                                              p_ok text[] default '{}', p_gone text[] default '{}')
returns void language plpgsql security definer set search_path = public as
$$ begin
  update alert_queue set via = p_via, note = p_note, sent_at = now() where id = any(p_ids);
  if p_text is not null and coalesce(p_phone, '') <> '' then
    insert into text_outbox(staff_id, phone, lang, body, kind, alert_ids, expires_at)
    values (p_staff, p_phone, coalesce(p_lang, 'en'), p_text, p_kind, p_ids, coalesce(p_expires, now() + interval '12 hours'));
  end if;
  update push_subscriptions set last_ok_at = now(), last_error = null where endpoint = any(p_ok);
  delete from push_subscriptions where endpoint = any(p_gone);
end $$;

-- Staff "Send me a test" (from /api/alerts, checked there): goes out at any hour.
create or replace function public.alerts_test(p_staff uuid) returns void
language sql security definer set search_path = public as
$$ insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, for_date)
   values (p_staff, 'test', 'test:' || gen_random_uuid(), '✅ Alerts are on', 'This is how G&R will reach you.', '👉 Tap to open the app', '/', null) $$;

-- Admin Settings → Phone alerts: who has alerts on.
create or replace function public.admin_alert_people() returns jsonb
language sql stable security definer set search_path = public as
$$ select case when not is_admin() then null else jsonb_build_object(
     'total', (select count(*) from staff s where s.active and s.role <> 'admin'),
     'on', (select count(distinct p.staff_id) from push_subscriptions p join staff s on s.id = p.staff_id where s.active and s.role <> 'admin'),
     'off', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'phone', s.phone is not null and s.phone <> '') order by s.full_name), '[]')
               from staff s where s.active and s.role <> 'admin' and not exists (select 1 from push_subscriptions p where p.staff_id = s.id)),
     'texts_queued', (select count(*) from text_outbox where status = 'queued' and expires_at > now()),
     'waiting', (select count(*) from alert_queue where sent_at is null),
     'last_push', (select max(sent_at) from alert_queue where via = 'push')) end $$;
grant execute on function public.admin_alert_people() to authenticated;

revoke execute on function public.alerts_tick() from public, anon, authenticated;
revoke execute on function public.alerts_take(uuid) from public, anon, authenticated;
revoke execute on function public.alerts_done(uuid[], text, text, uuid, text, text, text, text, timestamptz, text[], text[]) from public, anon, authenticated;
revoke execute on function public.alerts_test(uuid) from public, anon, authenticated;
grant execute on function public.alerts_tick() to service_role;
grant execute on function public.alerts_take(uuid) to service_role;
grant execute on function public.alerts_done(uuid[], text, text, uuid, text, text, text, text, timestamptz, text[], text[]) to service_role;
grant execute on function public.alerts_test(uuid) to service_role;

-- ───────── check ─────────
select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('push_subscriptions', 'alert_prefs', 'alert_queue', 'text_outbox')) tables_4,
       (select count(*) from pg_trigger where tgname in ('alerts_on_message', 'alerts_on_announcement', 'alerts_on_confirm', 'alerts_on_dates',
          'alerts_on_staff_alert', 'alerts_on_late', 'alerts_on_confirm_ins', 'alerts_on_dates_ins', 'alerts_on_late_ins')) triggers_9,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('push_subscribe', 'push_unsubscribe', 'my_alert_prefs',
          'save_alert_prefs', 'my_alert_badge', 'alerts_tick', 'alerts_take', 'alerts_done', 'alerts_test', 'admin_alert_people')) fns_10;
