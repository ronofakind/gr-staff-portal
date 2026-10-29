-- Free-text notes for staff on an event ("Notes" on the shift details page).
alter table public.events add column if not exists notes text;
