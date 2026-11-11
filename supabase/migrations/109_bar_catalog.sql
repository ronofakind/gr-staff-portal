-- 109 · G&R bottle list + Tonight's bottles (Nov 10, 2026 · push 85, board BarCountPickV1). Safe to run twice.
-- One G&R list for all venues (admin: price, edit, remove). Opening Bar count before the start count → tick tonight's bottles
-- (last time at this venue pre-ticked), search the whole list. A bottle typed by staff goes straight onto the G&R list.
-- Staff never see prices. Preloaded: 23 bottles + SAQ prices from the Workleap report (Nov 5).

create table if not exists public.bar_catalog (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('spirit', 'wine', 'bubbles', 'beer', 'other')),
  name        text not null,
  size        text,
  price       numeric(10,2),                                             -- SAQ / retail unit price · admin only
  added_by    uuid references public.staff(id) on delete set null,       -- null = Ronnie / preload
  archived_at timestamptz,                                               -- Remove (past counts keep the name)
  created_at  timestamptz not null default now()
);
create unique index if not exists bar_catalog_name_size on public.bar_catalog (lower(name), lower(coalesce(size, '')));
alter table public.bar_catalog enable row level security;
drop policy if exists admin_all on public.bar_catalog;
create policy admin_all on public.bar_catalog for all using (is_admin()) with check (is_admin());

alter table public.bar_items  add column if not exists catalog_id uuid references public.bar_catalog(id) on delete set null;
alter table public.bar_counts add column if not exists items uuid[];   -- tonight's bottles (bar_items ids); null = whole venue list (before push 85)

insert into public.bar_catalog (kind, name, size, price) values
  ('spirit', 'Cazadores Blanco Tequila', '750 ml', 41.50), ('spirit', 'Casamigos Blanco Tequila', '750 ml', 75.00),
  ('spirit', 'Casamigos Añejo Tequila', '750 ml', 94.75), ('spirit', 'Bombay Sapphire Gin', '1.14 L', 49.00),
  ('spirit', 'Hendrick''s Gin', '750 ml', 56.75), ('spirit', 'Grey Goose Vodka', '750 ml', 54.75),
  ('spirit', 'Ketel One Vodka', '1.14 L', 55.75), ('spirit', 'Johnnie Walker Black Label', '750 ml', 67.00),
  ('spirit', 'Canadian Club Whisky', '750 ml', 31.75), ('spirit', 'The Glenlivet 1824', '750 ml', 75.00),
  ('spirit', 'Appleton Estate Signature Rum', '1.14 L', 46.75), ('spirit', 'Bacardi Superior White Rum', '1.14 L', 40.00),
  ('spirit', 'Campari', '750 ml', 35.50), ('spirit', 'Aperol', '750 ml', 28.10), ('spirit', 'Cointreau', '750 ml', 46.75),
  ('spirit', 'Kayak White Vermouth', '750 ml', 21.40), ('spirit', 'Kayak Red Vermouth', '750 ml', 21.40),
  ('beer', 'Budweiser', '355 ml can', 3.50), ('beer', 'Bud Light', '355 ml can', 3.50), ('beer', 'Michelob Ultra Zero', '355 ml can', 2.60),
  ('beer', 'Trois Lacs IPA', '473 ml can', 5.00), ('beer', 'Trois Lacs Rousse', '473 ml can', 5.00), ('beer', 'Birra Angela Lager', '473 ml can', 5.00)
on conflict do nothing;

-- Existing venue lists: link to the G&R list by name + size; venue bottles not on it are added (staff typed them before).
insert into public.bar_catalog (kind, name, size)
  select distinct on (lower(i.name), lower(coalesce(i.size, ''))) i.kind, i.name, i.size from public.bar_items i
   where i.kind <> 'supply' and i.archived_at is null order by lower(i.name), lower(coalesce(i.size, '')), i.created_at
on conflict do nothing;
update public.bar_items i set catalog_id = c.id from public.bar_catalog c
 where i.catalog_id is null and i.kind <> 'supply' and lower(c.name) = lower(i.name) and lower(coalesce(c.size, '')) = lower(coalesce(i.size, ''));

-- The venue (else client) list row for a G&R bottle: reuse or create.
create or replace function public._bar_item_for(p_event uuid, p_cat uuid) returns uuid
language plpgsql security definer set search_path = public as
$$ declare vid uuid; cl uuid; c bar_catalog%rowtype; v uuid; begin
  select venue_id into vid from events where id = p_event; select client_id into cl from event_private where event_id = p_event;
  if vid is null and cl is null then raise exception 'This event has no venue or client for the list.'; end if;
  select * into c from bar_catalog where id = p_cat; if c.id is null then raise exception 'Bottle not found.'; end if;
  select id into v from bar_items where catalog_id = p_cat and ((vid is not null and venue_id = vid) or (vid is null and client_id = cl)) order by archived_at nulls first limit 1;
  if v is null then
    insert into bar_items(venue_id, client_id, kind, name, size, sort, catalog_id)
    values (vid, case when vid is null then cl end, c.kind, c.name, c.size, 999, c.id) returning id into v;
  else update bar_items set archived_at = null where id = v and archived_at is not null; end if;
  return v;
