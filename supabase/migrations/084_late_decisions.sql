-- 084 · Count a late arrival or not, one by one (Nov 8, 2026 · push 57). Admin only. Safe to run twice.
-- No row = the default from Settings → "Late counts in reliability" (off for now).
create table if not exists public.late_decisions (
  shift_id   uuid primary key references public.shifts(id) on delete cascade,
  decision   text not null check (decision in ('count', 'skip')),
  decided_at timestamptz not null default now()
);
alter table public.late_decisions enable row level security;
drop policy if exists ld_admin on public.late_decisions;
create policy ld_admin on public.late_decisions for all to authenticated using (is_admin()) with check (is_admin());
select 'RESULT ' || (select count(*) from pg_tables where tablename = 'late_decisions') || ' table' as result;
