-- 105 · Fix (Nov 10, 2026 · push 79c): the "Can add expenses" switch turned itself off. Staff updates go through
-- column grants (only their own sizes, phone, language, theme…), so admin changes to can_expense need a function.
create or replace function public.admin_set_can_expense(p_staff uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update staff set can_expense = p_on where id = p_staff;
end $$;
revoke all on function public.admin_set_can_expense(uuid, boolean) from public, anon;
grant execute on function public.admin_set_can_expense(uuid, boolean) to authenticated;
select 'RESULT ' || (select count(*) from pg_proc where proname = 'admin_set_can_expense') || ' function';
