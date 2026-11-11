-- 107 · Meetings V2 (Nov 10, 2026 · push 80) + admin colour theme (push 81). Safe to run twice.
-- Ronnie picks the meeting MD · the MD clocks people in / out (paid In → Out, 15-min rounding, no 4-h minimum)
-- · live shared notes (✓ Same, Add to it) · notes to Ronnie's Today (Done / Add to the event via the AI review)
-- · staff.theme also accepts 'terra' (Terracotta & Sage, admin only).

alter table public.meetings      add column if not exists md_id            uuid references public.staff(id) on delete set null;
alter table public.meetings      add column if not exists clock_started_at timestamptz;   -- first time the MD clocked someone in
alter table public.meeting_notes add column if not exists parent_id    uuid references public.meeting_notes(id) on delete cascade;  -- "Add to it"
alter table public.meeting_notes add column if not exists same_by      uuid[] not null default '{}';                            -- "✓ Same"
alter table public.meeting_notes add column if not exists done_at      timestamptz;                                             -- Ronnie: Done
alter table public.meeting_notes add column if not exists apply_status text check (apply_status in ('sending', 'done', 'error')); -- Add to the event
alter table public.meeting_notes add column if not exists apply_at     timestamptz;

alter table public.ai_items drop constraint if exists ai_items_source_check;
alter table public.ai_items add constraint ai_items_source_check check (source in ('email', 'app', 'meeting'));
alter table public.staff drop constraint if exists staff_theme_check;
alter table public.staff add constraint staff_theme_check check (theme in ('classic', 'dark', 'terra'));

