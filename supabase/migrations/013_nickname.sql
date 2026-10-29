-- What staff are called in the app ("Hi Pepe"); full_name stays the payroll name.
alter table public.staff add column if not exists nickname text;
update public.staff set nickname = 'Pepe' where id = '86a6e00e-4fcd-4994-9970-55ed0b8a53b0';
