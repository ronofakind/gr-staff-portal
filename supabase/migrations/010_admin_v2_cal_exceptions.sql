-- ───────── Pay periods (semi-monthly: 1–15, 16–end). Closing locks manager edits. ─────────
create table if not exists public.pay_periods (
  start_date date primary key,
  end_date   date not null,
  closed_at  timestamptz,
  closed_by  uuid references public.staff(id)
);
alter table public.pay_periods enable row level security;
drop policy if exists admin_all on public.pay_periods;
create policy admin_all on public.pay_periods for all using (is_admin()) with check (is_admin());

create or replace function public.period_closed(p_date date) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from pay_periods where p_date between start_date and end_date and closed_at is not null) $$;

-- Same rules as 007, plus: no manager edits once the pay period is closed.
create or replace function public.manager_set_punch(p_shift uuid, p_in timestamptz, p_out timestamptz)
returns void language plpgsql security definer set search_path = public as
$$ declare ev uuid; ev_date date; call_at timestamptz; begin
  select s.event_id, e.event_date, s.planned_start into ev, ev_date, call_at
    from shifts s join events e on e.id = s.event_id where s.id = p_shift;
  if not (is_admin() or manages(ev)) then raise exception 'not allowed'; end if;
  if not is_admin() then
    if period_closed(ev_date) then
      raise exception 'This pay period is closed. Ask Ronnie to change the time.';
    end if;
    if (now() at time zone 'America/Toronto')::date < ev_date then
      raise exception 'Times can only be entered on the day of the event.';
    end if;
    if p_in is not null and p_in < call_at - interval '6 hours' then
      raise exception 'Start time is more than 6 hours before the call time.';
    end if;
    if (p_in is not null and p_in > now() + interval '10 minutes') or (p_out is not null and p_out > now() + interval '10 minutes') then
      raise exception 'Times in the future can''t be saved.';
    end if;
    if p_in is not null and p_out is not null and p_out <= p_in then
      raise exception 'End time must be after the start time.';
    end if;
  end if;
  insert into punches(shift_id, punch_in, punch_out, edited_by, updated_at)
  values (p_shift, p_in, p_out, me(), now())
  on conflict (shift_id) do update set punch_in = excluded.punch_in, punch_out = excluded.punch_out,
     edited_by = me(), updated_at = now();
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'punch', p_shift, jsonb_build_object('in', p_in, 'out', p_out));
end $$;

-- ───────── Days someone is usually not free but opened up ─────────
create table if not exists public.avail_exceptions (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  for_date   date not null,
  created_at timestamptz not null default now(),
  primary key (staff_id, for_date)
);
alter table public.avail_exceptions enable row level security;
drop policy if exists admin_all on public.avail_exceptions;
drop policy if exists own on public.avail_exceptions;
create policy admin_all on public.avail_exceptions for all using (is_admin()) with check (is_admin());
create policy own on public.avail_exceptions for all using (staff_id = me()) with check (staff_id = me());

-- ───────── Own "Add to calendar" link: /api/cal?t=<token> ─────────
alter table public.shifts add column if not exists cal_token uuid not null default gen_random_uuid();
create unique index if not exists shifts_cal_token on public.shifts (cal_token);

create or replace function public.cal_event(p_token uuid)
returns json language sql stable security definer set search_path = public as
$$ select json_build_object(
     'uid', s.id, 'title', e.title, 'event_date', e.event_date,
     'start', s.planned_start, 'end', s.planned_end, 'arrive_min', s.arrive_before_min, 'time_tbc', s.time_tbc,
     'address', coalesce(e.address, v.address, ''), 'venue', coalesce(v.name, e.title),
     'role', coalesce(nullif(s.position_detail, ''), s.position_code, ''),
     'uniform', coalesce(s.uniform, case when s.position_code in ('BM','BT','BB') then e.uniform_bar else e.uniform_floor end),
     'dress', coalesce(e.dress_code, ''), 'description', coalesce(e.description, ''),
     'md_name', md.full_name, 'md_phone', md.phone)
   from shifts s join events e on e.id = s.event_id
   left join venues v on v.id = e.venue_id
   left join lateral (select st.full_name, st.phone from shifts m join staff st on st.id = m.staff_id
                       where m.event_id = e.id and m.position_code = 'MD' limit 1) md on true
  where s.cal_token = p_token and s.status <> 'declined' $$;
grant execute on function public.cal_event(uuid) to anon, authenticated;
