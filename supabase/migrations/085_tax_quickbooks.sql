-- 085 · Tax and pay = the QuickBooks supplier fields + "Add to QuickBooks" (Nov 9, 2026 · push 58). Safe to run twice.
-- Required: street, city, province, postal code, SIN, void cheque. Name / email / phone come filled in from the profile.
alter table public.staff_tax add column if not exists first_name text;
alter table public.staff_tax add column if not exists middle_name text;
alter table public.staff_tax add column if not exists last_name text;
alter table public.staff_tax add column if not exists email text;
alter table public.staff_tax add column if not exists phone text;
alter table public.staff_tax add column if not exists street text;
alter table public.staff_tax add column if not exists apt text;
alter table public.staff_tax add column if not exists city text;
alter table public.staff_tax add column if not exists province text;
alter table public.staff_tax add column if not exists postal_code text;
alter table public.staff_tax add column if not exists sin_card_path text;
-- QuickBooks: null = not asked · 'sending' = Ronnie clicked, the hourly check picks it up · 'done' · 'error'
alter table public.staff_tax add column if not exists qb_status text check (qb_status in ('sending', 'done', 'error'));
alter table public.staff_tax add column if not exists qb_vendor_id text;
alter table public.staff_tax add column if not exists qb_note text;
alter table public.staff_tax add column if not exists qb_at timestamptz;
alter table public.staff_tax alter column legal_name drop not null;
alter table public.staff_tax alter column address drop not null;

create or replace function public.save_my_tax(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d text := regexp_replace(coalesce(p->>'sin', ''), '\D', '', 'g');
  t text := nullif(trim(p->>'first_name'), ''); m text := nullif(trim(p->>'middle_name'), ''); l text := nullif(trim(p->>'last_name'), '');
  st text := nullif(trim(p->>'street'), ''); ap text := nullif(trim(p->>'apt'), ''); ci text := nullif(trim(p->>'city'), '');
  pr text := upper(nullif(trim(p->>'province'), '')); pc text := upper(nullif(trim(p->>'postal_code'), ''));
begin
  if me() is null then raise exception 'not staff'; end if;
  if length(d) <> 9 then raise exception 'bad sin'; end if;
  if t is null or l is null then raise exception 'name'; end if;
  if st is null or ci is null or pr is null or pc is null then raise exception 'address'; end if;
  if (p->>'pay_method') not in ('deposit', 'paypal') then raise exception 'bad method'; end if;
  if coalesce(p->>'cheque_path', '') !~ ('^' || me()::text || '/') then raise exception 'cheque'; end if;
  if coalesce(p->>'sin_card_path', '') <> '' and (p->>'sin_card_path') !~ ('^' || me()::text || '/') then raise exception 'sin card'; end if;
  insert into staff_tax (staff_id, first_name, middle_name, last_name, legal_name, email, phone, street, apt, city, province, postal_code, address,
                         sin, pay_method, paypal_email, cheque_path, sin_card_path, updated_at)
  values (me(), t, m, l, concat_ws(' ', t, m, l), nullif(trim(p->>'email'), ''), nullif(trim(p->>'phone'), ''), st, ap, ci, pr, pc,
          concat_ws(', ', st || coalesce(', apt ' || ap, ''), ci || ' ' || pr || ' ' || pc),
          d, p->>'pay_method', nullif(trim(p->>'paypal_email'), ''), p->>'cheque_path', nullif(p->>'sin_card_path', ''), now())
  on conflict (staff_id) do update set first_name = excluded.first_name, middle_name = excluded.middle_name, last_name = excluded.last_name,
    legal_name = excluded.legal_name, email = excluded.email, phone = excluded.phone, street = excluded.street, apt = excluded.apt, city = excluded.city,
    province = excluded.province, postal_code = excluded.postal_code, address = excluded.address, sin = excluded.sin, pay_method = excluded.pay_method,
    paypal_email = excluded.paypal_email, cheque_path = excluded.cheque_path, sin_card_path = excluded.sin_card_path, updated_at = now();
  update staff_onboarding set tax_done_at = coalesce(tax_done_at, now()) where staff_id = me();
end $$;
grant execute on function public.save_my_tax(jsonb) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'staff_tax' and column_name in ('street', 'qb_status', 'sin_card_path')) || ' new columns' as result;
