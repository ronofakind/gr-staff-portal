-- 112 · Notifications clean-up, part 2 (Nov 11, 2026 · push 91, boards NotificationsMapV1 + NotifCardsMessagesV1). Safe to run twice.
-- One wording + icon set for every phone alert · own kinds for night off / bar count / onboarding / shift removed / you're on ·
-- "Can you work?" Yes + booked → one "✅ You're on" · shift removed with Ronnie's optional reason · links go to Messages → Needs your answer ·
-- per-type on/off switches for staff notices (alert_kinds; Settings → Notifications in push 92).

alter table public.alert_queue drop constraint if exists alert_queue_kind_check;
alter table public.alert_queue add constraint alert_queue_kind_check check (kind in ('ask', 'confirm', 'confirm_remind', 'changed', 'shift', 'message', 'dates', 'dates_remind',
  'meeting', 'meeting_today', 'team_chat', 'team_pin', 'mgr_late', 'mgr_reply', 'mgr_not_started', 'mgr_hours', 'test',
  'shift_removed', 'youre_on', 'night_off', 'bar_count', 'onboarding', 'ride'));

-- Staff notice types Ronnie can switch off (off = in the app only, no phone alert / text).
create table if not exists public.alert_kinds (
  kind     text primary key,
  label    text not null,
  level    text not null check (level in ('must', 'info', 'tonight')),
  staff_on boolean not null default true,
  sort     int not null default 0
);
alter table public.alert_kinds enable row level security;
drop policy if exists admin_all on public.alert_kinds;
create policy admin_all on public.alert_kinds for all using (is_admin()) with check (is_admin());
insert into public.alert_kinds(kind, label, level, sort) values
  ('confirm', '✅ Confirm your shift', 'must', 1), ('confirm_remind', '✅ Confirm reminder', 'must', 2), ('ask', '🙋 Can you work?', 'must', 3),
  ('dates', '📅 Dates to answer', 'must', 4), ('dates_remind', '📅 Dates reminder (3 h)', 'must', 5), ('changed', '🗓 Shift changed', 'must', 6),
  ('shift_removed', '🗓 Shift removed', 'must', 7), ('shift', '🗓 New shift', 'info', 8), ('youre_on', '✅ You''re on (said yes, booked)', 'info', 9),
  ('message', '💬 Messages from you / a manager', 'info', 10), ('meeting', '🎥 Meetings', 'info', 11), ('meeting_today', '🎥 Meeting today (8 AM)', 'info', 12),
  ('team_chat', '👥 Team chat', 'info', 13), ('ride', '🚗 Rides', 'info', 14), ('bar_count', '🍸 Bar count', 'info', 15), ('night_off', '🌙 Night off answers', 'info', 16),
  ('onboarding', '📘 Onboarding steps', 'info', 17), ('mgr_not_started', '⏱ MD · not started yet', 'tonight', 18), ('mgr_late', '⏱ MD · running late', 'tonight', 19),
  ('mgr_reply', '⏱ MD · replies', 'tonight', 20), ('mgr_hours', '⏱ MD · submit hours', 'tonight', 21)
on conflict (kind) do nothing;

create or replace function public._alert_pref(p_kind text) returns text
language sql immutable as
$$ select case when p_kind = 'message' then 'messages' when p_kind in ('dates', 'dates_remind') then 'dates'
               when p_kind in ('meeting', 'meeting_today') then 'meetings' when p_kind = 'team_chat' then 'team_chat' else 'always' end $$;

-- One wording for every alert, whoever queues it (_alert_add, night off, rides and bar count insert directly) — push 91.
create or replace function public._alert_normalize() returns trigger
language plpgsql security definer set search_path = public as
$$ declare ev uuid; begin
  -- own kinds (they used to ride on "changed" / "shift")
  if new.kind = 'changed' and new.send_key like 'nightoff:%' then new.kind := 'night_off';
  elsif new.kind = 'changed' and new.send_key like 'barhand:%' then new.kind := 'bar_count';
  elsif new.kind = 'changed' and new.send_key like 'car%' then new.kind := 'ride';
  elsif new.kind = 'changed' and new.send_key like 'onboard%' then new.kind := 'onboarding';
  elsif new.kind in ('changed', 'shift') and (new.title ~* 'shift removed' or new.title ~* 'no longer on') then new.kind := 'shift_removed';
  end if;
  -- 🗓 for shifts, 🎥 for meetings, "5:00 PM"
  new.title := regexp_replace(new.title, '^⏰\s*', '🗓 ');
  new.title := regexp_replace(new.title, '^🗓\s*You(''|’)re no longer on\s*', '🗓 Shift removed · ');
  new.title := regexp_replace(new.title, '^🗓\s*You(''|’)re booked', '🗓 New shift');
  new.title := regexp_replace(new.title, '^📅 Meeting changed · Meeting changed', '🎥 Meeting changed');
  new.title := regexp_replace(new.title, '^📅 Meeting', '🎥 Meeting');
  new.title := regexp_replace(regexp_replace(new.title, '(\d)\s?pm\M', '\1 PM', 'g'), '(\d)\s?am\M', '\1 AM', 'g');
  -- said Yes to "Can you work?" and then booked: one "✅ You're on" instead of "New shift"
  if new.kind = 'shift' then
    if new.send_key like 'alert:%' then select event_id into ev from staff_alerts where id::text = substr(new.send_key, 7); end if;
    if ev is null and nullif(new.data->>'shift_id', '') is not null then select event_id into ev from shifts where id::text = new.data->>'shift_id'; end if;
    if ev is not null and exists (select 1 from shift_asks a join shift_ask_targets x on x.ask_id = a.id
                                   where a.event_id = ev and x.staff_id = new.staff_id and x.answer = 'yes' and x.answered_at > now() - interval '3 days') then
      new.kind := 'youre_on'; new.title := regexp_replace(new.title, '^🗓 New shift', '✅ You’re on');
    end if;
  end if;
  -- shift notices open Messages → Needs your answer
  if new.kind in ('changed', 'shift', 'shift_removed', 'youre_on') and coalesce(new.url, '/') in ('/', '/my-dates', '/messages?c=ronnie') then new.url := '/messages#needs'; end if;
  -- Ronnie switched this type off: stays in the app, no phone alert / text
  if new.sent_at is null and exists (select 1 from alert_kinds where kind = new.kind and not staff_on) then
    new.sent_at := now(); new.via := 'off'; new.note := 'type switched off';
  end if;
  return new;
