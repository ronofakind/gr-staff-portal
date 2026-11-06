-- 072 · ⏳ To be confirmed events (Nov 6, 2026)
-- Ronnie books the team early for an event the client hasn't confirmed. Staff see "To be confirmed" and "Keep the date".
-- Safe to run twice.
alter table public.events add column if not exists tentative boolean not null default false;
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'events' and column_name = 'tentative') || ' col' as result;
