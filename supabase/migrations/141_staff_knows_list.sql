-- 141 · Staff profile V2: "Knows" holds several people, each with a relation
alter table public.staff_private add column if not exists knows jsonb not null default '[]'::jsonb;
update public.staff_private set knows = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', knows_staff_id, 'rel', knows_text)))
  where knows = '[]'::jsonb and (knows_staff_id is not null or nullif(trim(knows_text), '') is not null);
select 'RESULT 141 · ' || (select count(*) from public.staff_private where jsonb_array_length(knows) > 0) || ' profiles with Knows' as result;
