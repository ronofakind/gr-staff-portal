-- Profile photos: public "avatars" bucket; each person writes only their own file, admin writes any.
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_insert on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (public.is_admin() or name = public.me()::text || '.jpg'));
create policy avatars_update on storage.objects for update to authenticated using (bucket_id = 'avatars' and (public.is_admin() or name = public.me()::text || '.jpg'));

-- The MD on site for an event (for the staff "Look for" card). Staff can't read other people's shifts directly.
create or replace function public.event_md(p_event uuid)
returns table (full_name text, photo_url text, phone text)
language sql stable security definer set search_path = public as
$$ select st.full_name, st.photo_url, st.phone from shifts s join staff st on st.id = s.staff_id
   where s.event_id = p_event and s.position_code = 'MD' and (works(p_event) or manages(p_event) or is_admin()) limit 1 $$;
