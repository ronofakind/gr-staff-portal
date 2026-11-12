-- 126 · Extras get their own start time (Nov 12, 2026 · push 116). Safe to run twice.
-- Ronnie: "I should also be able to add a line for extras" — Day sheet: + Add a line → Extras (how many + time), on floor AND bar events.
-- events.extras already holds how many (null = 10% when over 7 staff); extras_start = their time (null = the last staff line's time).
alter table public.events add column if not exists extras_start time;
comment on column public.events.extras_start is 'push 116 · start time of the extras line (null = same as the last staff line).';
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'events' and column_name = 'extras_start') || ' of 1 column';