end $$;

-- Tonight's bottles: the whole G&R list (no prices) + which are ticked (tonight, else last time at this venue).
create or replace function public.bar_catalog_pick(p_event uuid) returns json
language plpgsql stable security definer set search_path = public as
$$ declare vid uuid; cl uuid; cur uuid[]; begin
  if not _can_bar_count(p_event) then return null; end if;
  select venue_id into vid from events where id = p_event; select client_id into cl from event_private where event_id = p_event;
  select items into cur from bar_counts where event_id = p_event;
  return json_build_object('picked', cur is not null,
    'list', (select coalesce(json_agg(json_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'size', c.size,
               'on', exists (select 1 from bar_items i where i.catalog_id = c.id and ((vid is not null and i.venue_id = vid) or (vid is null and i.client_id = cl))
                              and (case when cur is not null then i.id = any(cur) else i.archived_at is null end))
             ) order by c.kind, c.name, c.size), '[]') from bar_catalog c where c.archived_at is null));
end $$;

-- Save tonight's bottles. p_add = true adds to tonight (search + Add later on).
create or replace function public.bar_pick(p_event uuid, p_catalog uuid[], p_add boolean default false) returns void
language plpgsql security definer set search_path = public as
$$ declare ids uuid[] := '{}'; x uuid; cur uuid[]; begin
  if not _can_bar_count(p_event) then raise exception 'Only the bar manager / MD of this event can do the bar count.'; end if;
  foreach x in array coalesce(p_catalog, '{}') loop ids := ids || _bar_item_for(p_event, x); end loop;
  insert into bar_counts(event_id) values (p_event) on conflict (event_id) do nothing;
  select items into cur from bar_counts where event_id = p_event;
  if p_add and cur is not null then ids := (select array_agg(distinct u) from unnest(cur || ids) u); end if;
  update bar_counts set items = ids, updated_at = now() where event_id = p_event;
end $$;

-- Add a bottle / fix a name or size: now also on the G&R list (staff-typed → straight on, Ronnie sees "NEW · by …") and in tonight's bottles.
create or replace function public.bar_item_save(p_event uuid, p_item uuid, p_kind text, p_name text, p_size text) returns uuid
language plpgsql security definer set search_path = public as
$$ declare e record; cl uuid; old bar_items%rowtype; v uuid; cat uuid; nm text := trim(coalesce(p_name, '')); sz text := nullif(trim(coalesce(p_size, '')), ''); k text := coalesce(p_kind, 'spirit'); begin
  if not _can_bar_count(p_event) then raise exception 'not allowed'; end if;
  if nm = '' then raise exception 'Give it a name.'; end if;
  select id, venue_id into e from events where id = p_event; select client_id into cl from event_private where event_id = p_event;
  if k <> 'supply' then
    select id into cat from bar_catalog where lower(name) = lower(nm) and lower(coalesce(size, '')) = lower(coalesce(sz, ''));
    if cat is null then insert into bar_catalog(kind, name, size, added_by) values (k, nm, sz, case when is_admin() then null else me() end) returning id into cat;
    else update bar_catalog set archived_at = null where id = cat and archived_at is not null; end if;
  end if;
  if p_item is null then
    if e.venue_id is null and cl is null then raise exception 'This event has no venue or client for the list.'; end if;
    if cat is not null then v := _bar_item_for(p_event, cat);
    else insert into bar_items(venue_id, client_id, kind, name, size, sort) values (e.venue_id, case when e.venue_id is null then cl end, k, nm, sz, 999) returning id into v; end if;
    update bar_counts set items = items || v where event_id = p_event and items is not null and not (v = any(items));
    insert into bar_moves(event_id, step, items) values (p_event, 'item', jsonb_build_array(jsonb_build_object('item_id', v, 'from', null, 'to', nm || coalesce(' · ' || sz, ''))));
    return v;
  end if;
  select * into old from bar_items where id = p_item;
  update bar_items set name = nm, size = sz, kind = k, catalog_id = coalesce(cat, catalog_id) where id = p_item;
  insert into bar_moves(event_id, step, items) values (p_event, 'item', jsonb_build_array(jsonb_build_object('item_id', p_item,
    'from', old.name || coalesce(' · ' || old.size, ''), 'to', nm || coalesce(' · ' || sz, ''))));
  return p_item;
