-- Uniform per department (+ optional per-shift override)
alter table public.events add column if not exists uniform_floor text not null default 'white_shirt' check (uniform_floor in ('white_shirt','black_shirt','dress'));
alter table public.events add column if not exists uniform_bar   text not null default 'black_shirt' check (uniform_bar in ('white_shirt','black_shirt','dress'));
alter table public.shifts add column if not exists uniform text check (uniform in ('white_shirt','black_shirt','dress'));

-- Profile: dress size; staff can edit their own positions too
alter table public.staff add column if not exists dress_size text;
grant update (phone, language, photo_url, shirt_size, pants_size, shoe_size, transport, positions, dress_size) on public.staff to authenticated;

-- Nightly payroll export for the Google Sheet (Apps Script calls this with a shared token)
create table if not exists public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets(name, value) values ('payroll_token', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (name) do nothing;

create or replace function public.payroll_export(p_token text, p_from date, p_to date)
returns table(event_date date, full_name text, hours numeric, event_title text)
language plpgsql stable security definer set search_path = public as
$$ begin
  if p_token is null or p_token <> (select value from app_secrets where name = 'payroll_token') then
    raise exception 'not allowed';
  end if;
  return query
    select e.event_date, st.full_name, sum(rounded_hours(p.punch_in, p.punch_out)), string_agg(distinct e.title, ', ')
      from punches p join shifts s on s.id = p.shift_id join events e on e.id = s.event_id join staff st on st.id = s.staff_id
     where e.event_date between p_from and p_to and s.attendance is null
       and p.punch_in is not null and p.punch_out is not null
     group by e.event_date, st.full_name;
end $$;
revoke all on function public.payroll_export(text, date, date) from public;
grant execute on function public.payroll_export(text, date, date) to anon, authenticated;

-- Torys: event blurb + uniforms
update public.events set description = 'Corporate event', uniform_floor = 'white_shirt', uniform_bar = 'black_shirt'
 where id = '39dea1d9-5daa-4ca3-a747-cd8270cce8d4';
