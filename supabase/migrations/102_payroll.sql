-- 102 · Payroll in the app (Nov 10, 2026 · push 77). Safe to run twice.
-- Pay periods lock with the RBC file · extra pay lines (tips, Uber, PayPal, banked…) · PayPal invoices · paid-by-PayPal mark on shifts
-- · RBC names. Admin only, except two small staff views without money (my_pay_notes, my_banked).

-- 1 · Lock + RBC snapshot on the existing pay periods
alter table public.pay_periods add column if not exists locked_at  timestamptz;
alter table public.pay_periods add column if not exists locked_by  uuid references public.staff(id);
alter table public.pay_periods add column if not exists rbc_lines  jsonb;    -- [{staff_id, name, rbc_name, amount}] as sent
alter table public.pay_periods add column if not exists rbc_total  numeric(10,2);

-- 2 · Extra lines on a person's pay for one period
create table if not exists public.pay_lines (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  period_start date not null,                       -- 1st or 16th
  kind         text not null check (kind in ('tips','uber','gas','parking','correction','other',      -- add to pay
                                              'paypal','cash','cra','banked','payout')),             -- off pay · banked / pay out banked
  amount       numeric(10,2) not null default 0,    -- + adds to pay, − comes off (sign set by the app)
  hours        numeric(6,2),                        -- banked / payout only
  line_date    date,
  note         text,
  source       text not null default 'manual' check (source in ('manual','expense','paypal','flag_fix')),
  source_id    uuid,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff(id)
);
create index if not exists pay_lines_period on public.pay_lines(period_start, staff_id);
alter table public.pay_lines enable row level security;
drop policy if exists admin_all on public.pay_lines;
create policy admin_all on public.pay_lines for all using (is_admin()) with check (is_admin());

-- No changes to a locked period's lines
create or replace function public.pay_lines_lock() returns trigger
language plpgsql security definer set search_path = public as
$$ declare d date := case when tg_op = 'DELETE' then old.period_start else new.period_start end; begin
  if exists (select 1 from pay_periods where start_date = d and locked_at is not null)
     or (tg_op = 'UPDATE' and exists (select 1 from pay_periods where start_date = old.period_start and locked_at is not null)) then
    raise exception 'This pay period is locked (RBC file made). Add it to the next period instead.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists pay_lines_lock on public.pay_lines;
create trigger pay_lines_lock before insert or update or delete on public.pay_lines for each row execute function public.pay_lines_lock();

-- 3 · PayPal invoices (early pay, mostly Philipp)
create table if not exists public.paypal_invoices (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid references public.staff(id) on delete set null,
  amount       numeric(10,2) not null,
  from_date    date,
  to_date      date,
  email_id     text unique,                         -- Gmail message id when the AI found it
  received_at  timestamptz,
  status       text not null default 'open' check (status in ('open','paid','dismissed')),
  paid_at      timestamptz,
  pay_line_id  uuid references public.pay_lines(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
alter table public.paypal_invoices enable row level security;
drop policy if exists admin_all on public.paypal_invoices;
create policy admin_all on public.paypal_invoices for all using (is_admin()) with check (is_admin());

-- 4 · Shifts already paid by PayPal
alter table public.shifts add column if not exists paypal_paid_at timestamptz;

-- 5 · RBC payee name per person (default = name in CAPS) + skip (employee / cash)
create table if not exists public.pay_names (
  staff_id   uuid primary key references public.staff(id) on delete cascade,
  rbc_name   text,
  skip       text            -- e.g. 'employee' → never in the RBC file
);
alter table public.pay_names enable row level security;
drop policy if exists admin_all on public.pay_names;
create policy admin_all on public.pay_names for all using (is_admin()) with check (is_admin());

-- Seed from the rbc-payroll-import name map (app name → RBC name) and the exclusion list
insert into pay_names(staff_id, rbc_name)
select s.id, upper(m.rbc) from staff s join (values
  ('Eva Schneiderlin','Eva-Michele-Marcy Schneiderlin'), ('Isidora Cabrera','Isidora Victoria Cabrera'),
  ('Lucciano Zamora-Lavenderos','Lucciano Zamora-Lavanderos'), ('Mahaut Nieuviartis','Mahaut Nieuviarts'),
  ('Mirko D''Annibale','Mirko Stefano D''Annibale'), ('Naima Sigouin-Melasco','Naima Vanina Sigouin-Melasco'),
  ('Nicholas Lamonicas','Nicholas LaMonica'), ('Sarah Romero','Sarah Romeo'), ('Savana Carpenter','Savanna Carpenter'),
  ('Zine Eddine Bouzebra','Zine Eddine Bouzabra')) m(app, rbc) on lower(s.full_name) = lower(m.app)
on conflict (staff_id) do nothing;
insert into pay_names(staff_id, skip)
select id, 'employee' from staff where upper(full_name) = 'BENJAMIN OUTRE'
on conflict (staff_id) do update set skip = 'employee';

-- 6 · Lock a period with the RBC file (admin). Also closes it for managers.
create or replace function public.admin_lock_period(p_start date, p_end date, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  insert into pay_periods(start_date, end_date, closed_at, closed_by, locked_at, locked_by, rbc_lines, rbc_total)
  values (p_start, p_end, now(), me(), now(), me(), p_lines, (select coalesce(sum((x->>'amount')::numeric), 0) from jsonb_array_elements(p_lines) x))
  on conflict (start_date) do update set closed_at = coalesce(pay_periods.closed_at, now()), closed_by = coalesce(pay_periods.closed_by, me()),
    locked_at = now(), locked_by = me(), rbc_lines = excluded.rbc_lines, rbc_total = excluded.rbc_total;
end $$;
create or replace function public.admin_unlock_period(p_start date)
returns void language plpgsql security definer set search_path = public as
$$ begin
  if not is_admin() then raise exception 'not allowed'; end if;
  update pay_periods set locked_at = null, locked_by = null where start_date = p_start;
end $$;

-- 7 · Staff views (no money, except their own approved expenses)
create or replace function public.my_pay_notes() returns table(kind text, line_date date, period_start date, amount numeric, source text)
language sql stable security definer set search_path = public as
$$ select l.kind, l.line_date, l.period_start, case when l.source = 'expense' then l.amount end, l.source
     from pay_lines l
    where l.staff_id = me() and l.kind in ('tips','uber','gas','parking','correction','other','payout') and l.amount > 0
      and l.period_start >= (current_date - 120)
    order by coalesce(l.line_date, l.period_start) desc $$;
create or replace function public.my_banked() returns numeric
language sql stable security definer set search_path = public as
$$ select coalesce(sum(case when kind = 'banked' then hours when kind = 'payout' then -hours end), 0)
     from pay_lines where staff_id = me() and kind in ('banked','payout') and hours is not null $$;
revoke all on function public.my_pay_notes() from public, anon;
revoke all on function public.my_banked() from public, anon;
grant execute on function public.my_pay_notes() to authenticated;
grant execute on function public.my_banked() to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'pay_periods' and column_name in ('locked_at','locked_by','rbc_lines','rbc_total')) || ' of 4 period columns · '
  || (select count(*) from information_schema.tables where table_name in ('pay_lines','paypal_invoices','pay_names')) || ' of 3 tables · '
  || (select count(*) from pay_names where rbc_name is not null) || ' RBC names · '
  || (select count(*) from pay_names where skip is not null) || ' skipped';