end $$;

-- Count screen: only tonight's bottles once picked (+ anything already moved tonight); sizes per type from the G&R list.
create or replace function public.bar_count_get(p_event uuid) returns json
language plpgsql stable security definer set search_path = public as
$$ declare e record; c bar_counts%rowtype; cl uuid; begin
  if not _can_bar_count(p_event) then return null; end if;
  select ev.id, ev.title, ev.event_date, ev.venue_id, coalesce(v.bar_supplies, false) as sup into e from events ev left join venues v on v.id = ev.venue_id where ev.id = p_event;
  select client_id into cl from event_private where event_id = p_event;
  select * into c from bar_counts where event_id = p_event;
  return json_build_object(
    'event', json_build_object('id', e.id, 'title', e.title, 'date', e.event_date, 'supplies', e.sup),
    'picked', c.items is not null,
    'items', (select coalesce(json_agg(json_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'size', i.size) order by i.kind = 'supply', i.sort, i.name, i.size), '[]')
                from bar_items i where i.archived_at is null and ((e.venue_id is not null and i.venue_id = e.venue_id) or (e.venue_id is null and cl is not null and i.client_id = cl))
                  and (i.kind <> 'supply' or e.sup)
                  and (i.kind = 'supply' or c.items is null or i.id = any(c.items)
                       or exists (select 1 from bar_moves m, jsonb_array_elements(m.items) it where m.event_id = p_event and m.step <> 'item' and it->>'item_id' = i.id::text))),
    'sizes', (select coalesce(json_object_agg(k, s), '{}') from (select kind as k, json_agg(distinct size) as s from bar_catalog where archived_at is null and size is not null group by kind) z),
    'moves', (select coalesce(json_agg(json_build_object('id', m.id, 'step', m.step, 'items', m.items, 'at', m.at, 'by', st.full_name, 'by_id', m.by_staff,
                 'undone_at', m.undone_at, 'undone_by', ub.full_name, 'undo_reason', m.undo_reason) order by m.at), '[]')
                from bar_moves m left join staff st on st.id = m.by_staff left join staff ub on ub.id = m.undone_by where m.event_id = p_event),
    'count', case when c.id is null then null else json_build_object('supplies', c.supplies, 'handed_to', c.handed_to,
              'handed_to_name', (select full_name from staff where id = c.handed_to), 'handed_by_name', (select full_name from staff where id = c.handed_by),
              'submitted_at', c.submitted_at, 'submitted_by_name', (select full_name from staff where id = c.submitted_by)) end,
    'team', (select coalesce(json_agg(json_build_object('id', st.id, 'name', st.full_name, 'role', s.position_detail) order by st.full_name), '[]')
               from shifts s join staff st on st.id = s.staff_id where s.event_id = p_event and s.status <> 'declined' and s.attendance is null and s.staff_id <> me()));
end $$;

-- Home button: + how many went out so far ("Bar count · 14 out").
create or replace function public.bar_count_mine(p_event uuid) returns json
language sql stable security definer set search_path = public as
$$ select case when not exists (select 1 from events where id = p_event and department = 'bar') or not _can_bar_count(p_event) then null
   else json_build_object('submitted_at', (select submitted_at from bar_counts where event_id = p_event),
                          'started', exists (select 1 from bar_moves where event_id = p_event and step = 'start' and undone_at is null),
                          'handed_to_me', exists (select 1 from bar_counts where event_id = p_event and handed_to = me()),
                          'out', (select coalesce(sum(case when m.step in ('start', 'more') then (it->>'qty')::numeric when m.step = 'fix' then coalesce((it->>'out')::numeric, 0) else 0 end), 0)
                                    from bar_moves m, jsonb_array_elements(m.items) it where m.event_id = p_event and m.undone_at is null and m.step in ('start', 'more', 'fix'))) end $$;

revoke all on function public._bar_item_for(uuid, uuid) from public, anon, authenticated;
revoke all on function public.bar_catalog_pick(uuid) from public, anon;
revoke all on function public.bar_pick(uuid, uuid[], boolean) from public, anon;
grant execute on function public.bar_catalog_pick(uuid), public.bar_pick(uuid, uuid[], boolean), public.bar_item_save(uuid, uuid, text, text, text),
  public.bar_count_get(uuid), public.bar_count_mine(uuid) to authenticated;

select 'RESULT ' || (select count(*) from bar_catalog) || ' bottles on the G&R list · ' || (select count(*) from bar_catalog where price is not null) || ' with a price · '
  || (select count(*) from bar_items where catalog_id is not null) || ' venue bottles linked';
