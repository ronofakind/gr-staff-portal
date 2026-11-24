-- 136 · Nov 23 2026 · Bookings V6 (board AdminBookingsEventDetailsV6): Estimate # + notes for MDs + notes for billing on each event.
-- Kept in event_private (admin only, like the client name). Staff notes stay in events.notes (staff see them).
-- Additive only: three empty columns. Nothing already set changes.
alter table public.event_private add column if not exists estimate_no text;
alter table public.event_private add column if not exists md_note text;       -- MDs / bar managers (shown to them later; admin only for now)
alter table public.event_private add column if not exists billing_note text;  -- only Ronnie (extras, overtime, transport for the invoice)

select 'RESULT ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'event_private'
  and column_name in ('estimate_no', 'md_note', 'billing_note')) || ' cols · ' || (select count(*) from event_private) || ' events kept';
