-- 142 · Tiers are admin only: stop keeping a copy on each availability answer (staff can read their own rows).
-- The app now reads tiers from staff_private (admin only). Safe to run twice.
update public.availability set tier = null where tier is not null;
select 'RESULT 142 · ' || (select count(*) from public.availability where tier is not null) || ' tiers left on availability' as result;
