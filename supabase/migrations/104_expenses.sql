-- 104 · Staff add their own expenses + Payroll V2 grid (Nov 10, 2026 · push 79). Safe to run twice.
-- Only people Ronnie switches on (always, or one shift for 2 days) · receipt photo (private) · Ronnie approves → pay line.

alter table public.staff  add column if not exists can_expense   boolean not null default false; -- "Can add expenses" (always on)
alter table public.shifts add column if not exists expense_until timestamptz;                    -- "Allow expense for this shift" (2 days after)

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references public.staff(id) on delete cascade,
  shift_id     uuid references public.shifts(id) on delete set null,
  exp_date     date not null,
  kind         text not null check (kind in ('parking','uber','gas','other')),
  amount       numeric(10,2) not null check (amount > 0 and amount < 2000),
  receipt_path text,
  note         text,
  status       text not null default 'waiting' check (status in ('waiting','approved','declined')),
  reason       text,                                  -- decline reason (they see it)
  pay_line_id  uuid references public.pay_lines(id) on delete set null,
  decided_at   timestamptz,
  decided_by   uuid references public.staff(id),
  created_at   timestamptz not null default now()
);
create index if not exists expenses_staff on public.expenses(staff_id, created_at desc);
alter table public.expenses enable row level security;
drop policy if exists admin_all on public.expenses;
drop policy if exists own_read on public.expenses;
create policy admin_all on public.expenses for all using (is_admin()) with check (is_admin());
create policy own_read  on public.expenses for select using (staff_id = me());

-- Private receipts: folder = the person's staff id. They upload into their own folder; only they and admin can open.
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
drop policy if exists receipts_read on storage.objects;
drop policy if exists receipts_insert on storage.objects;
create policy receipts_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = public.me()::text));
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (public.is_admin() or (storage.foldername(name))[1] = public.me()::text));

-- What can I do? always = floating +; shifts = one-shift windows still open (for the "shift is done" card)
create or replace function public.my_expense_access() returns jsonb
language sql stable security definer set search_path = public as
$$ select jsonb_build_object(
    'always', coalesce((select can_expense from staff where id = me()), false),
    'shifts', coalesce((select jsonb_agg(jsonb_build_object('shift_id', s.id, 'until', s.expense_until, 'title', e.title, 'date', e.event_date) order by e.event_date desc)
                          from shifts s join events e on e.id = s.event_id
                         where s.staff_id = me() and s.expense_until > now()
                           and not exists (select 1 from expenses x where x.shift_id = s.id and x.staff_id = me())), '[]'::jsonb)) $$;

create or replace function public.add_expense(p_kind text, p_amount numeric, p_shift uuid, p_date date, p_receipt text, p_note text)
returns uuid language plpgsql security definer set search_path = public as
$$ declare d date := p_date; ok boolean; x uuid; begin
  if p_shift is not null then
    select e.event_date, (s.expense_until > now() or st.can_expense) into d, ok
      from shifts s join events e on e.id = s.event_id join staff st on st.id = s.staff_id
     where s.id = p_shift and s.staff_id = me();
    if d is null then raise exception 'not your shift'; end if;
  else
    select can_expense into ok from staff where id = me();
  end if;
  if not coalesce(ok, false) then raise exception 'Expenses are not on for you. Ask Ronnie.'; end if;
  if d is null then d := current_date; end if;
  if p_receipt is null or split_part(p_receipt, '/', 1) <> me()::text then raise exception 'Add a photo of the receipt.'; end if;
  insert into expenses(staff_id, shift_id, exp_date, kind, amount, receipt_path, note)
  values (me(), p_shift, d, p_kind, round(p_amount, 2), p_receipt, nullif(trim(coalesce(p_note, '')), '')) returning id into x;
  return x;
end $$;

