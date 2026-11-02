-- Push 35 (Nov 2): My dates tab (Answer · Booked · Answered + Calendar), answer-by per staff + date,
-- Maybe with "knows by" + note, "Don't know your schedule yet?", reminder on Home, admin counts per date.
-- File only: apply by hand in the SQL editor. Safe to run twice (if not exists / create or replace / drop … if exists).
-- Nothing existing is dropped. answer_availability() (026) stays as it was (old clients keep working).
--
-- What already existed and is reused:
--   availability.status ('asked','yes','no','maybe') · from_time (009, null = any time) · note (026) · ask_id / asked_at (009)
--   avail_asks.reply_by (009) stays as the ask's default; it is only read by the backfill below.
--   me() / is_admin() (001) · RLS on availability: admin_all + staff_avail (select own). Staff never update the table
--   directly (009 dropped staff_avail_answer); they answer through the security definer functions below.

-- ───────── columns ─────────
alter table public.availability add column if not exists answer_by  timestamptz;
alter table public.availability add column if not exists knows_by   date;
alter table public.availability add column if not exists knows_note text;
comment on column public.availability.answer_by  is 'push 35c · answer by this time. Filled when the date is sent (default_answer_by), editable by admin. After it passes, an unanswered date leaves the staff Answer tab and shows to Ronnie as Waiting.';
comment on column public.availability.knows_by   is 'push 35d · Maybe: the day they will know (never after answer_by). Home shows the reminder card from that day.';
comment on column public.availability.knows_note is 'push 35b · optional note for Ronnie with a Maybe ("Waiting for my school schedule").';
create index if not exists availability_staff_date on public.availability (staff_id, for_date);

-- ───────── 35c · answer-by rule ─────────
-- 0–7 days away → 24 h after sending · 8–14 → 48 h · 15–30 → 1 week · 30+ → 2 weeks.
-- Never later than noon (Montreal) on the date itself; a same-day ask still gets at least 2 hours.
create or replace function public.default_answer_by(p_for date, p_sent timestamptz default now())
returns timestamptz language sql stable set search_path = public as
$$ select greatest(least(r, cap), least(r, p_sent + interval '2 hours'))
     from (select p_sent + case when away <= 7 then interval '24 hours' when away <= 14 then interval '48 hours'
                                when away <= 30 then interval '7 days' else interval '14 days' end as r, cap
             from (select p_for - (p_sent at time zone 'America/Toronto')::date as away,
                          ((p_for + time '12:00') at time zone 'America/Toronto') as cap) x) y $$;

-- Every way of sending dates (admin Availability, Bookings "Ask more people", event form) inserts 'asked' rows:
-- fill answer_by there when the sender didn't set one (the admin Availability page sends its ✎ value).
create or replace function public.availability_answer_by() returns trigger
language plpgsql set search_path = public as
$$ begin
  if new.status = 'asked' and new.ask_id is not null and new.answer_by is null then
    new.answer_by := default_answer_by(new.for_date, least(coalesce(new.asked_at, now()), now()));
  end if;
  return new;
end $$;
drop trigger if exists availability_answer_by on public.availability;
create trigger availability_answer_by before insert or update on public.availability
  for each row execute function public.availability_answer_by();

-- Backfill (dates from today on, sent through an ask):
--   reply_by set and its end of day (23:59 Montreal) still ahead → that.
--   otherwise → the 35c rule counted from now, so nobody's open dates disappear the moment this runs.
update public.availability a
   set answer_by = case
         when k.reply_by is not null and ((k.reply_by + time '23:59') at time zone 'America/Toronto') > now()
           then ((k.reply_by + time '23:59') at time zone 'America/Toronto')
         else public.default_answer_by(a.for_date, now()) end
  from public.avail_asks k
 where k.id = a.ask_id and a.answer_by is null
   and a.for_date >= (now() at time zone 'America/Toronto')::date;

-- ───────── staff: my dates (with the venue, never the client) ─────────
-- venue = the event title (001: "what staff see: venue name, never the client") when exactly one event of that
-- department is on the date and its details are final; n_events lets the app say "2 events".
-- p_staff is for the admin "view as" preview only (ignored for everyone else).
create or replace function public.my_dates(p_staff uuid default null)
returns table(id uuid, for_date date, part text, status text, from_time time, answer_by timestamptz, knows_by date,
              knows_note text, label text, approx_start time, venue text, n_events int, booked boolean)
language sql stable security definer set search_path = public as
$$ select a.id, a.for_date, a.part, a.status, a.from_time, a.answer_by, a.knows_by, a.knows_note,
          k.label, k.approx_start, v.venue, coalesce(v.n, 0),
          exists (select 1 from shifts s join events e on e.id = s.event_id
                   where s.staff_id = a.staff_id and e.event_date = a.for_date
                     and s.status <> 'declined' and s.attendance is distinct from 'cancelled')
     from availability a
     left join avail_asks k on k.id = a.ask_id
     left join lateral (
       select case when count(*) = 1 and bool_and(not coalesce(e.details_pending, false)) then max(e.title) end as venue,
              count(*)::int as n
         from events e
        where e.event_date = a.for_date
          and case when k.department = 'bar' then e.department = 'bar' else e.department <> 'bar' end) v on true
    where a.staff_id = case when p_staff is not null and is_admin() then p_staff else me() end
      and a.ask_id is not null
      and a.for_date >= (now() at time zone 'America/Toronto')::date
    order by a.for_date $$;

