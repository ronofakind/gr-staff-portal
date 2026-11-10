-- Push 66 · Overbooked → "Want the night off?" (board NightOffV1, Nov 10).
-- Ronnie asks ONE booked person at a time (never MDs / managers, never locked). Only they see a private card + phone alert.
-- Yes = released right away (shift removed: off Bookings and the manager's My teams), no reliability hit, MD not told.
-- No / no answer in 2 h = they keep the shift.
create table if not exists public.night_off_asks (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  shift_id    uuid references public.shifts(id) on delete set null,
  staff_id    uuid not null references public.staff(id) on delete cascade,
  asked_by    uuid references public.staff(id) on delete set null,
  asked_at    timestamptz not null default now(),
  due_at      timestamptz not null,
  answer      text check (answer in ('yes', 'no')),
  answered_at timestamptz,
  cancelled_at timestamptz,
  card        jsonb not null default '{}'   -- {venue, date, start, position} as it was when asked
);
create index if not exists night_off_asks_event on public.night_off_asks (event_id);
alter table public.night_off_asks enable row level security;
drop policy if exists admin_all on public.night_off_asks;
create policy admin_all on public.night_off_asks for all using (is_admin()) with check (is_admin());
drop policy if exists own_read on public.night_off_asks;
create policy own_read on public.night_off_asks for select using (staff_id = me());

create or replace function public.admin_night_off_ask(p_shift uuid, p_minutes int default 120)
returns uuid language plpgsql security definer set search_path = public as
$$ declare s record; v_due timestamptz; v_id uuid; v_card jsonb; begin
  if not is_admin() then raise exception 'Only an admin can ask.'; end if;
  select sh.id, sh.staff_id, sh.event_id, sh.position_code, sh.position_detail, sh.planned_start, sh.status, sh.attendance, sh.cancelled_at,
         e.event_date, e.title into s
    from shifts sh join events e on e.id = sh.event_id where sh.id = p_shift;
  if s.id is null or s.status = 'declined' or s.attendance is not null or s.cancelled_at is not null then raise exception 'This shift is no longer active.'; end if;
  if coalesce(s.position_code, '') in ('MD', 'BM') then raise exception 'Never ask an MD or manager.'; end if;
  if s.planned_start <= now() + interval '30 minutes' then raise exception 'Too close to the shift.'; end if;
  if exists (select 1 from night_off_asks a where a.event_id = s.event_id and a.answer is null and a.cancelled_at is null and a.due_at > now()) then
    raise exception 'Someone is still answering for this event.'; end if;
  v_due := least(now() + make_interval(mins => greatest(15, coalesce(p_minutes, 120))), s.planned_start - interval '30 minutes');
  v_card := jsonb_build_object('venue', s.title, 'date', s.event_date, 'start', s.planned_start, 'position', coalesce(s.position_detail, s.position_code));
  insert into night_off_asks(event_id, shift_id, staff_id, asked_by, due_at, card)
    values (s.event_id, s.id, s.staff_id, me(), v_due, v_card) returning id into v_id;
  insert into alert_queue(staff_id, kind, send_key, title, body, cta, url, data, for_date)
    values (s.staff_id, 'changed', 'nightoff:' || v_id, '🌙 Want the night off?',
            s.title || ' · ' || to_char(s.event_date, 'Dy Mon FMDD') || ' · ' || to_char(s.planned_start at time zone 'America/Toronto', 'FMHH12:MI AM')
              || '. We have one more person than we need. Answer by {by}.',
            '👉 Tap to answer', '/', jsonb_build_object('by', v_due, 'shift_id', s.id, 'night_off_id', v_id), s.event_date)
    on conflict do nothing;
  return v_id;
end $$;

create or replace function public.admin_night_off_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'Only an admin.'; end if;
  update night_off_asks set cancelled_at = now() where id = p_id and answer is null and cancelled_at is null;
  update alert_queue set sent_at = now(), via = 'gone', note = 'ask cancelled' where send_key = 'nightoff:' || p_id and sent_at is null;
end $$;

-- Staff: my open night-off asks (only mine, only open).
create or replace function public.my_night_off()
returns table(id uuid, due_at timestamptz, card jsonb)
language sql stable security definer set search_path = public as
$$ select a.id, a.due_at, a.card from night_off_asks a join shifts s on s.id = a.shift_id
    where a.staff_id = me() and a.answer is null and a.cancelled_at is null and a.due_at > now()
      and s.attendance is null and s.status <> 'declined'
    order by a.asked_at $$;

create or replace function public.night_off_answer(p_id uuid, p_yes boolean)
returns text language plpgsql security definer set search_path = public as
$$ declare a night_off_asks%rowtype; begin
  select * into a from night_off_asks where id = p_id for update;
  if a.id is null or a.staff_id is distinct from me() then raise exception 'not allowed'; end if;
  if a.answer is not null then return a.answer; end if;
  if a.cancelled_at is not null or a.due_at <= now() or a.shift_id is null then return 'closed'; end if;
  update night_off_asks set answer = case when p_yes then 'yes' else 'no' end, answered_at = now() where id = p_id;
  if p_yes then
    insert into change_log(by_staff, entity, entity_id, change)
      values (me(), 'shift', a.shift_id, jsonb_build_object('kind', 'night_off', 'ask', a.id, 'event_id', a.event_id, 'card', a.card));
    delete from shifts where id = a.shift_id;
  end if;
  return case when p_yes then 'yes' else 'no' end;
end $$;

grant execute on function public.admin_night_off_ask(uuid, int), public.admin_night_off_cancel(uuid), public.my_night_off(), public.night_off_answer(uuid, boolean) to authenticated;
