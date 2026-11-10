-- 081 · Pay rates with history + sent invoices for profit (Nov 8, 2026 · push 54). Admin only. Safe to run twice.
-- staff_rates: one row per change. The rate on a date = the latest row with from_date <= that date.
create table if not exists public.staff_rates (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  rate       numeric(6,2) not null check (rate >= 0),
  from_date  date not null,
  reason     text,
  source     text,                 -- 'sheet' (seeded from Staff Payroll 2026) · 'app'
  set_by     uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (staff_id, from_date)
);
create index if not exists staff_rates_staff on public.staff_rates (staff_id, from_date desc);
alter table public.staff_rates enable row level security;
drop policy if exists sr_admin on public.staff_rates;
create policy sr_admin on public.staff_rates for all to authenticated using (is_admin()) with check (is_admin());

-- event_invoices: QuickBooks invoices once SENT (written by the scheduled task through /api/ai). Billed = subtotal before taxes.
create table if not exists public.event_invoices (
  id          uuid primary key default gen_random_uuid(),
  qb_id       text not null unique,
  doc_number  text,
  event_id    uuid references public.events(id) on delete set null,
  customer    text,
  txn_date    date,
  sent_at     timestamptz,
  subtotal    numeric(10,2),
  total       numeric(10,2),
  updated_at  timestamptz not null default now()
);
create index if not exists event_invoices_event on public.event_invoices (event_id);
alter table public.event_invoices enable row level security;
drop policy if exists ei_admin on public.event_invoices;
create policy ei_admin on public.event_invoices for all to authenticated using (is_admin()) with check (is_admin());

select 'RESULT ' || (select count(*) from pg_tables where tablename in ('staff_rates', 'event_invoices')) || ' tables' as result;
