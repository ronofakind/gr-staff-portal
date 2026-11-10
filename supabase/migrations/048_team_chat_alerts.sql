-- Push 43 (Nov 3): Team chats in Ronnie's admin Messages + phone alerts for team chat.
-- Needs 045 (team chat), 046 (phone alerts) and 047 applied first. Safe to run twice.
--
-- Alerts (Ronnie, Nov 3, 7:08 AM): the Team chat switch in Profile → Notifications stays OFF by default — on by default for
-- managers / co-managers. A 📌 pinned message buzzes everyone in the chat, switch or not (kind team_pin, always on).
-- Other messages are grouped: at most one buzz every 15 minutes per chat per person ("3 new messages · Name: last text"),
-- only for people whose switch is on, never the sender, never admins (Ronnie gets a red count on the Team chats tab instead).
-- Quiet hours as in 042: for_date = the event date, so tonight's / tomorrow's chat still comes through.
--
-- Admin: admin_team_chats() lists every team chat (open, opening soon, closed · read only 7 days) with the last message and
-- a red count of messages since Ronnie last opened it (team_chat_reads, through team_seen like everyone else).

-- ───────── alert_prefs: team_chat null = default (on for managers) ─────────
alter table public.alert_prefs alter column team_chat drop not null;
alter table public.alert_prefs alter column team_chat drop default;
comment on column public.alert_prefs.team_chat is 'push 43 · null = default: on when the person manages / co-manages the event, off otherwise.';

-- on by default for anyone managing or co-managing an event from yesterday on
create or replace function public._team_alert_default(p_staff uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from events e where e.event_date >= (now() at time zone 'America/Toronto')::date - 1
                    and (e.manager_id = p_staff or p_staff = any(e.co_manager_ids))) $$;
revoke execute on function public._team_alert_default(uuid) from public, anon, authenticated;

-- effective switch for one chat: explicit value, else manager of that chat → on
create or replace function public._team_alert_on(p_staff uuid, p_anchor uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select p.team_chat from alert_prefs p where p.staff_id = p_staff), p_staff = any(team_managers(p_anchor))) $$;
revoke execute on function public._team_alert_on(uuid, uuid) from public, anon, authenticated;

create or replace function public.my_alert_prefs() returns jsonb
language sql stable security definer set search_path = public as
$$ select jsonb_build_object('messages', coalesce(p.messages, true), 'dates', coalesce(p.dates, true), 'meetings', coalesce(p.meetings, true),
          'team_chat', coalesce(p.team_chat, _team_alert_default(me())), 'nudge_skips', coalesce(p.nudge_skips, 0), 'nudge_at', p.nudge_at,
          'phones', (select count(*) from push_subscriptions s where s.staff_id = me()))
     from (select 1) one left join alert_prefs p on p.staff_id = me()
    where me() is not null $$;

-- ───────── alert_queue: team_pin kind + not_before (grouping window) ─────────
alter table public.alert_queue drop constraint if exists alert_queue_kind_check;
alter table public.alert_queue add constraint alert_queue_kind_check check (kind in ('ask', 'confirm', 'confirm_remind', 'changed', 'shift', 'message', 'dates', 'dates_remind',
  'meeting', 'meeting_today', 'team_chat', 'team_pin', 'mgr_late', 'mgr_reply', 'mgr_not_started', 'mgr_hours', 'test'));
alter table public.alert_queue add column if not exists not_before timestamptz;
comment on column public.alert_queue.not_before is 'push 43 · not sent before this time (team chat: one buzz per 15 min per chat per person; messages in between join the same row).';

create or replace function public._alert_pref(p_kind text) returns text
language sql immutable as
$$ select case when p_kind = 'message' then 'messages' when p_kind in ('dates', 'dates_remind') then 'dates'
               when p_kind in ('meeting', 'meeting_today') then 'meetings' when p_kind = 'team_chat' then 'team_chat' else 'always' end $$;

