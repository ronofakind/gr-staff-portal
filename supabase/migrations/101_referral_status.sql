-- 101 · Referral fills Knows (push 75, Nov 10, 2026). Safe to run twice.
-- matched = Knows filled from the referrer · skipped = kept as plain text ("referred by Mel").
alter table public.applications add column if not exists referral_status text check (referral_status in ('matched', 'skipped'));
update public.applications set referral_status = 'matched' where referral_status is null and referrer_id is not null and status = 'accepted';
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'applications' and column_name = 'referral_status') || ' column';
