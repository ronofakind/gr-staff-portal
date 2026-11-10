-- Push 64 · Day-only availability (from… until…) + "Ask to be first cut" (board AvailUntilV1).
-- Usual week: a day can now carry an end time ("Day only · 8 AM–3 PM"). Existing rows keep until_time null = no change.
alter table public.staff_weekly add column if not exists until_time time;

-- Booked shift: staff can ask to be cut first until the shift starts, and undo it. Managers / admin only see it.
alter table public.shifts add column if not exists cut_first_at timestamptz;

create or replace function public.cut_first(p_shift uuid, p_on boolean)
returns timestamptz language plpgsql security definer set search_path = public as
$$ declare s record; v timestamptz;
begin
  select id, staff_id, cancelled_at, planned_start into s from shifts where id = p_shift;
  if s.id is null or s.staff_id is distinct from me() then raise exception 'not allowed'; end if;
  if s.cancelled_at is not null then raise exception 'shift cancelled'; end if;
  if s.planned_start <= now() then raise exception 'shift started'; end if;
  v := case when p_on then now() end;
  update shifts set cut_first_at = v where id = p_shift;
  return v;
end $$;
grant execute on function public.cut_first(uuid, boolean) to authenticated;
