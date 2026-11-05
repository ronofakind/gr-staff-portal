-- 060 · Ronnie marks someone confirmed (they texted him). Same as respond_to_shift('confirmed'), plus who did it.
alter table public.shifts add column if not exists confirmed_by uuid references public.staff(id) on delete set null;

create or replace function public.admin_mark_confirmed(p_shift uuid, p_on boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  if p_on then
    update shifts set status = 'confirmed', responded_at = now(), confirmed_by = me() where id = p_shift and status <> 'declined';
  else
    update shifts set status = 'booked', responded_at = null, confirmed_by = null where id = p_shift and status = 'confirmed';
  end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'shift', p_shift, jsonb_build_object('status', case when p_on then 'confirmed' else 'booked' end, 'by_admin', true));
end $$;
revoke all on function public.admin_mark_confirmed(uuid, boolean) from public;
grant execute on function public.admin_mark_confirmed(uuid, boolean) to authenticated;

-- A staff tapping Confirm themselves clears the "by Ronnie" marker.
create or replace function public.respond_to_shift(p_shift uuid, p_response text)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_response not in ('confirmed','declined') then raise exception 'bad response'; end if;
  update shifts set status = p_response, responded_at = now(), confirmed_by = null
   where id = p_shift and staff_id = me();
  if not found then raise exception 'not your shift'; end if;
  insert into change_log(by_staff, entity, entity_id, change)
  values (me(), 'shift', p_shift, jsonb_build_object('status', p_response));
end $$;

select (select count(*) from pg_proc where proname = 'admin_mark_confirmed') as function_ok,
       (select count(*) from information_schema.columns where table_name = 'shifts' and column_name = 'confirmed_by') as column_ok;