-- Ronnie: Approve → pay line in the first open (not locked) period from today · Decline → reason they see
create or replace function public.admin_decide_expense(p_id uuid, p_ok boolean, p_reason text)
returns void language plpgsql security definer set search_path = public as
$$ declare x expenses; ps date; d date := (now() at time zone 'America/Toronto')::date; l uuid; i int := 0; begin
  if not is_admin() then raise exception 'not allowed'; end if;
  select * into x from expenses where id = p_id for update;
  if x.status <> 'waiting' then raise exception 'Already decided.'; end if;
  if p_ok then
    loop
      ps := case when extract(day from d) <= 15 then date_trunc('month', d)::date else (date_trunc('month', d) + interval '15 days')::date end;
      exit when not exists (select 1 from pay_periods where start_date = ps and locked_at is not null) or i > 6;
      d := case when extract(day from ps) = 1 then ps + 15 else (date_trunc('month', ps) + interval '1 month')::date end; i := i + 1;
    end loop;
    insert into pay_lines(staff_id, period_start, kind, amount, line_date, note, source, source_id, created_by)
    values (x.staff_id, ps, x.kind, x.amount, x.exp_date, coalesce(x.note, 'Expense from the app'), 'expense', x.id, me()) returning id into l;
    update expenses set status = 'approved', pay_line_id = l, decided_at = now(), decided_by = me(), reason = null where id = p_id;
  else
    update expenses set status = 'declined', reason = nullif(trim(coalesce(p_reason, '')), ''), decided_at = now(), decided_by = me() where id = p_id;
  end if;
end $$;

revoke all on function public.my_expense_access() from public, anon;
revoke all on function public.add_expense(text, numeric, uuid, date, text, text) from public, anon;
revoke all on function public.admin_decide_expense(uuid, boolean, text) from public, anon;
grant execute on function public.my_expense_access() to authenticated;
grant execute on function public.add_expense(text, numeric, uuid, date, text, text) to authenticated;
grant execute on function public.admin_decide_expense(uuid, boolean, text) to authenticated;

-- Payroll V2 (grid like the sheet): manual hours per day + columns Ronnie adds by hand, per pay period.
create table if not exists public.pay_columns (
  id           uuid primary key default gen_random_uuid(),
  period_start date not null,
  name         text not null,
  ctype        text not null check (ctype in ('add','off','hours')),   -- adds to pay · comes off · hours (banked)
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
alter table public.pay_columns enable row level security;
drop policy if exists admin_all on public.pay_columns;
create policy admin_all on public.pay_columns for all using (is_admin()) with check (is_admin());
alter table public.pay_lines add column if not exists col_id uuid references public.pay_columns(id) on delete cascade;
alter table public.pay_lines drop constraint if exists pay_lines_kind_check;
alter table public.pay_lines add constraint pay_lines_kind_check check (kind in ('tips','uber','gas','parking','correction','other','hours',
                                                                                 'paypal','cash','cra','banked','payout'));
-- Staff: manual hours show as day + hours (never the note); expenses show their own amount.
drop function if exists public.my_pay_notes();
create or replace function public.my_pay_notes() returns table(kind text, line_date date, period_start date, amount numeric, hours numeric, source text)
language sql stable security definer set search_path = public as
$$ select l.kind, l.line_date, l.period_start, case when l.source = 'expense' then l.amount end, case when l.kind = 'hours' then l.hours end, l.source
     from pay_lines l
    where l.staff_id = me() and l.kind in ('tips','uber','gas','parking','correction','other','payout','hours') and l.amount > 0
      and l.period_start >= (current_date - 120)
    order by coalesce(l.line_date, l.period_start) desc $$;
revoke all on function public.my_pay_notes() from public, anon;
grant execute on function public.my_pay_notes() to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where (table_name = 'staff' and column_name = 'can_expense') or (table_name = 'shifts' and column_name = 'expense_until')) || ' of 2 columns · '
  || (select count(*) from information_schema.tables where table_name = 'expenses') || ' table · '
  || (select count(*) from storage.buckets where id = 'receipts') || ' bucket · '
  || (select count(*) from information_schema.tables where table_name = 'pay_columns') || ' pay_columns';