-- Ronnie picks the MD (must be invited; null = none)
create or replace function public.admin_set_meeting_md(p_meeting uuid, p_md uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_md is not null and not exists (select 1 from meeting_invites where meeting_id = p_meeting and staff_id = p_md) then
    raise exception 'The MD has to be invited to the meeting.'; end if;
  update meetings set md_id = p_md, updated_at = now() where id = p_meeting;
end $$;

-- The meeting's MD (or Ronnie) clocks people: in · out · end (everyone still in → out) · undo
create or replace function public.md_meeting_clock(p_meeting uuid, p_staff uuid, p_kind text, p_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as
$$ declare t timestamptz := coalesce(p_at, now()); begin
  if not (is_admin() or exists (select 1 from meetings where id = p_meeting and md_id = me())) then raise exception 'Only the meeting MD can do this.'; end if;
  if p_kind = 'in' then
    update meeting_invites set paid_in = t, paid_out = null, hours_edited_by = me(), hours_edited_at = now() where meeting_id = p_meeting and staff_id = p_staff;
    update meetings set clock_started_at = coalesce(clock_started_at, now()) where id = p_meeting;
  elsif p_kind = 'out' then
    update meeting_invites set paid_out = greatest(t, paid_in), hours_edited_by = me(), hours_edited_at = now()
     where meeting_id = p_meeting and staff_id = p_staff and paid_in is not null;
  elsif p_kind = 'end' then
    update meeting_invites set paid_out = greatest(t, paid_in), hours_edited_by = me(), hours_edited_at = now()
     where meeting_id = p_meeting and paid_in is not null and paid_out is null;
  elsif p_kind = 'undo' then
    update meeting_invites set paid_in = null, paid_out = null, hours_edited_by = me(), hours_edited_at = now() where meeting_id = p_meeting and staff_id = p_staff;
  else raise exception 'bad kind'; end if;
end $$;

-- Paid hours. Once the MD has clocked anyone in, only people clocked in are paid (In → Out; no Out = to the planned end).
-- Before that: the old rule (Coming = paid for the set length). Ronnie's paid true / false still wins. 15-min rounding, no 4-h minimum.
create or replace function public._meeting_pay(p_from date, p_to date)
returns table(meeting_id uuid, staff_id uuid, full_name text, title text, meeting_date date, starts_at timestamptz, duration_min int,
              answer text, paid boolean, auto boolean, paid_in timestamptz, paid_out timestamptz, hours numeric, ended boolean, edited_at timestamptz)
language sql stable security definer set search_path = public as
$$ select x.mid, x.sid, x.nm, x.ttl, x.md, x.st, x.dur, x.ans, x.pd, x.au,
          x.pin, x.pout, case when x.pd then greatest(0, round(extract(epoch from (x.pout - x.pin)) / 900) * 0.25) else 0 end, x.pout <= now(), x.ed
     from (select m.id as mid, i.staff_id as sid, s.full_name as nm, m.title as ttl, (m.starts_at at time zone 'America/Toronto')::date as md,
                  m.starts_at as st, m.duration_min as dur, i.answer as ans,
                  coalesce(i.paid, case when m.clock_started_at is not null then i.paid_in is not null else i.answer = 'coming' end) as pd,
                  i.paid is null as au,
                  coalesce(i.paid_in, m.starts_at) as pin,
                  coalesce(i.paid_out, greatest(coalesce(i.paid_in, m.starts_at), m.starts_at + make_interval(mins => m.duration_min))) as pout,
                  i.hours_edited_at as ed
             from meeting_invites i join meetings m on m.id = i.meeting_id join staff s on s.id = i.staff_id
            where m.cancelled_at is null
              and (m.starts_at at time zone 'America/Toronto')::date between p_from and p_to) x
    order by x.st, x.nm $$;
revoke execute on function public._meeting_pay(date, date) from public, anon, authenticated;

-- Notes: "Add to it" (p_parent) · "✓ Same" toggle · Ronnie: done / undone / apply (→ the AI turns it into a review card)
create or replace function public.add_meeting_note(p_meeting uuid, p_body text, p_parent uuid)
returns uuid language plpgsql security definer set search_path = public as
$$ declare n uuid; begin
  if not (is_admin() or invited_to_meeting(p_meeting)) then raise exception 'not allowed'; end if;
  if coalesce(trim(p_body), '') = '' then raise exception 'Write something.'; end if;
  if length(p_body) > 2000 then raise exception 'Keep a note under 2000 characters.'; end if;
  if p_parent is not null and not exists (select 1 from meeting_notes where id = p_parent and meeting_id = p_meeting and parent_id is null) then
    raise exception 'Note not found.'; end if;
  insert into meeting_notes(meeting_id, author_id, body, parent_id) values (p_meeting, me(), trim(p_body), p_parent) returning id into n;
  return n;
end $$;

create or replace function public.meeting_note_same(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$ declare mid uuid; begin
  select meeting_id into mid from meeting_notes where id = p_id and deleted_at is null;
  if mid is null or not (is_admin() or invited_to_meeting(mid)) then raise exception 'not allowed'; end if;
  update meeting_notes set same_by = case when me() = any(same_by) then array_remove(same_by, me()) else array_append(same_by, me()) end
   where id = p_id and author_id is distinct from me();
end $$;

create or replace function public.admin_meeting_note_act(p_id uuid, p_act text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_act = 'done' then update meeting_notes set done_at = now() where id = p_id;
  elsif p_act = 'undone' then update meeting_notes set done_at = null where id = p_id;
  elsif p_act = 'apply' then update meeting_notes set apply_status = 'sending', apply_at = now() where id = p_id;
  else raise exception 'bad act'; end if;
end $$;

-- Meeting page: + md, clock start, the MD sees in / out times, notes with parent / same / done / apply.
create or replace function public.meeting_page(p_meeting uuid)
returns json language sql stable security definer set search_path = public as
$$ select case when m.id is null or not (is_admin() or invited_to_meeting(m.id)) then null else json_build_object(
     'meeting', json_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'duration_min', m.duration_min,
                                  'place_kind', m.place_kind, 'link', m.link, 'address', m.address, 'about', m.about,
                                  'notes_visibility', m.notes_visibility, 'created_at', m.created_at, 'updated_at', m.updated_at,
                                  'cancelled_at', m.cancelled_at, 'md_id', m.md_id, 'clock_started_at', m.clock_started_at),
     'me', me(), 'is_admin', is_admin(), 'is_md', (m.md_id is not null and m.md_id = me()),
     'my_answer', (select answer from meeting_invites where meeting_id = m.id and staff_id = me()),
     'organizer', (select json_build_object('id', s.id, 'full_name', s.full_name, 'photo_url', s.photo_url) from staff s where s.id = m.created_by),
     'invites', coalesce((select json_agg(json_build_object(
                  'staff_id', s.id, 'full_name', s.full_name, 'nickname', s.nickname, 'photo_url', s.photo_url,
                  'phone', case when is_admin() then s.phone end, 'answer', i.answer, 'answered_at', i.answered_at,
                  'paid', case when is_admin() then i.paid end,
                  'paid_in', case when is_admin() or m.md_id = me() then i.paid_in end,
                  'paid_out', case when is_admin() or m.md_id = me() then i.paid_out end) order by s.full_name)
                from meeting_invites i join staff s on s.id = i.staff_id where i.meeting_id = m.id), '[]'::json),
     'events', coalesce((select json_agg(json_build_object('id', e.id, 'title', e.title, 'event_date', e.event_date,
                  'department', e.department, 'venue', coalesce(v.name, e.title)) order by e.event_date, e.department)
                from meeting_events me2 join events e on e.id = me2.event_id left join venues v on v.id = e.venue_id
               where me2.meeting_id = m.id), '[]'::json),
     'notes', coalesce((select json_agg(json_build_object('id', n.id, 'author_id', n.author_id, 'author', a.full_name, 'author_nickname', a.nickname,
                  'author_photo', a.photo_url, 'body', n.body, 'pinned', n.pinned, 'edited_at', n.edited_at, 'deleted_at', n.deleted_at,
                  'created_at', n.created_at, 'parent_id', n.parent_id,
                  'same', (select coalesce(json_agg(coalesce(x.nickname, split_part(x.full_name, ' ', 1))), '[]'::json) from staff x where x.id = any(n.same_by)),
                  'same_me', (me() = any(n.same_by)),
                  'done_at', case when is_admin() then n.done_at end, 'apply_status', case when is_admin() then n.apply_status end) order by n.created_at)
                from meeting_notes n left join staff a on a.id = n.author_id where n.meeting_id = m.id), '[]'::json)
   ) end
   from (select 1) one left join meetings m on m.id = p_meeting $$;

revoke all on function public.admin_set_meeting_md(uuid, uuid) from public, anon;
revoke all on function public.md_meeting_clock(uuid, uuid, text, timestamptz) from public, anon;
revoke all on function public.add_meeting_note(uuid, text, uuid) from public, anon;
revoke all on function public.meeting_note_same(uuid) from public, anon;
revoke all on function public.admin_meeting_note_act(uuid, text) from public, anon;
grant execute on function public.admin_set_meeting_md(uuid, uuid) to authenticated;
grant execute on function public.md_meeting_clock(uuid, uuid, text, timestamptz) to authenticated;
grant execute on function public.add_meeting_note(uuid, text, uuid) to authenticated;
grant execute on function public.meeting_note_same(uuid) to authenticated;
grant execute on function public.admin_meeting_note_act(uuid, text) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where (table_name = 'meetings' and column_name in ('md_id', 'clock_started_at'))
  or (table_name = 'meeting_notes' and column_name in ('parent_id', 'same_by', 'done_at', 'apply_status', 'apply_at'))) || ' of 7 columns · '
  || (select count(*) from pg_proc where proname in ('admin_set_meeting_md', 'md_meeting_clock', 'meeting_note_same', 'admin_meeting_note_act')) || ' of 4 functions';
