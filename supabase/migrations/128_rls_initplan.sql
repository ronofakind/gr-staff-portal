-- 128 · Nov 15 2026 · speed: row-level security policies called is_admin() / me() once PER ROW.
-- Wrapping them as (select is_admin()) / (select me()) makes Postgres compute them once per query (Supabase's own advice).
-- Same rules, nothing about who can see what changes. Only these two functions are wrapped.
do $$ declare p record; q text; w text; n int := 0; begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public' and (coalesce(qual, '') ~ '(is_admin|\mme)\(\)' or coalesce(with_check, '') ~ '(is_admin|\mme)\(\)') loop
    q := regexp_replace(regexp_replace(p.qual, '\mis_admin\(\)', '(select is_admin())', 'g'), '\mme\(\)', '(select me())', 'g');
    w := regexp_replace(regexp_replace(p.with_check, '\mis_admin\(\)', '(select is_admin())', 'g'), '\mme\(\)', '(select me())', 'g');
    if q is not null then execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q); end if;
    if w is not null then execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, w); end if;
    n := n + 1;
  end loop;
  raise notice 'updated % policies', n;
end $$;
select 'RESULT ' || count(*) || ' policies wrapped' from pg_policies where schemaname = 'public' and (coalesce(qual, '') like '%(SELECT is_admin()%' or coalesce(qual, '') like '%(SELECT me()%' or coalesce(with_check, '') like '%(SELECT me()%' or coalesce(with_check, '') like '%(SELECT is_admin()%');
