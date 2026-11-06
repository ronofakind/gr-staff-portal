-- 075 · 🔗 Helpful links for staff (Nov 6, 2026) · Instagram post on how to get there, a website, a Drive file…
-- [{ "url": "https://…", "label": "How to get there" }] on the event and/or the venue (every event there). Safe to run twice.
alter table public.events add column if not exists links jsonb not null default '[]';
alter table public.venues add column if not exists links jsonb not null default '[]';
select 'RESULT ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('events', 'venues') and column_name = 'links') || ' cols' as result;
