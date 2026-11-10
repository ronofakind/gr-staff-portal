-- Push 63 · only offer gigs where someone wants to work (board StaffAreaV1).
-- Venue area (private homes: on the client), and a new booking rule "areas" (value = areas joined with |).
alter table public.venues add column if not exists area text;
alter table public.clients add column if not exists area text;
alter table public.staff_conditions drop constraint if exists staff_conditions_kind_check;
alter table public.staff_conditions add constraint staff_conditions_kind_check
  check (kind in ('not_venue', 'min_guests', 'big_dates_only', 'only_if_needed', 'not_weekday', 'private_only', 'areas'));
