-- 096 · Onboarding extras (Nov 10, 2026 · push 71). Safe to run twice.
-- Day-2 nudge to the new hire (once) · Junior table-service OK · first gig → QuickBooks + payroll sheet (one Yes).

alter table public.staff_onboarding add column if not exists nudge_at       timestamptz; -- day-2 phone alert sent (once)
alter table public.staff_onboarding add column if not exists table_ok_at    timestamptz; -- Junior → table service OK (all event types)
alter table public.staff_onboarding add column if not exists firstgig_at    timestamptz; -- Ronnie said Yes on the first-gig card
alter table public.staff_onboarding add column if not exists payroll_status text check (payroll_status in ('sending', 'done', 'error'));
alter table public.staff_onboarding add column if not exists payroll_for    date;        -- the gig date → which pay period tab
alter table public.staff_onboarding add column if not exists payroll_note   text;
alter table public.staff_onboarding add column if not exists payroll_at     timestamptz;

-- Day 2 after Accept, still not finished → one alert to the new hire. Runs every hour.
create or replace function public.onboard_tick() returns int
language plpgsql security definer set search_path = public as
$$ declare r record; n int := 0; begin
  for r in select o.staff_id, o.hb_done_at, o.paid_by, o.tax_done_at
             from staff_onboarding o
            where o.nudge_at is null and o.created_at <= now() - interval '2 days' and o.created_at > now() - interval '30 days'
              and (o.hb_done_at is null or (o.paid_by = 'payroll' and o.tax_done_at is null)) loop
    perform _alert_add(r.staff_id, 'changed', 'onboard2:' || r.staff_id,
      '📘 Finish getting started',
      case when r.hb_done_at is null then 'Finish the G&R Standard to start getting dates.'
           else 'Add your tax and pay info before your first shift.' end,
      '👉 Tap to continue', '/', null, '{}', '[]', 'gr-onboard-' || r.staff_id);
    update staff_onboarding set nudge_at = now() where staff_id = r.staff_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.onboard_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'gr-onboard';
select cron.schedule('gr-onboard', '17 * * * *', 'select public.onboard_tick()');

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'staff_onboarding' and column_name in ('nudge_at', 'table_ok_at', 'firstgig_at', 'payroll_status', 'payroll_for', 'payroll_note', 'payroll_at')) || ' of 7 columns · '
  || (select count(*) from cron.job where jobname = 'gr-onboard') || ' timer';
