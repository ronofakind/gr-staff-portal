-- Address parts from Google Places (formatted line stays in venues.address).
alter table public.venues add column if not exists street text;
alter table public.venues add column if not exists unit text;
alter table public.venues add column if not exists city text;
alter table public.venues add column if not exists province text;
alter table public.venues add column if not exists postal_code text;
