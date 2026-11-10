-- 059 · Admins can edit any staff field from the admin (name, email, role, active, tier side stays in staff_private).
-- Column grants (001/006) only let staff update their own phone/photo/sizes, which also blocked admin edits ("permission denied for table staff").
create or replace function public.admin_staff_update(p_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text;
  allowed text[] := array['full_name','email','phone','language','department','role','active','positions','sex','nickname','md_rank','photo_url'];
begin
  if not is_admin() then raise exception 'Admins only.'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k = any(allowed) then
      execute format('update public.staff set %1$I = (jsonb_populate_record(null::public.staff, $1)).%1$I where id = $2', k) using p_patch, p_id;
    end if;
  end loop;
end $$;
revoke all on function public.admin_staff_update(uuid, jsonb) from public;
grant execute on function public.admin_staff_update(uuid, jsonb) to authenticated;
select (select count(*) from pg_proc where proname = 'admin_staff_update') as function_ok;