-- Tab bar badge: dates waiting on me (asked, or a Maybe whose knows-by day came), answer-by not passed, not booked.
create or replace function public.my_dates_to_answer()
returns int language sql stable security definer set search_path = public as
$$ select count(*)::int from my_dates() d
    where not d.booked and (d.answer_by is null or d.answer_by > now())
      and (d.status = 'asked' or (d.status = 'maybe' and d.knows_by <= (now() at time zone 'America/Toronto')::date)) $$;

-- ───────── staff: answer one date ─────────
-- Yes (+ from time, null = any time) · Maybe (+ knows_by, never after answer_by; optional note) · No (never a reason).
-- An unanswered date can't be answered after its answer-by (it shows to Ronnie as Waiting); answered dates can be
-- changed until the date. A booked date can't become No / Maybe here (Can't make it, push 28).
create or replace function public.answer_my_date(p_id uuid, p_status text, p_from time default null,
                                                 p_knows_by date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as
$$ declare r availability%rowtype; today date := (now() at time zone 'America/Toronto')::date; latest date;
begin
  if p_status not in ('yes','maybe','no') then raise exception 'bad answer'; end if;
  select * into r from availability where id = p_id and staff_id = me() for update;
  if r.id is null then raise exception 'not yours'; end if;
  if r.for_date < today then raise exception 'This date has passed.'; end if;
  if r.status = 'asked' and r.answer_by is not null and r.answer_by <= now() then
    raise exception 'The answer-by time has passed. Talk to Ronnie.';
  end if;
  if p_status <> 'yes' and exists (select 1 from shifts s join events e on e.id = s.event_id
       where s.staff_id = r.staff_id and e.event_date = r.for_date and s.status <> 'declined' and s.attendance is distinct from 'cancelled') then
    raise exception 'You''re booked on this date. Use Can''t make it on the shift.';
  end if;
  if p_status = 'maybe' then
    latest := coalesce((r.answer_by at time zone 'America/Toronto')::date, r.for_date - 1);
    if p_knows_by is null then raise exception 'Pick when you will know.'; end if;
    if p_knows_by < today then raise exception 'Pick today or a later day.'; end if;
    if p_knows_by > latest then raise exception 'Pick a day on or before %.', to_char(latest, 'Dy Mon FMDD'); end if;
  end if;
  update availability set status = p_status, answered_at = now(),
         from_time  = case when p_status = 'yes' then p_from end,
         until_time = null,
         note       = case when p_status = 'yes' then note end,
         knows_by   = case when p_status = 'maybe' then p_knows_by end,
         knows_note = case when p_status = 'maybe' then coalesce(nullif(trim(coalesce(p_note, '')), ''), knows_note) end
   where id = p_id;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'availability', p_id, jsonb_build_object('status', p_status, 'from', p_from, 'knows_by', p_knows_by,
          'note', nullif(trim(coalesce(p_note, '')), '')));
end $$;

-- ───────── staff: "Don't know your schedule yet?" / "Still not sure" ─────────
-- p_ids null → every unanswered open date of mine. p_ids given → those dates (asked or maybe), e.g. the reminder card.
-- All become Maybe · knows by p_knows_by (never after the earliest answer-by of those dates). Returns how many changed.
create or replace function public.dont_know_yet(p_knows_by date, p_note text default null, p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as
$$ declare today date := (now() at time zone 'America/Toronto')::date; latest date; ids uuid[]; n int;
begin
  if p_knows_by is null then raise exception 'Pick when you will know.'; end if;
  select array_agg(a.id), min(coalesce((a.answer_by at time zone 'America/Toronto')::date, a.for_date - 1)) into ids, latest
    from availability a
   where a.staff_id = me() and a.ask_id is not null and a.for_date >= today
     and (a.answer_by is null or a.answer_by > now())
     and (case when p_ids is null then a.status = 'asked' else a.id = any(p_ids) and a.status in ('asked','maybe') end)
     and not exists (select 1 from shifts s join events e on e.id = s.event_id
                      where s.staff_id = a.staff_id and e.event_date = a.for_date and s.status <> 'declined' and s.attendance is distinct from 'cancelled');
  if ids is null then return 0; end if;
  if p_knows_by < today then raise exception 'Pick today or a later day.'; end if;
  if p_knows_by > latest then raise exception 'Pick a day on or before %.', to_char(latest, 'Dy Mon FMDD'); end if;
  update availability a set status = 'maybe', answered_at = now(), from_time = null, until_time = null, note = null,
         knows_by = p_knows_by, knows_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), a.knows_note)
   where a.id = any(ids);
  get diagnostics n = row_count;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'availability', null, jsonb_build_object('dont_know_yet', to_jsonb(ids), 'knows_by', p_knows_by,
          'note', nullif(trim(coalesce(p_note, '')), '')));
  return n;
end $$;

-- ───────── grants ─────────
revoke all on function public.default_answer_by(date, timestamptz) from public;
revoke all on function public.my_dates(uuid) from public;
revoke all on function public.my_dates_to_answer() from public;
revoke all on function public.answer_my_date(uuid, text, time, date, text) from public;
revoke all on function public.dont_know_yet(date, text, uuid[]) from public;
grant execute on function public.default_answer_by(date, timestamptz) to authenticated;
grant execute on function public.my_dates(uuid) to authenticated;
grant execute on function public.my_dates_to_answer() to authenticated;
grant execute on function public.answer_my_date(uuid, text, time, date, text) to authenticated;
grant execute on function public.dont_know_yet(date, text, uuid[]) to authenticated;

-- Check: 3 new columns, 6 functions.
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'availability'
          and column_name in ('answer_by','knows_by','knows_note')) as columns,
       (select count(*) from pg_proc where proname in ('default_answer_by','availability_answer_by','my_dates',
          'my_dates_to_answer','answer_my_date','dont_know_yet')) as functions;
