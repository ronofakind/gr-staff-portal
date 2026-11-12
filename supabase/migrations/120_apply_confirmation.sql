-- 120 · "We got your application" email (Nov 11, 2026 · push 106). Safe to run twice.
-- Ronnie (8:54 PM, after Nina Couratier asked if she was hired): applicants get an automatic email from the business inbox within the hour:
-- received, in our candidate bank, not hired yet, we text the app link if it's a fit. The hourly AI inbox task sends it.
alter table public.applications add column if not exists confirm_sent_at timestamptz;
alter table public.applications add column if not exists confirm_note   text;   -- set when the email couldn't go out
-- Accepted → "You're in" email with their personal app link (Ronnie 9:19 PM: email only, same hourly task, folded into 120).
alter table public.applications add column if not exists welcome_token   text;        -- their /go/<token> link, set on Accept
alter table public.applications add column if not exists welcome_sent_at timestamptz;
alter table public.applications add column if not exists welcome_note    text;
-- Only new applicants from now on (Ronnie: no need for the ones before; he replied to Nina).
update applications set confirm_sent_at = now(), confirm_note = 'before' where confirm_sent_at is null;
select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'applications' and column_name in ('confirm_sent_at', 'confirm_note')) || ' of 2 columns · '
  || (select count(*) from applications where confirm_sent_at is null) || ' waiting · welcome cols ' || (select count(*) from information_schema.columns where table_name = 'applications' and column_name like 'welcome_%');
