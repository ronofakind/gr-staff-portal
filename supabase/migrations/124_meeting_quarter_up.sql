-- 124 · Meetings are paid by the quarter hour, rounded UP, at least 15 minutes (Ronnie, Nov 12: "the meeting today was 15 mins so .25").
-- Before: rounded to the nearest 15 min, so a 6-minute clock (11:21 → 11:27) paid 0 h. Safe to run twice; same function, one line changed.
create or replace function public._meeting_pay(p_from date, p_to date)
returns table(meeting_id uuid, staff_id uuid, full_name text, title text, meeting_date date, starts_at timestamptz, duration_min int,
              answer text, paid boolean, auto boolean, paid_in timestamptz, paid_out timestamptz, hours numeric, ended boolean, edited_at timestamptz)
language sql stable security definer set search_path = public as
$$ select x.mid, x.sid, x.nm, x.ttl, x.md, x.st, x.dur, x.ans, x.pd, x.au,
          x.pin, x.pout, case when x.pd and x.pout > x.pin then greatest(0.25, ceil(extract(epoch from (x.pout - x.pin)) / 900) * 0.25) else 0 end, x.pout <= now(), x.ed
     from (select m.id as mid, i.staff_id as sid, s.full_name as nm, m.title as ttl, (m.starts_at at time zone 'America/Toronto')::date as md,
                  m.starts_at as st, m.duration_min as dur, i.answer as ans,
                  coalesce(i.paid, case when m.clock_started_at is not null then i.paid_in is not null else i.answer = 'coming' end) as pd,
                  i.paid is null as au,
                  coalesce(i.paid_in, m.starts_at) as pin,
                  coalesce(i.paid_out, greatest(coalesce(i.paid_in, m.starts_at), m.starts_at + make_interval(mins => m.duration_min))) as pout,
                  i.hours_edited_at as ed
             from meeting_invites i join meetings m on m.id = i.meeting_id join staff s on s.id = i.staff_id
            where m.cancelled_at is null
              and (m.starts_at at time zone 'America/Toronto')::date between p_from and p_to) x
    order by x.st, x.nm $$;
revoke execute on function public._meeting_pay(date, date) from public, anon, authenticated;

select string_agg(full_name || ' ' || hours, ' · ') as r from public._meeting_pay('2026-11-12', '2026-11-12');