-- One person's team-chat buzz: joins the pending row (count + last text) or opens a new one not before last buzz + 15 min.
create or replace function public._team_alert_group(p_staff uuid, p_anchor uuid, p_msg messages) returns void
language plpgsql security definer set search_path = public as
$$ declare pending alert_queue%rowtype; last_sent timestamptz; n int; who text; txt text; ttl text; d date; begin
  if not exists (select 1 from staff where id = p_staff and active and role <> 'admin') then return; end if;
  who := coalesce(_first(p_msg.sender_id), case when p_msg.sender_role = 'admin' then 'Ronnie' else 'Someone' end);
  txt := who || ': ' || coalesce(nullif(_snip(p_msg.body, 80), ''), '📷 Photo');
  ttl := '👥 ' || coalesce(_venue_of(p_anchor), '') || ' team';
  select event_date into d from events where id = p_anchor;
  select * into pending from alert_queue q where q.staff_id = p_staff and q.kind = 'team_chat' and q.sent_at is null and q.data->>'event_id' = p_anchor::text
   order by q.created_at desc limit 1;
  if found then
    n := coalesce((pending.data->>'n')::int, 1) + 1;
    update alert_queue set title = ttl, body = n || ' new messages · ' || txt, for_date = d,
           data = pending.data || jsonb_build_object('n', n, 'last_at', p_msg.created_at)
     where id = pending.id and sent_at is null;
    return;
  end if;
  select max(q.sent_at) into last_sent from alert_queue q
   where q.staff_id = p_staff and q.kind = 'team_chat' and q.data->>'event_id' = p_anchor::text and q.via in ('push', 'text', 'sending');
  insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, tag, actions, data, for_date, not_before)
  values (p_staff, 'team_chat', 'teamchat:' || p_anchor || ':' || p_msg.id, ttl, txt, '👉 Tap to open the chat', '/messages?c=team:' || p_anchor,
          'gr-team-' || p_anchor, '[]', jsonb_build_object('event_id', p_anchor, 'n', 1, 'last_at', p_msg.created_at), d,
          case when last_sent is null then now() else greatest(now(), last_sent + interval '15 minutes') end)
  on conflict (staff_id, send_key) do nothing;
end $$;
revoke execute on function public._team_alert_group(uuid, uuid, messages) from public, anon, authenticated;

-- Same trigger function as 046, team branch replaced by the grouped version (only people whose switch is on; never the sender).
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
      select event_date into d from events where id = c.event_id;
      perform _alert_add(coalesce(c.manager_id, (select manager_id from events where id = c.event_id)), 'mgr_reply', 'reply:' || new.id,
        '💬 ' || coalesce(_first(new.sender_id), 'Someone') || ' replied',
        concat_ws(' · ', _venue_of(c.event_id), coalesce(nullif(_snip(new.body, 70), ''), '📷 Photo')),
        '👉 Tap to reply', '/manage/' || c.event_id || '/messages', d, jsonb_build_object('event_id', c.event_id), '[]', 'gr-reply-' || c.event_id);

    elsif c.kind = 'team' and new.kind <> 'system' then
      for who in select x from team_members(c.event_id) x where x is distinct from new.sender_id and _team_alert_on(x, c.event_id) loop
        perform _team_alert_group(who, c.event_id, new);
      end loop;
    end if;
  exception when others then raise warning 'alerts_on_message: %', sqlerrm; -- an alert problem never blocks the message
  end;
  return null;
end $$;

-- 📌 Pinned → everyone in the chat, switch or not (never the person who pinned it).
create or replace function public.alerts_on_pin() returns trigger
language plpgsql security definer set search_path = public as
$$ declare m messages%rowtype; who uuid; d date; v text; begin
  begin
    if new.pinned_message_id is null or new.pinned_message_id is not distinct from old.pinned_message_id then return null; end if;
    select * into m from messages where id = new.pinned_message_id;
    if not found then return null; end if;
    select event_date into d from events where id = new.event_id;
    v := coalesce(_venue_of(new.event_id), '');
    for who in select x from team_members(new.event_id) x where x is distinct from new.pinned_by loop
      perform _alert_add(who, 'team_pin', 'pin:' || m.id, '📌 ' || v || ' team',
        coalesce(_first(new.pinned_by), 'Ronnie') || ' pinned: ' || coalesce(nullif(_snip(m.body, 90), ''), '📷 Photo'),
        '👉 Tap to open the chat', '/messages?c=team:' || new.event_id, d, jsonb_build_object('event_id', new.event_id), '[]', 'gr-pin-' || new.event_id);
    end loop;
  exception when others then raise warning 'alerts_on_pin: %', sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists alerts_on_pin on public.team_chats;
create trigger alerts_on_pin after update of pinned_message_id on public.team_chats for each row execute function public.alerts_on_pin();

