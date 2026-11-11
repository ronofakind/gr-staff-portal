-- 110 · Remove a bottle from tonight's bar count (Nov 10, 2026 · push 88). Safe to run twice.
-- Swipe left (or ✎ → Remove from tonight). Only tonight's list changes; the G&R list keeps it. Not allowed once it has a count (undo it first). Logged.
create or replace function public.bar_unpick(p_event uuid, p_item uuid) returns void
language plpgsql security definer set search_path = public as
$$ declare vid uuid; cl uuid; cur uuid[]; nm text; begin
  if not _can_bar_count(p_event) then raise exception 'not allowed'; end if;
  if exists (select 1 from bar_moves m, jsonb_array_elements(m.items) it where m.event_id = p_event and m.step <> 'item' and m.undone_at is null and it->>'item_id' = p_item::text) then
    raise exception 'This bottle already has a count. Undo it first (Log).'; end if;
  select venue_id into vid from events where id = p_event; select client_id into cl from event_private where event_id = p_event;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  select items into cur from bar_counts where event_id = p_event;
  if cur is null then  -- before tonight's bottles were picked: start from the whole venue list
    select coalesce(array_agg(i.id), '{}') into cur from bar_items i where i.archived_at is null and i.kind <> 'supply'
      and ((vid is not null and i.venue_id = vid) or (vid is null and cl is not null and i.client_id = cl));
  end if;
  update bar_counts set items = array_remove(cur, p_item), updated_at = now() where event_id = p_event;
  select name || coalesce(' · ' || size, '') into nm from bar_items where id = p_item;
  insert into bar_moves(event_id, step, items) values (p_event, 'item', jsonb_build_array(jsonb_build_object('item_id', p_item, 'from', nm, 'to', null, 'removed', true)));
end $$;
revoke all on function public.bar_unpick(uuid, uuid) from public, anon;
grant execute on function public.bar_unpick(uuid, uuid) to authenticated;
select 'RESULT ' || count(*) || ' of 1 function' from pg_proc where proname = 'bar_unpick';
