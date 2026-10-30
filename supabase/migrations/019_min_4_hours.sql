-- Minimum 4 paid (and billed) hours per shift that was worked (Ronnie, Oct 29 2026). Real punch times stay as recorded.
create or replace function public.rounded_hours(p_in timestamptz, p_out timestamptz)
returns numeric language sql immutable as
$$ select case when p_in is null or p_out is null then null
               else greatest(4, round(extract(epoch from (p_out - p_in)) / 900) * 0.25) end $$;
