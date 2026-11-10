-- 078 · Skill tags for the AI (Nov 7, 2026)
-- Floor tags (Ronnie's form) + bar tags (Pepe / Georges form), "Big dates only" and "Busy days only" (backup MDs).
-- Admin only (staff_private). Safe to run twice.
alter table public.staff_private add column if not exists skill_tags text[] not null default '{}';
alter table public.staff_private add column if not exists big_dates_only boolean not null default false;
alter table public.staff_private add column if not exists busy_days_only boolean not null default false;  -- MDs: only in charge when there are too many events that day
alter table public.staff_private add column if not exists tags_set_at timestamptz;
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'staff_private' and column_name in ('skill_tags', 'big_dates_only', 'busy_days_only', 'tags_set_at')) || ' of 4 cols' as result;
