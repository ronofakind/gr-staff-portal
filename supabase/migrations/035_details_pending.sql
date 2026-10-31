-- Fixes chat, Oct 31: book someone on a day before the venue / time are known.
-- Staff see "Details coming" (no countdown, no Confirm) until the admin turns it off.
alter table public.events add column if not exists details_pending boolean not null default false;
