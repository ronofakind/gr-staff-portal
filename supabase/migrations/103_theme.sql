-- 103 · App colours (Nov 10, 2026 · push 78). Each person's own theme: Classic (default) or Dark. Safe to run twice.
alter table public.staff add column if not exists theme text check (theme in ('classic', 'dark'));
grant update (theme) on public.staff to authenticated;   -- they can change their own (staff_self_update policy), nothing else new
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'staff' and column_name = 'theme') || ' of 1 column';
