-- 073 · 📍 Exact spot on a venue (Nov 6, 2026) · pin for places where the address isn't enough (La Toundra, Centre des sciences)
-- Safe to run twice.
alter table public.venues add column if not exists pin_lat double precision;
alter table public.venues add column if not exists pin_lng double precision;
alter table public.venues add column if not exists pin_label text;
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'venues' and column_name in ('pin_lat', 'pin_lng', 'pin_label')) || ' cols' as result;
