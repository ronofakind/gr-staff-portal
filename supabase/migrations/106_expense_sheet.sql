-- 106 · Approved expenses → Staff Payroll sheet (Nov 10, 2026 · push 79e). Safe to run twice.
-- The 8 AM task copies approved expenses into the payroll sheet (side by side with the app) and reports back here.
alter table public.expenses add column if not exists sheet_status text check (sheet_status in ('done', 'error'));
alter table public.expenses add column if not exists sheet_note   text;
alter table public.expenses add column if not exists sheet_at     timestamptz;
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'expenses' and column_name in ('sheet_status', 'sheet_note', 'sheet_at')) || ' of 3 columns';
