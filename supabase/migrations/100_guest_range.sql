-- 100 · Guest range + Final switch (push 74, Nov 10, 2026). Safe to run twice.
-- guests = the count (or the low end of a range), guests_max = the high end (null = single number), guests_final = the client confirmed it.
alter table public.events add column if not exists guests_max integer check (guests_max is null or guests_max > 0);
alter table public.events add column if not exists guests_final boolean not null default false;
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'events' and column_name in ('guests_max', 'guests_final')) || ' of 2 columns';
