-- 118 · CV on the staff profile (Nov 11, 2026 · push 103). Safe to run twice.
-- Ronnie: "attach their CV on their profile" · admin only (not MDs, not the staff member).
-- Applicants: the CV they sent with the application is copied over on Accept (and for everyone accepted so far).
-- Everyone else: Ronnie uploads it on the profile. Files live in the private "applications" bucket under staff/<id>/.
alter table public.staff_private add column if not exists cv_path text;
alter table public.staff_private add column if not exists cv_name text;

update staff_private p set cv_path = a.cv_path, cv_name = a.cv_name
  from applications a where a.staff_id = p.staff_id and a.cv_path is not null and p.cv_path is null;

drop policy if exists applications_admin_write on storage.objects;
create policy applications_admin_write on storage.objects for insert to authenticated with check (bucket_id = 'applications' and public.is_admin());
drop policy if exists applications_admin_update on storage.objects;
create policy applications_admin_update on storage.objects for update to authenticated using (bucket_id = 'applications' and public.is_admin());
drop policy if exists applications_admin_delete on storage.objects;
create policy applications_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'applications' and public.is_admin() and name like 'staff/%');

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'staff_private' and column_name in ('cv_path', 'cv_name')) || ' of 2 columns · '
  || (select count(*) from staff_private where cv_path is not null) || ' profiles with a CV';
