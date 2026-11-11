-- 111 · Bar BEO → tonight's bottles (Nov 10, 2026 · push 89, board BarVenueListsV1). Safe to run twice.
-- Read twice per event (Ronnie, Nov 10, 11:08 PM): 2 days before (initial) and 1 hour before the start (final), by the hourly AI task.
-- The AI task finds "<date> BAR BEO" (PDF / Word) in a bar event's Drive folder, reads bottles + quantities and sends them here.
-- Before the start count, tonight's bottles become the BEO bottles (a newer BEO replaces them). Quantities show as "BEO · 6".
-- Used for outside events, and at La Nesra / Le Andover / Salon Richmond only when a BAR BEO is in the folder (client brings their own alcohol).
alter table public.bar_counts add column if not exists beo          jsonb;        -- [{catalog_id, qty}]
alter table public.bar_counts add column if not exists beo_file     text;         -- Drive file id
alter table public.bar_counts add column if not exists beo_name     text;         -- file name
alter table public.bar_counts add column if not exists beo_modified text;         -- Drive modifiedTime (a change → read again)
alter table public.bar_counts add column if not exists beo_read_at  timestamptz;
alter table public.bar_counts add column if not exists beo_prev     jsonb;        -- BEO before a change that came after the start count
alter table public.bar_counts add column if not exists beo_initial_at timestamptz; -- checked 2 days before (found or not)
alter table public.bar_counts add column if not exists beo_final_at   timestamptz; -- checked 1 hour before the start (found or not)

-- Called by /api/ai (service key) only. p_items: [{name, size, kind, qty}]
create or replace function public.bar_beo_apply(p_event uuid, p_file text, p_name text, p_modified text, p_items jsonb) returns int
language plpgsql security definer set search_path = public as
$$ declare it jsonb; cat uuid; nm text; sz text; k text; b jsonb := '[]'; ids uuid[] := '{}'; started boolean; begin
  if not exists (select 1 from events where id = p_event and department = 'bar') then raise exception 'not a bar event'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    nm := trim(coalesce(it->>'name', '')); if nm = '' then continue; end if;
    sz := nullif(trim(coalesce(it->>'size', '')), '');
    k := case when it->>'kind' in ('spirit', 'wine', 'bubbles', 'beer', 'other') then it->>'kind' else 'other' end;
    select id into cat from bar_catalog where lower(name) = lower(nm) and lower(coalesce(size, '')) = lower(coalesce(sz, ''));
    if cat is null then insert into bar_catalog(kind, name, size) values (k, nm, sz) returning id into cat;
    else update bar_catalog set archived_at = null where id = cat and archived_at is not null; end if;
    b := b || jsonb_build_object('catalog_id', cat, 'qty', nullif(it->>'qty', '')::numeric);
    ids := ids || _bar_item_for(p_event, cat);
  end loop;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  started := exists (select 1 from bar_moves where event_id = p_event and step = 'start' and undone_at is null);
  -- after the start count the list is left alone; the change shows to the bar manager ("BEO changed: +2 Grey Goose")
  update bar_counts set beo_prev = case when started and beo is not null and beo is distinct from b then beo else beo_prev end,
         beo = b, beo_file = p_file, beo_name = p_name, beo_modified = p_modified, beo_read_at = now(),
         items = case when started then items else (select array_agg(distinct u) from unnest(ids) u) end, updated_at = now()
   where event_id = p_event;
  return jsonb_array_length(b);
end $$;
revoke all on function public.bar_beo_apply(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Stamp a check (initial / final), found or not, so each event is read only twice.
create or replace function public.bar_beo_checked(p_event uuid, p_phase text) returns void
language sql security definer set search_path = public as
$$ insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
   update bar_counts set beo_initial_at = case when p_phase = 'initial' then now() else beo_initial_at end,
                         beo_final_at   = case when p_phase = 'final' then now() else beo_final_at end where event_id = p_event; $$;
revoke all on function public.bar_beo_checked(uuid, text) from public, anon, authenticated;

-- Count screen: + the BEO (quantity per bottle row, file name, when it was read).
create or replace function public.bar_count_beo(p_event uuid) returns json
language sql stable security definer set search_path = public as
$$ select case when not _can_bar_count(p_event) then null else (
     select json_build_object('name', c.beo_name, 'read_at', c.beo_read_at,
       'changes', (select coalesce(json_agg(json_build_object('name', k.name || coalesce(' · ' || k.size, ''), 'was', (p->>'qty')::numeric, 'now', (x->>'qty')::numeric)), '[]')
                     from jsonb_array_elements(c.beo) x join bar_catalog k on k.id = (x->>'catalog_id')::uuid
                     left join lateral (select y as p from jsonb_array_elements(coalesce(c.beo_prev, '[]')) y where y->>'catalog_id' = x->>'catalog_id' limit 1) pp on true
                    where c.beo_prev is not null and (p is null or (p->>'qty') is distinct from (x->>'qty'))),
       'qty', (select coalesce(json_object_agg(i.id, (x->>'qty')::numeric), '{}') from jsonb_array_elements(c.beo) x
                 join bar_items i on i.catalog_id = (x->>'catalog_id')::uuid and i.id = any(coalesce(c.items, '{}'))))
       from bar_counts c where c.event_id = p_event and c.beo is not null) end $$;
revoke all on function public.bar_count_beo(uuid) from public, anon;
grant execute on function public.bar_count_beo(uuid) to authenticated;

select 'RESULT ' || (select count(*) from information_schema.columns where table_name = 'bar_counts' and column_name like 'beo%') || ' of 8 columns · '
  || (select count(*) from pg_proc where proname in ('bar_beo_apply', 'bar_count_beo', 'bar_beo_checked')) || ' of 3 functions';
