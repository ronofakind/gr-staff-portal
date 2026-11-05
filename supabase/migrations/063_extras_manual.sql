-- 063 · Nov 5 · Bookings: dragging someone into Extras (or out of Extras onto a line) is saved like any other change.
--   kind 'auto'   = worked out by the board (over the client count, early finishers first, then lowest ranking) · 061
--   kind 'manual' = you dragged them into Extras
--   kind 'keep'   = you dragged them onto a line: never an automatic extra
-- The manager's EXTRA tag reads auto + manual (not keep).
alter table public.shift_extras add column if not exists kind text not null default 'auto';
alter table public.shift_extras drop constraint if exists shift_extras_kind_check;
alter table public.shift_extras add constraint shift_extras_kind_check check (kind in ('auto', 'manual', 'keep'));

-- The board's automatic list: only touches 'auto' rows.
create or replace function public.admin_set_extras(p_event uuid, p_shifts uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  delete from shift_extras where event_id = p_event and kind = 'auto' and not (shift_id = any(coalesce(p_shifts, '{}')));
  insert into shift_extras (shift_id, event_id, kind)
    select s.id, p_event, 'auto' from shifts s where s.event_id = p_event and s.id = any(coalesce(p_shifts, '{}'))
  on conflict (shift_id) do nothing;
end $$;

-- Your own pick: 'manual' (into Extras), 'keep' (onto a line), null (back to automatic).
create or replace function public.admin_mark_extra(p_shift uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admin only'; end if;
  if p_kind is null then delete from shift_extras where shift_id = p_shift and kind in ('manual', 'keep'); return; end if;
  if p_kind not in ('manual', 'keep') then raise exception 'bad kind'; end if;
  insert into shift_extras (shift_id, event_id, kind) select id, event_id, p_kind from shifts where id = p_shift
  on conflict (shift_id) do update set kind = excluded.kind, event_id = excluded.event_id, set_at = now();
end $$;
revoke all on function public.admin_mark_extra(uuid, text) from public;
grant execute on function public.admin_mark_extra(uuid, text) to authenticated;

select count(*) filter (where kind = 'auto') auto_rows from public.shift_extras;
