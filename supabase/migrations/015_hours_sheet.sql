-- Read-only feed for the "APP · <DATE>" tabs in Events 2026 (Apps Script pulls it with a token).
create or replace function public.hours_sheet(p_token text, p_date date)
returns table(event_id uuid, title text, address text, department text, ev_start timestamptz,
              position_code text, full_name text, planned_start timestamptz,
              punch_in timestamptz, punch_out timestamptz, attendance text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'sheet_token') then
    raise exception 'not allowed';
  end if;
  return query
    select e.id, e.title, coalesce(e.address, v.address), e.department,
           min(s.planned_start) over (partition by e.id),
           s.position_code, st.full_name, s.planned_start,
           p.punch_in, case when p.punch_out <= now() then p.punch_out end, s.attendance
      from shifts s join events e on e.id = s.event_id join staff st on st.id = s.staff_id
      left join venues v on v.id = e.venue_id left join punches p on p.shift_id = s.id
     where e.event_date = p_date and s.status <> 'declined'
     order by 5, e.id, s.planned_start, (s.position_code in ('MD','BM')) desc, st.full_name;
end $$;
revoke all on function public.hours_sheet(text, date) from public;
grant execute on function public.hours_sheet(text, date) to anon, authenticated;
insert into app_secrets(name, value) values ('sheet_token', encode(gen_random_bytes(24), 'hex')) on conflict (name) do nothing;
