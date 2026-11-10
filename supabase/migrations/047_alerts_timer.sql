-- 047 · Supabase timer for phone alerts (push 42 follow-up, Nov 2, 2026)
-- Every 5 minutes pg_cron writes a one-time token and pg_net calls /api/alerts?tick=<token>.
-- The API checks the token with the service key (alerts_claim_tick), so no extra secret is needed.
-- Safe to run twice.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.alert_ticks (
  token uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.alert_ticks enable row level security;   -- no policies: only security definer functions / service role

create or replace function public.alerts_claim_tick(p_token text)
returns boolean language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update alert_ticks set used_at = now()
   where token::text = p_token and used_at is null and created_at > now() - interval '3 minutes';
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.alerts_claim_tick(text) from public, anon, authenticated;
grant execute on function public.alerts_claim_tick(text) to service_role;

create or replace function public.alerts_fire_tick()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare t uuid;
begin
  delete from alert_ticks where created_at < now() - interval '1 day';
  insert into alert_ticks default values returning token into t;
  perform net.http_get(url := 'https://gr-staff-portal.vercel.app/api/alerts?tick=' || t::text, timeout_milliseconds := 30000);
end $$;
revoke all on function public.alerts_fire_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'gr-alerts-tick';
select cron.schedule('gr-alerts-tick', '*/5 * * * *', 'select public.alerts_fire_tick()');

-- ───────── check ─────────
select (select count(*) from cron.job where jobname = 'gr-alerts-tick') job_1,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('alerts_claim_tick', 'alerts_fire_tick')) fns_2;
