-- 130 · Nov 17 2026 · lock the leftover backup table (Supabase security alert rls_disabled_in_public). Run by Ronnie's OK ("yes run 130").
alter table if exists public._pool_backup_nov11 enable row level security;
revoke all on table public._pool_backup_nov11 from anon, authenticated;
