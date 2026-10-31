-- Push 26 (Oct 31): the Events-sheet script gets paid travel (hours) and gas ($ for drivers) per person.
drop function if exists public.hours_sheet(text, date);
create function public.hours_sheet(p_token text, p_date date)
returns table(event_id uuid, title text, address text, department text, ev_start timestamptz, position_code text, full_name text,
              planned_start timestamptz, punch_in timestamptz, punch_out timestamptz, attendance text, travel_h numeric, gas numeric)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'sheet_token') then raise exception 'not allowed'; end if;
  return query
    select e.id, e.title, coalesce(e.address, v.address), e.department, min(s.planned_start) over (partition by e.id),
           s.position_code, st.full_name, s.planned_start, p.punch_in, case when p.punch_out <= now() then p.punch_out end,
           coalesce(s.attendance, case when s.left_early then 'left_early' end),
           case when e.transport and s.attendance is null then round(coalesce(e.paid_travel_min, 0) / 60.0, 2) else 0 end,
           case when e.transport and s.attendance is null and exists (
             select 1 from ride_offers ro where ro.event_id = e.id and ro.staff_id = s.staff_id and ro.kind = 'driver' and ro.sent_at is not null
               and exists (select 1 from ride_offers rr where rr.event_id = e.id and rr.kind = 'rider' and rr.car_driver_id = s.staff_id))
             then coalesce(e.gas_per_car, 20) end
      from shifts s join events e on e.id = s.event_id join staff st on st.id = s.staff_id
      left join venues v on v.id = e.venue_id left join punches p on p.shift_id = s.id
     where e.event_date = p_date and s.status <> 'declined'
     order by 5, e.id, s.planned_start, (s.position_code in ('MD','BM')) desc, st.full_name;
end $$;
revoke all on function public.hours_sheet(text, date) from public;
grant execute on function public.hours_sheet(text, date) to anon, authenticated, service_role;

select count(*) as rows_today from public.hours_sheet((select value from app_secrets where name = 'sheet_token'), current_date);
