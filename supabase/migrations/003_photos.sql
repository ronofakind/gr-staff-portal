-- Profile photos: public "avatars" bucket; each person writes only their own file, admin writes any.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_insert on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (public.is_admin() or name = public.me()::text || '.jpg'));
create policy avatars_update on storage.objects for update to authenticated using (bucket_id = 'avatars' and (public.is_admin() or name = public.me()::text || '.jpg'));
