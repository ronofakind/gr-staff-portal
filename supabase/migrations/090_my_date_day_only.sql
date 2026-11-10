-- Push 64 · "Yes · Day only, from… until…" when answering a date (board AvailUntilV1).
-- answer_my_date clears until_time; the app calls this right after a Yes that is day only.
create or replace function public.set_my_until(p_id uuid, p_from time, p_until time)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if p_until is not null and p_from is not null and p_until <= p_from then raise exception 'Until must be after From.'; end if;
  update availability set from_time = p_from, until_time = p_until
   where id = p_id and staff_id = me() and status = 'yes' and for_date >= (now() at time zone 'America/Toronto')::date;
  if not found then raise exception 'not yours'; end if;
end $$;
revoke all on function public.set_my_until(uuid, time, time) from public;
grant execute on function public.set_my_until(uuid, time, time) to authenticated;
