-- 099 · Ride plans seen on the account, not the phone (push 73, Nov 10, 2026). Safe to run twice.
alter table public.ride_offers add column if not exists seen_at timestamptz;

-- The plan was (re)sent → it counts as unseen again.
create or replace function public.ride_offer_resent() returns trigger language plpgsql as
$$ begin
  if new.sent_at is distinct from old.sent_at then new.seen_at := null; end if;
  return new;
end $$;
drop trigger if exists ride_offers_resent on public.ride_offers;
create trigger ride_offers_resent before update of sent_at on public.ride_offers for each row execute function public.ride_offer_resent();

-- Got it (staff, own row only).
create or replace function public.ride_got_it(p_event uuid) returns void
language plpgsql security definer set search_path = public as
$$ begin
  update ride_offers set seen_at = now() where event_id = p_event and staff_id = me() and sent_at is not null and seen_at is null;
end $$;
grant execute on function public.ride_got_it(uuid) to authenticated;

-- Admin: who has / hasn't seen the plan for an event · and tonight / tomorrow unseen (Today).
create or replace function public.admin_rides_seen(p_event uuid)
returns table (staff_id uuid, full_name text, phone text, kind text, sent_at timestamptz, seen_at timestamptz)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query select o.staff_id, st.full_name, st.phone, o.kind, o.sent_at, o.seen_at
    from ride_offers o join staff st on st.id = o.staff_id
   where o.event_id = p_event and o.sent_at is not null and o.kind <> 'own' order by o.seen_at nulls first, st.full_name;
end $$;
grant execute on function public.admin_rides_seen(uuid) to authenticated;

create or replace function public.admin_unseen_rides()
returns table (staff_id uuid, full_name text, phone text, event_id uuid, event_title text, event_date date)
language plpgsql stable security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query select o.staff_id, st.full_name, st.phone, o.event_id, e.title, e.event_date
    from ride_offers o join staff st on st.id = o.staff_id join events e on e.id = o.event_id
   where o.sent_at is not null and o.seen_at is null and o.kind <> 'own'
     and e.event_date between (now() at time zone 'America/Toronto')::date and (now() at time zone 'America/Toronto')::date + 1
     and exists (select 1 from shifts s where s.event_id = o.event_id and s.staff_id = o.staff_id and s.status <> 'declined' and s.attendance is null)
   order by e.event_date, st.full_name;
end $$;
grant execute on function public.admin_unseen_rides() to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'ride_offers' and column_name = 'seen_at') || ' column · '
  || (select count(*) from pg_proc where proname in ('ride_got_it', 'admin_rides_seen', 'admin_unseen_rides')) || ' of 3 functions';