-- alerts_take (046) + push 43: team_chat rows wait for not_before, are dropped once the person opened the chat, and the
-- switch check uses the per-chat default (managers on). Everything else unchanged.
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
      or (q.kind = 'mgr_hours' and exists (select 1 from events e where e.id = (q.data->>'event_id')::uuid and e.hours_submitted_at is not null))
      -- team chat: already opened the chat since the last message, or no longer in it, or the chat closed
      or (q.kind in ('team_chat', 'team_pin') and (
            exists (select 1 from team_chat_reads r join team_chats t on t.conversation_id = r.conversation_id
                     where t.event_id = (q.data->>'event_id')::uuid and r.staff_id = q.staff_id
                       and r.seen_at >= coalesce((q.data->>'last_at')::timestamptz, q.created_at))
         or team_state((q.data->>'event_id')::uuid) <> 'open'
         or q.staff_id not in (select team_members((q.data->>'event_id')::uuid)))));

  -- switched off in Profile → Notifications (team chat: per-chat default, managers on)
  update alert_queue q set sent_at = now(), via = 'off'
    from alert_prefs p
   where q.sent_at is null and p.staff_id = q.staff_id
     and ((_alert_pref(q.kind) = 'messages' and not p.messages) or (_alert_pref(q.kind) = 'dates' and not p.dates)
       or (_alert_pref(q.kind) = 'meetings' and not p.meetings));
  update alert_queue q set sent_at = now(), via = 'off'
   where q.sent_at is null and q.kind = 'team_chat' and not _team_alert_on(q.staff_id, (q.data->>'event_id')::uuid);

  with claimed as (
    update alert_queue q set sent_at = now(), via = 'sending'
     where q.sent_at is null and (p_only is null or q.staff_id = p_only)
       and (q.not_before is null or q.not_before <= now())
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

-- ───────── admin: Team chats tab ─────────
-- Every team chat from 9 days back to 1 day ahead that is on: open · before (opens soon) · readonly. Red count = messages
-- since Ronnie last opened it (his own excluded), 'me' marks a last message of his own.
create or replace function public.admin_team_chats()
returns table(event_id uuid, conversation_id uuid, title text, venue text, event_date date, state text, opens_at timestamptz, closes_at timestamptz,
              n_members int, last_at timestamptz, last_body text, last_photos int, last_deleted boolean, last_sender_id uuid, last_sender_name text,
              last_admin boolean, unread int)
language sql stable security definer set search_path = public as
$$ select t.event_id, t.conversation_id, e.title, _venue_of(t.event_id), e.event_date, team_state(t.event_id), w.opens_at, w.closes_at,
          (select count(*)::int from team_members(t.event_id)),
          lm.created_at, lm.body, cardinality(coalesce(lm.photo_paths, '{}')), lm.deleted_at is not null, lm.sender_id, ls.full_name,
          lm.sender_role = 'admin',
          (select count(*)::int from messages m where m.conversation_id = t.conversation_id and m.kind = 'text' and m.deleted_at is null
              and m.sender_id is distinct from me() and m.created_at > coalesce(r.seen_at, '-infinity'::timestamptz))
     from team_chats t
     join events e on e.id = t.event_id
     cross join lateral team_window(t.event_id) w
     left join team_chat_reads r on r.conversation_id = t.conversation_id and r.staff_id = me()
     left join lateral (select m.created_at, m.body, m.photo_paths, m.deleted_at, m.sender_id, m.sender_role from messages m
                         where m.conversation_id = t.conversation_id order by m.created_at desc limit 1) lm on true
     left join staff ls on ls.id = lm.sender_id
    where is_admin() and t.enabled and t.conversation_id is not null
      and e.event_date between (now() at time zone 'America/Toronto')::date - 9 and (now() at time zone 'America/Toronto')::date + 1
      and team_state(t.event_id) in ('before', 'open', 'readonly')
    order by (team_state(t.event_id) = 'readonly'), e.event_date, e.title $$;
grant execute on function public.admin_team_chats() to authenticated;

-- ───────── check ─────────
select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_team_alert_default', '_team_alert_on', '_team_alert_group',
          'alerts_on_pin', 'admin_team_chats')) fns_5,
       (select count(*) from pg_trigger where tgname = 'alerts_on_pin') trg_1,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'alert_queue' and column_name = 'not_before') col_1,
       (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'alert_prefs' and column_name = 'team_chat') team_chat_nullable_yes;
