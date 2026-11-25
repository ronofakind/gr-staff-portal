-- 138 · New event page: staff count is an estimate + a note for Ronnie (admins only)
alter table public.events add column if not exists staff_estimate boolean not null default false;
alter table public.event_private
  add column if not exists admin_note text,
  add column if not exists admin_note_by uuid references public.staff(id) on delete set null,
  add column if not exists admin_note_at timestamptz;
select 'RESULT 138 · ' ||
  (select count(*) from information_schema.columns where table_schema='public' and table_name='events' and column_name='staff_estimate') || ' + ' ||
  (select count(*) from information_schema.columns where table_schema='public' and table_name='event_private' and column_name like 'admin_note%') || ' cols' as result;
