-- 080 · Today v4 (Nov 8, 2026): archive debriefs + new staff ratings from Today (kept forever in the Past tabs),
--        and Ronnie's own Today layout (order / pins / open-folded-hidden), saved per admin so desktop and phone match.
-- Admin only. Safe to run twice.
alter table public.event_debriefs add column if not exists archived_at timestamptz;
alter table public.staff_feedback add column if not exists today_archived_at timestamptz;

create table if not exists public.admin_prefs (
  user_id    uuid not null default auth.uid(),
  key        text not null,
  value      jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.admin_prefs enable row level security;
drop policy if exists ap_own on public.admin_prefs;
create policy ap_own on public.admin_prefs for all to authenticated
  using (is_admin() and user_id = auth.uid()) with check (is_admin() and user_id = auth.uid());

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'event_debriefs' and column_name = 'archived_at') || ' · '
    || (select count(*) from information_schema.columns where table_name = 'staff_feedback' and column_name = 'today_archived_at') || ' · '
    || (select count(*) from pg_tables where tablename = 'admin_prefs') as result;