end $$;
drop trigger if exists alert_normalize on public.alert_queue;
create trigger alert_normalize before insert or update of kind, title, url on public.alert_queue for each row execute function public._alert_normalize();

-- Shift removed: Ronnie's optional reason (they see it) on the staged change.
create or replace function public.admin_outbox_reason(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update change_outbox set meta = case when nullif(trim(coalesce(p_reason, '')), '') is null then meta - 'reason'
                                       else meta || jsonb_build_object('reason', left(trim(p_reason), 200)) end, updated_at = now()
   where id = p_id and sent_at is null and kind = 'removed';
end $$;
revoke all on function public.admin_outbox_reason(uuid, text) from public, anon;
grant execute on function public.admin_outbox_reason(uuid, text) to authenticated;

create or replace function public._send_text(r change_outbox) returns text language sql stable security definer set search_path = public as
$$ select case r.kind
    when 'new' then '🗓 New shift · ' || coalesce(_mtl_day((r.meta->>'date')::date), '') || coalesce(' · ' || (r.meta->>'venue'), '') || '. Confirm in My dates.'
    when 'removed' then '🗓 Shift removed · ' || coalesce(_mtl_day((r.meta->>'date')::date), '') || coalesce(' · ' || (r.meta->>'venue'), '') || '. You''re no longer on this event.'
         || coalesce(' “' || nullif(r.meta->>'reason', '') || '”', '') || ' Questions? Reply here.'
    else '🗓 Your shift changed · ' || coalesce(_mtl_day((r.meta->>'date')::date), '') || coalesce(' · ' || (r.meta->>'venue'), '') || ' · '
         || coalesce((select string_agg((x->>'label') || ' ' || coalesce(x->>'old', '') || ' → ' || coalesce(x->>'new', ''), ' · ') from jsonb_array_elements(r.lines) x), '') end $$;

-- admin_pending_changes: + the reason (so Send shows it) — same columns as before plus reason.
drop function if exists public.admin_pending_changes(uuid[]);
create or replace function public.admin_pending_changes(p_events uuid[] default null)
returns table (id uuid, staff_id uuid, full_name text, phone text, event_id uuid, event_title text, event_date date, kind text, level text, message text, reason text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query select o.id, o.staff_id, st.full_name, st.phone, o.event_id, coalesce(o.meta->>'venue', e.title), coalesce((o.meta->>'date')::date, e.event_date),
                      o.kind, _send_level(o), _send_text(o), o.meta->>'reason'
    from change_outbox o join staff st on st.id = o.staff_id left join events e on e.id = o.event_id
   where o.sent_at is null and (p_events is null or o.event_id = any(p_events))
   order by 7, 6, 3;
end $$;
grant execute on function public.admin_pending_changes(uuid[]) to authenticated;

-- Send: the removed card says the date + place in the title, the reason as its text.
do $$ declare src text; begin
  src := pg_get_functiondef('public.admin_send_changes(uuid[], text)'::regprocedure);
  if position('push 91' in src) = 0 then
    src := replace(src, $q$case r.kind when 'new' then 'You''re booked' else 'You''re no longer on ' || coalesce(_mtl_day((r.meta->>'date')::date), 'this date') end,
                concat_ws(' · ', _mtl_day((r.meta->>'date')::date), r.meta->>'venue'),$q$,
      $q$case r.kind when 'new' then 'You''re booked' else 'You''re no longer on ' || concat_ws(' · ', coalesce(_mtl_day((r.meta->>'date')::date), 'this date'), r.meta->>'venue') end, -- push 91
                case when r.kind = 'removed' and nullif(r.meta->>'reason', '') is not null then '“' || (r.meta->>'reason') || '”' else concat_ws(' · ', _mtl_day((r.meta->>'date')::date), r.meta->>'venue') end,$q$);
    execute src;
  end if;
end $$;

select 'RESULT ' || (select count(*) from alert_kinds) || ' notice types · '
  || (select count(*) from pg_trigger where tgname = 'alert_normalize') || ' wording trigger · send patched: '
  || (position('push 91' in pg_get_functiondef('public.admin_send_changes(uuid[], text)'::regprocedure)) > 0);
